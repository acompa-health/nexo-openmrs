/**
 * Whole-transition preflight and atomic commit. A selected row stages its effects in order; a later effect reads an
 * earlier staged result through `{effect: id}`. Preflight resolves every value, type, owner, policy, child binding and
 * bind equality before anything is written. One failing effect leaves zero effects of the row: the plan is discarded and
 * the failure names its class, stage, reason and effect. Only a complete plan is applied, with its target.
 * Source: the resolved v1 contract, "Effects and work" and "Start versus bind".
 */
import { compareQuantities, conditionNames, parseCondition } from '../../logic/index.ts';
import { RUNTIME_REASONS } from '../contracts.ts';
import type { ActorRef, ChangeWorkEffect, ContractCatalog, Due, DueAnchor, Effect, EventContract, ExecutionRef, ExecutionSnapshot, FailureClass, FailurePayload, Id, InputDecl, Instant, JsonValue, ObjectRef, OwnerRef, PolicyRef, PreparedProtocol, RecordContract, ReissueTaskEffect, ResolvedInput, Revision, RoleSpec, RuleTarget, ScenarioState, StartEffect, TrustContext, TrustedEvent, ValueTemplate, WorkRef, WorkSnapshot, Workflow, WorkTemplate, StageHandoff } from '../types.ts';
import { patientOfObject, sameJson, sameRef } from './events.ts';
import type { ContentRegistry } from './contents.ts';
import { lifecycleObject, lifecycleOwner } from './lifecycle.ts';
import { completionEvidenceProblem, referenceProblem } from './work.ts';
import type { WorkHistory } from './work.ts';
import { readPath, typeError } from './facts.ts';
import type { Snapshot, WorkTemplateOf } from './facts.ts';
import { addTime, parseTime } from './time.ts';
import { blockingInputs, guardTruth } from './select.ts';
import type { Values } from './select.ts';

export type RuntimeReason = typeof RUNTIME_REASONS[number];
/** An execution with what the engine keeps beside its snapshot. */
export interface ExecutionState {
 snapshot: ExecutionSnapshot;
 /** Every event routed to it, in accepted order, including refused and not-enabled ones. */
 retained: Id[];
 processed: Set<Id>;
 /** Work and child handles of this execution: handle → current reference. */
 handles: Record<string, JsonValue>;
 /** Earlier bindings of each replaced handle, oldest first. Replacement keeps them and their outstanding work. */
 previous: Record<string, JsonValue[]>;
 activations: number;
 owner?: OwnerRef;
 lifetime?: 'execution' | 'independent';
}
export interface CommittedRecord { id: Id; record: Id; fields: Readonly<Record<string, JsonValue>>; execution: Id; attempt: Id; effect: Id; handoff?: StageHandoff }
/** The committed world. Only applyPlan changes it. */
export interface World {
 /** Host object revisions; a revision replaced by a host-attested one carries `superseded_by` and the event that did it. */
 objects: (ScenarioState['objects'][number] & { superseded_by?: Revision; superseded_event?: Id })[];
 executions: Map<Id, ExecutionState>;
 work: WorkSnapshot[];
 records: CommittedRecord[];
 pendingStages: StageHandoff[];
 confirmedStages: { subject: ObjectRef; record: Id; stage: JsonValue }[];
 counters: Record<string, number>;
 /** Per work occurrence (workKey): reports, earlier revisions, its request and cancellations. */
 history: Map<string, WorkHistory>;
}

export interface Failure {
 class: FailureClass; stage: FailurePayload['stage']; reason: RuntimeReason; detail: string;
 effect?: Id; unknown_inputs?: readonly string[]; conflict?: readonly string[];
 /** For a request, revision or lifecycle conflict: the expected and the actual current identity. */
 expected?: Id; actual?: Id;
 /** The exact work occurrence involved in a failed work change, when one was resolved. */
 work?: WorkRef;
}
type Staged =
 | { kind: 'record'; effect: Id; result: JsonValue; record: CommittedRecord }
 | { kind: 'task' | 'order' | 'publish'; effect: Id; result: JsonValue; work?: WorkSnapshot; handle?: { name: string; replace: boolean }; record?: JsonValue; to?: JsonValue; owner?: OwnerRef; reissue_of?: { id: Id; occurrence: Id } }
 | { kind: 'start'; effect: Id; result: JsonValue; created?: ExecutionState; event?: TrustedEvent; handle?: string }
 | { kind: 'emit'; effect: Id; result: JsonValue; event: TrustedEvent; activation?: 'current' | 'destination' }
 | { kind: 'change_work'; effect: Id; result: JsonValue; before: WorkSnapshot; after: WorkSnapshot; note: WorkNote };
/** What a work change adds to the occurrence's history beside its new projection. */
export interface WorkNote { operation: ChangeWorkEffect['operation']; noop?: true; cancellation?: JsonValue; evidence?: JsonValue; retried?: JsonValue; set?: Readonly<Record<string, JsonValue>> }
export interface Plan { staged: Staged[]; skipped: Id[]; counters: Record<string, number> }
const handleOf = (s: Staged) => !('handle' in s) || s.handle === undefined ? undefined : typeof s.handle === 'string' ? s.handle : s.handle.name;

/** Everything one attempt reads. The snapshot is pinned; `values` are its resolved inputs and calculations. */
export interface AttemptContext {
 protocol: PreparedProtocol; contents: ContentRegistry; trust: TrustContext; world: World; execution: ExecutionState; event: TrustedEvent;
 attempt: Id; now: Instant; snapshot: Snapshot; values: Values;
 /** The declarations of the resolved inputs, so a due can name the reference its anchor read. */
 inputs?: Readonly<Record<string, InputDecl>>;
}

const isRecord = (v: unknown): v is Readonly<Record<string, JsonValue>> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isOwner = (v: unknown): v is OwnerRef => isRecord(v) && Object.keys(v).length === 2
 && Object.hasOwn(v, 'id') && typeof v.id === 'string' && v.id.trim() !== ''
 && Object.hasOwn(v, 'revision') && typeof v.revision === 'string' && v.revision.trim() !== '';
const isQuantity = (v: unknown): v is { value: number; unit: string } =>
 isRecord(v) && typeof v.value === 'number' && typeof v.unit === 'string';
const RESERVED = ['value', 'input', 'binding', 'effect'] as const;
const fail = (f: Omit<Failure, 'class' | 'stage'> & { class?: FailureClass }): { failure: Failure } =>
 ({ failure: { class: 'invalid_transition', stage: 'effects', ...f } });
