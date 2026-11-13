/**
 * Level 3's section analysis: which rules can fire, which overlap, where an unknown input lands, whether a danger
 * input's unknown case lands less urgently than a known value would, and whether a dose input can be unknown.
 * General unknown landings check a rule's sole blocker; danger landings compare the same case with known values,
 * including cases caught by earlier rules and conditions that test known or unknown explicitly.
 *
 * Every question is "is there a case where …": a set of constraints over test points, the points `analyzeTable`
 * takes (each threshold, either side of it, each listed value, yes and no, and unknown). A first-hit section's
 * cross product can run to hundreds of millions of cases (chw-assess has 16 inputs), so instead of enumerating it,
 * the constraints are split into groups that share no input, and each group is searched on its own, depth first,
 * rejecting a partial case when no completion can meet a constraint. Complete cases still pass the exact checks.
 * Input and test-point order stay unchanged, so the answers and first examples are the ones full enumeration
 * gives. Derived concepts are read as inputs of their own, as a table reads its columns; one whose definition reads
 * few inputs (at most 1,000 combinations of their test points) is also tied to them, so that no case pairs values
 * the definitions rule out (`bp.very_high` yes with `bp.above_target` no). A larger one (`danger.any` reads 16
 * inputs) stays free, and its cases may include such pairs. If a search reaches its limit, the whole section
 * analysis throws TooMany: an unfinished search proves nothing.
 */
import { conditionNames, convert, evaluate, parseCondition, testPoints } from '../logic/index.ts';
import type { Concepts, Expr, Finding, Findings, Point } from '../logic/index.ts';
import { evaluateCalculations } from './runtime/calculations.ts';
import { byCodePoint, guardTruth, outcomeKey, selectRow } from './runtime/select.ts';
import type { RowTruth, SelectionRule } from './runtime/select.ts';
import type { Calculation, HitPolicy, Id, JsonValue, Operand, ResolvedInput, SelectionResult, Table, TableRule, TypeDescriptor } from './types.ts';
export { testPoints } from '../logic/index.ts';
export type { Point } from '../logic/index.ts';

/** A condition on a case, and the inputs it reads (it may read no others). */
export interface Constraint {
 reads: readonly string[];
 holds: (findings: Findings) => boolean;
 /** False only when no completion can hold. Missing entries are unassigned, not unknown findings. */
 possible?: (findings: Findings) => boolean;
}
/** A search stopped at its limit, so the section analysis is unfinished. */
export class TooMany extends Error {}
const maxSteps = 200_000;

/** A case that meets every constraint, as the test point picked for each input read; undefined when there is none. */
export function solve(constraints: readonly Constraint[], axes: ReadonlyMap<string, readonly Point[]>): Record<string, Point> | undefined {
 const root = new Map<string, string>();
 const find = (n: string): string => { let r = n; while (root.get(r) !== r) r = root.get(r)!; return r; };
 for (const c of constraints) for (const n of c.reads) if (!root.has(n)) root.set(n, n);
 for (const c of constraints) for (const n of c.reads.slice(1)) root.set(find(n), find(c.reads[0]));
 const groups = new Map<string, Constraint[]>();
 for (const c of constraints) {
  if (!c.reads.length) { if (!c.holds({})) return undefined; continue; }
  const r = find(c.reads[0]);
  groups.set(r, [...groups.get(r) ?? [], c]);
 }
 const example: Record<string, Point> = {};
 for (const group of groups.values()) {
  const found = search(group, axes);
  if (!found) return undefined;
  Object.assign(example, found);
 }
 return example;
}

const unknownOnly: readonly Point[] = [{ label: 'known', finding: { status: 'known', value: true } }, { label: 'unknown', finding: { status: 'unknown' } }];

function search(group: readonly Constraint[], axes: ReadonlyMap<string, readonly Point[]>): Record<string, Point> | undefined {
 const order = [...new Set(group.flatMap(c => c.reads))], index = new Map(order.map((n, i) => [n, i]));
 const ready: Constraint[][] = order.map(() => []), pending: Constraint[][] = order.map(() => []);
 for (const c of group) {
  const positions = c.reads.map(n => index.get(n)!), last = Math.max(...positions);
  ready[last].push(c);
  if (c.possible) for (let k = Math.min(...positions); k < last; k++) pending[k].push(c);
 }
 const findings: Record<string, Finding> = {}, picked: Record<string, Point> = {};
 let steps = 0;
 const go = (k: number): boolean => {
  if (k === order.length) return true;
  for (const p of axes.get(order[k]) ?? unknownOnly) {
   if (++steps > maxSteps) throw new TooMany(`The search stopped at its limit of ${maxSteps.toLocaleString('en-US')} cases over ${order.join(', ')}.`);
   findings[order[k]] = p.finding; picked[order[k]] = p;
   if (ready[k].every(c => c.holds(findings)) && pending[k].every(c => c.possible!(findings)) && go(k + 1)) return true;
  }
  delete findings[order[k]]; delete picked[order[k]];
  return false;
 };
 return go(0) ? { ...picked } : undefined;
}

