/**
 * The whole hypertension path through generated forms only: every step answers the compiled form questions,
 * builds the O3 encounter the form engine would save, and lets the host turn it into a Nexo event.
 */
import { describe, expect, test } from 'bun:test';
import bundleJson from '../../../protocols/rwanda-htn/build/protocol.json';
import bindingJson from '../../../protocols/rwanda-htn/build/binding.json';
import hints from '../../../protocols/rwanda-htn/forms.hints.json';
import { NexoHost, type Binding, type FormBinding, type O3Encounter } from './host.ts';
import { prepareBundle, type LogEntry, type PatientFacts, type ProtocolBundle } from './session.ts';

const prepared = prepareBundle(bundleJson as unknown as ProtocolBundle);
const host = new NexoHost(prepared, bindingJson as unknown as Binding, hints.labels);
const PATIENT = { id: '11111111-2222-3333-4444-555555555555', birth_date: '1978-05-10', sex: 'male' as const };

let n = 0;
/** Answer questions by Nexo word or number, as a person would in the O3 form, and return the saved encounter. */
function encounter(form: FormBinding, answers: Record<string, string | number>, at: string): O3Encounter {
  const obs = Object.entries(answers).map(([id, v]) => {
    const q = form.questions.find(q => q.id === id);
    if (!q) throw new Error(`${form.name} has no question ${id}: ${form.questions.map(q => q.id).join(', ')}`);
    const value = v === 'not_known' && q.unknownAnswer ? { uuid: q.unknownAnswer, display: 'Not known' }
      : typeof v === 'string' && q.answers?.[v] ? { uuid: q.answers[v], display: v } : v;
    return { concept: { uuid: q.concept }, value, formFieldPath: `rfe-forms-${id}` };
  });
  return { uuid: `enc-${++n}`, encounterDatetime: at, obs };
}

class Chart {
  log: LogEntry[] = [];
  /** The time the chart is read at. By default the time of the last entry, so no timer fires after it. */
  now?: string;
  constructor(readonly patient: PatientFacts = PATIENT) {}
  get s() { return host.session(this.patient, this.log, this.now ?? this.log.at(-1)?.event.received_at ?? '2026-11-03T07:00:00Z'); }
  push(e: Omit<LogEntry, 'seq'>) { this.log.push({ ...e, seq: this.log.length } as LogEntry); }
  task(template: string) {
    const t = host.tasks(this.s).find(t => t.work.template === template);
    if (!t) throw new Error(`${template} is not open: ${host.tasks(this.s).map(t => t.work.template).join(', ')}`);
    return t;
  }
}

const VISIT = { reading__encounter__hypertension_symptoms: 'no', reading__encounter__organ_damage_evidence: 'no', reading__encounter__pregnant: 'no',
  reading__encounter__diabetes: 'no', reading__encounter__coronary_artery_disease: 'no', reading__encounter__chronic_kidney_disease: 'no',
  reading__encounter__care_level: 'health_center' };

