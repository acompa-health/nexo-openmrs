/**
 * Work reports on ingestion, before routing. A completion, failure or cancellation report names the exact work occurrence
 * `(id, occurrence)`. It is checked against that occurrence: patient, subject, completion evidence, and the result of the
 * template captured on it. A verified report updates the work's factual projection once. It approves nothing, consumes no
 * request and changes no state. A report that fails a check is rejected with an attributed reason and routes nowhere.
 * An unverified completion stays attributed without closing the obligation or supplying usable result facts. A later
 * verified report may complete it. A later report never overwrites the first terminal fact: it stays in the occurrence's history as late. A failure report
 * while a cancellation request is outstanding is applied but leaves the work `cancellation_requested`.
 * Source: the resolved v1 contract, "Events and state enablement", "Effects and work" and "Transfer and completion".
 */
import { STANDARD_RECORDS } from '../contracts.ts';
import type { ActorRef, ContentRef, EventId, Fact, Id, JsonValue, ObjectRef, ResolvedInput, TrustedEvent, WorkRef, WorkSnapshot, WorkTemplate } from '../types.ts';
import { readSuppliedDatum } from '../contracts.ts';
import { sameJson, sameRef } from './events.ts';
import { typeError } from './facts.ts';
import type { WorkTemplateOf } from './facts.ts';

const isRecord = (v: unknown): v is Readonly<Record<string, JsonValue>> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const WORK_REPORTS = ['task.completed', 'work.failed', 'work.cancelled'] as const;
export const isWorkReport = (type: Id) => (WORK_REPORTS as readonly string[]).includes(type);
export const workKey = (w: Pick<WorkRef, 'id' | 'occurrence'>) => JSON.stringify([w.id, w.occurrence]);

/**
 * One report retained on its occurrence. `applied` was ingested as current (a failure during an outstanding cancellation
 * request keeps that status); `late` arrived after a terminal fact.
 */
export interface WorkReport {
 event: EventId; type: Id; actor: ActorRef;
 /** The causal root the report arrived in. */
 root?: EventId;
 /** `stale`: a due event for a due revision the work no longer has. */
 disposition: 'applied' | 'late' | 'stale';
 /** For a completion: does the evidence performer equal the authenticated actor? A mismatch stays attributed. */
 verified?: boolean;
 evidence?: JsonValue;
 /** A completion result, field by field; an invalid information value is an attributed unknown. */
 result?: Readonly<Record<string, ResolvedInput>>;
 data?: Readonly<Record<string, JsonValue>>;
}
/** The exact content, rule and effect whose committed attempt created an occurrence; for a reissue, the completed occurrence it asked again. */
export interface WorkOrigin { content: ContentRef; workflow: Id; table: Id; rule: Id; effect: Id; execution: Id; event: EventId; attempt: Id; reissue_of?: { id: Id; occurrence: Id } }
/** Engine history beside each work projection: reports, earlier revisions and the request it was commissioned for. */
export interface WorkHistory {
 /** Absent for work the scenario seeded: the run did not see its creation. */
 origin?: WorkOrigin;
 reports: WorkReport[];
 revisions: WorkSnapshot[];
 /** The decision request whose failed attempt commissioned this work, bound by the engine. */
 request?: EventId;
 /** Cancellation requests made by `change_work cancel`. */
 cancellations: { event: EventId; reason: JsonValue }[];
 /** Redispatches by `change_work retry`: the attempt that retried and the failed report it answered. */
 dispatches: { attempt: Id; at: string; retried: JsonValue }[];
 /**
  * The performer the creating effect resolved, from its own field or its template: a `{role}` as declared, or the
  * value of a performer binding. Absent for work the scenario seeded or whose effect and template name none.
  */
 performer?: JsonValue;
}

/** Resolve a work-producing effect's performer: its own field, else its template's; a binding reads the execution. */
export function resolvePerformer(spec: { role: Id } | { binding: string } | undefined, bindings: Readonly<Record<string, JsonValue>>): JsonValue | undefined {
 if (!spec) return undefined;
 return 'role' in spec ? { role: spec.role } : bindings[spec.binding];
}

export type ReportIngress =
 | { accepted: true; work: WorkSnapshot; report: WorkReport; facts: Fact[] }
 | { accepted: false; reason: 'binding_conflict' | 'missing_completion_evidence'; detail: string; work?: WorkSnapshot };

const TERMINAL = new Set<WorkSnapshot['status']>(['completed', 'cancelled']);

