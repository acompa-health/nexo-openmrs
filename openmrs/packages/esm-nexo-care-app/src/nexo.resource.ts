/**
 * Data access for the care pathway. The protocol and its form binding load once per page. The binding names CIEL
 * concepts by mapping; it is resolved once to this server's concepts. The patient's Nexo log comes from the nexo
 * backend module. Every clinical choice comes from Nexo Core through `NexoHost`: this file only fetches, replays and
 * appends.
 */
import { useMemo } from 'react';
import useSWR, { type KeyedMutator } from 'swr';
import { openmrsFetch, restBaseUrl, usePatient } from '@openmrs/esm-framework';
import {
  bindToServer,
  NexoHost,
  prepareBundle,
  type Binding,
  type LogEntry,
  type NewEntry,
  type NexoSession,
  type O3Encounter,
  type PatientFacts,
  type ProtocolBundle,
  type Rest,
  type StartOption,
  type WorkSnapshot,
} from '../../nexo-forms/src/browser.ts';

export interface ProtocolListItem {
  name: string;
  id: string | null;
  revision: string | null;
  identity: string | null;
}

export interface LoadedProtocol {
  name: string;
  host: NexoHost;
  protocol: Binding['protocol'];
}

const nexoBase = `${restBaseUrl}/nexo`;

export const logUrl = (patientUuid: string) => `${nexoBase}/patients/${patientUuid}/log`;

let loading: { name: string; promise: Promise<LoadedProtocol> } | undefined;

