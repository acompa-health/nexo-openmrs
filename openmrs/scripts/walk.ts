#!/usr/bin/env bun
/**
 * Walk a synthetic patient through the hypertension path on a real O3 server, through the generated forms only.
 * Each step saves an ordinary OpenMRS encounter (form, encounter type, obs keyed by the generated question), reads
 * it back, lets the host build the Nexo event, and appends it to the patient's log in the nexo backend module.
 *
 * Usage: bun scripts/walk.ts [--name "Nexo Demo Two"] [--until htn_first_prescription_review] [--base http://localhost:8090/openmrs]
 * It stops before the step named by --until, so a person can do that step in the UI.
 * Credentials: OPENMRS_USER and OPENMRS_PASSWORD (required). On the local O3 server, use its demo administrator login.
 */
import { parseArgs } from 'node:util';
import { bindToServer, NexoHost, prepareBundle, type Binding, type FormBinding, type LogEntry, type NewEntry, type O3Encounter, type ProtocolBundle, type StartOption, type WorkSnapshot } from '../packages/nexo-forms/src/browser.ts';
import { openmrsRest } from './rest.ts';

const { values: args } = parseArgs({ options: { name: { type: 'string', default: 'Nexo Demo Walk' }, until: { type: 'string' }, base: { type: 'string', default: 'http://localhost:8090/openmrs' }, patient: { type: 'string' } } });
const rest = openmrsRest(args.base!);
async function call<T = any>(path: string, init: { method?: 'GET' | 'POST'; json?: unknown } = {}): Promise<T> {
  const r = await rest(init.method ?? 'GET', path, init.json);
  if (r.status >= 300) throw new Error(`${init.method ?? 'GET'} ${path} → ${r.status} ${JSON.stringify(r.body).slice(0, 500)}`);
  return r.body as T;
}

const protocols = await call<any[]>('/nexo/protocols');
const name = protocols[0].name;
const bundle = await call<ProtocolBundle>(`/nexo/protocols/${name}/bundle`);
const binding = await call<Binding>(`/nexo/protocols/${name}/binding`);
// The binding names CIEL concepts by mapping; the encounters carry this server's concepts.
const host = new NexoHost(prepareBundle(bundle), await bindToServer(binding, rest));

// A synthetic patient with a generated OpenMRS ID.
const location = (await call('/location?tag=Login%20Location&v=custom:(uuid,display)')).results[0];
let patientUuid = args.patient;
if (!patientUuid) {
  const idType = (await call('/patientidentifiertype?v=custom:(uuid,name)')).results.find((t: any) => t.name === 'OpenMRS ID');
  const source = (await call('/idgen/identifiersource?v=custom:(uuid,name,identifierType:(uuid))')).results.find((s: any) => s.identifierType?.uuid === idType.uuid);
  const { identifier } = await call(`/idgen/identifiersource/${source.uuid}/identifier`, { method: 'POST', json: {} });
  const [given, ...family] = args.name!.split(' ');
  const patient = await call('/patient', { method: 'POST', json: {
    person: { names: [{ givenName: given, familyName: family.join(' ') || 'Demo' }], gender: 'M', birthdate: '1978-05-10' },
    identifiers: [{ identifier, identifierType: idType.uuid, location: location.uuid, preferred: true }],
  } });
  patientUuid = patient.uuid;
  console.log(`patient ${args.name} ${identifier} ${patientUuid}`);
}
const facts = { id: patientUuid!, birth_date: '1978-05-10', sex: 'male' as const };
const visitType = (await call('/visittype?v=custom:(uuid,display)')).results[0];
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '.000+0000');
/** The visit for a time: a closed past visit for an earlier day, or today's open visit. */
async function visitAt(ms: number) {
  if (Date.now() - ms > 86400_000) return call('/visit', { method: 'POST', json: { patient: patientUuid, visitType: visitType.uuid, location: location.uuid, startDatetime: iso(ms - 10 * 60_000), stopDatetime: iso(ms + 60 * 60_000) } });
  const active = (await call(`/visit?patient=${patientUuid}&includeInactive=false&v=custom:(uuid)`)).results[0];
  return active ?? call('/visit', { method: 'POST', json: { patient: patientUuid, visitType: visitType.uuid, location: location.uuid, startDatetime: iso(Date.now() - 2 * 3600_000) } });
}

const log = async () => (await call<{ entries: LogEntry[] }>(`/nexo/patients/${patientUuid}/log`)).entries;
const session = async () => host.session(facts, await log());

