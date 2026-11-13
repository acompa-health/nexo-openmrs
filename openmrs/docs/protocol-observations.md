# What building the forms showed about the protocol

To build each form, the compiler works out, for every question, whether any answer can change what happens next.
That work also finds places where the protocol does something a form designer would question.

These notes are for the author of `rwanda.htn_screening_assessment_2024`, national facility version `1.0`. They are not
clinical decisions. The forms do not work around them: each form asks what the protocol needs.

Each note gives what the form does, the rule in plain words, why, and the change we propose. The proposed protocol
and language changes are in [I#324, protocol and language changes](https://github.com/acompa-health/abrazos-v2/issues/324).

## 1. A man is asked whether he is pregnant

- **What the form does.** The screening reading asks every adult "Currently pregnant", men too. If the answer is
  left blank, the protocol stops and opens "Collect the named missing information" for pregnancy. A clinician
  answers "No".
- **The rule in plain words.** Every screening rule starts with "the patient is not pregnant". None of them looks
  at the patient's sex. The medicine-choice rules already do it right: "male, or not pregnant".
- **Why.** Nothing says once, for all protocols, that pregnancy applies only to women. So each rule must say it,
  and the screening rules do not.
- **Change.** State once, in the shared term list, that pregnancy applies only to women. The engine then treats a
  man as not pregnant, and the form does not ask him.

## 2. "Refer" still needs a medicine, a dose and a date

- **What the form does.** The prescription form offers four choices: start, renew, change, or refer for an
  individual plan. After "refer", the form still requires a medicine, a dose, a second medicine and a valid-until
  date.
- **The rule in plain words.** The protocol's prescription task declares those fields required for every choice.
  The rule for "refer" uses none of them.
- **Why.** The protocol puts the choice "prescribe or refer?" and the prescription details in one task. The
  compiler makes one form per task, so they share a form.
- **Change.** Ask "prescribe or refer?" before the details, and ask the details only when the clinician
  prescribes. The assessment already asks "Specialist care required", which also hands the patient over. Check
  whether the prescription step needs a second way to refer.
- **The same problem in two more tasks.** The compiler now checks each answer of each choice (form design rule A3).
  It finds two more places where the task requires answers that no rule reads:
  - Dispensing: when "Medicine in stock" or "Supply packed for the patient" is "No", no rule reads the medicine,
    the dose or the second medicine. The pharmacy worker must still enter them.
  - The handover: when the receiving service does not accept the patient, no rule reads the receiving service or
    the status of the next care. When the status is "planned", no rule reads the service or the acceptance.

## 3. The CKD stage is asked but changes nothing (a known limitation)

- **What the form does.** The assessment used to ask the chronic kidney disease (CKD) stage, although no answer
  changes the next step. The form no longer asks it (form design rule A5), and the report lists it for the author.
- **The rule in plain words.** With CKD, an earlier rule sends the patient to advanced care, at any stage. Without
  CKD, there is no stage. The two rules that look at the stage come later, so they never see a patient with CKD.
- **Why.** Figure 9 of the guideline says "CCB or Thiazide in case of comorbidities (diabetes, CAD, CKD stage
  1-3)", so the stage is part of the guidance. The protocol does not yet encode the guideline's chapter on
  hypertension with CKD (RBCNCD24 p.73), so it refers every CKD patient. It records that gap as
  `gap_p53_p73_comorbid_regimen`.
- **Change.** Keep this as a limitation that the CKD chapter work picks up. Remove the question until then. When
  that chapter is encoded, the stage changes treatment and the question comes back.

## 4. One rule holds 26 checks, so the form cannot group its questions

- **What the form does.** The assessment was one flat list of 16 questions. The form designer now finds the groups
  from the rules that end the path, and gives each its own section: danger signs, reasons for other care,
  conditions that change the medicines, and diagnosis, then the review checklist. The headings are agent proposals
  in the layout decisions file, because the protocol has no names for the groups.
