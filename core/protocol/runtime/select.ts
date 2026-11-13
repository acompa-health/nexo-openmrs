/**
 * Row selection. Each enabled row's guard is evaluated in strong Kleene logic by the one core/logic evaluator; the result
 * is the contract's finite rank function, with no display-order choice and no cross-row theorem proving.
 * A precision-bearing comparison (a `{min, max}` window) is true only if every admissible value satisfies it, false
 * only if none does, otherwise unknown.
 * Source: the resolved v1 contract, "Exact selection".
 */
import { compareQuantities, conditionNames, evaluate, parseCondition } from '../../logic/index.ts';
import type { Concepts, Expr, Findings, Quantity } from '../../logic/index.ts';
import { toFinding } from '../contracts.ts';
import type { Condition, HitPolicy, Id, JsonValue, ResolvedInput, SelectionResult, TableRule } from '../types.ts';

export type Truth = 'true' | 'false' | 'unknown';
/** Resolved inputs and calculations by name. A blocked calculation names the declared inputs that block it. */
export type Values = Readonly<Record<string, ResolvedInput & { blocking?: readonly string[] }>>;
export interface GuardResult { truth: Truth; decidedBy: readonly string[]; blockedBy: readonly string[] }
export interface RowTruth { id: Id; rank: number; truth: Truth; blockedBy: readonly string[]; outcome?: string }
/** Guard-only probes have no outcome and cannot establish that two consequences are identical. */
export type SelectionRule = Pick<TableRule, 'id' | 'in' | 'when' | 'rank'> & Partial<Pick<TableRule, 'to' | 'effects'>>;
/** Compare authored JSON, ignoring object-key order but preserving effect order, IDs and expressions. */
export function outcomeKey(rule: Partial<Pick<TableRule, 'to' | 'effects'>>): string | undefined {
 if (rule.to === undefined || rule.effects === undefined) return undefined;
 const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value !== null && typeof value === 'object' ? `{${Object.keys(value).sort(byCodePoint).map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`
  : JSON.stringify(value);
 return stable({ to: rule.to, effects: rule.effects });
}
export interface TableEvaluation {
 /** No row of the table is enabled in the current state: no guard is evaluated. */
 routing?: 'not_enabled';
 row_truth: Readonly<Record<Id, Truth>>;
 selection?: SelectionResult;
 /** The best rank holding a true or unknown row: the winning rank when one row is selected. */
 rank?: number;
 /** The inputs and calculations the guards actually read. */
 read: Values;
 /** Each blocking calculation → the declared inputs that block it. */
 blocking: Readonly<Record<string, readonly string[]>>;
}

const codePoints = (s: string) => Array.from(s, c => c.codePointAt(0)!);
/** Stable order by code point, never by display position. */
export const byCodePoint = (a: string, b: string) => {
 const x = codePoints(a), y = codePoints(b);
 for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
 return x.length - y.length;
};
const sorted = (names: Iterable<string>) => [...new Set(names)].sort(byCodePoint);
/** The declared inputs behind these blocking names: a blocked calculation stands for the inputs that block it. */
export const blockingInputs = (names: readonly string[], values: Values): string[] => sorted(names.flatMap(n => values[n]?.blocking ?? [n]));

/**
 * At the best rank holding a true or unknown row, distinct true outcomes are ambiguous. Identical authored
 * consequences execute once and retain all true triggers. Otherwise, an unknown row at that rank leaves selection
 * unresolved. Every row false is unmatched. Lower-ranked rows do not contribute triggers.
 */
export function selectRow(rows: readonly RowTruth[]): SelectionResult {
 const live = rows.filter(r => r.truth !== 'false');
 if (!live.length) return { result: 'unmatched' };
 const best = Math.min(...live.map(r => r.rank)), at = live.filter(r => r.rank === best);
 const hits = at.filter(r => r.truth === 'true'), open = at.filter(r => r.truth === 'unknown');
 const sameOutcome = hits.length > 0 && hits[0].outcome !== undefined && hits.every(r => r.outcome === hits[0].outcome);
 if (hits.length >= 2 && !sameOutcome) return { result: 'ambiguous', conflict: sorted(hits.map(r => r.id)) };
 if (hits.length && !open.length) {
  const rules = sorted(hits.map(r => r.id));
  return { result: 'selected', rule: rules[0], ...(rules.length > 1 ? { rules } : {}) };
 }
 return { result: 'unresolved', unknown_inputs: sorted(open.flatMap(r => r.blockedBy)) };
}

