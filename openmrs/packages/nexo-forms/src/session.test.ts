import { describe, expect, test } from 'bun:test';
import bundleJson from '../../../protocols/rwanda-htn/build/protocol.json';
import { NexoSession, actorFor, completion, hostEvent, launch, prepareBundle, type LogEntry, type ProtocolBundle, type ScenarioObject } from './session.ts';

const prepared = prepareBundle(bundleJson as unknown as ProtocolBundle);
const P = 'patient-uuid-1';
const clinician = actorFor(prepared.trust, 'assessing_clinician');
const pharmacy = actorFor(prepared.trust, 'pharmacy_worker');
const coordinator = actorFor(prepared.trust, 'care_coordinator');
const bp = (s: number, d: number) => ({ systolic: { value: s, unit: 'mm[Hg]' }, diastolic: { value: d, unit: 'mm[Hg]' } });
const encounter = (id: string): ScenarioObject => ({ type: 'encounter', id, revision: '1', fields: { patient: { type: 'patient', id: P },
  hypertension_symptoms: 'no', organ_damage_evidence: 'no', care_level: 'health_center', pregnant: 'no', diabetes: 'no', coronary_artery_disease: 'no', chronic_kidney_disease: 'no' } });
const reading = (id: string, enc: string, at: string, s: number, d: number): ScenarioObject => ({ type: 'observation', id, revision: '1',
  fields: { patient: { type: 'patient', id: P }, encounter: { type: 'encounter', id: enc }, setting: 'office', time: at, ...bp(s, d) } });
const declares = (template: string) => (name: string) => !!(prepared.protocol.document.definitions?.work_templates?.[template]?.result as any)?.[name];

function find(s: NexoSession, template: string) {
  const w = s.view().open.find(w => w.template === template);
  if (!w) throw new Error(`${template} not open: ${s.view().open.map(w => w.template).join(', ')} failures=${JSON.stringify(s.view().failures).slice(0, 600)}`);
  return w;
}

