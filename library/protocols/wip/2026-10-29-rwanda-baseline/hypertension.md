# Hypertension reference and facility care

Use these drafts to inspect the Rwanda national source and run a proposed facility workflow in Studio. Both use Core preparation, execution, authority and work contracts. Neither has clinical approval. Independent review of the new executable source mappings is pending.

The scope is the adult, non-pregnant hypertension module of NCD care: office screening, confirmation, assessment, supported initial treatment, follow-up prescription decisions, dispensing, receipt and the next review. NCD means noncommunicable disease. This is not the complete NCD service. Hospital regimens, pregnancy care, child care, diabetes/CKD regimen decisions and unsupported medicine choices have named receiving-service handovers. Detailed periodic lipid, diabetes and kidney prevention remains adjacent content to integrate; the source map does not call that source silence.

## Load the reference and national build

| Item | Contract |
| --- | --- |
| Protocol family | `rwanda.htn_screening_assessment_2024` |
| RBCNCD24 source reference | Internal revision `1.0`, [source document](hypertension-screening-assessment.rwanda-source.json) |
| Adult · NCD · Health centre | National version `1.0`, [builder](hypertension.facility.ts) |
| National host contracts | [catalog](hypertension-screening-assessment.rwanda-source.catalog.json) |
| Facility host contracts | `buildHypertensionFacilityCatalog(reference)` in the [builder](hypertension.facility.ts) |
| Reference simulation authority | [source trust](hypertension-screening-assessment.rwanda-source.trust.json) |
| Facility simulation authority | [facility trust](hypertension.facility.trust.json) |
| Reusable cases and host inputs | [fixture](../../../../core/protocol/conformance/rwanda-htn-facility.fixture.ts) |

The prepared identities are `sha256:f57a08d143082517519b1b48fb8bcdb3fe8ddfef676c499f885ebef6d2b50448` for the RBCNCD24 reference and `sha256:7b277361f58cd538b356654dce56db47ca3e6439d954aa75cd4f60f4cbb648ca` for the national facility version `1.0`. These pins identify draft content, not clinical approval. The literal source document and catalog extension keep their original bytes and prepared identity. The facility has its own derived catalog and simulation grants.

The source remains the literal 2024 reference. The facility follows the current central register, including its choices that preserve earlier care from older national sources. Downstream builders must review and adopt the changed facility pin.

The builder accepts a prepared reference. It checks its protocol, revision and computed content identity before cloning it. It leaves the source unchanged. A changed prepared base is refused until the author reviews and repins the derivation. Prepare the facility with `buildHypertensionFacilityCatalog(reference.protocol)`. This catalog removes the two old regimen fields and adds the single reference and attestation object. Its computed identity is separate; source simulation grants do not authorize the facility.

Run this example from the repository root with Bun, or use the same static imports in the Studio integration:

```ts
import sourceDocument from './library/protocols/wip/2026-10-29-rwanda-baseline/hypertension-screening-assessment.rwanda-source.json';
import host from './library/protocols/wip/2026-10-29-rwanda-baseline/hypertension-screening-assessment.rwanda-source.catalog.json';
import { buildHypertensionFacility, buildHypertensionFacilityCatalog } from './library/protocols/wip/2026-10-29-rwanda-baseline/hypertension.facility.ts';
import { defineCatalog, type CatalogExtension } from './core/protocol/contracts.ts';
import { prepareProtocol } from './core/protocol/validate.ts';
const catalog = defineCatalog(host.extension as unknown as CatalogExtension);
const reference = prepareProtocol(sourceDocument, catalog);
if (!reference.ok) throw new Error(JSON.stringify(reference.diagnostics));
const facilityCatalog = buildHypertensionFacilityCatalog(reference.protocol);
const facility = prepareProtocol(buildHypertensionFacility(reference.protocol), facilityCatalog);
if (!facility.ok) throw new Error(JSON.stringify(facility.diagnostics));
console.log(reference.protocol.content, facility.protocol.content);
```