// The first reading is two weeks ago; every later step is five minutes after the one before, ending now.
let clock = Date.now() - 14 * 86400_000;
async function save(form: FormBinding, answers: Record<string, string | number>): Promise<O3Encounter> {
  const obs = Object.entries(answers).map(([id, v]) => {
    const q = form.questions.find(q => q.id === id);
    if (!q) throw new Error(`${form.name} has no question ${id}`);
    const value = typeof v === 'string' && q.answers?.[v] ? q.answers[v] : v;
    return { concept: q.concept, value, formFieldNamespace: 'rfe-forms', formFieldPath: `rfe-forms-${id}` };
  });
  const at = iso(clock);
  const visit = await visitAt(clock);
  clock = clock < Date.now() - 86400_000 ? Date.now() - 60 * 60_000 : clock + 5 * 60_000;
  const created = await call('/encounter', { method: 'POST', json: { patient: patientUuid, encounterType: form.encounterType.uuid, form: form.uuid, visit: visit.uuid, location: location.uuid, encounterDatetime: at, obs } });
  return call(`/encounter/${created.uuid}?v=custom:(uuid,encounterDatetime,obs:(uuid,concept:(uuid),value,formFieldPath,groupMembers))`);
}
async function append(entry: NewEntry) {
  const entries = await log();
  const checked = host.check(host.session(facts, entries), entry);
  if (!checked.ok) throw new Error(`Core refused ${entry.event.type}: ${checked.reasons.join('; ')}`);
  await call(`/nexo/patients/${patientUuid}/log`, { method: 'POST', json: { expectedSeq: entries.length, entries: [entry] } });
}
async function task(template: string) {
  const t = host.tasks(await session()).find(t => t.work.template === template);
  if (!t) throw new Error(`${template} is not open: ${host.tasks(await session()).map(t => t.work.template).join(', ')}`);
  return t;
}
async function step(template: string, answers: Record<string, string | number>, how: (t: Awaited<ReturnType<typeof task>>) => { form: FormBinding; task?: WorkSnapshot; start?: StartOption }) {
  if (args.until === template) { console.log(`stop before ${template}`); process.exit(0); }
  const t = template === 'start' ? undefined : await task(template);
  const { form, ...ctx } = how(t as any);
  const encounter = await save(form, answers);
  await append(host.entryFor(await session(), form, encounter, ctx));
  console.log(`saved ${form.name} → encounter ${encounter.uuid}; open: ${host.tasks(await session()).map(t => t.work.template).join(', ')}`);
}

const VISIT = { reading__encounter__hypertension_symptoms: 'no', reading__encounter__organ_damage_evidence: 'no', reading__encounter__pregnant: 'no',
  reading__encounter__diabetes: 'no', reading__encounter__coronary_artery_disease: 'no', reading__encounter__chronic_kidney_disease: 'no', reading__encounter__care_level: 'health_center' };
const form = (name: string) => host.forms.get(name)!;

if ((await log()).length === 0) {
  const start = host.starts(await session()).find(s => s.workflow === 'htn_screening_assessment')!;
  await step('start', { reading__systolic: 140, reading__diastolic: 90, reading__setting: 'office', ...VISIT, extra__weight: 81, extra__height: 172 }, () => ({ form: start.form, start }));
}
await step('repeat_office_visit', { reading__systolic: 142, reading__diastolic: 91, reading__setting: 'office', ...VISIT }, () => ({ form: form('event_measurement_recorded') }));
await step('diagnosis_review', { diagnosis: 'hypertension' }, t => ({ form: form('diagnosis_review'), task: t.work }));
await step('htn_clinical_review', { assessment__confirmed_htn: 'yes', assessment__pregnant: 'no', assessment__symptoms: 'no', assessment__organ_damage: 'no', assessment__new_concern: 'no',
  assessment__diabetes: 'no', assessment__cad: 'no', assessment__ckd: 'no', assessment__renal_reviewed: 'yes', assessment__contraindications_reviewed: 'yes', assessment__medication_reviewed: 'yes',
  assessment__adherence_reviewed: 'yes', assessment__adverse_effects: 'no', assessment__target_tolerated: 'yes', assessment__specialist_required: 'no', assessment__current_regimen: 'htn_no_regimen_attestation' }, t => ({ form: form('htn_clinical_review'), task: t.work }));
const until = (days: number) => iso(Date.now() + days * 86400_000);
await step('htn_first_prescription_review', { action: 'start', medicine: 'amlodipine', dose: 5, second_medicine: 'none', valid_until: until(45), reason: 'Synthetic clinician choice of the national preferred example.' },
  t => ({ form: form('htn_first_prescription_review'), task: t.work }));
await step('htn_dispense', { supply__stock_available: 'yes', supply__packed: 'yes', supply__medicine: 'amlodipine', supply__dose: 5, supply__second_medicine: 'none', supply__coverage_until: until(38) },
  t => ({ form: form('htn_dispense'), task: t.work }));
await step('htn_receipt', { receipt__received: 'yes', receipt__proof: 'Patient confirms receiving amlodipine.' }, t => ({ form: form('htn_receipt'), task: t.work }));
const s = await session();
console.log(`done: ${s.view().workflows.map(w => `${w.workflow}=${w.ended ?? w.state}`).join(', ')}`);