/** A rule as the analysis reads it: `otherwise` is the condition `true`; higher rank is more urgent (default 0). */
export interface Row { id: string; when: Expr; otherwise: boolean; rank?: number }
/** An output that gives a medicine, and the inputs its dose reads. */
export interface Giving { id: string; on: readonly string[]; when?: Expr; inputs: readonly string[] }
export interface Facts {
 hit: 'first' | 'unique'; rows: readonly Row[]; gives: readonly Giving[]; applies: readonly Expr[]; concepts: Concepts;
 /** Derived concepts' definitions over current values (no history). */
 definitions: ReadonlyMap<string, Expr>;
 /** Inputs whose unknown case must land at least as urgently as a known value would. */
 dangers?: readonly string[];
}
/** Where a case lands, and the inputs of one such case that the rules involved read. */
export interface Landing { rule: string; example: Record<string, string> }
export interface Report {
 /** Rules that never fire: never the first true rule (first), or never true (unique, and `neverTrue` in both). */
 neverFires: { rule: string; neverTrue: boolean }[];
 /** Unique: pairs of rules true in the same case. */
 overlaps: { rules: [string, string]; example: Record<string, string> }[];
 /** For a rule and an input it reads: where a case lands when that input alone leaves the rule unknown. */
 unknown: { rule: string; input: string; lands: Landing[] }[];
 /** For a medicine output and an input of its dose: the rules that still give it when that input is unknown. */
 doses: { output: string; input: string; lands: Landing[] }[];
 /** For a danger input and the rule a known value reaches: the less urgent rules the unknown case lands on. */
 dangers: { input: string; rule: string; lands: Landing[] }[];
}

export const always: Expr = { kind: 'boolean', value: true, at: 0 };

// Sets of possible kernel truth values. OTHER_UNKNOWN tracks an unknown with a blocker other than the one
// requested by a sole-blocker query. A decisive and/or branch can still hide that blocker, as in the kernel.
const YES = 1, NO = 2, UNKNOWN_TRUTH = 4, OTHER_UNKNOWN = 8;
const truthBit = (v: boolean | undefined) => v === true ? YES : v === false ? NO : UNKNOWN_TRUTH;
type Possibilities = (findings: Findings) => number;

/** Pruning must not hide eager kernel errors. Check atomic terms over their domains, without a section product. */
function safeToPrune(e: Expr, axes: ReadonlyMap<string, readonly Point[]>, concepts: Concepts): boolean {
 if (e.kind === 'and' || e.kind === 'or') return e.args.every(a => safeToPrune(a, axes, concepts));
 if (e.kind === 'not') return safeToPrune(e.arg, axes, concepts);
 if (e.kind === 'call' && (e.fn === 'any' || e.fn === 'all')) {
  return e.args.every(a => a.kind === 'name' && safeToPrune(a, axes, concepts));
 }
 try {
  if (e.kind === 'call' && ['known', 'unknown', 'any_unknown'].includes(e.fn)) {
   evaluate(e, {}, concepts); // Knownness does not inspect the value's type.
   return true;
  }
  const reads = conditionNames(e);
  if (reads.length > 1) return false; // An unsupported atom keeps the original bounded search.
  if (!reads.length) evaluate(e, {}, concepts);
  else for (const p of axes.get(reads[0]) ?? unknownOnly) evaluate(e, { [reads[0]]: p.finding }, concepts);
  return true;
 } catch {
  // Do not report an error here: scope constraints can exclude every case that would cause it.
  return false;
 }
}

/** Compile a conservative truth set for partial cases. Correlations can add possibilities, never remove one. */
function possibilities(e: Expr, value: (e: Expr, fs: Findings) => ReturnType<typeof evaluate>, blocker?: string): Possibilities {
 const combine = (kind: 'and' | 'or', parts: Possibilities[]): Possibilities => fs => {
  const values = parts.map(p => p(fs)), decisive = kind === 'and' ? NO : YES, neutral = kind === 'and' ? YES : NO;
  return (values.some(v => v & decisive) ? decisive : 0)
   | (values.every(v => v & neutral) ? neutral : 0)
   | (values.every(v => v & (neutral | UNKNOWN_TRUTH)) && values.some(v => v & UNKNOWN_TRUTH) ? UNKNOWN_TRUTH : 0)
   | (values.every(v => v & (neutral | UNKNOWN_TRUTH | OTHER_UNKNOWN)) && values.some(v => v & OTHER_UNKNOWN) ? OTHER_UNKNOWN : 0);
 };
 const compile = (part: Expr) => possibilities(part, value, blocker);
 if (e.kind === 'and' || e.kind === 'or') return combine(e.kind, e.args.map(compile));
 if (e.kind === 'not') {
  const arg = compile(e.arg);
  return fs => { const v = arg(fs); return ((v & YES) ? NO : 0) | ((v & NO) ? YES : 0) | (v & (UNKNOWN_TRUTH | OTHER_UNKNOWN)); };
 }
 if (e.kind === 'call') {
  if (e.fn === 'any' || e.fn === 'all') return combine(e.fn === 'any' ? 'or' : 'and', e.args.map(compile));
  if (e.fn === 'known' || e.fn === 'unknown' || e.fn === 'any_unknown') {
   const checks: Possibilities[] = e.args.map(arg => fs => {
    if (arg.kind !== 'name') return truthBit(value(e, fs).value); // Let the kernel report invalid arguments.
    if (!Object.hasOwn(fs, arg.name)) return YES | NO;
    const known = fs[arg.name].status === 'known';
    return truthBit(e.fn === 'known' ? known : !known);
   });
   return combine('or', checks);
  }
 }
 const reads = conditionNames(e);
 return fs => {
  if (!reads.every(n => Object.hasOwn(fs, n))) {
   return YES | NO | (blocker === undefined || reads.includes(blocker) ? UNKNOWN_TRUTH : 0)
    | (blocker !== undefined && reads.some(n => n !== blocker) ? OTHER_UNKNOWN : 0);
  }
  // Comparisons, units, ordered values and list membership retain the kernel's exact semantics and errors.
  const v = value(e, fs);
  return v.value === undefined && blocker !== undefined && v.blockedBy.some(n => n !== blocker) ? OTHER_UNKNOWN : truthBit(v.value);
 };
}

