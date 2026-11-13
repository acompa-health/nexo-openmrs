# Generated forms: rwanda.htn_screening_assessment_2024 1.0

Identity `sha256:7b277361f58cd538b356654dce56db47ca3e6439d954aa75cd4f60f4cbb648ca`. Status `draft`. Draft for clinical review. Not for care.

28 forms, 144 questions, 113 concepts (16 CIEL, 97 local). Hints: $comment, concepts, values, existing, carryOver, roles, units, labels, $labelDecisions, encounterTypes, extra, references.

## For the protocol author

The forms ask what the protocol needs. These points are for the protocol author. The compiler reports them and does not work around them. See also [the protocol observations](../../../docs/protocol-observations.md).

- htn_clinical_review: the form does not ask "CKD stage" (assessment.ckd_stage). It is optional, and no answer to it changes the next step: other answers already settle each rule that looks at it (review_htn_assessment).
- htn_clinical_review: "Coronary artery disease" (assessment.cad) must be answered, but every rule accepts any answer and no later step reads it. The form keeps it, because the rule cannot run without an answer.
- htn_prescription_review: when "Prescription decision" is "Refer for an individual plan", no rule reads Medicine, Dose, Second medicine and Prescription valid until. The task still requires them, so the form still asks them.
- htn_dispense: when "Medicine in stock" is "No", no rule reads Medicine, Dose and Second medicine. The task still requires them, so the form still asks them.
- htn_dispense: when "Supply packed for the patient" is "No", no rule reads Medicine, Dose and Second medicine. The task still requires them, so the form still asks them.
- htn_contact_overdue: "Patient contacted" (contacted) must be answered, but every rule accepts any answer and no later step reads it. The form keeps it, because the rule cannot run without an answer.
- htn_handover: when "Receiving service accepts the patient" is "No", no rule reads Receiving service, Type of next care, Status of next care and Next care due. The task still requires them, so the form still asks them.
- htn_handover: when "Status of next care" is "Planned", no rule reads Receiving service, Receiving service accepts the patient, Type of next care and Next care due. The task still requires them, so the form still asks them.
- htn_handover: when "Type of next care" is "Medicine supply", no rule reads Next care due. The task still requires it, so the form still asks it.
- htn_handover: when "Type of next care" is "Diagnostic assessment", no rule reads Next care due. The task still requires it, so the form still asks it.
- htn_handover: when "Type of next care" is "Maternal assessment", no rule reads Next care due. The task still requires it, so the form still asks it.
- htn_handover: when "Type of next care" is "Child assessment", no rule reads Next care due. The task still requires it, so the form still asks it.
- htn_first_prescription_review: when "Prescription decision" is "Renew current treatment", no rule reads Medicine, Dose, Second medicine and Prescription valid until. The task still requires them, so the form still asks them.
- htn_first_prescription_review: when "Prescription decision" is "Change treatment", no rule reads Medicine, Dose, Second medicine and Prescription valid until. The task still requires them, so the form still asks them.
- htn_first_prescription_review: when "Prescription decision" is "Refer for an individual plan", no rule reads Medicine, Dose, Second medicine and Prescription valid until. The task still requires them, so the form still asks them.

## Label decisions

These labels replace authoring words of the protocol on the forms and the care pathway. The protocol is unchanged.

- `second reading, exact observation chronology, and patient-correlated encounter findings` → "Second blood-pressure reading, with its time and the visit findings": agent's choice, review pending. I#390: the second-reading task names its missing information in authoring words, and the history and task card showed them as is. The label uses the terms of the form that collects it: the blood-pressure reading, the time that the form records with it, and the visit findings.
- `title:lifestyle_counselling` → "Lifestyle advice": agent's choice, review pending. The protocol title "Lifestyle modification advice (RBCNCD24 PDF p.25); the source names no cadre" carries a citation and an authoring note. The label is the wording proposed to I#324 (docs/o3-walkthrough.md). It renames the form too, so Initializer gives the form a new UUID.
- `dash_diet` → "DASH diet": agent's choice, review pending. Lifestyle advice item. RBCNCD24 PDF p.25 reads "DASH diet" (Dietary Approaches to Stop Hypertension); the generated name read "Dash diet". The wording proposed to I#324.
- `physical_activity_150_min_week` → "Moderate-to-vigorous physical activity: 150 minutes per week": agent's choice, review pending. Lifestyle advice item. The generated name read "Physical activity 150 min week". RBCNCD24 PDF p.25 reads "Moderate-to-vigorous activity 150 min/week", and the label keeps that intensity so that it gives the same advice as the source. Care check: the label states the advice of RBCNCD24 PDF p.25, so the direction of care does not change. The wording proposed to I#324.
- `glycaemia` → "Blood glucose": agent's choice, review pending. Laboratory test in the health centre work-up. RBCNCD24 PDF p.25 reads "glycemia"; the generated name read "Glycaemia". The wording proposed to I#324. I#324 Part 2 B is to confirm the local clinician term.
- `hba1c` → "HbA1c": agent's choice, review pending. Laboratory test in the health centre work-up. RBCNCD24 PDF p.25 reads "HbA1c"; the generated name read "Hba1c". The wording proposed to I#324. I#324 Part 2 B is to confirm the local clinician term.
- `cbc` → "Full blood count": agent's choice, review pending. Laboratory test in the health centre work-up. RBCNCD24 PDF p.25 reads "CBC"; the generated name read "Cbc". The wording proposed to I#324. I#324 Part 2 B is to confirm the local clinician term.

## Forms

