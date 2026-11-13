import { historyFunctions, printCondition } from './grammar.ts';
import type { CompareOp, Concepts, Expr } from './grammar.ts';
import { compareQuantities } from './units.ts';
import type { Quantity } from './units.ts';

/** A finding's value: yes/no (booleans or the words), a number, a listed value, a quantity with its unit, or a list that includes() tests. */
export type Value = boolean | number | string | Quantity | readonly (boolean | number | string)[];
export type Finding = { status: 'known'; value: Value } | { status: 'unknown'; reason?: string };
/** The record a condition reads. A concept with no entry is unknown. */
export type Findings = Readonly<Record<string, Finding>>;
/**
 * A three-valued result: true, false, or `undefined` for unknown. A rule fires only when `value === true`.
 * Decided: `decidedBy` names the findings that decided it, and `blockedBy` is empty.
 * Unknown: `blockedBy` names the unknown findings that kept it open, and `decidedBy` the known ones it read.
 */
export interface Evaluation { value: boolean | undefined; decidedBy: string[]; blockedBy: string[] }
interface Operand { value: Value | undefined; name?: string; literal: boolean }

const unique = (names: string[]) => [...new Set(names)];
const yesNo = (v: Value): Value => v === 'yes' ? true : v === 'no' ? false : v;
const isQuantity = (v: unknown): v is Quantity => typeof v === 'object' && v !== null && typeof (v as Quantity).value === 'number' && typeof (v as Quantity).unit === 'string';
const show = (v: Value) => isQuantity(v) ? `${v.value} ${v.unit}` : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
const decided = (value: boolean, decidedBy: string[] = []): Evaluation => ({ value, decidedBy: unique(decidedBy), blockedBy: [] });
const merge = (value: boolean | undefined, parts: Evaluation[]): Evaluation =>
 ({ value, decidedBy: unique(parts.flatMap(p => p.decidedBy)), blockedBy: unique(parts.flatMap(p => p.blockedBy)) });
const holds = (op: CompareOp, order: number) =>
 op === '==' ? order === 0 : op === '!=' ? order !== 0 : op === '<' ? order < 0 : op === '<=' ? order <= 0 : op === '>' ? order > 0 : order >= 0;

/** Strong Kleene: one decisive part decides (false for `and`, true for `or`); else any unknown part leaves it unknown. */
function junction(kind: 'and' | 'or', parts: Evaluation[]): Evaluation {
 const decisive = kind === 'or', hits = parts.filter(p => p.value === decisive);
 if (hits.length) return merge(decisive, hits);
 return merge(parts.every(p => p.value === !decisive) ? !decisive : undefined, parts);
}

function noHistory(e: Expr & { kind: 'call' }): never {
 throw new Error(`${e.fn}() needs the patient's history. Evaluate the derived concept it defines instead.`);
}

/**
 * Evaluate a condition in strong Kleene logic. A comparison with an unknown operand is unknown; `not` of unknown
 * is unknown; `known()`, `unknown()` and `any_unknown()` are never unknown; `any()`/`all()` are the Kleene
 * or/and of their findings. A bare number compared with a concept takes the concept's declared unit.
 * Throws on a type error: a dimension mismatch, a number with no unit against a quantity, an order on words.
 */
