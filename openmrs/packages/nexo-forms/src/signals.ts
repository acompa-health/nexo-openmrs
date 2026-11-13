/**
 * Three signals that the form designer reads from the rule tables (docs/form-design.md, section 0):
 *
 * - **Row outcome.** For each row of a table that hears the form: its order, and whether it ends the path,
 *   continues to another state, or repeats the step.
 * - **Test shape.** How the row tests each form question: as one term of an "or" (one answer is enough), as one
 *   term of an "and" (all must hold), or with every possible answer ("any": `cad == yes or cad == no`).
 * - **Stop questions.** A row is a stop row when one answer alone, with facts that the form does not ask, can select
 *   it. Its questions come first and form a group. Questions that an earlier stop row already took count as settled.
 *   A test that accepts every answer never makes a stop question.
 *
 * The fourth input, branch reads, comes from the hide analysis in compile.ts (see `branchReads`).
 * Nothing here decides care: these are read-only views of the rules.
 */
import { parseCondition, type Expr } from '../../../../core/logic/index.ts';
import { namesIn } from './reads.ts';
import type { Rule, Table, Workflow } from './model.ts';

export type Shape = 'or' | 'and' | 'any';
export interface Outcome {
  /** "ends": `to.end`; "continues": `to.state`; "repeats": `to.stay` (the step is asked again). */
  kind: 'ends' | 'continues' | 'repeats';
  to: string;
  /** Tasks the row opens and workflows it starts. */
  opens: string[];
  /** The named destinations of the handovers it starts. A row may choose among several by other answers. */
  handovers: string[];
}
export interface RowSignal {
  table: string;
  row: string;
  /** Position in priority order: rank first, then the order in the table. */
  order: number;
  outcome: Outcome;
  /** Form questions (by ID) that the row's condition and its effect conditions test, with the shape of each test. */
  tests: Record<string, Shape[]>;
  /** Questions whose one answer alone can select this row. A row with stop questions is a stop row. */
  stopQuestions: string[];
  /** For each stop question, the answers that select this row. */
  stopAnswers: Record<string, string[]>;
}

/** One question's answer domain, for the "any answer" test. Undefined for a question that is not coded. */
export type Domain = (question: string) => string[] | undefined;

export function rowOutcome(rule: Rule): Outcome {
  const to = rule.to ?? {};
  const opens: string[] = [];
  const handovers: string[] = [];
  for (const e of rule.effects ?? []) {
    if (e?.kind === 'task' && typeof e.task === 'string' && !e.reissue) opens.push(e.task);
    if (e?.kind === 'start' && typeof e.definition?.workflow === 'string') {
      opens.push(e.definition.workflow);
      const destination = e.bindings?.destination;
      if (typeof destination === 'string' && !handovers.includes(destination)) handovers.push(destination);
    }
  }
  const base = { opens, handovers };
  if (typeof to.end === 'string') return { kind: 'ends', to: to.end, ...base };
  if (typeof to.state === 'string') return { kind: 'continues', to: to.state, ...base };
  return { kind: 'repeats', to: 'stay', ...base };
}

/**
 * The rows of one table in priority order, with their outcome, test shapes and stop questions.
 * `questionOf` maps a table input name to the form question it reads. `claimed` holds the stop questions of earlier
 * rows (of this table or an earlier one); the function adds the stop questions it finds.
 */
