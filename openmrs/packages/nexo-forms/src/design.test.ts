import { describe, expect, test } from 'bun:test';
import bundle from '../../../protocols/rwanda-htn/build/protocol.json';
import hints from '../../../protocols/rwanda-htn/forms.hints.json';
import layout from '../../../protocols/rwanda-htn/forms.layout.json';
import { compile, type Hints, type QuestionBinding } from './compile.ts';
import { groupQuestions } from './design.ts';
import { checkLayout } from './layout.ts';
import { report } from './report.ts';
import { rowSignals, type RowSignal } from './signals.ts';

const build = (l: unknown = layout) => compile((bundle as any).document, (bundle as any).catalog, (bundle as any).content, hints as Hints, l);
const compiled = build();
const form = (name: string) => compiled.forms.find(f => f.name === name)!;
const row = (f: ReturnType<typeof form>, id: string) => f.design.rows.find(r => r.row === id)!;
const sections = (name: string) => form(name).o3.pages[0].sections.slice(1).map(s => s.questions.map(q => q.id));

describe('the three signals come from the rule tables', () => {
  test('row outcome: each row ends the path, continues, or repeats the step, in priority order', () => {
    const f = form('htn_clinical_review');
    expect(f.design.rows.map(r => r.row)).toEqual(['reject_uncorrelated_assessment', 'urgent_assessment_source_limit', 'excluded_care_source_limit',
      'comorbid_regimen_source_limit', 'reference_target_uncertain', 'review_unambiguous_target', 'nonoffice_assessment_handover',
      'diagnosis_not_confirmed_handover', 'repeat_incomplete_assessment']);
    expect(row(f, 'urgent_assessment_source_limit').outcome).toMatchObject({ kind: 'ends', handovers: ['urgent_assessment_service'] });
    // One row can hand over to one of several services, chosen by other answers.
    expect(row(f, 'excluded_care_source_limit').outcome.handovers).toEqual(['maternal_hypertension_service', 'child_adolescent_service', 'ncd_advanced_care_service']);
    expect(row(f, 'review_unambiguous_target').outcome).toMatchObject({ kind: 'continues', to: 'prescription_decision', opens: ['htn_prescription_review', 'htn_first_prescription_review'] });
    expect(row(f, 'repeat_incomplete_assessment').outcome.kind).toBe('repeats');
    expect(row(form('htn_dispense'), 'supply_unavailable').outcome).toMatchObject({ kind: 'continues', to: 'supply_recovery', opens: ['htn_supply_recovery'] });
  });

  test('stop questions: one answer alone selects the row; questions an earlier stop row took count as settled', () => {
    const f = form('htn_clinical_review');
    const triggers = (id: string) => row(f, id).stopQuestions.map(q => q.replace('assessment__', '')).sort();
    expect(triggers('urgent_assessment_source_limit')).toEqual(['organ_damage', 'symptoms']);
    expect(triggers('excluded_care_source_limit')).toEqual(['adverse_effects', 'new_concern', 'pregnant', 'specialist_required']);
    // "pregnant == no" is also tested here, but the row before already took pregnancy.
    expect(triggers('comorbid_regimen_source_limit')).toEqual(['ckd', 'diabetes']);
    expect(triggers('diagnosis_not_confirmed_handover')).toEqual(['confirmed_htn']);
    // The main path needs many answers together, so it has no stop question. A repeated step never has one.
    for (const id of ['reference_target_uncertain', 'review_unambiguous_target', 'reject_uncorrelated_assessment', 'repeat_incomplete_assessment']) expect(triggers(id)).toEqual([]);
    expect(row(form('htn_prescription_review'), 'refer_for_individual_plan').stopQuestions).toEqual(['action']);
    expect(row(form('htn_dispense'), 'supply_unavailable').stopQuestions.sort()).toEqual(['supply__packed', 'supply__stock_available']);
    // The answers that stop: "yes" to a danger sign, "no" to stock.
    expect(row(f, 'urgent_assessment_source_limit').stopAnswers).toEqual({ assessment__symptoms: ['yes'], assessment__organ_damage: ['yes'] });
    expect(row(form('htn_dispense'), 'supply_unavailable').stopAnswers.supply__stock_available).toEqual(['no']);
    // "Contacted is yes or no" only needs an answer, so it is not a stop question.
    expect(row(form('htn_contact_overdue'), 'keep_contact_and_arrangement').stopQuestions).toEqual([]);
  });

  test('test shape: one term of an "or", one term of an "and", or any answer', () => {
    const f = form('htn_clinical_review');
    expect(row(f, 'urgent_assessment_source_limit').tests.assessment__symptoms).toEqual(['or']);
    expect(row(f, 'review_unambiguous_target').tests.assessment__symptoms).toEqual(['and']);
    for (const id of ['reference_target_uncertain', 'review_unambiguous_target']) {
      expect(row(f, id).tests.assessment__cad).toEqual(['any']);
      expect(row(f, id).tests.assessment__target_tolerated).toEqual(['any']);
    }
    expect(row(form('htn_contact_overdue'), 'keep_contact_and_arrangement').tests.contacted).toEqual(['any']);
  });

  test('an effect condition counts: a question that picks the handover is not "any answer"', () => {
    const table = { id: 't', on: { event: 'task.completed' }, inputs: {}, rules: [{ id: 'r', in: ['s'], when: 'x == yes or x == no', to: { end: 'done' },
      effects: [{ kind: 'start', when: 'x == yes', definition: { workflow: 'w' }, bindings: { destination: 'a' } }] }] } as any;
    const [r] = rowSignals(table, undefined, new Map([['x', 'x']]), () => ['yes', 'no']);
    expect(r.tests.x.sort()).toEqual(['and', 'any']);
  });

  test('branch reads: after "refer", no rule reads the medicine, the dose or the validity', () => {
    const reads = (name: string, choice: string, value: string) => form(name).design.branches.find(b => b.choice === choice && b.value === value)!.reads;
    expect(reads('htn_prescription_review', 'action', 'refer')).toEqual(['reason']);
    expect(reads('htn_prescription_review', 'action', 'start')).toContain('medicine');
    expect(reads('htn_prescription_review', 'medicine', 'amlodipine')).not.toContain('potassium_result__potassium');
    expect(reads('htn_dispense', 'supply__stock_available', 'no')).toEqual(['supply__packed']);
  });
});