The builder imports Core types only. It has no filesystem, PDF, Node or library-tool dependency. It assembles content; it does not select rules or execute work. The conformance fixture uses Bun/Node test utilities and belongs in tests. Studio must use its existing commands and Core harness, not import the test harness as a product service or copy the clinical conditions into an adapter.

A tiny synthetic fixture example is:

```ts
import { toPrescription, dispense, receive, work } from './core/protocol/conformance/rwanda-htn-facility.fixture.ts';
const run = toPrescription();
const packed = dispense(run.h, run.prescribed);
const received = receive(run.h, packed);
console.log(work(received, 'htn_next_review').due?.at);
// 2027-02-03T09:15:00+02:00
```

## Workflows and evidence

Stable rule IDs stay in the common reference. The national facility build adds default SOPs with Nexo `sops`. It retains source-to-build differences in `overrides` as provenance, including original and replacement values, base revision, author, rationale and draft status. New supply and handover rules cite the same SOP declarations. Community variants can derive from this common content and change delivery work without copying five protocols.

| Workflow | Entry and result |
| --- | --- |
| `htn_screening_assessment` | Patient, office reading and resolved owner. Schedules screening or two-visit work. Only the clinician records diagnosis. |
| `htn_hc_first_treatment` | Diagnosis origin, patient, second reading and owner. Requests national HC/MHC investigations and counselling, then starts the shared assessment in `initial` mode. |
| `htn_longitudinal_care` | Patient, reading, owner and `initial` or `follow_up` mode. Assessment, explicit prescribing, supply, receipt and supply recovery. It starts independent scheduled-review work. |
| `htn_screening_recall` | Patient, previous reading, owner, scheduling instant and year interval. Keeps recall executable and starts the next screening from a current reading supplied by the screening worker. |
| `htn_scheduled_review` | Patient, prior reading, owner, prescription, prescription instant and interval. This independent workflow owns the clinician-authorized next review even after supply finishes. |
| `htn_overdue_contact` | Patient, owner and review reference. This independent workflow owns coordinator contact even after the clinical review finishes. |
| `htn_owned_handover` | Patient, reading, owner, named destination and reason, with the assessment or prescription reference when available. Receiving clinician acceptance or coordinator recovery. |

HC/MHC means health centre or medicalized health centre. A resolved owner is an `{id, revision}` reference; a role name alone is not ownership.

| Work | Required evidence and next work |
| --- | --- |
| `htn_clinical_review` | A patient- and reading-correlated, dated assessment. The clinician records danger signs, pregnancy, comorbidity, renal/contraindication/medicine/adherence review and tolerance. Valid evidence creates `htn_prescription_review`. |
| `htn_prescription_review` | Attributed clinician start, renewal, change or refer decision with a reason. A medicine order needs supported amounts, validity and, for an ACE inhibitor, this patient's potassium. It creates distinct prescription, dispensing and review work. |
| `htn_dispense` | Pharmacy report for the exact order ID and occurrence, both medicines and doses, stock, packing and coverage. Successful packing creates receipt work. Stock availability alone is insufficient. |
| `htn_receipt` | Same-patient evidence for the exact prescription and dispensing occurrence, receipt answer and proof. A confirmed receipt satisfies the prescription. It does not prove ingestion. |
| `htn_supply_recovery` | Coordinator records the failure and chooses a pharmacy retry or an NCD advanced-care handover. No substitution, renewal or stop order is inferred. |
| `htn_next_review` | New same-patient office-reading work remains owned. A completed visit starts a fresh assessment; it does not renew medicine. The new assessment can start while earlier supply recovery remains open. |
| `htn_contact_overdue` | Coordinator contact and arrangement evidence. This does not satisfy the clinical review. |
| `htn_handover` | Receiving clinician identifies the patient and service, accepts responsibility and records next work. Missing evidence, wrong role, refusal or failed handover cannot count as acceptance. |

