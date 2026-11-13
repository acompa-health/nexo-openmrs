/**
 * Event ingress and routing. Ingress checks the host envelope once: run mode, event identity and an attributed duplicate.
 * Routing is per execution: an explicit subscription of the event type whose scope matches, the patient and any target,
 * deduplication by `(execution, event.id)`, then the tables with at least one row enabled in the current state.
 * Nothing here evaluates a guard or changes state.
 * Source: the resolved v1 contract, "Events and state enablement".
 */
import type { ExecutionRef, ExecutionSnapshot, Id, JsonValue, Table, Trigger, TrustContext, TrustedEvent, Workflow } from '../types.ts';

const isRecord = (v: unknown): v is Readonly<Record<string, JsonValue>> => typeof v === 'object' && v !== null && !Array.isArray(v);
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
 : isRecord(v) ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v) ?? 'undefined';
/** Exact JSON equality; object key order is irrelevant. */
export const sameJson = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** The immutable content of an assertion: everything except the transport receipt and the receipt time. */
const immutable = ({ receipt: _r, received_at: _t, ...rest }: TrustedEvent) => rest;

/**
 * Reference equality for a reference kind: an object by type and id (and revision when both pin one), an execution by
 * id and exact content, a work occurrence by id and occurrence, otherwise exact JSON.
 */
export function sameRef(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
 if (!isRecord(a) || !isRecord(b)) return sameJson(a, b);
 if (typeof a.type === 'string' && typeof a.id === 'string')
  return a.type === b.type && a.id === b.id && (a.revision === undefined || b.revision === undefined || a.revision === b.revision);
 if (typeof a.id === 'string' && isRecord(a.content)) return a.id === b.id && sameJson(a.content, b.content);
 if (typeof a.id === 'string' && typeof a.occurrence === 'string') return a.id === b.id && a.occurrence === b.occurrence;
 return sameJson(a, b);
}

export type Ingress =
 | { accepted: TrustedEvent; redelivery: boolean }
 | { rejected: 'event_identity_conflict' | 'not_authorized'; detail: string };
/**
 * Accept a host-normalized event. A simulation event cannot act in a live run, nor the reverse. A reused event ID, or a
 * `duplicate_of` alias, must carry the same immutable content as the original; then it is a redelivery under the
 * original ID. A sender's duplicate label alone proves nothing.
 */
export function ingest(event: TrustedEvent, trust: TrustContext, seen: ReadonlyMap<Id, TrustedEvent>): Ingress {
 if (event.mode !== trust.mode) return { rejected: 'not_authorized', detail: `a ${event.mode} event cannot act in a ${trust.mode} run` };
 const original = event.receipt.duplicate_of ?? event.id;
 const prior = seen.get(original);
 if (event.receipt.duplicate_of !== undefined && !prior) return { rejected: 'event_identity_conflict', detail: `${event.id} claims to duplicate ${original}, which was not received` };
 if (!prior) return { accepted: event, redelivery: false };
 const claim = { ...immutable(event), id: original };
 if (!sameJson(claim, immutable(prior))) return { rejected: 'event_identity_conflict', detail: `${event.id} reuses ${original} with different content` };
 return { accepted: prior, redelivery: true };
}

/** The patient an execution belongs to: its subject when that is a patient, or the subject object's `patient` field. */
export function patientOf(execution: ExecutionSnapshot, objects: readonly { type: Id; id: Id; fields: Readonly<Record<string, JsonValue>> }[]): Id | undefined {
 return execution.subject && patientOfObject(execution.subject, objects);
}
/**
 * The patient of an object: direct ownership, or ownership through its care plan or case. A missing link, cycle or
 * disagreement between links never establishes a patient. The limited link names express clinical containment;
 * arbitrary object references (for example an author or a referral destination) do not transfer ownership.
 */