/** A typed subject must exist and cannot belong to another patient. Nonpatient objects stay valid. */
function subjectProblem(value: JsonValue, ctx: AttemptContext, effect: Id): { failure: Failure } | undefined {
 if (!isRecord(value) || typeof value.type !== 'string' || typeof value.id !== 'string')
  return fail({ reason: 'binding_conflict', effect, detail: `effect ${effect}: the subject is not an object reference` });
 const problem = referenceProblem(value, { type: 'reference', target: `object:${value.type}` }, ctx.world.objects,
  ref => patientOfObject(ref, ctx.world.objects), ctx.event.scope.patient);
 return problem ? fail({ reason: 'binding_conflict', effect, detail: `effect ${effect}: ${problem}` }) : undefined;
}
/** The engine as an emitter of internal events. */
export const ENGINE_ACTOR: ActorRef = { id: 'engine', kind: 'service' };

/** Add every dotted condition name (`event.payload.x`, `failure.reason`) the snapshot can read to the values. */
export function withPaths(values: Values, snapshot: Snapshot, conditions: readonly string[]): Values {
 const out: Record<string, Values[string]> = { ...values };
 for (const c of conditions) {
  const parsed = parseCondition(c);
  if (!parsed.ok) continue;
  for (const n of conditionNames(parsed.value)) {
   const root = n.split('.')[0];
   if (!Object.hasOwn(out, n) && (Object.hasOwn(snapshot.roots, root) || Object.hasOwn(snapshot.aliases ?? {}, root))) out[n] = readPath(snapshot, n);
  }
 }
 return out;
}

type Resolved = { ok: true; value: JsonValue } | { ok: false; missing: string[] };
/** Resolve a value template. An unknown value names the inputs or bindings it came from. */
export function resolveTemplate(t: ValueTemplate, ctx: AttemptContext, staged: readonly Staged[]): Resolved {
 const known = (value: JsonValue): Resolved => ({ ok: true, value });
 const from = (r: ResolvedInput & { blocking?: readonly string[] }, name: string): Resolved =>
  r.state === 'known' ? known(r.value) : { ok: false, missing: [...(r.blocking ?? [name])] };
 if (t === null || typeof t !== 'object') return known(t);
 if (Array.isArray(t)) return all(t.map(x => resolveTemplate(x, ctx, staged)), parts => parts);
 const keys = Object.keys(t), map = t as Readonly<Record<string, ValueTemplate>>;
 if (keys.length === 1 && (RESERVED as readonly string[]).includes(keys[0])) {
  const [k] = keys, name = map[k] as JsonValue;
  if (k === 'value') return known(name);
  if (k === 'effect') {
   const s = staged.find(x => x.effect === name);
   if (!s) throw new Error(`{effect: ${name}} reads an effect that is not staged earlier in this row.`);
   return known(s.result);
  }
  if (k === 'binding') {
   if (name === 'this_execution') return known(executionRef(ctx.execution.snapshot) as unknown as JsonValue);
   const b = ctx.execution.snapshot.bindings[name as string];
   return b === undefined ? { ok: false, missing: [name as string] } : known(b);
  }
  const input = name as string;
  return from(Object.hasOwn(ctx.values, input) ? ctx.values[input] : readPath(ctx.snapshot, input), input);
 }
 return all(keys.map(k => resolveTemplate(map[k], ctx, staged)), parts => Object.fromEntries(keys.map((k, i) => [k, parts[i]])));
}
function all(parts: Resolved[], build: (values: JsonValue[]) => JsonValue): Resolved {
 const missing = parts.flatMap(p => p.ok ? [] : p.missing);
 return missing.length ? { ok: false, missing: [...new Set(missing)] } : { ok: true, value: build(parts.map(p => (p as { value: JsonValue }).value)) };
}

export const executionRef = (x: ExecutionSnapshot): ExecutionRef => ({ id: x.id, content: x.content });
/** Allocate past restored IDs and explicit child IDs reserved earlier in this row. */
export function nextIdentity(world: World, prefix: 'REC' | 'W' | 'X' | 'PW', reserved: readonly Id[] = []): Id {
 let id: Id;
 do { id = `${prefix}-${world.counters[prefix] = (world.counters[prefix] ?? 0) + 1}`; }
 while (reserved.includes(id) || (prefix === 'REC' ? world.records.some(r => r.id === id)
  : prefix === 'W' ? world.work.some(w => w.ref.id === id) : world.executions.has(id)));
 return id;
}

/** Resolve an owner field: a role through the host's bindings, or an execution binding that is an owner reference. */
function owner(spec: RoleSpec | { binding: string } | undefined, ctx: AttemptContext, effect: Id): OwnerRef | { failure: Failure } {
 const invalid = (detail: string) => fail({ reason: 'invalid_transition', effect, detail: `effect ${effect}: ${detail}` });
 if (!spec) return invalid('no accountable owner was authored');
 const b = 'role' in spec ? ctx.trust.roles.find(r => r.role === spec.role && r.site === ctx.trust.site)?.owner
  : ctx.execution.snapshot.bindings[spec.binding];
 const source = 'role' in spec ? `owner role ${spec.role} at site ${ctx.trust.site}` : `owner binding ${spec.binding}`;
 return isOwner(b) ? { id: b.id, revision: b.revision } : invalid(`${source} is not a resolved {id, revision} reference`);
}
function policy(ref: PolicyRef | undefined, ctx: AttemptContext): PolicyRef | undefined {
 if (!ref) return undefined;
 const p = ctx.protocol.document.definitions?.work_policies?.[ref.id] ?? ctx.protocol.catalog.policies[ref.id];
 return p && p.revision === ref.revision ? { id: ref.id, revision: ref.revision } : undefined;
}
const contracts = (ctx: AttemptContext) => {
 const d = ctx.protocol.document.definitions, c: ContractCatalog = ctx.protocol.catalog;
 return {
  records: { ...c.records, ...d?.records } as Readonly<Record<Id, RecordContract>>,
  tasks: { ...c.tasks, ...d?.work_templates } as Readonly<Record<Id, WorkTemplate>>,
  events: { ...c.events, ...d?.events } as Readonly<Record<Id, EventContract>>,
 };
};

/** Check resolved fields against declarations: unknown fields throw (the validator refuses them), bad values fail. */
function checkFields(decls: Readonly<Record<string, { type: Parameters<typeof typeError>[0]; optional?: true }>>, values: Readonly<Record<string, JsonValue>>, effect: Id, what: string, workTemplate: WorkTemplateOf): { failure: Failure } | undefined {
 for (const f of Object.keys(values)) if (!Object.hasOwn(decls, f)) throw new Error(`effect ${effect}: ${f} is not a field of ${what}.`);
 for (const [f, d] of Object.entries(decls)) {
  if (!Object.hasOwn(values, f)) { if (!d.optional) return fail({ reason: 'invalid_transition', effect, detail: `${what} needs ${f}` }); continue; }
  const error = typeError(d.type, values[f], workTemplate);
  if (error) return fail({ reason: 'invalid_transition', effect, detail: `${what}.${f} is ${error}` });
 }
 return undefined;
}

/**
 * Stage one row's effects in order. Returns the complete plan, or the first failure. Nothing is written here: the
 * world is read, never changed, so a failure leaves every effect of the row uncommitted.
 */
