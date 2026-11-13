/**
 * Protocol language v1 (`abrazos.protocol/v1`): the document model, its serialized forms, the contract catalog and the
 * shared validation, preparation, execution and conformance signatures. Plain shapes, stored as JSON. Conditions are
 * text in the one grammar of core/logic. The named catalog and reason codes are in contracts.ts.
 * Source: the integrated v1 contract (docs_local/protocol-format/v1/contract-resolution/resolved-contract.md).
 */
import type { Quantity } from '../logic/index.ts';
import type { EFFECT_KINDS, FAILURE_CLASSES, PROTOCOL_FORMAT, TABLE_PURPOSES } from './contracts.ts';
export type { Quantity };

/** A nonempty opaque identifier. */
export type Id = string;
/** An opaque equality token, never a counter the caller computes. */
export type Revision = string;
export type EventId = Id;
export type RequestId = EventId;
/** An RFC 6901 pointer into authored content: `/workflows/0/tables/1/rules/0/when`. */
export type JsonPointer = string;
/** A stable semantic path that survives reordering: `workflow:booking_preparation/table:request_preparation/rule:request_preparation`. */
export type SemanticId = string;
/** A condition in the core/logic grammar: `bp.systolic >= 180 mmHg and not pregnant`. */
export type Condition = string;
/** An ISO 8601 datetime with an explicit offset. */
export type Instant = string;
/** `YYYY`, `YYYY-MM`, `YYYY-MM-DD` (precision kept) or an Instant. */
export type Time = string;
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

// Shared serialized references. The target kind fixes the shape; unlike kinds are not interchangeable.
/** A clinical object at a revision when one matters. */
export interface ObjectRef { type: Id; id: Id; revision?: Revision }
/** Effective immutable content: `identity` is computed over the content and its resolved imports, never supplied as proof. */
export interface ContentRef { protocol: Id; revision: Revision; identity: string }
export type DefinitionRef = { content: ContentRef; workflow: Id } | { content: ContentRef; policy: Id };
export interface ActorRef { id: Id; kind: 'human' | 'service' | 'simulation' }
/** A resolved responsibility binding; an authored `{role}` must resolve to one. */
export interface OwnerRef { id: Id; revision: Revision }
/** A work occurrence; `revision` is added for a checked edit. */
export interface WorkRef { id: Id; occurrence: Id; revision?: Revision }
/** An exact captured work-policy version. */
export interface PolicyRef { id: Id; revision: Revision }
export interface ExecutionRef { id: Id; content: ContentRef }
export interface ActivationRef { execution: Id; activation: Id }
export type ReferenceKind = 'object' | 'content' | 'definition' | 'actor' | 'owner' | 'work' | 'execution' | 'activation' | 'event';
export interface RoleSpec { role: Id }

/** Typed scalars, composites and named records. One descriptor is used everywhere a type is declared. */
export type TypeDescriptor =
 | { type: 'yes_no' }
 | { type: 'listed'; values: readonly string[]; ordered?: boolean }
 | { type: 'count' } | { type: 'number' }
 | { type: 'quantity'; unit: string }
 | { type: 'date' } | { type: 'datetime' } | { type: 'time' } | { type: 'instant' }
 | { type: 'text' } | { type: 'identifier' } | { type: 'revision' }
 | { type: 'context' }
 /** `object:<type>` names a catalog object type; `work:<template>` names a task template and exposes its captured content. */
 | { type: 'reference'; target: ReferenceKind | `object:${string}` | `work:${string}` }
 | { type: 'list'; items: TypeDescriptor }
 | { type: 'window'; of: TypeDescriptor }
 | { type: 'record'; record: Id };
export type TypeName = TypeDescriptor['type'];
/** A record field or payload field; `none` permits a known attributed absence `{none: reason}`. */
export interface FieldDecl { type: TypeDescriptor; optional?: true; none?: true; term?: Id; label?: string }
/** A raw ingress field. Control fields must pass routing/preflight; only information may resolve to unknown. */
export interface SourceFieldDecl { type: TypeDescriptor; role: 'information' | 'control'; optional?: true; term?: Id; label?: string }
/** A named raw source and the normalized event it produces. The event contract types the normalized payload. */
export interface SourceContract { event: Id; fields: Readonly<Record<string, SourceFieldDecl>> }

/**
 * A value template: a JSON scalar literal, an array/map of templates, or exactly one reserved expression.
 * Bare strings are literals, never names. An object with a reserved key is one exact expression or escaped as `{value}`.
 */
export type ValueTemplate =
 | null | boolean | number | string
 | { value: JsonValue } | { input: string } | { binding: string } | { effect: Id }
 | readonly ValueTemplate[] | { readonly [key: string]: ValueTemplate };

/** The data-source forms of an input's `binding`. */
export type SourceSelector =
 | string
 | { latest: Id; of: string; in?: string; before?: string; field?: string }
 | { earliest: Id; of: string; in?: string; before?: string; field?: string }
 | { exists: Id; in: 'this_execution' } | { exists: Id; of: string }
 | { unique: Id; of: string }
 | { content: Id; key: string; field: string } | { content: Id; entry: string; field: string };

export interface InputDecl {
 /** Omitted only where a pinned source contract supplies the type. */
 type?: TypeDescriptor;
 /** Shared clinical term, resolved in the pinned catalog. A workflow field instead supplies its own label. */
 term?: Id;
 label?: string;
 binding: SourceSelector;
 /** Workflow inputs: `entry | optional`. Table inputs: `decision | optional`, default `decision`. Metadata; it never changes truth. */
 required?: 'entry' | 'decision' | 'optional';
 /** Site-supplied resource metadata. The input name, type and binding remain the only fact declaration. */
 resource?: LocalResource;
}

export interface LocalResource {
 /** Expected update frequency, not a cache or freshness guarantee. */
 updates: 'deployment' | 'case';
 supplied_by: string;
}
/** Resource dependencies of one evaluation, captured with its input snapshot. */
export interface ResourceRead extends LocalResource {
 binding: SourceSelector;
 value: ResolvedInput;
 mode: 'live' | 'simulation';
}

