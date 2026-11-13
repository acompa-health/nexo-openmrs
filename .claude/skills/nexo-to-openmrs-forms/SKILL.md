---
name: nexo-to-openmrs-forms
description: Use when a Nexo v1 protocol (abrazos.protocol/v1 document plus its catalog) must become OpenMRS 3 forms, or when generated forms need labels, CIEL concepts, a reviewed extra field, section headings or ⓘ text. Covers building the bundle, compiling the forms, reading the mapping report, writing the hints file and the layout decisions file, reviewing the review build, installing into an O3 server, and walking a synthetic patient through the path.
---

# Nexo protocol → OpenMRS 3 forms

The protocol already says who does each step, what each step must record, which facts each decision reads,
and what happens when a fact is missing. The compiler turns that into O3 forms, and its form designer groups and
orders the questions from the rule tables. Your job is not to design forms by hand. Your job is to (1) build and
compile, (2) read the report like a reviewer, (3) write a small hints file for words and codes, (4) record the few
layout decisions the rules cannot make, and (5) prove the path in a running O3.

The code is in [`openmrs/`](../../../openmrs/README.md). Run every command below from `openmrs/`. Core is
`../core`, the Core of this repository.

## Rules

- **Never write a form by hand.** If a generated form is wrong, find the reason in the report. Either the
  hints are missing a label or concept, or the protocol itself says something odd. Report protocol problems
  to the protocol author. Do not hide them with hints.
- **Hints may do four things only:** rename (`labels`, `encounterTypes`, `units`; `title:<template>` renames a
  task, `value:<word>` an answer), bind CIEL concepts (`concepts`, `values`), say how the host supplies values a
  person should not retype (`existing`: an object looked up or attested from the protocol's own order;
  `carryOver`: stable facts such as comorbidities that prefill from the last visit; `roles`: who records events),
  and add a field with a written reason (`extra`). Hints never set `required`, never hide a field, and never add
  logic. Never carry over a finding of this visit or a decision. The ⓘ text is not a hint: it is a layout decision.
- **An extra field is a clinical choice.** Add one only when a source you can cite asks for it. Write the
  source, page, and "Decided by an agent, sign-off pending" in its `reason`. No rule reads an extra field.
- **Synthetic patients only.** The generated content inherits the protocol's status. Show the draft banner.

## Steps

1. **Build the bundle.** Each protocol folder has a `build.ts` that prepares the document with Nexo Core and
   checks its pinned content identity. Run `bun protocols/<name>/build.ts`. A changed identity is a stop: the
   protocol changed, and its review must be repeated.

2. **Compile.** `bun packages/nexo-forms/src/cli.ts protocols/<name>`. It writes `build/o3/forms/`,
   `build/o3-review/` (the review build), `build/binding.json`, `build/initializer/`, `build/ciel.json` and
   `build/report.md`. Zero warnings is the goal. "For the protocol author" lines are not warnings: send them on.

3. **Read `build/report.md` as a reviewer.** For each form check:
   - *Title and performer.* They come from the work template. A long title gets a short label in `labels`, with
     the key `title:<template>`. The form, the task card and the history then show it.
   - *Prefilled from the task.* These keys show above the form at run time. Each needs a readable label.
   - *Filled by the host.* Patient, times, references to the task's objects. Check that nothing a person
     must judge is filled by the host.
   - *Questions.* Each row gives the section, which tables read the field (`Why`) and when it shows (`Shown when`).
     The form does not ask an optional field that no rule reads, or whose every read other answers already settle;
     the report lists it under "For the protocol author", because it may be a gap in the rules.
   - *Conditional fields.* A field hides only when every rule that reads it first tests another answer on the
     same form, for example potassium only for enalapril or lisinopril. A condition with more than two
     questions makes the field optional instead. Read each "Shown when" aloud; it must make clinical sense.
   - *Forms with no questions.* Completing the task is the evidence ("Mark as done"), or a recorded event
     (for example a reading) moves the case on. Check that this matches the template's evidence text.