/** Check evidence against the work's pinned template. `delivered.value` is the captured content, not a new object. */
export function completionEvidenceProblem(evidence: JsonValue, work: WorkSnapshot, template?: WorkTemplate): string | undefined {
 if (!isRecord(evidence)) return 'no completion evidence';
 for (const [f, d] of Object.entries(STANDARD_RECORDS.completion_evidence.fields)) {
  if (!Object.hasOwn(evidence, f)) { if (!d.optional) return `completion evidence has no ${f}`; continue; }
  const error = typeError(d.type, evidence[f]);
  if (error) return `completion evidence ${f} is ${error}`;
 }
 if (typeof evidence.proof !== 'string' || !evidence.proof.trim()) return 'completion evidence needs proof';
 for (const f of Object.keys(evidence)) if (!Object.hasOwn(STANDARD_RECORDS.completion_evidence.fields, f)) return `completion evidence has the undeclared field ${f}`;
 if (!isRecord(evidence.work) || evidence.work.id !== work.ref.id || evidence.work.occurrence !== work.ref.occurrence) return `the evidence names other work than ${work.ref.id}/${work.ref.occurrence}`;
 if (!sameRef(evidence.subject, work.subject as unknown as JsonValue)) return `the evidence names another subject than work ${work.ref.id}`;
 const delivery = template?.completion.delivery;
 if (delivery) {
  const content = work.content?.[delivery.content], recipient = work.content?.[delivery.recipient];
  const delivered = evidence.delivered;
  if (content === undefined || recipient === undefined) return 'delivery work has no captured content or recipient';
  if (!isRecord(delivered) || Object.keys(delivered).length !== 1 || !Object.hasOwn(delivered, 'value')) return 'delivery evidence needs delivered.value';
  const decl = template.content?.[delivery.content];
  if (!decl || typeError(decl.type, delivered.value) || !sameJson(delivered.value, content)) return 'delivered content does not match the captured content';
  if (!sameJson(evidence.recipient, recipient)) return 'delivery recipient does not match the captured recipient';
  if (typeof evidence.channel !== 'string' || !evidence.channel.trim()) return 'delivery evidence needs a channel';
 }
 return undefined;
}

/**
 * Check one work report against the occurrence it names and say how it changes the projection. Nothing is written here.
 * `objects` resolves a result reference; `patientOf` gives the patient of the work subject.
 */