/** A calculation operand: the same vocabulary as effect values. */
export type Operand = { input: string } | { value: JsonValue };
/** Named pure calculations; forms do not nest, so intermediate results are named. */
export type Calculation =
 | { when: Condition }
 | { cases: readonly { when: Condition; value: Operand }[] }
 | { multiply: readonly [Operand, Operand] }
 | { min: readonly Operand[] }
 | { change_percent: { from: Operand; to: Operand } }
 | { elapsed: { from: Operand; to: Operand; unit: 's' | 'min' | 'h' | 'd' | 'wk' | 'mo' | 'a'; basis: 'duration' | 'calendar'; dates_in?: string } }
 | { all_completed: readonly Operand[] };

// The document.
export interface ProtocolDocument {
 format: typeof PROTOCOL_FORMAT;
 id: Id; revision: Revision;
 /** A label, never authority. */
 status: string;
 imports?: readonly ContentRef[];
 roles?: Readonly<Record<Id, { title: string; terms?: readonly Id[] }>>;
 definitions?: ProtocolDefinitions;
 workflows: readonly Workflow[];
 evidence?: Readonly<Record<Id, Evidence>>;
 /** Default SOP choices. Ordinary rule rows name the choices they implement. */
 sops?: Readonly<Record<Id, Sop>>;
 /** The effective local content carries each authored difference from its named base revision. */
 overrides?: readonly LocalOverride[];
}
export interface Evidence { kind: string; note?: string; locator?: string; hash?: string }
export interface Sop {
 title: string;
 basis: 'source_fits' | 'source_adapted' | 'source_unclear' | 'local_choice';
 evidence: readonly Id[];
 note: string;
 /** Review label only; never a grant of clinical authority. */
 status: string;
}
export interface LocalOverride {
 kind: 'sop' | 'pilot' | 'study';
 /** Required for an SOP replacement. */
 sop?: Id;
 base?: string;
 element: JsonPointer;
 original: JsonValue;
 replacement: JsonValue;
 site: Id;
 author: Id;
 rationale?: string;
 status?: string;
}
export interface ProtocolDefinitions {
 inputs?: Readonly<Record<string, InputDecl>>;
 calculations?: Readonly<Record<string, Calculation>>;
 parameters?: Readonly<Record<string, { type: TypeDescriptor; value: JsonValue }>>;
 content?: Readonly<Record<Id, { key: TypeDescriptor; entries: Readonly<Record<string, Readonly<Record<string, JsonValue>>>> }>>;
 events?: Readonly<Record<Id, EventContract>>;
 records?: Readonly<Record<Id, RecordContract>>;
 tables?: Readonly<Record<Id, Table>>;
 work_templates?: Readonly<Record<Id, WorkTemplate>>;
 work_policies?: Readonly<Record<Id, WorkPolicy>>;
 fallback?: Fallback;
}

export interface Workflow {
 id: Id;
 /** The identified subject's object type. */
 subject: Id;
 /** Names a subject input with a direct `entry.*` binding. Only this lifecycle records its object's stage. */
 lifecycle_of?: { binding: string };
 inputs: Readonly<Record<string, InputDecl>>;
 calculations?: Readonly<Record<string, Calculation>>;
 initial: Id;
 states: readonly StateDecl[];
 fallback?: Fallback;
 tables: readonly Table[];
}
export interface StateDecl { id: Id; title: string; decision?: DecisionDecl }
export interface DecisionDecl { question: string; authority: Authority }
export type Authority = { kind: 'role'; role: Id } | { kind: 'protocol'; authorization?: { id: Id } };

export type TablePurpose = typeof TABLE_PURPOSES[number];
export type HitPolicy = 'unique' | 'priority';
/** Runtime outcomes that a handler owns. */
export type FailureClass = typeof FAILURE_CLASSES[number];
/** Failure class → handler table ID; the nearest scope replaces an outer one. */
export type Fallback = Partial<Readonly<Record<FailureClass, Id>>>;

/** An explicit subscription: one event type, optionally scoped to a binding or a work handle. */
export interface Trigger { event: Id; for?: { binding: string }; work?: string; table?: Id }
export interface RequestContract {
 fixed: Readonly<Record<string, { target: ReferenceKind | `object:${string}` }>>;
 collected: Readonly<Record<string, { target: ReferenceKind | `object:${string}`; optional?: true }>>;
}
export interface Table {
 id: Id;
 purpose: TablePurpose;
 on: Trigger;
 inputs?: Readonly<Record<string, InputDecl>>;
 /** Default `unique`. */
 hit?: HitPolicy;
 /** Required, nonempty, for `priority`. */
 precedence_evidence?: readonly Id[];
 /** For a resumable decision table. */
 request?: RequestContract;
 fallback?: Fallback;
 /** Typed local aliases (`failure`, `request`); never shadow a reserved root. */
 aliases?: Readonly<Record<string, string>>;
 rules: readonly TableRule[];
}
/** The one rule shape. */
export interface TableRule {
 id: Id;
 /** State IDs; `["*"]` is allowed only in a shared handler definition and checked at each use site. */
 in: readonly Id[];
 when: Condition;
 /** Positive integer, 1 highest; only in `priority` tables. */
 rank?: number;
 effects: readonly Effect[];
 to: RuleTarget;
 evidence: readonly Id[];
 /** SOP choices implemented by this row. */
 sops?: readonly Id[];
}
/** A care destination, not an instruction to start an execution or proof of arrival. */
export interface Handoff {
 level: Id;
 /** A local workflow ID, an unchecked external reference, or the reserved literal `unspecified`. */
 pathway: Id | { document: Id; workflow: Id };
 /** Required when pathway is `unspecified`. */
 description?: string;
}
/** A named handoff lands on the receiving workflow's `initial` state after confirmed arrival. */
export type RuleTarget = { state: Id } | { stay: true } | { end: Id; handoff?: Handoff };