export function preflight(effects: readonly Effect[], ctx: AttemptContext): Plan | { failure: Failure } {
 const staged: Staged[] = [], skipped: Id[] = [];
 const counters = { ...ctx.world.counters };
 const world: World = { ...ctx.world, counters };
 const { records, tasks, events } = contracts(ctx);
 // A work reference is checked against the occurrences committed or staged so far, never against a template's name alone.
 const templateOf: WorkTemplateOf = ref => [...ctx.world.work, ...staged.flatMap(s => 'work' in s && s.work ? [s.work] : [])]
  .find(w => w.ref.id === ref.id && w.ref.occurrence === ref.occurrence)?.template;
 for (const e of effects) {
  if (e.when !== undefined) {
   const values = withPaths(ctx.values, ctx.snapshot, [e.when]), g = guardTruth(e.when, values);
   // Like selection, an unknown guard names the declared inputs behind a blocked calculation.
   if (g.truth === 'unknown') return fail({ class: 'unresolved', reason: 'unresolved', effect: e.id, unknown_inputs: blockingInputs(g.blockedBy, values), detail: `effect ${e.id}: its condition is unknown` });
   if (g.truth === 'false') { skipped.push(e.id); continue; }
  }
  const r = (t: ValueTemplate) => resolveTemplate(t, ctx, staged);
  const unresolved = (missing: string[], what: string) => fail({ class: 'unresolved', reason: 'unresolved', effect: e.id, unknown_inputs: missing, detail: `effect ${e.id}: ${what} is unknown` });
  switch (e.kind) {
   case 'record': {
    const contract = records[e.record];
    if (!contract) throw new Error(`effect ${e.id}: record ${e.record} has no contract.`);
    const fields: Record<string, JsonValue> = {};
    for (const [f, t] of Object.entries(e.fields)) {
     const v = r(t);
     if (v.ok) fields[f] = v.value;
     else if (!contract.fields[f]?.optional) return unresolved(v.missing, `field ${f}`);
    }
    const bad = checkFields(contract.fields, fields, e.id, `record ${e.record}`, templateOf);
    if (bad) return bad;
    let handoff: StageHandoff | undefined;
    if (contract.stage) {
     const subject = e.for && r(e.for);
     if (!subject || !subject.ok) return unresolved(subject && !subject.ok ? subject.missing : [], 'stage subject');
     const value = subject.value, workflow = ctx.protocol.document.workflows.find(w => w.id === ctx.execution.snapshot.workflow);
     const owner = lifecycleObject(workflow, ctx.execution.snapshot.bindings);
     if (!isRecord(value) || value.type !== contract.subject || typeof value.id !== 'string' || !value.id || !owner
      || value.type !== owner.type || value.id !== owner.id || lifecycleOwner(ctx.contents, owner, Array.from(ctx.world.executions.values(), x => x.snapshot))?.id !== ctx.execution.snapshot.id)
      return fail({ reason: 'binding_conflict', effect: e.id, detail: `effect ${e.id}: stage subject is not this execution's lifecycle object` });
     const current = ctx.world.objects.filter(o => o.type === value.type && o.id === value.id && !o.superseded_by);
     if (current.length !== 1 || (value.revision !== undefined && value.revision !== current[0].revision))
      return fail({ reason: 'binding_conflict', effect: e.id, detail: `effect ${e.id}: stage subject must be the current case revision` });
     if (typeof fields.stage !== 'string' || !fields.stage)
      return fail({ reason: 'invalid_transition', effect: e.id, detail: `effect ${e.id}: a stage record needs a nonempty stage` });
     if (ctx.world.pendingStages.some(h => h.subject.type === value.type && h.subject.id === value.id))
      return fail({ reason: 'binding_conflict', effect: e.id, detail: `effect ${e.id}: a stage handoff is pending` });
     const prior = staged.filter(s => s.kind === 'record' && s.record.handoff).map(s => (s as Extract<Staged, { kind: 'record' }>).record.handoff!);
     if (prior.some(h => h.subject.type === value.type && h.subject.id === value.id && h.stage !== fields.stage))
      return fail({ reason: 'binding_conflict', effect: e.id, detail: `effect ${e.id}: one transition cannot hand off conflicting stages` });
     handoff = { record: '', record_type: e.record, fields: structuredClone(fields), effect: e.id, attempt: ctx.attempt, execution: ctx.execution.snapshot.id, content: ctx.execution.snapshot.content,
      subject: { type: value.type as string, id: value.id }, stage: fields.stage, expected_revision: current[0].revision };
    }
    const id = nextIdentity(world, 'REC');
    if (handoff) handoff.record = id;
    staged.push({ kind: 'record', effect: e.id, result: { type: e.record, id }, record: { id, record: e.record, fields, execution: ctx.execution.snapshot.id, attempt: ctx.attempt, effect: e.id, ...(handoff ? { handoff } : {}) } });
    break;
   }
   case 'task': case 'order': case 'publish': {
    if (e.kind === 'task' && 'reissue' in e) {
     if (!tasks[e.task]) throw new Error(`effect ${e.id}: task template ${e.task} is not declared.`);
     const s = reissueTask(e, ctx, staged, world, tasks[e.task], templateOf);
     if ('failure' in s) return s;
     staged.push(s);
     break;
    }
    const subject = e.kind === 'publish' ? r(e.to) : r(e.for);
    if (!subject.ok) return unresolved(subject.missing, e.kind === 'publish' ? 'the destination' : 'the subject');
    if (e.kind !== 'publish') { const bad = subjectProblem(subject.value, ctx, e.id); if (bad) return bad; }
    if (e.kind === 'publish' && e.policy === undefined && !isOwner(subject.value))
     return fail({ reason: 'invalid_transition', effect: e.id, detail: `effect ${e.id}: an owner notice destination is not a resolved {id, revision} reference` });
    if (e.kind === 'task' && !tasks[e.task]) throw new Error(`effect ${e.id}: task template ${e.task} is not declared.`);
    const body = e.kind === 'publish' ? r(e.record) : undefined;
    if (body && !body.ok) return unresolved(body.missing, 'the record');
    // Captured content: each declared field once, at creation. An optional field that is unknown is left out.
    const declared = e.kind === 'task' ? tasks[e.task].content ?? {} : e.kind === 'order' ? ctx.protocol.catalog.orders[e.order].content : {};
    const content: Record<string, JsonValue> = {};
    for (const [f, t] of Object.entries(e.kind === 'publish' ? {} : e.content ?? {})) {
     const v = r(t);
     if (v.ok) content[f] = v.value;
     else if (!declared[f]?.optional) return unresolved(v.missing, `content ${f}`);
    }
    if (e.kind === 'task') { const bad = checkFields(declared, content, e.id, `task ${e.task} content`, templateOf); if (bad) return bad; }
    if (e.kind === 'order') {
     for (const limit of e.limits ?? []) {
      const maximum = r(limit.maximum);
      if (!maximum.ok) return unresolved(maximum.missing, `limit for ${limit.field}`);
      const actual = content[limit.field], maximumValue = maximum.value;
      if (!isQuantity(actual) || !isQuantity(maximumValue))
       return fail({ reason: 'invalid_transition', effect: e.id, detail: `order ${e.order} limit ${limit.field} needs compatible quantities` });
      try {
       if (compareQuantities(actual, maximumValue) > 0)
        return fail({ reason: 'invalid_transition', effect: e.id, detail: `order ${e.order} ${limit.field} ${actual.value} ${actual.unit} exceeds ${maximumValue.value} ${maximumValue.unit}` });
      } catch {
       return fail({ reason: 'invalid_transition', effect: e.id, detail: `order ${e.order} limit ${limit.field} has incompatible units` });
      }
     }
    }
    const accountable = owner(e.owner, ctx, e.id);
    if ('failure' in accountable) return accountable;
    const handle = typeof e.as === 'string' ? { name: e.as, replace: false } : e.as ? { name: e.as.handle, replace: true } : undefined;
    if (handle && !handle.replace && (Object.hasOwn(ctx.execution.handles, handle.name) || staged.some(s => handleOf(s) === handle.name)))
     return fail({ reason: 'invalid_transition', effect: e.id, detail: `handle ${handle.name} is already bound; use {handle, replace: true}` });
    const pinned = policy(e.policy, ctx);
    if (e.policy && !pinned) return fail({ reason: 'invalid_transition', effect: e.id, detail: `work policy ${e.policy.id}@${e.policy.revision} is not available` });
    if (e.kind !== 'publish' && !pinned) return fail({ reason: 'invalid_transition', effect: e.id, detail: `effect ${e.id} has no work policy` });
    const placed = placeWork(e, ctx, staged, world);
    if ('failure' in placed) return placed;
    const { ref, due } = placed;
    const work: WorkSnapshot | undefined = pinned ? {
     ref, kind: e.kind === 'publish' ? 'publication' : e.kind, template: e.kind === 'task' ? e.task : e.kind === 'order' ? e.order : 'publication',
     subject: (e.kind === 'publish' ? ctx.execution.snapshot.subject : subject.value) as unknown as ObjectRef, owner: accountable, status: 'queued',
     lifetime: e.lifetime ?? 'execution', commissioned_by: executionRef(ctx.execution.snapshot), policy: pinned,
     ...(e.kind === 'publish' ? { content: { record: body!.value, to: subject.value } } : Object.keys(content).length ? { content } : {}),
     ...(due ? { due: { revision: '1', ...due } } : {}),
    } : undefined;
    staged.push({ kind: e.kind, effect: e.id, result: { id: ref.id, occurrence: ref.occurrence }, ...(work ? { work } : {}), ...(handle ? { handle } : {}),
     ...(e.kind === 'publish' ? { record: body!.value, to: subject.value, owner: accountable } : {}) });
    break;
   }
   case 'start': {
    const s = startEffect(e, ctx, staged, world);
    if ('failure' in s) return s;
    staged.push(s);
    break;
   }
   case 'emit': {
    const contract = events[e.event];
    if (!contract) throw new Error(`effect ${e.id}: event ${e.event} has no contract.`);
    const payload = r(e.fields);
    if (!payload.ok) return unresolved(payload.missing, 'a field');
    const bad = checkFields(contract.payload, payload.value as Readonly<Record<string, JsonValue>>, e.id, `event ${e.event}`, templateOf);
    if (bad) return bad;
    const to = e.to === undefined ? undefined : r(e.to);
    if (to && !to.ok) return unresolved(to.missing, 'the destination');
    const self = ctx.execution.snapshot;
    const target = to ? (isRecord(to.value) && typeof to.value.id === 'string' ? to.value.id : String(to.value)) : e.activation ? self.id : undefined;
    const subject = e.for === undefined ? undefined : r(e.for);
    if (subject && !subject.ok) return unresolved(subject.missing, 'the subject');
    const id = `${ctx.event.id}/${self.id}/${e.id}`;
    const event: TrustedEvent = {
     id, type: e.event, occurrence: id,
     scope: { ...ctx.event.scope, ...(subject ? { subject: subject.value as unknown as ObjectRef } : {}) },
     actor: ENGINE_ACTOR, occurred_at: ctx.now, received_at: ctx.now, mode: ctx.event.mode,
     payload: payload.value as Readonly<Record<string, JsonValue>>,
     ...(target ? { target: { execution: target, ...(target === self.id ? { activation: self.activation, content: self.content } : {}) } } : {}),
     caused_by: ctx.event.id, root: ctx.event.root, receipt: { id: `internal:${id}` },
    };
    staged.push({ kind: 'emit', effect: e.id, result: { id }, event, ...(e.activation ? { activation: e.activation } : {}) });
    break;
   }
   case 'change_work': {
    const c = changeWork(e, ctx, staged);
    if ('failure' in c) return c;
    staged.push(c);
    break;
   }
  }
 }
 return { staged, skipped, counters };
}