4. **Write `protocols/<name>/forms.hints.json`.**
   - `labels`: plain clinical words for field names, listed values, roles and object types. Use one term per
     concept across all forms.
   - `concepts` / `values`: bind measurements, findings and medicines to CIEL. Search the pinned CIEL index:
     ```sh
     gunzip -c ../core/vocabulary/ciel/ciel-v2026-09-24.jsonl.gz > /tmp/ciel.jsonl
     python3 -I ../core/vocabulary/ciel/search.py /tmp/ciel.jsonl serum potassium
     python3 -I ../core/vocabulary/ciel/search.py /tmp/ciel.jsonl --id 5085 5086
     ```
     Bind only when the CIEL meaning is the same, and the datatype matches (Numeric for a quantity, Coded
     for a yes/no or listed field, N/A or Drug for an answer value). Otherwise leave the field local; the
     compiler makes a stable local concept.
   - `existing`: object types the host supplies (for example the current prescription, from the latest
     `prescription` order). A follow-up path that loops on "unresolved prior.*" inputs needs this.
   - `carryOver`: only facts that persist between visits (comorbidities, the facility's care level).
   - `formVersion`: the OpenMRS form version; it must start with a digit.
   - `extra`: only with a cited reason, as above.
   Recompile and run `scripts/check.sh types test build`.

5. **Install into O3.** The local test bed is O3 3.8.0 (`distro/`). The target server is the PIH EMR. Its install
   is a PR to `acompa-health/acompa-infra` that mounts the same files read-only; module web upload is off there.
   - The forms and Initializer files name CIEL concepts by mapping (`CIEL:<code>`), so each server uses its own
     concept for the code. `bun scripts/install-ciel.ts protocols/<name>` adds only the CIEL concepts that no concept
     on the server maps to. It never adds a mapping to a code that the server maps already. The one change to an
     existing concept: a concept with the CIEL UUID gets the SAME-AS mapping when no concept maps its code. A name
     clash gets the suffix "(CIEL <code>)". On the PIH EMR, a second concept or mapping for a CIEL code stops PIH's
     configuration from loading.
   - Mount `build/initializer/*` into the backend's `openmrs_config` folders and the bundle and binding into
     `openmrs_config/nexo/<name>/` (see `distro/docker-compose.nexo.yml`), then restart the backend.
     Initializer creates the local concepts, encounter types and forms. The form UUIDs equal the ones in
     `binding.json`.
   - Run `install-ciel.ts` before the first start that loads the Initializer files, and again before each restart
     after a build that changes `build/ciel.json`. Their coded questions name CIEL answers, and an answer that does
     not resolve is an Initializer error. The PIH EMR stops at the first one and then answers 404 to every request.
   - Check the backend log for Initializer errors before you continue.
   - Give each user who fills the forms a provider record. The form engine saves the user's provider with the
     encounter, and stops without one.

6. **Walk the path.** Register a synthetic patient. Open the chart, "Care pathway", start the workflow, and
   complete each task with its generated form. After each save, check that the next task is the one the
   protocol names, and that the history shows the selected rule and its evidence. Leave one fact unanswered
   once: the protocol must open a "Collect the named missing information" task for exactly that fact.

7. **Report.** State the form count, question count, CIEL vs local concepts, the hints size, every extra
   field with its reason, every layout decision that is still "review pending", every point for the protocol
   author, and every step of the path that did or did not work.

## Form designer

The rules are in [`openmrs/docs/form-design.md`](../../../openmrs/docs/form-design.md). The compiler applies most of them. You decide
only what the rules cannot.

1. **Let the rules group the form.** The stop rows of each table give the sections and their order: questions whose
   one answer can end the step come first, one section for each row (in a form of more than six questions). A
   question that shows after an answer follows that answer. Free text and questions that change nothing go last.
   Do not reorder by hand. If the order reads badly, find the reason in the rule tables and tell the protocol
   author.
2. **Record each decision in `protocols/<name>/forms.layout.json`.** It may set a section heading (`groups.<id>.label`),
   and for a question (by Nexo path) the ⓘ text (`info`, or `"none"`), the `control` (`radio` or `dropdown`) and the
   radio `orientation`. Each entry needs `reason` (the rule, for example "D3 (1)", and why), `decidedBy` (`agent`
   for you) and `status` (`review pending`). Only Kuang changes an entry to `accepted`. The file never sets
   required, never hides a question and never changes a rule.
   - *Headings.* Give each stop section a short clinical statement, for example "Danger signs". The report lists
     the section IDs. A stop section without a heading is a warning.
   - *The ⓘ.* Add one only when a trained clinician may ask "why is this asked now?": the question shows after an
     earlier answer, or a later step uses it (the review build marks these candidates). Obvious questions get no
     ⓘ; record `"none"` with a reason when a candidate does not need one. Write at most two short sentences for a
     clinician, with the guideline page. Never name a table. Clinical wording needs sign-off, so the status stays
     "review pending".
   - *Labels.* A label made from a field name is a warning. Add the clinical word to the hints `labels`.
3. **Read the review build.** Load it on a review server with `distro/docker-compose.review.yml` (see the file).
   Each section starts with why its questions are together. Each question is followed by who uses the answer, why
   it is required, when it shows, its production ⓘ and any point for the protocol author. Check that every
   question names a user: a rule in this protocol, another protocol, a required report, or a person who reads it.
   Put back the production forms when you finish.
4. **Send protocol points to the protocol author.** A question that changes nothing, or a required field that no
   rule reads on a branch (for example the medicine after "refer"), is a protocol problem. Do not hide it with a
   hint or a layout decision. Core refuses a completion without a required field.
5. **Run the tests.** `bun test packages/nexo-forms` includes a completeness test: on every branch, each field that a
   rule reads to decide is asked and visible, or filled by the host.
