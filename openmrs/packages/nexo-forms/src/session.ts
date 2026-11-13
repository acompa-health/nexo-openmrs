/**
 * The host side of Nexo for one patient: rebuild a Core harness from the patient's event log, report the open
 * work and workflow states, and append new entries. It runs the pinned Nexo Core unchanged. It decides nothing
 * itself: every clinical choice comes from the prepared protocol through Core.
 */
import { defineCatalog, type CatalogExtension } from '../../../../core/protocol/contracts.ts';
import { preparePinnedProtocol } from '../../../../core/protocol/validate.ts';
import { createHarness } from '../../../../core/protocol/runtime/engine.ts';
import type {
  ActorRef, ContentRef, ExecutionSnapshot, Harness, JsonValue, PreparedProtocol, ProtocolDocument, ScenarioObject,
  StepReport, TrustContext, TrustedEvent, WorkSnapshot,
} from '../../../../core/protocol/types.ts';

export type { ScenarioObject, StepReport, TrustedEvent, WorkSnapshot, JsonValue, ProtocolDocument };

/** The file the backend module serves: one prepared protocol with its catalog and simulation trust. */
export interface ProtocolBundle {
  format: 'nexo-openmrs.bundle/v1';
  note: string;
  content: ContentRef;
  document: ProtocolDocument;
  catalog: CatalogExtension;
  trust: TrustContext;
}

export interface Prepared { bundle: ProtocolBundle; protocol: PreparedProtocol; trust: TrustContext }

/** Prepare the bundle with Core and refuse it unless Core computes the identity the bundle claims. */
export function prepareBundle(bundle: ProtocolBundle): Prepared {
  const catalog = defineCatalog(bundle.catalog);
  const prepared = preparePinnedProtocol(bundle.document, catalog, bundle.content.identity);
  if (!prepared.ok) throw new Error(`The protocol does not prepare: ${JSON.stringify(prepared.diagnostics.slice(0, 3))}`);
  if (prepared.protocol.content.identity !== bundle.content.identity)
    throw new Error(`The bundle claims ${bundle.content.identity}, but Core computes ${prepared.protocol.content.identity}.`);
  return { bundle, protocol: prepared.protocol, trust: bundle.trust };
}

/** A host launch: the execution shell and the objects the start event names. */
export interface LaunchEntry {
  kind: 'launch'; execution: ExecutionSnapshot; objects: ScenarioObject[]; event: TrustedEvent;
  /** The patient facts the host supplied at the first launch; replay uses them, not today's record. */
  patient?: PatientFacts;
}
/** Any other trusted event: a task completion, a recorded measurement, a result. */
export interface EventEntry { kind: 'event'; event: TrustedEvent }
/** One stored line of the patient's log. `encounter` links the OpenMRS encounter that carried the facts. */
export type LogEntry = (LaunchEntry | EventEntry) & { seq: number; encounter?: string; user?: string; recorded_at: string };
/** A log entry before the backend gives it its sequence number. */
export type NewEntry = (LaunchEntry | EventEntry) & { encounter?: string; user?: string; recorded_at: string };

export interface PatientFacts { id: string; birth_date?: string; sex?: 'female' | 'male' }

export interface WorkflowView { execution: string; workflow: string; state?: string; ended?: string; started_at?: string }

export interface SessionView {
  open: WorkSnapshot[];
  workflows: WorkflowView[];
  records: Record<string, JsonValue[]>;
  failures: StepReport['failures'];
  reports: StepReport[];
}

const PATIENT_TYPE = 'patient';

/**
 * Replays a patient's log into a fresh harness. Core needs every host-launched execution in the starting
 * scenario, so the session collects the launch entries first, then dispatches every event in log order.
 *
 * Time passes in the replay as it did for the host. Before each entry the clock moves to the time the event was
 * received, so the work that fell due before it fires first, in order. After the last entry the clock moves to `now`,
 * the time the caller asks about, so work that is overdue now has fired. Without `now` the clock stops at the last
 * entry.
 */
export class NexoSession {
  readonly harness: Harness;
  /** One report for each log entry, in log order: `reports[i]` is what `log[i]` did. */
  readonly reports: StepReport[] = [];
  /** Every report in the order Core made it: the entry reports and the reports of the timers that fired between them. */
  readonly steps: StepReport[] = [];
  private objects: ScenarioObject[] = [];

  readonly patient: PatientFacts;

  constructor(readonly prepared: Prepared, current: PatientFacts, readonly log: readonly LogEntry[], readonly now?: string) {
    const launches = log.filter((e): e is LaunchEntry & LogEntry => e.kind === 'launch');
    // Replay must not depend on today's demographics. When a launch recorded the patient facts, they are the only
    // source: a fact that was absent then stays absent, even if the record has it now.
    const recorded = launches.find(l => l.patient)?.patient;
    const patient = this.patient = recorded ? { ...recorded, id: current.id } : current;
    const start = log[0] ? received(log[0].event) : now ?? new Date().toISOString();
    const patientObject: ScenarioObject = {
      type: PATIENT_TYPE, id: patient.id, revision: '1',
      fields: { ...(patient.birth_date ? { birth_date: patient.birth_date } : {}), ...(patient.sex ? { sex: patient.sex } : {}) },
    };
    this.objects = [patientObject, ...launches.flatMap(l => l.objects)];
    this.harness = createHarness(prepared.protocol, {
      now: start, patients: [patient.id], facts: [], work: [], objects: this.objects,
      executions: launches.map(l => l.execution),
    }, prepared.trust);
    for (const entry of log) this.dispatch(entry);
    if (now) this.advance(now);
  }

