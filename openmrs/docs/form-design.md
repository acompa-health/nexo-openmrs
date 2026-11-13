# Form design rules

Status: working rules, 8 November 2026. Written by Claude (agent) for Kuang and Brian.

The compiler turns each protocol task into one OpenMRS 3 (O3) form. These rules decide how a form asks for the
facts that the protocol needs: the sections, the order, the control, the words, the ⓘ and the required marks. The
rules come from the form design research of 8 November 2026 (30 rules). Kuang approved building them into the
compiler and the skill on 8 November 2026. This file keeps the rules that the compiler applies now, and the rules
that are planned.

Each rule has four parts:

- **Rule.** What the form does.
- **Decide from.** The protocol data that the compiler or an agent uses.
- **O3.** The O3 form schema property, or "not supported in O3".
- **Source.** A link. Text in quotation marks is exact text from that page. "Our choice" marks a decision that no
  source makes.

Each rule also has a status: **built** (the compiler applies it and a test checks it), **already true** (the
compiler did this before), or **planned**.

## Kuang's decisions (8 November 2026)

1. **Every question carries a reason.** During construction and review, the full reason shows on the page (the
   review build, rule D4). In production, only a small ⓘ shows, and only when a trained clinician may ask "why is
   this asked now?" (rule D3). An obvious question gets no ⓘ.
2. **Ask only what someone uses, and name that user.** The user is a rule in this protocol, a rule in another
   protocol, a required report, or a person who reads the answer later. Show "nice to know" information. Do not ask
   for it (rule A5).
3. **Do not make people retype what the system knows.** Show it, and ask for confirmation when it can change
   (rules A5 and G2).
4. **Record each agent choice so that a person can revisit it:** who decided (agent or Kuang), why, and the status
   ("review pending" or "accepted"). The layout decisions file does this (section 3).

## 0. Inputs and limits

### 0.1 What the compiler reads from the rules

| Signal | What it is | Where |
| --- | --- | --- |
| Type, answers, unit | `yes_no`, `listed` with its values, `quantity` with its unit, `date`, `instant`, `text` | the catalog and the task result |
| Mandatory | The task or catalog declares the field required. Core refuses a completion without it | `QuestionBinding.mandatory` |
| Decision read | A table that hears this step reads the field with `required: "decision"` | `QuestionBinding.required` |
| Gate | The answers that every rule that reads the field tests first. The field hides until they hold | `hide`, `gates`, `shownWhen` |
| **Row outcome** | For each row of a table that hears the form: its order (rank, then table order), and whether it ends the path, continues to a state, or repeats the step | `signals.ts`, `rowOutcome` |
| **Test shape** | How a row and its effect conditions test a question: as one term of an "or" (one answer is enough), as one term of an "and" (all must hold), or with every possible answer (`cad == yes or cad == no`) | `signals.ts`, `rowSignals` |
| **Stop question** | A question whose one answer, with facts that the form does not ask, can select a row. Questions that an earlier stop row took count as settled. A test that accepts every answer is never a stop | `signals.ts`, `satisfiedBy` |
| **Branch reads** | For each answer of a choice, the questions that a rule can still read | `signals.ts`, `branchReads` |

The report (`protocols/<name>/build/report.md`) shows the section of each question and the stop row that makes it.

### 0.2 What the O3 form engine can do