describe('the form designer groups and orders the questions (B1, B2, B3)', () => {
  test('the assessment: one section per stop row in row order, then the review checklist', () => {
    const ids = sections('htn_clinical_review').map(s => s.map(id => id.replace('assessment__', '')));
    expect(ids.slice(0, 4)).toEqual([['symptoms', 'organ_damage'], ['pregnant', 'new_concern', 'adverse_effects', 'specialist_required'], ['diabetes', 'ckd'], ['confirmed_htn']]);
    // Coronary artery disease changes nothing (any answer, no later reader), so it comes last.
    expect(ids[4].slice(-3)).toEqual(['target_tolerated', 'current_regimen', 'cad']);
    expect(form('htn_clinical_review').design.groups.map(g => g.id).slice(0, 4))
      .toEqual(['urgent_assessment_source_limit', 'excluded_care_source_limit', 'comorbid_regimen_source_limit', 'diagnosis_not_confirmed_handover']);
  });

  test('the prescription: decide first; potassium right after the medicine that shows it; the reason last', () => {
    expect(sections('htn_prescription_review')).toEqual([['action'],
      ['medicine', 'potassium_result__potassium', 'dose', 'second_medicine', 'second_dose', 'valid_until', 'reason']]);
  });

  test('dispensing: stock and packing first; the supply end stays with the medicines it covers', () => {
    expect(sections('htn_dispense')).toEqual([['supply__stock_available', 'supply__packed'],
      ['supply__medicine', 'supply__dose', 'supply__second_medicine', 'supply__second_dose', 'supply__coverage_until']]);
  });

  test('B3 for a stop question: a follow-up of the stop answer moves next to it; a question that waits for "no stop" stays', () => {
    const yesNo = (id: string, extra: Partial<QuestionBinding> = {}): QuestionBinding =>
      ({ id, path: ['a', id], object: 'a', field: id, type: { type: 'yes_no' }, concept: id, label: id, required: true, why: '', ...extra });
    const questions = [yesNo('symptoms'), ...['x1', 'x2', 'x3', 'x4', 'x5'].map(id => yesNo(id)),
      yesNo('which_symptom', { gates: ['symptoms'], shownOn: { symptoms: ['yes'] }, hide: 'h' }),
      yesNo('after_no_stop', { gates: ['symptoms'], shownOn: { symptoms: ['no'] }, hide: 'h' })];
    const stop: RowSignal = { table: 't', row: 'urgent', order: 0, outcome: { kind: 'ends', to: 'e', opens: [], handovers: [] }, tests: {},
      stopQuestions: ['symptoms'], stopAnswers: { symptoms: ['yes'] } };
    const groups = groupQuestions(questions, [stop], new Set(), () => 'A');
    expect(groups.map(g => g.questions)).toEqual([['symptoms', 'which_symptom'], ['x1', 'x2', 'x3', 'x4', 'x5', 'after_no_stop']]);
  });

  test('a form of six questions or fewer stays in its sections; extra fields go last, in a closed section', () => {
    expect(sections('htn_receipt')).toEqual([['receipt__received', 'receipt__proof']]);
    expect(sections('htn_handover').length).toBe(2);
    const reading = form('event_measurement_recorded').o3.pages[0].sections.at(-1)!;
    expect(reading.questions.map(q => q.id)).toEqual(['extra__weight', 'extra__height', 'extra__waist']);
    expect(reading.isExpanded).toBe('false');
  });

  test('grouping moves questions but never changes what a form asks, requires or hides', () => {
    for (const f of compiled.forms) {
      const placed = f.o3.pages[0].sections.slice(1).flatMap(s => s.questions.map(q => q.id));
      expect(placed.sort()).toEqual(f.questions.map(q => q.id).sort());
    }
  });
});