describe('the generated forms carry a patient through the protocol', () => {
  test('screening, second reading, diagnosis, assessment, prescription, dispensing and receipt', () => {
    const chart = new Chart();
    const start = host.starts(chart.s).find(o => o.workflow === 'htn_screening_assessment')!;
    expect(start.form.name).toBe('event_measurement_recorded');
    chart.push(host.entryFor(chart.s, start.form, encounter(start.form, { reading__systolic: 140, reading__diastolic: 90, reading__setting: 'office', ...VISIT, extra__weight: 81 }, '2026-11-03T07:00:00.000+0000'), { start }));

    const repeat = chart.task('repeat_office_visit');
    const record = repeat.actions.find(a => a.kind === 'event')!;
    expect(record.form.event).toBe('measurement.recorded');
    chart.push(host.entryFor(chart.s, record.form, encounter(record.form, { reading__systolic: 140, reading__diastolic: 90, reading__setting: 'office', ...VISIT }, '2026-11-17T07:00:00.000+0000'), {}));

    const diagnosis = chart.task('diagnosis_review');
    expect(diagnosis.context.map(c => c.key)).toContain('second_reading');
    const dForm = diagnosis.actions[0].kind === 'form' ? diagnosis.actions[0].form : undefined;
    chart.push(host.entryFor(chart.s, dForm!, encounter(dForm!, { diagnosis: 'hypertension' }, '2026-11-17T07:10:00.000+0000'), { task: diagnosis.work }));

    const review = chart.task('htn_clinical_review');
    expect(review.context.find(c => c.key === 'reading')?.value).toContain('140/90 mmHg');
    const rForm = host.forms.get('htn_clinical_review')!;
    chart.push(host.entryFor(chart.s, rForm, encounter(rForm, { assessment__confirmed_htn: 'yes', assessment__pregnant: 'no', assessment__symptoms: 'no', assessment__organ_damage: 'no',
      assessment__new_concern: 'no', assessment__diabetes: 'no', assessment__cad: 'no', assessment__ckd: 'no', assessment__renal_reviewed: 'yes',
      assessment__contraindications_reviewed: 'yes', assessment__medication_reviewed: 'yes', assessment__adherence_reviewed: 'yes', assessment__adverse_effects: 'no',
      assessment__target_tolerated: 'yes', assessment__specialist_required: 'no', assessment__current_regimen: 'htn_no_regimen_attestation' }, '2026-11-17T07:15:00.000+0000'), { task: review.work }));

    const choice = chart.task('htn_first_prescription_review');
    const pForm = host.forms.get('htn_first_prescription_review')!;
    chart.push(host.entryFor(chart.s, pForm, encounter(pForm, { action: 'start', medicine: 'amlodipine', dose: 5, second_medicine: 'none',
      valid_until: '2026-12-18T21:59:00.000+0000', reason: 'Synthetic clinician choice of the national preferred example.' }, '2026-11-17T07:20:00.000+0000'), { task: choice.work }));

    const dispense = chart.task('htn_dispense');
    const xForm = host.forms.get('htn_dispense')!;
    const prefill = host.prefill(chart.s, xForm, dispense.work);
    expect(prefill.supply__medicine).toBe(xForm.questions.find(q => q.id === 'supply__medicine')!.answers!.amlodipine);
    expect(prefill.supply__dose).toBe('5');
    expect(dispense.context.find(c => c.key === 'prescription')?.value).toContain('Amlodipine 5 mg');
    chart.push(host.entryFor(chart.s, xForm, encounter(xForm, { supply__stock_available: 'yes', supply__packed: 'yes', supply__medicine: 'amlodipine', supply__dose: 5,
      supply__second_medicine: 'none', supply__coverage_until: '2026-12-17T07:20:00.000+0000' }, '2026-11-17T07:30:00.000+0000'), { task: dispense.work }));

    const receipt = chart.task('htn_receipt');
    const cForm = host.forms.get('htn_receipt')!;
    chart.push(host.entryFor(chart.s, cForm, encounter(cForm, { receipt__received: 'yes', receipt__proof: 'Patient confirms receiving amlodipine.' }, '2026-11-17T07:40:00.000+0000'), { task: receipt.work }));

    const view = chart.s.view();
    expect(view.workflows.find(w => w.workflow === 'htn_longitudinal_care')?.ended).toBe('prescription_received');
    expect(host.tasks(chart.s).map(t => t.work.template)).toContain('htn_next_review');
    expect(chart.log.length).toBe(7);
  });

  test('a reading without the pregnancy answer asks for exactly that answer, and the update form resumes the decision', () => {
    const chart = new Chart();
    const start = host.starts(chart.s).find(o => o.workflow === 'htn_screening_assessment')!;
    const { reading__encounter__pregnant, ...visit } = VISIT;
    chart.push(host.entryFor(chart.s, start.form, encounter(start.form, { reading__systolic: 150, reading__diastolic: 95, reading__setting: 'office', ...visit }, '2026-11-03T07:00:00.000+0000'), { start }));
    const ask = chart.task('collect_information');
    expect(ask.missing.map(m => m.field)).toEqual(['pregnant']);
    const action = ask.actions[0];
    expect(action.kind).toBe('update');
    if (action.kind !== 'update') return;
    const prefill = host.prefill(chart.s, action.form, undefined, action.object);
    expect(prefill.encounter__diabetes).toBe(action.form.questions.find(q => q.id === 'encounter__diabetes')!.answers!.no);
    // The form engine saves the prefilled answers with the new one.
    chart.push(host.entryFor(chart.s, action.form, encounter(action.form, { ...prefill, encounter__pregnant: 'no' }, '2026-11-03T07:05:00.000+0000'), { update: { ...action.object, collect: ask.work } }));
    const open = host.tasks(chart.s).map(t => t.work.template);
    expect(open).not.toContain('collect_information');
    expect(open).toContain('repeat_office_visit');
  });
});

