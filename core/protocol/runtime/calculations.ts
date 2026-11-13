/**
 * Named pure calculations over resolved inputs: `when`, `cases`, `multiply`, `min`, `change_percent`, `elapsed` and the
 * `all_completed` join. Forms do not nest; a calculation reads inputs and other named calculations, resolved in dependency
 * order, and a host may also let it read a path, such as a bound work handle, of the attempt's pinned snapshot.
 * An unknown dependency keeps its reason and names the declared inputs that block it; an ambiguous or uncovered `cases`
 * lookup or a nonpositive baseline is an attributed invalid result. Unit or type mismatches throw: the validator
 * refuses those declarations before execution.
 * A join's member expressions are fixed; each attempt resolves them in its pinned snapshot to exact work occurrences
 * `(id, occurrence)` and reads those in the run's work state. It discovers no other work and never puts a reissue in
 * place of the occurrence a member names; a handle member names its current binding, so an authored replacement or
 * reissue changes it only on a later attempt. The join is true when every member is completed, false when one is known
 * not completed (pending, failed, cancellation requested or cancelled) and otherwise unknown. A member that names no
 * occurrence of this patient in the run, or an empty join, is an attributed invalid result.
 * Source: the resolved v1 contract, "Named inputs, values and conditions" and "Transfer and completion".
 */
import { compareQuantities, conditionNames, convert, parseCondition, unitDimension } from '../../logic/index.ts';
import type { Concepts } from '../../logic/index.ts';
import type { Calculation, Id, JsonValue, Operand, ResolvedInput, Table, WorkSnapshot } from '../types.ts';
import { byCodePoint, guardTruth, selectRow } from './select.ts';
import type { Values } from './select.ts';
import { elapsed } from './time.ts';

type Result = Values[string];
// The kernel's documented 12-significant-digit normalization.
const tidy = (n: number) => Number(n.toPrecision(12));
const known = (value: JsonValue): Result => ({ state: 'known', value });
const invalid = (detail: string): Result => ({ state: 'unknown', reason: 'invalid_value', detail });
// A type alias, not the Quantity interface, so a result is also a JsonValue.
type Q = { value: number; unit: string };
const isQuantity = (v: JsonValue): v is Q =>
 typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as Q).value === 'number' && typeof (v as Q).unit === 'string';
const isMap = (v: JsonValue): v is Readonly<Record<string, JsonValue>> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The run's projection of one work occurrence of this patient, or undefined when the run holds none. */
export type WorkLookup = (ref: { id: Id; occurrence: Id }) => Pick<WorkSnapshot, 'status'> | undefined;
/**
 * What a calculation may read beyond declared inputs and calculations, both from the attempt's pinned snapshot: `path`
 * reads any other name, such as a bound work handle; `occurrence` finds the work occurrence an `all_completed` member names.
 */
export interface CalculationReads { path?: (name: string) => Result; occurrence?: WorkLookup }

/** `a/b` → [a, b]; `/d` → ['', 'd']. Undefined for a unit with no denominator. */
const ratio = (unit: string): [string, string] | undefined => {
 const at = unit.lastIndexOf('/');
 return at < 0 ? undefined : [unit.slice(0, at), unit.slice(at + 1)];
};
/** A rate or per-weight quantity times a quantity of its denominator's dimension, cancelling that unit. */
function multiply(a: Q, b: Q): Q | undefined {
 const r = ratio(a.unit);
 if (!r || unitDimension(r[1]) === undefined || unitDimension(r[1]) !== unitDimension(b.unit)) return undefined;
 if (r[0] !== '' && unitDimension(r[0]) === undefined) return undefined;
 return { value: tidy(a.value * convert(b.value, b.unit, r[1])), unit: r[0] || '1' };
}

/**
 * Evaluate named calculations. Each result is a resolved value; a blocked one also lists, in `blocking`, the declared
 * inputs (not intermediate calculations) that keep it unknown. Throws on a dependency cycle, on a name that is not
 * declared when `reads.path` is absent, and on a join when `reads.occurrence` is absent.
 */