type DueOf = Exclude<ReturnType<typeof dueOf>, { missing: string[] }>;
/** New work's occurrence key, due and reference: the occurrence defaults to the trigger's, and an identified object (a booking) is keyed by its ID. */
function placeWork(e: { id: Id; occurrence?: ValueTemplate; due?: Due }, ctx: AttemptContext, staged: readonly Staged[], world: World): { ref: WorkRef & { revision: string }; due?: DueOf } | { failure: Failure } {
 const unresolved = (missing: string[], what: string) => fail({ class: 'unresolved', reason: 'unresolved', effect: e.id, unknown_inputs: missing, detail: `effect ${e.id}: ${what} is unknown` });
 const occurrence = e.occurrence === undefined ? { ok: true as const, value: ctx.event.occurrence as JsonValue } : resolveTemplate(e.occurrence, ctx, staged);
 if (!occurrence.ok) return unresolved(occurrence.missing, 'the occurrence');
 const due = e.due === undefined ? undefined : dueOf(e.due, ctx, staged);
 if (due && 'missing' in due) return unresolved(due.missing, 'the due time');
 const key = typeof occurrence.value === 'string' && occurrence.value !== '' ? occurrence.value : isRecord(occurrence.value) && typeof occurrence.value.id === 'string' ? occurrence.value.id : undefined;
 if (key === undefined) return fail({ reason: 'invalid_transition', effect: e.id, detail: `effect ${e.id}: the occurrence ${JSON.stringify(occurrence.value)} is not an identifier or an identified object` });
 return { ref: { id: nextIdentity(world, 'W'), occurrence: key, revision: 'r1' }, ...(due ? { due } : {}) };
}