describe('a start button names only a choice the person makes', () => {
  test('a fixed entry value stays out of the label and is still recorded; the visit type stays in the label', () => {
    const chart = new Chart();
    const starts = host.starts(chart.s);
    expect(starts.map(o => ({ workflow: o.workflow, label: o.label, choice: o.choice }))).toEqual([
      { workflow: 'htn_screening_assessment', label: 'Hypertension screening', choice: { unassessed_danger_review: 'empty' } },
      { workflow: 'htn_longitudinal_care', label: 'Hypertension care (Initial)', choice: { mode: 'initial' } },
      { workflow: 'htn_longitudinal_care', label: 'Hypertension care (Follow-up)', choice: { mode: 'follow_up' } },
    ]);
    const answers = { reading__systolic: 140, reading__diastolic: 90, reading__setting: 'office', ...VISIT };
    const bindings = (o: (typeof starts)[number]) => {
      const entry = host.entryFor(chart.s, o.form, encounter(o.form, answers, '2026-11-03T07:00:00Z'), { start: o });
      if (entry.kind !== 'launch') throw new Error(`expected a launch, got ${entry.kind}`);
      return entry.execution.bindings;
    };
    expect(bindings(starts[0]).unassessed_danger_review).toBe('empty');
    expect(bindings(starts[2]).mode).toBe('follow_up');
  });
});

/** Run the first path up to the prescription decision; returns the chart with that task open. */
function toAssessment(chart: Chart) {
  const start = host.starts(chart.s).find(o => o.workflow === 'htn_screening_assessment')!;
  chart.push(host.entryFor(chart.s, start.form, encounter(start.form, { reading__systolic: 140, reading__diastolic: 90, reading__setting: 'office', ...VISIT }, '2026-11-03T07:00:00.000+0000'), { start }));
  const reading = host.forms.get('event_measurement_recorded')!;
  chart.push(host.entryFor(chart.s, reading, encounter(reading, { reading__systolic: 140, reading__diastolic: 90, reading__setting: 'office', ...VISIT }, '2026-11-17T07:00:00.000+0000'), {}));
  const d = chart.task('diagnosis_review'), dForm = host.forms.get('diagnosis_review')!;
  chart.push(host.entryFor(chart.s, dForm, encounter(dForm, { diagnosis: 'hypertension' }, '2026-11-17T07:10:00.000+0000'), { task: d.work }));
  return chart.task('htn_clinical_review');
}
function toPrescription(chart: Chart) {
  toAssessment(chart);
  assess(chart, '2026-11-17T07:15:00.000+0000');
  return chart.task('htn_first_prescription_review');
}
function assess(chart: Chart, at: string, regimen: string | null = 'htn_no_regimen_attestation') {
  const r = chart.task('htn_clinical_review'), rForm = host.forms.get('htn_clinical_review')!;
  chart.push(host.entryFor(chart.s, rForm, encounter(rForm, { assessment__confirmed_htn: 'yes', assessment__pregnant: 'no', assessment__symptoms: 'no', assessment__organ_damage: 'no',
    assessment__new_concern: 'no', assessment__diabetes: 'no', assessment__cad: 'no', assessment__ckd: 'no', assessment__renal_reviewed: 'yes',
    assessment__contraindications_reviewed: 'yes', assessment__medication_reviewed: 'yes', assessment__adherence_reviewed: 'yes', assessment__adverse_effects: 'no',
    assessment__target_tolerated: 'yes', assessment__specialist_required: 'no', ...(regimen ? { assessment__current_regimen: regimen } : {}) }, at), { task: r.work }));
}
function submit(chart: Chart, template: string, answers: Record<string, string | number>, at: string) {
  const t = chart.task(template), f = host.forms.get(template)!;
  const entry = host.entryFor(chart.s, f, encounter(f, answers, at), { task: t.work });
  const checked = host.check(chart.s, entry);
  if (!checked.ok) throw new Error(`${template} refused: ${checked.reasons.join('; ')}`);
  chart.push(entry);
}