export function checkWorkReport(event: TrustedEvent, args: {
 work: readonly WorkSnapshot[]; templates: Readonly<Record<Id, WorkTemplate>>;
 objects: readonly (ObjectRef & { revision: string; fields: Readonly<Record<string, JsonValue>> })[];
 patientOf: (subject: ObjectRef) => Id | undefined;
 cancellations: readonly WorkHistory['cancellations'][number][];
}): ReportIngress {
 const conflict = (detail: string, work?: WorkSnapshot): ReportIngress => ({ accepted: false, reason: 'binding_conflict', detail, ...(work ? { work } : {}) });
 if (!event.work) return conflict(`${event.type} ${event.id} names no work occurrence`);
 const ref = event.work, work = args.work.find(w => w.ref.id === ref.id && w.ref.occurrence === ref.occurrence);
 if (!work) return conflict(`no work occurrence ${ref.id}/${ref.occurrence}`);
 const patient = args.patientOf(work.subject);
 if (patient !== undefined && patient !== event.scope.patient) return conflict(`work ${ref.id} is for patient ${patient}, not ${event.scope.patient}`, work);
 if (!event.scope.subject || !sameRef(event.scope.subject as unknown as JsonValue, work.subject as unknown as JsonValue))
  return conflict(`the report's subject is not the subject of work ${ref.id}`, work);
 const payload = isRecord(event.payload) ? event.payload : {};
 const cancellationRequest = payload.cancellation_request;
 if (event.type === 'work.cancelled' && (!isRecord(cancellationRequest) ||
     !args.cancellations.some(c => c.event === cancellationRequest.id)))
  return conflict(`cancellation report ${event.id} does not name a request for ${ref.id}/${ref.occurrence}`, work);
 const late = TERMINAL.has(work.status) || (event.type === 'work.failed' && work.status === 'failed');
 const base = { event: event.id, type: event.type, actor: event.actor, root: event.root, disposition: late ? 'late' as const : 'applied' as const };

 if (event.type !== 'task.completed') {
  const report: WorkReport = { ...base, data: payload };
  // A failed attempt is not a cancelled obligation: an outstanding cancellation request stays visible (and blocks a retry)
  // until a cancellation report closes the occurrence. The failure is still retained and heard by the policy.
  const status: WorkSnapshot['status'] = event.type === 'work.cancelled' ? 'cancelled' : work.status === 'cancellation_requested' ? work.status : 'failed';
  return { accepted: true, report, facts: [], work: late ? work : { ...work, status } };
 }
 const missing = (detail: string): ReportIngress => ({ accepted: false, reason: 'missing_completion_evidence', detail, work });
 const evidence = payload.evidence;
 const template = work.kind === 'task' ? args.templates[work.template] : undefined;
 if (work.kind === 'task' && !template) return missing(`no captured template for ${work.ref.id}`);
 const problem = completionEvidenceProblem(evidence, work, template);
 if (problem) return missing(problem);
 if (!isRecord(evidence)) return missing('no completion evidence');
 if (event.work.attempt !== undefined && event.work.attempt !== evidence.attempt) return missing('completion evidence names another attempt');

 // The result is checked against the template captured on this occurrence, never against a subscriber's view.
 const decls = template?.result ?? {};
 const raw = payload.result === undefined ? {} : payload.result;
 if (!isRecord(raw)) return conflict(`the result of ${event.id} is not a record`, work);
 for (const f of Object.keys(raw)) if (!Object.hasOwn(decls, f)) return conflict(`${work.template} declares no result ${f}`, work);
 const result: Record<string, ResolvedInput> = {}, facts: Fact[] = [];
 const templateOf: WorkTemplateOf = r => args.work.find(w => w.ref.id === r.id && w.ref.occurrence === r.occurrence)?.template;
 const provenance = { source: `work:${ref.id}/${ref.occurrence}` };
 for (const [f, d] of Object.entries(decls)) {
  if (!Object.hasOwn(raw, f)) { if (!d.optional) return missing(`the result has no ${f}, which ${work.template} requires`); continue; }
  const value = raw[f];
  if (d.role === 'control') {
   const error = typeError(d.type, value, templateOf);
   if (error) return conflict(`result ${f} is ${error}`, work);
   const problem = referenceProblem(value, d.type, args.objects, args.patientOf, event.scope.patient);
   if (problem) return conflict(`result ${f}: ${problem}`, work);
   result[f] = { state: 'known', value, ...provenance };
  } else {
   const read = readSuppliedDatum(value, provenance);
   const error = read.state === 'known' ? typeError(d.type, read.value, templateOf) : undefined;
   result[f] = error ? { state: 'unknown', reason: 'invalid_value', detail: `${error}: ${JSON.stringify(value)}`, ...provenance } : read;
  }
  facts.push({ id: `${event.id}/result/${f}`, revision: '1', value: result[f], provenance: { event: event.id, actor: event.actor, source: provenance.source } });
 }
 const verified = sameJson(evidence.performer, event.actor);
 const report: WorkReport = { ...base, verified, evidence, result };
 return { accepted: true, report, facts: verified ? facts : [], work: late || !verified ? work : { ...work, status: 'completed' } };
}

/** A control reference must resolve to an existing object of this patient, at the pinned revision when one is given. */
export function referenceProblem(value: JsonValue, type: { type: string; target?: string }, objects: Parameters<typeof checkWorkReport>[1]['objects'], patientOf: (s: ObjectRef) => Id | undefined, patient: Id): string | undefined {
 if (type.type !== 'reference' || !type.target?.startsWith('object:') || !isRecord(value)) return undefined;
 const ref = value as unknown as ObjectRef;
 const found = objects.filter(o => o.type === ref.type && o.id === ref.id);
 if (!found.length) return `${ref.type}:${ref.id} does not exist`;
 if (ref.revision !== undefined && !found.some(o => o.revision === ref.revision)) return `${ref.type}:${ref.id} has no revision ${ref.revision}`;
 const owner = patientOf(ref);
 return owner !== undefined && owner !== patient ? `${ref.type}:${ref.id} belongs to patient ${owner}` : undefined;
}

/** The readable projection of one occurrence: its snapshot fields, flattened ref and captured content. */
export function workView(w: WorkSnapshot): JsonValue {
 const { ref, ...rest } = w;
 return { ...structuredClone(rest), id: ref.id, occurrence: ref.occurrence, revision: ref.revision, content: structuredClone(w.content ?? {}) } as unknown as JsonValue;
}
