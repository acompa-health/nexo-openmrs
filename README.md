# Nexo on OpenMRS: review copy

OpenMRS 3 forms and a care pathway, generated from a clinical protocol. This repository is a review copy for PIH HIS.
The review brief and the screen walkthrough, shared separately, explain what it does and where we would most value
your judgement. This README says what is here and how to run it.

> **Draft clinical content, synthetic patients only.** The worked example is the Rwanda adult hypertension protocol,
> a draft with no clinical sign-off. Nothing here is for care.

## What is in this copy

| Folder | Content |
| --- | --- |
| [`openmrs/`](openmrs/README.md) | The component: the compiler, the O3 frontend module, the backend module, the generated forms and metadata, and their documents. Start with its README. |
| `core/` | The parts of Nexo Core, our protocol engine, that the component imports, and the CIEL release that the compiler reads. |
| `library/protocols/wip/2026-10-29-rwanda-baseline/` | The hypertension protocol that the forms are built from, with its [guide](library/protocols/wip/2026-10-29-rwanda-baseline/hypertension.md). |
| `.claude/skills/nexo-to-openmrs-forms/` | The written procedure that our agents follow to take a protocol to reviewed forms. |
| `SOURCE.json` | The commit that this copy was generated from. |

This copy is generated from our main repository, `acompa-health/abrazos-v2`, at commit `6356db6b` (2026-11-13). We
do not edit it here. Each update is one commit that replaces the content. Some documents link to files outside
these folders, or to `acompa-health/abrazos-v2`. Those are in our private repository and will not open.

## Where to start reading

- [`openmrs/omod/`](openmrs/omod): the backend module, 645 lines of Java. Start with `NexoLogController.java` and
  `NexoEventLog.java`. [`openmrs/docs/omod.md`](openmrs/docs/omod.md) gives the REST contract.
- [`openmrs/packages/esm-nexo-care-app/src/care-task/`](openmrs/packages/esm-nexo-care-app/src/care-task): the save
  path in the browser. The form engine saves an encounter, then the app reads it back, builds a protocol event,
  checks it and appends it to the patient's log.
- [`openmrs/packages/nexo-forms/src/compile.ts`](openmrs/packages/nexo-forms/src/compile.ts): the compiler.
  [`openmrs/docs/form-design.md`](openmrs/docs/form-design.md) gives the rules it uses to group and order questions.
- [`openmrs/protocols/rwanda-htn/build/`](openmrs/protocols/rwanda-htn/build): exactly what Initializer loads.
  `report.md` there maps every question to the rule that needs it.
- [`openmrs/docs/design.md`](openmrs/docs/design.md): the intent and the constraints.

## Run the checks

Requirements: Bun 1.4.4, Node 26.13.0 for the frontend build, and Docker for the backend module.

```sh
cd openmrs
bun install
scripts/check.sh types test build   # types, tests, and a fresh compile compared with the committed build
scripts/check.sh omod               # the backend module, built with Maven in Docker

cd packages/esm-nexo-care-app       # the O3 frontend module
bun install --frozen-lockfile --linker hoisted
bun run test
bun run build
```

CI in this repository runs the same checks on each update. `openmrs/scripts/export-review.ts` is the tool that
writes this copy. It needs our main repository, so it does not run here.

## See it run

**On the O3 3.8.0 reference application, on a laptop.** Follow "Run it locally" in
[`openmrs/README.md`](openmrs/README.md#run-it-locally). It starts the reference application with Docker Compose,
adds the CIEL concepts that the forms name, mounts the backend module and the generated metadata, and walks a
synthetic patient through the path.

**On a PIH EMR image.** Our demo server runs `partnersinhealth/pihsl-emr:1.60.0` unchanged, with these read-only
mounts added in a Compose override. Paths on the right are inside the image.

| Built file or folder | Mounted at |
| --- | --- |
| `openmrs/omod/omod/target/nexo-0.1.0-SNAPSHOT.omod` | `/openmrs/distribution/openmrs_modules/nexo-0.1.0-SNAPSHOT.omod` |
| `openmrs/protocols/rwanda-htn/build/initializer/concepts` | `/openmrs/distribution/openmrs_config/concepts/nexo` |
| `openmrs/protocols/rwanda-htn/build/initializer/encountertypes` | `/openmrs/distribution/openmrs_config/encountertypes/nexo` |
| `openmrs/protocols/rwanda-htn/build/initializer/ampathforms` | `/openmrs/distribution/openmrs_config/ampathforms/nexo` |
| `openmrs/protocols/rwanda-htn/build` | `/openmrs/distribution/openmrs_config/nexo/rwanda-htn` (the backend module serves the protocol bundle and the binding from here) |
| The built frontend module, `openmrs/packages/esm-nexo-care-app/dist` | `/openmrs/distribution/openmrs_spa/nexo-esm-nexo-care-app-0.1.0` |
| The image's `importmap.json` and `routes.registry.json` with the module added, and their `.gz` and `.br` copies | The same files in `/openmrs/distribution/openmrs_spa/` |

Three things we learned on that image:

- Run `openmrs/scripts/install-ciel.ts` against the server before the start that first loads the Initializer files.
  The forms name CIEL answers, and Initializer stops at the first one that does not resolve.
- Each user who saves a form needs a provider record.
- Copy the files without macOS metadata. A `._` file among the form schemas stops Initializer.

## What is not here

The rest of Abrazos: the authoring tools, the guideline library, the demo, and the engine's own test corpus. Ask us
if you want to see any part of it.

Kuang Chen, Acompa Health
