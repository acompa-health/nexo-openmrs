/**
 * The transition harness: `createHarness(protocols, initial, trust, hostObjectContracts?)` and `Harness.dispatch`. One event is accepted at
 * ingress, then routed separately to each interested execution. An evaluated attempt pins one snapshot, resolves its
 * inputs, selects a row, checks host authority, preflights every effect and commits all of them with the target, or none.
 * A failure keeps the incoming event on the execution and runs the effective handler as a separate attempt; a handler
 * that fails records one owned issue and never recurses. Internal events are delivered after commit, bounded per root.
 * Each execution, and each work policy it commissions, runs the definitions of its exact pinned ContentRef, resolved at
 * dispatch from the contents available to this harness. Deploying another content changes no existing execution.
 * Host object contracts are fixed at setup and type receipts and recovered confirmations. One initial content defaults
 * to its own catalog; multiple contents require an explicit host contract. Deploying content never expands it. Initial
 * objects remain host-attested setup data. The host contract does not replace any content's pinned catalog or identity.
 * The harness keeps its own copy of the scenario and trust context it is created with and of each event a caller passes
 * in, and it returns copies of its reports, so a caller's later edit changes nothing here. A TrustedEvent is JSON data:
 * a value that structuredClone cannot copy is a host contract error and throws before anything is kept.
 * Not here yet: lifecycle successors (`predecessor`) and corrections.
 * Source: the resolved v1 contract, "Events and state enablement" to "Failure ownership and bounded causal execution".
 */
import type { ActorRef, AttemptReport, ContentRef, ContractCatalog, ExecutionRef, CommittedEffect, DecisionRequestPayload, ExecutionSnapshot, Fact, FailurePayload, Harness, HistoryRecord, Id, InputDecl, Instant, Intent, JsonValue, Observation, Observations, PreparedProtocol, ProtocolDocument, RecordContract, ResolvedInput, ScenarioObject, ScenarioState, StepReport, Table, TrustContext, TrustedEvent, WorkPolicy, WorkSnapshot, WorkTemplate, Workflow } from '../types.ts';
import { readSuppliedDatum } from '../contracts.ts';
import { effectiveHandlers } from '../validate.ts';
import { checkAuthority, protectedEffects } from './authority.ts';
import { ContentRegistry } from './contents.ts';
import { lifecycleObject, lifecycleOwner } from './lifecycle.ts';
import { calculationNamesRead, evaluateCalculations, tableNamesRead } from './calculations.ts';
import { ENGINE_ACTOR, applyPlan, executionRef, nextIdentity, preflight, withPaths } from './commit.ts';
import type { AttemptContext, ExecutionState, Failure, World } from './commit.ts';
import { ingest, patientOf, patientOfObject, route, sameJson, sameRef } from './events.ts';
import { conceptsOf, pinSnapshot, readPath, resolveInputs, typeError } from './facts.ts';
import { RequestSlots, requestProblem } from './requests.ts';
import { objectReferencesProblem } from './references.ts';
import { evaluateTable } from './select.ts';
import { resourceReads } from './resources.ts';
import { compareTimes } from './time.ts';
import { checkWorkReport, isWorkReport, referenceProblem, resolvePerformer, workKey, workView } from './work.ts';
import type { WorkHistory } from './work.ts';

const isMap = (v: JsonValue | undefined): v is Readonly<Record<string, JsonValue>> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ENGINE_EVENTS = new Set(['evaluation.failed', 'workflow.ended']);
const isOwner = (v: JsonValue | undefined): v is { id: string; revision: string } =>
 isMap(v) && typeof v.id === 'string' && v.id.trim() !== '' && typeof v.revision === 'string' && v.revision.trim() !== '' && Object.keys(v).length === 2;
/** A work reference value: exactly `{id, occurrence}`, with an optional revision. */
const isWorkValue = (v: JsonValue | undefined): v is { id: string; occurrence: string } =>
 isMap(v) && typeof v.id === 'string' && typeof v.occurrence === 'string' && Object.keys(v).every(k => k === 'id' || k === 'occurrence' || k === 'revision');
const freshHistory = (): WorkHistory => ({ reports: [], revisions: [], cancellations: [], dispatches: [] });
const observed = (value: unknown): Observation => ({ status: 'observed', value: structuredClone(value) as JsonValue });
const none = (reason: string): Observation => ({ status: 'not_observable', reason });
const activationCounter = (id: Id): number => {
 const match = /^A(0|[1-9]\d*)$/.exec(id), ordinal = match ? Number(match[1]) : NaN;
 return Number.isSafeInteger(ordinal) ? ordinal : 1;
};

/** What the engine keeps about an attempt beside its report. */
interface AttemptMeta { committed: Id[]; handler?: Id; failure?: Failure }
type Issue = StepReport['failures'][number];
/** The definitions of one available content, derived once. */
interface Content {
 protocol: PreparedProtocol; doc: ProtocolDocument;
 policies: Readonly<Record<Id, WorkPolicy>>; templates: Readonly<Record<Id, WorkTemplate>>; records: Readonly<Record<Id, RecordContract>>;
 handlers: ReturnType<typeof effectiveHandlers>;
}
const label = (c: ContentRef) => `${c.protocol}@${c.revision}`;