describe('a person who does not know an answer says so', () => {
  test('"Not known" for pregnancy is stored as unknown, and the protocol asks for exactly that answer', () => {
    const chart = new Chart();
    const start = host.starts(chart.s).find(o => o.workflow === 'htn_screening_assessment')!;
    expect(start.form.questions.find(q => q.id === 'reading__encounter__pregnant')!.unknownAnswer).toBe('CIEL:1067');
    chart.push(host.entryFor(chart.s, start.form, encounter(start.form, { reading__systolic: 150, reading__diastolic: 95, reading__setting: 'office', ...VISIT, reading__encounter__pregnant: 'not_known' }, '2026-11-03T07:00:00.000+0000'), { start }));
    expect(chart.task('collect_information').missing.map(m => m.field)).toEqual(['pregnant']);
  });
});

describe('the assessment records explicit current-regimen evidence', () => {
  test('a single high visit reaches diagnosis, the first combination form and two-week review', () => {
    const chart = new Chart();
    const start = host.starts(chart.s).find(o => o.workflow === 'htn_screening_assessment')!;
    chart.push(host.entryFor(chart.s, start.form, encounter(start.form, { reading__systolic: 170, reading__diastolic: 105, reading__setting: 'office', ...VISIT }, '2026-11-17T07:00:00Z'), { start }));
    submit(chart, 'htn_single_visit_diagnosis', { diagnosis: 'hypertension' }, '2026-11-17T07:10:00Z');
    assess(chart, '2026-11-17T07:15:00Z');
    submit(chart, 'htn_first_prescription_review', { action: 'start', medicine: 'enalapril', dose: 5, second_medicine: 'amlodipine', second_dose: 5,
      potassium_result__potassium: 4, valid_until: '2026-12-18T21:59:00Z', reason: 'Synthetic supported initial combination.' }, '2026-11-17T07:20:00Z');
    expect(chart.task('htn_next_review').work.due?.at).toBe('2026-12-01T09:20:00+02:00');
    submit(chart, 'htn_dispense', { supply__stock_available: 'yes', supply__packed: 'yes', supply__medicine: 'enalapril', supply__dose: 5,
      supply__second_medicine: 'amlodipine', supply__second_dose: 5, supply__coverage_until: '2026-12-01T07:20:00Z' }, '2026-11-17T07:30:00Z');
    submit(chart, 'htn_receipt', { receipt__received: 'yes', receipt__proof: 'Synthetic patient confirms receipt.' }, '2026-11-17T07:40:00Z');
    expect(chart.s.view().workflows.find(w => w.workflow === 'htn_longitudinal_care')?.ended).toBe('prescription_received');
  });

  test('no history stays unknown until the clinician makes a dated no-regimen attestation', () => {
    const chart = new Chart();
    toAssessment(chart);
    const form = host.forms.get('htn_clinical_review')!;
    expect(host.prefill(chart.s, form, chart.task('htn_clinical_review').work).assessment__current_regimen).toBeUndefined();
    assess(chart, '2026-11-17T07:15:00.000+0000');
    const event = chart.log.at(-1)!.event;
    const objects = event.receipt!.objects as any[];
    const attestation = objects.find(o => o.type === 'htn_no_regimen_attestation');
    expect(attestation.fields).toEqual({ patient: { type: 'patient', id: PATIENT.id }, attested_by: event.actor, time: '2026-11-17T07:15:00Z' });
    expect(objects.find(o => o.type === 'htn_assessment').fields.current_regimen).toEqual({ type: attestation.type, id: attestation.id });
    expect(chart.task('htn_first_prescription_review').work.content?.current_regimen).toEqual({ type: attestation.type, id: attestation.id });
    expect(host.tasks(chart.s).some(t => t.work.template === 'htn_prescription_review')).toBe(false);
  });

  test.each([null, 'not_known'])('an unanswered regimen (%s) retains owned assessment without a prescription', regimen => {
    const chart = new Chart();
    const review = toAssessment(chart).work;
    assess(chart, '2026-11-17T07:15:00.000+0000', regimen);
    const corrected = chart.task('htn_clinical_review').work;
    expect(corrected.owner).toEqual(review.owner);
    expect(corrected.due).toEqual(review.due);
    expect(host.tasks(chart.s).some(t => ['htn_prescription_review', 'htn_first_prescription_review', 'prescription'].includes(t.work.template))).toBe(false);
    expect((chart.log.at(-1)!.event.receipt!.objects as any[]).some(o => o.type === 'htn_no_regimen_attestation')).toBe(false);
    assess(chart, '2026-11-17T07:16:00.000+0000');
    expect(chart.task('htn_first_prescription_review')).toBeDefined();
  });

  test('selecting an absent prescription gives a readable refusal and never infers no regimen', () => {
    const chart = new Chart();
    toAssessment(chart);
    const before = chart.log.length;
    expect(() => assess(chart, '2026-11-17T07:15:00.000+0000', 'htn_prescription')).toThrow('No hypertension prescription is recorded for this patient');
    expect(chart.log.length).toBe(before);
    expect(chart.task('htn_clinical_review')).toBeDefined();
  });

  test.each(['wrong patient', 'wrong clinician', 'future time'])('Core retains review for an attestation with %s', defect => {
    const chart = new Chart();
    toPrescription(chart);
    const entry = structuredClone(chart.log.pop()!);
    const attestation = (entry.event.receipt!.objects as any[]).find(o => o.type === 'htn_no_regimen_attestation');
    if (defect === 'wrong patient') attestation.fields.patient.id = 'other-patient';
    if (defect === 'wrong clinician') attestation.fields.attested_by = { ...attestation.fields.attested_by, id: 'other-clinician' };
    if (defect === 'future time') attestation.fields.time = '2026-11-18T07:15:00Z';
    chart.push(entry);
    if (defect === 'wrong patient') {
      expect(chart.task('htn_clinical_review')).toBeDefined();
      expect(host.tasks(chart.s).some(t => t.work.template === 'prescription')).toBe(false);
      return;
    }
    const choice = chart.task('htn_first_prescription_review');
    const form = host.forms.get('htn_first_prescription_review')!;
    const decision = host.entryFor(chart.s, form, encounter(form, { action: 'start', medicine: 'amlodipine', dose: 5, second_medicine: 'none', valid_until: '2026-12-18T21:59:00Z', reason: 'Synthetic.' }, '2026-11-17T07:20:00Z'), { task: choice.work });
    chart.push(decision as LogEntry);
    expect(chart.task('htn_first_prescription_review')).toBeDefined();
    expect(host.tasks(chart.s).some(t => t.work.template === 'prescription')).toBe(false);
  });
});