// The seven effects.
export type EffectKind = typeof EFFECT_KINDS[number];
interface EffectBase { id: Id; when?: Condition; /** An approved consequence this administrative effect cites. */ decision?: { effect: Id } | { record: ValueTemplate } }
/** Due offsets have their own schema: a direct time quantity or a named value that resolves to one. */
export type DueOffset = Quantity | { input: string } | { binding: string } | { effect: Id };
/** A due specification: one anchor plus an exact offset or window. Offsets are nonnegative. */
interface DueBase {
 from: { event: 'trigger' } | { input: string } | { work: string; field: string };
 basis: 'duration' | 'calendar';
 zone?: string;
}
export type Due = DueBase & (
 | { after: DueOffset; before?: never; window?: never }
 | { before: DueOffset; after?: never; window?: never }
 | { window: { min: DueOffset; max: DueOffset }; after?: never; before?: never }
);
/** The effective work fields; typed templates supply defaults. */
export interface WorkFields {
 owner?: RoleSpec | { binding: string };
 performer?: RoleSpec | { binding: string };
 policy?: PolicyRef;
 due?: Due;
 lifetime?: 'execution' | 'independent';
 purpose?: string;
 as?: string | { handle: string; replace: true };
 occurrence?: ValueTemplate;
}
export interface RecordEffect extends EffectBase { kind: 'record'; record: Id; fields: Readonly<Record<string, ValueTemplate>>; for?: ValueTemplate; as?: string }
export interface PublishEffect extends EffectBase, WorkFields { kind: 'publish'; record: ValueTemplate; to: ValueTemplate }
/** A maximum for one quantity field of an order's captured content, checked before any effect commits. */
export interface OrderLimit { field: Id; maximum: ValueTemplate }
export interface OrderEffect extends EffectBase, WorkFields { kind: 'order'; order: 'laboratory' | 'prescription' | 'referral'; for: ValueTemplate; content: Readonly<Record<string, ValueTemplate>>; limits?: readonly OrderLimit[] }
export interface TaskEffect extends EffectBase, WorkFields { kind: 'task'; task: Id; for: ValueTemplate; content?: Readonly<Record<string, ValueTemplate>> }
/**
 * Ask the completed task that `reissue.handle` binds now again, as a new occurrence of the same template on that handle.
 * It carries the subject, current owner, pinned policy, lifetime, effective performer and captured content; `content`
 * names overrides only. Due is never carried.
 */
export interface ReissueTaskEffect extends EffectBase { kind: 'task'; task: Id; reissue: { handle: string }; content?: Readonly<Record<string, ValueTemplate>>; due?: Due; occurrence?: ValueTemplate }
interface StartBase extends EffectBase { kind: 'start'; definition: DefinitionRef | { workflow: Id }; for: ValueTemplate; bindings: Readonly<Record<string, ValueTemplate>>; as?: string }
/** `new` inherits the commissioner's owner only when owner is omitted; `bind` only checks an existing instance. */
export type StartEffect =
 | (StartBase & { mode: 'new'; instance?: ValueTemplate; owner?: WorkFields['owner']; lifetime?: WorkFields['lifetime']; purpose?: string; predecessor?: ValueTemplate })
 | (StartBase & { mode: 'bind'; instance: ValueTemplate; allow_ended?: true });
export interface EmitEffect extends EffectBase { kind: 'emit'; event: Id; fields: Readonly<Record<string, ValueTemplate>>; for?: ValueTemplate; to?: ValueTemplate; activation?: 'current' | 'destination' }
/** A bound WorkRef value, or a handle with an optional explicit occurrence. */
export type WorkSelector = ValueTemplate | { handle: string; occurrence?: ValueTemplate };
interface ChangeBase extends EffectBase { kind: 'change_work'; work: WorkSelector; expected_revision: ValueTemplate }
export type ChangeWorkEffect =
 | (ChangeBase & { operation: 'reschedule'; due: Due })
 | (ChangeBase & { operation: 'rebind'; set: Partial<Readonly<Record<'subject' | 'anchor' | 'owner' | 'lifetime' | 'purpose', ValueTemplate>>>; due?: Due; acceptance?: ValueTemplate; replacement?: ValueTemplate })
 | (ChangeBase & { operation: 'satisfy'; evidence: ValueTemplate })
 | (ChangeBase & { operation: 'cancel'; reason: ValueTemplate })
 | (ChangeBase & { operation: 'retry'; attempt: ValueTemplate });
export type ChangeOperation = ChangeWorkEffect['operation'];
export type Effect = RecordEffect | PublishEffect | OrderEffect | TaskEffect | ReissueTaskEffect | StartEffect | EmitEffect | ChangeWorkEffect;

// Reusable definitions.
export interface EventContract { payload: Readonly<Record<string, FieldDecl>> }
export interface RecordContract {
 fields: Readonly<Record<string, FieldDecl>>;
 /** The object type a record of this schema is for, when it has a subject. */
 subject?: Id;
 /** This record changes the clinical object's stage and needs its designated lifecycle owner. */
 stage?: true;
 /** Fields that are protected clinical writes: only an authorized decision may set them. */
 protected?: readonly string[];
}
export interface WorkTemplate {
 title: string;
 performer?: RoleSpec;
 /** Every completion report is the standard `task.completed` event; `evidence` says what it must identify. */
 completion: { evidence: string; delivery?: { content: Id; recipient: Id } };
 /** Captured once, when the work is created; it belongs to the work occurrence. */
 content?: Readonly<Record<string, FieldDecl>>;
 /** What a completion report returns in `task.completed.payload.result`, typed by the template of the reported work. */
 result?: Readonly<Record<string, SourceFieldDecl>>;
 /** A care-directing task: only an authorized decision may create it. */
 protected?: true;
}
/** Ordinary versioned table content captured per work occurrence. */
export interface WorkPolicy {
 id: Id; revision: Revision;
 subject: 'task' | 'order' | 'publication';
 inputs: Readonly<Record<string, InputDecl>>;
 initial: Id;
 states: readonly StateDecl[];
 fallback?: Fallback;
 tables: readonly Table[];
 waiting?: Readonly<Record<Id, { limit: string; owner: RoleSpec | { binding: string }; reason: string; approval: string; evidence: readonly Id[] }>>;
}

