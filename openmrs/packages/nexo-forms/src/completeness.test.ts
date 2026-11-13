/**
 * Completeness, after IRS Direct File's checkFlowSetsFacts: for every form and every run through its answers, each
 * field that a rule reads with `required: "decision"` is asked and visible, filled by the host, or prefilled from the
 * task. The check reads the table bindings and the O3 hide conditions itself, and evaluates each hide condition as the
 * O3 form engine does on a server whose CIEL concepts have their own UUIDs. It reuses `readOccurrences` (reads.ts)
 * to know when a rule reads a field, so a bug there would reach both the compiler and this test. It does not prove
 * the A5 removals: if a removed field were needed, Core would open "Collect the named missing information".
 */
import { describe, expect, test } from 'bun:test';
import bundle from '../../../protocols/rwanda-htn/build/protocol.json';
import hints from '../../../protocols/rwanda-htn/forms.hints.json';
import layout from '../../../protocols/rwanda-htn/forms.layout.json';
import { answerPosition, compile, type Compiled, type FormSpec, type Hints, type QuestionBinding } from './compile.ts';
import { ProtocolModel } from './model.ts';
import { readOccurrences, type Occurrence } from './reads.ts';
import { hiddenOnServer } from './fake-form-engine.ts';

const model = new ProtocolModel((bundle as any).document, (bundle as any).catalog);
const compiled = compile((bundle as any).document, (bundle as any).catalog, (bundle as any).content, hints as Hints, layout);

const domain = (q: QuestionBinding) => q.type.type === 'yes_no' ? ['yes', 'no'] : q.type.type === 'listed' ? (q.type as any).values as string[] : [];
/** Whether the form engine shows the question when the named questions have these answers (by reference). */
function isVisible(f: FormSpec, q: QuestionBinding, answers: Record<string, string>) {
  return !q.hide || !hiddenOnServer(f.o3, q.hide, answers);
}

/** Every problem in one form: a decision read that the form does not cover, or that hides on a run where a rule reads it. */
function missingReads(f: FormSpec, c: Compiled): string[] {
  if (f.kind === 'update') return [];
  const consumers = f.template ? model.consumers(f.template) : model.listeners(f.event!);
  const root = f.template ? 'event.payload.result.' : 'event.payload.';
  const byPath = new Map(f.questions.map(q => [q.path.join('.'), q]));
  const removed = new Set(c.findings.filter(x => x.form === f.name && x.kind === 'removed').flatMap(x => x.questions));
  // Asked; filled by the host (patient, time, actor, task content, a looked-up object); or the object the form builds,
  // when the rule reads the object itself or its ID. A field of a built object needs its own question or host value.
  const filled = (fill: { from: string } | undefined) => !!fill && fill.from !== 'object';
  const covered = (path: string[]) => path.some((_, i) => {
    const p = path.slice(0, i + 1), key = p.join('.');
    return byPath.has(key) || (i === 0 && filled(f.host[p[0]]))
      || f.objects.some(o => o.path.join('.') === p.slice(0, -1).join('.') && filled(o.host[p.at(-1)!]))
      || (i === path.length - 1 && f.objects.some(o => o.path.join('.') === key))
      // The identity of an object the form builds: the host gives each new object its ID.
      || (p.at(-1) === 'id' && f.objects.some(o => o.path.join('.') === p.slice(0, -1).join('.')));
  });
  const problems: string[] = [];
  const questionOf = new Map<string, QuestionBinding>();
  for (const { table } of consumers) for (const [input, d] of Object.entries(table.inputs ?? {})) {
    if (typeof d.binding !== 'string' || !d.binding.startsWith(root)) continue;
    const path = d.binding.slice(root.length).split('.');
    const q = byPath.get(path.join('.'));
    if (q) questionOf.set(input, q);
    if (d.required !== 'decision' || covered(path)) continue;
    const id = path.join('__');
    if (!removed.has(id)) problems.push(`${f.name}: ${table.id} reads ${path.join('.')} to decide, but the form neither asks it nor fills it.`);
  }

  // Every run: each combination of answers to the questions that some hide condition tests.
  const gates = [...new Set(f.questions.flatMap(q => q.gates ?? []))].map(id => f.questions.find(q => q.id === id)).filter((q): q is QuestionBinding => !!q);
  let runs: Record<string, string>[] = [{}];
  for (const g of gates) runs = runs.flatMap(r => domain(g).map(v => ({ ...r, [g.id]: v })));
  const coded = new Set([...questionOf].filter(([, q]) => domain(q).length).map(([input]) => input));
  for (const { table, workflow } of consumers) {
    for (const [input, occurrences] of readOccurrences(table, workflow, coded)) {
      const q = questionOf.get(input);
      if (!q || table.inputs?.[input]?.required !== 'decision') continue;
      for (const run of runs) {
        const holds = (o: Occurrence) => o.every(g => {
          const gq = questionOf.get(g.input);
          if (!gq || !(gq.id in run)) return true;
          return g.negate ? !g.values.includes(run[gq.id]) : g.values.includes(run[gq.id]);
        });
        if (!occurrences.some(holds)) continue;
        const answers = Object.fromEntries(Object.entries(run).map(([id, v]) => [id, f.questions.find(x => x.id === id)!.answers![v]]));
        if (!isVisible(f, q, answers)) problems.push(`${f.name}: ${table.id} reads ${q.path.join('.')} when ${Object.entries(run).map(([k, v]) => `${k} = ${v}`).join(', ')}, but the form hides it.`);
      }
    }
  }
  return [...new Set(problems)];
}