/** Analyse one section. Throws TooMany at the search limit, or an evaluation error (unit or type), naming the rule. */
export function analyseSection(f: Facts): Report {
 const { rows, concepts } = f;
 const read = [...rows.map(r => r.when), ...f.applies, ...f.gives.flatMap(g => g.when ? [g.when] : [])];
 const defined = new Map<string, Expr>(), queue = read.flatMap(conditionNames);
 for (let n = queue.pop(); n !== undefined; n = queue.pop()) {
  const def = f.definitions.get(n);
  if (def && !defined.has(n)) { defined.set(n, def); queue.push(...conditionNames(def)); }
 }
 const axes = testPoints([...read, ...defined.values()], concepts, f.gives.flatMap(g => g.inputs));
 const prune = [...read, ...defined.values()].every(e => safeToPrune(e, axes, concepts));
 const value = (id: string, e: Expr, findings: Findings) => {
  try { return evaluate(e, findings, concepts); } catch (error) { throw new Error(`${id}: ${(error as Error).message}`); }
 };
 const possible = (id: string, e: Expr, mask: number, blocker?: string) => {
  const values = possibilities(e, (part, fs) => value(id, part, fs), blocker);
  return (fs: Findings) => (values(fs) & mask) !== 0;
 };
 const is = (id: string, e: Expr): Constraint => ({ reads: conditionNames(e), holds: fs => value(id, e, fs).value === true, possible: possible(id, e, YES) });
 const not = (r: Row): Constraint => ({ reads: conditionNames(r.when), holds: fs => value(r.id, r.when, fs).value !== true, possible: possible(r.id, r.when, NO | UNKNOWN_TRUTH) });
 const blocked = (r: Row, x: string): Constraint => {
  const canBlock = possible(r.id, r.when, UNKNOWN_TRUTH, x);
  return { reads: conditionNames(r.when), holds: fs => { const v = value(r.id, r.when, fs); return v.value === undefined && v.blockedBy.length === 1 && v.blockedBy[0] === x; },
   possible: fs => fs[x]?.status !== 'known' && canBlock(fs) };
 };
 const unknown = (x: string): Constraint => ({ reads: [x], holds: fs => fs[x]?.status !== 'known' });
 // A derived concept tied to its definition: its value is the definition's value. Read before the concept, so the
 // search sets the definition's inputs first and the concept follows.
 const truth = (x: Finding | undefined) => x?.status !== 'known' ? undefined : x.value === true || x.value === 'yes' ? true : x.value === false || x.value === 'no' ? false : null;
 const links = [...defined]
  .filter(([name, def]) => axes.get(name)?.every(p => truth(p.finding) !== null) && conditionNames(def).reduce((n, x) => n * (axes.get(x)?.length ?? 1), 1) <= 1000)
  .map(([name, def]) => {
   const values = possibilities(def, (part, fs) => value(name, part, fs));
   return { name, constraint: { reads: [...conditionNames(def), name], holds: (fs: Findings) => truth(fs[name]) === value(name, def, fs).value,
    possible: (fs: Findings) => !Object.hasOwn(fs, name) || (values(fs) & truthBit(truth(fs[name]) as boolean | undefined)) !== 0 } };
  });
 const tied = (cs: Constraint[]) => {
  const names = new Set(cs.flatMap(c => c.reads)), used: Constraint[] = [];
  for (let grew = true; grew;) {
   grew = false;
   for (const l of links) if (names.has(l.name) && !used.includes(l.constraint)) { used.push(l.constraint); l.constraint.reads.forEach(n => names.add(n)); grew = true; }
  }
  return [...used, ...cs];
 };
 const applies = f.applies.map(e => is('appliesTo', e));
 const earlier = (k: number) => f.hit === 'first' ? rows.slice(0, k) : rows.filter((r, j) => j !== k && !r.otherwise);
 const lands = (k: number, skip?: Row) => [...earlier(k).filter(r => r !== skip).map(not), is(rows[k].id, rows[k].when)];
 const report: Report = { neverFires: [], overlaps: [], unknown: [], doses: [], dangers: [] };
 const find = (constraints: Constraint[]) => {
  const cs = tied([...applies, ...constraints]);
  // Disable all partial checks when a term can throw. Even another constraint's pruning could hide that error.
  return solve(prune ? cs : cs.map(({ reads, holds }) => ({ reads, holds })), axes);
 };
 const show = (example: Record<string, Point>, ...es: (Expr | undefined)[]) => {
  const names = new Set(es.flatMap(e => e ? conditionNames(e) : []));
  return Object.fromEntries(Object.entries(example).filter(([n]) => names.has(n)).map(([n, p]) => [n, p.label]));
 };

 rows.forEach((r, k) => {
  if (r.otherwise) return;
  const neverTrue = !find([is(r.id, r.when)]);
  if (neverTrue || (f.hit === 'first' && !find(lands(k)))) report.neverFires.push({ rule: r.id, neverTrue });
  if (f.hit === 'unique') for (const s of rows.slice(k + 1)) {
   if (s.otherwise) continue;
   const both = find([is(r.id, r.when), is(s.id, s.when)]);
   if (both) report.overlaps.push({ rules: [r.id, s.id], example: show(both, r.when, s.when) });
  }
 });

 rows.forEach(u => {
  if (u.otherwise) return;
  for (const x of conditionNames(u.when)) {
   const found: Landing[] = [];
   rows.forEach((l, k) => {
    if (l === u || !earlier(k).includes(u)) return;
    const ex = find([...lands(k, u), blocked(u, x)]);
    if (ex) found.push({ rule: l.id, example: show(ex, u.when, l.when) });
   });
   if (found.length) report.unknown.push({ rule: u.id, input: x, lands: found });
  }
 });

 for (const g of f.gives) for (const d of g.inputs) {
  const found: Landing[] = [];
  rows.forEach((l, k) => {
   if (!g.on.includes(l.id)) return;
   const ex = find([...lands(k), ...g.when ? [is(g.id, g.when)] : [], unknown(d)]);
   if (ex) found.push({ rule: l.id, example: { ...show(ex, l.when, g.when), [d]: ex[d]?.label ?? 'unknown' } });
  });
  if (found.length) report.doses.push({ output: g.id, input: d, lands: found });
 }
 // The same constraint read in the case where x has a known value instead of being unknown.
 const assessed = (x: string, p: Point, c: Constraint): Constraint => ({ reads: c.reads, holds: fs => c.holds({ ...fs, [x]: p.finding }),
  ...(c.possible ? { possible: (fs: Findings) => c.possible!({ ...fs, [x]: p.finding }) } : {}) });
 for (const x of f.dangers ?? []) {
  const known = (axes.get(x) ?? []).filter(p => p.finding.status === 'known');
  rows.forEach((u, j) => {
   const found: Landing[] = [];
   rows.forEach((l, k) => {
    if ((l.rank ?? 0) >= (u.rank ?? 0)) return;
    for (const p of known) {
     const ex = find([unknown(x), ...lands(k), ...lands(j).map(c => assessed(x, p, c))]);
     if (ex) { found.push({ rule: l.id, example: { ...show(ex, u.when, l.when), [x]: 'unknown' } }); break; }
    }
   });
   if (found.length) report.dangers.push({ input: x, rule: u.id, lands: found });
  });
 }
 return report;
}


