# @nexo/esm-nexo-care-app

An OpenMRS 3 frontend module. It adds a **Care pathway** dashboard to the patient chart. A person uses it to move
a patient through a Nexo protocol with generated O3 forms.

The protocol is a draft for clinical review. The module runs it with simulation authority. It is not for care.

## What the module shows

The dashboard has one widget, in the slot `patient-chart-nexo-care-pathway-dashboard-slot`:

- **Banner.** The protocol ID and revision, and "Draft for clinical review · Simulation authority · Not for care".
- **Start a pathway.** One button for each workflow that a person can start for this patient. A start that offers a
  choice has one button for each answer, for example "Hypertension care (Initial)" and "Hypertension care (Follow-up)".
  An entry value that the protocol fixes is recorded but not shown.
- **Open tasks.** For each task: the title (a `title:<template>` label in the hints file, else the protocol's title),
  the performer role, the due date (red more than five minutes after it is due), the values the protocol passes to the
  task ("From the pathway"), the missing information, and one button for each action.
- **Workflows.** Each workflow execution with its current state, or its end outcome.
- **History.** Newest first: each recorded clinical event with its time and the clinical rules that Nexo Core selected.
  It hides only the effect-free `retain_completion / finish_work` and `stop_on_execution_end / retain_independent_work`
  rules, plus source citation IDs. Other rules in those tables stay visible. Cancellations name the exact work and
  reason, for example "Repeat office visit cancelled: second visit handover requested". Unmet-need entries name the
  work that is still needed, including named missing inputs. When the same step ends that work, the entry says so.
  A cancellation request for dispatched work says "cancellation requested". It does not claim that the work has
  stopped. The full log stays unchanged.

An action that has a form opens the workspace `nexo-care-task-workspace`. The workspace shows the task context above
the stock O3 form engine (`form-widget-slot`). It prefills the form with `host.prefillWithSources()` and lists each
prefilled field with its source. "Mark as done" completes a task that has no questions, without a form.

A task shows **Due now** from its due time through the next five minutes. After those five minutes it shows red **Overdue since**.
This is a display grace period for all work. It does not change Core's due times, timers, or care requirements.
The label is calculated when the view renders. The page does not run a live clock.

The clinician view hides the order's `printed_line` authoring field. When `second_medicine` is `none`, it hides the
second dose and frequency. It preserves all source values. Both production and review forms show
`completion.evidence` in **About this step**. This field includes clinical completion requirements and warnings.
Mixed engineering wording stays visible until the protocol owner rewrites it under I#324.

See [O3 walkthrough findings](../../docs/o3-walkthrough.md) for upstream faults, reproductions, and protocol wording
that belongs to I#324. The native time input has a scoped width of 10rem so its AM/PM segment has room.

## What the module does not do

- It does not decide anything clinical. Nexo Core, from `core/` in this repository, selects every rule.
  `packages/nexo-forms/src/host.ts` moves values between O3 observations and Nexo objects.
- It does not render forms. The O3 form engine renders and saves them as ordinary encounters.
- It does not store the log. The `nexo` backend module stores it (see the [backend module contract](../../docs/omod.md)).

## How a step is recorded

1. The form engine saves the encounter and calls `handlePostResponse`.
2. The module reads the encounter back with its observations.
3. It reads the latest log, rebuilds the session, and finds the task (or start) again in that session.
4. `host.entryFor()` builds the log entry. `host.check()` lets Core check it.
5. If Core refuses the entry, the module does not append it to the pathway log. The O3 encounter stays in the chart,
   but the pathway has not recorded the step. The workspace stays open, shows Core's reasons, and reopens the form on
   the saved encounter, without the prefill. When the person saves again, the same encounter is updated. Until the
   step is recorded, closing the workspace asks the person to confirm.
6. If Core accepts the entry, the module sends `POST /ws/rest/v1/nexo/patients/{uuid}/log` with
   `expectedSeq` = the number of entries it read. If another user appended first (409 `stale`), it reads the log
   again and tries once more. Then it closes the workspace and refreshes the dashboard.
   Every saved encounter also revalidates O3 vitals and biometrics, even if Core refuses the pathway entry.
7. If the person closes the workspace before the result arrives, the module does not close any other workspace. A
   failure then shows as an error message that names the task.

The module loads the protocol bundle and the binding once per page, and prepares the bundle with Core (about 0.3 s).
The binding names CIEL concepts by mapping. One request (`GET /ws/rest/v1/conceptreferences`) resolves them to the
server's concepts, so the module reads and prefills the concepts that the form engine saves on that server.

## Requirements

- O3 reference application 3.8.0 (core 11, patient chart 13), the local test bed. The target server, the PIH EMR
  (image `partnersinhealth/pihsl-emr:1.60.0`), has the O3 patient chart and form engine 13.0.2-pre.12837 (a pre-release of 13.0.2). The 10 November 2026 walkthrough used this module there.
- The `nexo` backend module, which serves the protocol bundle, the binding and the patient log.
- The generated forms, concepts and encounter types, loaded by Initializer, and each CIEL concept that they name
  (`scripts/install-ciel.ts`). The form UUIDs in `binding.json` must be the server's form UUIDs. See [`distro/docker-compose.nexo.yml`](../../distro/docker-compose.nexo.yml).
- A visit. If the patient has no active visit, the module asks the person to start one (the standard O3 prompt).
- A provider record for each user who fills a form. The form engine saves the user's provider with the encounter.
  Without one it stops with "Cannot read properties of null (reading 'uuid')", as it did for the PIH `admin` user.

## Develop

The package has its own `node_modules`. It imports the host from `../nexo-forms/src/browser.ts` as TypeScript.
The build compiles that code and Nexo Core (`core/` in this repository) with the module.

Install with Bun. The `openmrs` CLI and rspack run on Node, so Node must be installed too; the package scripts
start them.

```bash
cd openmrs/packages/esm-nexo-care-app
bun install --linker hoisted
bun run start --backend http://localhost:8090 --open false    # openmrs develop
```

Then open <http://localhost:8080/openmrs/spa>, log in with the O3 demo administrator login, open a patient and select
**Care pathway**. The dev server takes the import map and routes from the backend and replaces this module with the
local build. Tested with Node 26.13.0 and the `openmrs` CLI 11.0.0.

`bun run typescript` type-checks the module. The tsconfig is strict, because Core needs strict null checks.
The build's type checker reports issues in `src/` only: `@openmrs/esm-patient-common-lib` ships TypeScript source
that upstream checks without strict mode.

## Build

```bash
cd openmrs/packages/esm-nexo-care-app
bun run build                         # rspack --mode production, output in dist/
```

`dist/nexo-esm-nexo-care-app.js` is the entry. `dist/routes.json` is the module's routes.

## Install into an O3 3.8.0 distro

Run these commands from `openmrs/`.

### Without a new frontend image (the local test bed)

This mounts the build into the stock frontend container and replaces its import map and routes registry.

```bash
(cd packages/esm-nexo-care-app && bun run build)
bun distro/frontend/add-nexo-care-app.mjs
cd distro
docker-compose -p nexo-o3 -f docker-compose.yml -f docker-compose.nexo.yml \
  -f docker-compose.frontend.yml up -d --no-deps frontend
```

`add-nexo-care-app.mjs` reads `importmap.json` and `routes.registry.json` from the frontend image, adds this module,
and writes them, with `.gz` and `.br` copies, to `distro/frontend/dist/`. The image's nginx serves the compressed
copies first, so all six files are replaced. Run the script again after each build. The module's URL in the import map
carries a hash of the entry file, and the chunk files have content hashes, so browsers load a new build at once. If you start the frontend
without `docker-compose.frontend.yml`, the module is not loaded.

### In a distro build (production)

The PIH EMR is a distro of this kind. Its deploy is a later PR to `acompa-health/acompa-infra`, and the Care
pathway page must be added to the PIH chart configuration first.

Pack the module and add it to the distro's `frontend/spa-assemble-config.json`, then rebuild the frontend image:

```bash
cd packages/esm-nexo-care-app && bun run build && bun pm pack    # nexo-esm-nexo-care-app-0.1.0.tgz
```

```json
"frontendModules": { "@nexo/esm-nexo-care-app": "file:./nexo-esm-nexo-care-app-0.1.0.tgz" }
```

Copy the `.tgz` file into the frontend build context in the Dockerfile. `openmrs assemble` adds the module to the
import map and routes registry. This route is not tested yet.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `protocolName` | `""` | The protocol folder name that the backend serves. Empty means the first protocol in `GET /ws/rest/v1/nexo/protocols`. |

## Source

| Path | Content |
| --- | --- |
| `src/index.ts` | Module entry: config schema, dashboard link, widget, workspace. |
| `src/routes.json` | Dashboard link, widget, workspace and its window (`patient-chart` group, `extra-wide`). |
| `src/nexo.resource.ts` | Protocol loading, log reads, encounter read-back, check and append with retry. |
| `src/care-pathway/` | The dashboard widget. |
| `src/care-task/` | The form workspace. |
| `src/display.ts` | Date formatting, task titles for the history, and the context lines to show. |
| `rspack.config.js` | OpenMRS default config. It also compiles `@openmrs/esm-patient-common-lib`, limits type-check reports to `src/`, and puts content hashes in chunk names. |