export function patientOfObject(s: { type: Id; id: Id }, objects: readonly { type: Id; id: Id; fields: Readonly<Record<string, JsonValue>> }[]): Id | undefined {
 const seen = new Set<string>();
 const resolve = (ref: { type: Id; id: Id; revision?: Id }): Id | undefined => {
  if (ref.type === 'patient') return ref.id;
  const key = `${ref.type}\u0000${ref.id}\u0000${ref.revision ?? ''}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  const candidates = objects.filter(o => o.type === ref.type && o.id === ref.id && (ref.revision === undefined || (o as { revision?: Id }).revision === ref.revision));
  const object = candidates.filter(o => (o as { superseded_by?: Id }).superseded_by === undefined).at(-1) ?? candidates.at(-1);
  if (!object) { seen.delete(key); return undefined; }
  const direct = object.fields.patient;
  const patient = typeof direct === 'string' ? direct
   : isRecord(direct) && direct.type === 'patient' && typeof direct.id === 'string' ? direct.id : undefined;
  const owners = patient === undefined ? [] : [patient];
  for (const type of ['care_plan', 'case'] as const) {
   const link = object.fields[type];
   if (isRecord(link) && link.type === type && typeof link.id === 'string') {
    const linked = resolve(link as { type: Id; id: Id; revision?: Id });
    if (linked === undefined) { seen.delete(key); return undefined; }
    owners.push(linked);
   }
  }
  seen.delete(key);
  return owners.length > 0 && owners.every(owner => owner === owners[0]) ? owners[0] : undefined;
 };
 return resolve(s);
}

/** Does one subscription's scope cover this event? A decision request is implicitly scoped to its addressed execution. */
export function subscribed(on: Trigger, event: TrustedEvent, execution: ExecutionSnapshot, handles: Readonly<Record<string, JsonValue>>, ended?: ExecutionRef): boolean {
 if (on.event !== event.type) return false;
 if (event.type === 'decision.requested' && event.target?.execution !== execution.id) return false;
 if (on.table !== undefined && (!isRecord(event.payload) || event.payload.table !== on.table)) return false;
 if (on.work !== undefined) {
  const work = handles[on.work];
  if (!event.work || !isRecord(work) || work.id !== event.work.id || work.occurrence !== event.work.occurrence) return false;
 }
 if (!on.for) return on.work !== undefined || event.type === 'decision.requested' || event.type === 'evaluation.failed';
 const name = on.for.binding;
 if (name === 'this_execution') return event.target?.execution === execution.id;
 const bound = execution.bindings[name];
 if (!isRecord(bound)) return false;
 if (typeof bound.type === 'string') return !!event.scope.subject && sameRef(bound, event.scope.subject as unknown as JsonValue);
 if (typeof bound.occurrence === 'string') return !!event.work && bound.id === event.work.id && bound.occurrence === event.work.occurrence;
 // An execution reference hears the end of exactly that execution and content, as the engine recorded it.
 if (typeof bound.id === 'string' && isRecord(bound.content)) return !!ended && ended.id === bound.id && sameJson(ended.content, bound.content);
 return false;
}

export type Route =
 | { outcome: 'unsubscribed' }
 | { outcome: 'duplicate' }
 | { outcome: 'rejected'; reason: 'binding_conflict'; detail: string }
 | { outcome: 'not_enabled'; tables: readonly Id[] }
 | { outcome: 'ambiguous_routing'; tables: readonly Id[] }
 | { outcome: 'evaluate'; table: Table };

/**
 * Route one event to one execution, or say why it is not evaluated. `undefined` means the execution has no interest:
 * it is neither subscribed nor the event's target. A targeted execution that is not subscribed is `unsubscribed`.
 * A matching subscription on another patient, an ended or stale target is rejected, never applied elsewhere. The
 * engine's own end announcement (`ended`) is the one exception: a listener that has already ended does not hear it.
 */
export function route(event: TrustedEvent, execution: ExecutionSnapshot, workflow: Workflow, context: { patient?: Id; processed: ReadonlySet<Id>; handles: Readonly<Record<string, JsonValue>>; ended?: ExecutionRef }): Route | undefined {
 const matching = workflow.tables.filter(t => subscribed(t.on, event, execution, context.handles, context.ended));
 const targeted = event.target?.execution === execution.id;
 if (!matching.length) return targeted ? { outcome: 'unsubscribed' } : undefined;
 if (context.processed.has(event.id)) return { outcome: 'duplicate' };
 if (context.patient !== undefined && event.scope.patient !== context.patient)
  return { outcome: 'rejected', reason: 'binding_conflict', detail: `event patient ${event.scope.patient} is not execution patient ${context.patient}` };
 // An end announcement is a notice to stop: an ended listener has nothing left to stop, so it is no conflict.
 if (execution.ended) return context.ended ? undefined : { outcome: 'rejected', reason: 'binding_conflict', detail: `execution ${execution.id} ended as ${execution.ended.outcome}` };
 if (targeted && event.target!.activation !== undefined && event.target!.activation !== execution.activation)
  return { outcome: 'rejected', reason: 'binding_conflict', detail: `activation ${event.target!.activation} is not current activation ${execution.activation}` };
 if (targeted && event.target!.content !== undefined && !sameJson(event.target!.content, execution.content))
  return { outcome: 'rejected', reason: 'binding_conflict', detail: `the event targets other content than ${execution.id} runs` };
 const enabled = matching.filter(t => t.rules.some(r => r.in.includes(execution.state) || r.in.includes('*')));
 if (!enabled.length) return { outcome: 'not_enabled', tables: matching.map(t => t.id) };
 if (enabled.length > 1) return { outcome: 'ambiguous_routing', tables: enabled.map(t => t.id) };
 return { outcome: 'evaluate', table: enabled[0] };
}