// ── Protocol language v1 (`abrazos.protocol/v1`): bounded level-3 selection and cycle analysis ──────────────────
// The analysis enumerates a finite domain for each name the enabled rows read and runs the runtime's own guard truth
// (runtime/select.ts guardTruth, strong Kleene) and rank function (selectRow) on every case, so a finding is a case on
// which the runtime itself would be ambiguous or unmatched. Unknown is a value of every non-parameter name, never false.
// The domain is exact for yes/no, listed values, counts, numbers and quantities compared with literals or parameters,
// identifiers and revisions compared with literals or parameters, and lists tested with `includes`.
// Comparisons between two identifier or revision names and other unsupported cases are sampled. Their analysis
// is `incomplete` with its limit: a witness found is still a finding, but no absence is proved.
// Source: the resolved v1 contract, "Exact selection" and "Validation and evidence reports".

/** One name a guard reads: a declared input or typed path, a fixed parameter, or a named calculation. */
export type AxisSpec =
 | { kind: 'input'; type?: TypeDescriptor }
 | { kind: 'parameter'; type: TypeDescriptor; value: JsonValue }
 | { kind: 'calculation'; calculation: Calculation; type?: TypeDescriptor };
export interface SelectionSpec {
 hit?: HitPolicy;
 /** The site's state IDs: a `*` row is enabled in each. */
 states: readonly Id[];
 rows: readonly SelectionRule[];
 /** Every name the guards read, and every name an expanded calculation reads. */
 axes: Readonly<Record<string, AxisSpec>>;
 concepts: Concepts;
 /** Cases examined per set of enabled rows before the search stops; default MAX_CASES. */
 maxCases?: number;
}
export interface SelectionFinding {
 kind: 'overlap' | 'coverage_gap';
 /** The states whose enabled rows give this result. */
 states: Id[];
 /** Overlap: the conflicting rows at the deciding rank. Gap: every enabled row, all false. */
 rows: Id[];
 /** The first case found, as replayable supplied values; `{unknown: 'absent'}` for an unknown. */
 witness: Record<string, JsonValue>;
 /** Cases examined with this result. */
 cases: number;
 /** The case samples a calculation that is not expanded, so it is not a validated witness. */
 candidate: boolean;
}
export interface SelectionAnalysis {
 status: 'complete' | 'incomplete';
 /** The examined values of each name. */
 domain: string;
 limits: string[];
 /** Only identifier/revision comparisons between names limit this completed sample search. */
 sampledOnly?: true;
 findings: SelectionFinding[];
 /** How many examined cases gave each selection result. */
 outcomes: Partial<Record<SelectionResult['result'], number>>;
}