We checked the engine source, `openmrs-esm-form-engine-lib` at commit
[`ac999ee`](https://github.com/openmrs/openmrs-esm-form-engine-lib/tree/ac999ee75f0e7cee0e41630d3a86c72be1204b5a).
O3 3.8.0, the local test bed, uses this version. The target server, the PIH EMR (image
`partnersinhealth/pihsl-emr:1.60.0`), has the O3 patient chart and form engine 13.0.2-pre.12837 (a pre-release of 13.0.2). Nobody has checked the points
below against that version yet.

- **One column.** A section stacks its questions. Two fields side by side: not supported in O3.
- **Pages are not screens.** All pages show on one scrolling form. O3 has no "one question per screen" mode. The
  guided flow is one level up: the care pathway opens one short form for each task.
- **Sections** are accordion items. `isExpanded: "false"` declares a closed section. The current O3 renderer ignores it
  ([upstream finding](o3-walkthrough.md#section-expansion)).
- **`hide.hideWhenExpression`** works on a section, a question and an answer. The engine does not validate a hidden
  field.
- **`questionInfo`** adds an ⓘ with a hover tooltip. The icon is `aria-hidden`.
- **`required: true`** shows a red asterisk. The engine has no "(optional)" marker.
- **Renderings:** `radio` (with `orientation`), `select` (a dropdown), `checkbox`, `ui-select-extended` (a search
  box), `number` (with `hideSteppers`), `date`, `datetime`, `textarea`, `markdown` (text that saves nothing).

## 1. The rules

### (a) Split a task into steps, and ask only what a rule uses

**A1. One step holds one decision.** Planned.
- **Rule.** A form holds one protocol decision and the facts that it reads. Split a task when two roles fill it, a
  part waits for a later result, or it holds two decisions.
- **Decide from.** The performer role, the consuming tables, the result fields.
- **O3.** One form per step. The care pathway opens the next form.
- **Source.** GOV.UK Service Manual, "Structuring forms": "Start by splitting the form across multiple pages with each
  page containing just one thing". <https://www.gov.uk/service-manual/design/form-structure>

**A2. Decide before detail.** Built for the order. The hiding waits for a protocol change.
- **Rule.** Ask first the choice that picks the branch. Show the fields of a branch only after the person picks it.
- **Decide from.** A coded field that gates other fields. Today a field that the task declares mandatory never
  hides, because Core refuses a completion without it.
- **O3.** Question order; `hide.hideWhenExpression`.
- **Source.** NHS service manual: "Filter questions help you route people to the questions that apply to them, so use
  them early on."
  <https://service-manual.nhs.uk/content/how-to-write-good-questions-for-forms/get-the-questions-into-order>

**A3. A branch never asks for the fields of another branch.** Built as a report.
- **Rule.** When the task requires a field but no rule reads it after one answer of a choice, report it to the
  protocol author. Propose one of two fixes: make the field optional and gate it, or split the task. Never hide a
  field that the task requires.
- **Decide from.** Branch reads. For each mandatory field and each answer of a choice: does a rule read it?
- **O3.** None until the protocol changes. Then `hide.hideWhenExpression` (rule A2).
- **Example.** After "Refer for an individual plan", no rule reads the medicine, the dose, the second medicine or the
  validity. The prescription form still asks them, and the report says so.
- **Source.** NHS service manual: "If you do not know how you'll use an answer, find out or remove the question."
  <https://service-manual.nhs.uk/content/how-to-write-good-questions-for-forms/make-sure-you-need-each-question>

**A4. Stop early.** Built for the order. The outcome line and the hiding are planned.
- **Rule.** Put first the questions whose answer alone can end the step. Planned: when a person gives such an answer,
  show one line that says what happens next, and hide the questions that no rule reads on that path.
- **Decide from.** Stop questions, in row order (the tables use `hit: "priority"`: the first row that matches wins).
- **O3.** Section and question order. Planned: a `markdown` question with its own `hide` for the outcome line.
- **Example.** In dispensing, "Medicine in stock" and "Supply packed for the patient" now come first.
- **Source.** IRS Direct File puts "knockout" screens in its interview:
  [`AboutYouSubcategory.tsx`](https://github.com/IRS-Public/direct-file/blob/e365f9f43446010af36cccf7edecc52953c00fe9/direct-file/df-client/df-client-app/src/flow/flow-chunks/you-and-your-family/AboutYouSubcategory.tsx#L167)

**A5. Ask only what a rule uses. Do not ask what the system knows.** Built.
- **Rule.** Ask a question only when a rule reads it, or a cited source asks for it. Do not ask for facts that the
  host has (the patient, the time, the person, the reading in the task).
- **Decide from.**
  - An optional question that no rule reads, or whose every read other answers already settle: do not ask it.
    Report it. (Today: the CKD stage in the assessment.)
  - A required question whose every test accepts any answer, and that no later step reads: keep it, report it, and
    put it last in its section. (Today: the assessment's coronary artery disease, and "Patient contacted".)
  - A field that the task requires but no rule reads: keep it, because Core refuses the step without it, and report
    it. (Today: none.)
  - An extra field from the hints file with a cited reason: keep it, optional, in a closed section at the end.
  - Host values (`HostFill`): never ask.
- **O3.** Leave the question out; section `isExpanded: "false"`.
- **Source.** GOV.UK Service Manual: "This list is called a 'question protocol' - it's different from the form itself
  because it's about how you'll use the answers." <https://www.gov.uk/service-manual/design/form-structure>

**A6. Group the questions for clinicians. Let the pathway be the wizard.** Already true.
- **Rule.** A clinician form shows the whole step on one page, in sections. The care pathway opens one short form at
  a time.
- **O3.** One page per form. One question per page: not supported in O3.
- **Source.** Nielsen Norman Group: "Use wizards for novice users or infrequent processes".
  <https://www.nngroup.com/articles/wizards/>

**A7. Show the outcome before the person saves.** Planned.
- **Rule.** End each step with the deciding answers and what the protocol will do next.
- **O3.** Not supported in the form engine. Build it in the Nexo care app, next to the form.
- **Source.** GOV.UK Design System, "Check answers". <https://design-system.service.gov.uk/patterns/check-answers/>

### (b) Order and group the questions

**B1. Group the questions by the outcome that they feed.** Built.
- **Rule.** The stop questions of one row make one section, in row order. A form of six questions or fewer stays in
  one section for each record: the stop rows only order it. The other questions keep the section of their record.
  A person gives each section a short clinical heading in the layout decisions file.
- **Decide from.** Stop questions and row order.
- **O3.** `sections[].label`; one section for each group.
- **Example.** The assessment: Danger signs, Reasons for other care, Conditions that change the medicines,
  Diagnosis, Review checklist.
- **Planned.** Split a section of more than six questions by body system. Join a section of one question to the
  next one.
- **Source.** Luke Wroblewski: groupings "cannot be arbitrary" and "should not exceed 5-6 items".
  <https://www.lukew.com/ff/155/web-application-form-design-expanded>

**B2. Order the groups: stop, choose, detail, check, explain.** Built.
- **Rule.** Stop sections first. Inside a section: the declared order, then questions whose answer changes nothing,
  then free text.
- **O3.** The order of `sections` and `questions`.
- **Source.** Nielsen Norman Group: "Stick to standard sequences both for fields".
  <https://www.nngroup.com/articles/web-form-design/>

**B3. Put a follow-up question directly after its trigger.** Built.
- **Rule.** A conditional question comes directly after the question that shows it, in the same section. When that
  question is a stop question, a follow-up of the stop answer moves next to it, but a question that waits for "no
  stop" (for example "Supply lasts until", which shows when stock and packing are yes) stays with the main questions.
- **Decide from.** `gates`: the last gate in form order is the trigger.
- **Example.** "Serum potassium" now comes directly after "Medicine".
- **Planned.** Report a chain of more than one level.
- **Source.** Luke Wroblewski: "Clearly associate additional inputs with their trigger".
  <https://static.lukew.com/webforms_lukew_082807.pdf>

**B4. Order the answers the clinical way.** Already true.
- **Rule.** Keep the protocol order of the answers. Put "Not known" last.
- **Source.** Nielsen Norman Group: "list the most common values first when possible."
  <https://www.nngroup.com/articles/web-form-design/>. Our choice: the protocol order.

### (c) Choose the control

**C1. Ask a yes/no finding with radio buttons.** Already true.
- **Rule.** "Yes", "No", and "Not known" when the protocol accepts an unknown answer. No single checkbox, no toggle.
- **O3.** `rendering: "radio"`.
- **Source.** Nielsen Norman Group, "Checkboxes vs. radio buttons".
  <https://www.nngroup.com/articles/checkboxes-vs-radio-buttons/>

**C2. One answer from a list: radios up to 5, a dropdown above.** Built (a search box above 15 is planned).
- **Rule.** Count "Not known" as an answer. 5 answers or fewer: radios. 6 to 15: a dropdown. More than 15: a search
  box. The layout decisions file may choose radios or a dropdown, with a reason.
- **O3.** `radio`; `select`; planned: `ui-select-extended`.
- **Example.** The prescription's medicine (5 answers) is now radios, so all medicines stay in view.
- **Source.** Nielsen Norman Group: "it's better to use a listbox or dropdown list when there are 5 or more items".
  <https://www.nngroup.com/articles/listbox-dropdown/>

**C3. Use checkboxes only for findings that can all be true at once.** Planned.
- **Rule.** One checkbox list with a last "none" answer, only when every finding has the same effect and "not
  ticked" safely means "no".
- **O3.** `rendering: "checkbox"` and a validator. It needs one O3 question for several Nexo fields.
- **Source.** GOV.UK Design System, "Checkboxes". <https://design-system.service.gov.uk/components/checkboxes/>

**C4. Type numbers. Choose a date or a date and time by meaning.** Built for numbers. Dates are planned.
- **Rule.** A measurement is a typed number with no stepper buttons. Planned: a date for a day (for example
  "Prescription valid until"), and a time only when a rule compares times shorter than one day.
- **O3.** `rendering: "number"`, and `hideSteppers: true` on the question (the engine does not read it in
  `questionOptions`).
- **Source.** Nielsen Norman Group: "Avoid steppers for continuous quantities."
  <https://www.nngroup.com/articles/input-steppers/>

**C5. Use free text only for an explanation.** Already true.
- **O3.** `rendering: "textarea"`.
- **Source.** WHO SMART Guidelines, decision tables. <https://smart.who.int/ig-starter-kit/l3_decisiontables.html>

### (d) Labels, help text and the ⓘ

**D1. Use the words of the clinic.** Built.
- **Rule.** Each label uses the term that local clinicians use. One term for one concept. Never show a builder word.
- **Decide from.** The hints file `labels`. A label that the compiler makes from a field name is a warning, once for
  each name, with every place it shows. A label that replaces authoring words of the protocol, such as a task title
  with a citation, has an entry in the hints file's `$labelDecisions` with `reason`, `decidedBy` and `status`, as in
  the layout decisions file. The compiler refuses an entry that names no label, and the report lists each one.
- **O3.** `label`; `answers[].label`.
- **Source.** NISTIR 7804-1 (p.40): "The language used should be task-oriented and familiar to users".
  <https://nvlpubs.nist.gov/nistpubs/ir/2015/NIST.IR.7804-1.pdf>

**D2. Show what the person needs to answer. Put only the reason in the ⓘ.** Partly planned.
- **Rule.** A unit, a threshold or a definition that a person needs goes in the label or a section line. The ⓘ holds
  only the reason. Planned: a one-line section introduction.
- **Source.** Nielsen Norman Group: "Don't use tooltips for information that is vital to task completion."
  <https://www.nngroup.com/articles/tooltip-guidelines/>

**D3. Add an ⓘ only when a clinician may ask "why is this asked here?".** Built.
- **Rule.** A question gets an ⓘ only from a decision in the layout decisions file. The compiler marks a candidate
  when the question shows after an earlier answer, or when a later step uses it. An agent or a person decides. The
  text is for a clinician: at most two short sentences, and the guideline reference. It never names a table. The
  compiler warns about a builder word or a third sentence.
- **O3.** `questionInfo`, in the production build only.
- **Example.** In the prescription, only "Serum potassium" has an ⓘ.
- **Source.** Luke Wroblewski: help is useful when "Users may question why data is being requested", and "Help &
  Tips can quickly overwhelm a form if overused". <https://static.lukew.com/webforms_lukew_082807.pdf>

**D4. Show the full reason during review. Show only the ⓘ in production.** Built.
- **Rule.** The compiler writes two builds. The review build shows, for each section, why its questions are
  together, and for each question: who uses the answer, why it is required, when it shows, how the rules use it, its
  production ⓘ, and any point for the protocol author. The production build shows only the ⓘ.
- **O3.** Review build: a `markdown` question at the top of each section and after each question. It saves nothing
  and hides with its question. O3 has no switch, so there are two builds (section 4).
- **Source.** XLSForm `guidance_hint`: "There is a special kind of hint that is normally not shown in the form."
  <https://xlsform.org/en/>

### (e) Required and optional

**E1. Mark each required field with the O3 asterisk.** Already true.
- **Rule.** A field is required when a rule on the current path needs it. A hidden field is not required.
- **O3.** `required: true`.
- **Source.** Nielsen Norman Group: "The solution is simple: mark all the required fields."
  <https://www.nngroup.com/articles/required-fields/>

**E2. Write "(optional)".** Built for the label. Fewer optional fields is planned.
- **Rule.** Each optional field says "(optional)" in its label. Planned: keep at most two optional fields in the
  open part of a form.
- **O3.** The label text; section `isExpanded: "false"` for extra fields (currently ignored by O3).
- **Source.** Luke Wroblewski: "Literally including the phrase "optional" after a label is much clearer than any
  visual symbol". <https://www.lukew.com/ff/725/marking-required-vs-optional-form-fields>

**E3. Offer "Not known" instead of a forced guess.** Already true.
- **O3.** A coded answer (CIEL 1067). Not `unspecified: true`.
- **Source.** GOV.UK Design System, "Question pages". <https://design-system.service.gov.uk/patterns/question-pages/>

### (f) Columns and orientation

**F1. Use one column.** Already true. Two fields side by side: not supported in O3.

**F2. Stack radio answers.** Built (vertical by default). Short answers in one row are planned.
- **Rule.** Radio answers stack, one on each line. The layout decisions file may set `orientation`. Planned, to test
  with clinicians: one row for up to three answers of 12 characters or fewer, when no follow-up depends on them.
- **O3.** `questionOptions.orientation`.
- **Source.** GOV.UK Design System, "Radios": "Only use inline radios when:" the question "only has two options".
  <https://design-system.service.gov.uk/components/radios/>

### (g) Prefill and (h) units and validation

**G1. Never prefill a decision or a finding of this visit.** Already true.
**G2. Carry over stable facts. Offer the last value of facts that change.** Carry-over is already true. "Reuse the
last value" is planned. Source: NHS service manual, "Make sure you need each question".

**H1. Put the unit in the label.** Already true.
**H2. Refuse impossible values. Warn about unusual values.** Planned (from the CIEL ranges).
**H3. Check an answer after the person gives it.** O3 fixes the timing. Test on a tablet.

### Completeness

**Every branch asks what its rules read.** Built as a test (`completeness.test.ts`).
- **Rule.** For every form and every run through its answers, each field that a rule reads with
  `required: "decision"` is asked and visible, filled by the host, or prefilled.
- **Engine check.** Hide conditions run in the OpenMRS expression evaluator after concept resolution and dropdown
  initialization. Answer positions count only concept answers. The "Choose an option" placeholder cannot shift them.
- **Limit.** The test reuses `readOccurrences` (reads.ts) to know when a rule reads a field. It does not prove the A5
  removals. If a removed field were needed, Core would open "Collect the named missing information".
- **Source.** IRS Direct File checks "that every possible run through the next screens" leaves the needed facts
  complete:
  [`checkFlowSetsFacts.ts`](https://github.com/IRS-Public/direct-file/blob/e365f9f43446010af36cccf7edecc52953c00fe9/direct-file/df-client/df-client-app/src/test/completenessTests/checkFlowSetsFacts.ts)

## 2. Where the sources disagree, and the choice

| Point | Choice |
| --- | --- |
| Asterisks (NN/g: mark required; GOV.UK and NHS: never) | Keep the O3 asterisk (E1). Also write "(optional)" (E2) |
| Tooltips (NN/g: not for vital information; NHS: do not use) | ⓘ only for the reason (D2, D3). Test on a tablet |
| Default radio answer | None on clinical answers (G1) |
| Answer order (GOV.UK: alphabetical; NN/g: most common first) | The protocol order (B4) |
| Inline radios | Vertical (F2). One row for short answers only after a clinician test |
| One question per page | Grouped for clinicians (A6) |

## 3. The layout decisions file

`protocols/<name>/forms.layout.json` holds the decisions that differ from the computed default. The compiler
derives every section, its members and the order. The file only names and adjusts.

```json
{
  "htn_prescription_review": {
    "groups": {
      "refer_for_individual_plan": { "label": "Prescribe or refer",
        "reason": "B1, A2: the decision comes before the details.", "decidedBy": "agent", "status": "review pending" }
    },
    "fields": {
      "potassium_result.potassium": { "info": "Asked because enalapril and lisinopril need a potassium result for this patient (RBCNCD24 PDF p.27, Fig. 9).",
        "reason": "D3 (1): it shows only after an ACE inhibitor is chosen.", "decidedBy": "agent", "status": "review pending" }
    }
  }
}
```

- A form is named as in the report: the template ID, `event_<type>`, or `update_<object>`.
- `groups` names a section by the ID that the report shows: the stop row, or the record path (`decision` for the
  task's own fields). It may set `label` only.
- `fields` names a question by its Nexo path. It may set `info` (the ⓘ text, or `"none"`), `control` (`radio` or
  `dropdown`, coded questions only) and `orientation` (`vertical` or `horizontal`).
- Each entry must have `reason`, `decidedBy` (`agent` or `Kuang`) and `status` (`review pending` or `accepted`).
- The compiler refuses any other key. The file never sets required, never hides a question and never changes a rule.
  The hints file keeps its own contract (labels, concepts, host values, extra fields).
- A name that matches no form, section or question is a warning.
- Clinical wording (headings and ⓘ text) needs clinician sign-off before production.

## 4. The review build

`bun run compile` writes the production forms (`build/o3/forms/`, `build/initializer/`) and the review build
(`build/o3-review/ampathforms/`). The review forms have the same names and UUIDs, so they replace the production
forms on a review server. From `openmrs/`:

```sh
docker-compose -p nexo-o3 -f distro/docker-compose.yml -f distro/docker-compose.nexo.yml \
  -f distro/docker-compose.review.yml up -d backend
```

To go back, run the same command without `docker-compose.review.yml`.

## 5. Points for the protocol author

The forms ask what the protocol needs. The compiler does not work around a protocol problem. It lists each one in
the report under "For the protocol author", and the compile command prints them. They are not warnings, because the
form builder cannot fix them in the hints or the layout file. See
[the protocol observations](protocol-observations.md).

Production and review **About this step** show the title, role, draft notice and the task's `completion.evidence`.
This mixed field includes clinical warnings, so the generator keeps it visible until the protocol owner rewrites it. Update forms use the same "(optional)" suffix as task and event forms.