| Form | Kind | Performer | Questions | Required | Conditional | Starts |
| --- | --- | --- | --- | --- | --- | --- |
| [Repeat blood-pressure screening](#screening_recall) | task | screening_worker | 10 | 10 | 0 |  |
| [Offer out-of-office BP measurement (ABPM or HBPM)](#offer_out_of_office_measurement) | task | assessing_clinician | 0 | 0 | 0 |  |
| [Repeat office BP visit within four weeks (RBCNCD24 PDF p.12 Fig. 2 and PDF p.24)](#repeat_office_visit) | task | assessing_clinician | 0 | 0 | 0 |  |
| [Decide whether to diagnose hypertension after two office visits](#diagnosis_review) | task | assessing_clinician | 1 | 1 | 0 |  |
| [Clinical review of an undetermined decision](#clinical_review) | task | assessing_clinician | 0 | 0 | 0 |  |
| [Collect the named missing information](#collect_information) | task | assessing_clinician | 10 | 10 | 0 |  |
| [Lifestyle advice](#lifestyle_counselling) | task | assessing_clinician | 0 | 0 | 0 |  |
| [Assess hypertension and reconcile current medicines](#htn_clinical_review) | task | assessing_clinician | 16 | 16 | 0 |  |
| [Make the hypertension prescription decision](#htn_prescription_review) | task | assessing_clinician | 8 | 8 | 2 |  |
| [Dispense the authorized hypertension prescription](#htn_dispense) | task | pharmacy_worker | 7 | 7 | 2 |  |
| [Confirm that the patient received the medicines](#htn_receipt) | task | care_coordinator | 2 | 2 | 0 |  |
| [Resolve failed medicine supply](#htn_supply_recovery) | task | care_coordinator | 2 | 2 | 0 |  |
| [Attend the next NCD hypertension review](#htn_next_review) | task | assessing_clinician | 10 | 10 | 0 |  |
| [Contact the patient and NCD service about overdue review](#htn_contact_overdue) | task | care_coordinator | 2 | 2 | 0 |  |
| [Arrange and acknowledge the receiving service handover](#htn_handover) | task | receiving_clinician | 5 | 5 | 0 |  |
| [Resolve the unaccepted handover](#htn_handover_recovery) | task | care_coordinator | 2 | 2 | 0 |  |
| [Assess diagnosis and treatment now after the first office visit](#htn_single_visit_diagnosis) | task | assessing_clinician | 1 | 1 | 0 |  |
| [Make the first hypertension prescription decision](#htn_first_prescription_review) | task | assessing_clinician | 8 | 8 | 2 |  |
| [Record a blood-pressure reading](#event_measurement_recorded) | event | any | 13 | 10 | 0 | htn_screening_assessment, htn_longitudinal_care |
| [Update visit findings](#update_encounter) | update | any | 7 | 0 | 0 |  |
| [Update assessment](#update_htn_assessment) | update | any | 17 | 0 | 0 |  |
| [Update accepted next care](#update_htn_external_work) | update | any | 4 | 4 | 0 |  |
| [Update no current antihypertensive attestation](#update_htn_no_regimen_attestation) | update | any | 0 | 0 | 0 |  |
| [Update hypertension prescription](#update_htn_prescription) | update | any | 6 | 5 | 0 |  |
| [Update receipt](#update_htn_receipt) | update | any | 2 | 2 | 0 |  |
| [Update dispensing](#update_htn_supply) | update | any | 7 | 3 | 0 |  |
| [Update laboratory result](#update_laboratory_result) | update | any | 1 | 0 | 0 |  |
| [Update blood-pressure reading](#update_observation) | update | any | 3 | 3 | 0 |  |

### screening_recall

**Repeat blood-pressure screening** (task `screening_recall`). Encounter type "Nexo HTN screening recall".

Evidence: Identified new screening reading for this patient

Filled by the host: `reading` ← new object `reading`; `asserted_at` ← now; `reading.patient` ← patient; `reading.encounter` ← new object `reading.encounter`; `reading.time` ← now; `reading.encounter.patient` ← patient.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Blood-pressure reading | Systolic BP | `reading.systolic` | quantity (mm[Hg]) | CIEL:5085 | yes | always | The task declares it required. Read by categorize_screening, route_first_visit, resume_screening_reading, select_fig9_band, review_htn_assessment, authorize_htn_prescription, authorize_htn_first_prescription. |
| Blood-pressure reading | Diastolic BP | `reading.diastolic` | quantity (mm[Hg]) | CIEL:5086 | yes | always | The task declares it required. Read by categorize_screening, route_first_visit, resume_screening_reading, select_fig9_band, review_htn_assessment, authorize_htn_prescription, authorize_htn_first_prescription. |
| Blood-pressure reading | Where was BP measured | `reading.setting` | one of office, home, ambulatory | local | yes | always | The task declares it required. Read by categorize_screening, resume_screening_reading, review_htn_assessment. |
| Visit findings | Symptoms of hypertension | `reading.encounter.hypertension_symptoms` | yes_no | local | yes | always | Read by categorize_screening, route_first_visit, resume_screening_reading. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Evidence of organ damage | `reading.encounter.organ_damage_evidence` | yes_no | local | yes | always | Read by categorize_screening, route_first_visit, resume_screening_reading. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Care level of this facility | `reading.encounter.care_level` | one of health_center, medicalized_health_center, district_hospital, provincial_hospital, level_2_teaching_hospital, referral_hospital, university_teaching_hospital | local | yes | always | Read by start_hc_workup. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Currently pregnant | `reading.encounter.pregnant` | yes_no | CIEL:5272 | yes | always | Read by categorize_screening, route_first_visit, resume_screening_reading, select_fig9_band. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Diabetes | `reading.encounter.diabetes` | yes_no | local | yes | always | Read by select_fig9_band. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Coronary artery disease | `reading.encounter.coronary_artery_disease` | yes_no | local | yes | always | Read by select_fig9_band. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Chronic kidney disease | `reading.encounter.chronic_kidney_disease` | yes_no | local | yes | always | Read by select_fig9_band. "Not known" leaves it unknown; the protocol then asks for it. |

### offer_out_of_office_measurement

**Offer out-of-office BP measurement (ABPM or HBPM)** (task `offer_out_of_office_measurement`). Encounter type "Nexo Offer out-of-office BP measurement".

Evidence: Recorded clinician selection: ordered, declined, or not available

No questions: completing the task is the evidence.

### repeat_office_visit

**Repeat office BP visit within four weeks (RBCNCD24 PDF p.12 Fig. 2 and PDF p.24)** (task `repeat_office_visit`). Encounter type "Nexo HTN repeat office visit".

Evidence: An office BP reading for this patient at a separate encounter, within four weeks of the first office reading

No questions: completing the task is the evidence.

### diagnosis_review

**Decide whether to diagnose hypertension after two office visits** (task `diagnosis_review`). Encounter type "Nexo HTN diagnosis decision".

Evidence: The clinician records the diagnosis decision for this patient

Prefilled from the task: `first_reading`, `second_reading`, `retained_report`, `unresolved_answer`.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Decision | Diagnosis | `diagnosis` | one of hypertension, not_hypertension | local | yes | always | The task declares it required. Read by record_diagnosis. |

### clinical_review

**Clinical review of an undetermined decision** (task `clinical_review`). Encounter type "Nexo Clinical review of an undetermined decision".

Evidence: Reviewer's recorded decision and rationale For unassessed danger, record immediate assessment or escalation, its urgency, the accepting clinician or service and preserved treatment. Collection alone does not complete this duty.

Prefilled from the task: `reason`, `candidates`, `retained_report`, `instructions`.

No questions: completing the task is the evidence.

### collect_information

**Collect the named missing information** (task `collect_information`). Encounter type "Nexo missing information".

Evidence: The named inputs recorded with provenance, or recorded as refused/unobtainable Assess missing danger signs immediately. If they remain unavailable, retain the owned clinical escalation and other indicated care.

Prefilled from the task: `missing_inputs`, `request`, `reading`, `actor`, `candidate_reading`, `candidate_asserted_instant`, `candidate_asserted_at`, `candidate_received_at`, `candidate_assertion`, `candidate_occurrence`, `urgent_requested`, `urgent_reading`, `urgent_occurrence`.

Filled by the host: `reading` ← new object `reading`; `asserted_at` ← now; `reading.patient` ← patient; `reading.encounter` ← new object `reading.encounter`; `reading.time` ← now; `reading.encounter.patient` ← patient.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Blood-pressure reading | Systolic BP | `reading.systolic` | quantity (mm[Hg]) | CIEL:5085 | yes | always | Read by categorize_screening, route_first_visit, select_fig9_band, review_htn_assessment, authorize_htn_prescription, authorize_htn_first_prescription. |
| Blood-pressure reading | Diastolic BP | `reading.diastolic` | quantity (mm[Hg]) | CIEL:5086 | yes | always | Read by categorize_screening, route_first_visit, select_fig9_band, review_htn_assessment, authorize_htn_prescription, authorize_htn_first_prescription. |
| Blood-pressure reading | Where was BP measured | `reading.setting` | one of office, home, ambulatory | local | yes | always | Read by categorize_screening, review_htn_assessment. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Symptoms of hypertension | `reading.encounter.hypertension_symptoms` | yes_no | local | yes | always | Read by categorize_screening, route_first_visit. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Evidence of organ damage | `reading.encounter.organ_damage_evidence` | yes_no | local | yes | always | Read by categorize_screening, route_first_visit. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Care level of this facility | `reading.encounter.care_level` | one of health_center, medicalized_health_center, district_hospital, provincial_hospital, level_2_teaching_hospital, referral_hospital, university_teaching_hospital | local | yes | always | Read by start_hc_workup. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Currently pregnant | `reading.encounter.pregnant` | yes_no | CIEL:5272 | yes | always | Read by categorize_screening, route_first_visit, select_fig9_band. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Diabetes | `reading.encounter.diabetes` | yes_no | local | yes | always | Read by select_fig9_band. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Coronary artery disease | `reading.encounter.coronary_artery_disease` | yes_no | local | yes | always | Read by select_fig9_band. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Chronic kidney disease | `reading.encounter.chronic_kidney_disease` | yes_no | local | yes | always | Read by select_fig9_band. "Not known" leaves it unknown; the protocol then asks for it. |

### lifestyle_counselling

**Lifestyle advice** (task `lifestyle_counselling`). Encounter type "Nexo Lifestyle advice".

Evidence: Recorded advice given for each listed item

Prefilled from the task: `advice`.

No questions: completing the task is the evidence.

### htn_clinical_review

**Assess hypertension and reconcile current medicines** (task `htn_clinical_review`). Encounter type "Nexo HTN assessment".

Evidence: Attributed clinician assessment for this patient and the task reading, with time, confirmed diagnosis, pregnancy, symptoms, organ damage, comorbidities, renal and contraindication review, medicines, adherence, adverse effects and target tolerance. The host supplies the assessment object; a task request alone proves none of these.

Prefilled from the task: `reading`, `mode`, `requested_at`.

Filled by the host: `assessment` ← new object `assessment`; `asserted_at` ← now; `assessment.patient` ← patient; `assessment.reading` ← task content `reading`; `assessment.time` ← now.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Danger signs (stop: `urgent_assessment_source_limit`) | Symptoms of hypertension | `assessment.symptoms` | yes_no | local | yes | always | Read by review_htn_assessment. "Not known" leaves it unknown; the protocol then asks for it. |
| Danger signs (stop: `urgent_assessment_source_limit`) | Evidence of organ damage | `assessment.organ_damage` | yes_no | local | yes | always | Read by review_htn_assessment. "Not known" leaves it unknown; the protocol then asks for it. |
| Reasons for other care (stop: `excluded_care_source_limit`) | Currently pregnant | `assessment.pregnant` | yes_no | CIEL:5272 | yes | always | Read by review_htn_assessment. "Not known" leaves it unknown; the protocol then asks for it. |
| Reasons for other care (stop: `excluded_care_source_limit`) | New clinical concern | `assessment.new_concern` | yes_no | local | yes | always | Read by review_htn_assessment. "Not known" leaves it unknown; the protocol then asks for it. |
| Reasons for other care (stop: `excluded_care_source_limit`) | Adverse effects of medicines | `assessment.adverse_effects` | yes_no | local | yes | always | Read by review_htn_assessment. "Not known" leaves it unknown; the protocol then asks for it. |
| Reasons for other care (stop: `excluded_care_source_limit`) | Specialist care required | `assessment.specialist_required` | yes_no | local | yes | always | Read by review_htn_assessment. "Not known" leaves it unknown; the protocol then asks for it. |
| Conditions that change the medicines (stop: `comorbid_regimen_source_limit`) | Diabetes | `assessment.diabetes` | yes_no | local | yes | always | Read by review_htn_assessment. "Not known" leaves it unknown; the protocol then asks for it. |
| Conditions that change the medicines (stop: `comorbid_regimen_source_limit`) | Chronic kidney disease | `assessment.ckd` | yes_no | local | yes | always | Read by review_htn_assessment. "Not known" leaves it unknown; the protocol then asks for it. |
| Diagnosis (stop: `diagnosis_not_confirmed_handover`) | Hypertension confirmed | `assessment.confirmed_htn` | yes_no | local | yes | always | Read by review_htn_assessment. "Not known" leaves it unknown; the protocol then asks for it. |
| Review checklist | Renal function reviewed | `assessment.renal_reviewed` | yes_no | local | yes | always | Read on the main path, when Chronic kidney disease is No and Diabetes is No and Hypertension confirmed is Yes and Currently pregnant is No and Symptoms of hypertension is No and Evidence of organ damage is No and New clinical concern is No and Current medicines reviewed is Yes and Adherence reviewed is Yes and Adverse effects of medicines is No and Contraindications reviewed is Yes and Specialist care required is No. Read by review_htn_assessment. "Not known" leaves it unknown; the protocol then asks for it. |
| Review checklist | Contraindications reviewed | `assessment.contraindications_reviewed` | yes_no | local | yes | always | Read on the main path, when Chronic kidney disease is No and Diabetes is No and Hypertension confirmed is Yes and Currently pregnant is No and Symptoms of hypertension is No and Evidence of organ damage is No and New clinical concern is No and Current medicines reviewed is Yes and Adherence reviewed is Yes and Adverse effects of medicines is No and Renal function reviewed is Yes and Specialist care required is No. Read by review_htn_assessment. "Not known" leaves it unknown; the protocol then asks for it. |
| Review checklist | Current medicines reviewed | `assessment.medication_reviewed` | yes_no | local | yes | always | Read on the main path, when Chronic kidney disease is No and Diabetes is No and Hypertension confirmed is Yes and Currently pregnant is No and Symptoms of hypertension is No and Evidence of organ damage is No and New clinical concern is No and Adherence reviewed is Yes and Adverse effects of medicines is No and Renal function reviewed is Yes and Contraindications reviewed is Yes and Specialist care required is No. Read by review_htn_assessment. "Not known" leaves it unknown; the protocol then asks for it. |
| Review checklist | Adherence reviewed | `assessment.adherence_reviewed` | yes_no | local | yes | always | Read on the main path, when Chronic kidney disease is No and Diabetes is No and Hypertension confirmed is Yes and Currently pregnant is No and Symptoms of hypertension is No and Evidence of organ damage is No and New clinical concern is No and Current medicines reviewed is Yes and Adverse effects of medicines is No and Renal function reviewed is Yes and Contraindications reviewed is Yes and Specialist care required is No. Read by review_htn_assessment. "Not known" leaves it unknown; the protocol then asks for it. |
| Review checklist | Patient tolerates the BP target | `assessment.target_tolerated` | yes_no | local | yes | always | Read by review_htn_assessment, authorize_htn_prescription, authorize_htn_first_prescription. "Not known" leaves it unknown; the protocol then asks for it. |
| Review checklist | Current antihypertensive regimen | `assessment.current_regimen` | one of htn_prescription, htn_no_regimen_attestation | local | yes | always | Read by review_htn_assessment. "Not known" leaves it unknown; the protocol then asks for it. |
| Review checklist | Coronary artery disease | `assessment.cad` | yes_no | local | yes | always | Read on the main path, when Chronic kidney disease is No and Diabetes is No and Hypertension confirmed is Yes and Currently pregnant is No and Symptoms of hypertension is No and Evidence of organ damage is No and New clinical concern is No and Current medicines reviewed is Yes and Adherence reviewed is Yes and Adverse effects of medicines is No and Renal function reviewed is Yes and Contraindications reviewed is Yes and Specialist care required is No. Read by review_htn_assessment. "Not known" leaves it unknown; the protocol then asks for it. |

Layout decisions:

- Section "Danger signs" (`urgent_assessment_source_limit`): agent's choice, review pending. B1: one answer here sends the patient to urgent assessment (stop row urgent_assessment_source_limit). Heading proposed in the form design research, 4.2.
- Section "Reasons for other care" (`excluded_care_source_limit`): agent's choice, review pending. B1: one answer here hands the patient over for individual care (stop row excluded_care_source_limit). Heading proposed in the form design research, 4.2.
- Section "Conditions that change the medicines" (`comorbid_regimen_source_limit`): agent's choice, review pending. B1: diabetes or CKD hands the patient over for a condition-specific regimen (stop row comorbid_regimen_source_limit). Heading proposed in the form design research, 4.2.
- Section "Diagnosis" (`diagnosis_not_confirmed_handover`): agent's choice, review pending. B1: an unconfirmed diagnosis hands the patient over for diagnostic assessment (stop row diagnosis_not_confirmed_handover).
- Section "Review checklist" (`assessment`): agent's choice, review pending. B1: the questions that the main path reads together before the prescription decision; the four review items must be yes. Heading proposed in the form design research, 4.2.
- Question `assessment.target_tolerated` (ⓘ "Asked here because the prescription step uses it. A dose above the usual range is allowed only when this is yes (RBCNCD24 PDF p.27)."): agent's choice, review pending. D3 (2): no rule of this step changes on the answer, but the prescription step reads it (authorize_htn_prescription, row regimen_change_source_limit). A clinician may ask why it is asked now. Clinical wording needs sign-off.
- Question `assessment.current_regimen` (ⓘ "Choose the current prescription shown above, or confirm that this patient takes no antihypertensive medicine. Your confirmation records you and this encounter date as the evidence for the first prescription."): agent's choice, review pending. The shared facility SOP requires one current-regimen reference (PR#202). Explain the explicit dated attestation and the prescription source without changing the care rules.

### htn_prescription_review

**Make the hypertension prescription decision** (task `htn_prescription_review`). Encounter type "Nexo HTN prescription decision".

Evidence: Attributed clinician decision, reason, medicine and dose, optional second medicine, and validity end. A renewal names the existing active prescription in the assessment and preserves both medicines and doses. ACE inhibitors require a patient-correlated potassium result and renal/contraindication review.

Prefilled from the task: `assessment`, `target_met`, `mode`, `initial_combination_required`, `current_regimen`, `reviewed_by`.

Filled by the host: `potassium_result` ← new object `potassium_result`; `potassium_result.patient` ← patient.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Prescribe or refer (stop: `refer_for_individual_plan`) | Prescription decision | `action` | one of start, renew, change, refer | local | yes | always | The task declares it required. Read by authorize_htn_prescription. |
| Prescription | Medicine | `medicine` | one of amlodipine, hydrochlorothiazide, indapamide_sr, enalapril, lisinopril | local | yes | always | The task declares it required. Read by authorize_htn_prescription. |
| Prescription | Serum potassium | `potassium_result.potassium` | quantity (mmol/L) | CIEL:1133 | yes | Prescription decision is Renew current treatment or Change treatment or Start treatment and Medicine is Enalapril or Lisinopril | Every rule that reads it first needs: Prescription decision is Renew current treatment or Change treatment or Start treatment and Medicine is Enalapril or Lisinopril. Read by authorize_htn_prescription. |
| Prescription | Dose | `dose` | quantity (mg) | local | yes | always | The task declares it required. Read by authorize_htn_prescription. |
| Prescription | Second medicine | `second_medicine` | one of none, amlodipine, hydrochlorothiazide, indapamide_sr | local | yes | always | The task declares it required. Read by authorize_htn_prescription. |
| Prescription | Second medicine dose | `second_dose` | quantity (mg) | local | yes | Prescription decision is Renew current treatment or Change treatment or Start treatment and Second medicine is Amlodipine or Hydrochlorothiazide or Indapamide SR | Every rule that reads it first needs: Prescription decision is Renew current treatment or Change treatment or Start treatment and Second medicine is Amlodipine or Hydrochlorothiazide or Indapamide SR. Read by authorize_htn_prescription. |
| Prescription | Prescription valid until | `valid_until` | instant | local | yes | always | The task declares it required. Read by authorize_htn_prescription. |
| Prescription | Reason for the decision | `reason` | text | local | yes | always | The task declares it required. Read by authorize_htn_prescription. |

Layout decisions:

- Section "Prescribe or refer" (`refer_for_individual_plan`): agent's choice, review pending. B1, A2: the decision comes before the details. "Refer" alone ends this step (stop row refer_for_individual_plan).
- Section "Prescription" (`decision`): agent's choice, review pending. B1: the medicine, dose, potassium and validity that the prescribing rows read, then the reason.
- Question `potassium_result.potassium` (ⓘ "Asked because enalapril and lisinopril need a potassium result for this patient (RBCNCD24 PDF p.27, Fig. 9)."): agent's choice, review pending. D3 (1): the question shows only after an ACE inhibitor is chosen, so a clinician may ask why it appeared. Text from the task evidence ("ACE inhibitors require a patient-correlated potassium result") and evidence interp_p27_n5_potassium. Clinical wording needs sign-off.
- Question `second_dose` (ⓘ none): agent's choice, review pending. D3: it shows only after a second medicine is chosen, which a clinician expects. An ⓘ would add nothing.

### htn_dispense

**Dispense the authorized hypertension prescription** (task `htn_dispense`). Encounter type "Nexo HTN dispensing".

Evidence: Attributed pharmacy report tied to this patient, prescription ID and occurrence, both medicine names and doses, stock, packing, and coverage end. Stock availability alone is not dispensing.

Prefilled from the task: `prescription`.

Filled by the host: `supply` ← new object `supply`; `asserted_at` ← now; `supply.patient` ← patient; `supply.prescription` ← task content `prescription`; `supply.time` ← now.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Stock and packing (stop: `supply_unavailable`) | Medicine in stock | `supply.stock_available` | yes_no | local | yes | always | Read by verify_htn_dispensing. "Not known" leaves it unknown; the protocol then asks for it. |
| Stock and packing (stop: `supply_unavailable`) | Supply packed for the patient | `supply.packed` | yes_no | local | yes | always | Read by verify_htn_dispensing. "Not known" leaves it unknown; the protocol then asks for it. |
| Medicines dispensed | Medicine | `supply.medicine` | one of amlodipine, hydrochlorothiazide, indapamide_sr, enalapril, lisinopril | local | yes | always | The task declares it required. Read by verify_htn_dispensing. |
| Medicines dispensed | Dose | `supply.dose` | quantity (mg) | local | yes | always | The task declares it required. Read by verify_htn_dispensing. |
| Medicines dispensed | Second medicine | `supply.second_medicine` | one of none, amlodipine, hydrochlorothiazide, indapamide_sr | local | yes | always | The task declares it required. Read by verify_htn_dispensing. |
| Medicines dispensed | Second medicine dose | `supply.second_dose` | quantity (mg) | local | yes | Medicine in stock is Yes and Supply packed for the patient is Yes and Second medicine is Amlodipine or Hydrochlorothiazide or Indapamide SR | Every rule that reads it first needs: Medicine in stock is Yes and Supply packed for the patient is Yes and Second medicine is Amlodipine or Hydrochlorothiazide or Indapamide SR. Read by verify_htn_dispensing. |
| Medicines dispensed | Supply lasts until | `supply.coverage_until` | instant | local | yes | Medicine in stock is Yes and Supply packed for the patient is Yes | Every rule that reads it first needs: Medicine in stock is Yes and Supply packed for the patient is Yes. Read by verify_htn_dispensing. |

Layout decisions:

- Section "Stock and packing" (`supply_unavailable`): agent's choice, review pending. B1, A4: a "no" to either question sends the supply to recovery (stop row supply_unavailable), so they come first.
- Section "Medicines dispensed" (`supply`): agent's choice, review pending. B1: what the pharmacy gave and until when, checked against the prescription.

### htn_receipt

**Confirm that the patient received the medicines** (task `htn_receipt`). Encounter type "Nexo HTN medicine receipt".

Evidence: Patient-linked receipt for the exact prescription and dispensing task, with date and receipt proof. Pharmacy packing alone is not patient receipt or medicine use.

Prefilled from the task: `prescription`, `dispensing`, `dispensed_at`.

Filled by the host: `receipt` ← new object `receipt`; `asserted_at` ← now; `receipt.patient` ← patient; `receipt.prescription` ← task content `prescription`; `receipt.dispensing` ← task content `dispensing`; `receipt.time` ← now.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Receipt | Patient received the medicines | `receipt.received` | yes_no | local | yes | always | The task declares it required. Read by verify_htn_receipt. |
| Receipt | How receipt was confirmed | `receipt.proof` | text | local | yes | always | The task declares it required. Read by verify_htn_receipt. |

### htn_supply_recovery

**Resolve failed medicine supply** (task `htn_supply_recovery`). Encounter type "Nexo Resolve failed medicine supply".

Evidence: Coordinator records the stock or receipt failure and either arranges another pharmacy attempt or requests an acknowledged NCD service handover. No medicine is silently substituted.

Prefilled from the task: `prescription`, `reason`.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Decision | What to do next | `disposition` | one of retry_pharmacy, receiving_service | local | yes | always | The task declares it required. Read by resolve_htn_supply. |
| Decision | What was arranged | `note` | text | local | yes | always | The task declares it required. Read by resolve_htn_supply. |

### htn_next_review

**Attend the next NCD hypertension review** (task `htn_next_review`). Encounter type "Nexo HTN next review".

Evidence: Attributed new office reading for this patient at the follow-up encounter. Completing the visit opens a fresh clinical assessment; it does not prove control or renew medicine.

Prefilled from the task: `prescription`.

Filled by the host: `reading` ← new object `reading`; `asserted_at` ← now; `reading.patient` ← patient; `reading.encounter` ← new object `reading.encounter`; `reading.time` ← now; `reading.encounter.patient` ← patient.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Blood-pressure reading | Systolic BP | `reading.systolic` | quantity (mm[Hg]) | CIEL:5085 | yes | always | The task declares it required. Read by categorize_screening, route_first_visit, resume_screening_reading, select_fig9_band, review_htn_assessment, authorize_htn_prescription, authorize_htn_first_prescription. |
| Blood-pressure reading | Diastolic BP | `reading.diastolic` | quantity (mm[Hg]) | CIEL:5086 | yes | always | The task declares it required. Read by categorize_screening, route_first_visit, resume_screening_reading, select_fig9_band, review_htn_assessment, authorize_htn_prescription, authorize_htn_first_prescription. |
| Blood-pressure reading | Where was BP measured | `reading.setting` | one of office, home, ambulatory | local | yes | always | The task declares it required. Read by categorize_screening, resume_screening_reading, review_htn_assessment. |
| Visit findings | Symptoms of hypertension | `reading.encounter.hypertension_symptoms` | yes_no | local | yes | always | Read by categorize_screening, route_first_visit, resume_screening_reading. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Evidence of organ damage | `reading.encounter.organ_damage_evidence` | yes_no | local | yes | always | Read by categorize_screening, route_first_visit, resume_screening_reading. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Care level of this facility | `reading.encounter.care_level` | one of health_center, medicalized_health_center, district_hospital, provincial_hospital, level_2_teaching_hospital, referral_hospital, university_teaching_hospital | local | yes | always | Read by start_hc_workup. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Currently pregnant | `reading.encounter.pregnant` | yes_no | CIEL:5272 | yes | always | Read by categorize_screening, route_first_visit, resume_screening_reading, select_fig9_band. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Diabetes | `reading.encounter.diabetes` | yes_no | local | yes | always | Read by select_fig9_band. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Coronary artery disease | `reading.encounter.coronary_artery_disease` | yes_no | local | yes | always | Read by select_fig9_band. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Chronic kidney disease | `reading.encounter.chronic_kidney_disease` | yes_no | local | yes | always | Read by select_fig9_band. "Not known" leaves it unknown; the protocol then asks for it. |

### htn_contact_overdue

**Contact the patient and NCD service about overdue review** (task `htn_contact_overdue`). Encounter type "Nexo Contact the patient and NCD service about o…".

Evidence: Document contact and the next arrangement. Contact does not satisfy the still-open clinical review.

Prefilled from the task: `review`.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Decision | Patient contacted | `contacted` | yes_no | local | yes | always | The task declares it required. Read by record_overdue_contact. |
| Decision | What was arranged | `note` | text | local | yes | always | The task declares it required. Read by record_overdue_contact. |

### htn_handover

**Arrange and acknowledge the receiving service handover** (task `htn_handover`). Encounter type "Nexo Arrange and acknowledge the receiving servi…".

Evidence: The receiving clinician identifies this patient and named service, accepts responsibility and supplies a resolved external next-work record with matching patient/service, that clinician as its owner, work kind, accepted status and due instant. This is attributed external evidence; it does not execute or complete the receiving service work. Sending a referral or completing a checklist does not prove acceptance.

Prefilled from the task: `first_reading`, `second_reading`, `diagnostic_outcome`, `destination`, `reason`, `reading`, `assessment`, `prescription`.

Filled by the host: `patient` ← patient; `next_work` ← new object `next_work`; `asserted_at` ← now; `next_work.patient` ← patient; `next_work.destination` ← task content `destination`; `next_work.owner` ← actor.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Decision | Receiving service | `destination` | identifier | local | yes | always | The task declares it required. Read by accept_owned_handover. |
| Decision | Receiving service accepts the patient | `accepted` | yes_no | local | yes | always | The task declares it required. Read by accept_owned_handover. |
| Accepted next care | Type of next care | `next_work.kind` | one of clinical_assessment, medicine_supply, diagnostic_assessment, maternal_assessment, child_assessment | local | yes | always | The task declares it required. Read by accept_owned_handover. |
| Accepted next care | Status of next care | `next_work.status` | one of accepted, planned | local | yes | always | The task declares it required. Read by accept_owned_handover. |
| Accepted next care | Next care due | `next_work.due_at` | instant | local | yes | always | The task declares it required. Read by accept_owned_handover. |

### htn_handover_recovery

**Resolve the unaccepted handover** (task `htn_handover_recovery`). Encounter type "Nexo Resolve the unaccepted handover".

Evidence: The coordinator contacts the named receiving service and records the next arrangement. A failed handover remains open until a clinician accepts it.

Prefilled from the task: `first_reading`, `second_reading`, `diagnostic_outcome`, `destination`, `reason`, `reading`, `assessment`, `prescription`.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Decision | Try the handover again | `retry` | yes_no | local | yes | always | The task declares it required. Read by retry_owned_handover. |
| Decision | What was arranged | `note` | text | local | yes | always | The task declares it required. Read by retry_owned_handover. |

### htn_single_visit_diagnosis

**Assess diagnosis and treatment now after the first office visit** (task `htn_single_visit_diagnosis`). Encounter type "Nexo Assess diagnosis and treatment now after th…".

Evidence: The clinician records the diagnosis after this one office reading and assesses treatment without routine repeat-visit delay. BP alone does not record a diagnosis.

Prefilled from the task: `reading`.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Decision | Diagnosis | `diagnosis` | one of hypertension, not_hypertension | local | yes | always | The task declares it required. Read by record_single_visit_diagnosis. |

### htn_first_prescription_review

**Make the first hypertension prescription decision** (task `htn_first_prescription_review`). Encounter type "Nexo HTN first prescription decision".

Evidence: Attributed clinician first-prescription decision after an explicit same-patient, attributed and dated no-regimen attestation. Only supported starting doses are eligible.

Prefilled from the task: `assessment`, `target_met`, `mode`, `initial_combination_required`, `current_regimen`, `reviewed_by`.

Filled by the host: `potassium_result` ← new object `potassium_result`; `potassium_result.patient` ← patient.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Prescribe or refer (stop: `refer_for_individual_plan`) | Prescription decision | `action` | one of start, renew, change, refer | local | yes | always | The task declares it required. Read by authorize_htn_first_prescription. |
| Prescription | Medicine | `medicine` | one of amlodipine, hydrochlorothiazide, indapamide_sr, enalapril, lisinopril | local | yes | always | The task declares it required. Read by authorize_htn_first_prescription. |
| Prescription | Serum potassium | `potassium_result.potassium` | quantity (mmol/L) | CIEL:1133 | yes | Prescription decision is Start treatment and Medicine is Enalapril or Lisinopril | Every rule that reads it first needs: Prescription decision is Start treatment and Medicine is Enalapril or Lisinopril. Read by authorize_htn_first_prescription. |
| Prescription | Dose | `dose` | quantity (mg) | local | yes | always | The task declares it required. Read by authorize_htn_first_prescription. |
| Prescription | Second medicine | `second_medicine` | one of none, amlodipine, hydrochlorothiazide, indapamide_sr | local | yes | always | The task declares it required. Read by authorize_htn_first_prescription. |
| Prescription | Second medicine dose | `second_dose` | quantity (mg) | local | yes | Prescription decision is Start treatment and Medicine is Enalapril or Lisinopril and Second medicine is Amlodipine or Hydrochlorothiazide or Indapamide SR | Every rule that reads it first needs: Prescription decision is Start treatment and Medicine is Enalapril or Lisinopril and Second medicine is Amlodipine or Hydrochlorothiazide or Indapamide SR. Read by authorize_htn_first_prescription. |
| Prescription | Prescription valid until | `valid_until` | instant | local | yes | always | The task declares it required. Read by authorize_htn_first_prescription. |
| Prescription | Reason for the decision | `reason` | text | local | yes | always | The task declares it required. Read by authorize_htn_first_prescription. |

Layout decisions:

- Section "Prescribe or refer" (`refer_for_individual_plan`): agent's choice, review pending. B1, A2: the decision comes before the details. "Refer" alone ends this step (stop row refer_for_individual_plan).
- Section "Prescription" (`decision`): agent's choice, review pending. B1: the medicine, dose, potassium and validity that the prescribing rows read, then the reason.
- Question `potassium_result.potassium` (ⓘ "Asked because enalapril and lisinopril need a potassium result for this patient (RBCNCD24 PDF p.27, Fig. 9)."): agent's choice, review pending. D3 (1): the question shows only after an ACE inhibitor is chosen, so a clinician may ask why it appeared. Text from the task evidence ("ACE inhibitors require a patient-correlated potassium result") and evidence interp_p27_n5_potassium. Clinical wording needs sign-off.
- Question `second_dose` (ⓘ none): agent's choice, review pending. D3: it shows only after a second medicine is chosen, which a clinician expects. An ⓘ would add nothing.

### event_measurement_recorded

**Record a blood-pressure reading** (event `measurement.recorded`). Encounter type "Nexo BP reading".

Filled by the host: `reading` ← new object `reading`; `asserted_at` ← now; `reading.patient` ← patient; `reading.encounter` ← new object `reading.encounter`; `reading.time` ← now; `reading.encounter.patient` ← patient.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Blood-pressure reading | Systolic BP | `reading.systolic` | quantity (mm[Hg]) | CIEL:5085 | yes | always | The event declares it required. Read by categorize_screening, route_first_visit, resume_screening_reading, select_fig9_band, review_htn_assessment, authorize_htn_prescription, authorize_htn_first_prescription. |
| Blood-pressure reading | Diastolic BP | `reading.diastolic` | quantity (mm[Hg]) | CIEL:5086 | yes | always | The event declares it required. Read by categorize_screening, route_first_visit, resume_screening_reading, select_fig9_band, review_htn_assessment, authorize_htn_prescription, authorize_htn_first_prescription. |
| Blood-pressure reading | Where was BP measured | `reading.setting` | one of office, home, ambulatory | local | yes | always | The event declares it required. Read by categorize_screening, resume_screening_reading, review_htn_assessment. |
| Visit findings | Symptoms of hypertension | `reading.encounter.hypertension_symptoms` | yes_no | local | yes | always | Read by categorize_screening, route_first_visit, resume_screening_reading. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Evidence of organ damage | `reading.encounter.organ_damage_evidence` | yes_no | local | yes | always | Read by categorize_screening, route_first_visit, resume_screening_reading. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Care level of this facility | `reading.encounter.care_level` | one of health_center, medicalized_health_center, district_hospital, provincial_hospital, level_2_teaching_hospital, referral_hospital, university_teaching_hospital | local | yes | always | Read by start_hc_workup. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Currently pregnant | `reading.encounter.pregnant` | yes_no | CIEL:5272 | yes | always | Read by categorize_screening, route_first_visit, resume_screening_reading, select_fig9_band. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Diabetes | `reading.encounter.diabetes` | yes_no | local | yes | always | Read by select_fig9_band. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Coronary artery disease | `reading.encounter.coronary_artery_disease` | yes_no | local | yes | always | Read by select_fig9_band. "Not known" leaves it unknown; the protocol then asks for it. |
| Visit findings | Chronic kidney disease | `reading.encounter.chronic_kidney_disease` | yes_no | local | yes | always | Read by select_fig9_band. "Not known" leaves it unknown; the protocol then asks for it. |
| Also relevant | Weight (kg) | `extra.weight` | quantity (kg) | CIEL:5089 | no | always | Added by the hints file: RBCNCD24 PDF p.12, section I.B and Table 1: screen adults for obesity with BMI and waist circumference. No hypertension rule reads it. Decided by an agent, sign-off pending. |
| Also relevant | Height (cm) | `extra.height` | quantity (cm) | CIEL:5090 | no | always | Added by the hints file: RBCNCD24 PDF p.12, Table 1: BMI needs height. No hypertension rule reads it. Decided by an agent, sign-off pending. |
| Also relevant | Waist circumference (cm) | `extra.waist` | quantity (cm) | CIEL:163080 | no | always | Added by the hints file: RBCNCD24 PDF p.12, Table 1: waist circumference marks risk even at normal weight. No hypertension rule reads it. Decided by an agent, sign-off pending. |

Can start: `htn_screening_assessment`, `htn_longitudinal_care`.

### update_encounter

**Update visit findings** (update `undefined`). Encounter type "Nexo Update visit findings".

Evidence: A new revision of this visit findings. The protocol reads the fields it named as missing.

Filled by the host: `encounter.patient` ← new object `previous.patient`.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Visit findings | Symptoms of hypertension | `encounter.hypertension_symptoms` | yes_no | local | no | always | Read by categorize_screening, route_first_visit, resume_screening_reading. Required when the protocol names it as missing. |
| Visit findings | Evidence of organ damage | `encounter.organ_damage_evidence` | yes_no | local | no | always | Read by categorize_screening, route_first_visit, resume_screening_reading. Required when the protocol names it as missing. |
| Visit findings | Care level of this facility | `encounter.care_level` | one of health_center, medicalized_health_center, district_hospital, provincial_hospital, level_2_teaching_hospital, referral_hospital, university_teaching_hospital | local | no | always | Read by start_hc_workup. Required when the protocol names it as missing. |
| Visit findings | Currently pregnant | `encounter.pregnant` | yes_no | CIEL:5272 | no | always | Read by categorize_screening, route_first_visit, resume_screening_reading, select_fig9_band. Required when the protocol names it as missing. |
| Visit findings | Diabetes | `encounter.diabetes` | yes_no | local | no | always | Read by select_fig9_band. Required when the protocol names it as missing. |
| Visit findings | Coronary artery disease | `encounter.coronary_artery_disease` | yes_no | local | no | always | Read by select_fig9_band. Required when the protocol names it as missing. |
| Visit findings | Chronic kidney disease | `encounter.chronic_kidney_disease` | yes_no | local | no | always | Read by select_fig9_band. Required when the protocol names it as missing. |

### update_htn_assessment

**Update assessment** (update `undefined`). Encounter type "Nexo Update assessment".

Evidence: A new revision of this assessment. The protocol reads the fields it named as missing.

Filled by the host: `htn_assessment.patient` ← new object `previous.patient`; `htn_assessment.reading` ← new object `previous.reading`; `htn_assessment.time` ← new object `previous.time`.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Assessment | CKD stage | `htn_assessment.ckd_stage` | one of stage_1_3, stage_4_5 | local | no | always | Read by review_htn_assessment. Required when the protocol names it as missing. |
| Assessment | Hypertension confirmed | `htn_assessment.confirmed_htn` | yes_no | local | no | always | Read by review_htn_assessment. Required when the protocol names it as missing. |
| Assessment | Currently pregnant | `htn_assessment.pregnant` | yes_no | CIEL:5272 | no | always | Read by review_htn_assessment. Required when the protocol names it as missing. |
| Assessment | Symptoms of hypertension | `htn_assessment.symptoms` | yes_no | local | no | always | Read by review_htn_assessment. Required when the protocol names it as missing. |
| Assessment | Evidence of organ damage | `htn_assessment.organ_damage` | yes_no | local | no | always | Read by review_htn_assessment. Required when the protocol names it as missing. |
| Assessment | New clinical concern | `htn_assessment.new_concern` | yes_no | local | no | always | Read by review_htn_assessment. Required when the protocol names it as missing. |
| Assessment | Diabetes | `htn_assessment.diabetes` | yes_no | local | no | always | Read by review_htn_assessment. Required when the protocol names it as missing. |
| Assessment | Coronary artery disease | `htn_assessment.cad` | yes_no | local | no | always | Read by review_htn_assessment. Required when the protocol names it as missing. |
| Assessment | Chronic kidney disease | `htn_assessment.ckd` | yes_no | local | no | always | Read by review_htn_assessment. Required when the protocol names it as missing. |
| Assessment | Renal function reviewed | `htn_assessment.renal_reviewed` | yes_no | local | no | always | Read by review_htn_assessment. Required when the protocol names it as missing. |
| Assessment | Contraindications reviewed | `htn_assessment.contraindications_reviewed` | yes_no | local | no | always | Read by review_htn_assessment. Required when the protocol names it as missing. |
| Assessment | Current medicines reviewed | `htn_assessment.medication_reviewed` | yes_no | local | no | always | Read by review_htn_assessment. Required when the protocol names it as missing. |
| Assessment | Adherence reviewed | `htn_assessment.adherence_reviewed` | yes_no | local | no | always | Read by review_htn_assessment. Required when the protocol names it as missing. |
| Assessment | Adverse effects of medicines | `htn_assessment.adverse_effects` | yes_no | local | no | always | Read by review_htn_assessment. Required when the protocol names it as missing. |
| Assessment | Patient tolerates the BP target | `htn_assessment.target_tolerated` | yes_no | local | no | always | Read by review_htn_assessment, authorize_htn_prescription, authorize_htn_first_prescription. Required when the protocol names it as missing. |
| Assessment | Specialist care required | `htn_assessment.specialist_required` | yes_no | local | no | always | Read by review_htn_assessment. Required when the protocol names it as missing. |
| Assessment | Current antihypertensive regimen | `htn_assessment.current_regimen` | one of htn_prescription, htn_no_regimen_attestation | local | no | always | Select the object evidence for this field. |

### update_htn_external_work

**Update accepted next care** (update `undefined`). Encounter type "Nexo Update accepted next care".

Evidence: A new revision of this accepted next care. The protocol reads the fields it named as missing.

Filled by the host: `htn_external_work.patient` ← new object `previous.patient`; `htn_external_work.owner` ← new object `previous.owner`.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Accepted next care | Receiving service | `htn_external_work.destination` | identifier | local | yes | always | Every revision of the accepted next care has it. Read by accept_owned_handover. |
| Accepted next care | Type of next care | `htn_external_work.kind` | one of clinical_assessment, medicine_supply, diagnostic_assessment, maternal_assessment, child_assessment | local | yes | always | Every revision of the accepted next care has it. Read by accept_owned_handover. |
| Accepted next care | Status of next care | `htn_external_work.status` | one of accepted, planned | local | yes | always | Every revision of the accepted next care has it. Read by accept_owned_handover. |
| Accepted next care | Next care due | `htn_external_work.due_at` | instant | local | yes | always | Every revision of the accepted next care has it. Read by accept_owned_handover. |

### update_htn_no_regimen_attestation

**Update no current antihypertensive attestation** (update `undefined`). Encounter type "Nexo Update no current antihypertensive attestat…".

Evidence: A new revision of this no current antihypertensive attestation. The protocol reads the fields it named as missing.

Filled by the host: `htn_no_regimen_attestation.patient` ← new object `previous.patient`; `htn_no_regimen_attestation.attested_by` ← new object `previous.attested_by`; `htn_no_regimen_attestation.time` ← new object `previous.time`.

No questions: completing the task is the evidence.

### update_htn_prescription

**Update hypertension prescription** (update `undefined`). Encounter type "Nexo Update hypertension prescription".

Evidence: A new revision of this hypertension prescription. The protocol reads the fields it named as missing.

Filled by the host: `htn_prescription.patient` ← new object `previous.patient`; `htn_prescription.prescriber` ← new object `previous.prescriber`.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Hypertension prescription | Medicine | `htn_prescription.medicine` | one of amlodipine, hydrochlorothiazide, indapamide_sr, enalapril, lisinopril | local | yes | always | Every revision of the hypertension prescription has it. Read by authorize_htn_prescription. |
| Hypertension prescription | Dose | `htn_prescription.dose` | quantity (mg) | local | yes | always | Every revision of the hypertension prescription has it. Read by authorize_htn_prescription. |
| Hypertension prescription | Second medicine | `htn_prescription.second_medicine` | one of none, amlodipine, hydrochlorothiazide, indapamide_sr | local | yes | always | Every revision of the hypertension prescription has it. Read by authorize_htn_prescription. |
| Hypertension prescription | Second medicine dose | `htn_prescription.second_dose` | quantity (mg) | local | no | always | Read by authorize_htn_prescription. Required when the protocol names it as missing. |
| Hypertension prescription | Prescription valid until | `htn_prescription.valid_until` | instant | local | yes | always | Every revision of the hypertension prescription has it. Read by authorize_htn_prescription. |
| Hypertension prescription | Prescription status | `htn_prescription.status` | one of active, stopped | local | yes | always | Every revision of the hypertension prescription has it. Read by authorize_htn_prescription. |

### update_htn_receipt

**Update receipt** (update `undefined`). Encounter type "Nexo Update receipt".

Evidence: A new revision of this receipt. The protocol reads the fields it named as missing.

Filled by the host: `htn_receipt.patient` ← new object `previous.patient`; `htn_receipt.prescription` ← new object `previous.prescription`; `htn_receipt.dispensing` ← new object `previous.dispensing`; `htn_receipt.time` ← new object `previous.time`.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Receipt | Patient received the medicines | `htn_receipt.received` | yes_no | local | yes | always | Every revision of the receipt has it. Read by verify_htn_receipt. |
| Receipt | How receipt was confirmed | `htn_receipt.proof` | text | local | yes | always | Every revision of the receipt has it. Read by verify_htn_receipt. |

### update_htn_supply

**Update dispensing** (update `undefined`). Encounter type "Nexo Update dispensing".

Evidence: A new revision of this dispensing. The protocol reads the fields it named as missing.

Filled by the host: `htn_supply.patient` ← new object `previous.patient`; `htn_supply.prescription` ← new object `previous.prescription`; `htn_supply.time` ← new object `previous.time`.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dispensing | Medicine | `htn_supply.medicine` | one of amlodipine, hydrochlorothiazide, indapamide_sr, enalapril, lisinopril | local | yes | always | Every revision of the dispensing has it. Read by verify_htn_dispensing. |
| Dispensing | Dose | `htn_supply.dose` | quantity (mg) | local | yes | always | Every revision of the dispensing has it. Read by verify_htn_dispensing. |
| Dispensing | Second medicine | `htn_supply.second_medicine` | one of none, amlodipine, hydrochlorothiazide, indapamide_sr | local | yes | always | Every revision of the dispensing has it. Read by verify_htn_dispensing. |
| Dispensing | Second medicine dose | `htn_supply.second_dose` | quantity (mg) | local | no | always | Read by verify_htn_dispensing. Required when the protocol names it as missing. |
| Dispensing | Medicine in stock | `htn_supply.stock_available` | yes_no | local | no | always | Read by verify_htn_dispensing. Required when the protocol names it as missing. |
| Dispensing | Supply packed for the patient | `htn_supply.packed` | yes_no | local | no | always | Read by verify_htn_dispensing. Required when the protocol names it as missing. |
| Dispensing | Supply lasts until | `htn_supply.coverage_until` | instant | local | no | always | Read by verify_htn_dispensing. Required when the protocol names it as missing. |

### update_laboratory_result

**Update laboratory result** (update `undefined`). Encounter type "Nexo Update laboratory result".

Evidence: A new revision of this laboratory result. The protocol reads the fields it named as missing.

Filled by the host: `laboratory_result.patient` ← new object `previous.patient`.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Laboratory result | Serum potassium | `laboratory_result.potassium` | quantity (mmol/L) | CIEL:1133 | no | always | Read by authorize_htn_prescription, authorize_htn_first_prescription. Required when the protocol names it as missing. |

### update_observation

**Update blood-pressure reading** (update `undefined`). Encounter type "Nexo Update blood-pressure reading".

Evidence: A new revision of this blood-pressure reading. The protocol reads the fields it named as missing.

Filled by the host: `observation.patient` ← new object `previous.patient`; `observation.encounter` ← new object `previous.encounter`; `observation.time` ← new object `previous.time`.

| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Blood-pressure reading | Systolic BP | `observation.systolic` | quantity (mm[Hg]) | CIEL:5085 | yes | always | Every revision of the blood-pressure reading has it. Read by categorize_screening, route_first_visit, resume_screening_reading, select_fig9_band, review_htn_assessment, authorize_htn_prescription, authorize_htn_first_prescription. |
| Blood-pressure reading | Diastolic BP | `observation.diastolic` | quantity (mm[Hg]) | CIEL:5086 | yes | always | Every revision of the blood-pressure reading has it. Read by categorize_screening, route_first_visit, resume_screening_reading, select_fig9_band, review_htn_assessment, authorize_htn_prescription, authorize_htn_first_prescription. |
| Blood-pressure reading | Where was BP measured | `observation.setting` | one of office, home, ambulatory | local | yes | always | Every revision of the blood-pressure reading has it. Read by categorize_screening, resume_screening_reading, review_htn_assessment. |
