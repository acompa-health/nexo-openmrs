import { describe, expect, test } from 'bun:test';
import bundle from '../../../protocols/rwanda-htn/build/protocol.json';
import hints from '../../../protocols/rwanda-htn/forms.hints.json';
import layout from '../../../protocols/rwanda-htn/forms.layout.json';
import { compile, javaNameUuid, type Hints } from './compile.ts';
import { initializerFiles } from './initializer.ts';
import { report } from './report.ts';
import { engineFields, hiddenOnServer } from './fake-form-engine.ts';

const withHints = compile((bundle as any).document, (bundle as any).catalog, (bundle as any).content, hints as Hints);
const bare = compile((bundle as any).document, (bundle as any).catalog, (bundle as any).content, {});
const form = (name: string, c = withHints) => c.forms.find(f => f.name === name)!;
const q = (f: ReturnType<typeof form>, id: string) => f.questions.find(q => q.id === id)!;

describe('the compiler derives forms from the protocol alone', () => {
  test('without hints it still makes every form, and every question traces to the catalog', () => {
    expect(bare.forms.map(f => f.name).sort()).toEqual(withHints.forms.map(f => f.name).sort());
    const catalog = (bundle as any).catalog.objects as Record<string, { fields: Record<string, unknown> }>;
    const templates = (bundle as any).document.definitions.work_templates as Record<string, { result?: Record<string, unknown> }>;
    for (const f of bare.forms) for (const x of f.questions) {
      if (x.object) expect(catalog[x.object].fields[x.field]).toBeDefined();
      else expect(templates[f.template!]?.result?.[x.field] ?? (bundle as any).catalog.events[f.event!]?.payload?.[x.field]).toBeDefined();
    }
    // A protocol finding, not a warning: the rules look at the CKD stage only where CKD is already "no".
    expect(bare.findings.find(f => f.kind === 'removed')!.text).toContain('the form does not ask "Ckd stage" (assessment.ckd_stage)');
  });

  test('the hints only rename, bind concepts, name looked-up objects, and add fields that state a reason', () => {
    const lookupOnly = compile((bundle as any).document, (bundle as any).catalog, (bundle as any).content, { existing: (hints as Hints).existing, references: (hints as Hints).references });
    const extra = withHints.forms.flatMap(f => f.questions.filter(x => x.extra));
    expect(extra.map(x => x.id).sort()).toEqual(['extra__height', 'extra__waist', 'extra__weight']);
    for (const x of extra) expect(x.why).toContain('RBCNCD24');
    const asked = (c: typeof bare) => c.forms.flatMap(f => f.questions.filter(x => !x.extra).map(x => `${f.name}/${x.id}/${x.required}/${x.shownWhen ?? ''}`)).sort();
    expect(asked(withHints).length).toBe(asked(lookupOnly).length);
    // The two object-reference questions need host choices, which the bare compiler cannot supply.
    expect(asked(lookupOnly).length - asked(bare).length).toBe(2);
  });

  test('a label decision names a label and says why, who decided and its status; the report lists it', () => {
    const build = ($labelDecisions: unknown) => compile((bundle as any).document, (bundle as any).catalog, (bundle as any).content, { ...hints, $labelDecisions } as Hints);
    const entry = { reason: 'Because.', decidedBy: 'agent', status: 'review pending' };
    expect(() => build({ no_such_label: entry })).toThrow('$labelDecisions names "no_such_label", which has no label');
    expect(() => build({ systolic: { ...entry, decidedBy: 'someone' } })).toThrow('$labelDecisions.systolic.decidedBy must be "agent" or "Kuang"');
    expect(() => build({ systolic: { ...entry, reason: ' ' } })).toThrow('must say why');
    expect(() => build({ systolic: { ...entry, label: 'Systolic' } })).toThrow('is not part of a decision');
    expect(report(withHints, { ...hints, $labelDecisions: { systolic: entry } } as Hints)).toContain('- `systolic` → "Systolic BP": agent\'s choice, review pending. Because.');
  });

  test('potassium is asked only when an ACE inhibitor is prescribed; required fields are never hidden', () => {
    const f = form('htn_prescription_review');
    const k = q(f, 'potassium_result__potassium');
    expect(k.required).toBe(true);
    expect(k.shownWhen).toContain('Medicine is Enalapril or Lisinopril');
    // On a server where the CIEL medicines have other UUIDs, the form engine shows it for exactly those two.
    const medicines = (q(f, 'medicine').type as any).values as string[];
    const shownFor = medicines.filter(m => !hiddenOnServer(f.o3, k.hide!, { action: q(f, 'action').answers!.start, medicine: q(f, 'medicine').answers![m] }));
    expect(shownFor).toEqual(['enalapril', 'lisinopril']);
    expect(hiddenOnServer(f.o3, k.hide!, { action: q(f, 'action').answers!.start })).toBe(true);
    // The template requires medicine, dose and validity even for "refer", so they always show.
    for (const id of ['action', 'medicine', 'dose', 'second_medicine', 'valid_until', 'reason']) expect(q(f, id).hide).toBeUndefined();
    expect(q(f, 'second_dose').shownWhen).toContain('Second medicine is Amlodipine or Hydrochlorothiazide or Indapamide SR');
    const first = form('htn_first_prescription_review');
    expect(q(first, 'potassium_result__potassium').shownWhen).toContain('Medicine is Enalapril or Lisinopril');
    expect(q(first, 'potassium_result__potassium').why).not.toContain('authorize_htn_prescription,');
  });

  test('generic object references need explicit choices and never receive the actor as their value', () => {
    const f = form('htn_clinical_review', bare);
    expect(f.objects[0].host.current_regimen).toBeUndefined();
    expect(bare.warnings.some(w => w.includes('htn_assessment.current_regimen needs object reference choices'))).toBe(true);
    const build = (choices: Hints['references']) => compile((bundle as any).document, (bundle as any).catalog, (bundle as any).content, { ...hints, references: choices } as Hints);
    expect(() => build({ 'htn_assessment.current_regimen': {} })).toThrow('reference choices must not be empty');
    expect(() => build({ 'htn_assessment.current_regimen': { missing_object: 'latest' } })).toThrow('invalid reference choice missing_object');
    expect(() => build({ 'htn_assessment.current_regimen': { htn_prescription: 'attest' } })).toThrow('needs fields that an encounter cannot attest');
    expect(form('update_htn_assessment').questions.find(q => q.field === 'current_regimen')?.references).toEqual({ htn_prescription: 'latest', htn_no_regimen_attestation: 'attest' });
  });

  test('a dropdown placeholder preserves potassium visibility for every medicine', () => {
    const dropdown = compile((bundle as any).document, (bundle as any).catalog, (bundle as any).content, hints as Hints, {
      ...layout,
      htn_prescription_review: { fields: { medicine: { control: 'dropdown', reason: 'Exercise the supported dropdown control.', decidedBy: 'Kuang', status: 'accepted' } } },
    });
    const f = form('htn_prescription_review', dropdown), medicine = q(f, 'medicine'), k = q(f, 'potassium_result__potassium');
    const field = engineFields(f.o3).find(x => x.id === 'medicine')!;
    expect(field.questionOptions.rendering).toBe('select');
    expect(field.questionOptions.answers![0]).toEqual({ value: 'null-select-option', label: 'Choose an option' });
    const shownFor = ((medicine.type as any).values as string[]).filter(m =>
      !hiddenOnServer(f.o3, k.hide!, { action: q(f, 'action').answers!.start, medicine: medicine.answers![m] }));
    expect(shownFor).toEqual(['enalapril', 'lisinopril']);
    for (const empty of [undefined, 'null-select-option'])
      expect(hiddenOnServer(f.o3, k.hide!, { action: q(f, 'action').answers!.start, medicine: empty })).toBe(true);
  });

  test('dropdown placeholders preserve a condition on two coded answers', () => {
    const dropdown = compile((bundle as any).document, (bundle as any).catalog, (bundle as any).content, hints as Hints, {
      htn_dispense: { fields: Object.fromEntries(['supply.stock_available', 'supply.packed'].map(path =>
        [path, { control: 'dropdown', reason: 'Exercise dropdown gates together.', decidedBy: 'Kuang', status: 'accepted' }])) },
    });
    const f = form('htn_dispense', dropdown), coverage = q(f, 'supply__coverage_until');
    for (const [stock, packed, hidden] of [['yes', 'yes', false], ['no', 'yes', true], ['yes', 'no', true]] as const)
      expect(hiddenOnServer(f.o3, coverage.hide!, {
        supply__stock_available: q(f, 'supply__stock_available').answers![stock], supply__packed: q(f, 'supply__packed').answers![packed],
      })).toBe(hidden);
  });

  test('no generated form hides a field the protocol requires, and no hide condition is circular', () => {
    for (const c of [withHints, bare]) for (const f of c.forms) {
      for (const x of f.questions) if (x.mandatory) expect(x.hide).toBeUndefined();
      for (const x of f.questions) for (const g of x.gates ?? []) expect(f.questions.find(y => y.id === g)?.gates ?? []).not.toContain(x.id);
    }
    const handover = form('htn_handover');
    expect(handover.questions.filter(x => x.hide).map(x => x.id)).toEqual([]);
  });

  test('dispensing asks medicine and dose even at a stock-out; the supply end waits for stock and packing', () => {
    const f = form('htn_dispense');
    expect(q(f, 'supply__medicine').hide).toBeUndefined();
    expect(q(f, 'supply__coverage_until').shownWhen).toBe('Medicine in stock is Yes and Supply packed for the patient is Yes');
    expect(f.objects[0].host.prescription).toEqual({ from: 'content', key: 'prescription' });
  });

  test('a finding is never hidden by an "or" sibling: symptoms and organ damage are both always asked', () => {
    const f = form('htn_clinical_review');
    expect(q(f, 'assessment__symptoms').hide).toBeUndefined();
    expect(q(f, 'assessment__organ_damage').hide).toBeUndefined();
    expect(f.objects[0].host.current_regimen).toBeUndefined();
    expect(q(f, 'assessment__current_regimen')).toMatchObject({ required: true, references: { htn_prescription: 'latest', htn_no_regimen_attestation: 'attest' } });
    expect(q(f, 'extra__weight' as any)).toBeUndefined();
  });

  test('the reading form can start screening and follow-up, and nests the visit findings', () => {
    const f = form('event_measurement_recorded');
    expect(f.starts.map(s => s.workflow)).toEqual(['htn_screening_assessment', 'htn_longitudinal_care']);
    expect(f.objects.map(o => o.path.join('.'))).toEqual(['reading', 'reading.encounter']);
    expect(q(f, 'reading__systolic').concept).toBe('CIEL:5085');
  });

  test('forms, binding and Initializer files name each CIEL concept by its mapping, never by a CIEL-style UUID', () => {
    // Each server resolves "CIEL:<code>" to its own concept. The PIH EMR holds most CIEL concepts under PIH UUIDs.
    const cielStyle = /\b\d+A{10,}\b/;
    const files = initializerFiles(withHints);
    expect(Object.entries(files).filter(([, text]) => cielStyle.test(text)).map(([path]) => path)).toEqual([]);
    expect(withHints.forms.filter(f => cielStyle.test(JSON.stringify({ q: f.questions, o3: f.o3, review: f.review }))).map(f => f.name)).toEqual([]);
    const mapped = withHints.concepts.filter(c => c.mapping?.startsWith('CIEL:'));
    expect(mapped.length).toBe(16);
    for (const c of mapped) expect(c.reference).toBe(c.mapping!);
    expect(files['concepts/nexo-2-questions.csv']).toContain('CIEL:1065;CIEL:1066;CIEL:1067');
  });

  test('form UUIDs equal the ones OpenMRS Initializer computes', () => {
    const f = form('htn_dispense');
    expect(f.uuid).toBe(javaNameUuid(`794c4598-ab82-47ca-8d18-483a8abe6f4f_${f.o3.name}_${f.o3.version}`));
    // OpenMRS refuses a form version that does not start with a digit.
    for (const x of withHints.forms) expect(x.o3.version).toMatch(/^\d/);
    expect(new Set(withHints.forms.map(x => x.encounterType.name)).size).toBe(withHints.forms.length);
    expect(f.o3.encounter).toBe('Nexo HTN dispensing');
  });

  test('an update form requires the fields that every revision of its object has', () => {
    // The host records every field an update form asks, and Core refuses a revision without a required field.
    const required = (name: string) => form(name).questions.filter(x => x.required).map(x => x.field);
    expect(required('update_observation')).toEqual(['systolic', 'diastolic', 'setting']);
    expect(required('update_encounter')).toEqual([]);
    for (const x of form('update_observation').questions) expect(x.hide).toBeUndefined();
  });
});