/** The OpenMRS REST API, with the status of a failed call returned instead of thrown. */
const rest: Rest = async (method, path, body) => {
  try {
    const r = await openmrsFetch(`${restBaseUrl}${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return { status: r.status, body: r.data };
  } catch (e) {
    const err = e as { response?: Response; responseBody?: unknown };
    if (err.response) return { status: err.response.status, body: err.responseBody };
    throw e;
  }
};

/**
 * Load and prepare the protocol once per page. Core checks the bundle identity, and the host checks the binding. The
 * binding's CIEL mappings become this server's concept UUIDs, so that saved observations read back on any server.
 */
export function loadProtocol(configuredName: string): Promise<LoadedProtocol> {
  if (loading && loading.name === configuredName) return loading.promise;
  const promise = (async () => {
    let name = configuredName;
    if (!name) {
      const { data } = await openmrsFetch<Array<ProtocolListItem>>(`${nexoBase}/protocols`);
      if (!data?.length) throw new Error('The nexo module serves no protocol.');
      name = data[0].name;
    }
    const [bundle, binding] = await Promise.all([
      openmrsFetch<ProtocolBundle>(`${nexoBase}/protocols/${encodeURIComponent(name)}/bundle`).then((r) => r.data),
      openmrsFetch<Binding>(`${nexoBase}/protocols/${encodeURIComponent(name)}/binding`).then((r) => r.data),
    ]);
    const host = new NexoHost(prepareBundle(bundle), await bindToServer(binding, rest));
    return { name, host, protocol: binding.protocol };
  })();
  loading = { name: configuredName, promise };
  promise.catch(() => {
    if (loading?.promise === promise) loading = undefined;
  });
  return promise;
}

export function useProtocol(configuredName: string) {
  const { data, error, isLoading } = useSWR(['nexo-protocol', configuredName], () => loadProtocol(configuredName), {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: false,
  });
  return { loaded: data, error, isLoading };
}

export async function fetchLog(patientUuid: string): Promise<Array<LogEntry>> {
  const { data } = await openmrsFetch<{ entries: Array<LogEntry> }>(logUrl(patientUuid));
  return data?.entries ?? [];
}

export function useNexoLog(patientUuid: string) {
  const { data, error, isLoading, mutate } = useSWR(patientUuid ? logUrl(patientUuid) : null, () => fetchLog(patientUuid));
  return { entries: data, error, isLoading, mutate };
}

/** The patient facts Core reads: the OpenMRS patient UUID, birth date and administrative sex. */
export function patientFacts(patientUuid: string, patient?: fhir.Patient | null): PatientFacts {
  const sex = patient?.gender === 'male' || patient?.gender === 'female' ? patient.gender : undefined;
  return { id: patientUuid, ...(patient?.birthDate ? { birth_date: patient.birthDate } : {}), ...(sex ? { sex } : {}) };
}

/** The protocol, the patient, the log and the session built from them, for one patient chart. */
export function useCarePathway(patientUuid: string, configuredName: string) {
  const { loaded, error: protocolError, isLoading: protocolLoading } = useProtocol(configuredName);
  const { patient, isLoading: patientLoading, error: patientError } = usePatient(patientUuid);
  const { entries, error: logError, isLoading: logLoading, mutate } = useNexoLog(patientUuid);
  const facts = useMemo(() => (patient ? patientFacts(patientUuid, patient) : undefined), [patient, patientUuid]);
  const built = useMemo(() => {
    if (!loaded || !facts || !entries) return { session: undefined, sessionError: undefined };
    try {
      return { session: loaded.host.session(facts, entries), sessionError: undefined };
    } catch (e) {
      return { session: undefined, sessionError: e as Error };
    }
  }, [loaded, facts, entries]);
  return {
    loaded,
    patient,
    facts,
    entries,
    session: built.session,
    error: protocolError ?? patientError ?? logError ?? built.sessionError,
    isLoading: protocolLoading || patientLoading || logLoading,
    mutate,
  };
}

const ENCOUNTER_REP =
  'custom:(uuid,encounterDatetime,obs:(uuid,concept:(uuid),value,formFieldPath,groupMembers:(uuid,concept:(uuid),value,formFieldPath)))';

export async function fetchEncounter(encounterUuid: string): Promise<O3Encounter> {
  const { data } = await openmrsFetch<O3Encounter>(`${restBaseUrl}/encounter/${encounterUuid}?v=${ENCOUNTER_REP}`);
  return data;
}

/** What a saved form means for the pathway. The workspace keeps references only and finds them again in a fresh log. */
export type Recording =
  | { how: 'start'; formName: string; workflow: string; choice?: Record<string, string> }
  | { how: 'task'; formName: string; work: WorkSnapshot['ref'] }
  | { how: 'update'; formName: string; work: WorkSnapshot['ref']; object: { type: string; id: string } }
  | { how: 'event'; formName: string };

const sameRef = (a: WorkSnapshot['ref'], b: WorkSnapshot['ref']) => a.id === b.id && a.occurrence === b.occurrence;

export function openWork(host: NexoHost, session: NexoSession, ref: WorkSnapshot['ref']): WorkSnapshot | undefined {
  return host.tasks(session).find((t) => sameRef(t.work.ref, ref))?.work;
}

export function findStart(host: NexoHost, session: NexoSession, formName: string, workflow: string, choice?: Record<string, string>): StartOption | undefined {
  return host
    .starts(session)
    .find((o) => o.form.name === formName && o.workflow === workflow && JSON.stringify(o.choice ?? null) === JSON.stringify(choice ?? null));
}

class StaleLog extends Error {}

/** Core refused the entry, so it was not stored. `reasons` say why, for the person to read. */
export class RefusedEntry extends Error {
  constructor(readonly reasons: Array<string>) {
    super(reasons.join('; ') || 'Nexo Core refused this step.');
  }
}

/** Append one entry. A 409 "stale" means someone else appended first; the caller rebuilds and tries again. */
async function append(patientUuid: string, expectedSeq: number, entry: NewEntry): Promise<void> {
  try {
    await openmrsFetch(logUrl(patientUuid), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { expectedSeq, entries: [entry] },
    });
  } catch (e) {
    const err = e as { response?: Response; responseBody?: { error?: string } };
    if (err.response?.status === 409 && err.responseBody?.error === 'stale') throw new StaleLog('The log changed.');
    if (err.response?.status === 409 && err.responseBody?.error === 'duplicate') return; // already recorded
    throw e;
  }
}

/**
 * Build an entry from the latest log, let Core check it, and append it, with one retry when another user appended
 * first. `build` returns the entry for a session; it throws when the work is no longer open. An entry that Core
 * refuses is never stored: this throws `RefusedEntry` with Core's reasons.
 */
export async function appendFromLatest(host: NexoHost, facts: PatientFacts, build: (session: NexoSession) => NewEntry): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const entries = await fetchLog(facts.id);
    const session = host.session(facts, entries);
    const entry = build(session);
    const verdict = host.check(session, entry);
    if (!verdict.ok) throw new RefusedEntry(verdict.reasons);
    try {
      await append(facts.id, entries.length, entry);
      return;
    } catch (e) {
      if (e instanceof StaleLog && attempt === 0) continue;
      throw e;
    }
  }
}

/** Turn a saved encounter into a Nexo entry and append it to the patient's log. */
export async function recordEncounter(
  host: NexoHost,
  facts: PatientFacts,
  recording: Recording,
  encounterUuid: string,
  user?: string,
): Promise<void> {
  const encounter = await fetchEncounter(encounterUuid);
  const form = host.forms.get(recording.formName);
  if (!form) throw new Error(`The binding has no form ${recording.formName}.`);
  await appendFromLatest(host, facts, (session) => {
    switch (recording.how) {
      case 'start': {
        const start = findStart(host, session, recording.formName, recording.workflow, recording.choice);
        if (!start) throw new Error(`${host.label(recording.workflow)} is already running for this patient.`);
        return host.entryFor(session, form, encounter, { start, user });
      }
      case 'task': {
        const task = openWork(host, session, recording.work);
        if (!task) throw new Error('This task is no longer open. Someone may have completed it.');
        return host.entryFor(session, form, encounter, { task, user });
      }
      case 'update': {
        const collect = openWork(host, session, recording.work);
        if (!collect) throw new Error('This request for information is no longer open.');
        return host.entryFor(session, form, encounter, { update: { ...recording.object, collect }, user });
      }
      case 'event':
        return host.entryFor(session, form, encounter, { user });
    }
  });
}

/** Complete a task that asks for no answers. */
export async function confirmTask(host: NexoHost, facts: PatientFacts, ref: WorkSnapshot['ref'], user?: string): Promise<void> {
  await appendFromLatest(host, facts, (session) => {
    const work = openWork(host, session, ref);
    if (!work) throw new Error('This task is no longer open. Someone may have completed it.');
    return host.confirm(session, work, new Date().toISOString(), user);
  });
}

export type { KeyedMutator };
