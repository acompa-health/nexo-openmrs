/** Browser-safe entry point: the session (Core replay) and the OpenMRS host adapter. No Node imports. */
export { NexoSession, prepareBundle, actorFor, launch, completion, hostEvent } from './session.ts';
export type { LogEntry, NewEntry, LaunchEntry, EventEntry, PatientFacts, Prepared, ProtocolBundle, SessionView, WorkflowView, WorkSnapshot, JsonValue, ScenarioObject } from './session.ts';
export { NexoHost, readAnswers, fromO3Value, toO3Value, normalizeInstant, humanize } from './host.ts';
export type { Binding, HostHints, FormBinding, O3Encounter, O3Obs, TaskView, Action, StartOption, ContextLine, MissingField } from './host.ts';
export { bindToServer, isMapping, mappingsOf } from './dictionary.ts';
export type { Rest } from './dictionary.ts';