/**
 * Ask the completed task that a handle binds now again, as a new occurrence of the same template on that handle. It takes
 * the subject, current owner (an accepted transfer included), pinned policy, lifetime and captured content of that work.
 * Each named override replaces one carried field; an optional override that is unknown keeps the carried value. Due is
 * never carried. An unbound handle, other work, another template or work that is not completed refuses the row.
 */
function reissueTask(e: ReissueTaskEffect, ctx: AttemptContext, staged: readonly Staged[], world: World, template: WorkTemplate, templateOf: WorkTemplateOf): Staged | { failure: Failure } {
 const invalid = (detail: string) => fail({ reason: 'invalid_transition', effect: e.id, detail: `effect ${e.id}: ${detail}` });
 const name = e.reissue.handle;
 // The handle as the row leaves it so far: an earlier effect of this row may have bound it to new, queued work.
 const bound = [...staged].reverse().find(s => handleOf(s) === name)?.result ?? ctx.execution.handles[name];
 if (!isRecord(bound)) return invalid(`handle ${name} is not bound`);
 const old = [...ctx.world.work, ...staged.flatMap(s => 'work' in s && s.work ? [s.work] : [])].find(w => w.ref.id === bound.id && w.ref.occurrence === bound.occurrence);
 if (!old) return invalid(`handle ${name} binds no work occurrence`);
 const scope = subjectProblem(old.subject as unknown as JsonValue, ctx, e.id);
 if (scope) return scope;
 if (old.kind !== 'task' || old.template !== e.task) return invalid(`handle ${name} binds ${old.kind} ${old.template}, not task ${e.task}`);
 if (old.status !== 'completed') return invalid(`${old.ref.id} is ${old.status}; only a completed task is asked again`);
 const decls = template.content ?? {};
 for (const f of Object.keys(old.content ?? {})) if (!Object.hasOwn(decls, f)) return invalid(`the carried content ${f} is not a field of task ${e.task}`);
 const content: Record<string, JsonValue> = { ...old.content };
 for (const [f, t] of Object.entries(e.content ?? {})) {
  const v = resolveTemplate(t, ctx, staged);
  if (v.ok) content[f] = v.value;
  else if (!decls[f]?.optional) return fail({ class: 'unresolved', reason: 'unresolved', effect: e.id, unknown_inputs: v.missing, detail: `effect ${e.id}: content ${f} is unknown` });
 }
 const bad = checkFields(decls, content, e.id, `task ${e.task} content`, templateOf);
 if (bad) return bad;
 const pinned = policy(old.policy, ctx);
 if (!pinned) return invalid(`work policy ${old.policy.id}@${old.policy.revision} of ${old.ref.id} is not available`);
 const placed = placeWork(e, ctx, staged, world);
 if ('failure' in placed) return placed;
 const work: WorkSnapshot = {
  ref: placed.ref, kind: 'task', template: e.task, subject: old.subject, owner: old.owner, status: 'queued', lifetime: old.lifetime,
  commissioned_by: executionRef(ctx.execution.snapshot), policy: pinned, ...(Object.keys(content).length ? { content } : {}),
  ...(placed.due ? { due: { revision: '1', ...placed.due } } : {}),
 };
 return { kind: 'task', effect: e.id, result: { id: placed.ref.id, occurrence: placed.ref.occurrence }, work, handle: { name, replace: true },
  reissue_of: { id: old.ref.id, occurrence: old.ref.occurrence } };
}

/** A fresh opaque revision after `current`: the next number when it ends in one (`2`, `r2`), otherwise a suffix. */
export function nextRevision(current: string): string {
 const m = /^(.*?)(\d+)$/.exec(current);
 return m ? `${m[1]}${+m[2] + 1}` : `${current}.1`;
}

/**
 * The object revision an anchor input read through a reference binding (`booking.planned_time` at booking B7 revision 2),
 * as the input resolution recorded it. Undefined when the input read no object.
 */
function anchorRead(input: string, ctx: AttemptContext): DueAnchor | undefined {
 const read = Object.hasOwn(ctx.values, input) ? ctx.values[input] : undefined, binding = ctx.inputs?.[input]?.binding;
 if (!read || read.source === undefined || read.revision === undefined || typeof binding !== 'string') return undefined;
 const i = read.source.indexOf(':'), root = binding.split('.')[0];
 if (i <= 0 || !isRecord(ctx.execution.snapshot.bindings[root])) return undefined;
 return { input, binding: root, object: { type: read.source.slice(0, i), id: read.source.slice(i + 1), revision: read.revision } };
}

/** Resolve a due specification to an instant or a window, or name what is unknown. Nothing is guessed. */
function dueOf(due: Due, ctx: AttemptContext, staged: readonly Staged[]): ({ at: Instant } | { window: { min: string; max: string } }) & { anchor?: DueAnchor } | { missing: string[] } {
 const r = (t: ValueTemplate) => resolveTemplate(t, ctx, staged);
 let anchor: Resolved;
 const read = 'input' in due.from ? anchorRead(due.from.input, ctx) : undefined, provenance = read ? { anchor: read } : {};
 if ('event' in due.from) anchor = { ok: true, value: ctx.event.occurred_at };
 else if ('input' in due.from) anchor = r({ input: due.from.input });
 else {
  const w = ctx.execution.handles[due.from.work];
  const found = isRecord(w) ? ctx.world.work.find(x => x.ref.id === w.id && x.ref.occurrence === w.occurrence) : undefined;
  const v = found ? (found as unknown as Record<string, JsonValue>)[due.from.field] ?? found.content?.[due.from.field] : undefined;
  anchor = v === undefined ? { ok: false, missing: [`${due.from.work}.${due.from.field}`] } : { ok: true, value: v };
 }
 if (!anchor.ok) return { missing: anchor.missing };
 const at = anchor.value;
 const shift = (o: NonNullable<Due['after']>, sign: 1 | -1): Resolved => {
  const literal = o as { value?: unknown; unit?: unknown };
  const q: Resolved = typeof literal.value === 'number' && typeof literal.unit === 'string' ? { ok: true, value: o as unknown as JsonValue } : r(o as ValueTemplate);
  if (!q.ok) return q;
  const amount = q.value as { value: number; unit: string };
  const t = addTime(typeof at === 'string' ? at : { state: 'known', value: at }, { value: sign * amount.value, unit: amount.unit }, due.basis, due.zone);
  return t.state === 'known' ? { ok: true, value: t.value } : { ok: false, missing: [`due (${t.reason}${t.detail ? `: ${t.detail}` : ''})`] };
 };
 if (due.window) {
  const lo = shift(due.window.min, 1), hi = shift(due.window.max, 1);
  if (!lo.ok || !hi.ok) return { missing: [...(lo.ok ? [] : lo.missing), ...(hi.ok ? [] : hi.missing)] };
  return { window: { min: lo.value as string, max: hi.value as string }, ...provenance };
 }
 const t = due.before !== undefined ? shift(due.before, -1) : shift(due.after!, 1);
 if (!t.ok) return { missing: t.missing };
 // A date retains its precision as a window. Only an actual instant may start a timer; a date does not choose a day
 // boundary or time of day. Equal window endpoints retain the written day, month or year precision.
 if (typeof t.value === 'string') return parseTime(t.value)?.precision === 'instant'
  ? { at: t.value, ...provenance } : { window: { min: t.value, max: t.value }, ...provenance };
 return { window: t.value as { min: string; max: string }, ...provenance };
}