  /** Let time pass to `instant`: Core delivers each timer that falls due on the way, earliest first. */
  private advance(instant: string) {
    this.steps.push(...this.harness.advanceTo(instant));
  }

  private dispatch(entry: LogEntry): StepReport {
    this.advance(received(entry.event));
    const report = this.harness.dispatch(entry.event);
    this.reports.push(report);
    this.steps.push(report);
    return report;
  }

  /** Everything still outstanding after the last step, with its owner. */
  view(): SessionView {
    const last = this.steps.at(-1);
    const observed = this.harness.observe();
    const workflows: WorkflowView[] = [];
    // Work-policy watchers are executions too; a person sees only the protocol's workflows.
    const known = new Set(this.prepared.protocol.document.workflows.map(w => w.id));
    for (const [subject, props] of Object.entries(observed)) {
      if (!subject.startsWith('execution:')) continue;
      const read = (p: string) => (props[p]?.status === 'observed' ? props[p].value : undefined) as any;
      const ended = read('ended');
      if (!known.has(read('snapshot')?.workflow)) continue;
      workflows.push({ execution: subject.slice('execution:'.length), workflow: read('snapshot')?.workflow, state: read('state'),
        ended: ended?.outcome });
    }
    const records: Record<string, JsonValue[]> = {};
    for (const [subject, props] of Object.entries(observed)) {
      if (!subject.startsWith('execution:')) continue;
      for (const [p, o] of Object.entries(props)) if (p.startsWith('committed_records.') && o.status === 'observed' && Array.isArray(o.value))
        (records[p.slice('committed_records.'.length)] ??= []).push(...(o.value as JsonValue[]));
    }
    return {
      open: (last?.retained ?? []).filter(w => w.status === 'queued' || w.status === 'dispatched'),
      workflows, records, failures: this.steps.flatMap(r => r.failures), reports: this.reports,
    };
  }

  /** Dispatch one more entry on the live harness, as the host does after a form is saved. */
  append(entry: LogEntry): StepReport {
    if (entry.kind === 'launch') throw new Error('A launch changes the starting scenario. Rebuild the session from the log.');
    return this.dispatch(entry);
  }
}

/** The time the host received an event: the clock position for it in a replay. */
const received = (event: TrustedEvent) => event.received_at ?? event.occurred_at;

/** The simulated actor who holds `role` in the trust, and the owner that role answers to. */
export function actorFor(trust: TrustContext, role: string): { actor: ActorRef; owner: { id: string; revision: string } } {
  const grant = trust.roles.find(r => r.role === role && r.site === trust.site);
  if (!grant) throw new Error(`The trust grants no actor the role ${role}.`);
  return { actor: grant.actor as ActorRef, owner: grant.owner as { id: string; revision: string } };
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

interface EventBase { patient: string; actor: ActorRef; at: string; id?: string; objects?: ScenarioObject[] }

function envelope(type: string, b: EventBase, payload: Record<string, JsonValue>, extra: Partial<TrustedEvent> = {}): TrustedEvent {
  const id = b.id ?? nextId(type.replace(/\W/g, '-'));
  return {
    id, type, occurrence: id, scope: { patient: b.patient, subject: { type: PATIENT_TYPE, id: b.patient } }, actor: b.actor,
    occurred_at: b.at, received_at: b.at, mode: 'simulation', payload, root: id,
    receipt: { id: `receipt-${id}`, ...(b.objects?.length ? { objects: b.objects } : {}) }, ...extra,
  } as TrustedEvent;
}

/** A host launch of `workflow` with its entry bindings. The start event names the new execution. */
export function launch(prepared: Prepared, workflowId: string, b: EventBase & { bindings: Record<string, JsonValue>; execution?: string }): LaunchEntry {
  const workflow = prepared.protocol.document.workflows.find(w => w.id === workflowId);
  if (!workflow) throw new Error(`The protocol has no workflow ${workflowId}.`);
  const execution = b.execution ?? nextId('X');
  const snapshot: ExecutionSnapshot = {
    id: execution, content: prepared.protocol.content, workflow: workflowId, subject: { type: PATIENT_TYPE, id: b.patient },
    state: workflow.initial, activation: 'A1', bindings: b.bindings,
  };
  const event = envelope('workflow.started', { ...b, objects: undefined }, { entry: b.bindings },
    { occurrence: `${execution}/started`, target: { execution, activation: 'A1', content: prepared.protocol.content } } as Partial<TrustedEvent>);
  return { kind: 'launch', execution: snapshot, objects: b.objects ?? [], event };
}

/** A `task.completed` event for one open work occurrence, with the objects the form created. */
export function completion(w: WorkSnapshot, b: EventBase & { result: Record<string, JsonValue>; proof?: string }, resultDeclares: (name: string) => boolean): TrustedEvent {
  const result = { ...b.result, ...(resultDeclares('asserted_at') ? { asserted_at: b.at } : {}) };
  return envelope('task.completed', b, {
    evidence: { work: { id: w.ref.id, occurrence: w.ref.occurrence }, subject: { type: PATIENT_TYPE, id: b.patient }, performer: b.actor as unknown as JsonValue,
      performed_at: b.at, proof: b.proof ?? `openmrs-encounter` },
    result,
  }, { work: w.ref } as Partial<TrustedEvent>);
}

/** Any other host event, such as `measurement.recorded`, with its payload and attested objects. */
export function hostEvent(type: string, b: EventBase & { payload: Record<string, JsonValue> }): TrustedEvent {
  const payload = type === 'measurement.recorded' ? { asserted_at: b.at, ...b.payload } : b.payload;
  return envelope(type, b, payload);
}