/** Cases examined per set of enabled rows. A larger table is reported `incomplete` at this bound. */
export const MAX_CASES = 20_000;
/** A list is enumerated as the subsets of the literals `includes` tests, up to this many literals. */
const MAX_LIST_LITERALS = 6;
const UNKNOWN: ResolvedInput = { state: 'unknown', reason: 'absent' };

interface Uses { thresholds: { value: number; unit?: string }[]; literals: Set<string>; relational: Set<string>; members: Set<string> }
interface VPoint { label: string; value: ResolvedInput }

const parse = (text: string): Expr => {
 const r = parseCondition(text);
 if (!r.ok) throw new Error(`${text}: ${r.error.message}`);
 return r.value;
};
const expandable = (c: Calculation): boolean => 'when' in c || ('cases' in c && c.cases.every(k => 'value' in k.value));
const calcConditions = (c: Calculation): string[] => 'when' in c ? [c.when] : 'cases' in c ? c.cases.map(k => k.when) : [];
const calcReads = (c: Calculation): string[] => {
 const names = calcConditions(c).flatMap(t => conditionNames(parse(t)));
 const op = (o: Operand) => { if ('input' in o) names.push(o.input); };
 if ('cases' in c) c.cases.forEach(k => op(k.value));
 else if ('multiply' in c) c.multiply.forEach(op);
 else if ('min' in c) c.min.forEach(op);
 else if ('change_percent' in c) { op(c.change_percent.from); op(c.change_percent.to); }
 else if ('elapsed' in c) { op(c.elapsed.from); op(c.elapsed.to); }
 else if ('all_completed' in c) c.all_completed.forEach(op);
 return names;
};
const calcForm = (c: Calculation) => Object.keys(c)[0];

/** Where each name meets a threshold, a literal, another name, or an `includes` member. */
function uses(exprs: readonly Expr[], axes: SelectionSpec['axes']): Map<string, Uses> {
 const out = new Map<string, Uses>();
 const of = (n: string) => { let u = out.get(n); if (!u) out.set(n, u = { thresholds: [], literals: new Set(), relational: new Set(), members: new Set() }); return u; };
 const walk = (e: Expr): void => {
  switch (e.kind) {
   case 'not': walk(e.arg); break;
   case 'and': case 'or': e.args.forEach(walk); break;
   case 'name': of(e.name); break;
   case 'call':
    if (e.fn === 'includes' && e.args[0]?.kind === 'name') { const m = e.args[1]; if (m && (m.kind === 'word' || m.kind === 'string' || m.kind === 'name')) of(e.args[0].name).members.add(m.kind === 'name' ? m.name : m.value); }
    else for (const a of e.args) if (a.kind === 'name') of(a.name);
    break;
   case 'compare':
    for (const [side, other] of [[e.left, e.right], [e.right, e.left]] as const) {
     if (side.kind !== 'name') continue;
     const u = of(side.name), p = other.kind === 'name' ? axes[other.name] : undefined;
     if (other.kind === 'number') u.thresholds.push({ value: other.value, unit: other.unit });
     else if (other.kind === 'word' || other.kind === 'string') u.literals.add(other.value);
     else if (other.kind === 'boolean') u.literals.add(other.value ? 'yes' : 'no');
     else if (p?.kind === 'parameter') {
      const v = p.value;
      if (typeof v === 'number') u.thresholds.push({ value: v });
      else if (isQuantity(v)) u.thresholds.push({ value: v.value, unit: v.unit });
      else if (typeof v === 'string') u.literals.add(v);
      else if (typeof v === 'boolean') u.literals.add(v ? 'yes' : 'no');
     } else if (other.kind === 'name') u.relational.add(other.name);
    }
    break;
   default:
  }
 };
 exprs.forEach(walk);
 return out;
}

const isQuantity = (v: JsonValue): v is { value: number; unit: string } =>
 typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as { value?: unknown }).value === 'number' && typeof (v as { unit?: unknown }).unit === 'string';
const EQUALITY_TYPES = new Set(['identifier', 'revision']);
const NUMERIC_KINDS = new Set(['count', 'number', 'quantity']);

