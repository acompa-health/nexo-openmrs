import { attempt, fail, printCondition } from './grammar.ts';
import type { Concepts, Expr, Parsed } from './grammar.ts';
import { evaluate } from './evaluate.ts';
import type { Finding, Value } from './evaluate.ts';
import { convert } from './units.ts';

/** DMN's hit policies, as the snippet contract prints them. */
export type HitPolicy = { kind: 'unique' | 'first' | 'collect' } | { kind: 'priority' | 'output order'; ranking: string[] };
/** A parsed row: its printed label, its whole condition (the `and` of its cells, or its `when` cell), and its ranked output. */
export interface TableRow { label: string; when: Expr; output?: string }
/** One test case: the region each input stands for (`< 5 kg`, `red`, `unknown`), and findings that replay it. */
export interface TableCase { inputs: Record<string, string>; findings: Record<string, Finding> }
export interface TableReport {
 /** How many input combinations were tried. */
 cases: number;
 /** Unique: combinations of known inputs that no row matches. */
 gaps: TableCase[];
 /** Unique: combinations with an unknown input that no row matches. */
 unknown: TableCase[];
 /** Unique: pairs of rows that can both match, with a case where they do. */
 overlaps: { rows: [string, string]; example: TableCase }[];
 /** Rows that never fire: under First, never the first true row; under the other policies, never true. */
 neverFires: string[];
 /** Priority and Output order: output values missing from the ranking. */
 unranked: string[];
}

/** Parse `Unique`, `First`, `Collect`, `Priority (a > b > …)` or `Output order (a > b > …)`. */
export function parseHitPolicy(text: string): Parsed<HitPolicy> {
 return attempt(() => {
  const m = /^\s*(unique|first|collect|priority|output order)\s*(?:\((.*)\))?\s*$/i.exec(text);
  if (!m) return fail(0, 'Expected a hit policy: Unique, First, Collect, Priority (a > b > …) or Output order (a > b > …).');
  const kind = m[1].toLowerCase(), open = text.indexOf('(');
  if (kind !== 'priority' && kind !== 'output order') {
   if (m[2] !== undefined) fail(open, `${m[1]} takes no ranking.`);
   return { kind: kind as 'unique' | 'first' | 'collect' };
  }
  if (m[2] === undefined) fail(m[0].length, `${m[1]} needs its ranking in brackets, as in ${m[1]} (pink > yellow > green).`);
  const ranking = m[2].split('>').map(s => s.trim());
  if (ranking.some(r => !r)) fail(open, 'The ranking has an empty place.');
  return { kind, ranking };
 });
}

interface Input { thresholds: { value: number; unit?: string }[]; categories: Set<string>; yesNo: boolean }
export interface Point { label: string; finding: Finding }

/** Gather, per concept, the thresholds, listed values and yes/no uses that the rows test. */
function collect(e: Expr, inputs: Map<string, Input>): void {
 const input = (name: string) => {
  let i = inputs.get(name);
  if (!i) inputs.set(name, i = { thresholds: [], categories: new Set(), yesNo: false });
  return i;
 };
 switch (e.kind) {
  case 'name': input(e.name).yesNo = true; break;
  case 'not': collect(e.arg, inputs); break;
  case 'and': case 'or': for (const a of e.args) collect(a, inputs); break;
  case 'call': for (const a of e.args) if (a.kind === 'name') { const i = input(a.name); if (e.fn === 'any' || e.fn === 'all') i.yesNo = true; } break;
  case 'compare':
   if (e.left.kind === 'name' && e.right.kind === 'name') throw new Error(`Cannot analyse ${printCondition(e)}: a comparison of two concepts has no threshold to test around.`);
   for (const [side, other] of [[e.left, e.right], [e.right, e.left]]) {
    if (side.kind !== 'name') continue;
    const i = input(side.name);
    if (other.kind === 'number') i.thresholds.push({ value: other.value, unit: other.unit });
    else if (other.kind === 'boolean' || ((other.kind === 'word' || other.kind === 'string') && (other.value === 'yes' || other.value === 'no'))) i.yesNo = true;
    else if (other.kind === 'word' || other.kind === 'string') i.categories.add(other.value);
   }
 }
}

/**
 * Test points for one input. Numbers: below the lowest threshold, each threshold, the midpoint between each pair,
 * and above the highest; every comparison is constant on each of these regions, so they cover the line.
 * Listed values: the registry's list, else those the rows name. Yes/no: both. Always: unknown.
 */
