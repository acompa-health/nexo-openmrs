/**
 * Decision-request slots. At most one request is current for `(execution, activation, table)`. An initial request needs
 * an empty slot; `resume_from` and `supersedes` replace exactly the current request and are mutually exclusive. A
 * consumed request has left its slot, so no successor can name it. Leaving an activation retires its slots with a
 * reason; it cancels no work. The comparison and the slot update are one step, done when the request is accepted.
 * A request payload is checked against its table's request contract first.
 * Source: the resolved v1 contract, "Requests and resumption".
 */
import type { DecisionRequestPayload, Id, JsonValue, RequestContract, RequestId } from '../types.ts';
import { typeError } from './facts.ts';

/**
 * Why a request's `fixed` and `collected` references do not fit the table's contract, or undefined. Every fixed field
 * is present; a collected field may be absent only when it is optional; no undeclared field is accepted.
 */
export function requestProblem(contract: RequestContract, payload: Pick<DecisionRequestPayload, 'fixed' | 'collected'>): string | undefined {
 for (const part of ['fixed', 'collected'] as const) {
  const decls: RequestContract['collected'] = contract[part], given = payload[part] ?? {};
  for (const name of Object.keys(given)) if (!Object.hasOwn(decls, name)) return `${part}.${name} is not in the request contract`;
  for (const [name, d] of Object.entries(decls)) {
   if (!Object.hasOwn(given, name)) { if (part === 'fixed' || !d.optional) return `${part}.${name} is missing`; continue; }
   const error = typeError({ type: 'reference', target: d.target }, given[name]);
   if (error) return `${part}.${name} is ${error}`;
  }
 }
 return undefined;
}

export type Acceptance =
 | { ok: true; replaced?: RequestId }
 | { ok: false; reason: 'revision_conflict'; expected?: RequestId; actual?: RequestId; detail: string };

const key = (execution: Id, activation: Id, table: Id) => JSON.stringify([execution, activation, table]);

export class RequestSlots {
 private current = new Map<string, RequestId>();
 /** Retired slots with their reason, in order. */
 readonly retired: { execution: Id; activation: Id; table: Id; request: RequestId; reason: string }[] = [];

 /** The current request for one slot. */
 get(execution: Id, activation: Id, table: Id): RequestId | undefined { return this.current.get(key(execution, activation, table)); }

 /** Compare the predecessor and fill the slot, or refuse with the expected and actual request. */
 accept(execution: Id, activation: Id, request: RequestId, payload: Pick<DecisionRequestPayload, 'table' | 'resume_from' | 'supersedes'>): Acceptance {
  const k = key(execution, activation, payload.table), current = this.current.get(k);
  const predecessor = payload.resume_from ?? payload.supersedes;
  const refuse = (detail: string): Acceptance => ({ ok: false, reason: 'revision_conflict', ...(predecessor ? { expected: predecessor } : {}), ...(current ? { actual: current } : {}), detail });
  if (payload.resume_from !== undefined && payload.supersedes !== undefined) return refuse('a request names either resume_from or supersedes, not both');
  if (predecessor === undefined && current !== undefined) return refuse(`slot ${payload.table} already holds ${current}; a successor must name it`);
  if (predecessor !== undefined && predecessor !== current) return refuse(current === undefined ? `slot ${payload.table} is empty; ${predecessor} is not current` : `${predecessor} is not the current request ${current}`);
  this.current.set(k, request);
  return { ok: true, ...(current ? { replaced: current } : {}) };
 }

 /** A successful decision closes the slot. */
 consume(execution: Id, activation: Id, table: Id, request: RequestId): void {
  const k = key(execution, activation, table);
  if (this.current.get(k) === request) this.current.delete(k);
 }

 /** Leaving an activation retires its slots with a recorded reason. */
 retire(execution: Id, activation: Id, reason: string): void {
  for (const [k, request] of this.current) {
   const [x, a, table] = JSON.parse(k) as [Id, Id, Id];
   if (x !== execution || a !== activation) continue;
   this.current.delete(k);
   this.retired.push({ execution, activation, table, request, reason });
  }
 }

 /** `this_execution.requests.<table>`: the current request reference, or an attributed absence. */
 view(execution: Id, activation: Id, tables: readonly Id[]): Record<Id, JsonValue> {
  return Object.fromEntries(tables.map((t): [Id, JsonValue] => {
   const r = this.get(execution, activation, t);
   return [t, r === undefined ? { unknown: 'absent' } : { id: r }];
  }));
 }

}