export function createHarness(protocols: PreparedProtocol | readonly PreparedProtocol[], initial: ScenarioState, trust: TrustContext,
 hostObjectContracts?: ContractCatalog['objects']): Harness {
 initial = structuredClone(initial);
 trust = structuredClone(trust);
 const recoveredReferenceProblem = objectReferencesProblem(initial, 'initial', new Set([
  ...initial.objects.map((_, i) => `initial/objects/${i}`),
  ...(initial.stage_confirmations ?? []).map((_, i) => `initial/stage_confirmations/${i}/object`),
 ]));
 if (recoveredReferenceProblem) throw new Error(recoveredReferenceProblem);
 if (!Number.isInteger(trust.max_internal_steps) || trust.max_internal_steps < 1) throw new Error('max_internal_steps must be a positive integer.');
 const registry = new ContentRegistry(), list = Array.isArray(protocols) ? protocols as readonly PreparedProtocol[] : [protocols as PreparedProtocol];
 if (!list.length) throw new Error('a harness needs at least one prepared content.');
 if (list.length > 1 && hostObjectContracts === undefined) throw new Error('a multi-content harness needs an explicit host object contract.');
 for (const p of list) {
  const r = registry.deploy(p);
  if (r.outcome === 'refused') throw new Error(`content ${label(p.content)}: ${r.reason}`);
 }
 /** Host object typing is fixed for this run, independent of later content deployments. */
 const host = structuredClone(hostObjectContracts ?? registry.resolve(list[0].content)!.catalog.objects);
 const derived = new Map<string, Content>();
 /** The definitions of exactly this content, or undefined when it is not available. */
 const contentOf = (ref: ContentRef | undefined): Content | undefined => {
  const p = registry.resolve(ref);
  if (!p) return undefined;
  let c = derived.get(p.content.identity);
  if (!c) {
   const policies = { ...p.catalog.policies, ...p.document.definitions?.work_policies };
   // A catalog policy runs in the content that commissions it, so it has the same table → policy → document handlers.
   const handlers = effectiveHandlers({ ...p.document, definitions: { ...p.document.definitions, work_policies: policies } });
   derived.set(p.content.identity, c = {
    protocol: p, doc: p.document, policies, handlers,
    templates: { ...p.catalog.tasks, ...p.document.definitions?.work_templates }, records: { ...p.catalog.records, ...p.document.definitions?.records },
   });
  }
  return c;
 };
 const world: World = { objects: structuredClone(initial.objects) as World['objects'], executions: new Map(), work: structuredClone(initial.work) as World['work'], records: Array.from(initial.records ?? [], r => structuredClone(r)), pendingStages: [], confirmedStages: [], counters: {}, history: new Map() };
 const clinicalHistory = Array.from(initial.history ?? [], r => structuredClone(r)), registries = structuredClone(initial.registries ?? {});
 const initialExecutions = new Map(initial.executions.map(x => [x.id, x])), recordIds = new Set<Id>();
 for (const record of world.records) {
  const execution = initialExecutions.get(record.execution);
  const contract = execution && contentOf(execution.content)?.records[record.record];
  if (recordIds.has(record.id) || !contract) throw new Error(`invalid initial record ${record.id}: duplicate ID, missing execution or unknown record contract`);
  recordIds.add(record.id);
  const fields = contract.fields;
  for (const key of Object.keys(record.fields)) if (!Object.hasOwn(fields, key)) throw new Error(`invalid initial record ${record.id}: undeclared field ${key}`);
  for (const [key, decl] of Object.entries(fields)) {
   if (!Object.hasOwn(record.fields, key)) { if (!decl.optional) throw new Error(`invalid initial record ${record.id}: missing field ${key}`); continue; }
   const error = typeError(decl.type, record.fields[key]);
   if (error) throw new Error(`invalid initial record ${record.id}: ${key} is ${error}`);
  }
  const ordinal = /^REC-(0|[1-9]\d*)$/.exec(record.id);
  if (ordinal) world.counters.REC = Math.max(world.counters.REC ?? 0, Number(ordinal[1]));
 }
 for (const w of world.work) {
  if (!contentOf(w.commissioned_by.content)) throw new Error(`work ${w.ref.id} was commissioned under content ${label(w.commissioned_by.content)}, which is not available in this harness`);
  world.history.set(workKey(w.ref), freshHistory());
 }
 if (initial.cancellations !== undefined && !Array.isArray(initial.cancellations)) throw new Error('invalid initial cancellations: expected a list');
 for (const c of initial.cancellations ?? []) {
  const value = c as unknown as JsonValue;
  if (!isMap(value) || !isMap(value.work) || Object.keys(value.work).some(k => k !== 'id' && k !== 'occurrence') ||
      typeof value.work.id !== 'string' || !value.work.id.trim() || typeof value.work.occurrence !== 'string' || !value.work.occurrence.trim() ||
      typeof value.event !== 'string' || !value.event.trim() || !Object.hasOwn(value, 'reason'))
   throw new Error('invalid initial cancellation: expected work {id, occurrence} only, event and reason');
  const work = value.work;
  const matches = world.work.filter(w => w.ref.id === work.id && w.ref.occurrence === work.occurrence);
  if (matches.length !== 1) throw new Error('invalid initial cancellation: work occurrence is not unique in the scenario');
  const history = world.history.get(workKey(matches[0].ref))!;
  if (history.cancellations.some(existing => existing.event === value.event)) throw new Error('invalid initial cancellation: duplicate request for the occurrence');
  history.cancellations.push({ event: value.event, reason: value.reason });
 }
 // A binding that is a work reference is that execution's current handle of the same name.
 for (const x of initial.executions) {
  const content = contentOf(x.content);
  if (!content) throw new Error(`execution ${x.id} pins content ${label(x.content)}, which is not available in this harness`);
  const object = lifecycleObject(content.doc.workflows.find(w => w.id === x.workflow), x.bindings);
  if (object && !x.ended) {
   const existing = lifecycleOwner(registry, object, Array.from(world.executions.values(), e => e.snapshot));
   if (existing && !existing.ended) throw new Error(`execution ${x.id}: ${object.type}:${object.id} already has active lifecycle ${existing.id}`);
  }
  world.executions.set(x.id, {
  snapshot: structuredClone(x), retained: [], processed: new Set(), previous: {}, activations: activationCounter(x.activation),
  handles: Object.fromEntries(Object.entries(x.bindings).filter(([, v]) => isWorkValue(v)).map(([k, v]) => [k, { id: (v as { id: string }).id, occurrence: (v as { occurrence: string }).occurrence }])),
  ...(isOwner(x.bindings.owner) ? { owner: { id: x.bindings.owner.id, revision: x.bindings.owner.revision } } : {}),
  });
 }
 const seen = new Map<Id, TrustedEvent>(), admitted = new Set<Id>(), attempts: AttemptReport[] = [], meta = new Map<Id, AttemptMeta>();
 /** Only events produced by this harness are internal; a caller cannot gain that status by choosing an `internal:` receipt ID. */
 const generated = new Set<Id>();
 /** Verified decision attribution follows a causal internal request chain, independently of the engine emitter. */
 const verifiedDecisionActors = new Map<Id, TrustedEvent['actor']>();
 /** Requests whose actor provenance was verified from an event in this harness, distinct from host-seeded requests. */
 const provenRequests = new Set<Id>();
 const issues: Issue[] = [], steps = new Map<Id, number>(), slots = new RequestSlots();
 /** The host object revisions each accepted event applied, by event ID: a redelivery must carry the same ones. */
 const hostObjects = new Map<Id, readonly ScenarioObject[]>();
 /** The clinical records each accepted event supplied, for exact redelivery checks. */
 const hostHistory = new Map<Id, readonly HistoryRecord[]>();
 /** Exact confirmations permit idempotent delivery under another event ID. */
 const confirmations = new Map<Id, NonNullable<TrustedEvent['receipt']['stage_confirmation']>>();
 const recovered = new Set<Id>();
 const checkHandoff = (h: World['pendingStages'][number]) => {
  const record = world.records.find(r => r.id === h?.record), execution = record && world.executions.get(record.execution)?.snapshot;
  const content = execution && contentOf(execution.content), contract = record && content?.records[record.record];
  const workflow = execution && content?.doc.workflows.find(w => w.id === execution.workflow);
  const owner = execution && lifecycleObject(workflow, execution.bindings);
  const effect = workflow && [...workflow.tables, ...Object.values(content?.doc.definitions?.tables ?? {})]
   .flatMap(t => t.rules).flatMap(r => r.effects).find(e => e.id === record?.effect && e.kind === 'record' && e.record === record.record);
  if (!effect || !record || !execution || !contract?.stage || !owner || recovered.has(h.record)
   || !sameJson(record.handoff, h) || h.record_type !== record.record || !sameJson(h.fields, record.fields)
   || h.execution !== record.execution || h.attempt !== record.attempt || h.effect !== record.effect
   || !sameJson(h.content, execution.content) || h.subject?.type !== contract.subject || h.subject?.type !== owner.type
   || h.subject.id !== owner.id || h.subject.revision !== undefined || !sameJson(h.stage, record.fields.stage)
   || typeof h.stage !== 'string' || !h.stage || typeof h.expected_revision !== 'string' || !h.expected_revision)
   throw new Error(`invalid recovered stage handoff ${h?.record}`);
  recovered.add(h.record);
 };
 for (const confirmation of initial.stage_confirmations ?? []) {
  const object = confirmation?.object, hs = confirmation?.handoffs;
  const contract = object && host[object.type];
  if (!object || !contract || object.superseded_by !== undefined || object.superseded_event !== undefined
   || !isMap(object.fields as JsonValue) || Object.keys(object.fields).some(f => !Object.hasOwn(contract.fields, f))
   || Object.entries(contract.fields).some(([f, d]) => Object.hasOwn(object.fields, f) ? !!typeError(d.type, object.fields[f]) : !d.optional)
   || !Array.isArray(hs) || !hs.length || !world.objects.some(o => o.type === object.type && o.id === object.id
   && o.revision === object.revision && sameJson(o.fields, object.fields))) throw new Error('invalid recovered stage confirmation object');
  for (const h of hs) {
   checkHandoff(h);
   if (h.subject.type !== object.type || h.subject.id !== object.id || !sameJson(h.stage, object.fields.stage)
    || !world.objects.some(o => o.type === object.type && o.id === object.id && o.revision === h.expected_revision && o.superseded_by === object.revision))
    throw new Error(`invalid recovered stage confirmation for ${h.record}`);
   confirmations.set(h.record, structuredClone(confirmation));
  }
  const revisions = world.objects.filter(o => o.type === object.type && o.id === object.id);
  const current = revisions.filter(o => !o.superseded_by);
  const patient = patientOfObject(object, world.objects);
  if (current.length !== 1 || typeof current[0].fields.stage !== 'string' || !patient || patientOfObject(current[0], world.objects) !== patient)
   throw new Error('invalid recovered case revision');
  let next = revisions.find(o => o.revision === object.revision);
  const visited = new Set<string>();
  while (next?.superseded_by) {
   if (visited.has(next.revision)) throw new Error('invalid recovered case revision chain');
   visited.add(next.revision);
   const candidates = revisions.filter(o => o.revision === next!.superseded_by);
   if (candidates.length !== 1 || patientOfObject(candidates[0], world.objects) !== patient) throw new Error('invalid recovered case revision chain');
   next = candidates[0];
  }
  if (!next || next.revision !== current[0].revision) throw new Error('invalid recovered case revision chain');
  const subject = { type: object.type, id: object.id }, stage = current[0].fields.stage;
  const kinds = new Set(registry.list().flatMap(p => Object.entries({ ...p.catalog.records, ...p.document.definitions?.records })
   .filter(([, contract]) => contract.stage && contract.subject === subject.type).map(([name]) => name)));
  world.confirmedStages = world.confirmedStages.filter(c => c.subject.type !== subject.type || c.subject.id !== subject.id);
  for (const record of kinds) world.confirmedStages.push({ subject, record, stage });
 }
 for (const record of world.records) {
  const h = record.handoff;
  if (!h) continue;
  if (h.record !== record.id) throw new Error(`invalid recovered stage handoff ${record.id}`);
  if (recovered.has(record.id)) continue;
  checkHandoff(h);
  const current = world.objects.filter(o => o.type === h.subject.type && o.id === h.subject.id && !o.superseded_by);
  const others = world.pendingStages.filter(x => x.subject.type === h.subject.type && x.subject.id === h.subject.id);
  if (current.length !== 1 || current[0].revision !== h.expected_revision || others.some(x => x.expected_revision !== h.expected_revision || !sameJson(x.stage, h.stage)))
   throw new Error(`invalid recovered stage handoff ${h.record}: case revision or stage conflicts`);
  world.pendingStages.push(structuredClone(h));
 }

 // A transition commits all its effects atomically. Recovery cannot confirm or leave pending only a subset.
 const handoffs = [...world.pendingStages, ...(initial.stage_confirmations ?? []).flatMap(c => c.handoffs)];
 for (const h of handoffs) {
  const content = contentOf(h.content)!;
  const siblings = world.records.filter(r => r.execution === h.execution && r.attempt === h.attempt && content.records[r.record]?.stage).map(r => r.id).sort();
  const batch = confirmations.get(h.record)?.handoffs ?? world.pendingStages.filter(x => x.execution === h.execution && x.attempt === h.attempt);
  if (batch.some(x => x.execution !== h.execution || x.attempt !== h.attempt)
   || !sameJson(siblings, batch.map(x => x.record).sort()))
   throw new Error(`invalid recovered stage transition ${h.execution}/${h.attempt}: handoff batch is incomplete or mixed`);
 }
 // Every stage change in a recovered case's revision chain must have its own correlated confirmation.
 for (const subject of handoffs.map(h => h.subject).filter((s, i, all) => all.findIndex(x => x.type === s.type && x.id === s.id) === i)) {
  const revisions = world.objects.filter(o => o.type === subject.type && o.id === subject.id);
  const incoming = new Set(revisions.flatMap(o => o.superseded_by ? [o.superseded_by] : []));
  const heads = revisions.filter(o => !incoming.has(o.revision));
  if (heads.length !== 1 || new Set(revisions.map(o => o.revision)).size !== revisions.length)
   throw new Error(`invalid recovered stage revision chain for ${subject.type}:${subject.id}`);
  let current = heads[0];
  const visited = new Set<string>();
  while (current.superseded_by) {
   if (visited.has(current.revision)) throw new Error('invalid recovered stage revision chain');
   visited.add(current.revision);
   const next = revisions.find(o => o.revision === current.superseded_by);
   if (!next) throw new Error('invalid recovered stage revision chain');
   if (!sameJson(current.fields.stage, next.fields.stage)) {
    const matching = (initial.stage_confirmations ?? []).filter(c => c.object.type === subject.type && c.object.id === subject.id
     && c.object.revision === next.revision && c.handoffs.every(h => h.expected_revision === current.revision));
    if (matching.length !== 1) throw new Error(`unconfirmed recovered stage revision ${subject.type}:${subject.id}@${next.revision}`);
   }
   current = next;
  }
  visited.add(current.revision);
  if (visited.size !== revisions.length) throw new Error('invalid recovered stage revision chain');
 }

 let now: Instant = initial.now;
 /** Every request accepted into a slot, or attested by the host: where it was current, whose decision it carries and its fixed references. */
 const requestInfo = new Map<Id, { execution: Id; activation: Id; table: Id; actor: ActorRef; fixed: DecisionRequestPayload['fixed'] }>();
 /** Each `workflow.ended` the engine emitted → the execution that ended. Only these route by execution reference. */
 const endings = new Map<Id, ExecutionRef>();
 /** The outstanding execution-lifetime work of each ended execution, at the commit that ended it. */
 const outstandingAtEnd = new Map<Id, JsonValue[]>();
 /** Due timers already delivered, by occurrence and due revision: each fires once. */
 const fired = new Set<string>();
 // A failed attempt leaves an unmet obligation. Completion and confirmed cancellation end it; failure alone does not.
 const OUTSTANDING = new Set<WorkSnapshot['status']>(['queued', 'dispatched', 'failed', 'cancellation_requested']);
 const dueKey = (w: WorkSnapshot) => `${workKey(w.ref)}@${w.due?.revision}`;
 /**
  * The `work.due` event of one occurrence's current due revision. A new root unless `cause` makes it part of one. It
  * keeps the case identity of the event that commissioned the occurrence and never that of its cause, so a due delivered
  * at the commit that changed the work and the same due delivered later have the same scope. Work with no commissioning
  * event in this run, or one without cases, gets no case.
  */
 const dueEvent = (w: WorkSnapshot, cause?: TrustedEvent): TrustedEvent => {
  const id = `due:${w.ref.id}/${w.ref.occurrence}@${w.due!.revision}`, patient = patientOfObject(w.subject, world.objects);
  const origin = world.history.get(workKey(w.ref))?.origin, cases = origin && seen.get(origin.event)?.scope.cases;
  return {
   id, type: 'work.due', occurrence: id, scope: { patient: patient ?? cause?.scope.patient ?? '', subject: w.subject, ...(cases ? { cases } : {}) }, actor: ENGINE_ACTOR,
   occurred_at: w.due!.at!, received_at: cause ? now : w.due!.at!, mode: trust.mode, work: { id: w.ref.id, occurrence: w.ref.occurrence, revision: w.ref.revision },
   payload: { due_revision: w.due!.revision }, root: cause?.root ?? id, ...(cause ? { caused_by: cause.id } : {}), receipt: { id: `internal:${id}` },
  };
 };

 /** A work policy runs as ordinary table content: an execution whose workflow is the policy ID in its own content. */
 const isPolicy = (x: ExecutionSnapshot) => {
  const c = contentOf(x.content);
  return !!c && Object.hasOwn(c.policies, x.workflow) && !c.doc.workflows.some(w => w.id === x.workflow);
 };
 /** The workflow an execution runs, from exactly the content it pins. */
 const workflowOf = (x: ExecutionSnapshot): Workflow | undefined => {
  const c = contentOf(x.content);
  if (!c) return undefined;
  if (!isPolicy(x)) return c.doc.workflows.find(w => w.id === x.workflow);
  const p = c.policies[x.workflow];
  return { id: p.id, subject: p.subject, inputs: p.inputs, initial: p.initial, states: p.states, tables: p.tables, ...(p.fallback ? { fallback: p.fallback } : {}) };
 };
 /** The patient of an execution; a policy execution belongs to the patient of the work it serves. */
 const patientOfExecution = (x: ExecutionSnapshot): Id | undefined => {
  if (!isPolicy(x)) {
   const bound = x.bindings.patient;
   return patientOf(x, world.objects) ?? (isMap(bound) && bound.type === 'patient' && typeof bound.id === 'string' ? bound.id : undefined);
  }
  const w = isWorkValue(x.bindings.work) ? occurrence(x.bindings.work) : undefined;
  return w && patientOfObject(w.subject, world.objects);
 };
 const tableById = (c: Content, w: Workflow, id: Id): Table | undefined => w.tables.find(t => t.id === id) ?? c.doc.definitions?.tables?.[id];
 const occurrence = (ref: { id: Id; occurrence: Id } | undefined) => ref && world.work.find(w => w.ref.id === ref.id && w.ref.occurrence === ref.occurrence);
 const historyOf = (w: WorkSnapshot): WorkHistory => { const k = workKey(w.ref); let h = world.history.get(k); if (!h) world.history.set(k, h = freshHistory()); return h; };
 /** The event as a table reads it: `event.work` also exposes the content captured on that exact occurrence. */
 /** Each work handle as a root: the current occurrence's projection, with its captured content. */
 const handleViews = (x: ExecutionState): Record<string, JsonValue> => Object.fromEntries(Object.entries(x.handles).flatMap(([name, ref]) => {
  const w = isWorkValue(ref) ? occurrence(ref) : undefined;
  return w ? [[name, workView(w)]] : [];
 }));
 const eventView = (event: TrustedEvent): JsonValue => {
  const w = occurrence(event.work);
  const view = w ? { ...event, work: { ...event.work, content: w.content ?? {} } } : event;
  return (event.type === 'evaluation.failed' ? { ...view, payload: failedRequestView(event) } : view) as unknown as JsonValue;
 };
 /**
  * A failure's `request` stays the request ID. On an engine-generated failure, typed virtual paths read the actor and
  * fixed references only after the request's actor passed provenance verification. Authority can still refuse that
  * request before it takes a slot; the attempted decision must remain attributed without becoming authorized.
  */
 function failedRequestView(event: TrustedEvent): Readonly<Record<string, JsonValue>> {
  const own = Object.fromEntries(Object.entries(event.payload).filter(([k]) => !k.startsWith('request.')));
  const id = generated.has(event.id) ? event.payload.request : undefined;
  const attempted = typeof id === 'string' ? seen.get(id) : undefined;
  const actor = typeof id === 'string' ? verifiedDecisionActors.get(id) : undefined;
  const payload = attempted?.type === 'decision.requested' ? attempted.payload as unknown as DecisionRequestPayload : undefined;
  const r = typeof id === 'string' && provenRequests.has(id) && payload && actor && sameJson(actor, payload.actor) && isMap(payload.fixed)
   ? { actor, fixed: payload.fixed } : undefined;
  return r ? { ...own, 'request.actor': structuredClone(r.actor) as unknown as JsonValue, 'request.fixed': structuredClone(r.fixed) as JsonValue } : own;
 }

 /**
  * May an internal request carry the actor of the request it resumes? Only when it resumes exactly the current request R
  * of its own execution, activation and table, carries R's verified actor and R's fixed references unchanged, and was
  * caused by evidence on an occurrence that the engine (or the host, at setup) bound to R: a verified completion of that
  * work, or a trusted result on a current order handle whose fulfillment is pending or verified complete. The result must name the current revision of
  * an object of the order's patient, and the resumed request must collect that very object. A copied actor or
  * request ID, other work or another event proves nothing, and the result reporter is never the decision actor.
  */
 function resumes(event: TrustedEvent, p: DecisionRequestPayload, source: TrustedEvent): boolean {
  if (p.source_event !== source.id) return false;
  const r = p.resume_from === undefined ? undefined : requestInfo.get(p.resume_from);
  if (!r || !sameJson(r.actor, p.actor) || !sameJson(verifiedDecisionActors.get(p.resume_from!), p.actor) || !sameJson(r.fixed, p.fixed)) return false;
  if (event.target?.execution !== r.execution || event.target.activation !== r.activation || p.table !== r.table || slots.get(r.execution, r.activation, r.table) !== p.resume_from) return false;
  const w = occurrence(source.work), h = w && world.history.get(workKey(w.ref));
  if (!w || !h || h.request !== p.resume_from) return false;
  if (source.type === 'task.completed') return h.reports.some(x => x.event === source.id && x.disposition === 'applied' && x.verified === true);
  const events = contentOf(world.executions.get(r.execution)?.snapshot.content)?.protocol.catalog.events ?? {};
  const resultType = events[source.type]?.payload.result?.type, result = source.payload.result;
  const eligibleOrder = w.status === 'queued' || w.status === 'dispatched'
   || (w.status === 'completed' && h.reports.some(x => x.type === 'task.completed' && x.disposition === 'applied' && x.verified === true));
  if (w.kind !== 'order' || !eligibleOrder || !resultType || result === undefined || typeError(resultType, result)) return false;
  const current = world.executions.get(r.execution);
  if (!current || !Object.values(current.handles).some(value => isWorkValue(value) && value.id === w.ref.id && value.occurrence === w.ref.occurrence)) return false;
  if (referenceProblem(result, resultType, world.objects, ref => patientOfObject(ref, world.objects), source.scope.patient)) return false;
  if (!Object.values(p.collected).some(value => sameRef(value, result))) return false;
  return patientOfObject(result as unknown as { type: Id; id: Id }, world.objects) === source.scope.patient
   && patientOfObject(w.subject, world.objects) === source.scope.patient && !!source.scope.subject
   && sameRef(source.scope.subject as unknown as JsonValue, w.subject as unknown as JsonValue);
 }

 /** A decision request cannot carry another patient's object as a fixed or collected input. */
 function requestReferenceProblem(contract: NonNullable<Table['request']>, p: Pick<DecisionRequestPayload, 'fixed' | 'collected'>, patient: Id | undefined): string | undefined {
  for (const part of ['fixed', 'collected'] as const) for (const [name, decl] of Object.entries(contract[part])) {
   if (!decl.target.startsWith('object:')) continue;
   const value = p[part]?.[name];
   if (value === undefined) continue;
   const problem = referenceProblem(value, { type: 'reference', target: decl.target }, world.objects,
    ref => patientOfObject(ref, world.objects), patient ?? '');
   if (problem) return `${part}.${name}: ${problem}`;
   if (!isMap(value) || patientOfObject(value as unknown as { type: Id; id: Id }, world.objects) !== patient)
    return `${part}.${name}: patient is not established as ${patient ?? 'the request patient'}`;
  }
  return undefined;
 }

 /**
  * Host-attested request slots and handle history. Each seeded reference must resolve in this world: the execution and
  * its current activation, the table's request contract, and every serving occurrence (same execution and subject, with
  * content that names the request). A bad seed is a setup error, never a quietly trusted actor.
  */
 for (const q of initial.requests ?? []) {
  const x = world.executions.get(q.execution), fail = (why: string): never => { throw new Error(`scenario request ${q.request}: ${why}`); };
  if (!x) fail(`no execution ${q.execution}`);
  if (!isMap(q.actor as unknown as JsonValue) || typeof q.actor.id !== 'string' || typeof q.actor.kind !== 'string') fail('has no decision actor');
  if (typeof q.source_event !== 'string' || q.source_event === '') fail('has no source event');
  const table = workflowOf(x!.snapshot)?.tables.find(t => t.id === q.table);
  if (!table?.request) fail(`${q.table} is not a request table of ${q.execution}`);
  const problem = requestProblem(table!.request!, { fixed: q.fixed, collected: q.collected ?? {} });
  if (problem) fail(problem);
  const referenceProblem = requestReferenceProblem(table!.request!, { fixed: q.fixed, collected: q.collected ?? {} }, patientOfExecution(x!.snapshot));
  if (referenceProblem) fail(referenceProblem);
  for (const ref of q.work ?? []) {
   const w = occurrence(ref);
   if (!w) fail(`no work occurrence ${ref.id}/${ref.occurrence}`);
   if (w!.commissioned_by.id !== q.execution || !sameRef(w!.subject as unknown as JsonValue, x!.snapshot.subject as unknown as JsonValue)) fail(`${ref.id} is not work of ${q.execution} for its subject`);
   if (!Object.values(w!.content ?? {}).some(v => v === q.request || (isMap(v) && v.id === q.request))) fail(`the content captured on ${ref.id} does not name ${q.request}`);
   historyOf(w!).request = q.request;
  }
  if (q.status === 'pending') {
   if (q.activation !== x!.snapshot.activation) fail(`a pending request must be in the current activation ${x!.snapshot.activation}`);
   if (!slots.accept(q.execution, q.activation, q.request, { table: q.table }).ok) fail(`slot ${q.table} already holds a request`);
  } else slots.retired.push({ execution: q.execution, activation: q.activation, table: q.table, request: q.request, reason: q.reason ?? 'retired before this run' });
  requestInfo.set(q.request, { execution: q.execution, activation: q.activation, table: q.table, actor: q.actor, fixed: q.fixed });
  verifiedDecisionActors.set(q.request, q.actor);
 }
 for (const hd of initial.handles ?? []) {
  const x = world.executions.get(hd.execution), fail = (why: string): never => { throw new Error(`scenario handle ${hd.handle}: ${why}`); };
  if (!x) fail(`no execution ${hd.execution}`);
  for (const ref of [hd.current, ...hd.previous]) if (occurrence(ref)?.commissioned_by.id !== hd.execution) fail(`${ref.id}/${ref.occurrence} is not work of ${hd.execution}`);
  const bound = x!.snapshot.bindings[hd.handle];
  if (bound !== undefined && !sameRef(bound, hd.current as unknown as JsonValue)) fail(`the binding ${hd.handle} names other work`);
  x!.handles[hd.handle] = { id: hd.current.id, occurrence: hd.current.occurrence };
  x!.previous[hd.handle] = hd.previous.map(r => ({ id: r.id, occurrence: r.occurrence }));
 }

 function dispatch(incoming: TrustedEvent, source: 'host' | 'engine' = 'host'): StepReport {
  const recordStart = world.records.length;
  const report = { committed: [] as CommittedEffect[], intents: [] as Intent[], generated: [] as TrustedEvent[], failures: [] as Issue[], attempts: [] as AttemptReport[], quarantined: [] as Id[], ingested: [] as Fact[] };
  const done = (event: TrustedEvent): StepReport => ({
   event: event.id, root: event.root, ingested: report.ingested, attempts: report.attempts, committed: report.committed, intents: report.intents, generated: report.generated,
   stage_handoffs: world.records.slice(recordStart).flatMap(r => r.handoff ? [r.handoff] : []), failures: report.failures, retained: world.work.filter(w => OUTSTANDING.has(w.status)),
   ...(report.quarantined.length ? { quarantined: report.quarantined } : {}),
  });
  const issue = (i: Issue) => { issues.push(i); report.failures.push(i); };
  // Host-attested requests already consumed their event IDs before this harness began. Their original envelope is not
  // available to compare, so a new delivery with one of those IDs cannot claim to be the same event.
  if (!seen.has(incoming.id) && requestInfo.has(incoming.id)) {
   issue({ reason: 'event_identity_conflict', data: { event: incoming.id, detail: `${incoming.id} is an existing host-attested request ID` } });
   return done(incoming);
  }
  const ingress = ingest(incoming, trust, seen);
  if ('rejected' in ingress) { issue({ reason: ingress.rejected, data: { event: incoming.id, detail: ingress.detail } }); return done(incoming); }
  // A host cannot pre-claim an engine timer, end announcement or failure ID. A later generated event with that ID
  // could otherwise be treated as a duplicate by a listener and lose its work-policy reaction.
  const reserved = incoming.id.startsWith('due:') ? 'due-event ID prefix'
   : incoming.id.endsWith('/ended') ? 'end-announcement ID suffix'
   : incoming.id.endsWith('/failed') ? 'failure-event ID suffix' : undefined;
  if (source === 'host' && reserved) {
   issue({ reason: 'event_identity_conflict', data: { event: incoming.id, detail: `${incoming.id} uses the engine's reserved ${reserved}` } });
   return done(incoming);
  }
  const first = ingress.accepted;
  const ingressOwner = occurrence(first.work)?.owner;
  // Keep the immutable assertion identity even when later host checks refuse it. A retry of a refused event cannot
  // skip those checks and enter routing; a retry of an admitted event only reports the original per-execution duplicate.
  if (ingress.redelivery && !admitted.has(first.id)) {
   issue({ reason: 'event_identity_conflict', ...(ingressOwner ? { owner: ingressOwner } : {}), data: {
    event: first.id, detail: `the first delivery of ${first.id} was refused; submit corrected evidence with a new event ID`,
   } });
   return done(first);
  }
  if (!ingress.redelivery) seen.set(first.id, first);
  const referenceShapeProblem = objectReferencesProblem(incoming, 'event', new Set([
   'event', 'event/receipt/stage_confirmation/object',
   ...(incoming.receipt.objects ?? []).map((_, i) => `event/receipt/objects/${i}`),
  ]));
  if (referenceShapeProblem) {
   issue({ reason: 'binding_conflict', ...(ingressOwner ? { owner: ingressOwner } : {}), data: { event: incoming.id, detail: referenceShapeProblem } });
   return done(incoming);
  }
  if (ENGINE_EVENTS.has(first.type) && !generated.has(first.id)) {
   issue({ reason: 'not_authorized', data: { event: first.id, detail: `${first.type} is generated only by the engine` } });
   return done(first);
  }
  const resultDecls = registry.list().flatMap(p => p.catalog.events[first.type] ? [p.catalog.events[first.type].payload.result] : []);
  const isObjectResult = (decl: typeof resultDecls[number]) => decl?.type.type === 'reference' && decl.type.target.startsWith('object:');
  let objectResultOnly = false;
  if (!ingress.redelivery && resultDecls.some(isObjectResult)) {
   const result = first.payload.result, objects = [...world.objects, ...(first.receipt.objects ?? [])];
   // One event type can have different contracts in concurrently available v1 contents. It must satisfy at least one
   // declaration at ingress; each interested execution still applies its own typed table contract at routing.
   const problems = resultDecls.map(decl => !decl ? (result === undefined ? undefined : 'undeclared result')
    : result === undefined ? (decl.optional ? undefined : 'missing result reference')
    : typeError(decl.type, result) ?? (isObjectResult(decl)
     ? referenceProblem(result, decl.type, objects, ref => patientOfObject(ref, objects), first.scope.patient)
      ?? (patientOfObject(result as unknown as { type: Id; id: Id }, objects) === first.scope.patient ? undefined : 'result patient is not established')
     : undefined));
   const problem = problems.every(Boolean) ? problems[0] : undefined;
   if (problem) {
    const work = occurrence(first.work);
    issue({ reason: 'binding_conflict', ...(work ? { owner: work.owner } : {}), data: { event: first.id, detail: `invalid ${first.type} result: ${problem}` } });
    return done(first);
   }
   objectResultOnly = problems.every((p, i) => !!p || isObjectResult(resultDecls[i]));
  }
  if (compareTimes(first.received_at, now) === 1) now = first.received_at;
  const incomingHistory = incoming.receipt.history ?? [];
  if (ingress.redelivery) {
   if (incoming.receipt.history !== undefined && !sameJson(incomingHistory, hostHistory.get(first.id) ?? [])) {
    issue({ reason: 'event_identity_conflict', data: { event: first.id, detail: `a redelivery of ${first.id} carries other clinical records than its original delivery` } });
    return done(first);
   }
  } else {
   const keys = new Set(clinicalHistory.map(r => `${r.kind}\u0000${r.id}\u0000${r.revision}`));
   for (const record of incomingHistory) {
    if (!isMap(record as unknown as JsonValue) || typeof record.kind !== 'string' || !record.kind || typeof record.id !== 'string' || !record.id
     || typeof record.revision !== 'string' || !record.revision || typeof record.at !== 'string' || !isMap(record.fields as JsonValue)
     || !isMap(record.of as unknown as JsonValue) || typeof record.of.type !== 'string' || typeof record.of.id !== 'string'
     || patientOfObject(record.of, world.objects) !== first.scope.patient) {
     issue({ reason: 'binding_conflict', ...(ingressOwner ? { owner: ingressOwner } : {}), data: { event: first.id, detail: `invalid or duplicate host clinical record ${record.kind}:${record.id}@${record.revision}` } });
     return done(first);
    }
    const key = `${record.kind}\u0000${record.id}\u0000${record.revision}`;
    if (keys.has(key)) {
     issue({ reason: 'binding_conflict', ...(ingressOwner ? { owner: ingressOwner } : {}), data: { event: first.id, detail: `duplicate host clinical record ${record.kind}:${record.id}@${record.revision}` } });
     return done(first);
    }
    keys.add(key);
   }
  }
  // Validate the whole correlation before any case revision is applied.
  const confirmation = incoming.receipt.stage_confirmation;
  let confirmed: typeof world.pendingStages = [], exactRetry = false;
  if (confirmation && (!Array.isArray(confirmation.handoffs) || !isMap(confirmation.object as unknown as JsonValue)
   || !isMap(confirmation.object.fields as JsonValue))) {
   issue({ reason: 'binding_conflict', data: { event: first.id, detail: 'malformed stage confirmation' } }); return done(first);
  }
  if (confirmation && ingress.redelivery && !sameJson(confirmation, first.receipt.stage_confirmation)) {
   issue({ reason: 'event_identity_conflict', data: { event: first.id, detail: 'redelivery carries a different stage confirmation' } }); return done(first);
  }
  const stageControl = first.type === 'host.stage_confirmed';
  if ((!ingress.redelivery && ((confirmation && !stageControl) || (stageControl && (!confirmation || source !== 'host'))))
   || (stageControl && (first.work !== undefined || first.target !== undefined || Object.keys(first.payload).length !== 0
    || incoming.receipt.history !== undefined || incoming.receipt.actor_attribution !== undefined
    || (incoming.receipt.objects !== undefined && (incoming.receipt.objects.length !== 1 || !sameJson(incoming.receipt.objects[0], confirmation?.object)))
    || (confirmation && !sameRef(first.scope.subject as unknown as JsonValue, confirmation.object as unknown as JsonValue))))) {
   issue({ reason: 'binding_conflict', data: { event: first.id, detail: 'stage confirmation requires a case-scoped host.stage_confirmed control event' } }); return done(first);
  }
  if (confirmation && !ingress.redelivery) {
   const hs = confirmation.handoffs, object = confirmation.object;
   const currentCase = world.objects.find(o => o.type === object.type && o.id === object.id && !o.superseded_by);
   if (!currentCase || patientOfObject(currentCase, world.objects) !== first.scope.patient) {
    issue({ reason: 'binding_conflict', data: { event: first.id, detail: 'stage confirmation case does not belong to the event patient' } }); return done(first);
   }
   exactRetry = hs.length > 0 && hs.every(h => h && sameJson(confirmations.get(h.record), confirmation));
   if (!exactRetry) {
    const pending = world.pendingStages.filter(h => h.subject.type === object?.type && h.subject.id === object?.id);
    const current = world.objects.filter(o => o.type === object?.type && o.id === object?.id && !o.superseded_by);
    if (!hs.length || hs.length !== pending.length || !pending.every(h => hs.some(g => sameJson(g, h)))
     || new Set(hs.map(h => h.record)).size !== hs.length || current.length !== 1
     || pending.some(h => h.expected_revision !== current[0].revision || !sameJson(h.stage, object.fields?.stage))
     || patientOfObject(current[0], world.objects) !== first.scope.patient
     || !(incoming.receipt.objects ?? []).some(o => sameJson(o, object))) {
     issue({ reason: 'binding_conflict', data: { event: first.id, detail: 'stage confirmation does not match the pending records and current case revision' } });
     return done(first);
    }
    confirmed = pending;
   } else if ((incoming.receipt.objects ?? []).some(o => !sameJson(o, object))) {
    issue({ reason: 'binding_conflict', data: { event: first.id, detail: 'a repeated stage confirmation cannot apply other object revisions' } }); return done(first);
   }
  }
  // The host may revise other fields, but a governed stage changes only through its correlated confirmation.
  if (!ingress.redelivery && !exactRetry && (incoming.receipt.objects ?? []).some(o => {
   if (!isMap(o as unknown as JsonValue) || !isMap(o.fields as JsonValue)) return false;
   const governed = registry.list().some(p => Object.values({ ...p.catalog.records, ...p.document.definitions?.records })
    .some(c => c.stage && c.subject === o.type));
   const current = world.objects.find(x => x.type === o.type && x.id === o.id && !x.superseded_by);
   return governed && !sameJson(current?.fields.stage, o.fields.stage)
    && !confirmed.some(h => h.subject.type === o.type && h.subject.id === o.id);
  })) {
   issue({ reason: 'binding_conflict', data: { event: first.id, detail: 'a governed stage needs a matching stage confirmation' } }); return done(first);
  }
  // A pending stage cannot be bypassed by an ordinary object revision.
  if (!ingress.redelivery && !exactRetry && (incoming.receipt.objects ?? []).some(o => world.pendingStages.some(h => h.subject.type === o.type && h.subject.id === o.id)
   && !confirmed.some(h => h.subject.type === o.type && h.subject.id === o.id))) {
   issue({ reason: 'binding_conflict', data: { event: first.id, detail: 'case has a pending stage handoff' } });
   return done(first);
  }
  // Host-attested object revisions are applied once, before routing; a bad one rejects the event.
  const objectProblem = applyHostObjects(first, exactRetry ? [] : incoming.receipt.objects, ingress.redelivery, report);
  if (objectProblem) { issue({ reason: objectProblem.reason, ...(ingressOwner ? { owner: ingressOwner } : {}), data: { event: first.id, detail: objectProblem.detail } }); return done(first); }
  if (exactRetry) hostObjects.set(first.id, structuredClone(incoming.receipt.objects ?? []));
  if (confirmation && confirmed.length) {
   for (const h of confirmed) confirmations.set(h.record, structuredClone(confirmation));
   const { subject, stage } = confirmed[0];
   const kinds = new Set(registry.list().flatMap(p => Object.entries({ ...p.catalog.records, ...p.document.definitions?.records })
    .filter(([, contract]) => contract.stage && contract.subject === subject.type).map(([name]) => name)));
   world.confirmedStages = world.confirmedStages.filter(c => c.subject.type !== subject.type || c.subject.id !== subject.id);
   for (const record of kinds) world.confirmedStages.push({ subject, record, stage });
   world.pendingStages = world.pendingStages.filter(h => !confirmed.includes(h));
  }
  if (!ingress.redelivery && objectResultOnly && isMap(first.payload.result)) {
   const result = first.payload.result;
   const current = world.objects.find(o => o.type === result.type && o.id === result.id && o.superseded_by === undefined);
   if (result.revision !== current?.revision) {
    const work = occurrence(first.work);
    issue({ reason: 'revision_conflict', ...(work ? { owner: work.owner } : {}), data: {
     event: first.id, ...(current ? { expected: current.revision } : {}), actual: result.revision,
     detail: `result ${result.type}:${result.id} must name its current object revision`,
    } });
    return done(first);
   }
  }
  if (stageControl) { admitted.add(first.id); return done(first); }
  if (!ingress.redelivery) {
   clinicalHistory.push(...structuredClone(incomingHistory));
   hostHistory.set(first.id, structuredClone(incomingHistory));
  }

  // A top-level launch may create the initial shell before its first table runs. It cannot infer a subject from other
  // patient objects: only the entry envelope can bind one. Child starts use atomic preflight in commit.ts instead.
  if (first.type === 'workflow.started' && !world.executions.has(first.target?.execution ?? '')) {
   const reject = (detail: string, actual?: Id): StepReport => { issue({ reason: 'binding_conflict', data: { event: first.id, detail, ...(actual ? { actual } : {}) } }); return done(first); };
   if (ingress.redelivery || first.caused_by !== undefined || first.root !== first.id)
    return reject('an absent execution can be launched only by a new top-level workflow.started event');
   const launched = contentOf(first.target?.content);
   if (!first.target?.execution || !launched || (first.target.activation !== undefined && first.target.activation !== 'A1'))
    return reject('the intake needs an exact new execution and an available content target');
   const patient = first.scope.patient;
   if (!patient || !initial.patients.includes(patient) || !world.objects.some(o => o.type === 'patient' && o.id === patient))
    return reject('the intake patient is not a known patient in this world');
   const entry = isMap(first.payload.entry) ? first.payload.entry : undefined;
   const declaredPatient = entry?.patient, declaredOwner = entry?.owner;
   if (!entry || !isMap(declaredPatient) || declaredPatient.type !== 'patient' || declaredPatient.id !== patient || !isOwner(declaredOwner))
    return reject('the intake needs the same known patient and a resolved accountable owner in entry');
   const owner = { id: declaredOwner.id, revision: declaredOwner.revision };
   if (!trust.roles.some(r => r.site === trust.site && sameJson(r.actor, first.actor) && sameJson(r.owner, owner)))
    return reject('the initiating actor is not bound to the supplied owner at this site');
   const candidates = launched.doc.workflows.filter(w => w.tables.some(t => t.on.event === 'workflow.started'
    && t.on.for?.binding === 'this_execution' && t.rules.some(r => r.in.includes(w.initial) || r.in.includes('*'))));
   if (candidates.length !== 1) return reject(`the intake resolves to ${candidates.length} initial workflows, not one`);
   const workflow = candidates[0];
   for (const decl of Object.values(workflow.inputs)) {
    if (typeof decl.binding !== 'string' || !decl.binding.startsWith('entry.')) continue;
    const name = decl.binding.slice('entry.'.length), supplied = entry[name];
    if (supplied === undefined) continue; // Missing required context is owned by the first table and its handler.
    const datum = readSuppliedDatum(supplied);
    if (datum.state === 'unknown') {
     if (datum.reason === 'invalid_value') return reject(`entry ${name} has a malformed unknown value`);
     continue;
    }
    if (!decl.type) return reject(`entry ${name} has no declared type`);
    const problem = typeError(decl.type, supplied);
    if (problem) return reject(`entry ${name} is ${problem}`);
    if (decl.type.type === 'reference' && decl.type.target.startsWith('object:')) {
     if (!isMap(supplied) || typeof supplied.id !== 'string') return reject(`entry ${name} is not a resolved object`);
     const kind = decl.type.target.slice('object:'.length);
     if (!world.objects.some(o => o.type === kind && o.id === supplied.id && patientOfObject(o, world.objects) === patient))
      return reject(`entry ${name} does not identify an object of patient ${patient}`);
    }
   }
   const subjectInputs = Object.values(workflow.inputs).flatMap(decl =>
    typeof decl.binding === 'string' && decl.binding.startsWith('entry.') && decl.type?.type === 'reference'
     && decl.type.target === `object:${workflow.subject}` ? [decl.binding.slice('entry.'.length)] : []);
   if (subjectInputs.length !== 1) return reject(`workflow ${workflow.id} has no unique subject entry binding`);
   const subjectName = subjectInputs[0];
   const boundSubject = entry[subjectName];
   const subjectUnknown = readSuppliedDatum(boundSubject).state === 'unknown';
   const scopeSubject = first.scope.subject;
   const scopeRef = scopeSubject ? { type: scopeSubject.type, id: scopeSubject.id,
    ...(scopeSubject.revision !== undefined ? { revision: scopeSubject.revision } : {}) } : undefined;
   if (subjectUnknown ? scopeSubject !== undefined : !sameRef(boundSubject, scopeRef))
    return reject(`the intake scope subject and entry ${subjectName} disagree`);
   const snapshot: ExecutionSnapshot = {
    id: first.target.execution, content: launched.protocol.content, workflow: workflow.id, state: workflow.initial,
    activation: 'A1', bindings: structuredClone(entry), ...(first.scope.subject ? { subject: first.scope.subject } : {}),
   };
   const object = lifecycleObject(workflow, snapshot.bindings);
   if (object && workflow.lifecycle_of) {
    if (!sameRef({ ...object }, boundSubject))
     return reject(`the intake subject must match lifecycle binding ${workflow.lifecycle_of.binding}`);
    const existing = lifecycleOwner(registry, object, Array.from(world.executions.values(), x => x.snapshot));
    if (existing) return reject(`${object.type}:${object.id} already has lifecycle ${existing.id}${existing.ended ? '; a successor is not supported' : '; reuse needs mode bind'}`, existing.id);
   }
   world.executions.set(snapshot.id, { snapshot, retained: [], processed: new Set(), handles: {}, previous: {}, activations: 1, owner });
  }

  const queue: TrustedEvent[] = [first];
  /** Count one internally caused delivery attempt against its root, or quarantine at the limit. */
  const spend = (root: Id): boolean => {
   const used = steps.get(root) ?? 0;
   if (used >= trust.max_internal_steps) return false;
   steps.set(root, used + 1);
   return true;
  };
  const record = (a: AttemptReport, m: AttemptMeta) => { attempts.push(a); report.attempts.push(a); meta.set(a.id, m); };

  /** Run one table for one execution. `original` is set when this attempt is the handler of a failed one. */
  function attempt(event: TrustedEvent, x: ExecutionState, defs: Content, workflow: Workflow, table: Table, id: Id, original?: { attempt: AttemptReport; failure: Failure }): AttemptReport {
   const snap = x.snapshot, base = { id, event: event.id, execution: snap.id, activation: snap.activation, table: table.id };
   if (!original) x.retained.push(event.id);
   let accepted: Id | undefined;
   const refuse = (failure: Failure, extra: Partial<AttemptReport> = {}): AttemptReport => {
    const a: AttemptReport = { ...base, ...extra, outcome: 'refused', failure: { class: failure.class, stage: failure.stage, reason: failure.reason, data: failureData(failure) } };
    const m: AttemptMeta = { committed: [], failure };
    record(a, m);
    if (original) {
     issue({ attempt: id, reason: 'handler_failed', ...(x.owner ? { owner: x.owner } : {}), data: { handler: table.id, original_reason: original.failure.class, original_attempt: original.attempt.id, detail: failure.detail } });
     return a;
    }
    // The effective view's key: a policy execution's workflow ID is its policy ID.
    const handler = defs.handlers[`${isPolicy(snap) ? 'policy' : 'workflow'}:${workflow.id}/table:${table.id}`]?.[failure.class];
    const handlerTable = handler && tableById(defs, workflow, handler.table);
    if (!handlerTable) { issue({ attempt: id, reason: failure.class, ...(x.owner ? { owner: x.owner } : {}), data: { detail: `no effective ${failure.class} handler for ${table.id}: ${failure.detail}` } }); return a; }
    if (!spend(event.root)) { quarantine(event, `handler ${handlerTable.id} for ${id}`); return a; }
    const verifiedRequest = event.type === 'decision.requested' && provenRequests.has(event.id) ? a.request : undefined;
    const failed = failureEvent(event, x, a, failure, accepted ?? verifiedRequest);
    seen.set(failed.id, failed);
    admitted.add(failed.id);
    generated.add(failed.id);
    verifiedDecisionActors.set(failed.id, verifiedDecisionActors.get(event.id) ?? event.actor);
    const h = attempt(failed, x, defs, workflow, handlerTable, `${id}/handler`, { attempt: a, failure });
    a.handled_by = h.id;
    m.handler = handlerTable.id;
    return a;
   };

   // Entry requirements gate the first table even if its guard and effects never happen to read a missing input.
   // A top-level shell retains the unresolved attempt, then only its authored handler may act on the known context.
   if (event.type === 'workflow.started') {
    const missing = Object.entries(workflow.inputs).flatMap(([name, decl]) =>
     decl.required === 'entry' && typeof decl.binding === 'string' && decl.binding.startsWith('entry.')
      && readSuppliedDatum(snap.bindings[decl.binding.slice('entry.'.length)]).state === 'unknown' ? [name] : []);
    if (missing.length) return refuse({ class: 'unresolved', stage: 'routing', reason: 'unresolved',
     unknown_inputs: missing, detail: `workflow ${workflow.id} needs entry ${missing.join(', ')}` });
   }

  // An attributed but unverified completion remains in work history. Its payload cannot drive a table or supply a
  // clinical decision; the table's ordinary refusal handler may still record the attempted action for review.
  if (event.type === 'task.completed') {
   const work = occurrence(event.work);
   const completion = work && historyOf(work).reports.find(r => r.event === event.id);
   if (completion?.verified === false)
    return refuse({ class: 'not_authorized', stage: 'authority', reason: 'not_authorized',
     detail: `completion ${event.id} names a performer other than its authenticated actor` });
  }

   if (event.type === 'decision.requested') {
    const p = event.payload as unknown as DecisionRequestPayload;
    if (!generated.has(event.id) && p.resume_from !== undefined)
     return refuse({ class: 'not_authorized', stage: 'authority', reason: 'not_authorized', detail: 'resume_from requires an engine-generated request caused by verified work evidence; use supersedes for a direct clinical request' }, { request: event.id });
    const source = event.caused_by === undefined ? undefined : seen.get(event.caused_by);
    const inherited = source && (verifiedDecisionActors.get(source.id) ?? source.actor);
    const attribution = event.receipt.actor_attribution;
    const proven = generated.has(event.id)
     ? (p.resume_from === undefined && source !== undefined && event.caused_by === p.source_event && sameJson(p.actor, inherited))
      || (source !== undefined && resumes(event, p, source))
     : sameJson(p.actor, event.actor) || (attribution !== undefined && sameJson(p.actor, attribution.actor) && p.source_event === attribution.source_event);
    if (!proven) {
     const detail = `decision actor is not attributable to the authenticated action ${p.source_event}`;
     return refuse({ class: 'not_authorized', stage: 'authority', reason: 'not_authorized', detail },
      { request: event.id, authority: { decision: 'not_authorized', reason: detail } });
    }
    verifiedDecisionActors.set(event.id, p.actor);
    provenRequests.add(event.id);
   }
   if (event.type === 'decision.requested' && table.on.table !== undefined) {
    const p = event.payload as unknown as DecisionRequestPayload;
    const problem = table.request ? requestProblem(table.request, p) : `${table.id} declares no request contract`;
    if (problem) return refuse({ class: 'invalid_transition', stage: 'routing', reason: 'invalid_transition', detail: problem }, { request: event.id });
    const referenceProblem = table.request && requestReferenceProblem(table.request, p, event.scope.patient);
    if (referenceProblem) return refuse({ class: 'invalid_transition', stage: 'routing', reason: 'binding_conflict', detail: referenceProblem }, { request: event.id });
    if (p.step !== snap.state) return refuse({ class: 'invalid_transition', stage: 'routing', reason: 'invalid_transition', detail: `request step ${p.step} is not the current state ${snap.state}` }, { request: event.id });
    if (table.purpose === 'clinical_decision') {
     const state = workflow.states.find(s => s.id === snap.state)!;
     const authority = checkAuthority({ state, workflow: workflow.id, actor: p.actor, mode: event.mode, content: defs.protocol.content, trust, at: now });
     if (authority.decision !== 'granted') return refuse({ class: 'not_authorized', stage: 'authority', reason: 'not_authorized', detail: authority.reason }, { request: event.id, authority });
    }
    const acceptance = slots.accept(snap.id, snap.activation, event.id, p);
    if (!acceptance.ok) return refuse({ class: 'invalid_transition', stage: 'routing', reason: acceptance.reason, detail: acceptance.detail, ...(acceptance.expected ? { expected: acceptance.expected } : {}), ...(acceptance.actual ? { actual: acceptance.actual } : {}) }, { request: event.id });
    accepted = event.id;
    requestInfo.set(event.id, { execution: snap.id, activation: snap.activation, table: p.table, actor: p.actor, fixed: p.fixed });
   }
   const requestTables = workflow.tables.filter(t => t.request).map(t => t.id);
   const missingEntryRoots = Object.values(workflow.inputs).flatMap(decl => {
    if (typeof decl.binding !== 'string' || !decl.binding.startsWith('entry.')) return [];
    const name = decl.binding.slice('entry.'.length);
    return Object.hasOwn(snap.bindings, name) ? [] : [[name, { unknown: 'absent' }] as const];
   });
   const snapshot = pinSnapshot({
    attempt: id,
    roots: { ...Object.fromEntries(missingEntryRoots), ...snap.bindings, ...handleViews(x), entry: snap.bindings, event: eventView(event),
     this_execution: { ...executionRef(snap), activation: snap.activation, requests: slots.view(snap.id, snap.activation, requestTables) } as unknown as JsonValue },
    ...(table.aliases ? { aliases: table.aliases } : {}),
    objects: world.objects, pending_stages: world.pendingStages.map(h => h.subject),
    stage_records: registry.list().flatMap(p => Object.entries({ ...p.catalog.records, ...p.document.definitions?.records })
     .flatMap(([record, contract]) => contract.stage && contract.subject ? [{ subject: contract.subject, record }] : [])),
    confirmed_stages: world.confirmedStages.flatMap(c => registry.list().flatMap(p => Object.entries({ ...p.catalog.records, ...p.document.definitions?.records })
     .filter(([, contract]) => contract.stage && contract.subject === c.subject.type).map(([record]) => ({ ...c, record })))),
    history: clinicalHistory,
    registries,
    execution_records: world.records.filter(r => r.execution === snap.id).map(r => ({ record: r.record })),
    ...(defs.doc.definitions?.content ? { content: defs.doc.definitions.content } : {}),
   });
   const shared = sharedInputs(defs.doc, workflow, table);
   const decls = { ...shared, ...workflow.inputs, ...table.inputs };
   const inputs: Record<string, ResolvedInput> = { ...resolveInputs(shared, snapshot), ...resolveInputs(workflow.inputs, snapshot), ...resolveInputs(table.inputs ?? {}, snapshot) };
   const parameters: Record<string, ResolvedInput> = Object.fromEntries(Object.entries(defs.doc.definitions?.parameters ?? {})
    .map(([name, parameter]) => [name, { state: 'known', value: parameter.value }]));
   const sources = { ...parameters, ...inputs };
   const concepts = conceptsOf({ ...defs.doc.definitions?.parameters, ...decls });
   const calculations = { ...defs.doc.definitions?.calculations, ...workflow.calculations };
   const needed = tableNamesRead(table).filter(name => Object.hasOwn(calculations, name) && !Object.hasOwn(sources, name));
   const values = withPaths({ ...sources, ...evaluateCalculations(calculations, sources, concepts, needed, {
    path: name => Object.hasOwn(snapshot.roots, name.split('.')[0]) || Object.hasOwn(snapshot.aliases ?? {}, name.split('.')[0])
     ? readPath(snapshot, name) : { state: 'unknown', reason: 'absent', detail: `${name} is not bound` },
    occurrence: ref => {
     const w = occurrence(ref), patient = w && patientOfObject(w.subject, snapshot.objects ?? []);
     return w && patient === event.scope.patient ? w : undefined;
    },
   }) }, snapshot, table.rules.map(r => r.when));
   const evaluation = evaluateTable(table, snap.state, values, concepts);
   const selection = evaluation.selection;
   const selectedRule = selection?.result === 'selected' ? table.rules.find(r => r.id === selection.rule) : undefined;
   const resources = resourceReads([...Object.keys(evaluation.read), ...(selectedRule
    ? tableNamesRead({ ...table, rules: [{ ...selectedRule, when: 'true' }] }) : [])], decls, inputs, calculations, event);
   const seen_ = { row_truth: evaluation.row_truth, ...(selection ? { selection } : {}), resolved: inputs,
    ...(Object.keys(resources).length ? { resources } : {}), ...(accepted ? { request: accepted } : {}) };
   if (!selection) return refuse({ class: 'invalid_transition', stage: 'routing', reason: 'not_enabled', detail: `no row of ${table.id} is enabled in ${snap.state}` }, seen_);
   if (selection.result !== 'selected') return refuse({
    class: selection.result, stage: 'selection', reason: selection.result, detail: `${table.id} is ${selection.result}`,
    ...(selection.result === 'unresolved' ? { unknown_inputs: selection.unknown_inputs } : selection.result === 'ambiguous' ? { conflict: selection.conflict } : {}),
   }, seen_);
   const rule = table.rules.find(r => r.id === selection.rule)!;
   let authority: AttemptReport['authority'];
   if (table.purpose === 'clinical_decision' || protectedEffects(rule.effects, defs.doc, defs.protocol.catalog).length) {
    const state = workflow.states.find(s => s.id === snap.state)!;
    const actor = event.type === 'decision.requested' ? (event.payload as unknown as { actor: TrustedEvent['actor'] }).actor : event.actor;
    authority = checkAuthority({ state, workflow: workflow.id, actor, mode: event.mode, content: defs.protocol.content, trust, at: now });
    if (authority.decision !== 'granted') return refuse({ class: 'not_authorized', stage: 'authority', reason: 'not_authorized', detail: authority.reason }, { ...seen_, authority });
   }
   const ctx: AttemptContext = { protocol: defs.protocol, contents: registry, trust, world, execution: x, event, attempt: id, now, snapshot, values, inputs: decls };
   const plan = preflight(rule.effects, ctx);
   if ('failure' in plan) return refuse(plan.failure, { ...seen_, ...(authority ? { authority } : {}) });
   const applied = applyPlan(world, x, plan, rule.to, { event: event.id, at: now });
   // Work commissioned while handling a failed request serves that request; the engine binds it, not the content.
   const served = original && generated.has(event.id) ? (event.payload as unknown as FailurePayload).request : undefined;
   for (const w of applied.work) { const h = historyOf(w); if (served && !applied.changes.some(c => c.after === w)) h.request = served; }
   for (const c of applied.changes) {
    if (c.note.noop) continue;
    const h = historyOf(c.after);
    h.revisions.push(c.before);
    if (c.note.cancellation) h.cancellations.push(c.note.cancellation as WorkHistory['cancellations'][number]);
    if (c.note.retried !== undefined) h.dispatches.push({ attempt: id, at: now, retried: c.note.retried });
    if (c.note.evidence !== undefined) h.reports.push({ event: event.id, type: 'change_work.satisfy', actor: event.actor, disposition: 'applied', evidence: c.note.evidence });
   }
   if (applied.activation) slots.retire(snap.id, applied.activation.from, `left activation ${applied.activation.from} by rule ${rule.id}`);
   if (accepted) slots.consume(snap.id, snap.activation, table.id, accepted);
   const a: AttemptReport = { ...base, ...seen_, ...(authority ? { authority } : {}), outcome: 'committed' };
   record(a, { committed: applied.effects.map(e => e.effect) });
   for (const e of applied.effects) {
    report.committed.push({ attempt: id, effect: e.effect, kind: e.kind, result: e.result });
    if (e.kind !== 'record' && e.kind !== 'change_work') report.intents.push({ attempt: id, effect: e.effect, kind: e.kind,
     ...(e.kind === 'publish' ? { record: e.record, to: e.to, owner: e.owner } : {}),
     ...(isWorkRef(e.result) && e.kind !== 'start' && e.kind !== 'emit' && applied.work.some(w => sameRef({ ...w.ref }, e.result)) ? { work: e.result } : {}), ...(e.kind === 'emit' ? { event: (e.result as { id: Id }).id } : {}) });
   }
   // Each new occurrence records the exact content, rule and effect that created it, and runs its pinned policy from
   // that same content as its own execution, independent of the commissioner's state.
   for (const w of applied.work) if (!applied.changes.some(c => c.after === w)) {
    const { effect, reissue_of } = applied.effects.find(e => isWorkRef(e.result) && e.result.id === w.ref.id && e.result.occurrence === w.ref.occurrence)!;
    historyOf(w).origin = { content: defs.protocol.content, workflow: workflow.id, table: table.id, rule: rule.id, effect, execution: snap.id, event: event.id, attempt: id, ...(reissue_of ? { reissue_of } : {}) };
    const declared = rule.effects.find(e => e.id === effect), own = declared && 'performer' in declared ? declared.performer : undefined;
    // A reissue keeps the performer its completed occurrence resolved; it does not read the execution's bindings again.
    const performer = reissue_of ? world.history.get(workKey(reissue_of))?.performer
     : resolvePerformer(own ?? (w.kind === 'task' ? defs.templates[w.template]?.performer : undefined), snap.bindings);
    if (performer !== undefined) historyOf(w).performer = performer;
    const policy = defs.policies[w.policy.id];
    if (!policy || policy.revision !== w.policy.revision) continue;
    const ref = { id: w.ref.id, occurrence: w.ref.occurrence }, pid = nextIdentity(world, 'PW');
    world.executions.set(pid, {
     snapshot: { id: pid, content: snap.content, workflow: policy.id, state: policy.initial, activation: 'A1', bindings: { work: ref, origin: executionRef(snap) as unknown as JsonValue, owner: w.owner as unknown as JsonValue } },
     retained: [], processed: new Set(), handles: { work: ref }, previous: {}, activations: 1, owner: w.owner, lifetime: 'independent',
    });
   }
   // A due already reached at this commit is delivered now, in this root; it never resets the step budget.
   for (const w of applied.work) if (w.due?.at && OUTSTANDING.has(w.status) && !fired.has(dueKey(w)) && compareTimes(w.due.at, now) !== 1) applied.deliver.push(dueEvent(w, event));
   // An end keeps the last position and announces itself with the outstanding execution-lifetime work. The
   // announcement keeps the case identity of the event that ended the execution.
   if ('end' in rule.to) {
    const ended = x.snapshot, outstanding = world.work.filter(w => w.commissioned_by.id === ended.id && w.lifetime === 'execution' && OUTSTANDING.has(w.status))
     .map(w => ({ id: w.ref.id, occurrence: w.ref.occurrence }));
    const announce: TrustedEvent = {
     id: `${event.id}/${ended.id}/ended`, type: 'workflow.ended', occurrence: `${ended.id}/ended`,
     scope: { patient: event.scope.patient, ...(ended.subject ? { subject: ended.subject } : {}), ...(event.scope.cases ? { cases: event.scope.cases } : {}) },
     actor: ENGINE_ACTOR, occurred_at: now, received_at: now, mode: event.mode,
     payload: { outcome: rule.to.end, outstanding_work: outstanding }, caused_by: event.id, root: event.root, receipt: { id: `internal:${event.id}/${ended.id}/ended` },
    };
    endings.set(announce.id, executionRef(ended));
    outstandingAtEnd.set(ended.id, outstanding);
    applied.deliver.push(announce);
   }
   for (const child of applied.deliver) generated.add(child.id);
   report.generated.push(...structuredClone(applied.deliver));
   queue.push(...applied.deliver);
   return a;
  }

  const quarantine = (event: TrustedEvent, what: string) => {
   if (report.quarantined.length === 0) issue({ reason: 'step_limit_exhausted', data: { root: event.root, limit: trust.max_internal_steps, processed: steps.get(event.root) ?? 0, blocked: what } });
   report.quarantined.push(event.id);
  };

  /**
   * A work report updates its exact occurrence once, before routing. A rejected report is an attributed issue and routes
   * nowhere; a redelivery changes nothing again.
   */
  /** Reports that arrived after a terminal fact: they reach only the occurrence's own policy, never a workflow table. */
  const late = new Set<Id>();
  const ingestReport = (event: TrustedEvent): boolean => {
   // The result is checked against the templates of the content that commissioned the reported occurrence.
   const templates = contentOf(occurrence(event.work)?.commissioned_by.content)?.templates ?? {};
   const checked = checkWorkReport(event, {
    work: world.work, templates, objects: world.objects, patientOf: ref => patientOfObject(ref, world.objects),
    cancellations: event.work ? world.history.get(workKey(event.work))?.cancellations ?? [] : [],
   });
   if (!checked.accepted) {
    issue({ reason: checked.reason, ...(checked.work ? { owner: checked.work.owner } : {}), data: { event: event.id, ...(event.work ? { work: { id: event.work.id, occurrence: event.work.occurrence } } : {}), detail: checked.detail } });
    return false;
   }
   const i = world.work.findIndex(w => w.ref.id === checked.work.ref.id && w.ref.occurrence === checked.work.ref.occurrence);
   world.work[i] = checked.work;
   historyOf(checked.work).reports.push(checked.report);
   if (checked.report.disposition === 'late') late.add(event.id);
   report.ingested.push(...checked.facts);
   return true;
  };
  /** A due event counts once for its occurrence's current due revision; a stale or terminal one is retained and routes nowhere. */
  const ingestDue = (event: TrustedEvent): boolean => {
   const w = occurrence(event.work);
   if (!w) { issue({ reason: 'binding_conflict', data: { event: event.id, detail: `no work occurrence for ${event.id}` } }); return false; }
   const current = isMap(event.payload) && event.payload.due_revision === w.due?.revision && OUTSTANDING.has(w.status);
   historyOf(w).reports.push({ event: event.id, type: event.type, actor: event.actor, root: event.root, disposition: current ? 'applied' : 'stale' });
   if (current) fired.add(dueKey(w));
   return current;
  };
  if (!ingress.redelivery && isWorkReport(first.type) && !ingestReport(first)) return done(first);
  if (!ingress.redelivery && first.type === 'work.due' && !ingestDue(first)) return done(first);
  admitted.add(first.id);

  for (let i = 0; i < queue.length; i++) {
   const event = queue[i];
   if (i > 0) {
    if (!spend(event.root)) { quarantine(event, event.id); continue; }
    seen.set(event.id, event);
    if (isWorkReport(event.type) && !ingestReport(event)) continue;
    if (event.type === 'work.due' && !ingestDue(event)) continue;
    admitted.add(event.id);
   }
   for (const x of [...world.executions.values()].sort((a, b) => a.snapshot.id < b.snapshot.id ? -1 : a.snapshot.id > b.snapshot.id ? 1 : 0)) {
    // Resolved at each dispatch from exactly the content this execution pins; every execution's content is available.
    const defs = contentOf(x.snapshot.content), workflow = defs && workflowOf(x.snapshot);
    if (!defs || !workflow || (late.has(event.id) && !isPolicy(x.snapshot))) continue;
    if (!isPolicy(x.snapshot) && !x.snapshot.subject && (event.type !== 'workflow.started' || event.target?.execution !== x.snapshot.id)) continue;
    const r = route(event, x.snapshot, workflow, { patient: patientOfExecution(x.snapshot), processed: x.processed, handles: x.handles, ended: endings.get(event.id) });
    if (!r) continue;
    const id = `${event.id}@${x.snapshot.id}`, base = { id, event: event.id, execution: x.snapshot.id, activation: x.snapshot.activation };
    // A duplicate belongs to this delivery's report. It is not a new evaluated attempt and must not replace the
    // original attempt's metadata or its observable refusal.
    if (r.outcome === 'duplicate') { report.attempts.push({ ...base, routing: 'duplicate', outcome: 'duplicate' }); continue; }
    if (r.outcome === 'unsubscribed') { record({ ...base, routing: 'unsubscribed', outcome: 'unsubscribed' }, { committed: [] }); continue; }
    x.processed.add(event.id);
    if (r.outcome === 'rejected') {
     record({ ...base, routing: 'rejected', outcome: 'rejected' }, { committed: [] });
     issue({ attempt: id, reason: r.reason, ...(x.owner ? { owner: x.owner } : {}), data: { detail: r.detail } });
     continue;
    }
    const declaredResult = defs.protocol.catalog.events[event.type]?.payload.result;
    if (declaredResult) {
     const result = event.payload.result;
     const objectResult = declaredResult.type.type === 'reference' && declaredResult.type.target.startsWith('object:');
     const problem = result === undefined ? (declaredResult.optional ? undefined : 'missing result')
      : typeError(declaredResult.type, result) ?? (objectResult
       ? referenceProblem(result, declaredResult.type, world.objects, ref => patientOfObject(ref, world.objects), event.scope.patient)
        ?? (patientOfObject(result as unknown as { type: Id; id: Id }, world.objects) === event.scope.patient ? undefined : 'result patient is not established')
       : undefined);
     const current = objectResult && isMap(result) ? world.objects.find(o => o.type === result.type && o.id === result.id && o.superseded_by === undefined) : undefined;
     const reason = problem ? 'binding_conflict' : objectResult && result !== undefined && isMap(result) && result.revision !== current?.revision ? 'revision_conflict' : undefined;
     if (reason) {
      record({ ...base, routing: 'rejected', outcome: 'rejected' }, { committed: [] });
      issue({ attempt: id, reason, ...(x.owner ? { owner: x.owner } : {}), data: { event: event.id,
       detail: problem ?? (isMap(result) ? `result ${result.type}:${result.id} must name its current object revision` : 'result must name its current object revision') } });
      continue;
     }
    }
    if (r.outcome === 'not_enabled') {
     x.retained.push(event.id);
     record({ ...base, ...(r.tables.length === 1 ? { table: r.tables[0] } : {}), routing: 'not_enabled', outcome: 'not_enabled' }, { committed: [] });
     continue;
    }
    if (r.outcome === 'ambiguous_routing') {
     x.retained.push(event.id);
     const failure: Failure = { class: 'invalid_transition', stage: 'routing', reason: 'invalid_transition', detail: `tables ${r.tables.join(', ')} are all enabled for ${event.type}`, conflict: r.tables };
     record({ ...base, outcome: 'refused', failure: { class: failure.class, stage: failure.stage, reason: failure.reason, data: failureData(failure) } }, { committed: [], failure });
     issue({ attempt: id, reason: 'invalid_transition', ...(x.owner ? { owner: x.owner } : {}), data: { detail: failure.detail } });
     continue;
    }
    attempt(event, x, defs, workflow, r.table, id);
   }
  }
  return done(first);
 }

 /**
  * The `evaluation.failed` event a handler receives: the original attempt, event, table, reason and stage. A failure on
  * an applied work report names its occurrence. Only an authority refusal of a completion that ingress verified carries
  * the refused proposal, read from that retained report, never from the event payload.
  */
 function failureEvent(event: TrustedEvent, x: ExecutionState, a: AttemptReport, f: Failure, request?: Id): TrustedEvent {
  const w = isWorkReport(event.type) ? occurrence(event.work) : undefined;
  const applied = w && world.history.get(workKey(w.ref))?.reports.find(r => r.event === event.id && r.disposition === 'applied');
  const proposal = applied && f.class === 'not_authorized' && f.stage === 'authority' && applied.type === 'task.completed' && applied.verified === true
   ? { actor: applied.actor, result: Object.fromEntries(Object.entries(applied.result ?? {}).map(([k, r]) => [k, r.state === 'known' ? r.value : { unknown: r.reason }])) } : undefined;
  const payload: FailurePayload = {
   attempt: a.id, event: event.id, table: a.table!, actor: event.actor, reason: f.class, ...(f.reason !== f.class ? { code: f.reason } : {}), stage: f.stage,
   ...(x.snapshot.subject ? { subject: x.snapshot.subject } : {}), ...(x.owner ? { owner: x.owner } : {}), ...(request ? { request } : {}),
   ...(applied ? { work: { id: w!.ref.id, occurrence: w!.ref.occurrence } } : {}), ...(proposal ? { report: proposal } : {}),
   ...(f.expected ? { expected_revision: f.expected } : {}), ...(f.actual ? { actual_revision: f.actual } : {}),
   ...(f.conflict ? { conflict: f.conflict } : {}), ...(f.unknown_inputs ? { unknown_inputs: f.unknown_inputs } : {}),
  };
  const id = `${a.id}/failed`;
  return {
   id, type: 'evaluation.failed', occurrence: id, scope: event.scope, actor: ENGINE_ACTOR, occurred_at: now, received_at: now, mode: event.mode,
   payload: payload as unknown as Readonly<Record<string, JsonValue>>, target: { execution: x.snapshot.id, activation: x.snapshot.activation, content: x.snapshot.content },
   caused_by: event.id, root: event.root, receipt: { id: `internal:${id}` },
  };
 }

 function observe(): Observations {
  const out: Record<string, Record<string, Observation>> = {};
  const put = (subject: string, property: string, o: Observation) => { (out[subject] ??= {})[property] = o; };
  for (const x of world.executions.values()) {
   const s = `execution:${x.snapshot.id}`;
   put(s, 'state', observed(x.snapshot.state));
   // The exact content the execution pins. An execution has no revision of its own: `revision` is its content revision.
   put(s, 'content', observed(x.snapshot.content));
   put(s, 'revision', observed(x.snapshot.content.revision));
   put(s, 'activation', observed(x.snapshot.activation));
   put(s, 'retained_events', observed(x.retained));
   put(s, 'snapshot', observed(x.snapshot));
   put(s, 'ended', x.snapshot.ended ? observed(x.snapshot.ended) : none(`${x.snapshot.id} has not ended`));
   if (outstandingAtEnd.has(x.snapshot.id)) put(s, 'ended.outstanding_work', observed(outstandingAtEnd.get(x.snapshot.id)!));
   const records = contentOf(x.snapshot.content)?.records ?? {};
   for (const name of Object.keys(records)) put(s, `committed_records.${name}`, observed(world.records.filter(r => r.execution === x.snapshot.id && r.record === name).map(r => r.fields)));
   for (const [name, ref] of Object.entries(x.handles)) if (isWorkValue(ref))
    put(s, `handle:${name}`, observed({ current: ref, previous: x.previous[name] ?? [] }));
  }
  // The original attempt of an event is its one evaluated attempt. A handler attempt belongs to its `evaluation.failed` event.
  for (const id of seen.keys()) {
   const originals = attempts.filter(a => a.event === id && a.table !== undefined && (a.outcome === 'committed' || a.outcome === 'refused'));
   put(`original_attempt:${id}`, 'committed_intents.effects', originals.length === 1 ? observed(meta.get(originals[0].id)!.committed)
    : none(originals.length ? `${id} has ${originals.length} evaluated attempts` : `${id} has no evaluated attempt`));
  }
  const handlerTables = new Set(registry.list().flatMap(p => Object.values(contentOf(p.content)!.handlers)).flatMap(h => Object.values(h).map(v => v!.table)));
  for (const a of attempts) {
   if (!a.table || a.id.endsWith('/handler')) continue;
   const s = `table:${a.table}`, m = meta.get(a.id)!;
   put(s, 'attempt.result', observed(m.failure?.class ?? (a.outcome === 'not_enabled' ? 'not_enabled' : a.selection?.result ?? a.outcome)));
   put(s, 'attempt.failure.reason', m.failure ? observed(m.failure.reason) : none(`${a.id} did not fail`));
   put(s, 'selection.result', a.selection ? observed(a.selection.result) : none(`${a.id} selected no row`));
   put(s, 'selection.unknown_inputs', a.selection?.result === 'unresolved' ? observed(a.selection.unknown_inputs) : none(`${a.id} is not unresolved at selection`));
   put(s, 'row_truth', a.row_truth ? observed(a.row_truth) : none(`${a.id} evaluated no row`));
   put(s, 'handler.invoked', m.handler && m.failure ? observed({
    table: m.handler, reason: m.failure.class, ...(m.failure.unknown_inputs?.length ? { missing: m.failure.unknown_inputs } : {}), ...(m.failure.effect ? { effect: m.failure.effect } : {}),
   }) : none(`${a.id} invoked no handler`));
  }
  for (const h of handlerTables) {
   const runs = attempts.filter(a => a.table === h && a.id.endsWith('/handler'));
   put(`handler:${h}`, 'invocation_count', observed(runs.length));
   put(`handler:${h}`, 'committed_intents.effects', runs.length ? observed(meta.get(runs[runs.length - 1].id)!.committed) : none(`${h} was not invoked`));
  }
  for (const w of world.work) {
   const s = `work-ref:${workKey(w.ref)}`, h = historyOf(w);
   put(s, 'status', observed(w.status));
   put(s, 'template', observed({ kind: w.kind, template: w.template }));
   put(s, 'owner', observed(w.owner));
   put(s, 'revision', observed(w.ref.revision));
   put(s, 'occurrence', observed(w.ref.occurrence));
   put(s, 'content', observed(w.content ?? {}));
   put(s, 'due', w.due?.at ? observed(w.due.at) : none(`${w.ref.id} has no due instant`));
   // The due form: `deadline` for a due instant, `window` for a due window, null for work without a due.
   put(s, 'due.kind', w.due === undefined ? observed(null) : w.due.at !== undefined ? observed('deadline') : w.due.window !== undefined ? observed('window')
    : none(`the due of ${w.ref.id} has neither an instant nor a window`));
   put(s, 'performer', h.performer !== undefined ? observed(h.performer) : none(`${w.ref.id} has no performer resolved in this run`));
   // The failed report each redispatch of this occurrence answered, oldest first. Seeded dispatches are not in the run.
   put(s, 'retries', observed(h.dispatches.map(d => d.retried)));
   // The anchor of the current due: the reference binding it read through, spelled by its object ID, at the revision read.
   put(s, 'anchor', w.due?.anchor ? observed({ [w.due.anchor.binding]: w.due.anchor.object.id, revision: w.due.anchor.object.revision })
    : none(`the due of ${w.ref.id} read no object revision`));
   // The exact content, rule and effect whose committed attempt created the occurrence.
   put(s, 'provenance', h.origin ? observed({ protocol: h.origin.content.protocol, revision: h.origin.content.revision, identity: h.origin.content.identity,
    workflow: h.origin.workflow, table: h.origin.table, rule: h.origin.rule, effect: h.origin.effect, execution: h.origin.execution, event: h.origin.event, attempt: h.origin.attempt,
    ...(h.origin.reissue_of ? { reissue_of: h.origin.reissue_of } : {}) })
    : none(`${w.ref.id} was not created in this run`));
   const completion = h.reports.find(r => r.type === 'task.completed' && r.disposition === 'applied' && r.verified === true)
    ?? h.reports.find(r => r.type === 'task.completed' && r.disposition === 'applied');
   put(s, 'completion', completion ? observed({
    event: completion.event, actor: completion.actor, verified: completion.verified ?? false, evidence: completion.evidence ?? null,
    result: Object.fromEntries(Object.entries(completion.result ?? {}).map(([f, r]) => [f, r.state === 'known' ? r.value : { unknown: r.reason }])),
   }) : none(`${w.ref.id} has no applied completion`));
   put(s, 'reports', observed(h.reports.map(r => ({ event: r.event, type: r.type, disposition: r.disposition }))));
   put(s, 'revisions', observed(h.revisions.map(v => ({ revision: v.ref.revision, status: v.status, owner: v.owner, ...(v.due ? { due: v.due } : {}) }))));
   put(s, 'cancellations', observed(h.cancellations));
   const evidence = h.reports.find(r => r.disposition === 'applied' && r.evidence !== undefined
    && (r.verified === true || r.type === 'change_work.satisfy'));
   put(s, 'completion_evidence', evidence ? observed(evidence.evidence) : none(`${w.ref.id} has no accepted completion evidence`));
   put(s, 'received_events', observed(h.reports.map(r => ({ event: r.event, type: r.type, ...(r.root ? { root: r.root } : {}) }))));
  }
  const workIdCounts = new Map<string, number>();
  for (const w of world.work) workIdCounts.set(w.ref.id, (workIdCounts.get(w.ref.id) ?? 0) + 1);
  for (const w of world.work) if (workIdCounts.get(w.ref.id) === 1) out[`work:${w.ref.id}`] = out[`work-ref:${workKey(w.ref)}`];
  put('runtime', 'operational_issues', observed(issues));
  put('runtime', 'available_contents', observed(registry.list().map(p => p.content)));
  // Each host object's revisions, oldest first, with the event whose host-attested revision superseded each one.
  for (const o of world.objects) {
   const s = `object:${o.type}:${o.id}`, prior = out[s]?.revisions;
   const list = prior?.status === 'observed' && Array.isArray(prior.value) ? prior.value : [];
   put(s, 'revisions', observed([...list, { revision: o.revision, ...(o.superseded_by !== undefined ? { superseded_by: o.superseded_by, event: o.superseded_event ?? null } : {}) }]));
   if (o.superseded_by === undefined) put(s, 'fields', observed(o.fields));
  }
  return out;
 }

 /**
  * Check and apply the object revisions the host attests with an event, all or none. Each names a declared object type,
  * types every field by the host object contract, belongs to the event's patient and never moves an object to another
  * patient. A revision is immutable: reusing one is a conflict. A redelivery applies nothing again; the revisions its
  * receipt carries, if any, must be exactly those of the original delivery.
  */
 function applyHostObjects(event: TrustedEvent, received: TrustedEvent['receipt']['objects'], redelivery: boolean, report: { ingested: Fact[] }): { reason: 'binding_conflict' | 'event_identity_conflict'; detail: string } | undefined {
  const supplied = received ?? [];
  if (redelivery) return received === undefined || sameJson(supplied, hostObjects.get(event.id) ?? []) ? undefined
   : { reason: 'event_identity_conflict', detail: `a redelivery of ${event.id} carries other host object revisions than its original delivery` };
  const conflict = (detail: string) => ({ reason: 'binding_conflict' as const, detail });
  const staged: { object: ScenarioObject; current?: World['objects'][number] }[] = [];
  for (const o of supplied) {
   const contract = isMap(o as unknown as JsonValue) && typeof o.type === 'string' && Object.hasOwn(host, o.type) ? host[o.type] : undefined;
   if (!contract || typeof o.id !== 'string' || !o.id || typeof o.revision !== 'string' || !o.revision || !isMap(o.fields))
    return conflict(`a host object revision of ${event.id} names no declared object type, ID, revision and fields`);
   if (o.superseded_by !== undefined || o.superseded_event !== undefined)
    return conflict(`a new host object revision cannot supply supersession metadata`);
   const name = `${o.type}:${o.id}@${o.revision}`;
   for (const [f, d] of Object.entries(contract.fields)) {
    if (!Object.hasOwn(o.fields, f)) { if (!d.optional) return conflict(`${name} has no ${f}`); continue; }
    const error = typeError(d.type, o.fields[f]);
    if (error) return conflict(`${name} field ${f} is ${error}`);
   }
   const extra = Object.keys(o.fields).find(f => !Object.hasOwn(contract.fields, f));
   if (extra !== undefined) return conflict(`${name} has the undeclared field ${extra}`);
   const revisions = world.objects.filter(x => x.type === o.type && x.id === o.id), current = revisions.find(x => x.superseded_by === undefined);
   if (revisions.some(x => x.revision === o.revision)) return conflict(`${name} already exists; a revision is immutable`);
   if (staged.some(x => x.object.type === o.type && x.object.id === o.id)) return conflict(`${event.id} attests ${o.type} ${o.id} twice`);
   staged.push({ object: structuredClone(o), ...(current ? { current } : {}) });
  }
  // Check the fully typed receipt as one batch. A new intervention can inherit its patient through a care plan in
  // the world or in this receipt, while a revised object's former patient must still match.
  const candidateObjects = [...world.objects, ...staged.map(x => x.object)];
  for (const { object, current } of staged) {
   const name = `${object.type}:${object.id}@${object.revision}`;
   const patient = patientOfObject(object, candidateObjects);
   if (patient !== event.scope.patient) return conflict(`${name} is not an object of the event patient ${event.scope.patient}`);
   if (current && patientOfObject(current, world.objects) !== patient) return conflict(`${name} would move ${object.type} ${object.id} to another patient`);
  }
  for (const { object, current } of staged) {
   if (current) { current.superseded_by = object.revision; current.superseded_event = event.id; }
   world.objects.push(structuredClone(object));
   report.ingested.push({ id: `${object.type}:${object.id}`, revision: object.revision,
    value: { state: 'known', value: structuredClone(object.fields) as JsonValue, source: `${object.type}:${object.id}`, revision: object.revision },
    provenance: { event: event.id, actor: event.actor, source: 'host' } });
  }
  hostObjects.set(event.id, structuredClone(supplied));
  return undefined;
 }

 /**
  * Let time pass to `instant`: deliver each due timer reached on the way, earliest first, each as a new root after a
  * real wait. A rescheduled occurrence fires only its current due revision; terminal work fires nothing.
  */
 function advanceTo(instant: Instant): StepReport[] {
  const reports: StepReport[] = [];
  for (;;) {
   const due = world.work.filter(w => w.due?.at && OUTSTANDING.has(w.status) && !fired.has(dueKey(w)) && compareTimes(w.due.at, instant) !== 1)
    .sort((a, b) => compareTimes(a.due!.at!, b.due!.at!) || (a.ref.id < b.ref.id ? -1 : 1))[0];
   if (!due) break;
   if (compareTimes(due.due!.at!, now) === 1) now = due.due!.at!;
   // Marked before delivery: a timer is offered once even if its delivery is refused.
   fired.add(dueKey(due));
   reports.push(dispatch(dueEvent(due), 'engine'));
  }
  if (compareTimes(instant, now) === 1) now = instant;
  return reports;
 }

 /** Redeliver a known event by ID; the caller never supplies the event's bytes. */
 function redeliver(id: Id, receipt: Id): StepReport {
  const known = seen.get(id);
  if (!known) {
   const failure: Issue = { reason: 'event_identity_conflict', data: { event: id, detail: `${id} was never received or emitted by this harness` } };
   issues.push(failure);
   return { event: id, root: id, ingested: [], attempts: [], committed: [], intents: [], generated: [], failures: [failure], retained: world.work.filter(w => OUTSTANDING.has(w.status)) };
  }
  return dispatch({ ...known, receipt: { id: receipt } }, 'engine');
 }

 // The boundary: each event a caller passes in is copied before it is kept, and each report is a copy the caller owns.
 return {
  dispatch: event => structuredClone(dispatch(structuredClone(event))),
  redeliver: (id, receipt) => structuredClone(redeliver(id, receipt)),
  advanceTo: instant => structuredClone(advanceTo(instant)),
  observe,
  deploy: protocol => registry.deploy(protocol),
  compare: (from, to) => registry.compare(from, to),
 };
}