describe('paths beyond the first prescription', () => {
  test('"refer" is accepted with the required fields and opens a handover that the receiving clinician can accept', () => {
    const chart = new Chart();
    toPrescription(chart);
    submit(chart, 'htn_first_prescription_review', { action: 'refer', medicine: 'amlodipine', dose: 5, second_medicine: 'none', valid_until: '2026-12-18T21:59:00.000+0000',
      reason: 'Synthetic clinician choice: an individual plan is needed.' }, '2026-11-17T07:20:00.000+0000');
    const handover = chart.task('htn_handover');
    const f = host.forms.get('htn_handover')!;
    const prefill = host.prefill(chart.s, f, handover.work);
    expect(prefill.destination).toBe(String(handover.work.content!.destination));
    submit(chart, 'htn_handover', { destination: String(handover.work.content!.destination), accepted: 'yes', next_work__kind: 'clinical_assessment',
      next_work__status: 'accepted', next_work__due_at: '2026-11-18T07:00:00.000+0000' }, '2026-11-17T08:00:00.000+0000');
    expect(host.tasks(chart.s).map(t => t.work.template)).not.toContain('htn_handover');
  });

  test('a stock-out at dispensing is recorded and opens supply recovery for the coordinator', () => {
    const chart = new Chart();
    toPrescription(chart);
    submit(chart, 'htn_first_prescription_review', { action: 'start', medicine: 'amlodipine', dose: 5, second_medicine: 'none', valid_until: '2026-12-18T21:59:00.000+0000', reason: 'Synthetic.' }, '2026-11-17T07:20:00.000+0000');
    submit(chart, 'htn_dispense', { supply__stock_available: 'no', supply__packed: 'no', supply__medicine: 'amlodipine', supply__dose: 5, supply__second_medicine: 'none' }, '2026-11-17T07:30:00.000+0000');
    const recovery = chart.task('htn_supply_recovery');
    expect(recovery.roleLabel).toBe('Care coordinator');
  });

  test('the next review starts a follow-up assessment with the current prescription, and a renewal is authorized', () => {
    const chart = new Chart();
    toPrescription(chart);
    submit(chart, 'htn_first_prescription_review', { action: 'start', medicine: 'amlodipine', dose: 5, second_medicine: 'none', valid_until: '2027-01-30T21:59:00.000+0000', reason: 'Synthetic.' }, '2026-11-17T07:20:00.000+0000');
    submit(chart, 'htn_dispense', { supply__stock_available: 'yes', supply__packed: 'yes', supply__medicine: 'amlodipine', supply__dose: 5, supply__second_medicine: 'none', supply__coverage_until: '2026-12-17T07:20:00.000+0000' }, '2026-11-17T07:30:00.000+0000');
    submit(chart, 'htn_receipt', { receipt__received: 'yes', receipt__proof: 'Patient confirms.' }, '2026-11-17T07:40:00.000+0000');
    // The next review: a new office reading at a new visit.
    const next = host.forms.get('htn_next_review')!;
    const prefill = host.prefill(chart.s, next, chart.task('htn_next_review').work);
    expect(prefill.reading__encounter__diabetes).toBe(next.questions.find(q => q.id === 'reading__encounter__diabetes')!.answers!.no);
    expect(prefill.reading__encounter__hypertension_symptoms).toBeUndefined();
    expect(prefill.reading__encounter__pregnant).toBeUndefined();
    submit(chart, 'htn_next_review', { reading__systolic: 128, reading__diastolic: 76, reading__setting: 'office', ...VISIT }, '2026-12-17T07:00:00.000+0000');
    expect(chart.task('htn_clinical_review').work.content?.mode).toBe('follow_up');
    expect(chart.task('htn_clinical_review').context.find(c => c.key === 'htn_prescription')?.value).toContain('Amlodipine 5 mg');
    assess(chart, '2026-12-17T07:10:00.000+0000', 'htn_prescription');
    const evidence = chart.log.at(-1)!.event.receipt!.objects as any[];
    expect(evidence.find(o => o.type === 'htn_assessment').fields.current_regimen.type).toBe('htn_prescription');
    expect(evidence.some(o => o.type === 'htn_no_regimen_attestation')).toBe(false);
    const choice = chart.task('htn_prescription_review');
    // A decision is never prefilled from history.
    expect(host.prefill(chart.s, host.forms.get('htn_prescription_review')!, choice.work).medicine).toBeUndefined();
    submit(chart, 'htn_prescription_review', { action: 'renew', medicine: 'amlodipine', dose: 5, second_medicine: 'none', valid_until: '2027-04-30T21:59:00.000+0000', reason: 'Synthetic renewal.' }, '2026-12-17T07:15:00.000+0000');
    const open = host.tasks(chart.s).map(t => t.work.template);
    expect(open).toContain('htn_dispense');
    expect(open).not.toContain('htn_prescription_review');
  });

  test('replay uses the patient facts recorded at the first launch, not today\'s record', () => {
    const chart = new Chart();
    toPrescription(chart);
    const today = host.session({ ...PATIENT, birth_date: '2015-01-01' }, chart.log, chart.s.now);
    expect(host.tasks(today).map(t => t.work.template)).toEqual(host.tasks(chart.s).map(t => t.work.template));
  });

  test('an event that Core refuses is reported and not stored', () => {
    const chart = new Chart();
    const t = toPrescription(chart), f = host.forms.get('htn_first_prescription_review')!;
    const entry = host.entryFor(chart.s, f, encounter(f, { action: 'refer', reason: 'No medicine given.' }, '2026-11-17T07:20:00.000+0000'), { task: t.work });
    const checked = host.check(chart.s, entry);
    expect(checked.ok).toBe(false);
    expect(checked.reasons.join(' ')).toContain('medicine');
  });
});