- **The rule in plain words.** The rule that sends a patient on to the prescription is one sentence of 26 checks
  joined by "and":
  - an adult who is not pregnant (a twin rule covers age exactly 65, where the BP target changes);
  - an office reading with real numbers, and hypertension confirmed;
  - no danger signs: no symptoms, no organ damage;
  - no reason for other care: no new concern, no side effects, no specialist needed, no CKD, no diabetes;
  - four review boxes ticked: medicines, adherence, kidney function, and reasons not to give a medicine;
  - coronary artery disease and "tolerates the target" answered (any answer is accepted);
  - five clock checks: the assessment came after the reading and after the request.
- **Why.** The protocol has no names for these groups, so the rule lists every check. The three rules before it
  list the same groups again, turned around: danger signs go to urgent care, and reasons for other care go to a
  handover. The compiler sees one long sentence and cannot tell which questions belong together.
- **Change.** Name each group once in the protocol, for example "danger signs", "reasons for other care" and
  "review checklist", and use the names in the rules. The rules get short, the copies cannot drift apart, and the
  form takes each heading from the protocol instead of the layout decisions file.

## 5. One fact has two names

- **What the form does.** Nothing visible. The hints file must give both names the same label.
- **The rule in plain words.** The visit record says `coronary_artery_disease`, and the assessment says `cad` for
  the same fact. The same happens with `chronic_kidney_disease` and `ckd`, `hypertension_symptoms` and `symptoms`,
  `organ_damage_evidence` and `organ_damage`, and `bp.systolic` and `sbp`.
- **Why.** Nexo v1 has no place to say "this field is shared term X". Of the 97 names the rules use, 6 match the
  shared term list of this repository ([`core/vocabulary/concepts`](../../core/vocabulary/concepts/README.md)). That list forbids abbreviations and lists `cad` as
  an old name for `coronary_artery_disease`.
- **Change.** Use the shared names, and tag each clinical field with its term. Then the label, unit, answers and
  CIEL code come from the term list, not from the hints file.

## 6. Page references in task names

- **What the form does.** The worklist and the form title show, for example, "Repeat office BP visit within four
  weeks (RBCNCD24 PDF p.12 Fig. 2 and PDF p.24)". OpenMRS limits encounter type names to 50 characters, so the
  compiler drops the part in brackets there.
- **Change.** Keep task names short. Put the page references in the evidence.

## 7. Medicine and laboratory orders are protocol tasks, not OpenMRS orders

- **What the form does.** The worklist shows medicine and laboratory orders as protocol work. Potassium is typed
  into the prescription form, because the rules read it from the prescription decision.
- **Why.** The protocol keeps its own orders. This version does not use the OpenMRS apps for orders, laboratory,
  dispensing and stock, although the server has them.
- **Change.** This is an OpenMRS integration step, not a protocol change. Turn protocol orders into OpenMRS drug
  and laboratory orders, and read the results back.

## Smaller notes for the author

- **Checks that accept any answer.** The assessment tests "coronary artery disease is yes or no" and "tolerates the
  target is yes or no". Each forces an answer, but no answer changes this step.
  - "Tolerates the target" is used later: the prescription step reads it. Say that directly, for example as part of
    a named group.
  - Coronary artery disease is asked a second time. The medicine choice uses the answer from the blood-pressure
    reading's visit findings (`coronary_artery_disease`). No step reads the assessment's own answer (`cad`). This
    comes from note 5: two names for one fact became two questions. Ask it once. Until then the form asks it last
    in the review checklist.
  - The overdue-contact task tests "the patient was contacted, yes or no". Both answers record the contact.
- **Record checks inside clinical rules.** "Same patient, same reading, times in order" is repeated in several
  clinical rules. State it once, for the data.
- **Evidence cites PDF pages, not snippets.** None of the 69 evidence entries names a snippet, although snippets
  exist for the same figures, for example `rbcncd24-fig9-htn-algorithm`.
- **Dense notes.** Some SOP notes are one paragraph of about 400 words. They need a plain rewrite.

The compiler finds notes 2 and 3 and the checks that accept any answer again on each run. See "For the protocol
author" at the top of [`protocols/rwanda-htn/build/report.md`](../protocols/rwanda-htn/build/report.md).