describe('the layout decisions file holds only reviewed overrides', () => {
  test('section headings come from the file; without it a stop section shows the object name and warns', () => {
    const labels = (c: typeof compiled, name: string) => c.forms.find(f => f.name === name)!.o3.pages[0].sections.slice(1).map(s => s.label);
    expect(labels(compiled, 'htn_clinical_review')).toEqual(['Danger signs', 'Reasons for other care', 'Conditions that change the medicines', 'Diagnosis', 'Review checklist']);
    expect(labels(compiled, 'htn_prescription_review')).toEqual(['Prescribe or refer', 'Prescription']);
    expect(labels(compiled, 'htn_dispense')).toEqual(['Stock and packing', 'Medicines dispensed']);
    const bare = build({});
    expect(labels(bare, 'htn_dispense')).toEqual(['Dispensing', 'Dispensing']);
    expect(bare.warnings).toContain('htn_dispense: the section for rule supply_unavailable has no heading, so it shows "Dispensing". Add one in forms.layout.json.');
    expect(compiled.warnings.filter(w => w.includes('heading'))).toEqual([]);
  });

  test('every entry says why, who decided and its status', () => {
    for (const [form, entry] of Object.entries(layout as Record<string, any>)) {
      if (form.startsWith('$')) continue;
      for (const d of Object.values(entry.groups ?? {}) as any[]) {
        expect(d.reason.length).toBeGreaterThan(20);
        expect(['agent', 'Kuang']).toContain(d.decidedBy);
        expect(['review pending', 'accepted']).toContain(d.status);
      }
    }
    const entry = { label: 'X', reason: 'Because.', decidedBy: 'agent', status: 'review pending' };
    const withGroup = (g: object) => ({ htn_dispense: { groups: { supply: g } } });
    expect(() => build(withGroup({ ...entry, reason: '' }))).toThrow('must say why');
    expect(() => build(withGroup({ ...entry, decidedBy: 'someone' }))).toThrow('decidedBy must be "agent" or "Kuang"');
    expect(() => build(withGroup({ ...entry, status: 'done' }))).toThrow('status must be "review pending" or "accepted"');
  });

  test('it never sets required, hides a question or changes a rule', () => {
    const entry = { label: 'X', reason: 'Because.', decidedBy: 'agent', status: 'review pending' };
    expect(() => build({ htn_dispense: { groups: { supply: { ...entry, required: true } } } })).toThrow('never sets required');
    expect(() => build({ htn_dispense: { rules: {} } })).toThrow('is not a layout decision');
    expect(build({ htn_dispense: { groups: { no_such_section: entry } } }).warnings)
      .toContain('htn_dispense: forms.layout.json gives a heading to section "no_such_section", but the rules make no such section.');
  });
});