function points(name: string, input: Input, concepts: Concepts): Point[] {
 const out: Point[] = [], declared = Object.hasOwn(concepts, name) ? concepts[name] : undefined;
 const known = (value: Value): Finding => ({ status: 'known', value });
 if (input.thresholds.length) {
  const unit = declared?.unit ?? input.thresholds.find(t => t.unit)?.unit;
  let values: number[];
  try { values = [...new Set(input.thresholds.map(t => t.unit && unit ? convert(t.value, t.unit, unit) : t.value))].sort((a, b) => a - b); }
  catch (error) { throw new Error(`The thresholds on ${name}: ${(error as Error).message}`); }
  const at = (v: number) => known(unit ? { value: v, unit } : v), fmt = (v: number) => unit ? `${v} ${unit}` : String(v);
  if (unit === '1') {
   // Counts live on the nonnegative integers. Test each threshold's neighbouring integers and zero.
   const counts = new Set([0]);
   for (const v of values) for (const n of [Math.floor(v) - 1, Math.floor(v), Math.ceil(v), Math.ceil(v) + 1]) if (n >= 0) counts.add(n);
   for (const n of [...counts].sort((a, b) => a - b)) out.push({label:fmt(n), finding:at(n)});
  } else {
   out.push({ label: `< ${fmt(values[0])}`, finding: at(values[0] - 1) });
   values.forEach((v, k) => {
    const next = values[k + 1];
    out.push({ label: fmt(v), finding: at(v) });
    out.push(next === undefined ? { label: `> ${fmt(v)}`, finding: at(v + 1) } : { label: `> ${fmt(v)} and < ${fmt(next)}`, finding: at((v + next) / 2) });
   });
  }
 }
 for (const c of declared?.values ?? input.categories) out.push({ label: c, finding: known(c) });
 if (input.yesNo) out.push({ label: 'yes', finding: known(true) }, { label: 'no', finding: known(false) });
 if (!out.length) out.push({ label: 'known', finding: known(true) }); // only known()/unknown() read it
 out.push({ label: 'unknown', finding: { status: 'unknown' } });
 return out.filter((p, k) => out.findIndex(q => q.label === p.label) === k);
}

/** Test points for every input the conditions read, plus inputs no condition reads (known or unknown). */
export function testPoints(conditions: readonly Expr[], concepts: Concepts, more: readonly string[] = []): Map<string, Point[]> {
 const inputs = new Map<string, Input>();
 for (const c of conditions) collect(c, inputs);
 for (const name of more) if (!inputs.has(name)) inputs.set(name, { thresholds: [], categories: new Set(), yesNo: false });
 return new Map([...inputs].map(([name, input]) => [name, points(name, input, concepts)]));
}

const maxCases = 100_000;

/**
 * Analyse a decision table by trying every combination of its inputs' test points, evaluating each row with
 * `evaluate` (so units and unknowns mean what they mean everywhere else). Throws on a type or unit error in a row,
 * or when the table has more than 100,000 combinations.
 */
export function analyzeTable(rows: readonly TableRow[], policy: HitPolicy, concepts: Concepts = {}): TableReport {
 const inputs = testPoints(rows.map(r => r.when), concepts);
 const names = [...inputs.keys()], axes = [...inputs.values()];
 const cases = axes.reduce((n, a) => n * a.length, 1);
 if (cases > maxCases) throw new Error(`The table has ${cases} input combinations to test, more than ${maxCases}. Split it before analysing it.`);
 const report: TableReport = { cases, gaps: [], unknown: [], overlaps: [], neverFires: [], unranked: [] };
 const fired = rows.map(() => false), overlaps = new Map<string, { i: number; j: number; example: TableCase }>();
 for (let c = 0; c < cases; c++) {
  let rest = c;
  const picked = axes.map(a => { const p = a[rest % a.length]; rest = Math.floor(rest / a.length); return p; });
  const findings = Object.fromEntries(names.map((n, k) => [n, picked[k].finding]));
  const example = (): TableCase => ({ inputs: Object.fromEntries(names.map((n, k) => [n, picked[k].label])), findings });
  const hits = rows.flatMap((r, i) => {
   try { return evaluate(r.when, findings, concepts).value === true ? [i] : []; }
   catch (error) { throw new Error(`Row ${r.label}: ${(error as Error).message}`); }
  });
  if (policy.kind === 'first') { if (hits.length) fired[hits[0]] = true; }
  else for (const i of hits) fired[i] = true;
  if (policy.kind !== 'unique') continue;
  if (!hits.length) (picked.some(p => p.finding.status === 'unknown') ? report.unknown : report.gaps).push(example());
  for (const [k, i] of hits.entries()) for (const j of hits.slice(k + 1)) if (!overlaps.has(`${i} ${j}`)) overlaps.set(`${i} ${j}`, { i, j, example: example() });
 }
 report.overlaps = [...overlaps.values()].sort((a, b) => a.i - b.i || a.j - b.j).map(o => ({ rows: [rows[o.i].label, rows[o.j].label], example: o.example }));
 report.neverFires = rows.filter((_, i) => !fired[i]).map(r => r.label);
 if (policy.kind === 'priority' || policy.kind === 'output order') {
  report.unranked = [...new Set(rows.flatMap(r => r.output !== undefined && !policy.ranking.includes(r.output) ? [r.output] : []))];
 }
 return report;
}