export function evaluateCalculations(calculations: Readonly<Record<string, Calculation>>, inputs: Values, concepts: Concepts = {}, requested?: readonly string[], reads: CalculationReads = {}): Record<string, Result> {
 const out: Record<string, Result> = {}, path: string[] = [];
 const get = (name: string): Result => {
  if (Object.hasOwn(inputs, name)) return inputs[name];
  if (Object.hasOwn(out, name)) return out[name];
  if (!Object.hasOwn(calculations, name)) {
   if (reads.path) return reads.path(name);
   throw new Error(`${name} is not a declared input or calculation.`);
  }
  if (path.includes(name)) throw new Error(`calculation cycle: ${[...path.slice(path.indexOf(name)), name].join(' → ')}`);
  path.push(name);
  const r = compute(calculations[name]);
  path.pop();
  return out[name] = r;
 };
 /** The unknown result for these blocking names: the first one's reason, and every underlying declared input. */
 const blocked = (names: readonly string[]): Result => {
  const first = get(names[0]) as { reason: string };
  const blocking = [...new Set(names.flatMap(n => get(n).blocking ?? [n]))].sort(byCodePoint);
  return { state: 'unknown', reason: first.reason, blocking };
 };
 const operand = (o: Operand): Result => 'input' in o ? get(o.input) : known(o.value);
 /** Read operands; the first unknown ones decide the result. */
 const operands = (list: readonly Operand[]): { values: JsonValue[] } | { unknown: Result } => {
  const open = list.filter(o => operand(o).state === 'unknown');
  if (open.length) return { unknown: blocked(open.map(o => (o as { input: string }).input)) };
  return { values: list.map(o => (operand(o) as { value: JsonValue }).value) };
 };
 /** A guard over the values its names resolve to. */
 const truth = (when: string) => {
  const parsed = parseCondition(when);
  if (!parsed.ok) throw new Error(`${when}: ${parsed.error.message}`);
  const local = Object.fromEntries(conditionNames(parsed.value).map(n => [n, get(n)]));
  return guardTruth(parsed.value, local, concepts);
 };
 const quantities = (values: JsonValue[], form: string): Q[] => values.map(v => {
  if (!isQuantity(v)) throw new Error(`${form} needs quantities, not ${JSON.stringify(v)}.`);
  return v;
 });
 /** One join member: whether the occurrence it names is completed, or unknown when it names none. */
 const member = (o: Operand): Result => {
  const r = operand(o);
  if (r.state === 'unknown') return r;
  const v = r.value;
  if (!isMap(v) || typeof v.id !== 'string' || typeof v.occurrence !== 'string') return invalid(`all_completed takes work references, not ${JSON.stringify(v)}`);
  if (!reads.occurrence) throw new Error('all_completed reads the run\'s work state, and none was supplied.');
  const w = reads.occurrence({ id: v.id, occurrence: v.occurrence });
  return w ? known(w.status === 'completed') : invalid(`work ${v.id}/${v.occurrence} is not an occurrence of this patient in this run`);
 };

 const compute = (c: Calculation): Result => {
  if ('when' in c) {
   const t = truth(c.when);
   return t.truth === 'unknown' ? blocked(t.blockedBy) : known(t.truth === 'true');
  }
  if ('cases' in c) {
   const rows = c.cases.map((k, i) => ({ id: String(i), rank: 1, ...truth(k.when) }));
   const s = selectRow(rows);
   if (s.result === 'unresolved') return blocked(s.unknown_inputs);
   if (s.result === 'ambiguous') return invalid(`cases ${s.conflict.join(', ')} all hold`);
   if (s.result === 'unmatched') return invalid('no case holds');
   const v = operand(c.cases[Number(s.rule)].value);
   return v.state === 'unknown' ? blocked([(c.cases[Number(s.rule)].value as { input: string }).input]) : v;
  }
  if ('multiply' in c) {
   const r = operands(c.multiply);
   if ('unknown' in r) return r.unknown;
   const [a, b] = quantities(r.values, 'multiply');
   const product = multiply(a, b) ?? multiply(b, a);
   if (!product) throw new Error(`Cannot multiply ${a.unit} by ${b.unit}: neither is a rate over the other's unit.`);
   return known(product);
  }
  if ('min' in c) {
   const r = operands(c.min);
   if ('unknown' in r) return r.unknown;
   const qs = quantities(r.values, 'min');
   return known(qs.reduce((least, q) => compareQuantities(q, least) < 0 ? q : least));
  }
  if ('change_percent' in c) {
   const r = operands([c.change_percent.from, c.change_percent.to]);
   if ('unknown' in r) return r.unknown;
   const [from, to] = quantities(r.values, 'change_percent');
   if (from.value <= 0) return invalid(`change_percent needs a positive baseline, not ${from.value} ${from.unit}`);
   return known({ value: tidy((convert(to.value, to.unit, from.unit) - from.value) / from.value * 100), unit: '%' });
  }
  if ('elapsed' in c) {
   const e = c.elapsed, r = operands([e.from, e.to]);
   if ('unknown' in r) return r.unknown;
   const [from, to] = r.values;
   if (typeof from !== 'string' || typeof to !== 'string') return invalid(`elapsed needs times, not ${JSON.stringify(typeof from === 'string' ? to : from)}`);
   return elapsed(from, to, e.unit, e.basis, e.dates_in) as ResolvedInput;
  }
  if (!c.all_completed.length) return invalid('all_completed needs at least one work occurrence');
  const members = c.all_completed.map(member);
  if (members.some(m => m.state === 'known' && m.value === false)) return known(false);
  const open = c.all_completed.filter((_, i) => members[i].state === 'unknown');
  if (!open.length) return known(true);
  const first = members[c.all_completed.indexOf(open[0])] as { reason: string; detail?: string };
  const blocking = [...new Set(open.flatMap(o => 'input' in o ? get(o.input).blocking ?? [o.input] : []))].sort(byCodePoint);
  return { state: 'unknown', reason: first.reason, ...(first.detail ? { detail: first.detail } : {}), blocking };
 };
 for (const name of requested ?? Object.keys(calculations)) get(name);
 return out;
}

