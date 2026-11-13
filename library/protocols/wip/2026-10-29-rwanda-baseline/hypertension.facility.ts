/**
 * Draft facility SOPs for the Rwanda hypertension module of NCD care.
 * This browser-safe authoring fixture only assembles an ordinary Nexo document.
 * Core still owns preparation, validation, authority, state, work and execution.
 * Source fidelity and clinical approval are pending independent review.
 */
import type { ContractCatalog, PreparedProtocol, ProtocolDocument } from '../../../../core/protocol/types.ts';

export const HYPERTENSION_SOURCE_PIN = {
 protocol: 'rwanda.htn_screening_assessment_2024', revision: '1.0', identity: "sha256:f57a08d143082517519b1b48fb8bcdb3fe8ddfef676c499f885ebef6d2b50448",
};
const v = (input: string) => ({ input });
const b = (binding: string) => ({ binding });
const ref = (target: string) => ({ type: 'reference', target });
const listed = (...values: string[]) => ({ type: 'listed', values });
const quantity = (unit: string) => ({ type: 'quantity', unit });
const yn = { type: 'yes_no' }, text = { type: 'text' }, id = { type: 'identifier' };
const field = (type: any, optional = false) => ({ type, ...(optional ? { optional: true } : {}) });
const input = (type: any, binding: any, required = 'decision') => ({ type, binding, required });
const policy = { id: 'clinical_work_policy', revision: 'source-r1' };
const due = (value: number, unit = 'd') => ({ from: { event: 'trigger' }, after: { value, unit }, basis: 'calendar', zone: 'Africa/Kigali' });
const task = (effect: string, template: string, handle: string, content: any = {}, timing?: any) => ({
 id: effect, kind: 'task', task: template, for: b('patient'), as: { handle, replace: true }, occurrence: v('event.id'),
 owner: b('owner'), lifetime: 'independent', policy, content, ...(timing ? { due: timing } : {}),
});
const record = (effect: string, name: string, fields: any) => ({ id: effect, kind: 'record', record: name, fields });
// These facility tasks are timed. Core reissue does not carry due: correction keeps
// the prior occurrence's instant, never a new interval from the correction event.
const reask = (template: string, handle: string) => ({ id: 'ask_again', kind: 'task', task: template, reissue: { handle }, occurrence: v('event.id'), due: { from: v(`${handle}.due.at`), after: { value: 0, unit: 's' }, basis: 'duration' } });
const row = (id: string, states: string[], when: string, effects: any[], to: any, sop: string, rank?: number) => ({
 id, in: states, when, effects, to, evidence: ['htn_facility_operating_choice'], sops: [sop], ...(rank === undefined ? {} : { rank }),
});
const handover = (destination: string, reason: string | { input: string }, context: Record<string, any> = {}) => ({
 id: 'owned_handover', kind: 'start', mode: 'new', definition: { workflow: 'htn_owned_handover' }, for: b('patient'),
 bindings: { patient: b('patient'), reading: b('reading'), owner: b('owner'), destination, reason, ...context },
 owner: b('owner'), lifetime: 'independent', purpose: 'Named receiving service, acknowledged handover, and owned recovery if acceptance fails',
});

/** The facility uses one regimen field. Keep the literal reference's older host contract separate. */
export function buildHypertensionFacilityCatalog(base: Pick<PreparedProtocol, 'catalog'>): ContractCatalog {
 const catalog: any = structuredClone(base.catalog);
 const fields = catalog.objects.htn_assessment.fields;
 delete fields.no_current_regimen;
 delete fields.current_prescription;
 // Admit missing clinical information at ingress; the decision requires it and owns correction.
 fields.current_regimen = field(ref('object'), true);
 catalog.objects.htn_no_regimen_attestation = { fields: {
  patient: field(ref('object:patient')), attested_by: field(ref('actor')), time: field({ type: 'instant' }),
 } };
 return catalog;
}