describe('a patient log replays through the pinned Core', () => {
  test('140/90 twice reaches diagnosis, assessment, prescription, dispensing, receipt and the next review', () => {
    const log: LogEntry[] = [];
    let seq = 0;
    const push = (e: Omit<LogEntry, 'seq' | 'recorded_at'>) => { log.push({ ...e, seq: seq++, recorded_at: e.event.occurred_at } as LogEntry); };
    const t1 = '2026-11-03T09:00:00+02:00';
    push(launch(prepared, 'htn_screening_assessment', { patient: P, actor: clinician.actor, at: t1, id: 'start-1', execution: 'X-SCREEN',
      objects: [encounter('V1'), reading('R1', 'V1', t1, 140, 90)],
      bindings: { patient: { type: 'patient', id: P }, reading: { type: 'observation', id: 'R1' }, owner: clinician.owner } }));
    let s = new NexoSession(prepared, { id: P, birth_date: '1978-05-10', sex: 'male' }, log);
    expect(find(s, 'repeat_office_visit')).toBeTruthy();

    const t2 = '2026-11-17T09:00:00+02:00';
    push({ kind: 'event', event: hostEvent('measurement.recorded', { patient: P, actor: clinician.actor, at: t2, id: 'reading-2',
      objects: [encounter('V2'), reading('R2', 'V2', t2, 140, 90)], payload: { reading: { type: 'observation', id: 'R2' } } }) });
    s = new NexoSession(prepared, { id: P, birth_date: '1978-05-10', sex: 'male' }, log);
    const diagnose = find(s, 'diagnosis_review');

    const t3 = '2026-11-17T09:10:00+02:00';
    push({ kind: 'event', event: completion(diagnose, { patient: P, actor: clinician.actor, at: t3, id: 'diagnose', result: { diagnosis: 'hypertension' } }, declares('diagnosis_review')) });
    s = new NexoSession(prepared, { id: P, birth_date: '1978-05-10', sex: 'male' }, log);
    const review = find(s, 'htn_clinical_review');
    expect(review.content?.mode).toBe('initial');

    const t4 = '2026-11-17T09:15:00+02:00';
    const assessment: ScenarioObject = { type: 'htn_assessment', id: 'A1', revision: '1', fields: { patient: { type: 'patient', id: P }, reading: { type: 'observation', id: 'R2' }, time: t4,
      confirmed_htn: 'yes', pregnant: 'no', symptoms: 'no', organ_damage: 'no', new_concern: 'no', diabetes: 'no', cad: 'no', ckd: 'no', renal_reviewed: 'yes',
      contraindications_reviewed: 'yes', medication_reviewed: 'yes', adherence_reviewed: 'yes', adverse_effects: 'no', target_tolerated: 'yes', specialist_required: 'no', current_regimen: { type: 'htn_no_regimen_attestation', id: 'N1' } } };
    const noRegimen: ScenarioObject = { type: 'htn_no_regimen_attestation', id: 'N1', revision: '1', fields: { patient: { type: 'patient', id: P }, attested_by: clinician.actor as any, time: t4 } };
    push({ kind: 'event', event: completion(review, { patient: P, actor: clinician.actor, at: t4, id: 'assess', objects: [noRegimen, assessment], result: { assessment: { type: 'htn_assessment', id: 'A1' } } }, declares('htn_clinical_review')) });
    s = new NexoSession(prepared, { id: P, birth_date: '1978-05-10', sex: 'male' }, log);
    const choice = find(s, 'htn_first_prescription_review');

    const t5 = '2026-11-17T09:20:00+02:00';
    push({ kind: 'event', event: completion(choice, { patient: P, actor: clinician.actor, at: t5, id: 'prescribe', result: { action: 'start', medicine: 'amlodipine',
      dose: { value: 5, unit: 'mg' }, second_medicine: 'none', reason: 'Synthetic clinician choice.', valid_until: '2026-12-18T23:59:00+02:00' } }, declares('htn_first_prescription_review')) });
    s = new NexoSession(prepared, { id: P, birth_date: '1978-05-10', sex: 'male' }, log);
    const rx = find(s, 'prescription'), dispense = find(s, 'htn_dispense');
    expect(find(s, 'htn_next_review').due?.at).toBe('2026-12-15T09:20:00+02:00');

    const t6 = '2026-11-17T09:30:00+02:00';
    const supply: ScenarioObject = { type: 'htn_supply', id: 'S1', revision: '1', fields: { patient: { type: 'patient', id: P }, prescription: { ...rx.ref } as any, medicine: 'amlodipine',
      dose: { value: 5, unit: 'mg' }, second_medicine: 'none', stock_available: 'yes', packed: 'yes', time: t6, coverage_until: '2026-12-17T09:20:00+02:00' } };
    push({ kind: 'event', event: completion(dispense, { patient: P, actor: pharmacy.actor, at: t6, id: 'dispense', objects: [supply], result: { supply: { type: 'htn_supply', id: 'S1' } } }, declares('htn_dispense')) });
    s = new NexoSession(prepared, { id: P, birth_date: '1978-05-10', sex: 'male' }, log);
    const receiptWork = find(s, 'htn_receipt');

    const t7 = '2026-11-17T09:40:00+02:00';
    const receipt: ScenarioObject = { type: 'htn_receipt', id: 'RC1', revision: '1', fields: { patient: { type: 'patient', id: P }, prescription: { ...rx.ref } as any,
      dispensing: receiptWork.content!.dispensing, received: 'yes', time: t7, proof: 'Patient confirms receipt.' } };
    push({ kind: 'event', event: completion(receiptWork, { patient: P, actor: coordinator.actor, at: t7, id: 'receive', objects: [receipt], result: { receipt: { type: 'htn_receipt', id: 'RC1' } } }, declares('htn_receipt')) });
    s = new NexoSession(prepared, { id: P, birth_date: '1978-05-10', sex: 'male' }, log);
    const v = s.view();
    expect(v.workflows.find(w => w.workflow === 'htn_longitudinal_care')?.ended).toBe('prescription_received');
    expect(v.open.map(w => w.template)).toContain('htn_next_review');
    expect(v.open.map(w => w.template)).not.toContain('htn_dispense');
  });
});