/** The finite points of one name, and the limit when they do not cover its type. */
function points(name: string, axis: AxisSpec, u: Uses | undefined, tokens: readonly string[]): { points: VPoint[]; limit?: string } {
 const known = (value: JsonValue, label: string): VPoint => ({ label, value: { state: 'known', value } });
 if (axis.kind === 'parameter') return { points: [known(axis.value, JSON.stringify(axis.value))] };
 const type = axis.type, out: VPoint[] = [];
 let limit: string | undefined = axis.kind === 'calculation' ? `${name} is a ${calcForm(axis.calculation)} calculation the analysis does not expand; its values are sampled apart from its inputs` : undefined;
 // Finite types enumerate their values. Numeric comparisons need a separate limit here;
 // identifier/revision comparisons also need a limit, even when expanded calculations remove their axes below.
 const relational = [...u?.relational ?? []];
 if (relational.length && type && NUMERIC_KINDS.has(type.type)) limit ??= `${name} is compared with ${relational.join(', ')}; such a comparison is sampled, not partitioned`;
 switch (type?.type) {
  case 'yes_no': out.push(known(true, 'yes'), known(false, 'no')); break;
  case 'listed': for (const v of type.values) out.push(known(v, v)); break;
  case 'count': case 'number': case 'quantity': {
   const unit = type.type === 'quantity' ? type.unit : undefined;
   let values: number[];
   try { values = [...new Set((u?.thresholds ?? []).map(t => t.unit && unit && t.unit !== unit ? convert(t.value, t.unit, unit) : t.value))].sort((a, b) => a - b); }
   catch (error) { return { points: [{ label: 'unknown', value: UNKNOWN }], limit: `${name}: ${(error as Error).message}` }; }
   const at = (v: number) => unit ? { value: v, unit } : v, fmt = (v: number) => unit ? `${v} ${unit}` : String(v);
   // Read only by known()/unknown(): one known value stands for all.
   if (!values.length && !relational.length) { out.push(known(at(0), 'any')); break; }
   if (!values.length) values = [0, 1];
   if (type.type === 'count') {
    const counts = new Set([0]);
    for (const v of values) for (const n of [Math.floor(v) - 1, Math.floor(v), Math.ceil(v), Math.ceil(v) + 1]) if (n >= 0) counts.add(n);
    for (const n of [...counts].sort((a, b) => a - b)) out.push(known(n, String(n)));
   } else {
    out.push(known(at(values[0] - 1), `< ${fmt(values[0])}`));
    values.forEach((v, k) => {
     const next = values[k + 1];
     out.push(known(at(v), fmt(v)));
     out.push(next === undefined ? known(at(v + 1), `> ${fmt(v)}`) : known(at((v + next) / 2), `> ${fmt(v)} and < ${fmt(next)}`));
    });
   }
   break;
  }
  case 'identifier': case 'revision':
   for (const v of [...u?.literals ?? []].sort()) out.push(known(v, v));
   for (const token of tokens) out.push(known(token, token));
   break;
  case 'list': {
   const members = [...u?.members ?? []].sort();
   if (members.length > MAX_LIST_LITERALS) { limit ??= `${name} is tested for ${members.length} members; only lists of at most ${MAX_LIST_LITERALS} are enumerated`; break; }
   for (let mask = 0; mask < 2 ** members.length; mask++) {
    const set = members.filter((_, i) => mask & (1 << i));
    out.push(known(set, `[${set.join(', ')}]`));
   }
   break;
  }
  default:
   for (const v of [...u?.literals ?? []].sort()) out.push(known(v, v));
   limit ??= `${name} has ${type ? `type ${type.type}` : 'no resolved type'}; it is sampled only at the literals it is compared with and unknown`;
 }
 out.push({ label: 'unknown', value: UNKNOWN });
 return { points: out, ...(limit ? { limit } : {}) };
}
const axisType = (a: AxisSpec | undefined): TypeDescriptor | undefined => a?.type;

/** A point as a supplied value: yes/no as `yes`/`no`, an unknown as `{unknown: reason}`. */
const supplied = (p: VPoint): JsonValue => p.value.state === 'unknown' ? { unknown: p.value.reason }
 : typeof p.value.value === 'boolean' ? (p.value.value ? 'yes' : 'no') : p.value.value;

/**
 * Analyse one table's selection over the finite domain of the names its enabled rows read, for each distinct set of
 * rows enabled in some state. An ambiguous case is an overlap; an unmatched case is a coverage gap. Unresolved cases
 * are counted, never reported as gaps: the table's failure handler owns them at runtime.
 */