const isWindow = (v: JsonValue): v is { min: JsonValue; max: JsonValue } =>
 typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 2 && Object.hasOwn(v, 'min') && Object.hasOwn(v, 'max');
type Bound = number | Quantity;
const order = (a: Bound, b: Bound): number => {
 if (typeof a === 'number' && typeof b === 'number') return Math.sign(a - b);
 if (typeof a === 'object' && typeof b === 'object') return compareQuantities(a, b);
 throw new Error(`Cannot compare ${JSON.stringify(a)} with ${JSON.stringify(b)}: give the number its unit.`);
};
/** Truth of `[l1, l2] op [r1, r2]` over every admissible pair of values. */
function intervalTruth(op: string, [l1, l2]: Bound[], [r1, r2]: Bound[]): boolean | undefined {
 const all = { '<': order(l2, r1) < 0, '<=': order(l2, r1) <= 0, '>': order(l1, r2) > 0, '>=': order(l1, r2) >= 0,
  '==': order(l1, l2) === 0 && order(r1, r2) === 0 && order(l1, r1) === 0, '!=': order(l2, r1) < 0 || order(l1, r2) > 0 } as Record<string, boolean>;
 const none = { '<': order(l1, r2) >= 0, '<=': order(l1, r2) > 0, '>': order(l2, r1) <= 0, '>=': order(l2, r1) < 0, '==': all['!='], '!=': all['=='] } as Record<string, boolean>;
 return all[op] ? true : none[op] ? false : undefined;
}

/**
 * The truth of one guard (text or parsed expression) over fresh resolved values, with the names that decided it or
 * keep it open. Throws when a name is not a resolved input or calculation, and on a type error: those are declaration
 * errors, not unknown values.
 */
export function guardTruth(condition: Condition | Expr, values: Values, concepts: Concepts = {}): GuardResult {
 const parsed = typeof condition === 'string' ? parseCondition(condition) : { ok: true as const, value: condition };
 if (!parsed.ok) throw new Error(`${condition}: ${parsed.error.message}`);
 const findings: Record<string, Findings[string]> = {};
 // A comparison that reads a window is judged here and stands in the condition as a synthetic yes/no finding.
 const standIns = new Map<string, { decided: string[]; blocked: string[] }>();
 const value = (name: string) => {
  if (!Object.hasOwn(values, name)) throw new Error(`${name} is not a resolved input or calculation.`);
  return values[name];
 };
 const bounds = (e: Expr): { bounds?: Bound[]; name?: string; open?: boolean } => {
  if (e.kind === 'number') return { bounds: e.unit ? [{ value: e.value, unit: e.unit }, { value: e.value, unit: e.unit }] : [e.value, e.value] };
  if (e.kind !== 'name') throw new Error(`Cannot compare a window with '${e.kind}'.`);
  const v = value(e.name);
  if (v.state === 'unknown') return { name: e.name, open: true };
  const [lo, hi] = isWindow(v.value) ? [v.value.min, v.value.max] : [v.value, v.value];
  return { name: e.name, bounds: [lo as Bound, hi as Bound] };
 };
 const rewrite = (e: Expr): Expr => {
  switch (e.kind) {
   case 'and': case 'or': return { ...e, args: e.args.map(rewrite) };
   case 'not': return { ...e, arg: rewrite(e.arg) };
   case 'call': for (const a of e.args) if (a.kind === 'name') value(a.name); return e;
   case 'name': {
    const v = value(e.name);
    if (v.state === 'known' && isWindow(v.value)) throw new Error(`${e.name} is a window; compare it with a value.`);
    return e;
   }
   case 'compare': {
    const sides = [e.left, e.right].filter(s => s.kind === 'name').map(s => (s as { name: string }).name);
    if (!sides.some(n => { const v = value(n); return v.state === 'known' && isWindow(v.value); })) return e;
    const l = bounds(e.left), r = bounds(e.right), names = [l.name, r.name].filter(n => n !== undefined);
    const open = [l, r].filter(s => s.open).map(s => s.name!);
    const truth = open.length ? undefined : intervalTruth(e.op, l.bounds!, r.bounds!);
    const id = `#${standIns.size}`;
    standIns.set(id, truth === undefined ? { decided: names.filter(n => !open.includes(n)), blocked: open.length ? open : names.filter(n => isWindow((values[n] as { value: JsonValue }).value)) } : { decided: names, blocked: [] });
    findings[id] = truth === undefined ? { status: 'unknown', reason: open.length ? 'unknown operand' : 'unresolved_precision' } : { status: 'known', value: truth };
    return { kind: 'name', name: id, at: e.at };
   }
   default: return e;
  }
 };
 const expr = rewrite(parsed.value);
 for (const n of conditionNames(expr)) if (!standIns.has(n)) findings[n] = toFinding(value(n));
 const r = evaluate(expr, findings, concepts);
 const expand = (list: string[], key: 'decided' | 'blocked') => sorted(list.flatMap(n => standIns.get(n)?.[key] ?? [n]));
 return { truth: r.value === undefined ? 'unknown' : r.value ? 'true' : 'false', decidedBy: expand(r.decidedBy, 'decided'), blockedBy: expand(r.blockedBy, 'blocked') };
}

