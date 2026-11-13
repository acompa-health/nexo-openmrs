# Nexo forms for OpenMRS 3: design

Status: working design, 7 November 2026. Author: Claude (agent), for Kuang. Moved from `acompa-health/nexo-openmrs`
(now `acompa-health/nexo-openmrs-archive`) into `acompa-health/abrazos-v2` on 8 November 2026; the target server and
the architecture changed then.

## Intent

A clinical protocol in Nexo v1 already says, for each step of care, who does the work, which facts the
next decision reads, and which facts it needs before it can decide. OpenMRS 3 (O3) forms ask the same
questions, but today a person must write each form by hand: choose concepts, lay out questions, and
keep the form in step with the care logic. That specification work is slow and goes out of date.

This project proves that the Nexo protocol is enough to generate the forms and to move a patient
through the workflow. A person may add a small declarative hints file (labels, concept codes) and a layout
decisions file (section headings, and a question's ⓘ text, control or radio orientation). A person does not write
forms.

The worked example is the Rwanda adult hypertension protocol, national facility version `1.0`
(`rwanda.htn_screening_assessment_2024`, from [PR#202, hypertension facility draft](https://github.com/acompa-health/abrazos-v2/pull/202),
merged). It is a draft for clinical review. It is not for care.

## Goals

1. Generate one O3 form for each Nexo task that a person completes, and one for each host event that
   a person records (for example a blood-pressure reading). Use the standard O3 form schema, so the
   stock O3 form engine renders and saves them as ordinary encounters and observations.
2. Prefill each form with the values that the protocol passes into the task (task `content`) and with
   facts the patient already has.
3. Mark as required the fields that the next decision reads. Show conditional fields only when the
   rule that reads them can apply. Keep the other declared fields as optional.
4. Run the Nexo rules for each patient, so the chart shows the open tasks, and the next form appears
   after each submission.
5. Package this as an OpenMRS module: a backend module (`nexo` .omod) and a frontend module
   (`@nexo/esm-nexo-care-app`). The target server is the PIH EMR (image `partnersinhealth/pihsl-emr:1.60.0`).
   The local test bed is the O3 3.8.0 reference application. The modules run on the test bed. A trial ran them on
   the PIH EMR on 9 November 2026 (see the [README](../README.md#the-target-server)).

## Non-goals

- No clinical approval. The forms show the protocol's draft status.
- No new form renderer. We use the O3 form engine.
- No port of the Nexo engine to Java (decided by Kuang, 7 November 2026: the rules run in the browser).
- No form builder UI. Hints are a JSON file.

## Anti-goals

- A field list that a person typed by hand for this protocol. Every generated field must trace to the
  protocol or the catalog. The hints file may only rename, bind concepts, say how the host supplies values, or
  add a field with a written reason. The layout decisions file may only name a section and set a question's ⓘ,
  control or orientation, each with a reason, who decided and a status.
- A section order or grouping that a person typed by hand. The order comes from the rule tables.
- Clinical logic copied into the forms or the frontend. The rules stay in the Nexo document.

## Architecture

```
this repository                             openmrs/
───────────────────────────────            ─────────────────────────────────────────────
core/          ── imported in place ─────▶ packages/nexo-forms/, protocols/*/build.ts
library/protocols/wip/2026-10-29-rwanda-baseline/
               ── imported in place ────▶ protocols/rwanda-htn/build.ts  (pinned)
                                            packages/nexo-forms/       compiler + host adapter
                                              compile:  protocol + catalog + hints
                                                          → O3 form JSON, concepts, encounter types,
                                                            binding map, mapping report
                                              host:     O3 encounter ⇄ Nexo event, replay, open tasks
                                            packages/esm-nexo-care-app/  O3 frontend module
                                            omod/                        O3 backend module "nexo"
                                            distro/                      O3 3.8.0 compose files (local test bed)
```

### Compile time (`nexo-forms compile`)

Input: the prepared Nexo document, its catalog, an optional hints file, and an optional layout decisions file.

Output in `protocols/<id>/build/`:

- `o3/forms/<name>.json`: O3 form schema, one per task template and per person-recorded event.
- `o3-review/ampathforms/`: the review build of the same forms. Each section and question shows its reason.
- `initializer/`: an OpenMRS Initializer configuration (concepts, encounter types, forms), so a
  stock O3 server loads the metadata at start.
- `binding.json`: for each form question, its Nexo path (for example
  `result.assessment.pregnant`), Nexo type, concept, and answer map. The host adapter uses it in both
  directions.
- `report.md`: each form, each field, where it came from, why it is required or optional, and where
  its prefill comes from.

### Mapping rules

| Nexo | O3 form |
| --- | --- |
| Work template with a human performer role | One form. Title from `title`. Description from `completion.evidence`. Encounter type `Nexo: <title>` |
| Catalog event with an object payload that a person records (`measurement.recorded`) | One form for that object |
| Task `content` | Read-only "From the pathway" section, filled at open time |
| Result field of type `reference → object:X` | A section with the fields of catalog object X |
| Object field that names the patient, the task's reading, the task's prescription, or a time of this report | Filled by the host. Not shown |
| Generic object reference with `references` hints | A coded choice of object evidence. The host looks up the selected object or records the explicitly selected attestation with patient, clinician and encounter time. Missing history never selects an answer. |
| `yes_no` | Radio: Yes (CIEL 1065) / No (CIEL 1066). No answer means unknown |
| `listed` | Radio (5 answers or fewer, counting "Not known") or dropdown. Each value is a coded answer |
| `quantity` with a unit | Number with the unit in the label, without stepper buttons |
| `instant`, `date` | Date-time or date |
| `text`, `identifier` | Text area or text |

**Required.** A field is required when the template or catalog declares it (not `optional`): Core refuses a
completion without it. A field the protocol declares optional is required when a table that consumes this
completion reads it with `required: "decision"`, or a later table reads it. Other fields stay optional.

**Conditional.** Only an optional field can hide. When every possible way a rule reads it also tests one to three
other questions on the same form (for example `medicine == enalapril or medicine == lisinopril` before it reads
`potassium`), the field hides until those answers allow the rule. A read is impossible, and is dropped, when its own
tests contradict each other. A finding (yes/no or a listed value) never hides behind an `or` sibling. Hide
conditions may not form a cycle. A field with more conditions stays shown and required: it is on the main path.

**Sections and order.** The form designer reads the rows of each table that hears the form ([rules](form-design.md)).
A question whose one answer can end the step (a stop question) comes first, in row order. In a form of more than six
questions, each stop row makes its own section, with a heading from the layout decisions file. The other questions
keep the section of their record. A question that shows after an answer follows that answer. Free text and
questions whose answer changes nothing go last. Extra fields go last, in a closed section.

**Questions that change nothing.** The form does not ask an optional field that no rule reads, or whose every read
other answers already settle. A required field whose every test accepts any answer stays. The compiler lists both
for the protocol author, and also each required field that no rule reads after one answer of a choice.

**Required and optional.** O3 marks a required field with a red asterisk. An optional field says "(optional)".

**The ⓘ.** Production shows an ⓘ only where the layout decisions file gives clinician text. The review build shows
the full reason for every section and question on the page.

**Prefill.** Only three sources: values the protocol passes into the task (task content, and fields of the objects
and orders it names), the object being updated, and facts the hints name as carrying over. A decision and this
visit's findings are never copied from history.

**Concepts.** The hints file binds a field to a CIEL code (for example systolic → CIEL 5085). The
forms, the binding and the Initializer files name such a concept by its mapping, `CIEL:5085`, so each
server uses its own concept for the code (the PIH EMR holds CIEL concepts under PIH UUIDs). The
compiler creates a local concept, with a stable UUID derived from the protocol and field path, for
each field without a binding. The report lists both kinds. See
[Concepts on each server](../README.md#concepts-on-each-server).

### Object reference contract

The host sends `type`, `id`, and optional text `revision` on each object reference. It sends clinical fields in object revisions in `receipt.objects`, separately from result and entry references. Core refuses extra reference fields at ingress and recovery. Prefill and rule evaluation read clinical fields from stored objects. See the [shared object reference contract](../../docs/system/protocol-format.md#object-references-and-stored-fields).

### Run time

The frontend module adds a "Care pathway" dashboard to the patient chart.

1. It loads the protocol bundle from the backend module and prepares it with Nexo Core in the
   browser (once per session). It resolves each CIEL mapping in the binding to the server's concept.
2. It loads the patient's Nexo event log from the backend module, creates a Core harness, and
   replays the log. Before each entry the harness clock moves to that event's time, and after the last entry to
   the current time, so that work due by now has fired. The harness reports the open work, the current state of
   each workflow, and the committed records.
3. It lists the open tasks. Each task has a "Fill form" action. The action opens the generated form in
   the O3 form workspace, with the task content and known facts as prefill.
4. When the form engine saves the encounter, the host adapter reads the saved observations through the
   binding map, builds the Nexo objects and the `task.completed` (or other) event, dispatches it, and
   appends it to the event log with the encounter UUID.
5. The dashboard shows the new open tasks.

The backend module stores the event log (one table) and serves the protocol bundle. It does not run
rules.

## Constraints

- The target server is the PIH EMR on emr.acompahealth.com: image `partnersinhealth/pihsl-emr:1.60.0` with
  OpenMRS core 2.8.10, Initializer 2.12.1, o3forms 2.3.0, and the O3 patient chart and form engine 13.0.2-pre.12837 (a pre-release of 13.0.2). Files
  are mounted read-only over the image. Module web upload is off, so the `.omod` file is mounted, never uploaded.
  A later PR to `acompa-health/acompa-infra` deploys it.
- The local test bed is the O3 reference application 3.8.0, run with Docker (Colima) on the Mac.
- The compiler and the browser use Nexo Core from `core/` in this repository. The build checks the prepared
  identity, so a change to Core that changes the identity stops the build.
  The prepared identity of national facility 1.0 must stay
  `sha256:7b277361f58cd538b356654dce56db47ca3e6439d954aa75cd4f60f4cbb648ca`.
- Synthetic patients only.

## Left to the builder

Exact O3 extension slot names, the form workspace prefill mechanism, and the module's REST paths
follow what O3 3.8.0 supports. The [backend module contract](omod.md) and the
[frontend module README](../packages/esm-nexo-care-app/README.md) record what was built. Check them against the PIH EMR
versions before the deploy.