/** A selected shared dictionary entry. Its meaning and mapping qualifiers remain part of the pinned content. */
export interface SharedTerm {
 label: string;
 kind: string;
 scope: string;
 meaning: string;
 unit?: string;
 values?: readonly string[];
 ordered?: boolean;
 range?: readonly number[];
 unknown?: string;
 payload?: JsonValue;
 map: Readonly<Record<string, JsonValue>>;
}
/**
 * The pinned contracts a document is checked and run against: named input types, source contracts, event payloads,
 * reference kinds, record/order/task templates, work policies, protected clinical writes and reason codes.
 * Code and data refer to these names; nothing adds a kind silently.
 */
export interface ContractCatalog {
 /** Selected entries from core/vocabulary/concepts. Omitted for documents that have not migrated. */
 readonly terms?: Readonly<Record<Id, SharedTerm>>;
 readonly references: Readonly<Record<ReferenceKind, { required: readonly string[]; optional: readonly string[]; exactlyOneOf?: readonly string[] }>>;
 /** Named raw ingress sources; each field explicitly declares information or identity/control. */
 readonly sources: Readonly<Record<Id, SourceContract>>;
 /** Named object kinds (`appointment`, `prescription`): the fields a typed traversal may read. */
 readonly objects: Readonly<Record<Id, { fields: Readonly<Record<string, FieldDecl>> }>>;
 /** Named registry views for `{exists, of}`: exact scope and completeness/freshness requirements. */
 readonly registries: Readonly<Record<Id, { of: Id; record: Id; completeness: string }>>;
 readonly events: Readonly<Record<Id, EventContract>>;
 readonly records: Readonly<Record<Id, RecordContract>>;
 /** Per order kind: typed content and its protected fields; `*` makes the whole order a protected clinical write. */
 readonly orders: Readonly<Record<'laboratory' | 'prescription' | 'referral', { content: Readonly<Record<string, FieldDecl>>; protected: readonly string[] }>>;
 readonly tasks: Readonly<Record<Id, WorkTemplate>>;
 readonly policies: Readonly<Record<Id, WorkPolicy>>;
 readonly reasons: { readonly static: Readonly<Record<string, { level: 1 | 2 | 3 }>>; readonly runtime: readonly string[] };
}

// Facts.
/** A resolved input: known with its value, or unknown with a reason. Never a reserved value spelling. */
export type ResolvedInput =
 | { state: 'known'; value: JsonValue; source?: Id; revision?: Revision }
 | { state: 'unknown'; reason: string; detail?: string; source?: Id; revision?: Revision };
/** An embedded fact under its declared type. */
export interface Fact { id: Id; revision: Revision; value: ResolvedInput; provenance: { event?: EventId; actor?: ActorRef; source?: Id } }

// Events.
export interface Event<P = Readonly<Record<string, JsonValue>>> {
 id: EventId; type: Id; occurrence: Id;
 /** `subject` is omitted only by an authenticated top-level `workflow.started` intake whose subject is unresolved. */
 scope: { patient: Id; subject?: ObjectRef; cases?: readonly Id[] };
 actor: ActorRef; occurred_at: Time; received_at: Instant;
 mode: 'live' | 'simulation';
 payload: P;
 work?: { id: Id; occurrence: Id; revision: Revision; attempt?: Id };
 target?: { execution: Id; activation?: Id; content?: ContentRef };
 caused_by?: EventId; root: EventId; corrects?: EventId;
}
/** An event normalized by a trusted ingress adapter: attribution, receipt, mode and causal fields are the host's. */
export interface TrustedEvent extends Event {
 readonly receipt: {
  id: Id; duplicate_of?: EventId;
  /**
   * Host-attested: the actor whose act this event carries, the event that recorded the act, and the evidence that binds
   * them. Only the trusted ingress adapter sets it. An actor ID copied into a payload or an emitted field is not enough.
   */
  actor_attribution?: { actor: ActorRef; source_event: EventId; evidence: Id };
  /**
   * Host-attested: object revisions the host recorded with this event, such as the booking revision a reschedule
   * announces. The harness checks each against its object contract and applies it once, before routing.
   */
  objects?: readonly ScenarioObject[];
  /** Clinical records the host committed with this event; available to this event's evaluation after ingress. */
  history?: readonly HistoryRecord[];
  stage_confirmation?: StageConfirmation;
 };
}
/** `decision.requested`: its event ID is the request ID. */
export interface DecisionRequestPayload {
 table: Id; step: Id; actor: ActorRef; source_event: EventId;
 fixed: Readonly<Record<string, JsonValue>>;
 collected: Readonly<Record<string, JsonValue>>;
 resume_from?: RequestId; supersedes?: RequestId;
}
/** What a fallback handler receives (`evaluation.failed`), bound to the typed `failure` alias. */
export interface FailurePayload {
 attempt: Id; event: EventId; table: Id;
 /** Authenticated actor on the original event, before the engine creates this failure event. */
 actor: ActorRef;
 reason: FailureClass; code?: string;
 stage: 'routing' | 'selection' | 'authority' | 'effects' | 'commit';
 subject?: ObjectRef; owner?: OwnerRef;
 request?: RequestId;
 /** The occurrence of an applied work report that the original attempt failed on. Identity only. */
 work?: WorkRef;
 /**
  * The refused proposal: only on a `not_authorized` authority failure of a task completion that ingress applied and
  * verified (the evidence performer is the authenticated actor). `actor` is that authenticated actor; `result` is the
  * result checked against the occurrence's template, an unknown field spelled `{unknown: reason}`. It is attributed
  * evidence of what was proposed, never an approval.
  */
 report?: { actor: ActorRef; result: Readonly<Record<string, JsonValue>> };
 expected_revision?: Revision; actual_revision?: Revision;
 conflict?: readonly Id[];
 unknown_inputs?: readonly string[];
 /** Each blocking calculation → its blocking declared dependencies, with their requiredness. */
 blocking?: Readonly<Record<string, readonly { input: string; required: 'decision' | 'optional' | 'entry' }[]>>;
}