/** Names read by this table's guards and effect values, before following calculation dependencies. */
export function tableNamesRead(table: Table): string[] {
 const names: string[] = [];
 const walk = (x: unknown): void => {
  if (Array.isArray(x)) x.forEach(walk);
  else if (x !== null && typeof x === 'object') {
   const value = x as Record<string, unknown>;
   if (typeof value.input === 'string' && Object.keys(value).length === 1) names.push(value.input);
   else Object.values(value).forEach(walk);
  }
 };
 for (const rule of table.rules) {
  for (const condition of [rule.when, ...rule.effects.flatMap(effect => effect.when === undefined ? [] : [effect.when])]) {
   const parsed = parseCondition(condition);
   if (parsed.ok) names.push(...conditionNames(parsed.value));
  }
  walk(rule.effects);
 }
 return names.sort(byCodePoint);
}

/** Names one calculation reads, before following other calculations. */
export function calculationNamesRead(c: Calculation): string[] {
 const names: string[] = [];
 const op = (o: Operand) => { if ('input' in o) names.push(o.input); };
 const cond = (text: string) => { const parsed = parseCondition(text); if (parsed.ok) names.push(...conditionNames(parsed.value)); };
 if ('when' in c) cond(c.when);
 else if ('cases' in c) c.cases.forEach(k => { cond(k.when); op(k.value); });
 else if ('multiply' in c) c.multiply.forEach(op);
 else if ('min' in c) c.min.forEach(op);
 else if ('change_percent' in c) [c.change_percent.from, c.change_percent.to].forEach(op);
 else if ('elapsed' in c) [c.elapsed.from, c.elapsed.to].forEach(op);
 else c.all_completed.forEach(op);
 return names;
}