/**
 * Evaluate a table's rows enabled in `state` and select one. `unique` treats every row as rank 1; `priority` needs a
 * positive integer rank on each row (1 highest; ties and gaps allowed). A rank outside `priority` is refused.
 * A guard that cannot be evaluated throws with its rule: an evaluation error is never swallowed into a result.
 */
export function evaluateTable(table: { hit?: HitPolicy; rules: readonly SelectionRule[] }, state: Id, values: Values, concepts: Concepts = {}): TableEvaluation {
 const priority = table.hit === 'priority';
 for (const r of table.rules) {
  if (priority && !(Number.isInteger(r.rank) && r.rank! >= 1)) throw new Error(`rule ${r.id}: a priority row needs a positive integer rank.`);
  if (!priority && r.rank !== undefined) throw new Error(`rule ${r.id}: rank is allowed only in a priority table.`);
 }
 const enabled = table.rules.filter(r => r.in.includes(state) || r.in.includes('*'));
 if (!enabled.length) return { routing: 'not_enabled', row_truth: {}, read: {}, blocking: {} };
 const rows = enabled.map(r => {
  try { return { id: r.id, rank: priority ? r.rank! : 1, outcome: outcomeKey(r), ...guardTruth(r.when, values, concepts) }; }
  catch (error) { throw new Error(`rule ${r.id}: ${(error as Error).message}`); }
 });
 const selected = selectRow(rows);
 const read = Object.fromEntries(sorted(rows.flatMap(r => [...r.decidedBy, ...r.blockedBy])).map(n => [n, values[n]]));
 const blocking = selected.result === 'unresolved'
  ? Object.fromEntries(selected.unknown_inputs.filter(n => values[n]?.blocking).map(n => [n, values[n].blocking!])) : {};
 // Selection and information handlers name the original inputs; the trace also keeps which calculation was blocked.
 const selection: SelectionResult = selected.result === 'unresolved'
  ? { result: 'unresolved', unknown_inputs: blockingInputs(selected.unknown_inputs, values) }
  : selected;
 const live = rows.filter(r => r.truth !== 'false');
 const rank = selection.result === 'selected' ? rows.find(r => r.id === selection.rule)!.rank : live.length ? Math.min(...live.map(r => r.rank)) : undefined;
 return { row_truth: Object.fromEntries(rows.map(r => [r.id, r.truth])), selection, ...(rank !== undefined ? { rank } : {}), read, blocking };
}