// Static validation.
export interface Diagnostic {
 level: 1 | 2 | 3;
 severity: 'error' | 'warning' | 'info';
 reason: string;
 at: JsonPointer;
 id: SemanticId;
 message: string;
 /** Condition offsets, concrete witnesses, expected/actual values. */
 data?: Readonly<Record<string, JsonValue>>;
}
export type AnalysisStatus = 'complete' | 'incomplete' | 'not_run';
export interface AnalysisReport {
 analysis: Id; table?: SemanticId; status: AnalysisStatus; domain?: string; limits?: string;
 /** Only identifier/revision comparisons between names limit this completed sample search. */
 sampledOnly?: true;
}
export interface ValidationReport {
 /** Null when the document is not a readable v1 document. */
 content: ContentRef | null;
 contracts: readonly Id[];
 diagnostics: readonly Diagnostic[];
 /** Invalid prerequisites mark dependent analyses `not_run`, never a clean empty result. */
 analyses: readonly AnalysisReport[];
}
declare const prepared: unique symbol;
/** A checked document with its catalog resolved. Only prepareProtocol and preparePinnedProtocol make one; it implies no clinical approval. */
export interface PreparedProtocol {
 readonly [prepared]: true;
 readonly document: ProtocolDocument;
 readonly content: ContentRef;
 readonly catalog: ContractCatalog;
 readonly report: ValidationReport;
}
export type PreparationResult = { ok: true; protocol: PreparedProtocol } | { ok: false; diagnostics: readonly Diagnostic[] };

// Execution.
/** Host-supplied authority: no protocol content or event can manufacture any of it. */
export interface TrustContext {
 mode: 'live' | 'simulation';
 site: Id;
 /** One root's internally caused delivery attempts; the conformance profile uses 64. */
 max_internal_steps: number;
 roles: readonly { role: Id; actor: ActorRef; owner: OwnerRef; site: Id; credentials?: readonly Id[] }[];
 authorizations: readonly { id: Id; revision: Revision; content: ContentRef; scope: { workflow: Id; state: Id }; site: Id; mode: 'live' | 'simulation'; valid?: { from?: Instant; until?: Instant } }[];
 acceptances?: readonly { id: Id; offer: Id; scope: WorkRef; to: OwnerRef; actor: ActorRef }[];
}
export interface ExecutionSnapshot { id: Id; content: ContentRef; workflow: Id; subject?: ObjectRef; state: Id; activation: Id; ended?: { outcome: Id; event: EventId; at: Instant }; bindings: Readonly<Record<string, JsonValue>> }
/** The object revision a due anchor read: the input, the reference binding it traversed and the object at its revision. */
export interface DueAnchor { input: string; binding: string; object: ObjectRef & { revision: Revision } }
export interface WorkSnapshot { ref: WorkRef & { revision: Revision }; kind: 'task' | 'order' | 'publication'; template: Id; subject: ObjectRef; owner: OwnerRef; status: 'queued' | 'dispatched' | 'completed' | 'failed' | 'cancellation_requested' | 'cancelled'; due?: { revision: Revision; at?: Instant; window?: { min: Time; max: Time }; anchor?: DueAnchor }; lifetime: 'execution' | 'independent'; commissioned_by: ExecutionRef; policy: PolicyRef; /** The resolved content captured at creation. */ content?: Readonly<Record<string, JsonValue>> }
/**
 * A decision request the host attests from earlier history. A pending one fills its slot; a retired one is history only.
 * `actor` is historical attribution, not a grant: authority is checked again at the resumed decision. `work` names the
 * collection occurrences that serve this request; each must resolve to an occurrence of the same execution and subject
 * whose captured content names the request.
 */
export interface ScenarioRequest {
 execution: Id; activation: Id; table: Id; request: RequestId;
 status: 'pending' | 'retired'; reason?: string;
 actor: ActorRef; source_event: EventId;
 fixed: Readonly<Record<string, JsonValue>>; collected?: Readonly<Record<string, JsonValue>>;
 work?: readonly WorkRef[];
}
/** A host-attested cancellation request retained for one exact work occurrence. */
export interface ScenarioCancellation { work: Pick<WorkRef, 'id' | 'occurrence'>; event: EventId; reason: JsonValue }
/** A work handle with its current binding and its earlier bindings, oldest first. */
export interface ScenarioHandle { execution: Id; handle: string; current: WorkRef; previous: readonly WorkRef[] }
/** Correlation retained for a host to persist a lifecycle stage change. */
export interface StageHandoff { record: Id; record_type: Id; fields: Readonly<Record<string, JsonValue>>; effect: Id; attempt: Id; execution: Id; content: ContentRef; subject: ObjectRef; stage: JsonValue; expected_revision: Revision }
/** A trusted receipt names every record in the atomic stage change and the resulting case revision. */
export interface StageConfirmation { handoffs: readonly StageHandoff[]; object: ScenarioObject }
/** A host-attested record already committed before the first event. */
/** A host-attested record already committed before the first event. */
export interface ScenarioRecord { id: Id; record: Id; fields: Readonly<Record<string, JsonValue>>; execution: Id; attempt: Id; effect: Id; handoff?: StageHandoff }
/** One revision of a host object, with the fields its catalog object contract declares. */
export type ScenarioObject = ObjectRef & { revision: Revision; fields: Readonly<Record<string, JsonValue>>; superseded_by?: Revision; superseded_event?: Id };
/** A host-attested clinical record available before the first event. */
export interface HistoryRecord {
 kind: Id; id: Id; revision: Revision; of: ObjectRef; at: Time;
 encounter?: Id; retracted?: boolean;
 fields: Readonly<Record<string, JsonValue>>;
}
/** A named registry view's response for one scope. Only `complete` with no match proves no. */
export interface RegistryResponse { of: ObjectRef; status: 'complete' | 'partial' | 'stale' | 'unavailable'; matches: readonly ObjectRef[] }
/** The world before the first event: objects, facts, executions and work. */
export interface ScenarioState {
 now: Instant;
 patients: readonly Id[];
 objects: readonly ScenarioObject[];
 facts: readonly Fact[];
 executions: readonly ExecutionSnapshot[];
 work: readonly WorkSnapshot[];
 records?: readonly ScenarioRecord[];
 /** Host-persisted confirmations, restored with handoff-bearing records and case revisions. */
 stage_confirmations?: readonly StageConfirmation[];
 /** Host-attested clinical records and registry responses already available at setup. */
 history?: readonly HistoryRecord[];
 registries?: Readonly<Record<Id, RegistryResponse>>;
 /** Host-attested request slots and handle history that executions and work cannot express. */
 requests?: readonly ScenarioRequest[];
 handles?: readonly ScenarioHandle[];
 /** Cancellation requests the host retained before this run, keyed by exact work occurrence. */
 cancellations?: readonly ScenarioCancellation[];
}
export type SelectionResult =
 | { result: 'selected';
     /** Stable representative whose identical consequence is executed once. */
     rule: Id;
     /** All true triggers in code-point order, including `rule`, when several share that consequence. */
     rules?: readonly Id[] }
 | { result: 'ambiguous'; conflict: readonly Id[] }
 | { result: 'unresolved'; unknown_inputs: readonly string[] }
 | { result: 'unmatched' };
