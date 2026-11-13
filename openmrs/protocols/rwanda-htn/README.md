# Rwanda hypertension forms

Draft for clinical review. Use synthetic patients only. The [shared hypertension guide](../../../library/protocols/wip/2026-10-29-rwanda-baseline/hypertension.md)
records the clinical choices from merged [PR#202, hypertension facility draft](https://github.com/acompa-health/abrazos-v2/pull/202).
The clinical choices remain **decided by an agent, sign-off pending**.

## Build

Run from `openmrs/` with Bun 1.4.4:

```sh
bun install
bun run build:protocol
bun run compile
scripts/check.sh types test build
```

`build.ts` reads the shared source document, catalog, builder and trust in
`library/protocols/wip/2026-10-29-rwanda-baseline/`. It prepares the national reference with its catalog,
then the facility SOP with `buildHypertensionFacilityCatalog(reference.protocol)`. It checks both pins:

| Content | Prepared identity |
| --- | --- |
| RBCNCD24 source reference | `sha256:f57a08d143082517519b1b48fb8bcdb3fe8ddfef676c499f885ebef6d2b50448` |
| National facility 1.0 | `sha256:7b277361f58cd538b356654dce56db47ca3e6439d954aa75cd4f60f4cbb648ca` |

The compiler makes 28 forms with 144 questions and 113 concepts (16 CIEL, 97 local), with no warnings.
The [mapping report](build/report.md) lists 15 points for the protocol author. The [hints](forms.hints.json)
supply labels, concept mappings and host evidence sources. The [layout decisions](forms.layout.json)
keep the section headings and clinician help text with their review status.

## Current regimen

The assessment requires one `current_regimen` reference. The form offers these answers:

| Clinician answer | Host evidence | Next form |
| --- | --- | --- |
| Use the current prescription shown above | The latest prescription from this pathway's orders, attested for this patient | `htn_prescription_review` |
| I confirm that this patient takes no antihypertensive medicine | A new `htn_no_regimen_attestation` with this patient, the assessing clinician and this encounter's date and time | `htn_first_prescription_review` |
| Not known, or no answer | No reference and no inferred attestation. Core retains immediate owned assessment with the original due instant | `htn_clinical_review` |

A selected prescription must exist. Otherwise the host refuses the selection with a readable reason.
The form does not select an answer from history. Core checks the patient, clinician and time before it authorizes
a first prescription. The first-prescription branch permits only supported initial doses. It cannot renew or change
treatment. Both prescription forms keep potassium conditional on an ACE inhibitor. The shared rules decide care.

## PIH redeploy inventory

[PR#8, PIH redeploy](https://github.com/acompa-health/acompa-infra/pull/8) must install the bundle, binding,
Initializer concept files, encounter types and all 28 forms from this build together. Rebuild and install the
frontend module too: the reference choice is resolved by its browser host adapter. Backend Java code is unchanged.
Run the CIEL install check before restart as described in the [OpenMRS guide](../../README.md#concepts-on-each-server).
`build/ciel.json` was regenerated and is byte-identical: all 16 CIEL mappings stay the same.

All 25 existing form UUIDs and 86 existing local concept definitions stay the same. Three forms, three encounter
types and 11 local concepts are added. No form or concept is removed. Every existing form records the new protocol
identity in its description. The assessment and assessment-update form also add the regimen choice.
All three form destinations (`o3/forms/`, `initializer/ampathforms/`, `o3-review/ampathforms/`) are regenerated.
Use new synthetic patients after redeploy. Earlier event logs carry the earlier protocol identity. This change
includes no log migration. These forms have not been walked on a live PIH server with the new bundle.

### Forms

The file stem names the production form. Initializer and review files add the `nexo-` prefix.

| Form file stem | Change | Form UUID |
| --- | --- | --- |
| `screening_recall` | New identity in description | `a27cbb23-1f6d-3a82-86cf-0336d95f6ffd` |
| `offer_out_of_office_measurement` | New identity in description | `4fb0852e-9e53-392c-bc53-7011f2e091d0` |
| `repeat_office_visit` | New identity in description | `2bde28b9-e797-3d91-b44b-379d25543e51` |
| `diagnosis_review` | New identity in description | `fe684362-ce55-3707-8bfe-c88f4be6a0d3` |
| `clinical_review` | New identity in description | `1a80805a-0fc4-36c3-bc4b-8fa363e11667` |
| `collect_information` | New identity in description | `4108d6d7-0b63-363e-9315-674244f54d77` |
| `lifestyle_counselling` | New identity in description. Renamed after PR#8 (see below) | `75703027-bcb9-3365-9a30-1301138b040e` |
| `htn_clinical_review` | Add regimen question and new identity | `5fe29477-5569-3eca-8041-8022f64d9174` |
| `htn_prescription_review` | New identity in description | `05ecba10-d8d6-3479-843a-c40fd442c0ed` |
| `htn_dispense` | New identity in description | `fe5f701c-1c95-3a58-9da0-60c146b7c6e0` |
| `htn_receipt` | New identity in description | `52ad7e46-39da-3157-8030-76321034c993` |
| `htn_supply_recovery` | New identity in description | `e7d209ab-f5b7-33d6-82c9-a024ab4d97ce` |
| `htn_next_review` | New identity in description | `0fdf7e3b-38e1-31a2-8daa-159117c67a1a` |
| `htn_contact_overdue` | New identity in description | `b00a4ed5-bff7-3980-9b80-49faf1460db4` |
| `htn_handover` | New identity in description | `a69a9ea0-9ca5-3a29-97a4-e0a37dbffdc3` |
| `htn_handover_recovery` | New identity in description | `d9d131a8-5b6c-3545-83f3-04d6d40d26cc` |
| `htn_single_visit_diagnosis` | Add form and encounter type | `f6b24a5c-5d54-3ccd-86c2-774344300f62` |
| `htn_first_prescription_review` | Add form and encounter type | `511390b3-73e5-3e81-a28d-9df06e0778b2` |
| `event_measurement_recorded` | New identity in description | `987d256a-5b6d-3f68-a4e7-a5f960308f90` |
| `update_encounter` | New identity in description | `c5e52784-c3b4-3921-83b5-2d4838edbfc3` |
| `update_htn_assessment` | Add regimen question and new identity | `42340d91-309c-3234-ad5f-cba312fd43b2` |
| `update_htn_external_work` | New identity in description | `b743c1f4-c0e0-3768-99e0-d5c6ac5020e8` |
| `update_htn_no_regimen_attestation` | Add form and encounter type | `a6f48d7e-4b5d-3c4a-847f-48dd355ec286` |
| `update_htn_prescription` | New identity in description | `3899947c-daab-3675-9c81-bf82f59b9003` |
| `update_htn_receipt` | New identity in description | `5c6c5ce2-cc66-3fc1-8baa-b52e5294837e` |
| `update_htn_supply` | New identity in description | `b1e4aaf8-4fda-38f8-9bca-45c7b92c2695` |
| `update_laboratory_result` | New identity in description | `0c01af9d-8dd6-3aa3-a280-f5a0c1c79605` |
| `update_observation` | New identity in description | `9af46791-a2d9-3547-8240-7268e46da13f` |

The three new encounter types are:

| Form | Encounter type | UUID |
| --- | --- | --- |
| `htn_single_visit_diagnosis` | Nexo Assess diagnosis and treatment now after th… | `8216442b-9e89-5860-8156-cd2d83195a7b` |
| `htn_first_prescription_review` | Nexo HTN first prescription decision | `3de40289-73a0-5893-988d-bb4ea8f1052b` |
| `update_htn_no_regimen_attestation` | Nexo Update no current antihypertensive attestat… | `b66b86cf-b3dc-5c53-8fa8-8b8873471944` |

### Concepts

These are all concept changes. Existing local definitions and CIEL mappings are unchanged.

| Nexo key | Change | Concept UUID |
| --- | --- | --- |
| `value:htn_prescription` | Add answer | `e8832494-4adf-5be0-bc26-50e407af4356` |
| `value:htn_no_regimen_attestation` | Add answer | `120faafb-a3b1-5397-b9a6-c20cda558e0b` |
| `htn_assessment.current_regimen` | Add question | `964c606d-ffc9-53f1-abb6-a6d59cdbd5ad` |
| `htn_single_visit_diagnosis.diagnosis` | Add question | `547676c4-295c-5ae8-8424-7e0e3ea9b39a` |
| `htn_first_prescription_review.action` | Add question | `d5c652ee-b0f8-52a2-a448-dcbd0bb7d54a` |
| `htn_first_prescription_review.medicine` | Add question | `b2a0e624-fe8f-5a54-aaac-5de3027262ef` |
| `htn_first_prescription_review.dose` | Add question | `e05d9b3f-3c2a-5195-8593-2e79a0599f5c` |
| `htn_first_prescription_review.second_medicine` | Add question | `c4e427b7-0e08-5c14-8e59-94a405888777` |
| `htn_first_prescription_review.second_dose` | Add question | `d8f089b2-484f-59c0-a9e0-9a6ff08f1570` |
| `htn_first_prescription_review.valid_until` | Add question | `b53619c8-8aa3-59ed-8b19-8c5ef4aebb71` |
| `htn_first_prescription_review.reason` | Add question | `3809b0ac-c014-57c4-82a6-710cac4ad5ff` |

### After PR#8

The next redeploy installs these changes. The protocol bundle, `build/ciel.json`, the concept files and the other
27 forms are unchanged.

- The hints label `title:lifestyle_counselling` renames the lifestyle form to "Nexo: Lifestyle advice". Initializer
  makes a form UUID from the form name and version, so the form UUID changes from
  `75703027-bcb9-3365-9a30-1301138b040e` to `ae96fb76-a03c-32c9-9f9f-a24b2d431a0a`. Initializer retires an old form
  only when a new form has the same name, so a server that loaded the earlier build keeps the old form, published and
  with the same encounter type, until a person retires it (for example `DELETE /ws/rest/v1/form/<old UUID>`, which
  retires a form without `purge`). The care pathway completes this task with "Mark as done" and opens neither form.
- The encounter type `508e3a9c-e6e6-5983-bf37-a3688f9e5a68` keeps its UUID and is renamed "Nexo Lifestyle advice".
- `binding.json` has new labels and the renamed form. Install it with the rebuilt frontend module, which shows the
  start labels, task titles and history.