describe('questions that change nothing, and answers no rule reads, go to the protocol author (A5, A3)', () => {
  const findings = (name: string, kind: string) => compiled.findings.filter(f => f.form === name && f.kind === kind);

  test('the optional CKD stage changes nothing, so the form does not ask it', () => {
    const f = form('htn_clinical_review');
    expect(f.questions.map(q => q.id)).not.toContain('assessment__ckd_stage');
    expect(f.objects[0].asked).not.toContain('ckd_stage');
    expect(findings('htn_clinical_review', 'removed').map(x => x.questions)).toEqual([['assessment__ckd_stage']]);
    // The update form still records it: the protocol may name it when it asks for missing information.
    expect(form('update_htn_assessment').questions.map(q => q.id)).toContain('htn_assessment__ckd_stage');
  });

  test('coronary artery disease must be answered, but every rule accepts any answer: report it and keep it', () => {
    expect(findings('htn_clinical_review', 'any answer').map(x => x.questions)).toEqual([['assessment__cad']]);
    expect(form('htn_clinical_review').questions.find(q => q.id === 'assessment__cad')!.required).toBe(true);
    // The prescription step reads "tolerates the target" later, so it is not reported.
    expect(compiled.findings.flatMap(x => x.questions)).not.toContain('assessment__target_tolerated');
  });

  test('after "refer", the task still requires a medicine, a dose and a date that no rule reads: report, never hide', () => {
    const [refer] = findings('htn_prescription_review', 'unread on a branch');
    expect(refer.questions).toEqual(['medicine', 'dose', 'second_medicine', 'valid_until']);
    expect(refer.text).toBe('htn_prescription_review: when "Prescription decision" is "Refer for an individual plan", no rule reads Medicine, Dose, Second medicine and Prescription valid until. The task still requires them, so the form still asks them.');
    for (const id of refer.questions) expect(form('htn_prescription_review').questions.find(q => q.id === id)!.hide).toBeUndefined();
    expect(findings('htn_dispense', 'unread on a branch').map(x => x.questions)).toEqual([
      ['supply__medicine', 'supply__dose', 'supply__second_medicine'], ['supply__medicine', 'supply__dose', 'supply__second_medicine']]);
  });

  test('a field the task requires but no rule reads is asked, because Core needs it, and reported', () => {
    const doc = structuredClone((bundle as any).document);
    doc.definitions.work_templates.htn_receipt.result.comment = { type: { type: 'text' }, role: 'information' };
    const c = compile(doc, (bundle as any).catalog, (bundle as any).content, hints as Hints, layout);
    expect(c.forms.find(f => f.name === 'htn_receipt')!.questions.find(q => q.id === 'comment')!.required).toBe(true);
    expect(c.findings.filter(x => x.kind === 'unread').map(x => x.text)).toEqual([
      'htn_receipt: the task requires "Comment" (comment), but no rule reads it. The form still asks it, because the pathway refuses the step without it.']);
  });

  test('protocol findings are not warnings: with the hints and layout files the build has none', () => {
    expect(compiled.warnings).toEqual([]);
  });
});