const PENDING = new Set<WorkSnapshot['status']>(['queued', 'dispatched']);
/**
 * Change one identified work occurrence: compare its expected revision, then apply exactly one operation. A successful
 * edit allocates a fresh revision and keeps the previous projection in history. A stale revision is a revision conflict
 * with expected and actual revisions and writes nothing. Completed work and actual performance are never erased.
 */
function changeWork(e: ChangeWorkEffect, ctx: AttemptContext, staged: readonly Staged[]): Staged | { failure: Failure } {
 const r = (t: ValueTemplate) => resolveTemplate(t, ctx, staged);
 const unresolved = (missing: string[], what: string) => fail({ class: 'unresolved', reason: 'unresolved', effect: e.id, unknown_inputs: missing, detail: `effect ${e.id}: ${what} is unknown` });
 const invalid = (detail: string, reason: RuntimeReason = 'invalid_transition') => fail({ reason, effect: e.id, detail: `effect ${e.id}: ${detail}` });
 // The selector: a handle's current binding, an explicit retained occurrence of it, or a bound work reference.
 let ref: JsonValue | undefined;
 const selector = e.work as { handle?: unknown; occurrence?: ValueTemplate };
 if (isRecord(e.work) && typeof selector.handle === 'string' && Object.keys(e.work).every(k => k === 'handle' || k === 'occurrence')) {
  const name = selector.handle;
  if (selector.occurrence === undefined) ref = ctx.execution.handles[name];
  else {
   const o = r(selector.occurrence);
   if (!o.ok) return unresolved(o.missing, 'the occurrence');
   const matches = [ctx.execution.handles[name], ...(ctx.execution.previous[name] ?? [])].filter(isRecord).filter(b => b.occurrence === o.value);
   if (matches.length !== 1) return invalid(`handle ${name} has ${matches.length} bindings with occurrence ${JSON.stringify(o.value)}`, 'binding_conflict');
   ref = matches[0];
  }
  if (ref === undefined) return invalid(`handle ${name} is not bound`, 'binding_conflict');
 } else {
  const v = r(e.work as ValueTemplate);
  if (!v.ok) return unresolved(v.missing, 'the work');
  ref = v.value;
 }
 const target = isRecord(ref) ? ref : undefined;
 const work = target && ctx.world.work.find(w => w.ref.id === target.id && w.ref.occurrence === target.occurrence);
 if (!work) return invalid(`no work occurrence ${JSON.stringify(ref)}`, 'binding_conflict');
 const scope = subjectProblem(work.subject as unknown as JsonValue, ctx, e.id);
 if (scope) return scope;
 if (staged.some(s => s.kind === 'change_work' && s.before.ref.id === work.ref.id && s.before.ref.occurrence === work.ref.occurrence))
  return invalid(`one row changes ${work.ref.id} once`);
 const expected = r(e.expected_revision);
 if (!expected.ok) return unresolved(expected.missing, 'the expected revision');
 if (String(expected.value) !== work.ref.revision)
  return fail({ reason: 'revision_conflict', effect: e.id, expected: String(expected.value), actual: work.ref.revision, work: work.ref,
   detail: `effect ${e.id}: ${work.ref.id} is at revision ${work.ref.revision}, not ${String(expected.value)}` });
 const result = { id: work.ref.id, occurrence: work.ref.occurrence };
 const revision = nextRevision(work.ref.revision);
 const { ref: _ref, ...rest } = work;
 const changed = (after: Omit<WorkSnapshot, 'ref'>, note: WorkNote): Staged =>
  ({ kind: 'change_work', effect: e.id, result: { ...result, revision }, before: work, after: { ...after, ref: { ...work.ref, revision } }, note });
 const noop = (note: WorkNote): Staged => ({ kind: 'change_work', effect: e.id, result: { ...result, revision: work.ref.revision }, before: work, after: work, note: { ...note, noop: true } });
 switch (e.operation) {
  case 'reschedule': {
   if (!PENDING.has(work.status)) return invalid(`${work.ref.id} is ${work.status}; only pending work is rescheduled`);
   const due = dueOf(e.due, ctx, staged);
   if ('missing' in due) return unresolved(due.missing, 'the due time');
   return changed({ ...rest, due: { revision: nextRevision(work.due?.revision ?? '0'), ...due } }, { operation: 'reschedule' });
  }
  case 'cancel': {
   const reason = r(e.reason);
   if (!reason.ok) return unresolved(reason.missing, 'the reason');
   // Completed or cancelled work stays as it is; an outstanding cancellation request is not repeated.
   if (work.status === 'completed' || work.status === 'cancelled' || work.status === 'cancellation_requested') return noop({ operation: 'cancel' });
   return changed({ ...rest, status: work.status === 'dispatched' ? 'cancellation_requested' : 'cancelled' }, { operation: 'cancel', cancellation: { event: ctx.event.id, reason: reason.value } });
  }
  case 'satisfy': {
   const evidence = r(e.evidence);
   if (!evidence.ok) return unresolved(evidence.missing, 'the completion evidence');
   const v = evidence.value;
   const pinned = ctx.contents.resolve(work.commissioned_by.content);
   const template = work.kind === 'task' ? pinned?.document.definitions?.work_templates?.[work.template] ?? pinned?.catalog.tasks[work.template] : undefined;
   const problem = work.kind === 'task' && !template ? `no captured template for ${work.ref.id}` : completionEvidenceProblem(v, work, template);
   if (problem) return invalid(problem, 'missing_completion_evidence');
   if (work.status === 'completed') return noop({ operation: 'satisfy', evidence: v });
   if (work.status === 'cancelled') return invalid(`${work.ref.id} is cancelled`);
   return changed({ ...rest, status: 'completed' }, { operation: 'satisfy', evidence: v });
  }
  case 'retry': {
   const attempt = r(e.attempt);
   if (!attempt.ok) return unresolved(attempt.missing, 'the failed attempt');
   if (work.status !== 'failed') return invalid(`${work.ref.id} is ${work.status}; only failed work is retried`);
   const failure = ctx.world.history.get(JSON.stringify([work.ref.id, work.ref.occurrence]))?.reports.find(x => x.type === 'work.failed' && x.disposition === 'applied' && x.event === attempt.value);
   if (!failure) return invalid(`${JSON.stringify(attempt.value)} is not a failed attempt of ${work.ref.id}`);
   if (failure.data?.retryable !== true && failure.data?.retryable !== 'yes') return invalid(`the failure ${failure.event} is not retryable`);
   return changed({ ...rest, status: 'dispatched' }, { operation: 'retry', retried: attempt.value });
  }
  case 'rebind': {
   if (!PENDING.has(work.status) && work.status !== 'cancellation_requested') return invalid(`${work.ref.id} is ${work.status}`);
   const set: Record<string, JsonValue> = {};
   for (const [k, t] of Object.entries(e.set)) { const v = r(t as ValueTemplate); if (!v.ok) return unresolved(v.missing, `rebind ${k}`); set[k] = v.value; }
   if (!Object.keys(set).length) return invalid('rebind sets nothing');
   if ((Object.hasOwn(set, 'subject') || Object.hasOwn(set, 'anchor')) && e.replacement === undefined) return invalid('changing the subject or anchor needs replacement evidence');
   const next: Omit<WorkSnapshot, 'ref'> = { ...rest };
   if (Object.hasOwn(set, 'owner')) {
    if (e.acceptance === undefined) return fail({ class: 'not_authorized', reason: 'not_authorized', effect: e.id, detail: `effect ${e.id}: changing the owner needs an acceptance of this exact work` });
    const a = r(e.acceptance);
    if (!a.ok) return unresolved(a.missing, 'the acceptance');
    const id = isRecord(a.value) ? a.value.id : a.value;
    const accepted = (ctx.trust.acceptances ?? []).find(x => x.id === id);
    // Only an acceptance of this exact occurrence and revision, for the new owner, by an actor bound to that owner.
    const holds = !!accepted && accepted.scope.id === work.ref.id && accepted.scope.occurrence === work.ref.occurrence
     && (accepted.scope.revision === undefined || accepted.scope.revision === work.ref.revision) && sameJson(accepted.to, set.owner)
     && ctx.trust.roles.some(b => sameJson(b.actor, accepted.actor) && sameJson(b.owner, accepted.to) && b.site === ctx.trust.site);
    if (!holds) return fail({ class: 'not_authorized', reason: 'not_authorized', effect: e.id, detail: `effect ${e.id}: no acceptance of ${work.ref.id}@${work.ref.revision} by the receiving owner authorizes this transfer` });
    next.owner = set.owner as unknown as OwnerRef;
   }
   if (Object.hasOwn(set, 'subject')) {
    const scope = subjectProblem(set.subject, ctx, e.id);
    if (scope) return scope;
    next.subject = set.subject as unknown as ObjectRef;
   }
   if (Object.hasOwn(set, 'lifetime')) {
    if (set.lifetime === 'independent' && !Object.hasOwn(set, 'purpose')) return invalid('independent work needs a purpose');
    next.lifetime = set.lifetime as WorkSnapshot['lifetime'];
   }
   if (e.due) {
    const due = dueOf(e.due, ctx, staged);
    if ('missing' in due) return unresolved(due.missing, 'the due time');
    next.due = { revision: nextRevision(work.due?.revision ?? '0'), ...due };
   }
   return changed(next, { operation: 'rebind', set });
  }
 }
}