The named destinations are `urgent_assessment_service`, `maternal_hypertension_service`, `child_adolescent_service`, `ncd_diagnostic_service` and `ncd_advanced_care_service`. They are proposed facility service contracts, not a claim about Rwanda staffing or a configured live referral directory. The source contains relevant specialist and pregnancy treatment; this module does not extract those regimens.

Task completion is verified by Core. An applied completion with incomplete information creates a new task occurrence. Forged performer evidence does not consume or reissue the original task. Host objects, patient correlation, actor identity, role membership, ownership and local stock remain attested case inputs. Stock is an ordinary Nexo local resource with supplier `site_pharmacy_stock_reporter`; it is not clinical source evidence.

## Source basis and proposed choices

The national source is [Rwanda NCD Management Guidelines, 2024](https://rbc.gov.rw/publications/Final_NCDs_Management_Guidelines.pdf), identified as RBCNCD24. The [source map](hypertension-source-map.seed.json) pins its hash and separates each source limitation. PDF page numbers below are ten higher than the printed pages.

The annual BP note at PDF p.12 shortens the five-/three-year maximum intervals from age 35. This follows the [withdrawn screening-interval record](../../../../studio/decisions/conflict-rbcncd24-screening-interval.json). Tests exercise the meaning and due dates. The source-only revision still exposes the distinct strict-inequality conflict at exactly 140/90. The facility uses the explicit definition at PDF p.24 and chooses the higher category for split lower readings.

The [Figure 9 comorbidity record](../../../../studio/decisions/correction-rbcncd24-fig9-comorbidity-clause.json) concerns preferred first line for a person **without** the listed comorbidities. Its readings all permit ACE inhibitor/ARB treatment with those comorbidities, subject to exceptions. The diabetes and kidney passages do not settle the uncomplicated preference. The fixture shows amlodipine as an example; it does not automatically choose it for the clinician.

The source keeps the [age-65 overlap](../../../../studio/decisions/conflict-rbcncd24-target-at-65.json) and [CKD cell reading](../../../../studio/decisions/correction-rbcncd24-fig8-ckd-target.json) open. CKD means chronic kidney disease. Proposed facility SOP `htn_targets` uses the older row from age 65. The earlier CKD reading a with the hypertension floor is now a review alternative only; all CKD regimen decisions have an owned condition-specific handover. The alternatives and affected patients are in [decision register](../../../../studio/decisions/README.md). The target flag never changes a prescription by itself.

Medicine amounts come from Figure 9, PDF p.27. The executable subset is amlodipine, hydrochlorothiazide, indapamide SR, enalapril and lisinopril. Supported dual therapy combines enalapril or lisinopril with a listed calcium-channel blocker or diuretic. It preserves national amounts and avoids an ACE inhibitor/ARB combination. A clinician makes the exact-150/95 and competing-trigger choice explicitly. The pure reference keeps the full regimen-change process at an extraction gap. The proposed `htn_regimen_change` SOP keeps a new or restarted medicine within its printed starting amounts; use of a higher printed maximum needs the same medicine on an active, unexpired prescription for this patient. The clinician still selects and explains the dose. Other regimens, triple therapy, resistant hypertension and specialty indications use the receiving service. The earlier source-only first-treatment branches retain their named dose and regimen gaps.

The facility uses three recommendations from [WHO's 2021 hypertension pharmacological guideline](https://www.who.int/publications/i/item/9789240033986) where national detail is absent:

- Recommendation 2, PDF p.20: testing should not delay treatment; its remarks favor a long-acting calcium-channel blocker when tests are unavailable. This is conditional, with low-certainty evidence. Ordered tests remain open in the initial amlodipine example.
- Recommendation 5, PDF pp.25–26: supports the combination classes, conditionally with moderate-certainty evidence. It supplies no foreign medicine amount to this draft.
- Recommendation 7, PDF pp.29–30: monthly review after initiation/change until target, then every 3–6 months when controlled. Both are conditional with low-certainty evidence. The facility chooses three months for controlled unchanged treatment. The current [review decision](../../../../studio/decisions/conflict-htn-review-after-change.json) governs the facility: two weeks after a start or change at systolic 160 or diastolic 100 or above, and four weeks otherwise. The [stable interval](../../../../studio/decisions/conflict-htn-stable-interval.json) remains three months.

The operational review clock starts at the prescription decision, before supply. This earlier anchor is a proposed SOP; it does not assert treatment initiation. Prescription validity must extend beyond the current Kigali calendar date, and pharmacy coverage must include the review date within validity. A two-week prescription needs at least 14 calendar days of coverage. Adequate coverage can proceed through dispensing and patient receipt. Inadequate coverage keeps immediate owned recovery and the original review date. Expiry-day refusal is conservative. These are date-level checks, not a claim of hour-level expiry validation. The host supplies clinical measurement and receipt times; this module does not assess the quality of free-text clinical evidence.

National periodic duties remain distinct: baseline and annual fasting lipids for adults with hypertension, yearly glycaemia from age 35 with a separate younger-person risk pathway, and risk-based kidney rescreening (PDF pp.13–14). Those broader prevention algorithms and detailed lifestyle programmes are not implemented here. Their source text exists; the missing executable content is an extraction/integration limit.

## Checks and review boundary

Run the conformance files and the repository gate:

```sh
bun test ./core/protocol/conformance/tests/slow/rwanda-htn-2024-journey.test.ts
bun test ./core/protocol/conformance/tests/slow/rwanda-htn-facility.test.ts
make test-ci
```

The source cases preserve original boundaries and planted-fault witnesses. The facility cases exercise exact thresholds, age and target edges, missing/wrong-patient findings, supported medicine choices, potassium and validity boundaries, role refusal, local-resource provenance, stock-out, failed receipt, overdue review, the full two-visit path, and acknowledged handovers. They compare the source-limited outcome separately from the completed operational cycle.

Core preparation reports no errors, but several selection analyses remain incomplete: elapsed-time calculations and comparisons between patient/work references are sampled, and large domains reach the 20,000-case analysis limit. The conformance cases are concrete execution evidence, not an exhaustive proof of every possible input.

Passing tests establish executable behavior, not source fidelity or clinical approval. The next integration uses the merged canvas work through Studio commands and the existing draft lifecycle. This content change adds no renderer, validator, store, command registry or deployment dependency. The draft has not been merged or deployed.

A dose above the printed starting range requires the same active, unexpired medicine. Every increase of a current medicine, including within that range and on an `initial/start` decision, also needs pressure above target, both safety floors and confirmed tolerance.

The facility assessment requires one `current_regimen` reference for prescribing. It names either an `htn_prescription` of this patient, with status `active` or `stopped`, or an `htn_no_regimen_attestation` object. The attestation has three required fields: `patient`, `attested_by` (an actor reference) and `time` (an instant). Its clinician must be the clinician who completed the assessment. Its time cannot follow the assessment. This adds no maximum evidence age. This is attributed medication-review evidence. It is not inferred from absent prescription history.

The assessment rules read the reference's `type` and copy the single reference into a typed review task. A prescription uses `htn_prescription_review`. An attestation uses `htn_first_prescription_review`, which permits only supported first doses in `initial/start` mode. It cannot renew or change treatment. Both tasks use Core authority, work, ownership and correction. The dated attestation permits the supported no-history examples to reach dispensing and patient receipt.

The facility catalog declares neither `no_current_regimen` nor `current_prescription`. Core refuses either old field in a new facility receipt object with a readable reason. An old inline flag cannot select a different prescribing branch. An explicit older host either refuses the new field or admits only old evidence, which leaves the new decision unresolved. A recovered old assessment also leaves that decision unresolved. Core has no object-field exclusion feature.

An omitted `current_regimen` stays unresolved under [unknown-values policy](../../../../studio/decisions/policy-unknown-values.json). The catalog admits the omission as missing clinical information. The assessment decision requires it and keeps immediate owned review, with the original owner and due instant. Missing or inconsistent prescription or attestation evidence keeps review or an explicit individual-plan handover. Refusal does not stop current treatment. The clinician must still choose and explain the dose. A maximum is a ceiling; it does not select a titration step.

Facility receipt evidence uses exact instants: prescription decision ≤ actual dispensing ≤ actual patient receipt ≤ receipt report. The dispensing report must also follow actual dispensing. Event time and report time are separate, so a delayed report can remain valid. These are proposed evidence-correlation rules, not a clinical freshness threshold. Calendar-day prescription expiry and coverage rules remain separate.

A facility assessment must occur after its named reading and current assessment request, and no later than its report. The next review must identify a different reading and encounter, with a reading after the prior prescription decision and on the date of the reported visit. Delayed reporting is allowed; the visit date and report instant remain separate. This proposed SOP does not set a maximum age for potassium results or other clinical evidence.

For assessment, dispensing, receipt, next-review, screening-recall and urgent-handover acceptance completions, `result.asserted_at` is an explicit instant and must equal `event.occurred_at`. The clinical event must not follow that assertion; the assertion must not follow transport `event.received_at`. An urgent acceptance after transport receipt retains immediate owned recovery. Missing or unresolved instants retain owned correction. This keeps actual occurrence, assertion and transport distinct even when a report is delayed. A date-only assertion cannot claim hour-level ordering and needs corrected evidence.

Facility decisions check patient identity on the reading, its encounter, the clinical assessment, prior prescription, laboratory result, supply and receipt before their findings can support the relevant decision. A wrong-patient encounter requests corrected evidence. Both screening visits require positive systolic and diastolic values; this is input validity, not a medical threshold.

For a second screening visit, `measurement.recorded.payload.asserted_at` is an optional catalog field but a required facility confirmation input. It must be an instant equal to the original `event.occurred_at`. The facility uses Core elapsed durations to require first observation ≤ second observation ≤ original assertion ≤ original transport receipt. Equal instants are allowed; this adds no clinical minimum interval or maximum evidence age. The national 28-calendar-day window and distinct-encounter rule still apply. The source-only reference retains its national calendar rule; exact assertion correlation is a proposed facility SOP.

An ordinary information task captures the candidate reference, original event ID, occurrence, assertion time and transport time before the observation fields arrive. `htn.second_reading_ready` carries the same provenance. The original receipt stays with Core's immutable original event; the content does not copy or rewrite the receipt. Partial replies and corrected references keep the captured clock. A completion may provide a missing or corrected typed `result.asserted_at`, but it must still equal that original event time. A later completion time cannot make originally future evidence valid. Missing, mismatched, future or reversed evidence retains owned collection and the repeat-visit duty. Correcting observation evidence can resume the same rules. Duplicate completions cannot create another diagnosis task. These subscriptions are facility definitions; SOP override records retain the exact source rule replacements.

The fixture `event()` supplies `asserted_at` for measurement events. Direct host callers must supply it explicitly; a caller that omits it retains correction work and cannot establish diagnosis. Known urgent findings still start safety care. The static preparation loader needs no event adapter. The source journey fixture can omit this catalog-optional field because it runs the source reference.

Handover acceptance now requires `next_work` to reference a resolved `htn_external_work` object. Its patient and destination must match the handover, its typed owner must be the authorized receiving clinician, and it must identify accepted work, a work kind and a due instant. Empty strings and unresolved references cannot close the handover. This object is attributed evidence from an external service; it is not a second Core task lifecycle and does not prove that the service performed its work. The due instant is a proposed operational evidence requirement, not a national referral deadline.

A host-reported failed dispensing, receipt or handover attempt is cancelled through Core before its handle can be replaced. Its failure and cancellation history remain visible. The unmet care duty moves to the existing coordinator recovery task; the prescription is still outstanding until actual dispensing and patient receipt. Core can cancel an already failed attempt immediately, including an attempt that was dispatched before it failed. This does not invent a host cancellation acknowledgment. If cancellation was already requested while work was dispatched, a failure leaves that request outstanding. No replacement is permitted until Core admits the host acknowledgment for that exact cancellation request; the acknowledgment then creates owned recovery.

A replacement can complete without retaining a failed predecessor. A later result for the cancelled occurrence is retained as a late audit report. It cannot revive that occurrence, create new dispensing/receipt evidence or count as a handover acceptance. The generic policy watcher may finish observing the cancelled occurrence; that does not complete the cancelled work or a prescription. This is a proposed failed-attempt resolution rule, not proof of what happened outside the system.

Supply recovery remains open after an external service accepts a handover. External acceptance does not fulfil a medicine order. The coordinator can arrange another pharmacy attempt, and only verified dispensing and patient receipt satisfy the prescription. Supply recovery, handover recovery and overdue contact require the coordinator role; next-review completion requires the assessing clinician role. These decisions use Core state authority, not the work template’s performer label.

The initial Figure 9 band above 150 systolic or 95 diastolic, using the existing proposed both-below/either-above slash reading, remains a combination indication in the prescription decision. The task and decision record expose `initial_combination_required`. Ordinary monotherapy is refused there. The clinician chooses the supported pair or an owned individual-plan handover. The separate exact-boundary and n11 interpretation remain proposed; no automatic medicine selection follows the flag.

Diabetes and CKD have governing national hypertension content on PDF pages 53 and 73. The complete constraints and exceptions are not yet extracted and reviewed in this module. Both therefore create an owned NCD advanced-care handover, with the current assessment and attributed accepted next work. Generic renal/contraindication answers cannot authorize a general regimen for these patients. The source reference exposes this extraction limit; it does not call the source silent. The earlier proposed CKD target interpretation remains review material only.

Pregnancy is checked before routine adult confirmation. Without known danger, known pregnancy starts maternal assessment and unknown pregnancy requires information. The diagnostic boundary uses the p.24 >=140 systolic OR >=90 diastolic definition. The current emergency choice separately requests urgent assessment for known concerning symptoms or organ damage at any positive pressure, including a non-office reading. Reading and encounter identity remain required. Unknown pregnancy cannot block this assessment and does not authorize a pregnancy regimen. The literal reference keeps its source boundaries visible.

A second-visit handover carries the current reading and the first/second pair. Duplicate prevention uses that candidate reading and its original evidence occurrence. Correction replies for the same finding retain its urgent request. A different reading or evidence occurrence gets its own current urgent request, even when a prior handover was accepted. Diagnostic confirmation cannot close without a request for that candidate. It identifies whether confirmation is pending, the second reading did not confirm the raised threshold, or the clinician decided `not_hypertension`. Handover recovery and retries retain the same evidence. A normal repeat reading alone does not diagnose absence of hypertension.

A recall set before 35 must respect the later annual requirement. The source reference exposes an unresolved first-appointment anchor when the maximum would overrun that period. The proposed facility SOP uses the measurement anniversary in the first age-35 year. For an optimal reading at 34, the recall is one calendar year away, not five. It uses a live independent screening-recall workflow; an attributed new reading starts the next screening, which then schedules annual recall. Imprecise birth data that cannot select the interval require corrected information. This anchor does not infer an exact birthday.

## Corrected timed work

A corrected next-visit report keeps the due instant set by the original prescription decision. The same rule applies to screening recall and the other timed requests made by the facility correction helper. Core deliberately does not carry a due time on `reissue`; these facility effects explicitly read the completed occurrence's `due.at` with zero elapsed offset. They preserve the original due instant and owner. Core gives the corrected task a new occurrence. Missing evidence, a reused encounter, an invalid observation time or a refused role cannot start a new appointment interval.

The scheduled-review and screening-recall workflows record one overdue-contact commission in Core. A correction before due still creates contact at the original deadline. A correction received after due creates contact immediately if no contact owner exists. Later corrections retain that same contact owner, including after contact is recorded. Contact cannot satisfy a clinical visit or renew a prescription. A valid fresh reading starts the next clinical workflow; it does not prove control, authorize medicine or complete a transfer. Core still checks the exact work occurrence, clinician authority and cancellation acknowledgment.

The national reference remains unchanged. The facility build is national version 1.0, stage draft, with no kind tag. The literal reference is not a pathway version. Downstream builders must review and adopt its changed prepared identity.

Known urgent second-visit findings start patient-correlated urgent assessment before the confirmation chronology check. Missing optional assertion metadata stays unknown with owned correction work. It does not establish a diagnosis or validate observation chronology.

Urgent acceptance requires clinical assessment due between the current urgent request and the acceptance instant. A later appointment or medicine supply alone keeps immediate coordinator recovery. This is an operating choice, not a national transfer-time limit or proof of completed assessment.

The [first-visit decision](../../../../studio/decisions/conflict-htn-single-visit-diagnosis.json) requires immediate clinician diagnosis and treatment assessment at systolic 160 or diastolic 100 or above. The clinician records a single-visit basis. BP alone never records a diagnosis. These choices follow [national precedence](../../../../studio/decisions/policy-national-baseline.json) with the stated care comparison, and remain **decided by an agent, sign-off pending**.

The facility also retains medicine at confirmation with counselling, the age-specific target safeguards, stable three-month review and pharmacy supply. It gives no CHW dispensing authority. The current [ladder](../../../../studio/decisions/aspect-htn-ladder-steps.json) and [emergency decision](../../../../studio/decisions/conflict-htn-emergency-definition.json) also govern this module and its receiving-service care. Their complete risk-specific regimens and receiving-service treatment remain integration work. A clinician can select a supported national Figure 9 medicine explicitly, while unsupported steps retain an owned individual-plan handover. This draft does not claim to implement the complete ladder.

Every increase of a current medicine, in either position of a combination, requires pressure above its age-specific target, systolic at least 120, diastolic at least 70 and confirmed tolerance. This applies within a printed starting range too. A below-floor pressure is not an above-target pressure. A refused increase retains clinician prescription review and current safe care. It never creates a stop order. The governing [target choice](../../../../studio/decisions/conflict-htn-target.json) remains decided by an agent, sign-off pending.

Assessment and prescription corrections also retain their original due instants. The same zero-duration expression covers invalid answers, missing inputs and wrong-role reports. Core work ownership and due escalation remain in place through correction.

All executed facility choices are in the [single decision register](../../../../studio/decisions/README.md). Each SOP links its bounded operating choice and governing clinical decisions beside source citations. They are **decided by an agent, sign-off pending**. Generate their review pile with `bun studio/tools/check-decisions.mjs --needs-signoff`. The removed proposed-decisions file is preserved in Git history.

## Community follow-up variants

The [community follow-up draft](hypertension.community.md) adds one Home follow-up with remote review SOP variant 1.0.1 to the exact facility foundation. This proposed comparison requires Ministry of Health authorization before CHW refill handover. The national source and its gaps stay separately inspectable. The variant retains clinician authority, named handover and recovery work, and separate medicine supply and receipt. Clinical sign-off is pending.

## Unknown danger assessment repair

For [I#329, unknown-input care](https://github.com/acompa-health/abrazos-v2/issues/329), the literal reference now creates immediate owned clinical assessment or prompt escalation when hypertension symptoms or organ-damage signs remain unassessed. Collection keeps the missing sign unknown. A live danger review is retained without a duplicate review after a partial reply. The facility builder inherits this care and retains its pending SOP. Known urgent care and current safe treatment remain owned. No medicine or emergency diagnosis is inferred from an unknown. The [repair decision](../../../../studio/decisions/aspect-unknown-input-fallback-care-repair.json) is **decided by an agent, sign-off pending**.

This changes both prepared content identities in the table above. The national facility OpenMRS bundle and all three form destinations are regenerated together. Form UUIDs, questions and concepts are unchanged. The community variant adopts these identities through its current manifest and builder pins; its logic and historical pins are unchanged. The earlier statement that the reference remained unchanged describes that earlier facility-only change.
