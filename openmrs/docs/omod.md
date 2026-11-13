# The `nexo` backend module

Status: working, 9 November 2026. Version `0.1.0-SNAPSHOT`. Tested on the O3 3.8.0 reference application
(openmrs-core 2.8.10, webservices.rest 3.6.0), the local test bed. The target server is the PIH EMR (image
`partnersinhealth/pihsl-emr:1.60.0`, openmrs-core 2.8.10, webservices.rest `3.5.0-SNAPSHOT.9c81d7`). The module runs
there since a trial on 9 November 2026 with [acompa-infra PR 8](https://github.com/acompa-health/acompa-infra/pull/8),
which is still open.

The two servers have different versions of the REST module. openmrs-core starts a module only when each installed
module that it requires has the required version or a later one, and it ranks a version with a qualifier below the
same version without one. `3.5.0-SNAPSHOT.9c81d7` is therefore below `3.5.0`, but not below `3.5.0-SNAPSHOT`. The
module requires webservices.rest `3.5.0-SNAPSHOT` or later (property `webservicesRestRequiredVersion` in
`omod/pom.xml`) and compiles against 3.6.0. Do not raise the minimum to 3.5.0: openmrs-core would refuse to start the
module on the PIH EMR.

## What it does

The `nexo` module is an OpenMRS backend module (`.omod`). It does two things:

1. It stores the Nexo event log of each patient, in the table `nexo_event`.
2. It serves the protocol files that the build step writes, `protocol.json` (the bundle) and `binding.json`.

The rules run in the browser, in the frontend module. This module does not run rules.

## What it does not do

- It does not run Nexo rules, and it does not decide what care comes next.
- It does not check the clinical content of an entry. It checks only the shape of each entry and the order of the log.
- It is not a clinical authority. The protocol is a draft for clinical review. It is not for care.
- It does not change the protocol files. It serves them as they are on disk.
- It does not write encounters or observations. The O3 form engine does that.

## Source

| Path | Content |
| --- | --- |
| `omod/pom.xml` | Parent POM. Module ID `nexo`, version, dependency versions. |
| `omod/api/src/main/resources/liquibase.xml` | Creates the table `nexo_event`. |
| `omod/api/src/main/resources/moduleApplicationContext.xml` | Declares the event log store (`nexo.eventLog`). |
| `omod/api/src/main/java/org/openmrs/module/nexo/api/NexoEventLog.java` | Reads and appends log entries with JDBC, in one transaction. |
| `omod/omod/src/main/resources/config.xml` | Module descriptor. Requires openmrs-core 2.8.0 or later and webservices.rest 3.5.0-SNAPSHOT or later. |
| `omod/omod/src/main/java/org/openmrs/module/nexo/web/` | The REST controllers. |
| `distro/docker-compose.nexo.yml` | Compose overlay that installs the module and the protocol files. |

## The table `nexo_event`

Each row is one entry of one patient's log.

| Column | Content |
| --- | --- |
| `id` | Row key. |
| `uuid` | Row UUID. |
| `patient_uuid` | The patient. |
| `seq` | Position in the patient's log: 0, 1, 2, and so on. |
| `kind` | `launch` or `event`. |
| `event_id`, `event_type`, `occurred_at` | Copied from `event.id`, `event.type`, `event.occurred_at`. |
| `encounter_uuid` | Copied from `encounter`. Can be empty. |
| `protocol_identity` | Copied from `execution.content.identity`, else `event.target.content.identity`. Can be empty. |
| `entry_json` | The full entry as the client sent it, with the server's `seq`. |
| `creator`, `date_created` | The user who appended the entry, and when. |

The pairs (`patient_uuid`, `seq`) and (`patient_uuid`, `event_id`) are unique. These two keys also index `patient_uuid`.

## REST contract

All paths start with `/openmrs/ws/rest/v1/nexo`. You must log in. Reads need the privilege `Get Encounters`.
Appends need `Add Encounters`. Without a login the server sends 401. Without the privilege it sends 403.

The examples use the local test bed on port 8090:

```bash
B=http://localhost:8090/openmrs/ws/rest/v1
AUTH="Authorization: Basic $(printf '%s:%s' "$OPENMRS_USER" "$OPENMRS_PASSWORD" | base64)"   # an OpenMRS login
P=9a6b7ba0-b625-4667-9ead-6a7678b37736   # a synthetic demo patient
```

### Read a patient's log

`GET /nexo/patients/{patientUuid}/log` gives the entries in `seq` order. Each entry has its `seq`.

```bash
curl -s -H "$AUTH" $B/nexo/patients/$P/log
```

```json
{"patient":"9a6b7ba0-…","entries":[{"kind":"event","event":{"id":"ev-1","type":"measurement.recorded","occurred_at":"2026-11-07T09:00:00Z"},"recorded_at":"2026-11-07T09:00:05Z","seq":0}]}
```

A patient with no log gives `"entries":[]`.

### Append to a patient's log

`POST /nexo/patients/{patientUuid}/log` with the body `{"expectedSeq": n, "entries": [ … ]}`.

- `expectedSeq` is the number of entries that the client has read. The server appends only if the log has exactly
  that many entries. The new entries get `seq` n, n + 1, and so on.
- The server appends all entries in one transaction, or none.
- Each entry needs `kind` (`launch` or `event`) and an `event` object with `id`, `type` and `occurred_at` (strings).
  A `launch` entry also needs an `execution` object and an `objects` array. `encounter`, `user` and `recorded_at`
  are optional. One append can carry 1 to 100 entries.
- The server stores each entry as sent. It adds or replaces only `seq`.
- The reply is `{"patient": …, "entries": [ … ]}` with the new entries.

```bash
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X POST $B/nexo/patients/$P/log \
  -d '{"expectedSeq":0,"entries":[{"kind":"event","event":{"id":"ev-1","type":"measurement.recorded","occurred_at":"2026-11-07T09:00:00Z","scope":{"patient":"'$P'"}},"recorded_at":"2026-11-07T09:00:05Z"}]}'
```

Errors:

| Status | Body | Cause |
| --- | --- | --- |
| 409 | `{"error":"stale","count":3}` | The log does not have `expectedSeq` entries. Read the log again, then retry. |
| 409 | `{"error":"duplicate","event":"ev-1"}` | An entry's `event.id` is already in the log, or two entries in the request have it. |
| 400 | `{"error":"invalid","message":"…"}` | The body or an entry has the wrong shape, or names another patient (`event.scope.patient`, or a launch's `execution.subject.id`, differs from the path). The message tells which entry and field. |

The server checks each entry's shape and patient first, then duplicate event IDs inside the request, then
`stale`, then event IDs already in the log. Event IDs compare exactly (byte for byte), so `ev-1` and `EV-1` differ.
A concurrent append that wins the race gives `stale`.

### List the protocols

`GET /nexo/protocols` lists each folder in `<application data>/configuration/nexo/` that has a `protocol.json`.
The server reads only the `content` object at the start of each bundle.

```bash
curl -s -H "$AUTH" $B/nexo/protocols
```

```json
[{"name":"rwanda-htn","id":"rwanda.htn_screening_assessment_2024","revision":"1.0","identity":"sha256:7c0f7a…"}]
```

### Get a bundle or a binding

`GET /nexo/protocols/{name}/bundle` gives `protocol.json`. `GET /nexo/protocols/{name}/binding` gives
`binding.json`. The server sends the file as it is on disk (`application/json`).

```bash
curl -s -H "$AUTH" $B/nexo/protocols/rwanda-htn/bundle -o protocol.json
curl -s -H "$AUTH" $B/nexo/protocols/rwanda-htn/binding -o binding.json
```

A name with `/`, `\` or `..` gives 400. A missing file gives 404 `{"error":"not_found",…}`.

## Build

There is no Java or Maven on the Mac. Build in Docker. The named volume `nexo-m2` keeps the Maven cache. The check
script runs Maven 3.9 with Temurin 21 in an image pinned by digest. CI runs the same step.

```bash
cd openmrs
scripts/check.sh omod
```

The result is `omod/omod/target/nexo-0.1.0-SNAPSHOT.omod`. The server runs Java 21 (Amazon Corretto). The module
compiles for Java 8, the same as openmrs-core 2.8.

## Install

On the PIH EMR, module web upload is off and files are mounted read-only over the image. Mount the `.omod` file and
the protocol files there in the same way as below. Do not upload the module.
[acompa-infra PR 8](https://github.com/acompa-health/acompa-infra/pull/8) does this. The paths in the PIH EMR image can
differ from the paths below.

On the local test bed, the overlay `distro/docker-compose.nexo.yml` mounts these items into the backend, read-only:

| From (in `openmrs/`) | To (in the backend) |
| --- | --- |
| `omod/omod/target/nexo-0.1.0-SNAPSHOT.omod` | `/openmrs/distribution/openmrs_modules/` |
| `protocols/rwanda-htn/build/initializer/concepts` | `/openmrs/distribution/openmrs_config/concepts/nexo` |
| `protocols/rwanda-htn/build/initializer/encountertypes` | `/openmrs/distribution/openmrs_config/encountertypes/nexo` |
| `protocols/rwanda-htn/build/initializer/ampathforms` | `/openmrs/distribution/openmrs_config/ampathforms/nexo` |
| `protocols/rwanda-htn/build` | `/openmrs/distribution/openmrs_config/nexo/rwanda-htn` |

At each start, the backend copies `/openmrs/distribution/openmrs_modules` to `/openmrs/data/modules` and
`/openmrs/distribution/openmrs_config` to `/openmrs/data/configuration`. Initializer then loads the concepts,
encounter types and forms. The module serves the files in `/openmrs/data/configuration/nexo/`.

Build the module first. If the `.omod` file is missing, Docker makes an empty folder in its place. Run
`scripts/install-ciel.ts` before this start (see the [README](../README.md#run-it-locally)): Initializer loads the
forms now, and the CIEL answers that they name must resolve.

```bash
docker-compose -p nexo-o3 -f distro/docker-compose.yml -f distro/docker-compose.nexo.yml up -d
```

This command makes a new backend container. It keeps the database and the `openmrs-data` volume. The backend
can take 2 to 5 minutes to start (about 30 seconds when the database already exists). Wait until this command
gives 200:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8090/openmrs/ws/rest/v1/session
```

After a new build, or after the protocol files change, restart the backend so that it copies the files again. When
`build/ciel.json` changed, run `scripts/install-ciel.ts` first:

```bash
docker-compose -p nexo-o3 -f distro/docker-compose.yml -f distro/docker-compose.nexo.yml restart backend
```

The copy does not remove old files. If you remove or rename a file, remove it in the `openmrs-data` volume also.

## Check the installation

- The module runs. This command shows `"started":true`:
  `curl -s -H "$AUTH" "$B/module/nexo?v=custom:(display,version,started,startupErrorMessage)"`
- On the first start, the backend log shows the Liquibase change set
  `liquibase.xml::nexo-2026-11-07-create-nexo-event::nexo ran successfully`:
  `docker logs nexo-o3-backend-1 2>&1 | grep -i nexo`.
  The module's own start message is at INFO level. The demo server logs INFO only for `org.openmrs.api`
  (global property `log.level`), so you do not see it.
- The table exists:
  `docker exec nexo-o3-db-1 sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" openmrs -e "DESCRIBE nexo_event"'`
- `GET /nexo/protocols` lists `rwanda-htn`.