describe('every branch asks what its rules read (completeness)', () => {
  test('in every form, each decision read is asked and visible, filled by the host, or prefilled', () => {
    expect(compiled.forms.flatMap(f => missingReads(f, compiled))).toEqual([]);
  });

  test('each branch read is visible on that branch', () => {
    for (const f of compiled.forms) for (const b of f.design.branches) {
      const choice = f.questions.find(q => q.id === b.choice)!;
      for (const id of b.reads) {
        const q = f.questions.find(x => x.id === id)!;
        const others = (q.gates ?? []).filter(g => g !== b.choice).map(g => f.questions.find(x => x.id === g)!);
        let runs: Record<string, string>[] = [{ [choice.id]: choice.answers![b.value] }];
        for (const g of others) runs = runs.flatMap(r => domain(g).map(v => ({ ...r, [g.id]: g.answers![v] })));
        expect({ form: f.name, branch: `${b.choice}=${b.value}`, question: id, visible: runs.some(r => isVisible(f, q, r)) })
          .toEqual({ form: f.name, branch: `${b.choice}=${b.value}`, question: id, visible: true });
      }
    }
  });

  test('the check fails when a form hides a field on a branch where a rule reads it', () => {
    const broken = structuredClone(compiled.forms.find(f => f.name === 'htn_prescription_review')!);
    const k = broken.questions.find(q => q.id === 'potassium_result__potassium')!;
    // Hide potassium exactly when the medicine is enalapril, the opposite of the rule.
    k.hide = `${answerPosition('medicine')} === ${domain(broken.questions.find(q => q.id === 'medicine')!).indexOf('enalapril')}`;
    expect(missingReads(broken, compiled).some(p => p.includes('reads potassium_result.potassium when') && p.includes('medicine = enalapril'))).toBe(true);
  });

  test('the check fails when a form drops a field that a rule reads to decide', () => {
    const broken = structuredClone(compiled.forms.find(f => f.name === 'htn_dispense')!);
    broken.questions = broken.questions.filter(q => q.id !== 'supply__packed');
    expect(missingReads(broken, compiled)).toContain('htn_dispense: verify_htn_dispensing reads supply.packed to decide, but the form neither asks it nor fills it.');
  });
});