describe('replay depends only on the log and the time it is read at', () => {
  const normal = { reading__systolic: 118, reading__diastolic: 76, reading__setting: 'office', ...VISIT };

  test('a patient fact absent at the first launch stays absent when the record has it later', () => {
    const { birth_date: _, ...noBirthDate } = PATIENT;
    const chart = new Chart(noBirthDate);
    const start = host.starts(chart.s).find(o => o.workflow === 'htn_screening_assessment')!;
    chart.push(host.entryFor(chart.s, start.form, encounter(start.form, normal, '2026-11-03T07:00:00.000+0000'), { start }));
    expect(host.tasks(chart.s).map(t => t.work.template)).toEqual(['collect_information']);
    // The record now has a birth date. The same log must replay to the same work.
    const today = host.session(PATIENT, chart.log, chart.s.now);
    expect(today.patient.birth_date).toBeUndefined();
    expect(host.tasks(today).map(t => t.work.template)).toEqual(['collect_information']);
  });

  test('work that falls due with no new patient event opens the contact task, which a person can complete', () => {
    const chart = new Chart();
    const start = host.starts(chart.s).find(o => o.workflow === 'htn_screening_assessment')!;
    chart.push(host.entryFor(chart.s, start.form, encounter(start.form, normal, '2026-11-03T07:00:00.000+0000'), { start }));
    const recall = chart.task('screening_recall');
    expect(recall.due).toBe('2027-11-03T09:00:00+02:00');
    chart.now = '2027-11-03T06:59:00Z';
    expect(host.tasks(chart.s).map(t => t.work.template)).toEqual(['screening_recall']);
    // No patient event after the due time: only the clock moves.
    chart.now = '2027-11-10T07:00:00Z';
    const s = chart.s;
    expect(host.tasks(s).map(t => t.work.template)).toContain('htn_contact_overdue');
    expect(host.tasks(s).find(t => t.work.template === 'screening_recall')?.overdue).toBe(true);
    // The timer's step is kept apart: the history still has one line per log entry.
    expect(s.reports.length).toBe(chart.log.length);
    expect(s.steps.length).toBeGreaterThan(chart.log.length);
    expect(host.history(s).length).toBe(chart.log.length);
    submit(chart, 'htn_contact_overdue', { contacted: 'yes', note: 'Synthetic: the patient was reached by phone.' }, '2027-11-10T07:30:00.000+0000');
    expect(host.tasks(chart.s).map(t => t.work.template)).not.toContain('htn_contact_overdue');
  });
});

