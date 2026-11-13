# OpenMRS forms and care pathway

Generate OpenMRS 3 (O3) forms and run the care pathway from a Nexo protocol, without writing form specifications.
In the O3 patient chart, the **Care pathway** page shows the open tasks and opens the form for each one.

This folder was a separate repository until 8 November 2026. Kuang decided to move it into `acompa-health/abrazos-v2`
so that it uses the Core and the protocols there. The old repository is now `acompa-health/nexo-openmrs-archive`. It
keeps the history before the move, and the [screenshots of the forms on O3 3.8.0](https://github.com/acompa-health/nexo-openmrs-archive/tree/f7a48b0/docs/screenshots).
The name `acompa-health/nexo-openmrs` now holds a review copy that is generated from `abrazos-v2`.

> **Draft content, not for care.** The worked example is the Rwanda adult hypertension protocol, national facility
> version `1.0`, from [PR#202, hypertension facility draft](https://github.com/acompa-health/abrazos-v2/pull/202). It is
> a draft for clinical review. It runs under a synthetic simulation trust. Use synthetic patients only.

## What this proves

In O3 a team specifies each form by hand: which concepts to collect, which are required, when a field shows, and
which form comes next. A Nexo protocol already holds those answers. For each step it names the role, the task, the
facts the next decision reads, and the rule that runs when a fact is missing.

The compiler reads the protocol and makes:

| Output | From the protocol |
| --- | --- |
| One O3 form per task a person completes, per recorded event, and per object update | work templates, catalog objects and events |
| Required fields | the fields that a decision table reads with `required: "decision"` |
| Sections and question order (danger signs first, potassium right after the medicine) | the rule rows: a question whose one answer can end the step comes first, in row order |
| A review build that shows, for each question, who uses the answer and why it is asked | the tables that read each field, and the rows that test it |
| Conditional fields (for example potassium only for enalapril or lisinopril) | the tests that every rule reading the field shares |
| Prefilled values | the task content, the current prescription, and the patient's last answers |
| The next form after each save | Nexo Core runs the rules in the browser and lists the open work |
| A "collect the missing information" form with exactly the missing fields | the unresolved table and its input bindings |

The hand-written input is two small files:

- The [hints file](protocols/rwanda-htn/forms.hints.json). It may do four things: rename (labels), bind CIEL
  concepts, say how the host supplies values a person should not retype (the current prescription from the
  protocol's own order, comorbidities that carry over as an editable prefill, the role that records events, and explicit object-reference choices), and add
  a field with a cited reason. For hypertension it binds 13 CIEL concepts and adds weight, height and waist
  (RBCNCD24 PDF p.12), each with its CIEL concept: 16 CIEL concepts in all. Where a label replaces authoring
  words of the protocol, `$labelDecisions` records why, who decided and its status, as the layout file does.
- The [layout decisions file](protocols/rwanda-htn/forms.layout.json). It holds only what the rules cannot decide:
  section headings, and the ⓘ text, control or radio orientation of a question. Each entry says why, who decided
  (agent or Kuang) and its status (review pending or accepted).

Neither file sets required, hides a field, or adds logic. The [form design rules](docs/form-design.md) say how the
compiler groups, orders and explains the questions.

For national facility 1.0 the compiler makes **28 forms with 144 questions** (19 task and event forms, 9 update forms). It does
not ask the CKD stage, because no answer to it changes the next step. It lists 15 points for the protocol author, for
example the medicine and dose that the prescription still requires after "refer". See the full mapping report:
[`protocols/rwanda-htn/build/report.md`](protocols/rwanda-htn/build/report.md).

## How it works

```
Nexo protocol + catalog ──▶ nexo-forms compile ──▶ O3 form JSON, Initializer concepts and encounter types,
        (pinned)               (build time)          binding map, CIEL list, mapping report
                                                              │
O3 server ◀── Initializer loads forms and metadata ◀──────────┘
   │
   ├── nexo backend module (.omod): stores each patient's Nexo event log, serves the bundle and binding
   └── @nexo/esm-nexo-care-app (frontend): "Care pathway" dashboard
          1. replays the patient's log with Nexo Core (in the browser, unchanged engine)
          2. lists the open tasks and what each needs
          3. opens the generated form in the stock O3 form engine, with prefill
          4. reads the saved encounter back, builds the Nexo event, appends it to the log
```

| Path | Content |
| --- | --- |
| [`packages/nexo-forms`](packages/nexo-forms) | The compiler (`compile.ts`, `reads.ts`), the patient session (`session.ts`), the browser host adapter (`host.ts`) and the server's concept dictionary (`dictionary.ts`). Tests drive the whole path through the generated forms. |
| [`packages/esm-nexo-care-app`](packages/esm-nexo-care-app) | The O3 frontend module ([README](packages/esm-nexo-care-app/README.md)). |
| [`omod`](omod) | The O3 backend module `nexo` ([REST contract](docs/omod.md)). |
| [`protocols/rwanda-htn`](protocols/rwanda-htn) | The pinned protocol, its build script, the hints file, the layout decisions file, and the generated output: production forms in `build/o3/` and `build/initializer/`, the review build in `build/o3-review/`. |
| [`distro`](distro) | Docker Compose files for the local O3 3.8.0 test bed. |
| [`scripts`](scripts) | `check.sh` (the checks), `install-ciel.ts` (make the CIEL concepts of the forms resolve on a server), `walk.ts` (walk a synthetic patient through the path) and `export-review.ts` (write [the review copy](#the-review-copy)). |
| [`docs`](docs) | The [design](docs/design.md), the [form design rules](docs/form-design.md), the [backend module contract](docs/omod.md) and the [protocol observations](docs/protocol-observations.md). |
| [`core/`](../core) | Nexo Core of this repository. The compiler and the browser import it in place. The browser prepares the bundle with `preparePinnedProtocol` ([Core workflow](../docs/system/workflows/core.md#v1-candidate-validation)). |
| [`.claude/skills/nexo-to-openmrs-forms`](../.claude/skills/nexo-to-openmrs-forms/SKILL.md) | The procedure for an agent or a person to take a new protocol to reviewed forms. |

The packages keep their names from before the move, `@nexo/forms` and `@nexo/esm-nexo-care-app`, and do not use the
`@abrazos/` scope of `demo/`. O3 loads a frontend module by its package name, so the name is part of the import map
and of the module's folder on the server.

## The protocol source

The [shared hypertension guide](../library/protocols/wip/2026-10-29-rwanda-baseline/hypertension.md) describes the
national reference and the facility SOP from merged [PR#202, hypertension facility draft](https://github.com/acompa-health/abrazos-v2/pull/202).
[`build.ts`](protocols/rwanda-htn/build.ts) imports the source document, source catalog, facility builder and
simulation trust from `library/protocols/wip/2026-10-29-rwanda-baseline/`. OpenMRS keeps no separate source copy.
The builder derives the facility catalog with `buildHypertensionFacilityCatalog(reference.protocol)`.
The national reference retains its earlier catalog. The bundle carries only the facility host extension,
so the browser can add Core's standard contracts and reproduce the same identity.

| Content | Prepared identity |
| --- | --- |
| RBCNCD24 source reference | `sha256:f57a08d143082517519b1b48fb8bcdb3fe8ddfef676c499f885ebef6d2b50448` |
| National facility 1.0 | `sha256:7b277361f58cd538b356654dce56db47ca3e6439d954aa75cd4f60f4cbb648ca` |

The assessment asks for the required `current_regimen` evidence. The clinician selects the patient's current
prescription shown above the form, or explicitly confirms no current antihypertensive medicine. The host records
that confirmation as a same-patient `htn_no_regimen_attestation`, with the assessing clinician and encounter time.
It never treats absent prescription history as that confirmation. An unanswered or "Not known" regimen retains
owned assessment. The prescription and attestation branches open different generated prescription forms.
The host looks up prescriptions from this pathway's orders. External OpenMRS drug orders still need integration.

See the [protocol README](protocols/rwanda-htn/README.md) for the full form and concept list for
[PR#8, PIH redeploy](https://github.com/acompa-health/acompa-infra/pull/8).

## The target server

The target is the PIH EMR on emr.acompahealth.com. Its configuration is in `acompa-health/acompa-infra`, folder
`hosts/nbg1/emr` (merged in its PR 7):

- the image `partnersinhealth/pihsl-emr:1.60.0`, with OpenMRS core 2.8.10, Initializer 2.12.1, o3forms 2.3.0, and the
  O3 patient chart and form engine 13.0.2-pre.12837 (a pre-release of 13.0.2);
- read-only files mounted over the image;
- module web upload is off, so the `.omod` file is mounted, never uploaded.

This folder does not deploy. [acompa-infra PR#8, EMR installation](https://github.com/acompa-health/acompa-infra/pull/8)
merged on 10 November 2026 (merge `69116f3f`). It mounts the module, the Initializer files and the protocol files.
For the server install, use its README section [Nexo care pathway](https://github.com/acompa-health/acompa-infra/tree/main/hosts/nbg1/emr#nexo-care-pathway-trial-pih-emr-only). A trial with it on 9 November 2026
walked synthetic patients through the forms. It found what the server needs:

- The REST module of the PIH EMR is `3.5.0-SNAPSHOT.9c81d7`, which openmrs-core ranks below `3.5.0`. The backend
  module therefore requires `3.5.0-SNAPSHOT` ([backend module contract](docs/omod.md)).
- Each user who fills a form needs a provider record. The form engine saves the user's provider with the encounter.
  The PIH `admin` user had none, and the form engine stopped with "Cannot read properties of null (reading 'uuid')".
- The PIH EMR already had 14 of the 16 CIEL concepts that the forms use, under PIH UUIDs with SAME-AS mappings to
  CIEL. The forms named CIEL-style UUIDs, so the install made copies, and the readings saved under the copies (the
  PIH vitals widget did not show the blood pressure). The install step also added a second SAME-AS mapping to codes
  that PIH maps already, which makes every lookup of such a code fail; 135 PIH configuration files use the lookup of
  `CIEL:1065`. The forms now use the server's own concepts ([Concepts on each server](#concepts-on-each-server)).

These steps come before the deploy:

1. Run `install-ciel.ts` on the PIH EMR before the start that first loads the Nexo Initializer files, and again
   before each restart after a build that changes `build/ciel.json`. The PIH EMR stops at the first Initializer
   error and then answers 404 to every request, so a CIEL answer that does not resolve stops the whole server.
2. Map the protocol roles to PIH roles.
3. Add the Care pathway page to the PIH chart configuration.

## The review copy

`acompa-health/nexo-openmrs` is a generated copy of this folder for readers outside this repository. The first
readers are PIH HIS, in November 2026. The copy holds `openmrs/` and only what it needs from outside: the Core files
that its code imports, the hypertension protocol files, the CIEL release that the compiler reads, and the skill.

[`scripts/export-review.ts`](scripts/export-review.ts) writes the copy and guards what leaves this repository:

- [`scripts/review-copy/outside-files.txt`](scripts/review-copy/outside-files.txt) lists the exact files that the
  copy may take from outside `openmrs/`. The export follows the imports of the code. When a new import reaches a
  file that is not in the list, the export stops and `scripts/export-review.test.ts` fails. Add the file to the list
  only when it may leave this repository.
- The export stops, and writes nothing, when a file holds text that must stay here: a default password, a key, a
  token, a filled password line or the address of a real host.
- The export needs `openmrs/`, `core/`, the protocol folder and the skill folder to equal the commit, so each copy
  matches one commit. `SOURCE.json` in the copy names it.

Nobody edits the copy by hand. To update it, run the export from a clean checkout of `main`:

```sh
git clone git@github.com:acompa-health/nexo-openmrs.git /tmp/nexo-openmrs
git -C /tmp/nexo-openmrs rm -rq --ignore-unmatch .      # the export replaces every file
bun openmrs/scripts/export-review.ts /tmp/nexo-openmrs  # from the top of this repository
git -C /tmp/nexo-openmrs add -A
git -C /tmp/nexo-openmrs commit -m "Export of abrazos-v2 <short commit>"
git -C /tmp/nexo-openmrs push
```

The copy gets its own README, notice and CI from [`scripts/review-copy/`](scripts/review-copy). Its CI runs
`scripts/check.sh` and the frontend build there, which shows that the copy needs nothing that stays behind. The
export tool is in the copy too, but it needs this repository to run. The history of the first prototype, before the
move into this repository, is in the archived `acompa-health/nexo-openmrs-archive`.

## Concepts on each server

The forms, `binding.json` and the Initializer files name each CIEL concept by its mapping, `CIEL:<code>`, never by a
UUID. Each server resolves the mapping to its own concept: the O3 reference application holds CIEL concepts under
CIEL UUIDs, and the PIH EMR holds most of them under PIH UUIDs. So a reading saved on the PIH EMR uses PIH's systolic
and diastolic concepts, and PIH's own pages show it.

- The O3 form engine resolves the mappings when it opens a form (`/ws/rest/v1/conceptreferences`). Initializer
  resolves them in the concept files.
- The care pathway resolves the binding once, when it loads, with the same request. It then reads the saved
  observations and prefills answers with the server's concepts. A server that lacks a concept stops the load with
  the missing mappings named.
- A hide condition that tests a CIEL answer cannot name the answer's UUID, which the build does not know. It tests
  the position of the chosen answer in the question's own answer list, which the form engine holds with the
  server's UUIDs.
- `scripts/install-ciel.ts` first searches each code on the server (`GET /concept?source=CIEL&code=<code>`), before
  it changes anything. It adds a CIEL concept only when no concept on the server maps to the code. Then it reuses a
  concept with the CIEL UUID, or creates one with the SAME-AS mapping. It never adds a mapping to a code that the
  server maps already, and it stops with nothing changed when the server maps a code twice. It ends by checking that
  every code resolves.
- Local Nexo concepts keep their stable UUIDs. Initializer creates them on every server.

## Run it locally

The local test bed is the O3 3.8.0 reference application in Docker (Colima on macOS works). It has the same OpenMRS
core (2.8.10) as the PIH EMR, but a different frontend and concept dictionary. Requirements: Bun 1.4.4 and Docker.
Run the commands from `openmrs/`.

```sh
bun install
cp distro/.env.example distro/.env   # then set the two database passwords in distro/.env (git ignores it)
scripts/check.sh                # types, tests, the committed build, and the backend module (Docker)
bun run build:protocol          # prepare national facility 1.0 and check its pinned identity (about a minute)
bun run compile                 # write protocols/rwanda-htn/build/

# OpenMRS 3.8.0, then the CIEL concepts, then the nexo backend module and the generated metadata
scripts/check.sh omod           # build omod/omod/target/nexo-0.1.0-SNAPSHOT.omod with Maven in Docker
docker-compose -p nexo-o3 -f distro/docker-compose.yml up -d
export OPENMRS_USER=… OPENMRS_PASSWORD=…        # an OpenMRS login
bun scripts/install-ciel.ts protocols/rwanda-htn   # when the backend answers: make each CIEL concept of the forms resolve
docker-compose -p nexo-o3 -f distro/docker-compose.yml -f distro/docker-compose.nexo.yml up -d
# Initializer loads the forms at this start. Their coded questions name CIEL answers, which resolve by now.

# Walk a synthetic patient through the path on the local test bed (optional)
bun scripts/walk.ts --name "Nexo Demo Walk"
```

`docker-compose.yml` has no default database password. docker-compose reads the two passwords from `distro/.env`,
because `distro/` holds the first Compose file of each command.

Open http://localhost:8090/openmrs/spa, log in with the demo administrator login of the O3 reference application, choose a
patient, and open **Care pathway**. The scripts read the login from `OPENMRS_USER` and `OPENMRS_PASSWORD`. The user
needs a provider record (the demo administrator has one).
To run the frontend module, see its [README](packages/esm-nexo-care-app/README.md).

To review the forms with every reason on the page, add `-f distro/docker-compose.review.yml` to the backend command
and start the backend again. Remove it and start again to go back to the production forms.

CI runs `scripts/check.sh` on every change: one job for types, tests and the build, one job for the backend module.
The first job also installs and builds the frontend module with the Node version in its
[README](packages/esm-nexo-care-app/README.md#develop).
`make test-ci` does not run these checks. Run them after a change to `openmrs/` or to `core/`.

## Limits

- The forms follow the protocol literally. The [protocol observations](docs/protocol-observations.md) list the
  places where that surprises a form designer, for example a pregnancy answer for men. A field that the task
  requires stays required on every branch, even where no rule reads it.
- O3 shows one scrolling column. It cannot put two fields side by side or show one question per screen.
- Core needs every host-launched workflow in its starting scenario, so replay seeds all launches at the start.
  A workflow launched later can see an earlier event that a table in its first state hears. No hypertension
  path depends on this.
- Replay uses the patient facts (birth date, sex) recorded with the first launch, and only those. A fact that the
  record gains later does not change the replay of the same log. So if the first launch has no birth date and a
  rule needs one, the task that asks for it cannot be completed: no form updates the patient's facts. Record the
  birth date before the first launch.
- The rules run in the browser (a decision by Kuang, 7 November 2026). The backend stores the log and does not
  check events. A production design needs server-side verification of each appended event.
- The browser skips Core's level 3 analysis. It trusts that the build ran it for the same identity. The pin detects
  a bundle that changed after the build. It does not protect against a person who can change both the bundle and
  its identity on the server.
- Roles come from the protocol's simulation trust. The O3 user acts as the simulated actor for the task's role.
- Time passes in the replay. Before each log entry, Core's clock moves to the time of that event, and after the last
  entry to the current time. So work that falls due opens its next task without a new patient event, for example
  the overdue-contact task after a missed recall. The history keeps one line for each log entry; it does not list
  the timers. A form whose encounter time is before the time a timer opened a task cannot complete that task. The
  Care pathway page reads the clock when it loads the log; reload the page to see work that fell due since.
- Lab orders and medicine orders are shown as protocol work, not as O3 orders.
- A server needs each CIEL concept that the forms name. The CIEL dictionary in O3 3.8.0 is partial, and the PIH EMR
  lacks some. The install step adds them. When a local concept already uses the CIEL name, the new concept is named
  "<name> (CIEL <code>)".
- A hide condition on a CIEL answer reads the form engine's own field list (`allFields` and the helper
  `extractRepeatingGroupValues`). These are in every form engine release since 2.0.0, but they are not a documented
  API. The tests run each hide condition in the OpenMRS expression evaluator 11.0.0, on a simulated server whose
  CIEL concepts have other UUIDs. Nobody has run them in the PIH form engine yet.