export function evaluate(condition: Expr, findings: Findings, concepts: Concepts = {}): Evaluation {
 const lookup = (name: string) => Object.hasOwn(findings, name) ? findings[name] : undefined;
 const known = (name: string) => lookup(name)?.status === 'known';
 const declaredUnit = (name: string | undefined) => name !== undefined && Object.hasOwn(concepts, name) ? concepts[name].unit : undefined;
 const argName = (a: Expr) => { if (a.kind !== 'name') throw new Error(`Expected a concept name, not '${printCondition(a)}'.`); return a.name; };

 const findingTruth = (name: string): Evaluation => {
  const f = lookup(name);
  if (f?.status !== 'known') return { value: undefined, decidedBy: [], blockedBy: [name] };
  const v = yesNo(f.value);
  if (typeof v !== 'boolean') throw new Error(`${name} is ${show(f.value)}, not yes or no, so it cannot stand as a condition.`);
  return decided(v, [name]);
 };
 const operand = (e: Expr): Operand => {
  switch (e.kind) {
   case 'number': return { value: e.unit ? { value: e.value, unit: e.unit } : e.value, literal: true };
   case 'string': case 'word': return { value: yesNo(e.value), literal: true };
   case 'boolean': return { value: e.value, literal: true };
   case 'name': {
    const f = lookup(e.name), unit = declaredUnit(e.name);
    if (f?.status !== 'known') return { value: undefined, name: e.name, literal: false };
    return { value: typeof f.value === 'number' && unit ? { value: f.value, unit } : yesNo(f.value), name: e.name, literal: false };
   }
   case 'call': if (historyFunctions.has(e.fn)) return noHistory(e);
  }
  throw new Error(`'${printCondition(e)}' is a condition; a comparison needs a value on each side.`);
 };
 // A bare number literal takes the declared unit of the concept on the other side; anything else is an error.
 const withUnit = (n: number, bare: Operand, other: Operand, q: Quantity, e: Expr): Quantity => {
  const unit = bare.literal ? declaredUnit(other.name) : undefined;
  if (unit) return { value: n, unit };
  throw new Error(bare.literal
   ? `In ${printCondition(e)}: ${n} has no unit and ${other.name ?? 'the other side'} is ${show(q)}. Give the number its unit, or declare the concept's unit.`
   : `In ${printCondition(e)}: ${bare.name} is the bare number ${n} and declares no unit, so it cannot be compared with ${show(q)}.`);
 };
 const test = (e: Expr & { kind: 'compare' }, l: Operand, r: Operand): boolean => {
  let a = l.value as Value, b = r.value as Value;
  if (Array.isArray(a) || Array.isArray(b)) throw new Error(`Cannot compare a list in ${printCondition(e)}. Test membership with includes(list, value).`);
  if (typeof a === 'number' && isQuantity(b)) a = withUnit(a, l, r, b, e);
  if (typeof b === 'number' && isQuantity(a)) b = withUnit(b, r, l, a, e);
  if (isQuantity(a) && isQuantity(b)) {
   try { return holds(e.op, compareQuantities(a, b)); } catch (error) { throw new Error(`In ${printCondition(e)}: ${(error as Error).message}`); }
  }
  if (typeof a === 'number' && typeof b === 'number') return holds(e.op, Math.sign(a - b));
  if (typeof a !== typeof b || isQuantity(a) || isQuantity(b)) throw new Error(`Cannot compare ${show(a)} with ${show(b)} in ${printCondition(e)}.`);
  if (e.op !== '==' && e.op !== '!=') {
   // An ordered concept's listed values have an order: `hypertension.regimen >= dual_therapy`.
   const name = l.name ?? r.name, c = name !== undefined && Object.hasOwn(concepts, name) ? concepts[name] : undefined;
   const at = (v: Value) => c?.ordered && c.values ? c.values.indexOf(String(v)) : -1;
   if (at(a) >= 0 && at(b) >= 0) return holds(e.op, Math.sign(at(a) - at(b)));
   throw new Error(`Cannot use ${e.op} on ${show(a)} and ${show(b)} in ${printCondition(e)}: only numbers, quantities and the values of an ordered concept have an order.`);
  }
  return (a === b) === (e.op === '==');
 };
 const compare = (e: Expr & { kind: 'compare' }): Evaluation => {
  const l = operand(e.left), r = operand(e.right), names = [l, r].flatMap(o => o.name ? [o.name] : []);
  if (l.value === undefined || r.value === undefined) return { value: undefined, decidedBy: unique(names.filter(known)), blockedBy: unique(names.filter(n => !known(n))) };
  return decided(test(e, l, r), names);
 };
 const call = (e: Expr & { kind: 'call' }): Evaluation => {
  if (historyFunctions.has(e.fn)) return noHistory(e);
  if (e.fn === 'includes') {
   const list = argName(e.args[0]), f = lookup(list), literal = e.args[1];
   if (!['word', 'string', 'boolean', 'number'].includes(literal.kind)) throw new Error('includes() needs a literal member.');
   const member = (literal as Extract<Expr, { kind: 'word' | 'string' | 'boolean' | 'number' }>).value;
   if (f?.status !== 'known') return { value: undefined, decidedBy: [], blockedBy: [list] };
   if (!Array.isArray(f.value)) throw new Error(`${list} is ${show(f.value)}, not a list, so includes() cannot test it.`);
   return decided((f.value as readonly Value[]).includes(member as Value), [list]);
  }
  const names = e.args.map(argName);
  switch (e.fn) {
   case 'known': return decided(known(names[0]), names);
   case 'unknown': return decided(!known(names[0]), names);
   case 'any_unknown': { const open = names.filter(n => !known(n)); return decided(open.length > 0, open.length ? open : names); }
   case 'any': return junction('or', names.map(findingTruth));
   case 'all': return junction('and', names.map(findingTruth));
   default: throw new Error(`Unknown function '${e.fn}'.`);
  }
 };
 const truth = (e: Expr): Evaluation => {
  switch (e.kind) {
   case 'boolean': return decided(e.value);
   case 'name': return findingTruth(e.name);
   case 'not': { const r = truth(e.arg); return { ...r, value: r.value === undefined ? undefined : !r.value }; }
   case 'and': case 'or': return junction(e.kind, e.args.map(truth));
   case 'compare': return compare(e);
   case 'call': return call(e);
   default: throw new Error(`'${printCondition(e)}' is a value, not a condition.`);
  }
 };
 return truth(condition);
}