/** Start: `new` checks the child's entry inputs and reserves its identity; `bind` checks equality on an existing instance. */
function startEffect(e: StartEffect, ctx: AttemptContext, staged: readonly Staged[], world: World): Staged | { failure: Failure } {
 const doc = ctx.protocol.document;
 if (!('workflow' in e.definition)) throw new Error(`effect ${e.id}: start needs a workflow definition.`);
 if ('content' in e.definition && !sameJson(e.definition.content, ctx.protocol.content))
  throw new Error(`effect ${e.id}: starting another content's workflow needs that prepared content.`);
 const content = ctx.protocol.content, workflowId = e.definition.workflow;
 const workflow = doc.workflows.find(w => w.id === workflowId);
 if (!workflow) throw new Error(`effect ${e.id}: workflow ${workflowId} is not in this document.`);
 const r = (t: ValueTemplate) => resolveTemplate(t, ctx, staged);
 const conflict = (detail: string, data: string[] = [], actual?: Id) => fail({ reason: 'binding_conflict', effect: e.id, detail,
  ...(data.length ? { conflict: data } : {}), ...(actual ? { actual } : {}) });
 const bindings: Record<string, JsonValue> = {}, missing: string[] = [];
 for (const [name, t] of Object.entries(e.bindings)) { const v = r(t); if (v.ok) bindings[name] = v.value; else missing.push(...v.missing); }
 const resolvedFor = r(e.for);
 if (!resolvedFor.ok) missing.push(...resolvedFor.missing);
 const subject = resolvedFor.ok ? resolvedFor.value : null;
 if (missing.length) return fail({ class: 'unresolved', reason: 'unresolved', effect: e.id, unknown_inputs: [...new Set(missing)], detail: `effect ${e.id}: a binding of ${workflowId} is unknown` });
 const scope = subjectProblem(subject!, ctx, e.id);
 if (scope) return scope;
 const typeProblem = entryProblem(workflow, bindings, ctx);
 if (typeProblem) return conflict(`effect ${e.id}: ${typeProblem}`);
 if (e.mode === 'bind') {
  const instance = r(e.instance);
  if (!instance.ok) return fail({ class: 'unresolved', reason: 'unresolved', effect: e.id, unknown_inputs: instance.missing, detail: `effect ${e.id}: the instance is unknown` });
  const id = typeof instance.value === 'string' ? instance.value : isRecord(instance.value) && typeof instance.value.id === 'string' ? instance.value.id : undefined;
  const existing = id === undefined ? undefined : ctx.world.executions.get(id)?.snapshot;
  if (!existing) return conflict(`effect ${e.id}: no execution ${JSON.stringify(instance.value)} to bind`);
  if (existing.ended && !e.allow_ended) return conflict(`effect ${e.id}: ${existing.id} ended as ${existing.ended.outcome}`);
  const differs: string[] = [];
  if (existing.workflow !== workflowId || !sameJson(existing.content, content)) differs.push('definition');
  if (isRecord(instance.value) && isRecord(instance.value.content) && !sameJson(instance.value.content, existing.content)) differs.push('content');
  if (!sameRef(existing.subject as unknown as JsonValue, subject)) differs.push('for');
  for (const [name, v] of Object.entries(bindings)) if (!sameRef(existing.bindings[name], v)) differs.push(name);
  if (differs.length) return conflict(`effect ${e.id}: ${existing.id} does not match on ${differs.join(', ')}`, differs.sort());
  return { kind: 'start', effect: e.id, result: executionRef(existing) as unknown as JsonValue, ...(e.as ? { handle: e.as } : {}) };
 }
 if (workflow.lifecycle_of) {
  const object = lifecycleObject(workflow, bindings);
  if (!object || !sameRef({ ...object }, subject))
   return conflict(`effect ${e.id}: for must match lifecycle binding ${workflow.lifecycle_of.binding}`, ['for', workflow.lifecycle_of.binding]);
  const existing = lifecycleOwner(ctx.contents, object, [
   ...Array.from(ctx.world.executions.values(), x => x.snapshot),
   ...staged.flatMap(s => s.kind === 'start' && s.created ? [s.created.snapshot] : []),
  ]);
  if (existing) return conflict(`effect ${e.id}: ${object.type}:${object.id} already has lifecycle ${existing.id}${existing.ended ? '; a successor is not supported' : '; reuse needs mode bind'}`, [], existing.id);
 }
 const requested = e.instance === undefined ? undefined : r(e.instance);
 if (requested && !requested.ok) return fail({ class: 'unresolved', reason: 'unresolved', effect: e.id, unknown_inputs: requested.missing, detail: `effect ${e.id}: the instance is unknown` });
 const id = requested ? String(requested.value) : nextIdentity(world, 'X',
  staged.flatMap(s => s.kind === 'start' && s.created ? [s.created.snapshot.id] : []));
 if (ctx.world.executions.has(id) || staged.some(s => s.kind === 'start' && s.created?.snapshot.id === id))
  return conflict(`effect ${e.id}: execution ${id} already exists or is reserved in this row; reuse needs mode bind`, [], id);
 const accountable = e.owner === undefined ? ctx.execution.owner : owner(e.owner, ctx, e.id);
 if (!accountable) return fail({ reason: 'invalid_transition', effect: e.id, detail: `effect ${e.id}: the child has no accountable owner` });
 if ('failure' in accountable) return accountable;
 const snapshot: ExecutionSnapshot = { id, content, workflow: workflowId, subject: subject as unknown as ObjectRef, state: workflow.initial, activation: 'A1', bindings };
 const started: TrustedEvent = {
  id: `${ctx.event.id}/${ctx.execution.snapshot.id}/${e.id}`, type: 'workflow.started', occurrence: `${id}/started`,
  scope: { ...ctx.event.scope, subject: snapshot.subject! }, actor: ENGINE_ACTOR, occurred_at: ctx.now, received_at: ctx.now,
  mode: ctx.event.mode, payload: { entry: bindings }, target: { execution: id, activation: 'A1', content },
  caused_by: ctx.event.id, root: ctx.event.root, receipt: { id: `internal:${ctx.event.id}/${e.id}` },
 };
 const created: ExecutionState = { snapshot, retained: [], processed: new Set(), handles: {}, previous: {}, activations: 1, owner: accountable, lifetime: e.lifetime ?? 'execution' };
 return { kind: 'start', effect: e.id, result: executionRef(snapshot) as unknown as JsonValue, created, event: started, ...(e.as ? { handle: e.as } : {}) };
}