/** One attempt of one execution on one event. */
export interface AttemptReport {
 id: Id; event: EventId; execution: Id; activation: Id; table?: Id; request?: RequestId;
 /** Before a table is evaluated. */
 routing?: 'not_enabled' | 'unsubscribed' | 'duplicate' | 'rejected';
 /** `true`, `false` or `unknown` per enabled row. */
 row_truth?: Readonly<Record<Id, 'true' | 'false' | 'unknown'>>;
 selection?: SelectionResult;
 resolved?: Readonly<Record<string, ResolvedInput>>;
 resources?: Readonly<Record<string, ResourceRead>>;
 authority?: { decision: 'granted'; grant: { id: Id; revision: Revision } } | { decision: 'not_authorized'; reason: string };
 outcome: 'committed' | 'refused' | 'not_enabled' | 'unsubscribed' | 'duplicate' | 'rejected';
 failure?: { class: FailureClass; stage: FailurePayload['stage']; reason: string; data?: Readonly<Record<string, JsonValue>> };
 /** The handler attempt that owns this failure. */
 handled_by?: Id;
}
export type CommittedEffect = { attempt: Id; effect: Id; kind: EffectKind; result: JsonValue };
/** An outgoing intent, delivered after commit; acceptance is not completed care. */
export interface Intent { attempt: Id; effect: Id; kind: 'publish' | 'order' | 'task' | 'emit' | 'start'; event?: EventId; work?: WorkRef; /** Resolved publication content and accountable owner, captured at commit. */ record?: JsonValue; to?: JsonValue; owner?: OwnerRef }
export interface StepReport {
 event: EventId;
 root: EventId;
 /** Facts and verified work reports retained on ingestion, before routing. */
 ingested: readonly Fact[];
 attempts: readonly AttemptReport[];
 committed: readonly CommittedEffect[];
 intents: readonly Intent[];
 /** Immutable internal envelopes produced by committed effects, including ones later quarantined by the step limit. */
 generated: readonly TrustedEvent[];
 /** Stage changes recorded in this step, awaiting durable host confirmation. */
 stage_handoffs?: readonly StageHandoff[];
 /** Owned failures and operational issues, including step-limit exhaustion. */
 failures: readonly { attempt?: Id; reason: string; owner?: OwnerRef; data?: Readonly<Record<string, JsonValue>> }[];
 /** Work that stays outstanding and its accountable owner. */
 retained: readonly WorkSnapshot[];
 /** Internal events quarantined at the step limit. */
 quarantined?: readonly EventId[];
}
/** A value an observable has, or why it has none. The observable's contract defines what absence is. */
export type Observation = { status: 'observed'; value: JsonValue } | { status: 'not_observable'; reason: string };
/** Canonical case vocabulary: subject (`execution:X-w1`) → property (`committed_records.decision_outcome`) → observation. */
export interface Observations { readonly [subject: string]: { readonly [property: string]: Observation } }
/** Making a content available is not a state transition: no execution, work or due changes. */
export type DeployReport = { outcome: 'deployed' | 'already_available'; content: ContentRef } | { outcome: 'refused'; reason: string };
/** A read-only comparison of two available contents, by JSON Pointer into their documents. */
export type ComparisonReport = { from: ContentRef; to: ContentRef; changes: readonly { at: JsonPointer; from?: JsonValue; to?: JsonValue }[] } | { refused: string };
export interface Harness {
 dispatch(event: TrustedEvent): StepReport;
 /**
  * Deliver again an event this harness already accepted or emitted, with its exact immutable bytes, under a new
  * transport receipt. It is a redelivery: each execution reports a duplicate, no step budget is spent and no work
  * projection changes. An unknown ID is an `event_identity_conflict`. Nothing here builds an event.
  */
 redeliver(event: EventId, receipt: Id): StepReport;
 /** Deliver every due event up to `instant`, in order. */
 advanceTo(instant: Instant): readonly StepReport[];
 observe(): Observations;
 /**
  * Make another prepared content available to new launches. The harness computes its identity again and refuses a
  * mismatch or a second document under an available revision. Each execution keeps the content it pins.
  */
 deploy(protocol: PreparedProtocol): DeployReport;
 /** Compare two available contents. It reads only. */
 compare(from: ContentRef, to: ContentRef): ComparisonReport;
}