describe('the ⓘ passes a bar, and a separate review build shows every reason (D3, D4)', () => {
  const questionsOf = (o3: typeof compiled.forms[number]['o3']) => o3.pages[0].sections.flatMap(s => s.questions);

  test('production shows an ⓘ only where a layout decision gives clinician text: in the prescription, only potassium', () => {
    const withInfo = (name: string) => questionsOf(form(name).o3).filter(q => q.questionInfo).map(q => q.id);
    expect(withInfo('htn_prescription_review')).toEqual(['potassium_result__potassium']);
    expect(withInfo('htn_clinical_review')).toEqual(['assessment__target_tolerated', 'assessment__current_regimen']);
    expect(withInfo('htn_dispense')).toEqual([]);
    for (const f of compiled.forms) for (const q of questionsOf(f.o3)) {
      if (q.questionInfo) expect(q.questionInfo).toBe(f.design.info[q.id]);
      // Production never shows builder text: no table names, no review blocks.
      expect(q.questionInfo ?? '').not.toMatch(/_htn_|Read by|declares it/);
      if (q.type === 'markdown') expect(q.id).toBe('nexo_context');
    }
  });

  test('the review build is the same form, with the reason for each section and question on the page', () => {
    for (const f of compiled.forms) {
      expect(f.review.uuid).toBe(f.o3.uuid);
      expect(f.review.name).toBe(f.o3.name);
      const real = (o3: typeof f.o3) => questionsOf(o3).filter(q => q.type !== 'markdown').map(q => q.id);
      expect(real(f.review)).toEqual(real(f.o3));
      // Every ID is unique and has no dot: the form engine reads a dot as a nested path.
      const ids = questionsOf(f.review).map(q => q.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).not.toContain('.');
      for (const s of f.review.pages[0].sections.slice(1)) {
        expect(s.questions[0].id).toStartWith('review__section__');
        expect(s.isExpanded).toBe('true');
      }
      const qs = questionsOf(f.review);
      for (const [i, q] of qs.entries()) if (q.type === 'obs') {
        const why = qs[i + 1];
        expect(why.id).toBe(`review__${q.id}`);
        expect((why.value as string[]).join(' ')).toMatch(/Used by:.*Required:.*Shows:/);
        // The reason hides with its question.
        expect(why.hide).toEqual(q.hide);
      }
    }
    const k = questionsOf(form('htn_prescription_review').review).find(q => q.id === 'review__potassium_result__potassium')!;
    expect(k.value).toContain('**Shows:** only when Prescription decision is Renew current treatment or Change treatment or Start treatment and Medicine is Enalapril or Lisinopril.');
    expect((k.value as string[]).at(-1)).toContain("(agent's choice, review pending)");
    const action = questionsOf(form('htn_prescription_review').review).find(q => q.id === 'review__action')!;
    expect((action.value as string[]).join(' ')).toContain('one answer alone can end this step: the rule ends this pathway ("Prescription handover requested") and hands the patient over to the NCD advanced care service.');
    const other = form('htn_clinical_review').review.pages[0].sections.find(s => s.label === 'Reasons for other care')!.questions[0];
    expect((other.value as string[])[0]).toContain('hands the patient over to the maternal hypertension service, the child adolescent service or the NCD advanced care service, by the other answers');
  });

  test('the ⓘ text is a reviewed decision: refused in the hints file, checked for builder words', () => {
    expect(() => compile((bundle as any).document, (bundle as any).catalog, (bundle as any).content, { ...(hints as Hints), help: { x: 'y' } } as Hints, layout)).toThrow('may not set "help"');
    const decide = (info: string) => build({ htn_dispense: { fields: { 'supply.packed': { info, reason: 'Because.', decidedBy: 'agent', status: 'review pending' } } } });
    expect(decide('Read by verify_htn_dispensing.').warnings).toContain('htn_dispense: the ⓘ of "supply.packed" uses a builder word. Write it for a clinician.');
    expect(decide('One. Two. Three.').warnings).toContain('htn_dispense: the ⓘ of "supply.packed" has more than two sentences.');
    expect(decide('Asked because it matters (RBCNCD24 p. 27, Fig. 9, Table 1).').warnings.filter(w => w.includes('sentences'))).toEqual([]);
    expect(build({ htn_dispense: { fields: { 'supply.nothing': { info: 'x', reason: 'Because.', decidedBy: 'agent', status: 'review pending' } } } }).warnings)
      .toContain('htn_dispense: forms.layout.json decides about the question "supply.nothing", but the form does not ask it.');
  });
});