const isWorkRef = (v: JsonValue): v is { id: string; occurrence: string } => isMap(v) && typeof v.id === 'string' && typeof v.occurrence === 'string';
/**
 * The shared `definitions.inputs` a table reads, directly or through the calculations it reads, in the validator's name
 * order: a table or workflow input, then a workflow calculation, then a shared input, then a shared calculation.
 */
function sharedInputs(doc: ProtocolDocument, workflow: Workflow, table: Table): Record<string, InputDecl> {
 const shared = doc.definitions?.inputs ?? {}, own = workflow.calculations ?? {}, calculations = { ...doc.definitions?.calculations, ...own };
 const out: Record<string, InputDecl> = {}, seen = new Set<string>(), todo = tableNamesRead(table);
 for (let name; (name = todo.pop()) !== undefined;) {
  if (seen.has(name) || Object.hasOwn(table.inputs ?? {}, name) || Object.hasOwn(workflow.inputs, name)) continue;
  seen.add(name);
  if (!Object.hasOwn(own, name) && Object.hasOwn(shared, name)) out[name] = shared[name];
  else if (Object.hasOwn(calculations, name)) todo.push(...calculationNamesRead(calculations[name]));
 }
 return out;
}
/** The JSON evidence of a failure in its attempt report. */
const failureData = (f: Failure): Readonly<Record<string, JsonValue>> => ({
 detail: f.detail, ...(f.effect ? { effect: f.effect } : {}), ...(f.unknown_inputs ? { unknown_inputs: [...f.unknown_inputs] } : {}),
 ...(f.conflict ? { conflict: [...f.conflict] } : {}), ...(f.expected ? { expected: f.expected } : {}), ...(f.actual ? { actual: f.actual } : {}),
 ...(f.work ? { work: { id: f.work.id, occurrence: f.work.occurrence,
  ...(f.work.revision !== undefined ? { revision: f.work.revision } : {}) } } : {}),
});