export function analyzeSelection(spec: SelectionSpec): SelectionAnalysis {
 const maxCases = spec.maxCases ?? MAX_CASES, priority = spec.hit === 'priority';
 const rows = spec.rows.map(r => ({ ...r, rank: priority ? r.rank ?? 1 : 1, outcome: outcomeKey(r), expr: parse(r.when) }));
 // Expand `when` and literal `cases` calculations into the names they read; others stay one sampled axis.
 const expanded = new Map<string, Calculation>(), base = new Map<string, Set<string>>();
 const closure = (n: string, seen = new Set<string>()): Set<string> => {
  const done = base.get(n);
  if (done) return done;
  const a = spec.axes[n], out = new Set<string>();
  if (a?.kind === 'calculation' && expandable(a.calculation) && !seen.has(n)) {
   expanded.set(n, a.calculation);
   seen.add(n);
   for (const m of calcReads(a.calculation)) for (const x of closure(m, seen)) out.add(x);
  } else out.add(n);
  base.set(n, out);
  return out;
 };
 const rowNames = rows.map(r => [...new Set(conditionNames(r.expr).flatMap(n => [...closure(n)]))].sort(byCodePoint));
 // The expanded calculations each row reaches, evaluated by the runtime's calculation function.
 const reach = (n: string, out: Set<string>): Set<string> => {
  const c = expanded.get(n);
  if (c && !out.has(n)) { out.add(n); for (const m of calcReads(c)) reach(m, out); }
  return out;
 };
 const rowCalcs = rows.map(r => [...conditionNames(r.expr).reduce((out, n) => reach(n, out), new Set<string>())]);
 const rowCalculations = rowCalcs.map(names => Object.fromEntries(names.map(n => [n, expanded.get(n)!])));
 const exprs = [...rows.map(r => r.expr), ...[...expanded.values()].flatMap(c => calcConditions(c).map(parse))];
 const used = uses(exprs, spec.axes);
 const all = [...new Set(rowNames.flat())].sort(byCodePoint);
 const limits: string[] = [], sampledLimits: string[] = [], domain = new Map<string, VPoint[]>();
 // Keep direct comparisons useful without computing a transitive equality partition. Share the written values
 // of each compared name, including finite calculation results, but report this sample as incomplete.
 // Read uses before expansion too: a comparison between two expanded calculations has no axis of its own.
 const literals = new Map(Object.entries(spec.axes).map(([n, a]) => [n, new Set([
  ...used.get(n)?.literals ?? [],
  ...(a.kind === 'parameter' && typeof a.value === 'string' ? [a.value] : []),
  ...(a.type?.type === 'listed' ? a.type.values : []),
  ...(a.kind === 'calculation' && 'cases' in a.calculation
   ? a.calculation.cases.flatMap(c => 'value' in c.value && typeof c.value.value === 'string' ? [c.value.value] : []) : []),
 ])]));
 const written = new Set([...literals.values()].flatMap(v => [...v]));
 const tokens: string[] = [];
 const count = Math.max(1, all.filter(n => EQUALITY_TYPES.has(axisType(spec.axes[n])?.type ?? '')).length);
 for (let k = 1; tokens.length < count; k++) if (!written.has(`other_${k}`)) tokens.push(`other_${k}`);
 for (const [n, u] of used) {
  if (spec.axes[n]?.kind === 'parameter' || !EQUALITY_TYPES.has(axisType(spec.axes[n])?.type ?? '')) continue;
  const compared = [...u.relational].filter(m => m !== n);
  if (!compared.length) continue;
  sampledLimits.push(`${n} is compared with ${compared.join(', ')}; identifier and revision comparisons between names are sampled, not partitioned`);
  // Use the original sets, not values copied during this loop, so row order cannot change the sample.
  u.literals = new Set([...u.literals, ...compared.flatMap(m => [...literals.get(m) ?? []])]);
 }
 for (const n of all) {
  const a = spec.axes[n];
  const p = a ? points(n, a, used.get(n), tokens) : { points: [{ label: 'unknown', value: UNKNOWN }], limit: `${n} is not a declared name` };
  domain.set(n, p.points);
  if (p.limit) limits.push(p.limit);
 }
 const opaque = new Set(all.filter(n => spec.axes[n]?.kind === 'calculation'));

 // Rows enabled in each state; states with the same enabled rows are analysed once.
 const groups = new Map<string, { states: Id[]; rows: number[] }>();
 for (const s of spec.states) {
  const enabled = rows.flatMap((r, i) => r.in.includes(s) || r.in.includes('*') ? [i] : []);
  if (!enabled.length) continue;
  const key = enabled.join(',');
  const g = groups.get(key) ?? { states: [], rows: enabled };
  g.states.push(s);
  groups.set(key, g);
 }

 const findings = new Map<string, SelectionFinding>(), outcomes: SelectionAnalysis['outcomes'] = {};
 for (const g of groups.values()) {
  const names = [...new Set(g.rows.flatMap(i => rowNames[i]))].sort(byCodePoint), axes = names.map(n => domain.get(n)!);
  const total = axes.reduce((n, a) => n * a.length, 1), memo = rows.map(() => new Map<string, RowTruth>());
  // A calculation depends only on its transitive base inputs, not every input of the row that reads it.
  // Reuse its runtime result for that exact tuple, across rows and cases in this one enabled-row group.
  // Values include unknown reasons and blocking inputs. No case, guard or selection check is skipped.
  const calculations = new Map([...new Set(g.rows.flatMap(i => rowCalcs[i]))].map(n => [n, {
   indices: [...base.get(n)!].map(input => names.indexOf(input)),
   values: new Map<string, ReturnType<typeof evaluateCalculations>[string]>(),
  }]));
  const candidate = names.some(n => opaque.has(n));
  if (total > maxCases) limits.push(`States ${g.states.join(', ')}: examined ${maxCases.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} cases`);
  const picked = names.map(() => 0);
  try {
   for (let c = 0; c < Math.min(total, maxCases); c++) {
    // An odometer over the names, the last fastest; each axis lists unknown last, so known witnesses come first.
    if (c) for (let k = names.length - 1; k >= 0; k--) { if (++picked[k] < axes[k].length) break; picked[k] = 0; }
    const values: Record<string, ResolvedInput> = {};
    names.forEach((n, k) => { values[n] = axes[k][picked[k]].value; });
    const truths = g.rows.map(i => {
     const r = rows[i], key = rowNames[i].map(n => picked[names.indexOf(n)]).join(',');
     let t = memo[i].get(key);
     if (!t) {
      const own: Record<string, ResolvedInput> = Object.fromEntries(rowNames[i].map(n => [n, values[n]]));
      const missing: [string, string][] = [];
      for (const name of rowCalcs[i]) {
       const cache = calculations.get(name)!, key = cache.indices.map(k => picked[k]).join(',');
       const value = cache.values.get(key);
       if (value) own[name] = value;
       else missing.push([name, key]);
      }
      const computed = missing.length ? evaluateCalculations(rowCalculations[i], own, spec.concepts) : {};
      for (const [name, key] of missing) calculations.get(name)!.values.set(key, computed[name]);
      const resolved = { ...own, ...computed };
      const guard = guardTruth(r.expr, resolved, spec.concepts);
      memo[i].set(key, t = { id: r.id, rank: r.rank, truth: guard.truth, blockedBy: guard.blockedBy, outcome: r.outcome });
     }
     return t;
    });
    const s = selectRow(truths);
    outcomes[s.result] = (outcomes[s.result] ?? 0) + 1;
    if (s.result !== 'ambiguous' && s.result !== 'unmatched') continue;
    const conflict = s.result === 'ambiguous' ? [...s.conflict] : g.rows.map(i => rows[i].id).sort(byCodePoint);
    const kind = s.result === 'ambiguous' ? 'overlap' : 'coverage_gap', key = `${kind} ${g.states.join(',')} ${conflict.join(',')}`;
    const seen = findings.get(key);
    if (seen) { seen.cases++; continue; }
    findings.set(key, { kind, states: [...g.states], rows: conflict, cases: 1, candidate,
     witness: Object.fromEntries(names.map((n, k) => [n, supplied(axes[k][picked[k]])])) });
   }
  } catch (error) {
   limits.push(`States ${g.states.join(', ')}: evaluation stopped: ${(error as Error).message}`);
  }
 }
 return {
  status: limits.length || sampledLimits.length ? 'incomplete' : 'complete',
  ...(!limits.length && sampledLimits.length ? { sampledOnly: true as const } : {}),
  domain: all.map(n => `${n}: ${domain.get(n)!.map(p => p.label).join(', ')}`).join('; '),
  limits: [...new Set([...sampledLimits, ...limits])], findings: [...findings.values()], outcomes,
 };
}