/** Every required entry input of the child is bound and has its declared type. */
function entryProblem(workflow: Workflow, bindings: Readonly<Record<string, JsonValue>>, ctx: AttemptContext): string | undefined {
 for (const decl of Object.values(workflow.inputs)) {
  if (typeof decl.binding !== 'string' || !decl.binding.startsWith('entry.')) continue;
  const key = decl.binding.slice('entry.'.length);
  if (!Object.hasOwn(bindings, key)) { if (decl.required === 'entry') return `${workflow.id} needs entry ${key}`; continue; }
  const error = decl.type ? typeError(decl.type, bindings[key]) : undefined;
  if (error) return `${workflow.id} entry ${key} is ${error}`;
  const scope = decl.type && referenceProblem(bindings[key], decl.type, ctx.world.objects,
   ref => patientOfObject(ref, ctx.world.objects), ctx.event.scope.patient);
  if (scope) return `${workflow.id} entry ${key}: ${scope}`;
 }
 return undefined;
}

export interface Applied {
 /** `reissue_of`: the completed occurrence a reissue asked again. */
 effects: { effect: Id; kind: Effect['kind']; result: JsonValue; record?: JsonValue; to?: JsonValue; owner?: OwnerRef; reissue_of?: { id: Id; occurrence: Id } }[];
 /** Internal events to deliver after commit, in effect order. */
 deliver: TrustedEvent[];
 /** New and changed work projections. */
 work: WorkSnapshot[];
 activation: { from: Id; to: Id } | undefined;
 /** Work changes with what preflight read, for the occurrence history. */
 changes: Extract<Staged, { kind: 'change_work' }>[];
}
/** Apply a complete plan and the row's target to the world, all at once. */
export function applyPlan(world: World, execution: ExecutionState, plan: Plan, target: RuleTarget, ending: { event: Id; at: Instant }): Applied {
 const x = execution.snapshot, before = x.activation;
 let activation: Applied['activation'];
 if ('state' in target) {
  execution.activations += 1;
  const to = `A${execution.activations}`;
  execution.snapshot = { ...x, state: target.state, activation: to };
  activation = { from: before, to };
 } else if ('end' in target) execution.snapshot = { ...x, ended: { outcome: target.end, event: ending.event, at: ending.at } };
 const deliver: TrustedEvent[] = [], work: WorkSnapshot[] = [], changes: Extract<Staged, { kind: 'change_work' }>[] = [];
 for (const s of plan.staged) {
  if (s.kind === 'record') { world.records.push(s.record); if (s.record.handoff) world.pendingStages.push(s.record.handoff); }
  else if (s.kind === 'start') {
   if (s.created) { world.executions.set(s.created.snapshot.id, s.created); deliver.push(s.event!); }
   if (s.handle) execution.handles[s.handle] = s.result;
  } else if (s.kind === 'change_work') {
   // Compared again at commit: the occurrence must still be at the revision preflight read.
   const i = world.work.findIndex(w => w.ref.id === s.before.ref.id && w.ref.occurrence === s.before.ref.occurrence);
   if (i < 0 || world.work[i].ref.revision !== s.before.ref.revision) throw new Error(`commit: ${s.before.ref.id} changed after preflight`);
   if (!s.note.noop) { world.work[i] = s.after; work.push(s.after); }
   changes.push(s);
  } else if (s.kind === 'emit') {
   const target = s.event.target;
   const event = target && target.execution === x.id && s.activation === 'destination' ? { ...s.event, target: { ...target, activation: execution.snapshot.activation } } : s.event;
   deliver.push(event);
  } else {
   if (s.work) { world.work.push(s.work); work.push(s.work); }
   if (s.handle) {
    const old = execution.handles[s.handle.name];
    if (old !== undefined) (execution.previous[s.handle.name] ??= []).push(old);
    execution.handles[s.handle.name] = s.result;
   }
  }
 }
 world.counters = { ...plan.counters };
 return { effects: plan.staged.map(s => ({ effect: s.effect, kind: s.kind, result: s.result,
  ...(s.kind === 'publish' ? { record: s.record, to: s.to, owner: s.owner } : {}), ...(s.kind === 'task' && s.reissue_of ? { reissue_of: s.reissue_of } : {}) })), deliver, work, activation, changes };
}