describe('required and optional, and the control (E2, C1, C2, C4, F2)', () => {
  const o3q = (name: string, id: string, c = compiled) => c.forms.find(f => f.name === name)!.o3.pages[0].sections.flatMap(s => s.questions).find(q => q.id === id)!;

  test('an optional question says "(optional)"; a required one keeps only the O3 asterisk', () => {
    expect(o3q('event_measurement_recorded', 'extra__weight').label).toBe('Weight (kg) (optional)');
    expect(o3q('event_measurement_recorded', 'extra__weight').required).toBe(false);
    expect(o3q('event_measurement_recorded', 'reading__systolic').label).toBe('Systolic BP (mmHg)');
    for (const f of compiled.forms) for (const q of f.o3.pages[0].sections.flatMap(s => s.questions)) if (q.type === 'obs')
      expect(q.label.endsWith('(optional)')).toBe(!q.required);
    // Update forms use the same optional marker as task and event forms.
    expect(o3q('update_laboratory_result', 'laboratory_result__potassium').label).toBe('Serum potassium (mmol/L) (optional)');
  });

  test('radios up to five answers, stacked; a dropdown above five', () => {
    expect(o3q('htn_prescription_review', 'medicine').questionOptions).toMatchObject({ rendering: 'radio', orientation: 'vertical' });
    expect((o3q('htn_prescription_review', 'medicine').questionOptions.answers as unknown[]).length).toBe(5);
    expect(o3q('htn_prescription_review', 'action').questionOptions.rendering).toBe('radio');
    // Seven care levels and "Not known": a dropdown.
    expect(o3q('event_measurement_recorded', 'reading__encounter__care_level').questionOptions.rendering).toBe('select');
    expect(o3q('htn_clinical_review', 'assessment__symptoms').questionOptions).toMatchObject({ rendering: 'radio', orientation: 'vertical' });
  });

  test('a measurement is typed, with no stepper buttons', () => {
    expect(o3q('htn_prescription_review', 'dose').questionOptions.rendering).toBe('number');
    // The O3 form engine reads hideSteppers on the question itself.
    expect(o3q('htn_prescription_review', 'dose').hideSteppers).toBe(true);
  });

  test('a layout decision can choose the control or the orientation of a coded question only', () => {
    const decide = (path: string, d: object) => build({ htn_prescription_review: { fields: { [path]: { ...d, reason: 'Because.', decidedBy: 'Kuang', status: 'accepted' } } } });
    expect(o3q('htn_prescription_review', 'medicine', decide('medicine', { control: 'dropdown' })).questionOptions.rendering).toBe('select');
    expect(o3q('htn_prescription_review', 'action', decide('action', { orientation: 'horizontal' })).questionOptions.orientation).toBe('horizontal');
    expect(() => decide('dose', { control: 'radio' })).toThrow('applies only to a question with listed answers');
    expect(report(decide('medicine', { control: 'dropdown' }), hints as Hints, checkLayout({ htn_prescription_review: { fields: { medicine: { control: 'dropdown', reason: 'Because.', decidedBy: 'Kuang', status: 'accepted' } } } })))
      .toContain("- Question `medicine` (control dropdown): Kuang's choice, accepted. Because.");
    expect(() => decide('medicine', { control: 'slider' })).toThrow('control must be "radio" or "dropdown"');
  });
});

describe('labels use the words of the clinic (D1)', () => {
  test('a label made from a field name is a warning, once per name, with where it shows', () => {
    const bare = compile((bundle as any).document, (bundle as any).catalog, (bundle as any).content, {}, layout);
    const kind = bare.warnings.find(w => w.startsWith('The label "Kind"'))!;
    expect(kind).toBe('The label "Kind" is made from the name "kind" (htn_handover.next_work.kind, update_htn_external_work.kind). Add a clinical label in the hints file.');
    for (const word of ['Status', 'Retry', 'Amlodipine']) expect(bare.warnings.some(w => w.startsWith(`The label "${word}"`))).toBe(true);
  });

  test('the hints file gives the handover and recovery questions clinical labels', () => {
    const labels = (name: string) => form(name).questions.map(q => q.label);
    expect(labels('htn_handover')).toEqual(['Receiving service', 'Receiving service accepts the patient', 'Type of next care', 'Status of next care', 'Next care due']);
    expect(labels('htn_handover_recovery')).toEqual(['Try the handover again', 'What was arranged']);
    expect(compiled.warnings.filter(w => w.startsWith('The label'))).toEqual([]);
  });
});

describe('clinician context', () => {
  for (const name of ['htn_contact_overdue', 'htn_handover', 'htn_prescription_review']) {
    test(`${name} keeps its completion warnings visible in production and review`, () => {
      const f = form(name);
      expect(f.evidence).toBeTruthy();
      for (const build of [f.o3, f.review]) {
        const value = build.pages[0].sections[0].questions[0].value as string[];
        expect(value).toContain(`What the protocol needs: ${f.evidence}`);
      }
    });
  }
});