/**
 * The direct unconditional self-emit loop: a row whose guard is `true`, which stays, is the only outcome of its table
 * enabled in that state (all enabled rows are unconditional and identical), and has an unguarded effect that emits
 * the table's own event to this execution. Each delivery selects the same outcome, with no guard to change or wait. Longer cycles are not analysed here.
 */
export function directSelfEmitLoops(table: Pick<Table, 'on' | 'rules'>, states: readonly Id[]): { rule: number; effect: number; states: Id[] }[] {
 const out: { rule: number; effect: number; states: Id[] }[] = [];
 if (table.on.work !== undefined || (table.on.for !== undefined && table.on.for.binding !== 'this_execution')) return out;
 const literalTrue = (text: string | undefined) => { if (text === undefined) return true; const r = parseCondition(text); return r.ok && r.value.kind === 'boolean' && r.value.value; };
 const enabledIn = (r: TableRule, s: Id) => r.in.includes(s) || r.in.includes('*');
 const toThisExecution = (to: unknown) => JSON.stringify(to) === JSON.stringify({ binding: 'this_execution' });
 // A request names its table as a bare identifier or `{value: identifier}`.
 const requestTable = (fields: unknown): unknown => { const t = (fields as Record<string, unknown> | undefined)?.table; return typeof t === 'object' && t !== null ? (t as { value?: unknown }).value : t; };
 table.rules.forEach((r, ri) => {
  if (!literalTrue(r.when) || !('stay' in r.to && r.to.stay)) return;
  const outcome = outcomeKey(r);
  const sole = states.filter(s => enabledIn(r, s) && table.rules.every(o => !enabledIn(o, s) || (literalTrue(o.when) && outcomeKey(o) === outcome)));
  if (!sole.length) return;
  const ei = r.effects.findIndex(e => e.kind === 'emit' && e.event === table.on.event && literalTrue(e.when) && toThisExecution(e.to)
   && (table.on.table === undefined || requestTable(e.fields) === table.on.table));
  if (ei >= 0) out.push({ rule: ri, effect: ei, states: sole });
 });
 return out;
}