// The canonical corpus.
export type AssertionRelation = 'equals' | 'contains' | 'absent' | 'rejects' | 'one_of' | 'unchanged';
export interface CanonicalAssertion { after: string; subject: string; property: string; relation: AssertionRelation; value: JsonValue }
export interface CanonicalCase {
 id: Id; title: string;
 kind: 'trace' | 'validation' | 'selection' | 'content' | 'authoring';
 clauses?: readonly Id[];
 basis: readonly { kind: string; path: string; locator: string; claim: string }[];
 given: Readonly<Record<string, JsonValue>>;
 events: readonly ({ id: Id; type: Id } & Readonly<Record<string, JsonValue>>)[];
 expect: { required: readonly CanonicalAssertion[]; forbidden: readonly CanonicalAssertion[] };
 oracle_status: 'specified' | 'specification_gap' | 'clinical_question';
 open_question?: string;
 protocol?: Id;
 protocol_fragment?: Readonly<Record<string, JsonValue>>;
}
/** Explicit input conversion only: an adapter never computes or contains an expected answer. */
export interface ConformanceAdapter {
 readonly catalog: ContractCatalog;
 /** The complete v1 document (fragment in its validated host, variant patch applied) for a case or one variant. */
 document(testCase: CanonicalCase, variant?: Id): unknown;
 /** Additional exact content documents available at setup. */
 initialDocuments?(testCase: CanonicalCase, variant?: Id): readonly unknown[];
 scenario(testCase: CanonicalCase, variant?: Id): ScenarioState;
 trust(testCase: CanonicalCase, variant?: Id): TrustContext;
 /** Normalize one case event, or say why it cannot be. */
 event(testCase: CanonicalCase, event: CanonicalCase['events'][number]): TrustedEvent
  | { operation: 'redeliver'; emitted_by: { event: EventId; effect: Id }; receipt: Id }
  /** Input-only: make this complete v1 document available; the runner prepares it and the harness checks its identity. */
  | { operation: 'deploy'; document: unknown }
  /** Input-only and read-only: compare two available contents. */
  | { operation: 'compare'; from: ContentRef; to: ContentRef }
  | { refused: string };
}
export interface AssertionReport {
 /** `/expect/required/3` within its case. */
 pointer: JsonPointer;
 status: 'checked' | 'failed' | 'unexecuted';
 reason?: string;
 observed?: Observation;
}
export interface CaseReport {
 case: Id;
 /** `passed` needs every assertion checked and every setup and trace obligation run. */
 status: 'passed' | 'failed' | 'incomplete' | 'error';
 oracle_status: CanonicalCase['oracle_status'];
 obligations: readonly { obligation: 'validation' | 'setup' | 'event' | 'trace'; id: Id; status: 'ran' | 'not_run' | 'error'; reason?: string }[];
 assertions: readonly AssertionReport[];
 /** Pins for the report: document, corpus and code hashes. */
 inputs: Readonly<Record<string, string>>;
}

// The shared entry points. Implementations live in validate.ts, runtime/ and conformance/; their types are pinned here.
export type ValidateProtocol = (document: unknown, catalog: ContractCatalog) => ValidationReport;
export type PrepareProtocol = (document: unknown, catalog: ContractCatalog) => PreparationResult;
/** One content, or several available from the start; the first supplies the host object contracts. */
export type CreateHarness = (protocol: PreparedProtocol | readonly PreparedProtocol[], initial: ScenarioState, trust: TrustContext) => Harness;
export type RunCanonicalCase = (testCase: CanonicalCase, adapter: ConformanceAdapter) => CaseReport;

/** A decision register entry: `studio/decisions/<id>.json` (studio/decisions/README.md). Not part of the protocol language. */
export interface RegisterEntry {
 id: string;
 level: 'policy' | 'aspect' | 'conflict' | 'correction' | 'fill-in' | 'variant' | 'site';
 status: 'found' | 'proposed' | 'decided' | 'withdrawn';
 question: string;
 options: { id: string; summary: string; cites: ({ snippet: string; at?: string; row?: string } | { locator: string } | { decision: string })[] }[];
 default: string | null;
 direction: string | null;
 owner: 'clinical owner' | 'site operations' | 'ministry' | 'author';
 found_by: string;
 decided: { by: string; on: string; choice: string; how: string; kind: 'agent' | 'clinician'; session?: string } | null;
 /** An agent's choice is not clinical approval. Direct clinician decisions omit this block. */
 signoff?: {
  status: 'pending' | 'approved';
  pathway: string; version: string; risk: 'safety' | 'wording'; production: boolean;
  by?: string; on?: string; choice?: string; how?: string;
 };
 governs: string[];
 supersedes: string | null;
 rationale: string;
 imported_from: string | null;
 /** A policy decided once for every research area of one country: its label (S1, S2, …), title and the note on its default. */
 shared_rule?: { id: string; country: string; title: string; default_note: string };
}

// Obsolete V2 state-table shapes (schemaVersion 1). Existing readers and tests still use these temporarily;
// remove them when those direct consumers move to v1 after the v1 contract is locked.
/** A value: a concept (`followup.next_day`), a literal (`refer_urgently`, `3 d`), or `next(c)` / `previous(c)` of an ordered concept. */
export type Expr = string;
/** A duration with its UCUM unit: `3 d`, `2 wk`, `6 mo`. */
export type Duration = string;
/** A role in `Protocol.roles`. `patient` and `caregiver` are always there. */
export type RoleRef = string;
/** A level of care: one of the concept registry's `care.level` values. */
export type LevelId = string;
export type CadreId = string;
export type Urgency = 'emergency' | 'urgent' | 'routine';

export interface Protocol {
 schemaVersion: 1;
 id: string; version: string;           // 7.3: every recorded decision carries the version
 roles: Role[];
 pathways: Pathway[]; states: State[]; definitions: Definitions;
 variants: VariantPoint[];              // 8.2
 indicators: unknown[];                 // 1.4: own definitions, never a rule's threshold
 imports?: string[];                    // shared modules (8.1), reserved
}
export interface Role { id: string; cadre: CadreId; level: LevelId; escalatesTo?: string }
export interface VariantPoint { id: string; label: string; options: { id: string; label: string; cite: Cite[] }[] }

/** One per protocol: the definers it chose, and plan concepts. */
export interface Definitions {
 derived: { concept: string; when: Condition | History; cite: Cite[] }[];   // cites the definer snippet and the decision
 plans: { concept: string; steps: string; moves: string; review: string }[]; // D21: step list, move table, review schedule (snippet ids)
}
/** The snippet's history forms; allowed in definitions only, never in a rule's `when`. */
export type History =
 | { since: Condition }                         // time since the condition last became true; unknown if it does not hold now
 | { count: string; since: string }             // events counted since another event
 | { consecutive: number; holds: Condition }    // the condition held at the last n recordings of the concepts it reads
 | { previous: string }                         // the value before the latest change
 | { latest: string; n: number; mean?: true };  // the last n recordings, or their mean

