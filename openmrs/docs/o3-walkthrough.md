# O3 walkthrough findings

The 10 November 2026 walkthrough reported these faults in [I#361, care pathway faults](https://github.com/acompa-health/abrazos-v2/issues/361).
The server ran `@openmrs/esm-form-engine-app` 13.0.2-pre.12837. Its published package has git head
`da0166bceb232055d8facf694719b8d044f9a556` and depends on `@openmrs/esm-form-engine-lib: next`, not a fixed library version.
The installed library version is not known. Do not infer it from the wrapper version.

These findings use repository tests and upstream source inspection. Docker was unavailable. No server connection,
EMR connection, browser reproduction, or deployment was made for this change.

## Required radio validation

The upstream [Radio component](https://github.com/openmrs/openmrs-esm-form-engine-lib/blob/v5.0.0/src/components/inputs/radio/radio.component.tsx)
has two write paths: the group's `onChange` and each button's `onClick`. The click handler checks whether **any** old
value exists and whether the clicked input is checked. It then clears the value and calls `preventDefault`.
It does not check whether the old value equals the clicked answer. This can send a null value while changing to a
different answer. This is the source-level cause consistent with the alternating mandatory message reported in I#361.
The callback and validation timing still need confirmation in the installed build.

The [minimal schema](../tests/fixtures/o3-radio-and-section.json) has one required radio and one closed section.
It reuses the generated first-prescription decision concept and encounter type. Load the Nexo metadata first on a
local O3 test server. Import this schema as a separate test form. Do not replace a clinical form.

1. Open the test form with no prefill.
2. Choose the first answer, then the second, then the first, then the second.
3. Check for a mandatory message while an answer is selected. Check the value passed to `setFieldValue` on each click.
4. Repeat with `questionOptions.rendering: "select"`. This avoids the radio click handler.

A safe schema workaround exists: set a coded field's layout `control` to `dropdown`. It preserves required status,
answer concepts, saved values and hide expressions. This PR keeps the existing radio design and supplies the workaround
for the upstream investigation. Do not remove `required`, suppress validation, or fork the engine.

### Draft upstream issue text

**Title:** Required radio alternates a mandatory error while an answer is selected

**Environment:** O3 form wrapper 13.0.2-pre.12837, PIH EMR 1.60.0. The wrapper uses form-engine-lib `next`.
The installed library version still needs to be captured. The linked v5.0.0 source has the same two write paths.

**Steps:** Use the attached minimal schema after loading its Nexo test concepts and encounter type. Alternate the
required radio between two answers four times, without prefill. A clinician saw the error on every second change.
Saving still worked. A prefilled answer showed no error.

**Expected:** A selected required answer has no mandatory error. Changing answers writes the new answer once.

**Observed:** The selected answer remains visible, but "Field is mandatory" appears on alternate changes.

**Investigation:** RadioButton `onClick` clears on `value && target.checked`, even for a different answer, and
RadioButtonGroup also writes through `onChange`. Please check the null/new-value ordering and validation state.
A select rendering avoids this path. No engine patch is included here. Browser confirmation on the installed library
is pending. This is draft text, not an issue filed upstream.

## Section expansion

The upstream [page renderer](https://github.com/openmrs/openmrs-esm-form-engine-lib/blob/v5.0.0/src/components/renderer/page/page.renderer.component.tsx)
initializes each section from the global `isFormExpanded` prop and resets it from the same prop in an effect.
It never reads `section.isExpanded`. Changing the string to a boolean in our generator cannot fix that.
The fixture above declares the second section closed and makes the behavior visible without clinical inputs there.

**Draft upstream issue:** SectionRenderer ignores `section.isExpanded`. On the same environment, open the attached
form. "Also relevant" declares `isExpanded: "false"`, but starts open. Expected: the section starts closed while the
required section stays open. Please read the schema's section setting at initialization and preserve the global
expand/collapse control as an explicit override. No supported selective workspace prop was found. This PR leaves the
correct schema declaration in place. The fault remains open upstream and needs browser verification there.

## Clinician text owned by I#324

No protocol source or identity changed. These are proposals for the protocol owner, not clinical approval.
Paths below are under `library/protocols/wip/2026-10-29-rwanda-baseline/`.

Three rows are now covered at the display layer, as the last column shows. Labels in the
[hints file](../protocols/rwanda-htn/forms.hints.json) show the proposed wording: the lifestyle title on its form,
task card and history, the advice on the task card, and the tests on the order card. `$labelDecisions` in that file
records each label as an agent's choice, review pending. The protocol text is unchanged, so the proposals for the
protocol still stand.

| Source | Field | Proposed clinician wording | Display today |
| --- | --- | --- | --- |
| `hypertension-screening-assessment.rwanda-source.json` | `definitions.work_templates.htn_clinical_review.completion.evidence` | "Record this patient's clinical assessment, including the current medicines and the checks listed below." Keep the host-evidence requirements in an authoring field. Production retains this mixed field, including its clinical warnings, until I#324 rewrites it. | Protocol text |
| `hypertension.facility.ts` | `D.work_templates.htn_first_prescription_review.completion.evidence` | "Confirm the patient takes no current antihypertensive medicine, then record the first prescription decision." Keep attribution and date requirements in the contract. Production retains this mixed field, including its clinical warnings, until I#324 rewrites it. | Protocol text |
| `hypertension-screening-assessment.rwanda-source.json` | `definitions.work_templates.lifestyle_counselling.title` (find by the current title) | "Lifestyle advice". Move the RBCNCD24 citation and cadre gap to authoring evidence. | Covered: label `title:lifestyle_counselling` |
| Same JSON | task content `advice`: `dash_diet`, `physical_activity_150_min_week` | "DASH diet" and "Moderate-to-vigorous physical activity: 150 minutes per week" (RBCNCD24 PDF p.25 states the intensity). These are display-name proposals only. | Covered: labels |
| Same JSON and source catalog | laboratory `tests`: `glycaemia`, `hba1c`, `cbc` | "Blood glucose", "HbA1c", "Full blood count". Confirm local clinician terms under I#324 Part 2 B. | Covered: labels |
| Same JSON | prescription order `printed_line` | Keep the exact source quotation in the protocol. The care app now omits this authoring field. The medicine, dose and frequency fields remain visible. | Hidden by the care app |

The protocol's lifestyle title still contains the source citation until I#324 changes it. This PR does not strip
arbitrary parentheses or rewrite source text. "Refer" requirements and shared term display names remain in I#324.

## Clinical history

History hides only the effect-free `retain_completion / finish_work` and
`stop_on_execution_end / retain_independent_work` rules. A rule with a committed effect stays visible, even if it
has one of those names. Unknown effect metadata also stays visible. No whole policy table is hidden.

The host matches cancellation effects to the exact work occurrence and cancellation event. It uses the stored
reason and the report's retained work to distinguish a completed cancellation from a request for dispatched work.
The clinician sees "Repeat office visit cancelled: second visit handover requested" for the 140/90 screening
reading on 3 November followed by a 120/80 office reading on 17 November. The same history keeps two unmet-need
records. "Hypertension handover still needed" names work that is still open after the step. The request for the
second reading falls due and the same step completes it, so its entry reads "Collect information was due and was
completed in the same step: Second blood-pressure reading, with its time and the visit findings". These entries
describe what the step recorded. A later completion does not erase them. Raw rule IDs, evidence and stored log values
stay unchanged.

## Header width

The vitals header belongs to the O3 vitals module, outside this workspace's DOM. No safe single rule in the Nexo
module fixes its overlap at the reported width. It is noted without a cross-module CSS override, as I#361 permits.
The workspace's native time input has its own scoped width rule. A local browser check is still required for both.