export function buildHypertensionFacility(base: PreparedProtocol): ProtocolDocument {
 const pin = HYPERTENSION_SOURCE_PIN;
 if (base.content.protocol !== pin.protocol || base.content.revision !== pin.revision || base.content.identity !== pin.identity)
  throw new Error('Hypertension facility baseline does not match its pinned source; review the changed reference before deriving the facility draft.');
 const doc: any = structuredClone(base.document);
 doc.revision = '1.0';
 doc.status = 'draft';
 // Keep source-to-build provenance. These default SOPs are not site variants.
 doc.overrides = [];
 doc.roles.pharmacy_worker = { title: 'Facility pharmacy worker' };
 doc.roles.receiving_clinician = { title: 'Receiving service clinician' };
 const evidence = doc.evidence;
 evidence.htn_facility_operating_choice = {
  kind: 'interpretation', locator: 'studio/decisions/aspect-htn-facility-assessment.json',
  note: 'Facility operations are decided by an agent, sign-off pending. Each SOP links its governing register entries. These are not observed Rwanda practice.',
 };
 evidence.whohtn21_reassessment = {
  kind: 'source', hash: '57f6376d5c9bc4ea6c44873625547c8a5443d5a6ad8c8c422733681563db05fb',
  locator: 'WHOHTN21, Guideline for the pharmacological treatment of hypertension in adults, PDF p.29 / printed p.17, recommendation 7; PDF p.30 / printed p.18, implementation considerations',
  note: 'Monthly follow-up after starting or changing antihypertensive treatment until target; every 3–6 months when controlled. Both recommendations are conditional with low-certainty evidence. This remains source context. Facility timing follows conflict-htn-review-after-change and conflict-htn-stable-interval under policy-national-baseline.',
 };
 evidence.whohtn21_combination = {
  kind: 'source', hash: '57f6376d5c9bc4ea6c44873625547c8a5443d5a6ad8c8c422733681563db05fb',
  locator: 'WHOHTN21, PDF pp.25–26 / printed pp.13–14, recommendation 5',
  note: 'WHO suggests combination therapy, preferably a single-pill combination, with classes from thiazide/thiazide-like diuretics, ACE inhibitors/ARBs and long-acting dihydropyridine CCBs. This supports the class pairing only. The actual doses here come from Rwanda Figure 9; no foreign dose ladder is imported.',
 };
 evidence.whohtn21_testing = {
  kind: 'source', hash: '57f6376d5c9bc4ea6c44873625547c8a5443d5a6ad8c8c422733681563db05fb',
  locator: 'WHOHTN21, PDF p.20 / printed p.8, recommendation 2 and implementation remarks',
  note: 'WHO conditionally recommends tests for comorbidity and secondary hypertension without delaying treatment, with low-certainty evidence. Its remarks favor long-acting dihydropyridine CCBs over diuretics or ACE inhibitors/ARBs when tests are unavailable. This does not turn a pending test order into a result.',
 };
 for(const decision of ['policy-national-baseline','conflict-htn-single-visit-diagnosis','conflict-htn-review-after-change','conflict-htn-stable-interval','conflict-htn-stage1-lifestyle-first','conflict-htn-target','aspect-htn-ladder-steps','conflict-htn-emergency-definition','aspect-htn-chw-refill']) evidence[decision]={kind:'interpretation',locator:`studio/decisions/${decision}.json`,note:'Governing choice: decided by an agent, sign-off pending. The literal 2024 reference remains separately inspectable.'};
 const sop = (title: string, basis: string, evidence: string[], note: string) => ({ title, basis, evidence, note: 'Decided by an agent, sign-off pending. '+note, status: 'agent_decided_signoff_pending' });
 doc.sops = {
  ...doc.sops,
  htn_screening_transition: sop('Schedule the first annual screening in the age-35 year', 'source_adapted', ['rbcncd24_p12_age35_note','interp_p12_maximum_intervals','gap_p12_annual_transition_anchor'], 'Cap a pre-35 maximum recall at the measurement anniversary in the first age-35 year: ages 31/32/33/34 use 4/3/2/1 calendar years. This is a proposed appointment anchor, not an inferred birthday or a national exact due date. Imprecise birth data that cannot establish the applicable interval require corrected information. An independent Core workflow keeps the recall executable and starts the next screening from an attributed current reading. A corrected recall keeps its original due instant and measurement anchor. The recall workflow commissions overdue contact once; correcting evidence does not create another contact workflow or complete screening.'),
  htn_screening_definition: sop('Use the national diagnostic threshold at the screening boundary', 'source_adapted', ['rbcncd24_p24_definition', 'rbcncd24_p12_hypertension', 'rbcncd24_p24_two_visits','policy-national-baseline','conflict-htn-single-visit-diagnosis'], 'Use the explicit >=140 systolic OR >=90 diastolic definition across both raised-entry rows. At that boundary, known hypertension symptoms or organ damage reach owned urgent assessment with known, unknown or absent pregnancy. Without danger, known pregnancy retains maternal assessment and unresolved pregnancy cannot enter routine confirmation. Both positive components, office setting and same-patient reading/encounter remain required. This diagnostic boundary does not authorize treatment. The separate emergency choice requests assessment for known concerning signs at any pressure. Split lower categories use the higher component. Keep the source-reference boundary visible. At systolic 160 or diastolic 100 or above, the current register requires clinician diagnosis and treatment assessment now. Lower uncomplicated raised readings retain two-visit confirmation. Diagnosis still requires the clinician.'),
  htn_assessment: sop('Keep one accountable clinician for assessment and prescribing', 'source_adapted', ['interp_p25_followup_review', 'whohtn21_testing', 'htn_facility_operating_choice'], 'Collect a correlated assessment after both the named reading and the current assessment request, and no later than its reporting instant. The next visit needs a different reading and encounter, observed after the previous prescription decision on the date of that visit event, and no later than reporting. These are proposed work/evidence correlation rules, not a maximum clinical age for laboratory evidence. Missing answers and wrong-patient evidence, including the patient attached to each encounter, require corrected evidence. Every assessment and prescription reissue, including invalid, missing and wrong-role answers, keeps the original due instant with a zero-duration offset. Nonpositive BP components are invalid at both screening visits and clinical assessment. An information task captures each candidate second reading before its object is available; an internal ready event evaluates that same candidate after collection. Preserve the original measurement event ID, occurrence, assertion time and transport time in that task and ready event. Known patient-correlated urgent second-visit findings start urgent assessment before diagnostic chronology is checked. Retain duplicate prevention on the candidate collection task, keyed by reading and original evidence occurrence. Correction replies for that same finding keep its request; another finding commissions its own current urgent duty. Diagnostic confirmation cannot close until that candidate has an urgent request. Missing assertion metadata stays unknown with owned correction work. A typed payload.asserted_at must equal the original event time. Native elapsed durations require first observation <= second observation <= original assertion <= transport. Partial replies and corrected references cannot move that clock; a missing or mismatched typed instant requires correction against the retained original time. No minimum visit interval or maximum evidence age is added. Missing or invalid evidence retains owned collection work; collection alone is not diagnosis. Initial and follow-up work share this workflow. The clinician may start amlodipine while the ordered panel remains outstanding, after the safety review; renal and contraindication review remain required, and an ACE inhibitor also requires the named potassium result. No order is treated as a test result.'),
  htn_comorbid_handover: sop('Use owned condition-specific care for diabetes and CKD', 'source_adapted', ['rbcncd24_p53_diabetes_htn','rbcncd24_p73_ckd_htn','gap_p53_p73_comorbid_regimen'], 'The general medicine list cannot replace the national diabetes or CKD algorithm. Until those constraints and exceptions are extracted and reviewed, a named NCD advanced-care clinician must accept the current assessment and next work. CKD target alternatives remain proposed and do not authorize a regimen here.'),
  htn_targets: sop('Use the current age-specific target choice', 'source_adapted', ['rbcncd24_p26_targets', 'gap_p26_target_65_ckd'], 'Proposed: age 65 uses 130–139 systolic for otherwise eligible care. The previously proposed CKD reading a with the hypertension floor retained remains a review alternative only; it is not applied to authorize a general regimen. All CKD and diabetes regimen decisions use an owned condition-specific handover. CKD alternatives remain linked in studio/decisions/correction-rbcncd24-fig8-ckd-target.json. The governing target is conflict-htn-target choice d. A clinician reviews tolerance; stage 4–5 and a stated specialist need have an owned handover.'),
  htn_hc_combination: sop('Use the Figure 9 class pairing and doses for a clinician-selected HC combination', 'source_adapted', ['rbcncd24_p27_dual_start', 'rbcncd24_p27_monotherapy', 'rbcncd24_p27_remarks', 'interp_p27_band_reading', 'whohtn21_combination'], 'Apply the national ACE inhibitor plus CCB/diuretic pairing at HC/MHC despite the missing n6-to-n10 arrow. Supported ACE inhibitors are enalapril and lisinopril. Do not combine ACE inhibitor and ARB. Initial amounts stay within the printed start amounts. The registered slash reading uses either component above the printed band; both components are above it in the unambiguous 170/100 witness. The initial >150 systolic or >95 diastolic band requires a supported combination or an owned individual-plan handover; ordinary monotherapy cannot bypass it. The task and decision record carry this national indication. The n11 trigger and exact 150/95 boundary retain an explicit clinician choice; no medicine is inferred automatically.'),
  htn_prescription_validity: sop('Require a fresh explicit prescription decision', 'local_choice', ['gap_p27_renewal_supply', 'htn_facility_operating_choice'], 'A clinician chooses start, renewal or change and records a reason and validity end. Renewal preserves both medicines and doses of an active same-patient prescription whose validity extends beyond the current Kigali date. A new decision never silently renews an expired prescription. Dispensing must cover the scheduled review and remain within validity.'),
  htn_regimen_change: sop('Distinguish medicine switching from titration', 'source_adapted', ['rbcncd24_p27_monotherapy', 'rbcncd24_p27_remarks', 'gap_p27_regimen_change','conflict-htn-target'], 'A new or restarted medicine stays within its printed starting amounts. A dose above that start amount, up to the printed maximum, needs the same medicine on an active, unexpired prescription of this patient. Every increase of a current medicine, including either medicine within a printed starting range, requires pressure above the age-specific target, systolic at least 120, diastolic at least 70 and confirmed tolerance. Below-floor pressure is not above target. A refusal retains owned clinician review and safe current treatment; it never creates a stop order. The clinician explicitly chooses and explains the change after assessment; no titration step or new medicine is inferred. This is a proposed operational reading, not a printed national switching algorithm. Check same-patient current-regimen evidence on every prescribing path, including initial/start. Every known current-medicine increase uses the same pressure, target and tolerance safeguards. One required current_regimen reference names either the active or stopped same-patient prescription or an htn_no_regimen_attestation object. The attestation names this patient, the clinician who completed the assessment and an instant no later than the assessment. It permits only supported first doses in initial/start mode without a prior prescription. An omitted field is not an empty regimen and keeps the assessment unresolved. The facility contract has neither no_current_regimen nor current_prescription. Typed review tasks capture the one reference, so an old inline flag cannot select another branch. Missing or inconsistent prior evidence otherwise keeps immediate owned review or an explicit individual-plan handover. Never infer a stop.'),
  htn_review_intervals: sop('Schedule the next clinical review and retain its owner', 'source_adapted', ['rbcncd24_p27_dual_start', 'whohtn21_reassessment','policy-national-baseline','conflict-htn-review-after-change','conflict-htn-stable-interval'], 'Start or change at systolic 160 or diastolic 100 or above: two calendar weeks. Other starts/changes and uncontrolled renewal: four calendar weeks. These follow the current central register, decided by an agent, sign-off pending. Controlled unchanged treatment: three calendar months under conflict-htn-stable-interval. The operational clock starts at the prescription decision, before supply, so failed supply cannot postpone review. This earlier anchor is a local adaptation, not proof that treatment began. An independent ordinary Core workflow owns the clinician-authorized next review. Another owns coordinator contact; both can receive completion after supply or the review finishes. A corrected next-visit request keeps the original due instant and prescription-decision anchor, including after the parent ends. The scheduled-review workflow commissions overdue contact once; corrections before or after due cannot renew the deadline or create another contact workflow. Contact completion does not complete the clinical review.'),
  htn_supply_receipt: sop('Separate the prescription, dispensing and patient receipt', 'local_choice', ['gap_p27_renewal_supply', 'htn_facility_operating_choice'], 'Pharmacy checks the exact prescription, both medicines and doses, stock, packing and coverage. A two-week prescription needs at least 14 calendar days of coverage through its review, within prescription validity. Insufficient coverage creates immediate owned recovery without moving the review deadline. A separate patient receipt cites the dispensing task and prescription. The actual dispensing instant must follow the current prescription decision and not exceed its reporting instant; receipt must follow that dispensing instant and not exceed its own reporting instant. Event time stays distinct from report time, so delayed reporting is allowed. No stock or failed receipt creates owned recovery; no substitution, renewed prescription or new stop order is inferred. A host-reported failed attempt is cancelled through Core before a replacement can be commissioned. The prescription and coordinator recovery stay open. A failure during an outstanding cancellation request cannot authorize replacement; Core must receive its correlated cancellation acknowledgment. Late reports for a cancelled occurrence remain audited as late and cannot complete supply. The facility correction helper also keeps the prior due instant for timed dispensing, receipt, collection, contact, supply-recovery and handover requests; it never assigns a new deadline from a correction event.'),
  htn_handover: sop('Close excluded care only after the named service accepts it', 'source_adapted', ['rbcncd24_p28_urgency_emergency', 'gap_p27_longitudinal_excluded', 'htn_facility_operating_choice'], 'Name NCD advanced care, urgent assessment, maternal care or child/adolescent care as appropriate. Exclude pregnancy before routine confirmation. Check current symptoms, organ damage and very-high BP at the second reading before diagnosis work. Carry that current reading, the relevant first/second pair and any diagnostic outcome through the handover and its retries. The coordinator must arrange the handover; the receiving clinician records patient, service and accepted responsibility, with a resolved external next-work object owned by that same clinician and naming the work kind and due instant. That object is external evidence, not a shadow task lifecycle. Requiring the due instant is a proposed handover SOP, not a national time limit. For urgent assessment, accepted next work must be clinical assessment due no later than this acceptance and no earlier than the current urgent request. Acceptance must occur no later than transport receipt. Future or unresolved acceptance keeps immediate owned correction or recovery. Valid delayed reports remain eligible. Later appointments and unrelated work retain immediate owned recovery. This is an operating care duty, not a national transfer-time limit. A refusal stays open. Supply and handover recovery decisions require the coordinator role. A supply handover never fulfils the prescription: its parent remains open for evidence of dispensing and receipt. The local immediate due means start coordination now; it does not claim a national referral deadline or completed transfer. At first office entry with >=140 systolic OR >=90 diastolic and two positive components, known symptoms or organ damage reach owned urgent assessment with known, unknown or absent pregnancy; the no-danger known-pregnancy route remains maternal and unresolved pregnancy cannot enter routine confirmation. The current emergency decision governs receiving-service assessment and treatment, including urgent transfer for concerning symptoms at any pressure. Its hospital regimens remain receiving-service work. The source exact-boundary ambiguity remains visible. Urgent signs at any pressure follow the emergency choice. Assessment does not authorize pregnancy-dependent treatment. Core cancels a host-reported failed handover occurrence before an owned replacement request. A cancelled predecessor cannot remain an outstanding failed duty or count as a later acceptance.'),
 };
 const facilityDecisions={"htn_screening_transition":"aspect-htn-facility-screening-anchor","htn_assessment":"aspect-htn-facility-assessment","htn_hc_combination":"aspect-htn-facility-combination","htn_review_intervals":"aspect-htn-facility-review-clock","htn_prescription_validity":"aspect-htn-facility-prescription-validity","htn_regimen_change":"aspect-htn-facility-regimen-change","htn_supply_receipt":"aspect-htn-facility-supply-receipt","htn_handover":"aspect-htn-facility-handover","htn_comorbid_handover":"aspect-htn-facility-comorbid-care","htn_screening_definition":"conflict-rbcncd24-hypertension-threshold","htn_targets":"conflict-htn-target"};
 for(const [sopId,decision] of Object.entries(facilityDecisions)){const evidenceId='decision_'+sopId;evidence[evidenceId]={kind:'interpretation',locator:`studio/decisions/${decision}.json`,note:'Decided by an agent, sign-off pending.'};doc.sops[sopId].evidence.push(evidenceId);}
 for(const [sopId,decisions] of [['htn_targets',['conflict-rbcncd24-target-at-65','correction-rbcncd24-fig8-ckd-target']],['htn_hc_combination',['conflict-rbcncd24-dual-therapy-trigger','correction-rbcncd24-fig9-comorbidity-clause']]] as const)for(const decision of decisions){evidence[decision]={kind:'interpretation',locator:`studio/decisions/${decision}.json`,note:'See the recorded choice and pending sign-off. CKD alternatives are not general-regimen permission.'};doc.sops[sopId].evidence.push(decision);}
 const replace = (workflow: string, table: string, id: string, change: (original: any) => any, sopId: string) => {
  const wi = doc.workflows.findIndex((w: any) => w.id === workflow), w = doc.workflows[wi];
  const ti = w.tables.findIndex((t: any) => t.id === table), t = w.tables[ti];
  const ri = t.rules.findIndex((r: any) => r.id === id), original = structuredClone(t.rules[ri]);
  if (ri < 0) throw new Error(`Missing pinned source rule ${workflow}/${table}/${id}`);
  const replacement = { ...change(structuredClone(original)), sops: [...new Set([...(original.sops ?? []), sopId])] };
  t.rules[ri] = replacement;
  const element = `/workflows/${wi}/tables/${ti}/rules/${ri}`;
  const prior = doc.overrides.find((o: any) => o.element === element);
  if (prior) { prior.replacement = structuredClone(replacement); return; }
  doc.overrides.push({ kind: 'sop', sop: sopId, base: `${pin.protocol}@${pin.revision}`, element: `/workflows/${wi}/tables/${ti}/rules/${ri}`,
   original, replacement: structuredClone(replacement), site: 'site-fixture', author: 'agent-draft-2026-11-03', status: 'proposed_for_clinical_review', rationale: doc.sops[sopId].note });
 };
 const wf = (id: string) => doc.workflows.find((w: any) => w.id === id);
 const table = (w: string, id: string) => wf(w).tables.find((t: any) => t.id === id);
 const sourceRule = (w: string, t: string, id: string) => table(w, t).rules.find((r: any) => r.id === id);
 const D = doc.definitions;
 const correctData = (fields:string[]) => task('correct_patient_data','collect_information','information_request',{missing_inputs:fields},due(0));
 const sharedReview = D.tables.clinical_unhandled.rules.find((r: any) => r.id === 'request_clinical_review');
 const sharedOriginal = structuredClone(sharedReview);
 sharedReview.effects = [sharedReview.effects[0], handover('ncd_diagnostic_service', 'An office-screening or diagnostic finding needs an individualized NCD assessment and a recorded next action')];
 sharedReview.to = { end: 'diagnostic_handover_requested' };
 sharedReview.sops = ['htn_handover'];
 doc.overrides.push({ kind: 'sop', sop: 'htn_handover', base: `${pin.protocol}@${pin.revision}`, element: '/definitions/tables/clinical_unhandled/rules/1', original: sharedOriginal, replacement: structuredClone(sharedReview), site: 'site-fixture', author: 'agent-draft-2026-11-03', status: 'proposed_for_clinical_review', rationale: doc.sops.htn_handover.note });
 D.records.htn_handover_acceptance = { fields: { subject: field(ref('object:patient')), destination: field(id), next_work: field(ref('object:htn_external_work')), next_owner:field(ref('actor')), next_kind:field(listed('clinical_assessment','medicine_supply','diagnostic_assessment','maternal_assessment','child_assessment')), next_due:field({type:'instant'}), accepted_by: field(ref('actor')) } };
 D.records.htn_dispensing_evidence = { fields: { subject: field(ref('object:patient')), time: field({ type: 'instant' }), supply: field(ref('object:htn_supply')), dispensing: field(ref('work')) } };
 D.records.htn_patient_receipt = { fields: { subject: field(ref('object:patient')), prescription: field(ref('work')), dispensing: field(ref('work')), time: field({ type: 'instant' }), proof: field(text) } };
 D.records.htn_overdue_contact_request = { fields: { subject: field(ref('object:patient')), review: field(ref('work')), contact_execution: field(ref('execution')) } };
 D.records.htn_operational_event = { fields: { stage: field(id), subject: field(ref('object:patient')), work: field(ref('work'), true), evidence: field(text, true) } };
 const spec = (title: string, performer: string, content: any, result: any, proof: string) => ({
  title, performer: { role: performer }, content, result: Object.fromEntries(Object.entries(result).map(([key, type]) => [key, { type, role: 'information' }])), completion: { evidence: proof },
 });
 const rxRef = field(ref('work'));
 D.work_templates.htn_dispense = spec('Dispense the authorized hypertension prescription', 'pharmacy_worker', { prescription: rxRef }, { supply: ref('object:htn_supply') }, 'Attributed pharmacy report tied to this patient, prescription ID and occurrence, both medicine names and doses, stock, packing, and coverage end. Stock availability alone is not dispensing.');
 D.work_templates.htn_receipt = spec('Confirm that the patient received the medicines', 'care_coordinator', { prescription: rxRef, dispensing: rxRef, dispensed_at: field({ type: 'instant' }) }, { receipt: ref('object:htn_receipt') }, 'Patient-linked receipt for the exact prescription and dispensing task, with date and receipt proof. Pharmacy packing alone is not patient receipt or medicine use.');
 D.work_templates.htn_supply_recovery = spec('Resolve failed medicine supply', 'care_coordinator', { prescription: rxRef, reason: field(text) }, { disposition: listed('retry_pharmacy', 'receiving_service'), note: text }, 'Coordinator records the stock or receipt failure and either arranges another pharmacy attempt or requests an acknowledged NCD service handover. No medicine is silently substituted.');
 D.work_templates.htn_next_review = spec('Attend the next NCD hypertension review', 'assessing_clinician', { prescription: rxRef }, { reading: ref('object:observation') }, 'Attributed new office reading for this patient at the follow-up encounter. Completing the visit opens a fresh clinical assessment; it does not prove control or renew medicine.');
 D.work_templates.htn_contact_overdue = spec('Contact the patient and NCD service about overdue review', 'care_coordinator', { review: rxRef }, { contacted: yn, note: text }, 'Document contact and the next arrangement. Contact does not satisfy the still-open clinical review.');
 const diagnosticContext={first_reading:field(ref('object:observation'),true),second_reading:field(ref('object:observation'),true),diagnostic_outcome:field(listed('confirmation_pending','not_confirmed_at_second_visit','not_hypertension'),true)};
 const handoverContent = { ...diagnosticContext, destination: field(id), reason: field(text), reading: field(ref('object:observation')), assessment: field(ref('object:htn_assessment'), true), prescription: field(ref('work'), true) };
 D.work_templates.htn_handover = spec('Arrange and acknowledge the receiving service handover', 'receiving_clinician', handoverContent, { patient: ref('object:patient'), destination: id, accepted: yn, next_work: ref('object:htn_external_work') }, 'The receiving clinician identifies this patient and named service, accepts responsibility and supplies a resolved external next-work record with matching patient/service, that clinician as its owner, work kind, accepted status and due instant. This is attributed external evidence; it does not execute or complete the receiving service work. Sending a referral or completing a checklist does not prove acceptance.');
 D.work_templates.htn_handover_recovery = spec('Resolve the unaccepted handover', 'care_coordinator', handoverContent, { retry: yn, note: text }, 'The coordinator contacts the named receiving service and records the next arrangement. A failed handover remains open until a clinician accepts it.');

 // Preserve the screening rules except the explicitly proposed threshold/category readings.
 const sw = 'htn_screening_assessment', st = 'categorize_screening';
 wf(sw).calculations.annual_transition_years={cases:[
  {when:'age == 31 a',value:{value:{value:4,unit:'a'}}},{when:'age == 32 a',value:{value:{value:3,unit:'a'}}},
  {when:'age == 33 a',value:{value:{value:2,unit:'a'}}},{when:'age == 34 a',value:{value:{value:1,unit:'a'}}},
 ]};
 for(const [ruleId,baseId] of [['optimal_annual_transition_source_limit','repeat_in_five_years'],['normal_annual_transition_source_limit','repeat_in_three_years']]) replace(sw,st,ruleId,r=>{
  const sourceRecall=structuredClone(sourceRule(sw,st,baseId).effects.find((e:any)=>e.id==='recall'));
  sourceRecall.due.after=v('annual_transition_years');sourceRecall.purpose='First annual screening appointment in the age-35 year; proposed measurement-anniversary anchor';
  return {...r,effects:[r.effects[0],sourceRecall],to:structuredClone(sourceRule(sw,st,baseId).to)};
 },'htn_screening_transition');
 for(const r of [...table(sw,st).rules]) if(r.effects.some((e:any)=>e.id==='recall')) replace(sw,st,r.id,original=>({...original,effects:original.effects.map((e:any)=>e.id==='recall'?{id:'recall_owner',kind:'start',mode:'new',definition:{workflow:'htn_screening_recall'},for:b('patient'),bindings:{patient:b('patient'),reading:b('reading'),owner:b('owner'),scheduled_at:v('reading.time'),interval:'input' in e.due.after?e.due.after:{value:e.due.after}},owner:b('owner'),lifetime:'independent',purpose:'Retain owned executable screening recall after the current screening ends'}:e)}),'htn_screening_transition');
 // The strict raised row and exact-boundary row share eligibility, including known danger.
 // Their disjoint BP guards cover >=140 OR >=90; only the source keeps the boundary gap.
 const raised = structuredClone(sourceRule(sw, st, 'raised_office_reading'));
 replace(sw, st, 'threshold_conflict_review', r => ({ ...r, effects: raised.effects, to: raised.to, evidence: ['rbcncd24_p24_definition', 'rbcncd24_p24_two_visits', 'gap_140_90_inequality'] }), 'htn_screening_definition');
 const screening = table(sw, st);
 screening.inputs.reading_patient = input(id, 'reading.patient.id');
 screening.inputs.encounter_patient = input(id, 'reading.encounter.patient.id');
 screening.inputs['subject.patient_id'] = input(id, 'patient.id');
 for (const r of [...screening.rules]) replace(sw, st, r.id, current => ({ ...current, when: `reading_patient == subject.patient_id and encounter_patient == subject.patient_id and bp.systolic > 0 mm[Hg] and bp.diastolic > 0 mm[Hg] and (${current.when})` }), 'htn_assessment');
 for (const id of ['repeat_in_three_years', 'normal_repeat_annually_age_35_plus','normal_annual_transition_source_limit']) replace(sw, st, id, r => ({ ...r, when: r.when.replace('bp.systolic >= 120 mm[Hg] and bp.systolic <= 129 mm[Hg] and bp.diastolic >= 80 mm[Hg] and bp.diastolic <= 84 mm[Hg]', '(bp.systolic >= 120 mm[Hg] or bp.diastolic >= 80 mm[Hg]) and bp.systolic < 130 mm[Hg] and bp.diastolic < 85 mm[Hg]') }), 'htn_screening_definition');
 replace(sw, st, 'repeat_annually_consider_masked', r => ({ ...r, when: r.when.replace('bp.systolic >= 130 mm[Hg] and bp.systolic <= 139 mm[Hg] and bp.diastolic >= 85 mm[Hg] and bp.diastolic <= 89 mm[Hg]', '(bp.systolic >= 130 mm[Hg] or bp.diastolic >= 85 mm[Hg]) and bp.systolic < 140 mm[Hg] and bp.diastolic < 90 mm[Hg]') }), 'htn_screening_definition');
 replace(sw, 'check_second_visit', 'second_threshold_conflict', r => ({ ...r, effects: structuredClone(sourceRule(sw, 'check_second_visit', 'raised_at_second_visit').effects), to: { state: 'diagnosis_decision' }, evidence: ['rbcncd24_p24_definition', 'rbcncd24_p24_two_visits', 'gap_140_90_inequality'] }), 'htn_screening_definition');
 replace(sw, 'route_first_visit', 'exception_needs_review', r => ({ ...r, effects: [r.effects[0], handover('urgent_assessment_service', 'National two-visit exception: clinician assessment now; no routine confirmation delay')], to: { end: 'urgent_assessment_requested' } }), 'htn_handover');
 for(const [tableId,ruleId] of [[st,'pregnancy_screening_source_limit'],['route_first_visit','pregnancy_first_visit_source_limit']]) replace(sw,tableId,ruleId,r=>({...r,effects:[handover('maternal_hypertension_service','Pregnancy requires its own assessment before routine adult confirmation; this module does not choose a pregnancy regimen')],to:{end:'maternal_assessment_requested'}}),'htn_handover');
 screening.rules.push(row('child_service_handover', ['screening_reading'], 'reading_patient == subject.patient_id and encounter_patient == subject.patient_id and age < 18 a', [handover('child_adolescent_service', 'The national adult screening pathway begins at age 18')], { end: 'child_service_handover_requested' }, 'htn_handover'));
 replace(sw, 'record_diagnosis', 'hypertension_not_diagnosed', r => ({ ...r, effects: [r.effects[0], handover('ncd_diagnostic_service', 'Hypertension was not diagnosed after raised office readings; receiving clinician must record the next assessment or screening plan', {reading:v('diagnosis_review.content.second_reading'),first_reading:b('reading'),second_reading:v('diagnosis_review.content.second_reading'),diagnostic_outcome:'not_hypertension'})], to: { end: 'diagnostic_follow_up_requested' } }), 'htn_handover');
 // Every patient-bearing object that supplies findings must belong to the current patient.
 screening.rules.push(row('correct_screening_patient_context',['screening_reading'],'reading_patient != subject.patient_id or encounter_patient != subject.patient_id',[correctData(['reading.patient','reading.encounter.patient'])],{stay:true},'htn_assessment'));
 for(const [workflow,tableId] of [[sw,'route_first_visit'],['htn_hc_first_treatment','start_hc_workup'],['htn_hc_first_treatment','select_fig9_band']]) {
  const t=table(workflow,tableId);
  Object.assign(t.inputs,{context_patient:input(id,'event.payload.fixed.reading.patient.id'),encounter_patient:input(id,'event.payload.fixed.reading.encounter.patient.id'),'subject.patient_id':input(id,'patient.id')});
  for(const r of [...t.rules]) replace(workflow,tableId,r.id,current=>({...current,when:`context_patient == subject.patient_id and encounter_patient == subject.patient_id and (${current.when})`}),'htn_assessment');
  t.rules.push(row('correct_patient_context',[tableId==='route_first_visit'?'first_visit':tableId==='start_hc_workup'?'workup':'treatment_band'],'context_patient != subject.patient_id or encounter_patient != subject.patient_id',[correctData(['reading.patient','reading.encounter.patient'])],{stay:true},'htn_assessment'));
 }
 // The operational draft follows the current register, without inferring diagnosis from BP.
 replace(sw,'route_first_visit','two_visit_confirmation',r=>({...r,when:r.when.replace('first.systolic < 180 mm[Hg] and first.diastolic < 110 mm[Hg]','first.systolic < 160 mm[Hg] and first.diastolic < 100 mm[Hg]'),evidence:[...r.evidence,'conflict-htn-single-visit-diagnosis','policy-national-baseline']}),'htn_screening_definition');
 D.work_templates.htn_single_visit_diagnosis=spec('Assess diagnosis and treatment now after the first office visit','assessing_clinician',{reading:field(ref('object:observation'))},{diagnosis:listed('hypertension','not_hypertension')},'The clinician records the diagnosis after this one office reading and assesses treatment without routine repeat-visit delay. BP alone does not record a diagnosis.');
 D.records.htn_diagnosis.fields.second_reading.optional=true;
 D.records.htn_diagnosis.fields.basis=field(listed('single_visit','two_visits'),true);
 wf(sw).states.push({id:'single_visit_diagnosis',title:'First-visit clinician diagnosis and treatment assessment',decision:{question:'Does the clinician diagnose hypertension at this visit?',authority:{kind:'role',role:'assessing_clinician'}}});
 table(sw,'route_first_visit').rules.push(row('first_visit_clinician_assessment',['first_visit'],'context_patient == subject.patient_id and encounter_patient == subject.patient_id and pregnant == no and htn.symptoms == no and htn.organ_damage == no and first.systolic > 0 mm[Hg] and first.diastolic > 0 mm[Hg] and (first.systolic >= 160 mm[Hg] or first.diastolic >= 100 mm[Hg]) and first.systolic < 180 mm[Hg] and first.diastolic < 110 mm[Hg]',[task('diagnose_now','htn_single_visit_diagnosis','single_visit_diagnosis',{reading:b('reading')},due(0))],{state:'single_visit_diagnosis'},'htn_screening_definition'));
 const singleDiagnosis=JSON.parse(JSON.stringify(table(sw,'record_diagnosis')).replaceAll('diagnosis_review.content.second_reading','reading'));
 singleDiagnosis.id='record_single_visit_diagnosis';singleDiagnosis.on.work='single_visit_diagnosis';
 singleDiagnosis.fallback={unresolved:'reask_single_visit_diagnosis',not_authorized:'reask_single_visit_diagnosis'};
 for(const r of singleDiagnosis.rules){
  r.in=['single_visit_diagnosis'];r.evidence.push('conflict-htn-single-visit-diagnosis');r.sops=['htn_screening_definition'];
  for(const e of r.effects)if(e.kind==='record' && e.record==='htn_diagnosis'){delete e.fields.second_reading;e.fields.basis='single_visit';}
 }
 wf(sw).tables.push(singleDiagnosis);
 D.tables.reask_single_visit_diagnosis={id:'reask_single_visit_diagnosis',purpose:'information',on:{event:'evaluation.failed'},aliases:{failure:'event.payload'},rules:[row('keep_first_visit_assessment',['single_visit_diagnosis'],'true',[{...reask('htn_single_visit_diagnosis','single_visit_diagnosis'),when:'known(failure.work.id)',occurrence:v('failure.event')}],{stay:true},'htn_screening_definition')]};
 const secondVisit=table(sw,'check_second_visit');
 secondVisit.inputs['second.encounter_patient']=input(id,'event.payload.reading.encounter.patient.id');
 for(const r of [...secondVisit.rules]) if(r.id!=='reading_of_other_patient') replace(sw,secondVisit.id,r.id,current=>({...current,when:`second.encounter_patient == subject.patient_id and second.systolic > 0 mm[Hg] and second.diastolic > 0 mm[Hg] and (${current.when})`}),'htn_assessment');
 replace(sw,secondVisit.id,'reading_of_other_patient',r=>({...r,when:'second.patient_id != subject.patient_id or second.encounter_patient != subject.patient_id',effects:[...r.effects,correctData(['second.patient','second.encounter.patient'])]}),'htn_assessment');
 secondVisit.rules.push(row('correct_second_reading_values',['second_visit_pending'],'second.patient_id == subject.patient_id and second.encounter_patient == subject.patient_id and (second.systolic <= 0 mm[Hg] or second.diastolic <= 0 mm[Hg])',[correctData(['second.systolic','second.diastolic'])],{stay:true},'htn_assessment'));
 for(const [ruleId,destination,reason,outcome] of [
  ['second_exception_source_limit','urgent_assessment_service','Current second-visit findings meet the national exception to routine confirmation; arrange assessment now','confirmation_pending'],
  ['second_pregnancy_source_limit','maternal_hypertension_service','Pregnancy at the current encounter requires maternal assessment before routine adult confirmation','confirmation_pending'],
  ['second_not_raised_source_limit','ncd_diagnostic_service','The current second office reading is below the diagnostic threshold; the receiving clinician must record the next diagnostic or screening plan','not_confirmed_at_second_visit'],
 ]) replace(sw,secondVisit.id,ruleId,r=>({...r,effects:[handover(destination,reason,{reading:v('event.payload.reading'),first_reading:b('reading'),second_reading:v('event.payload.reading'),diagnostic_outcome:outcome})],to:{end:'second_visit_handover_requested'}}),'htn_handover');
 // The current emergency choice requests urgent assessment for known concerning signs at any BP.
 screening.hit='priority';screening.precedence_evidence=['conflict-htn-emergency-definition'];
 for(const r of screening.rules)r.rank=9;
 screening.rules.push(row('known_concerning_signs_at_any_pressure',['screening_reading'],'reading_patient == subject.patient_id and encounter_patient == subject.patient_id and bp.systolic > 0 mm[Hg] and bp.diastolic > 0 mm[Hg] and (htn.symptoms == yes or htn.organ_damage == yes)',[handover('urgent_assessment_service','Known concerning symptoms or organ damage require urgent clinician assessment at any pressure under the current emergency decision')],{end:'urgent_assessment_requested'},'htn_handover',1));
 doc.sops.htn_handover.evidence.push('conflict-htn-emergency-definition');
 doc.sops.htn_targets.evidence.push('conflict-htn-target');
 doc.sops.htn_hc_combination.evidence.push('aspect-htn-ladder-steps');
 doc.sops.htn_supply_receipt.evidence.push('aspect-htn-chw-refill');
 doc.sops.htn_assessment.evidence.push('conflict-htn-stage1-lifestyle-first','policy-unknown-values');
 evidence['policy-unknown-values']={kind:'interpretation',locator:'studio/decisions/policy-unknown-values.json',note:'Keep unknown facts unknown and preserve known urgent care. Decided by an agent, sign-off pending.'};
 // Capture the candidate before reading its fields. The object may not have arrived yet.
 D.work_templates.collect_information.content.candidate_reading=field(ref('object:observation'),true);
 D.work_templates.collect_information.content.candidate_asserted_instant=field({type:'instant'},true);
 D.work_templates.collect_information.content.candidate_asserted_at=field({type:'time'},true);
 D.work_templates.collect_information.content.candidate_received_at=field({type:'instant'},true);
 D.work_templates.collect_information.content.candidate_assertion=field(id,true);
 D.work_templates.collect_information.content.candidate_occurrence=field(id,true);
 D.work_templates.collect_information.content.urgent_requested=field(yn,true);
 D.work_templates.collect_information.content.urgent_reading=field(ref('object:observation'),true);
 D.work_templates.collect_information.content.urgent_occurrence=field(id,true);
 D.work_templates.collect_information.result={...(D.work_templates.collect_information.result??{}),reading:{type:ref('object:observation'),role:'information',optional:true},asserted_at:{type:{type:'instant'},role:'information',optional:true}};
 D.events={...(D.events??{}),'htn.second_reading_ready':{payload:{reading:field(ref('object:observation')),asserted_at:field({type:'time'}),received_at:field({type:'instant'}),assertion:field(id),assertion_occurrence:field(id)}}};
 const capturedAssertion={typed_at:v('event.payload.asserted_at'),asserted_at:v('event.occurred_at'),received_at:v('event.received_at'),assertion:v('event.id'),assertion_occurrence:v('event.occurrence')};
 const retainedAssertion={typed_at:v('event.work.content.candidate_asserted_instant'),asserted_at:v('event.work.content.candidate_asserted_at'),received_at:v('event.work.content.candidate_received_at'),assertion:v('event.work.content.candidate_assertion'),assertion_occurrence:v('event.work.content.candidate_occurrence')};
 const secondReady=(reading:any,assertion:any)=>({id:'evaluate_second_reading',kind:'emit',event:'htn.second_reading_ready',for:b('patient'),to:b('this_execution'),activation:'destination',fields:{reading,asserted_at:assertion.asserted_at,received_at:assertion.received_at,assertion:assertion.assertion,assertion_occurrence:assertion.assertion_occurrence}});
 const retainedUrgency={requested:v('event.work.content.urgent_requested'),reading:v('event.work.content.urgent_reading'),occurrence:v('event.work.content.urgent_occurrence')};
 const collectCandidate=(reading:any,assertion:any,urgent:any={requested:'no',reading,occurrence:assertion.assertion_occurrence})=>task('collect_second_reading','collect_information','information_request',{candidate_reading:reading,candidate_asserted_instant:assertion.typed_at,candidate_asserted_at:assertion.asserted_at,candidate_received_at:assertion.received_at,candidate_assertion:assertion.assertion,candidate_occurrence:assertion.assertion_occurrence,urgent_requested:urgent.requested,urgent_reading:urgent.reading,urgent_occurrence:urgent.occurrence,missing_inputs:['second reading, exact observation chronology, and patient-correlated encounter findings']},due(0));
 // Native elapsed duration checks compare exact instants, including offsets. Missing precision stays unresolved.
 // The retained work, rather than the later completion/ready event, owns the original assertion.
 Object.assign(secondVisit.inputs,{
  'first.time':input({type:'instant'},'reading.time'),
  'assertion.time':input({type:'time'},'information_request.content.candidate_asserted_at'),
  'assertion.instant':input({type:'instant'},'information_request.content.candidate_asserted_instant'),
  'assertion.transport':input({type:'instant'},'information_request.content.candidate_received_at'),
 });
 Object.assign(wf(sw).calculations,{
  second_after_first:{elapsed:{from:v('first.time'),to:v('second.time'),unit:'s',basis:'duration'}},
  second_before_assertion:{elapsed:{from:v('second.time'),to:v('assertion.instant'),unit:'s',basis:'duration'}},
  second_assertion_transport:{elapsed:{from:v('assertion.instant'),to:v('assertion.transport'),unit:'s',basis:'duration'}},
 });
 const secondChronology='assertion.instant == assertion.time and second_after_first >= 0 s and second_before_assertion >= 0 s and second_assertion_transport >= 0 s';
 for(const r of [...secondVisit.rules]) if(!['reading_of_other_patient','correct_second_reading_values'].includes(r.id)) replace(sw,secondVisit.id,r.id,current=>({...current,when:`${secondChronology} and (${current.when})`}),'htn_assessment');
 secondVisit.rules.push(row('correct_second_reading_chronology',['second_visit_pending'],'second.patient_id == subject.patient_id and second.encounter_patient == subject.patient_id and second.systolic > 0 mm[Hg] and second.diastolic > 0 mm[Hg] and (assertion.instant != assertion.time or second_after_first < 0 s or second_before_assertion < 0 s or second_assertion_transport < 0 s)',[record('invalid_second_chronology','decision_issue',{reason:'unmatched',missing_inputs:['second observation after first observation and no later than the original assertion; original assertion no later than transport'],subject:b('patient')})],{stay:true},'htn_assessment'));
 // Known urgent findings own a separate safety route. Diagnostic metadata stays unknown.
 D.records.htn_second_urgent_request={fields:{subject:field(ref('object:patient')),reading:field(ref('object:observation')),assertion_occurrence:field(id)}};
 const urgentSecond=sourceRule(sw,secondVisit.id,'second_exception_source_limit');
 const urgentClinical='second.patient_id == subject.patient_id and second.encounter_patient == subject.patient_id and second.systolic > 0 mm[Hg] and second.diastolic > 0 mm[Hg] and (second.symptoms == yes or second.organ_damage == yes or (second.setting == office and (second.systolic >= 180 mm[Hg] or second.diastolic >= 110 mm[Hg])))';
 Object.assign(secondVisit.inputs,{urgent_requested:input(yn,'information_request.content.urgent_requested'),urgent_reading_id:input(id,'information_request.content.urgent_reading.id'),urgent_occurrence:input(id,'information_request.content.urgent_occurrence'),'candidate.id':input(id,'event.payload.reading.id'),'evidence.occurrence':input(id,'event.payload.assertion_occurrence')});
 const sameUrgentFinding='urgent_requested == yes and urgent_reading_id == candidate.id and urgent_occurrence == evidence.occurrence';
 const newUrgentFinding='urgent_requested == no or urgent_reading_id != candidate.id or urgent_occurrence != evidence.occurrence';
 const safetyInputs=structuredClone(secondVisit.inputs);
 D.events['htn.second_reading_safety_checked']=structuredClone(D.events['htn.second_reading_ready']);
 const afterSafety={...secondReady(v('event.payload.reading'),{asserted_at:v('event.payload.asserted_at'),received_at:v('event.payload.received_at'),assertion:v('event.payload.assertion'),assertion_occurrence:v('event.payload.assertion_occurrence')}),event:'htn.second_reading_safety_checked'};
 const safetyTable={id:'route_known_second_visit_danger',purpose:'clinical_decision',on:{event:'htn.second_reading_ready',for:b('patient')},inputs:safetyInputs,fallback:{unresolved:'await_second_reading_evidence',not_authorized:'await_second_reading_evidence'},rules:[
  row('preserve_known_urgent_care',['second_information_pending'],`(${newUrgentFinding}) and (${urgentClinical})`,[...structuredClone(urgentSecond.effects),record('urgent_requested','htn_second_urgent_request',{subject:b('patient'),reading:v('event.payload.reading'),assertion_occurrence:v('event.payload.assertion_occurrence')}),{id:'replace_safety_collection',kind:'change_work',operation:'cancel',work:{handle:'information_request'},expected_revision:v('information_request.revision'),reason:'Retain the urgent request for this candidate and evidence occurrence while diagnostic correction stays open'},collectCandidate(v('event.payload.reading'),{typed_at:v('information_request.content.candidate_asserted_instant'),asserted_at:v('event.payload.asserted_at'),received_at:v('event.payload.received_at'),assertion:v('event.payload.assertion'),assertion_occurrence:v('event.payload.assertion_occurrence')},{requested:'yes',reading:v('event.payload.reading'),occurrence:v('event.payload.assertion_occurrence')}),afterSafety],{stay:true},'htn_handover'),
  row('no_new_urgent_request',['second_information_pending'],`(${sameUrgentFinding}) or not (${urgentClinical})`,[afterSafety],{stay:true},'htn_assessment'),
 ]};
 wf(sw).tables.push(safetyTable);
 // Confirmation can close only after this candidate's urgent duty was commissioned.
 urgentSecond.when+=` and (${sameUrgentFinding})`;
 urgentSecond.effects=[];
 secondVisit.on={event:'htn.second_reading_safety_checked',for:b('patient')};
 wf(sw).states.push({...structuredClone(wf(sw).states.find((x:any)=>x.id==='second_visit_pending')),id:'second_information_pending',title:'Resolve the captured repeat-visit reading'});
 secondVisit.fallback={...secondVisit.fallback,unresolved:'await_second_reading_evidence',unmatched:'review_second_visit_context',ambiguous:'review_second_visit_context'};
 D.tables.review_second_visit_context={id:'review_second_visit_context',purpose:'information',on:{event:'evaluation.failed'},aliases:{failure:'event.payload'},rules:[row('review_current_second_reading',['second_information_pending'],'true',[record('issue','decision_issue',{reason:v('failure.reason'),subject:b('patient')}),handover('ncd_diagnostic_service','The current repeat reading needs an individualized diagnostic plan',{reading:v('information_request.content.candidate_reading'),first_reading:b('reading'),second_reading:v('information_request.content.candidate_reading'),diagnostic_outcome:'confirmation_pending'})],{end:'second_visit_context_handover_requested'},'htn_handover')]};
 D.tables.await_second_reading_evidence={id:'await_second_reading_evidence',purpose:'information',on:{event:'evaluation.failed'},aliases:{failure:'event.payload'},rules:[row('retain_candidate_and_request',['second_information_pending'],'true',[record('issue','decision_issue',{reason:v('failure.reason'),missing_inputs:v('failure.unknown_inputs'),subject:b('patient')})],{stay:true},'htn_assessment')]};
 for(const rule of secondVisit.rules){
  rule.in=['second_information_pending'];
  if(rule.id==='same_encounter_reading') rule.to={state:'second_visit_pending'};
  rule.effects=rule.effects.filter((e:any)=>e.id!=='correct_patient_data');
  if(!['reading_of_other_patient','correct_second_reading_values','correct_second_reading_chronology'].includes(rule.id)) rule.effects.push({id:'collected_second_reading',kind:'change_work',operation:'satisfy',work:{handle:'information_request'},expected_revision:v('information_request.revision'),evidence:{work:v('information_request'),subject:b('patient'),performer:v('event.actor'),performed_at:v('event.occurred_at'),proof:v('event.id')}});
 }
 wf(sw).tables.push({id:'capture_second_reading',purpose:'coordination',on:{event:'measurement.recorded',for:b('patient')},rules:[
  row('capture_candidate',['second_visit_pending'],'true',[collectCandidate(v('event.payload.reading'),capturedAssertion),secondReady(v('event.payload.reading'),capturedAssertion)],{state:'second_information_pending'},'htn_assessment'),
  row('replace_candidate',['second_information_pending'],'true',[{id:'supersede_collection',kind:'change_work',operation:'cancel',work:{handle:'information_request'},expected_revision:v('information_request.revision'),reason:'A new candidate reading supersedes the previous information request'},collectCandidate(v('event.payload.reading'),capturedAssertion),secondReady(v('event.payload.reading'),capturedAssertion)],{stay:true},'htn_assessment'),
 ]});
 wf(sw).tables.push({id:'resume_second_reading',purpose:'information',on:{event:'task.completed',work:'information_request',for:b('patient')},inputs:{corrected_assertion:input({type:'instant'},'event.payload.result.asserted_at','optional'),corrected_reading:input(ref('object:observation'),'event.payload.result.reading','optional'),corrected_reading_id:input(id,'event.payload.result.reading.id','optional')},hit:'priority',precedence_evidence:['htn_facility_operating_choice'],rules:[
  row('correct_candidate_and_assertion',['second_information_pending'],'known(corrected_reading_id) and known(corrected_assertion)',[collectCandidate(v('corrected_reading'),{...retainedAssertion,typed_at:v('corrected_assertion')},retainedUrgency),secondReady(v('corrected_reading'),retainedAssertion)],{stay:true},'htn_assessment',1),
  row('correct_assertion_precision',['second_information_pending'],'known(corrected_assertion)',[collectCandidate(v('event.work.content.candidate_reading'),{...retainedAssertion,typed_at:v('corrected_assertion')},retainedUrgency),secondReady(v('event.work.content.candidate_reading'),retainedAssertion)],{stay:true},'htn_assessment',2),
  row('use_corrected_candidate',['second_information_pending'],'known(corrected_reading_id)',[collectCandidate(v('corrected_reading'),retainedAssertion,retainedUrgency),secondReady(v('corrected_reading'),retainedAssertion)],{stay:true},'htn_assessment',3),
  row('resume_captured_candidate',['second_information_pending'],'true',[reask('collect_information','information_request'),secondReady(v('event.work.content.candidate_reading'),retainedAssertion)],{stay:true},'htn_assessment',4),
 ]});
 // Collected screening facts resume through the same rules and a current host object revision.
 wf(sw).tables.push({ ...structuredClone(screening), id: 'resume_screening_reading', on: { event: 'task.completed', work: 'information_request', for: b('patient') } });
 wf(sw).tables.push({ id: 'resume_first_visit', purpose: 'coordination', on: { event: 'task.completed', work: 'information_request', for: b('patient') }, rules: [row('resume_first_visit_decision', ['first_visit'], 'true', [{ id: 'decide', kind: 'emit', event: 'decision.requested', activation: 'current', fields: { table: 'route_first_visit', step: 'first_visit', actor:v('event.actor'), source_event:v('event.id'), fixed:{reading:b('reading')}, collected:{} }, for: b('patient'), to: b('this_execution') }], { stay: true }, 'htn_assessment')] });
 const beginCare = { id: 'longitudinal_care', kind: 'start', mode: 'new', definition: { workflow: 'htn_longitudinal_care' }, for: b('patient'), bindings: { patient: b('patient'), reading: b('reading'), owner: b('owner'), mode: 'initial' }, owner: b('owner'), lifetime: 'independent', purpose:'Continue accountable hypertension assessment and prescribing' };
 for (const r of [...table('htn_hc_first_treatment', 'select_fig9_band').rules].filter((r:any)=>r.id!=='correct_patient_context')) replace('htn_hc_first_treatment', 'select_fig9_band', r.id, original => ({ ...original,
  effects: r.id === 'pregnancy_leaves_branch' ? [handover('maternal_hypertension_service', 'Pregnancy is outside this adult non-pregnant module')] : r.id === 'urgency_range_leaves_branch' ? [handover('urgent_assessment_service', 'National urgency/emergency range requires immediate assessment')] : [beginCare],
  to: { end: 'continued_to_owned_care' },
 }), r.id.includes('leaves_branch') ? 'htn_handover' : 'htn_assessment');
 replace('htn_hc_first_treatment', 'start_hc_workup', 'other_care_level', r => ({ ...r, effects: [handover('ncd_advanced_care_service', 'Continue the national hospital work-up and treatment at the receiving level')], to: { end: 'higher_level_handover_requested' } }), 'htn_handover');

 // The new shared prescription decision replaces the legacy first-dose-only choice.
 const firstTreatment = wf('htn_hc_first_treatment');
 firstTreatment.tables = firstTreatment.tables.filter((t: any) => t.id !== 'check_monotherapy_choice');
 table('htn_hc_first_treatment','resume_after_collection').rules = table('htn_hc_first_treatment','resume_after_collection').rules.filter((r: any) => r.id !== 'ask_choice_again');
 firstTreatment.states = firstTreatment.states.filter((s: any) => s.id !== 'medicine_selection');
 delete D.tables.reissue_medicine_choice;
 const lw = 'htn_longitudinal_care';
 for(const template of ['htn_clinical_review','htn_dispense','htn_receipt','htn_next_review']) D.work_templates[template].result.asserted_at = {type:{type:'instant'},role:'information'};
 const reportClock = { report_time:input({type:'instant'},'event.payload.result.asserted_at'), transport_time:input({type:'instant'},'event.received_at'), 'assertion.event_time':input({type:'time'},'event.occurred_at') };
 const reportChronology = 'report_time == assertion.event_time and report_transport_delay >= 0 s';
 wf(lw).calculations.report_transport_delay = {elapsed:{from:v('report_time'),to:v('transport_time'),unit:'s',basis:'duration'}};
 D.work_templates.htn_clinical_review.content.requested_at = field({ type: 'instant' });
 const assessmentTable = table(lw,'review_htn_assessment');
 assessmentTable.inputs.encounter_patient=input(id,'reading.encounter.patient.id');
 replace(lw,assessmentTable.id,'reject_uncorrelated_assessment',r=>({...r,when:`${r.when} or encounter_patient != subject.patient_id`}), 'htn_assessment');
 Object.assign(assessmentTable.inputs,reportClock);
 assessmentTable.inputs.request_time = input({ type: 'instant' }, 'htn_review.content.requested_at');
 wf(lw).calculations.assessment_delay = { elapsed: { from:v('assessment_time'), to:v('report_time'), unit:'s', basis:'duration' } };
 wf(lw).calculations.assessment_after_reading = { elapsed: { from:v('reading_time'), to:v('assessment_time'), unit:'s', basis:'duration' } };
 wf(lw).calculations.assessment_after_request = { elapsed: { from:v('request_time'), to:v('assessment_time'), unit:'s', basis:'duration' } };
 for(const id of ['reference_target_uncertain','review_unambiguous_target','comorbid_regimen_source_limit']) replace(lw,assessmentTable.id,id,r=>({...r,when:r.when.replace('assessment_delay >= 0 d',`assessment_delay >= 0 s and assessment_after_reading >= 0 s and assessment_after_request >= 0 s and ${reportChronology}`)}),id === 'reference_target_uncertain' ? 'htn_targets' : 'htn_assessment');
 replace(lw, 'request_htn_review', 'request_clinical_assessment', r => ({ ...r, effects: r.effects.map((e: any) => e.kind === 'task' ? { ...e, due: due(0), content:{ ...e.content, requested_at:v('event.received_at') } } : e) }), 'htn_assessment');
 replace(lw, 'review_htn_assessment', 'reference_target_uncertain', r => ({ ...r, when:`ckd == no and diabetes == no and (${r.when})`, effects: structuredClone(sourceRule(lw, 'review_htn_assessment', 'review_unambiguous_target').effects), to: { state: 'prescription_decision' } }), 'htn_targets');
 replace(lw, 'review_htn_assessment', 'urgent_assessment_source_limit', r => ({ ...r, effects: [handover('urgent_assessment_service', 'Symptoms, organ damage or the national very-high office BP range')], to: { end: 'urgent_assessment_requested' } }), 'htn_handover');
 replace(lw,'review_htn_assessment','comorbid_regimen_source_limit',r=>({...r,effects:[handover('ncd_advanced_care_service','Diabetes or CKD needs its national condition-specific hypertension regimen; extraction and review are incomplete in this module')],to:{end:'comorbid_regimen_handover_requested'}}),'htn_comorbid_handover');
 // Keep the excluded route explicit; pregnancy and age do not imply a specialist regimen.
 replace(lw, 'review_htn_assessment', 'excluded_care_source_limit', r => ({ ...r, effects: [
  { ...handover('maternal_hypertension_service', 'Pregnancy is outside this adult non-pregnant module'), id:'maternal_handover', when:'pregnant == yes' },
  { ...handover('child_adolescent_service', 'Age below 18 is outside the national adult screening module'), id:'child_handover', when:'pregnant == no and age < 18 a' },
  { ...handover('ncd_advanced_care_service', 'Advanced CKD, specialist indication, new concern or adverse effect needs an individual plan'), id:'ncd_handover', when:'pregnant == no and age >= 18 a' },
 ], to: { end: 'individual_care_handover_requested' } }), 'htn_handover');
 for (const rule of ['reference_target_uncertain', 'review_unambiguous_target']) replace(lw, 'review_htn_assessment', rule, r => ({ ...r, effects: r.effects.map((e: any) => e.kind === 'task' ? { ...e, due: due(0) } : e) }), 'htn_assessment');
 table(lw, 'review_htn_assessment').rules.push(row('nonoffice_assessment_handover', ['review'], 'setting != office', [handover('ncd_diagnostic_service', 'Interpret the measurement in its home or ambulatory context; do not apply office treatment targets')], { end: 'measurement_context_handover_requested' }, 'htn_handover', 6));
 table(lw, 'review_htn_assessment').rules.push(row('diagnosis_not_confirmed_handover', ['review'], 'setting == office and confirmed_htn == no', [handover('ncd_diagnostic_service', 'The clinician has not confirmed hypertension; arrange diagnostic assessment and a recorded next action')], { end: 'diagnostic_handover_requested' }, 'htn_handover', 6));
 for (const r of table(lw, 'review_htn_assessment').rules) for (const e of r.effects) if (e.kind === 'start' && e.definition.workflow === 'htn_owned_handover') e.bindings.assessment = v('assessment');
 const rxTable = table(lw, 'authorize_htn_prescription');
 rxTable.inputs.target_tolerated = input(yn, 'htn_choice.content.assessment.target_tolerated');
 // One assessment reference selects a typed review task. Both paths capture that same reference.
 const regimenPath = 'htn_choice.content.current_regimen';
 D.work_templates.htn_prescription_review.content.current_regimen = field(ref('object:htn_prescription'));
 D.work_templates.htn_prescription_review.content.reviewed_by = field(ref('actor'));
 D.work_templates.htn_first_prescription_review = structuredClone(D.work_templates.htn_prescription_review);
 D.work_templates.htn_first_prescription_review.title = 'Make the first hypertension prescription decision';
 D.work_templates.htn_first_prescription_review.content.current_regimen = field(ref('object:htn_no_regimen_attestation'));
 D.work_templates.htn_first_prescription_review.completion.evidence = 'Attributed clinician first-prescription decision after an explicit same-patient, attributed and dated no-regimen attestation. Only supported starting doses are eligible.';
 for (const [name, decl] of Object.entries(rxTable.inputs) as [string, any][]) if (name.startsWith('prior.'))
  decl.binding = decl.binding.replace('htn_choice.content.assessment.current_prescription', regimenPath);
 rxTable.inputs.regimen_type = input(id, `${regimenPath}.type`);
 assessmentTable.inputs['assessment.current_regimen'] = input(ref('object'), 'event.payload.result.assessment.current_regimen');
 assessmentTable.inputs.regimen_type = input(id, 'event.payload.result.assessment.current_regimen.type');
 for (const ruleId of ['reference_target_uncertain', 'review_unambiguous_target']) replace(lw, assessmentTable.id, ruleId, r => ({
  ...r, when: `(${r.when}) and (regimen_type == "htn_prescription" or regimen_type == htn_no_regimen_attestation)`,
  effects: r.effects.flatMap((e: any) => e.task !== 'htn_prescription_review' ? [e] : [
   { ...e, when: 'regimen_type == "htn_prescription"', content: { ...e.content, current_regimen: v('assessment.current_regimen'), reviewed_by: v('event.actor') } },
   { ...e, id: 'first_choice', task: 'htn_first_prescription_review', as: { handle: 'htn_first_choice', replace: true }, when: 'regimen_type == htn_no_regimen_attestation', content: { ...e.content, current_regimen: v('assessment.current_regimen'), reviewed_by: v('event.actor') } },
  ]),
 }), 'htn_regimen_change');
 const mono = structuredClone(sourceRule(lw, rxTable.id, 'prescribe_supported_monotherapy'));
 const dual = structuredClone(sourceRule(lw, rxTable.id, 'dual_regimen_source_limit'));
 const prescribingEffects = mono.effects.slice(0, 2).map((e:any) => e.kind === 'order' ? { ...e, content: { ...e.content, issued_at:v('event.received_at'), follow_up_interval:v('review_interval') } } : e);
 const intervalType=id;
 rxTable.inputs.sbp=input(quantity('mm[Hg]'),'reading.systolic');
 rxTable.inputs.dbp=input(quantity('mm[Hg]'),'reading.diastolic');
 wf(lw).calculations.review_interval={cases:[
  {when:'action == renew and target_met == yes',value:{value:'three_months'}},
  {when:'(action == start or action == change) and (sbp >= 160 mm[Hg] or dbp >= 100 mm[Hg])',value:{value:'two_weeks'}},
  {when:'((action == start or action == change) and sbp < 160 mm[Hg] and dbp < 100 mm[Hg]) or (action == renew and target_met == no)',value:{value:'four_weeks'}},
 ]};
 const followup=[{id:'schedule_review',kind:'start',mode:'new',definition:{workflow:'htn_scheduled_review'},for:b('patient'),bindings:{patient:b('patient'),reading:b('reading'),owner:b('owner'),prescription:{effect:'prescription'},prescribed_at:v('event.received_at'),interval:v('review_interval')},owner:b('owner'),lifetime:'independent',purpose:'Keep the scheduled clinical review executable independently of medicine supply'}];
 const dispense = task('dispense', 'htn_dispense', 'dispense_work', { prescription: { effect: 'prescription' } }, due(0));
 const effects = [...prescribingEffects, ...followup, dispense];
 wf(lw).calculations.prior_remaining = { elapsed: { from: v('event_time'), to: v('prior.valid_until'), unit: 'd', basis: 'calendar', dates_in: 'Africa/Kigali' } };
 const renewal = 'regimen_type == "htn_prescription" and prior.patient_id == subject.patient_id and prior.status == active and prior_remaining > 0 d and medicine == prior.medicine and dose == prior.dose and second_medicine == prior.second_medicine and (second_medicine == none or second_dose == prior.second_dose)';
 replace(lw, rxTable.id, 'renewal_source_limit', r => ({ ...r, when: `mode == follow_up and action == renew and (${renewal}) and ((${mono.when}) or (${dual.when}))`, effects, to: { state: 'supply_pending' } }), 'htn_prescription_validity');
 wf(lw).calculations.office_above_target={when:'(age < 65 a and (sbp > 130 mm[Hg] or dbp >= 80 mm[Hg])) or (age >= 65 a and (sbp >= 140 mm[Hg] or dbp >= 80 mm[Hg]))'};
 const safeIncrease='sbp >= 120 mm[Hg] and dbp >= 70 mm[Hg] and office_above_target == yes and target_tolerated == yes';
 // Compare each proposed medicine against both positions in the current regimen.
 const crossIncrease=(medicine:string,dose:string,priorMedicine:string,priorDose:string)=>['amlodipine','hydrochlorothiazide','indapamide_sr'].map(drug=>`(${medicine} == ${drug} and ${priorMedicine} == ${drug} and ${dose} > ${priorDose})`).join(' or ');
 const primaryIncrease=`((medicine == prior.medicine and dose > prior.dose) or ${crossIncrease('medicine','dose','prior.second_medicine','prior.second_dose')})`;
 const secondIncrease=`((second_medicine == prior.second_medicine and second_dose > prior.second_dose) or ${crossIncrease('second_medicine','second_dose','prior.medicine','prior.dose')})`;
 const noUnsafeIncrease=`(not ${primaryIncrease} or (${safeIncrease})) and (second_medicine == none or not ${secondIncrease} or (${safeIncrease}))`;
 const consistentPrior='regimen_type == "htn_prescription" and prior.patient_id == subject.patient_id and (prior.status == active or prior.status == stopped)';
 for (const [id, condition] of [['prescribe_supported_monotherapy', mono.when], ['dual_regimen_source_limit', dual.when]]) replace(lw, rxTable.id, id, r => ({ ...r,
  when: `mode == initial and action == start and (${condition}) and (${consistentPrior} and (${noUnsafeIncrease}))`, effects, to: { state: 'supply_pending' },
 }), 'htn_regimen_change');
 replace(lw, rxTable.id, 'regimen_change_source_limit', r => ({ ...r,
  when: `mode == follow_up and action == change and ${consistentPrior} and ((${mono.when}) or (${dual.when})) and (dose <= primary.dose_upper or (prior.status == active and prior_remaining > 0 d and medicine == prior.medicine)) and (${noUnsafeIncrease})`,
  effects, to: { state: 'supply_pending' },
 }), 'htn_regimen_change');
 replace(lw, rxTable.id, 'refer_for_individual_plan', r => ({ ...r, effects: [handover('ncd_advanced_care_service', v('reason'), { assessment: v('assessment') })], to: { end: 'prescription_handover_requested' } }), 'htn_handover');
 for (const r of rxTable.rules.filter((r: any) => r.effects.some((e: any) => e.id === 'prescription'))) r.sops = [...new Set([...r.sops, 'htn_review_intervals', 'htn_prescription_validity', 'htn_supply_receipt'])];
 // A separate typed task makes the no-regimen branch readable without a union type or Core change.
 const firstRx = structuredClone(rxTable);
 firstRx.id = 'authorize_htn_first_prescription';
 firstRx.on.work = 'htn_first_choice';
 firstRx.fallback = { unresolved: 'reask_htn_first_prescription', not_authorized: 'reask_htn_first_prescription' };
 firstRx.inputs = Object.fromEntries(Object.entries(firstRx.inputs).filter(([name]) => !name.startsWith('prior.')));
 for (const decl of Object.values(firstRx.inputs) as any[]) if (typeof decl.binding === 'string') decl.binding = decl.binding.replaceAll('htn_choice.', 'htn_first_choice.');
 const attestationPath = 'htn_first_choice.content.current_regimen';
 firstRx.inputs.attestation_patient = input(id, `${attestationPath}.patient.id`);
 firstRx.inputs['attestation.actor_id'] = input(id, `${attestationPath}.attested_by.id`);
 firstRx.inputs['attestation.actor_kind'] = input(id, `${attestationPath}.attested_by.kind`);
 firstRx.inputs['review.actor_id'] = input(id, 'htn_first_choice.content.reviewed_by.id');
 firstRx.inputs['review.actor_kind'] = input(id, 'htn_first_choice.content.reviewed_by.kind');
 firstRx.inputs.attestation_time = input({ type: 'instant' }, `${attestationPath}.time`);
 firstRx.inputs.assessed_at = input({ type: 'instant' }, 'htn_first_choice.content.assessment.time');
 wf(lw).calculations.attestation_before_assessment = { elapsed: { from: v('attestation_time'), to: v('assessed_at'), unit: 's', basis: 'duration' } };
 const attested = 'regimen_type == htn_no_regimen_attestation and attestation_patient == subject.patient_id and attestation.actor_id == review.actor_id and attestation.actor_kind == review.actor_kind and attestation_before_assessment >= 0 s';
 firstRx.rules = firstRx.rules.filter((r: any) => !['renewal_source_limit', 'regimen_change_source_limit'].includes(r.id)).map((r: any) => {
  if (r.id === 'prescribe_supported_monotherapy' || r.id === 'dual_regimen_source_limit') r.when = `mode == initial and action == start and (${r.id === 'prescribe_supported_monotherapy' ? mono.when : dual.when}) and (${attested})`;
  const rule = JSON.parse(JSON.stringify(r).replaceAll('htn_choice', 'htn_first_choice').replaceAll('htn_prescription_review', 'htn_first_prescription_review'));
  for (const e of rule.effects) if (e.kind === 'task' && e.reissue) e.due = reask(e.task, e.reissue.handle).due;
  return rule;
 });
 wf(lw).tables.push(firstRx);
 D.tables.reask_htn_first_prescription = JSON.parse(JSON.stringify(D.tables.reask_htn_prescription).replaceAll('reask_htn_prescription', 'reask_htn_first_prescription').replaceAll('htn_choice', 'htn_first_choice').replaceAll('htn_prescription_review', 'htn_first_prescription_review'));
 for (const r of D.tables.reask_htn_first_prescription.rules) {
  for (const e of r.effects) if (e.kind === 'task' && e.reissue) e.due = reask(e.task, e.reissue.handle).due;
  r.sops = ['htn_assessment'];
 }
 // Assessment and prescription correction keep the due instant on every path.
 for(const t of [...wf(lw).tables].filter((t: any) => t.id !== firstRx.id))for(const r of [...t.rules])if(r.effects.some((e:any)=>e.kind==='task' && e.reissue && ['htn_clinical_review','htn_prescription_review','htn_first_prescription_review'].includes(e.task))) replace(lw,t.id,r.id,original=>({...original,effects:original.effects.map((e:any)=>e.kind==='task' && e.reissue && ['htn_clinical_review','htn_prescription_review','htn_first_prescription_review'].includes(e.task)?{...e,due:reask(e.task,e.reissue.handle).due}:e)}),'htn_assessment');
 for(const tableId of ['reask_htn_assessment','reask_htn_prescription']){
  const t=D.tables[tableId],r=t.rules[0],original=structuredClone(r);
  for(const e of r.effects)if(e.kind==='task' && e.reissue)e.due=reask(e.task,e.reissue.handle).due;
  r.sops=['htn_assessment'];
  doc.overrides.push({kind:'sop',sop:'htn_assessment',base:`${pin.protocol}@${pin.revision}`,element:`/definitions/tables/${tableId}/rules/0`,original,replacement:structuredClone(r),site:'site-fixture',author:'agent-draft-2026-11-09',status:'proposed_for_clinical_review',rationale:doc.sops.htn_assessment.note});
 }
 // Keep recorded replacement bytes equal to the final effective row.
 for (const o of doc.overrides) {
  const path = o.element.split('/').filter(Boolean); let current: any = doc;
  for (const key of path) current = current[key];
  o.replacement = structuredClone(current);
 }
 for (const state of ['supply_pending', 'receipt_pending', 'supply_recovery']) wf(lw).states.push({ id: state, title: ({ supply_pending: 'Pharmacy dispensing', receipt_pending: 'Confirm patient receipt', supply_recovery: 'Resolve medicine supply failure', next_review_pending: 'Next clinical review' } as any)[state] });
 for (const [state, role] of [['supply_pending','pharmacy_worker'],['receipt_pending','care_coordinator'],['supply_recovery','care_coordinator']]) {
  wf(lw).states.find((s: any) => s.id === state).decision = { question: 'Does the named role verify this patient-correlated work?', authority: { kind: 'role', role } };
 }
 const op = (stage: string) => record('event', 'htn_operational_event', { stage, subject: b('patient'), work: v('event.work') });
 // A host failure ends the attempt, not the care duty. Core cancellation closes that failed occurrence.
 const closeFailedAttempt=(handle:string)=>({id:'close_failed_attempt',kind:'change_work',operation:'cancel',work:{handle},expected_revision:v(`${handle}.revision`),reason:'Host reported this attempt failed; cancel this occurrence and transfer the unmet duty to owned recovery before any replacement'});
 const recovery = (reason: string) => task('recover', 'htn_supply_recovery', 'supply_recovery_work', { prescription: v('htn_prescription'), reason }, due(0));
 const supplyInputs: any = { supply: input(ref('object:htn_supply'), 'event.payload.result.supply'), 'subject.patient_id': input(id, 'patient.id'), event_time: input({ type: 'time' }, 'event.occurred_at'),
  supply_patient: input(id, 'event.payload.result.supply.patient.id'), prescription_id: input(id, 'event.payload.result.supply.prescription.id'), prescription_occurrence: input(id, 'event.payload.result.supply.prescription.occurrence'),
  stock_available: { ...input(yn, 'event.payload.result.supply.stock_available'), resource: { updates: 'case', supplied_by: 'site_pharmacy_stock_reporter' } },
  packed: input(yn, 'event.payload.result.supply.packed'), coverage_until: input({ type: 'instant' }, 'event.payload.result.supply.coverage_until'), validity: input({ type: 'instant' }, 'htn_prescription.content.valid_until'),
  interval: input(intervalType,'htn_prescription.content.follow_up_interval'),
  supply_time: input({ type: 'instant' }, 'event.payload.result.supply.time'), ...reportClock,
  prescription_time: input({ type: 'instant' }, 'htn_prescription.content.issued_at'),
 };
 for (const [key, type] of Object.entries({ medicine: listed('amlodipine','hydrochlorothiazide','indapamide_sr','enalapril','lisinopril'), dose: quantity('mg'), second_medicine: listed('none','amlodipine','hydrochlorothiazide','indapamide_sr'), second_dose: quantity('mg') })) supplyInputs[`supply_${key}`] = input(type, `event.payload.result.supply.${key}`);
 wf(lw).calculations.coverage_days = { elapsed: { from:v('prescription_time'),to:v('coverage_until'),unit:'d',basis:'calendar',dates_in:'Africa/Kigali' } };
 wf(lw).calculations.coverage_months = { elapsed: { from:v('prescription_time'),to:v('coverage_until'),unit:'mo',basis:'calendar',dates_in:'Africa/Kigali' } };
 const sufficientCoverage='((interval == two_weeks and coverage_days >= 14 d) or (interval == four_weeks and coverage_days >= 28 d) or (interval == one_month and coverage_months >= 1 mo) or (interval == three_months and coverage_months >= 3 mo))';
 const insufficientCoverage='((interval == two_weeks and coverage_days < 14 d) or (interval == four_weeks and coverage_days < 28 d) or (interval == one_month and coverage_months < 1 mo) or (interval == three_months and coverage_months < 3 mo))';
 wf(lw).calculations.supply_validity = { elapsed: { from: v('event_time'), to: v('validity'), unit: 'd', basis: 'calendar', dates_in: 'Africa/Kigali' } };
 wf(lw).calculations.coverage_within_validity = { elapsed: { from: v('coverage_until'), to: v('validity'), unit: 'd', basis: 'calendar', dates_in: 'Africa/Kigali' } };
 wf(lw).calculations.receipt_delay = { elapsed: { from: v('receipt_time'), to: v('report_time'), unit: 's', basis: 'duration' } };
 wf(lw).calculations.supply_after_prescription = { elapsed: { from: v('prescription_time'), to: v('supply_time'), unit: 's', basis: 'duration' } };
 wf(lw).calculations.supply_before_report = { elapsed: { from: v('supply_time'), to: v('report_time'), unit: 's', basis: 'duration' } };
 wf(lw).calculations.receipt_after_supply = { elapsed: { from: v('dispensed_at'), to: v('receipt_time'), unit: 's', basis: 'duration' } };
 const correlation = 'supply_patient == subject.patient_id and prescription_id == htn_prescription.id and prescription_occurrence == htn_prescription.occurrence';
 const sameRegimen = 'supply_medicine == htn_prescription.content.medicine and supply_dose == htn_prescription.content.dose and supply_second_medicine == htn_prescription.content.second_medicine and (supply_second_medicine == none or supply_second_dose == htn_prescription.content.second_dose)';
 wf(lw).tables.push({ id: 'verify_htn_dispensing', purpose: 'clinical_decision', on: { event: 'task.completed', work: 'dispense_work', for: b('patient') }, inputs: supplyInputs, hit: 'priority', precedence_evidence: ['htn_facility_operating_choice'], fallback: { unresolved: 'reask_htn_dispensing', not_authorized: 'reask_htn_dispensing' }, rules: [
  row('supply_unavailable', ['supply_pending'], `${correlation} and (stock_available == no or packed == no)`, [op('supply_failed'), recovery('Stock unavailable or medicine not packed')], { state: 'supply_recovery' }, 'htn_supply_receipt', 1),
  row('supply_dates_cannot_cover_review', ['supply_pending'], `${correlation} and ${sameRegimen} and stock_available == yes and packed == yes and (supply_validity <= 0 d or ${insufficientCoverage} or coverage_within_validity < 0 d)`, [op('supply_date_bounds_failed'), recovery('Supply cannot cover the next review within prescription validity; arrange correction with pharmacy or the receiving clinician')], { state: 'supply_recovery' }, 'htn_supply_receipt', 2),
  row('dispensing_verified', ['supply_pending'], `${correlation} and ${sameRegimen} and stock_available == yes and packed == yes and supply_after_prescription >= 0 s and supply_before_report >= 0 s and ${reportChronology} and supply_validity > 0 d and ${sufficientCoverage} and coverage_within_validity >= 0 d`, [op('dispensed'), record('dispensing_evidence','htn_dispensing_evidence',{subject:b('patient'),time:v('supply_time'),supply:v('supply'),dispensing:v('dispense_work')}), task('receipt', 'htn_receipt', 'receipt_work', { prescription: v('htn_prescription'), dispensing: v('dispense_work'), dispensed_at:v('supply_time') }, due(0))], { state: 'receipt_pending' }, 'htn_supply_receipt', 2),
  row('dispensing_not_verified', ['supply_pending'], 'true', [op('supply_evidence_rejected'), reask('htn_dispense', 'dispense_work')], { stay: true }, 'htn_supply_receipt', 9),
 ] });
 wf(lw).tables.push({ id: 'verify_htn_receipt', purpose: 'clinical_decision', on: { event: 'task.completed', work: 'receipt_work', for: b('patient') }, inputs: {
  receipt_time: input({ type: 'instant' }, 'event.payload.result.receipt.time'), ...reportClock,
  dispensed_at: input({ type: 'instant' }, 'receipt_work.content.dispensed_at'),
  'subject.patient_id': input(id, 'patient.id'), receipt_patient: input(id, 'event.payload.result.receipt.patient.id'), receipt_prescription: input(id, 'event.payload.result.receipt.prescription.id'), receipt_occurrence: input(id, 'event.payload.result.receipt.prescription.occurrence'), receipt_dispensing: input(id, 'event.payload.result.receipt.dispensing.id'), receipt_dispensing_occurrence: input(id, 'event.payload.result.receipt.dispensing.occurrence'), received: input(yn, 'event.payload.result.receipt.received'), proof: input(text, 'event.payload.result.receipt.proof'),
 }, hit: 'priority', precedence_evidence: ['htn_facility_operating_choice'], fallback: { unresolved: 'reask_htn_receipt', not_authorized: 'reask_htn_receipt' }, rules: [
  row('patient_receipt_confirmed', ['receipt_pending'], `receipt_patient == subject.patient_id and receipt_prescription == htn_prescription.id and receipt_occurrence == htn_prescription.occurrence and receipt_dispensing == dispense_work.id and receipt_dispensing_occurrence == dispense_work.occurrence and received == yes and receipt_delay >= 0 s and receipt_after_supply >= 0 s and ${reportChronology}`, [record('receipt_evidence','htn_patient_receipt',{subject:b('patient'),prescription:v('htn_prescription'),dispensing:v('dispense_work'),time:v('receipt_time'),proof:v('proof')}),record('received','htn_operational_event',{ stage:'patient_received', subject:b('patient'), work:v('event.work'), evidence:v('proof') }), { id:'fulfill_prescription', kind:'change_work', operation:'satisfy', work:{handle:'htn_prescription'}, expected_revision:v('htn_prescription.revision'), evidence:{ work:v('htn_prescription'), subject:b('patient'), performer:v('event.actor'), performed_at:v('event.occurred_at'), proof:v('proof') } }], { end: 'prescription_received' }, 'htn_supply_receipt', 1),
  row('patient_receipt_failed', ['receipt_pending'], 'receipt_patient == subject.patient_id and receipt_prescription == htn_prescription.id and receipt_occurrence == htn_prescription.occurrence and received == no', [op('receipt_failed'), recovery('Patient has not received the medicines')], { state: 'supply_recovery' }, 'htn_supply_receipt', 1),
  row('receipt_not_correlated', ['receipt_pending'], 'true', [op('receipt_evidence_rejected'), reask('htn_receipt', 'receipt_work')], { stay: true }, 'htn_supply_receipt', 9),
 ] });
 wf(lw).tables.push({ id: 'resolve_htn_supply', purpose: 'clinical_decision', on: { event: 'task.completed', work: 'supply_recovery_work', for: b('patient') }, inputs: { disposition: input(listed('retry_pharmacy','receiving_service'), 'event.payload.result.disposition'), note: input(text, 'event.payload.result.note') }, fallback: { unresolved: 'reask_htn_supply_recovery', not_authorized:'reask_htn_supply_recovery' }, rules: [
  row('retry_authorized_supply', ['supply_recovery'], 'disposition == retry_pharmacy', [record('arrangement','htn_operational_event',{stage:'supply_retry_arranged',subject:b('patient'),evidence:v('note')}), task('dispense', 'htn_dispense', 'dispense_work', { prescription: v('htn_prescription') }, due(0))], { state: 'supply_pending' }, 'htn_supply_receipt'),
  row('supply_service_handover', ['supply_recovery'], 'disposition == receiving_service', [record('arrangement','htn_operational_event',{stage:'supply_handover_arranged',subject:b('patient'),evidence:v('note')}), handover('ncd_advanced_care_service', v('note'), { prescription: v('htn_prescription') }), reask('htn_supply_recovery','supply_recovery_work')], { stay: true }, 'htn_handover'),
 ] });
 for (const [event, handle, states, status] of [['work.failed', 'dispense_work', ['supply_pending'], 'failed'], ['work.failed', 'receipt_work', ['receipt_pending'], 'failed'], ['work.cancelled', 'dispense_work', ['supply_pending'], 'cancelled'], ['work.cancelled', 'receipt_work', ['receipt_pending'], 'cancelled']] as const) wf(lw).tables.push({ id: `${status}_${handle}`, purpose: 'coordination', on: { event, work: handle, for: b('patient') }, inputs:{failed_status:input(listed('queued','dispatched','failed','cancellation_requested','completed','cancelled'),`${handle}.status`)}, rules: [row('request_supply_recovery', [...states], `failed_status == ${status}`, [op(status==='failed'?'host_reported_supply_failure':'host_confirmed_supply_cancellation'), ...(status==='failed'?[closeFailedAttempt(handle)]:[]), recovery('The host reported failed dispensing or receipt work')], { state: 'supply_recovery' }, 'htn_supply_receipt')] });
 const currentReview = `next_patient == subject.patient_id and next_encounter_patient == subject.patient_id and next_reading_id != reading.id and next_encounter != previous.encounter and next_after_reading > 0 s and next_after_prescription >= 0 s and next_before_report >= 0 s and next_visit_date == 0 d and ${reportChronology}`;
 wf(lw).calculations.next_after_reading = { elapsed:{from:v('reading_time'),to:v('next_time'),unit:'s',basis:'duration'} };
 wf(lw).calculations.next_after_prescription = { elapsed:{from:v('prescribed_at'),to:v('next_time'),unit:'s',basis:'duration'} };
 wf(lw).calculations.next_before_report = { elapsed:{from:v('next_time'),to:v('report_time'),unit:'s',basis:'duration'} };
 wf(lw).calculations.next_visit_date = { elapsed:{from:v('next_time'),to:v('visit_time'),unit:'d',basis:'calendar',dates_in:'Africa/Kigali'} };
 const nextReviewTable={ id: 'start_next_htn_review', purpose: 'clinical_decision', on: { event: 'task.completed', work: 'next_review', for: b('patient') }, inputs: { next_reading: input(ref('object:observation'), 'event.payload.result.reading'), next_patient: input(id, 'event.payload.result.reading.patient.id'), 'subject.patient_id': input(id, 'patient.id'), next_reading_id: input(id, 'event.payload.result.reading.id'), next_encounter:input(id,'event.payload.result.reading.encounter.id'), next_encounter_patient:input(id,'event.payload.result.reading.encounter.patient.id'), 'previous.encounter':input(id,'reading.encounter.id'), next_time:input({type:'instant'},'event.payload.result.reading.time'), ...reportClock, visit_time:input({type:'time'},'event.occurred_at') }, fallback: { unresolved: 'reask_htn_next_review', not_authorized:'reask_htn_next_review' }, hit: 'priority', precedence_evidence: ['htn_facility_operating_choice'], rules: [
  row('new_review_execution', ['scheduled_review'], currentReview, [{ ...beginCare, bindings: { patient: b('patient'), reading: v('next_reading'), owner: b('owner'), mode: 'follow_up' } }], { end: 'next_review_started' }, 'htn_review_intervals', 1),
  row('visit_evidence_not_valid', ['scheduled_review'], 'true', [reask('htn_next_review','next_review')], { stay: true }, 'htn_review_intervals', 9),
 ] };
 const reviewCalculations:any={};
 for(const key of ['next_after_reading','next_after_prescription','next_before_report','next_visit_date','report_transport_delay']) reviewCalculations[key]=structuredClone(wf(lw).calculations[key]);
 for(const key of ['next_after_reading','next_after_prescription','next_before_report','next_visit_date']) delete wf(lw).calculations[key];
 const ownedInputs={patient:input(ref('object:patient'),'entry.patient','entry'),owner:input(ref('owner'),'entry.owner','entry')};
 const authority=(role:string)=>({question:'Does the named role verify this patient-correlated work?',authority:{kind:'role',role}});
 const operationalFallback={unresolved:'report_problem',unmatched:'report_problem',ambiguous:'report_problem',invalid_transition:'report_problem'};
 doc.workflows.push({id:'htn_scheduled_review',subject:'patient',inputs:{...ownedInputs,reading:input(ref('object:observation'),'entry.reading','entry'),reading_time:input({type:'instant'},'reading.time','optional'),prescription:input(ref('work'),'entry.prescription','entry'),prescribed_at:input({type:'instant'},'entry.prescribed_at','entry'),interval:input(intervalType,'entry.interval','entry')},calculations:reviewCalculations,initial:'scheduled_review',states:[{id:'scheduled_review',title:'Next clinical review',decision:authority('assessing_clinician')}],fallback:operationalFallback,tables:[
  {id:'schedule_htn_review',purpose:'coordination',on:{event:'workflow.started',for:b('this_execution')},rules:[
   ...([['two_weeks',14,'d'],['four_weeks',28,'d'],['three_months',3,'mo']] as const).map(([interval,value,unit])=>row('schedule_'+interval,['scheduled_review'],'interval == '+interval,[task('review','htn_next_review','next_review',{prescription:b('prescription')},{from:v('prescribed_at'),after:{value,unit},basis:'calendar',zone:'Africa/Kigali'})],{stay:true},'htn_review_intervals')),
  ]},nextReviewTable,
  {id:'overdue_htn_review',purpose:'coordination',on:{event:'work.due',work:'next_review',for:b('patient')},inputs:{contact_requested:input(yn,{exists:'htn_overdue_contact_request',in:'this_execution'})},rules:[row('contact_for_overdue_review',['scheduled_review'],'true',[{id:'contact_owner',kind:'start',mode:'new',when:'contact_requested == no',definition:{workflow:'htn_overdue_contact'},for:b('patient'),bindings:{patient:b('patient'),owner:b('owner'),review:v('next_review')},owner:b('owner'),lifetime:'independent',purpose:'Keep coordinator contact executable even after the clinical review is completed'},{...record('contact_request','htn_overdue_contact_request',{subject:b('patient'),review:v('next_review'),contact_execution:{effect:'contact_owner'}}),when:'contact_requested == no'}],{stay:true},'htn_review_intervals')]},
 ]});
 doc.workflows.push({id:'htn_overdue_contact',subject:'patient',inputs:{...ownedInputs,review:input(ref('work'),'entry.review','entry')},initial:'contact',states:[{id:'contact',title:'Record contact and next arrangement',decision:authority('care_coordinator')}],fallback:operationalFallback,tables:[
  {id:'request_overdue_contact',purpose:'coordination',on:{event:'workflow.started',for:b('this_execution')},rules:[row('request_contact',['contact'],'true',[task('contact','htn_contact_overdue','overdue_contact',{review:b('review')},due(0))],{stay:true},'htn_review_intervals')]},
  {id:'record_overdue_contact',purpose:'clinical_decision',on:{event:'task.completed',work:'overdue_contact',for:b('patient')},inputs:{contacted:input(yn,'event.payload.result.contacted'),note:input(text,'event.payload.result.note')},fallback:{unresolved:'reask_htn_contact',not_authorized:'reask_htn_contact'},rules:[row('keep_contact_and_arrangement',['contact'],'contacted == yes or contacted == no',[record('contact','htn_operational_event',{stage:'overdue_contact_recorded',subject:b('patient'),work:b('review'),evidence:v('note')})],{end:'contact_recorded'},'htn_review_intervals')]},
 ]});
 for (const [handler, template, handle, states] of [
  ['reask_htn_dispensing','htn_dispense','dispense_work',['supply_pending']], ['reask_htn_receipt','htn_receipt','receipt_work',['receipt_pending']],
  ['reask_htn_supply_recovery','htn_supply_recovery','supply_recovery_work',['supply_recovery']], ['reask_htn_next_review','htn_next_review','next_review',['scheduled_review']],
  ['reask_htn_contact','htn_contact_overdue','overdue_contact',['contact']],
 ] as const) D.tables[handler] = { id: handler, purpose: 'information', on: { event: 'evaluation.failed' }, aliases: { failure: 'event.payload' }, rules: [row('request_corrected_evidence', [...states], 'true', [record('issue','decision_issue',{ reason:v('failure.reason'), missing_inputs:v('failure.unknown_inputs'), subject:b('patient') }), { ...reask(template,handle), when: 'known(failure.work.id)', occurrence:v('failure.event') }], { stay:true }, 'htn_supply_receipt')] };

 D.work_templates.screening_recall.result={reading:{type:ref('object:observation'),role:'information'},asserted_at:{type:{type:'instant'},role:'information'}};
 const recallCalculations=structuredClone(reviewCalculations);
 recallCalculations.next_after_prescription.elapsed.from=v('scheduled_at');
 const recallTable=structuredClone(nextReviewTable);
 recallTable.id='start_recalled_screening';recallTable.on.work='recall';recallTable.fallback={unresolved:'reask_htn_screening_recall',not_authorized:'reask_htn_screening_recall'};
 recallTable.rules=[
  row('new_screening_execution',['recall'],currentReview,[{id:'screen_again',kind:'start',mode:'new',definition:{workflow:sw},for:b('patient'),bindings:{patient:b('patient'),reading:v('next_reading'),owner:b('owner')},owner:b('owner'),lifetime:'independent',purpose:'Screen using the current reading and age'}],{end:'screening_started'},'htn_screening_transition',1),
  row('recall_evidence_not_valid',['recall'],'true',[reask('screening_recall','recall')],{stay:true},'htn_screening_transition',9),
 ];
 doc.workflows.push({id:'htn_screening_recall',subject:'patient',inputs:{...ownedInputs,reading:input(ref('object:observation'),'entry.reading','entry'),reading_time:input({type:'instant'},'reading.time','optional'),scheduled_at:input({type:'instant'},'entry.scheduled_at','entry'),interval:input(quantity('a'),'entry.interval','entry')},calculations:recallCalculations,initial:'recall',states:[{id:'recall',title:'Repeat BP screening',decision:authority('screening_worker')}],fallback:operationalFallback,tables:[
  {id:'schedule_screening_recall',purpose:'coordination',on:{event:'workflow.started',for:b('this_execution')},rules:[row('keep_recall',['recall'],'true',[task('recall','screening_recall','recall',{}, {from:v('scheduled_at'),after:v('interval'),basis:'calendar',zone:'Africa/Kigali'})],{stay:true},'htn_screening_transition')]},recallTable,
  {id:'overdue_screening_recall',purpose:'coordination',on:{event:'work.due',work:'recall',for:b('patient')},inputs:{contact_requested:input(yn,{exists:'htn_overdue_contact_request',in:'this_execution'})},rules:[row('contact_for_overdue_screening',['recall'],'true',[{id:'contact_owner',kind:'start',mode:'new',when:'contact_requested == no',definition:{workflow:'htn_overdue_contact'},for:b('patient'),bindings:{patient:b('patient'),owner:b('owner'),review:v('recall')},owner:b('owner'),lifetime:'independent',purpose:'Coordinator contacts the patient about the missed screening'},{...record('contact_request','htn_overdue_contact_request',{subject:b('patient'),review:v('recall'),contact_execution:{effect:'contact_owner'}}),when:'contact_requested == no'}],{stay:true},'htn_screening_transition')]},
 ]});
 D.tables.reask_htn_screening_recall={id:'reask_htn_screening_recall',purpose:'information',on:{event:'evaluation.failed'},aliases:{failure:'event.payload'},rules:[row('request_current_screening_reading',['recall'],'true',[{...reask('screening_recall','recall'),when:'known(failure.work.id)',occurrence:v('failure.event')}],{stay:true},'htn_screening_transition')]};

 // An excluded route has a real receiving service and an executable acknowledgment/retry contract.
 doc.workflows.push({ id: 'htn_owned_handover', subject: 'patient', inputs: {
  patient: input(ref('object:patient'),'entry.patient','entry'), reading: input(ref('object:observation'),'entry.reading','entry'), owner: input(ref('owner'),'entry.owner','entry'), destination: input(id,'entry.destination','entry'), 'handover.destination': input(id,'entry.destination','optional'), reason: input(text,'entry.reason','entry'),
  first_reading:input(ref('object:observation'),'entry.first_reading','optional'),second_reading:input(ref('object:observation'),'entry.second_reading','optional'),diagnostic_outcome:input(listed('confirmation_pending','not_confirmed_at_second_visit','not_hypertension'),'entry.diagnostic_outcome','optional'),
  assessment: input(ref('object:htn_assessment'), 'entry.assessment', 'optional'), prescription: input(ref('work'), 'entry.prescription', 'optional'),
 }, initial: 'handover', states: [{id:'handover',title:'Receiving service acceptance',decision:{question:'Does the receiving clinician accept responsibility for this patient?',authority:{kind:'role',role:'receiving_clinician'}}},{id:'recovery',title:'Resolve unaccepted handover',decision:authority('care_coordinator')}], fallback: {unresolved:'report_problem',unmatched:'report_problem',ambiguous:'report_problem',invalid_transition:'report_problem'}, tables: [
  { id:'request_owned_handover',purpose:'coordination',on:{event:'workflow.started',for:b('this_execution')},rules:[row('request_named_service',['handover'],'true',[task('handover','htn_handover','handover_work',{destination:v('destination'),reason:v('reason'),reading:b('reading'),first_reading:v('first_reading'),second_reading:v('second_reading'),diagnostic_outcome:v('diagnostic_outcome'),assessment:v('assessment'),prescription:v('prescription')},due(0))],{stay:true},'htn_handover')] },
  { id:'accept_owned_handover',purpose:'clinical_decision',on:{event:'task.completed',work:'handover_work',for:b('patient')},inputs:{answer_patient:input(id,'event.payload.result.patient.id'),'subject.patient_id':input(id,'patient.id'),answer_service:input(id,'event.payload.result.destination'),accepted:input(yn,'event.payload.result.accepted'),next_work:input(ref('object:htn_external_work'),'event.payload.result.next_work'),next_patient:input(id,'event.payload.result.next_work.patient.id'),next_destination:input(id,'event.payload.result.next_work.destination'),next_owner:input(ref('actor'),'event.payload.result.next_work.owner'),next_owner_id:input(id,'event.payload.result.next_work.owner.id'),next_owner_kind:input(listed('human','service','simulation'),'event.payload.result.next_work.owner.kind'),next_status:input(listed('accepted','planned'),'event.payload.result.next_work.status'),next_kind:input(listed('clinical_assessment','medicine_supply','diagnostic_assessment','maternal_assessment','child_assessment'),'event.payload.result.next_work.kind'),next_due:input({type:'instant'},'event.payload.result.next_work.due_at')},hit:'priority',precedence_evidence:['htn_facility_operating_choice'],fallback:{unresolved:'reask_htn_handover',not_authorized:'reask_htn_handover'},rules:[
   row('receiving_service_accepts',['handover'],'answer_patient == subject.patient_id and answer_service == handover.destination and accepted == yes and next_patient == subject.patient_id and next_destination == handover.destination and next_owner_id == event.actor.id and next_owner_kind == event.actor.kind and next_status == accepted',[record('acceptance','htn_handover_acceptance',{subject:b('patient'),destination:v('answer_service'),next_work:v('next_work'),next_owner:v('next_owner'),next_kind:v('next_kind'),next_due:v('next_due'),accepted_by:v('event.actor')}),record('accepted','htn_operational_event',{stage:'handover_accepted',subject:b('patient'),work:v('event.work'),evidence:'The receiving clinician accepted the attributed external next-work record; see the acceptance record.'})],{end:'handover_accepted'},'htn_handover',1),
   row('handover_still_open',['handover'],'true',[task('recover','htn_handover_recovery','handover_recovery',{destination:v('destination'),reason:v('reason'),reading:b('reading'),first_reading:v('first_reading'),second_reading:v('second_reading'),diagnostic_outcome:v('diagnostic_outcome'),assessment:v('assessment'),prescription:v('prescription')},due(0))],{state:'recovery'},'htn_handover',9),
  ]},
  {id:'retry_owned_handover',purpose:'clinical_decision',on:{event:'task.completed',work:'handover_recovery',for:b('patient')},inputs:{retry:input(yn,'event.payload.result.retry'),note:input(text,'event.payload.result.note')},fallback:{unresolved:'reask_htn_handover_recovery',not_authorized:'reask_htn_handover_recovery'},rules:[
   row('retry_named_service',['recovery'],'retry == yes',[record('arrangement','htn_operational_event',{stage:'handover_retry_arranged',subject:b('patient'),evidence:v('note')}),task('handover','htn_handover','handover_work',{destination:v('destination'),reason:v('reason'),reading:b('reading'),first_reading:v('first_reading'),second_reading:v('second_reading'),diagnostic_outcome:v('diagnostic_outcome'),assessment:v('assessment'),prescription:v('prescription')},due(0))],{state:'handover'},'htn_handover'),
   row('keep_handover_recovery',['recovery'],'retry == no',[record('arrangement','htn_operational_event',{stage:'handover_unresolved',subject:b('patient'),evidence:v('note')}),reask('htn_handover_recovery','handover_recovery')],{stay:true},'htn_handover'),
  ]},
  {id:'failed_owned_handover',purpose:'coordination',on:{event:'work.failed',work:'handover_work',for:b('patient')},inputs:{failed_status:input(listed('queued','dispatched','failed','cancellation_requested','completed','cancelled'),'handover_work.status')},rules:[row('recover_failed_handover',['handover'],'failed_status == failed',[closeFailedAttempt('handover_work'),task('recover','htn_handover_recovery','handover_recovery',{destination:v('destination'),reason:v('reason'),reading:b('reading'),first_reading:v('first_reading'),second_reading:v('second_reading'),diagnostic_outcome:v('diagnostic_outcome'),assessment:v('assessment'),prescription:v('prescription')},due(0))],{state:'recovery'},'htn_handover')]},
 ] });
 // Immediate is an operating acceptance duty, not a national transfer-time limit.
 const ownedHandover=wf('htn_owned_handover'),acceptance=table('htn_owned_handover','accept_owned_handover');
 D.work_templates.htn_handover.result.asserted_at={type:{type:'instant'},role:'information',optional:true};
 acceptance.inputs.acceptance_time=input({type:'instant'},'event.payload.result.asserted_at');
 acceptance.inputs.acceptance_transport=input({type:'instant'},'event.received_at');
 acceptance.inputs['acceptance.event_time']=input({type:'time'},'event.occurred_at');
 acceptance.inputs.request_due=input({type:'instant'},'handover_work.due.at');
 ownedHandover.calculations={
  acceptance_transport_delay:{elapsed:{from:v('acceptance_time'),to:v('acceptance_transport'),unit:'s',basis:'duration'}},
  urgent_due_by_acceptance:{elapsed:{from:v('next_due'),to:v('acceptance_time'),unit:'s',basis:'duration'}},
  urgent_due_after_request:{elapsed:{from:v('request_due'),to:v('next_due'),unit:'s',basis:'duration'}},
 };
 acceptance.rules[0].when+=' and (handover.destination != urgent_assessment_service or (acceptance_time == acceptance.event_time and acceptance_transport_delay >= 0 s and next_kind == clinical_assessment and urgent_due_by_acceptance >= 0 s and urgent_due_after_request >= 0 s))';
 // Invalid future assertions cannot move the immediate recovery duty into the future.
 acceptance.rules[1].effects[0].due={from:v('event.received_at'),after:{value:0,unit:'s'},basis:'duration'};
 const cancelledHandover=structuredClone(table('htn_owned_handover','failed_owned_handover'));
 cancelledHandover.id='cancelled_owned_handover';cancelledHandover.on.event='work.cancelled';
 cancelledHandover.rules[0].when='failed_status == cancelled';
 cancelledHandover.rules[0].effects=cancelledHandover.rules[0].effects.filter((e:any)=>e.id!=='close_failed_attempt');
 wf('htn_owned_handover').tables.push(cancelledHandover);
 for (const [handler,template,handle,state] of [['reask_htn_handover','htn_handover','handover_work','handover'],['reask_htn_handover_recovery','htn_handover_recovery','handover_recovery','recovery']]) D.tables[handler]={id:handler,purpose:'information',on:{event:'evaluation.failed'},aliases:{failure:'event.payload'},rules:[row('request_valid_handover',[state],'true',[{...reask(template,handle),when:'known(failure.work.id)',occurrence:v('failure.event')}],{stay:true},'htn_handover')]};
 return doc as ProtocolDocument;
}