export function rowSignals(table: Table, workflow: Workflow | undefined, questionOf: Map<string, string>, domain: Domain, claimed = new Set<string>()): RowSignal[] {
  const calcs = { ...(workflow?.calculations ?? {}), ...(table.calculations ?? {}) };
  const priority = (table as any).hit === 'priority';
  const rows = table.rules.map((rule, index) => ({ rule, index, rank: priority ? rule.rank ?? 1 : 1 }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index);
  const questionsIn = (e: Expr) => [...new Set(namesIn(e, calcs).map(n => questionOf.get(n)).filter((q): q is string => !!q))];
  const out: RowSignal[] = [];
  for (const [order, { rule }] of rows.entries()) {
    const parsed = parseCondition(rule.when);
    const outcome = rowOutcome(rule);
    if (!parsed.ok) { out.push({ table: table.id, row: rule.id, order, outcome, tests: {}, stopQuestions: [], stopAnswers: {} }); continue; }
    const tests: Record<string, Shape[]> = {};
    const note = (q: string, s: Shape) => { (tests[q] ??= []).includes(s) || tests[q].push(s); };
    const visit = (e: Expr, parent: 'and' | 'or') => {
      if (e.kind === 'and' || e.kind === 'or') {
        const any = anyAnswer(e, questionOf, domain);
        if (any) { note(any, 'any'); return; }
        e.args.forEach(a => visit(a, e.kind as 'and' | 'or'));
        return;
      }
      for (const q of questionsIn(e)) note(q, parent);
    };
    visit(parsed.value, 'and');
    // An effect condition (for example which service gets the handover) also makes an answer matter.
    for (const effect of rule.effects ?? []) {
      const p = typeof effect?.when === 'string' ? parseCondition(effect.when) : undefined;
      if (p?.ok) visit(p.value, 'and');
    }
    // A repeated step is not an outcome a person can choose, so it never makes a stop group. A test that accepts every
    // answer only needs an answer, so it never makes a stop question.
    const isAny = (e: Expr) => (e.kind === 'or' ? anyAnswer(e, questionOf, domain) : undefined);
    const stopQuestions = outcome.kind === 'repeats' ? [] : [...satisfiedBy(parsed.value, questionsIn, claimed, isAny).singles];
    for (const q of stopQuestions) claimed.add(q);
    const stopAnswers = Object.fromEntries(stopQuestions.map(q => [q, answersSelecting(parsed.value, q, questionOf, domain)]));
    out.push({ table: table.id, row: rule.id, order, outcome, tests, stopQuestions, stopAnswers });
  }
  return out;
}

/** An "or" of equality tests on one coded question that together accept every answer. Returns the question. */
function anyAnswer(e: Expr & { kind: 'and' | 'or' }, questionOf: Map<string, string>, domain: Domain): string | undefined {
  if (e.kind !== 'or') return undefined;
  const seen = new Set<string>();
  let question: string | undefined;
  for (const a of e.args) {
    if (a.kind !== 'compare' || a.op !== '==' || a.left.kind !== 'name' || a.right.kind !== 'word') return undefined;
    const q = questionOf.get(a.left.name);
    if (!q || (question && q !== question)) return undefined;
    question = q; seen.add(a.right.value);
  }
  const values = question ? domain(question) : undefined;
  return values && values.every(v => seen.has(v)) ? question : undefined;
}

/** The answers of `question` that the tests in `e` accept, ignoring tests that accept every answer. */
function answersSelecting(e: Expr, question: string, questionOf: Map<string, string>, domain: Domain): string[] {
  const out = new Set<string>();
  const walk = (x: Expr) => {
    if (x.kind === 'and' || x.kind === 'or') { if (!anyAnswer(x, questionOf, domain)) x.args.forEach(walk); return; }
    if (x.kind !== 'compare' || x.left.kind !== 'name' || x.right.kind !== 'word' || questionOf.get(x.left.name) !== question) return;
    const value = x.right.value;
    if (x.op === '==') out.add(value);
    else if (x.op === '!=') (domain(question) ?? []).filter(v => v !== value).forEach(v => out.add(v));
  };
  walk(e);
  return [...out];
}

/**
 * Which questions can satisfy `e` alone. `zero`: the condition can hold with no unsettled form answer (for example
 * on the reading alone). `singles`: questions whose one answer, with facts the form does not ask, can make it hold.
 * A test that accepts every answer of an unsettled question needs that answer, but no answer in particular.
 */
function satisfiedBy(e: Expr, questionsIn: (e: Expr) => string[], claimed: Set<string>, isAny: (e: Expr) => string | undefined): { zero: boolean; singles: Set<string> } {
  const any = isAny(e);
  if (any) return { zero: claimed.has(any), singles: new Set() };
  if (e.kind === 'or' || e.kind === 'and') {
    const parts = e.args.map(a => satisfiedBy(a, questionsIn, claimed, isAny));
    const all = new Set(parts.flatMap(p => [...p.singles]));
    if (e.kind === 'or') return { zero: parts.some(p => p.zero), singles: all };
    return { zero: parts.every(p => p.zero), singles: new Set([...all].filter(q => parts.every(p => p.zero || p.singles.has(q)))) };
  }
  if (e.kind === 'boolean') return { zero: e.value, singles: new Set() };
  const open = questionsIn(e).filter(q => !claimed.has(q));
  if (!open.length) return { zero: true, singles: new Set() };
  return { zero: false, singles: new Set(open.length === 1 ? open : []) };
}

/** For each question, the shapes of all its tests across the rows. */
export function shapesByQuestion(rows: RowSignal[]): Map<string, Set<Shape>> {
  const out = new Map<string, Set<Shape>>();
  for (const r of rows) for (const [q, shapes] of Object.entries(r.tests)) {
    const s = out.get(q) ?? out.set(q, new Set()).get(q)!;
    shapes.forEach(x => s.add(x));
  }
  return out;
}

/** A question that a rule reads only when another question has some answers: the gate and its allowed answers. */
export interface PotentialGate { gates: string[]; allowed: Record<string, string[]> }
export interface BranchRead { choice: string; value: string; reads: string[] }

/**
 * Branch reads: for each answer of each choice, the questions that a rule can still read. A choice is a coded
 * question that limits when a rule reads another question. `gateOf` holds, for each question, the answers of other
 * questions that every rule reading it needs (computed whether or not the question may hide).
 */
export function branchReads(questions: string[], domain: Domain, gateOf: Map<string, PotentialGate>): BranchRead[] {
  const choices = [...new Set([...gateOf.values()].flatMap(g => g.gates))].filter(c => domain(c));
  return choices.flatMap(choice => domain(choice)!.map(value => ({
    choice, value,
    reads: questions.filter(q => q !== choice && (!gateOf.get(q)?.allowed[choice] || gateOf.get(q)!.allowed[choice].includes(value))),
  })));
}