export interface Pathway {
 id: string; title: string; purpose: string;
 appliesTo: Condition;                  // eligibility (1.1), checked
 starts: Section;                       // on an event or condition → a state
 sections: Section[];                   // handlers every state inherits (interrupts); a state's own section wins
 outputs: Output[];
 ends: End[];
 cite: Cite[];
}
export interface End { id: string; label: string; kind: 'complete' | 'handoff' | 'transfer' | 'lost' | 'died'; openWork: 'withdraw' | 'hand-over' }

export interface State {
 id: string; title: string; purpose: string;
 pathway: string; level: LevelId; actor?: RoleRef;
 appliesTo?: Condition;                 // checked on arrival
 awaits?: Work[];                       // none: a decision, evaluated at once
 gate?: { id: string; all: string[] };  // D12: one input when every part is done
 timers?: Timer[];
 sections: Section[];                   // one per input handled
 outputs: Output[];                     // each lists the rules it goes with
 cite: Cite[];
}

/** What the state waits for; booked by the arriving transition. */
export interface Work {
 id: string; task: string;
 by: RoleRef | { model: string; checkedBy: RoleRef };   // 6.2: an AI step is work with a checker
 owner: RoleRef;                        // books it and traces a miss (5.2)
 due: Schedule;
 collects: { concept: string; required: boolean | Condition; cite: Cite[] }[];
 instructions?: string[];               // ask, look, check: how to collect, never a conditional action
 call?: string;                         // the work is another pathway, which hands back its end (1.3)
}
export interface Timer { id: string; fires: Clock; owner: RoleRef; label: string; cite: Cite[] }

export type Input = { done: string } | { timer: string } | { event: string }
 | { overdue: string } | { expired: string } | 'immediate';

/** The last rule is `otherwise`. */
export interface Section { on: Input; hit: 'first' | 'unique'; order?: Cite; rules: Rule[] }

export interface Rule {
 id: string;                            // stable; list order is the priority
 when: Condition | 'otherwise';
 to: Target;
 outcome: string;
 urgency?: Urgency;
 direction?: 'adds' | 'reduces' | 'keeps';   // care (6.1); derived where it can be
 confirm?: RoleRef;                     // a rule that reduces care waits for this role's sign-off
 variant?: { point: string; option: string };
 note?: string;                         // why; never the semantics
 cite: Cite[];
}
export type Target = { state: string } | { again: true; due?: Schedule } | { stay: true } | { end: string };

export interface Output {
 id: string;
 on: string[];                          // the rules it goes with (Mealy)
 when?: Condition;                      // its own condition, tested when one of those rules fires
 strength: 'do' | { offer: RoleRef };   // "consider", "may", "optional" hand the choice to a role (D2)
 do: Action;
 label: string; detail?: string; cite: Cite[];
}
export type Action =
 | { give: string; dose: Dose | { table: string; by: string[] }; by: RoleRef; with?: RoleRef; schedule?: Schedule }
 | { advise: string; to: 'patient' | 'caregiver' | RoleRef }
 | { refer: LevelId | RoleRef; urgency: Urgency; reason?: string }
 | { notify: RoleRef; via?: string; message: string }
 | { book: string; as: string; by: RoleRef; owner: RoleRef; due: Schedule; lasts: 'while-here' | 'pathway' | 'independent' }
 | { set: string; to: Expr }            // a result, a count, the plan step
 | { cancel: string }
 | { start: string; with?: Record<string, Expr> }       // another pathway, alongside
 | { announce: string; with?: Record<string, Expr> };
export interface Dose { amount: Quantity | Expr; perKg?: boolean; max?: Quantity | string; route: string; frequency: string; duration?: Duration; form?: string }

export type Clock =
 | { after: Duration | Expr; from: 'arrival' }                                 // restarts on `again`, not on `stay`
 | { after: Duration | Expr; from: { due: string } }                           // counts from its own due date (2.3)
 | { after: Duration | Expr; from: { event: string; which: 'first' | 'latest' | number } }
 | { at: { concept: string; reaches: Quantity | string } };                             // anchor clock: ga 37 wk, age 49 a
/** The schedule snippet's fields, structured. */
export interface Schedule {
 first?: Clock | Expr; gap?: Duration | { while: Condition; gap: Duration }[];
 anchor?: { concept: string; at: Quantity | string }[]; window?: [Duration, Duration];
 overdue?: Duration; expires?: Duration; done?: Condition; end?: Clock | Condition | { count: number };
 snap?: string;                         // a site calendar
}

export type Cite = { snippet: string; row?: string; quote?: string; hash?: string }
 | { decision: string } | { program: string };

/** Which variant a site runs, who fills each role, its clinic days. Nothing clinical: no threshold, interval or dose. */
export interface SiteSettings {
 site: string; protocol: { id: string; version: string };
 fills: Record<string, string[]>;       // role id → the people or teams that fill it (D13)
 variants: Record<string, string>;      // variant point → one of its listed options
 calendars: Record<string, string>;     // calendar name → clinic days
}

/** A requirement page's Given / When / Expected, runnable: a timeline, not a snapshot. */
export interface TestStory {
 id: string; requirement?: string;
 given: { at: string; pathway: string; in?: string; record: Record<string, Value> };
 steps: ({ at: string; done: string; values: Record<string, Value> }
  | { at: string; event: string; values: Record<string, Value> }
  | { at: string; advance: true })[];
 expect: { at?: string; in?: string; fired?: string[]; did?: string[]; didNot?: string[];
  booked?: { as: string; due: string }[]; withdrawn?: string[] }[];
}
export type Value = { value: unknown } | { notDetermined: 'not asked' | 'unable to assess' | 'unavailable' | 'refused' };