describe('the host reads the chart at the current time by default', () => {
  test('a session without a time is read now', () => {
    const before = Date.now();
    const at = Date.parse(host.session(PATIENT, []).now!);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe('an update form is the record of the fields it asks', () => {
  test('a known answer that the person clears becomes unknown in the new revision', () => {
    const chart = new Chart();
    const start = host.starts(chart.s).find(o => o.workflow === 'htn_screening_assessment')!;
    const { reading__encounter__pregnant: _, ...visit } = VISIT;
    chart.push(host.entryFor(chart.s, start.form, encounter(start.form, { reading__systolic: 150, reading__diastolic: 95, reading__setting: 'office', ...visit }, '2026-11-03T07:00:00.000+0000'), { start }));
    const ask = chart.task('collect_information');
    const action = ask.actions[0];
    if (action.kind !== 'update') throw new Error(`expected an update action, got ${action.kind}`);
    expect(host.objectFields(chart.s, action.object.type, action.object.id)?.diabetes).toBe('no');
    // The form opens with diabetes "No". The person clears it and answers pregnancy.
    const { encounter__diabetes: cleared, ...prefill } = host.prefill(chart.s, action.form, undefined, action.object);
    expect(cleared).toBeDefined();
    const entry = host.entryFor(chart.s, action.form, encounter(action.form, { ...prefill, encounter__pregnant: 'no' }, '2026-11-03T07:05:00.000+0000'), { update: { ...action.object, collect: ask.work } });
    expect(host.check(chart.s, entry).ok).toBe(true);
    chart.push(entry);
    const fields = host.objectFields(chart.s, action.object.type, action.object.id)!;
    expect(fields.pregnant).toBe('no');
    expect(fields.diabetes).toBeUndefined();
    // A field that the form does not ask keeps its value.
    expect(fields.patient).toEqual({ type: 'patient', id: PATIENT.id });
  });
});

describe('clinical history preserves care effects', () => {
  test('140/90 on 3 November then 120/80 on 17 November shows the cancelled repeat visit', () => {
    const chart = new Chart();
    const start = host.starts(chart.s).find(o => o.workflow === 'htn_screening_assessment')!;
    chart.push(host.entryFor(chart.s, start.form, encounter(start.form, { reading__systolic: 140, reading__diastolic: 90, reading__setting: 'office', ...VISIT }, '2026-11-03T07:00:00Z'), { start }));
    const repeat = chart.task('repeat_office_visit');
    const record = repeat.actions.find(a => a.kind === 'event')!;
    chart.push(host.entryFor(chart.s, record.form, encounter(record.form, { reading__systolic: 120, reading__diastolic: 80, reading__setting: 'office', ...VISIT }, '2026-11-17T07:00:00Z'), {}));
    const session = chart.s;
    expect(host.tasks(session).some(t => t.work.template === 'repeat_office_visit')).toBe(false);
    expect(host.tasks(session).some(t => t.work.template === 'htn_handover')).toBe(true);
    const history = host.history(session).at(-1)!;
    expect(history.decisions.some(d => d.description === 'Repeat office visit cancelled: second visit handover requested')).toBe(true);
    const unmet = history.decisions.filter(d => d.rule === 'report_unmet_need');
    // The protocol names the missing information in authoring words; the hints label names it in clinician words.
    // The request for the second reading falls due and is completed in this same step; the handover stays open.
    expect(unmet.map(d => d.description)).toEqual(['Collect information was due and was completed in the same step: Second blood-pressure reading, with its time and the visit findings', 'Hypertension handover still needed']);
    expect(host.tasks(session).some(t => t.work.template === 'collect_information')).toBe(false);
    expect(new Set(history.decisions.map(d => d.id)).size).toBe(history.decisions.length);
  });
});

describe('display names from the hints file reach the care pathway', () => {
  test('the lifestyle task, its advice and the laboratory order read in clinician words', () => {
    const chart = new Chart();
    toAssessment(chart);
    const lifestyle = chart.task('lifestyle_counselling');
    expect(lifestyle.title).toBe('Lifestyle advice');
    expect(host.forms.get('lifestyle_counselling')!.title).toBe('Lifestyle advice');
    expect(lifestyle.context.find(c => c.key === 'advice')?.value).toBe('Smoking cessation, Control blood glucose and lipids, DASH diet, Moderate-to-vigorous physical activity: 150 minutes per week');
    const order = host.tasks(chart.s).find(t => t.kind === 'order' && t.context.some(c => c.key === 'tests'))!;
    expect(order.context.find(c => c.key === 'tests')?.value).toBe('Urea, Creatinine, Blood glucose, HbA1c, Sodium, Serum potassium, Chloride, Full blood count, Albuminuria');
    // "Mark as done" records the task. The history titles the entry by the same name.
    expect(lifestyle.actions.map(a => a.kind)).toEqual(['confirm']);
    chart.push(host.confirm(chart.s, lifestyle.work, '2026-11-17T07:12:00Z'));
    const done = host.history(chart.s).at(-1)!;
    expect(done.task).toBe('lifestyle_counselling');
    expect(host.taskTitle(done.task!)).toBe('Lifestyle advice');
  });
});

describe('a title label renames a task on every screen', () => {
  test('the task card, a reference to the work, the completed-task title and the history use the label', () => {
    const titled = new NexoHost(prepared, bindingJson as unknown as Binding, { ...hints.labels, 'title:repeat_office_visit': 'Repeat BP visit' });
    expect(host.taskTitle('repeat_office_visit')).toBe('Repeat office BP visit within four weeks (RBCNCD24 PDF p.12 Fig. 2 and PDF p.24)');
    expect(titled.taskTitle('repeat_office_visit')).toBe('Repeat BP visit');
    const chart = new Chart();
    const start = host.starts(chart.s).find(o => o.workflow === 'htn_screening_assessment')!;
    chart.push(host.entryFor(chart.s, start.form, encounter(start.form, { reading__systolic: 140, reading__diastolic: 90, reading__setting: 'office', ...VISIT }, '2026-11-03T07:00:00Z'), { start }));
    const repeat = titled.tasks(chart.s).find(t => t.work.template === 'repeat_office_visit')!;
    expect(repeat.title).toBe('Repeat BP visit');
    expect(titled.describe(chart.s, repeat.work.ref as unknown as Parameters<NexoHost['describe']>[1])).toBe('Repeat BP visit');
    const record = repeat.actions.find(a => a.kind === 'event')!;
    chart.push(host.entryFor(chart.s, record.form, encounter(record.form, { reading__systolic: 120, reading__diastolic: 80, reading__setting: 'office', ...VISIT }, '2026-11-17T07:00:00Z'), {}));
    const descriptions = titled.history(chart.s).at(-1)!.decisions.map(d => d.description);
    expect(descriptions).toContain('Repeat BP visit cancelled: second visit handover requested');
  });
});
