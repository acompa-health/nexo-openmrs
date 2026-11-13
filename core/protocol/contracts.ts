/**
 * The v1 contract catalog: the closed kinds (effects, purposes, failures, references), the standard event and record
 * contracts, and every diagnostic reason code, each named once. A host catalog adds its own named domain contracts
 * through defineCatalog; it cannot add a kind or redefine a standard name. Also the two readings every consumer shares:
 * a supplied datum (known, or unknown with a reason) and an `event.` path (envelope, declared payload field, or undeclared).
 */
import type { Finding, Value } from '../logic/index.ts';
import type { ContractCatalog, EventContract, FieldDecl, JsonValue, RecordContract, ReferenceKind, ResolvedInput, SourceFieldDecl, TypeDescriptor, WorkPolicy, WorkTemplate } from './types.ts';

export const PROTOCOL_FORMAT = 'abrazos.protocol/v1';
export const EFFECT_KINDS = ['record', 'publish', 'order', 'task', 'start', 'emit', 'change_work'] as const;
export const TABLE_PURPOSES = ['clinical_decision', 'information', 'coordination'] as const;
export const FAILURE_CLASSES = ['unresolved', 'unmatched', 'ambiguous', 'not_authorized', 'invalid_transition'] as const;
export const ORDER_KINDS = ['laboratory', 'prescription', 'referral'] as const;

/** Each reference kind's serialized fields. None has a generic `version`: revision, occurrence and identity are distinct. */
export const REFERENCE_KINDS: ContractCatalog['references'] = {
 object: { required: ['type', 'id'], optional: ['revision'] },
 content: { required: ['protocol', 'revision', 'identity'], optional: [] },
 definition: { required: ['content'], optional: ['workflow', 'policy'], exactlyOneOf: ['workflow', 'policy'] },
 actor: { required: ['id', 'kind'], optional: [] },
 owner: { required: ['id', 'revision'], optional: [] },
 work: { required: ['id', 'occurrence'], optional: ['revision'] },
 execution: { required: ['id', 'content'], optional: [] },
 activation: { required: ['execution', 'activation'], optional: [] },
 event: { required: ['id'], optional: [] },
};

/** The normalized event envelope, field → its readable subfields. Event-specific fields are only under `payload`. */
const envelope = {
 id: null, type: null, occurrence: null,
 scope: { patient: null, subject: { type: null, id: null, revision: null }, cases: null },
 actor: { id: null, kind: null }, occurred_at: null, received_at: null, mode: null, payload: null,
 work: { id: null, occurrence: null, revision: null, attempt: null },
 target: { execution: null, activation: null, content: { protocol: null, revision: null, identity: null } },
 caused_by: null, root: null, corrects: null,
} as const;
type Shape = { readonly [field: string]: Shape | null };
export const EVENT_ENVELOPE_FIELDS = Object.keys(envelope) as readonly (keyof typeof envelope)[];

const t = <T extends TypeDescriptor>(type: T): FieldDecl => ({ type });
const opt = (type: TypeDescriptor): FieldDecl => ({ type, optional: true });
const ref = (target: ReferenceKind): TypeDescriptor => ({ type: 'reference', target });
const id: TypeDescriptor = { type: 'identifier' };

/** Events the engine and every host share. Domain events (`booking.rescheduled`) come from the host catalog. */
export const STANDARD_EVENTS: Readonly<Record<string, EventContract>> = {
 /** Its event ID is the request ID. `fixed` and `collected` are typed by the table's request contract. */
 'decision.requested': { payload: {
  table: t(id), step: t(id), actor: t(ref('actor')), source_event: t(id),
  fixed: t({ type: 'context' }), collected: t({ type: 'context' }),
  resume_from: opt(id), supersedes: opt(id),
 } },
 /** Engine-generated fallback payload, read through a handler's typed `failure` alias; callers cannot dispatch it. */
 'evaluation.failed': { payload: {
  attempt: t(id), event: t(id), table: t(id), actor: t(ref('actor')),
  reason: t({ type: 'listed', values: FAILURE_CLASSES }), code: opt(id),
  stage: t({ type: 'listed', values: ['routing', 'selection', 'authority', 'effects', 'commit'] }),
  subject: opt(ref('object')), owner: opt(ref('owner')), request: opt(id), work: opt(ref('work')),
  /** `{actor, result}` of a refused verified completion; `result` is typed by the template of the work the failed table hears. */
  report: opt({ type: 'context' }),
  expected_revision: opt({ type: 'revision' }), actual_revision: opt({ type: 'revision' }),
  conflict: opt({ type: 'list', items: id }), unknown_inputs: opt({ type: 'list', items: id }),
  blocking: opt({ type: 'context' }),
 } },
 /** `entry` is typed by the started workflow's entry inputs. */
 'workflow.started': { payload: { entry: t({ type: 'context' }) } },
 /** Engine-generated commissioner-end signal; callers cannot dispatch it. */
 'workflow.ended': { payload: { outcome: t(id), outstanding_work: t({ type: 'list', items: ref('work') }) } },
 /**
  * Work reports: the original work, occurrence, revision and attempt are in the envelope's `work`. `result` is typed by
  * the `result` of the reported work's template, as a table sees it through `on.work` or a `work:<template>` binding.
  */
 'task.completed': { payload: { evidence: t({ type: 'record', record: 'completion_evidence' }), result: opt({ type: 'context' }) } },
 'work.failed': { payload: { reason: t(id), retryable: t({ type: 'yes_no' }) } },
 'work.cancelled': { payload: { reason: t(id), cancellation_request: t(ref('event')) } },
 'work.due': { payload: { due_revision: t({ type: 'revision' }) } },
};

export const STANDARD_RECORDS: Readonly<Record<string, RecordContract>> = {
 completion_evidence: { fields: {
  work: t(ref('work')), attempt: opt(id), subject: t(ref('object')), content: opt(ref('content')),
  performer: t(ref('actor')), performed_at: t({ type: 'time' }), proof: t(id),
  /** delivered.value has the type of the captured content field named by the task's delivery contract. */
  recipient: opt(ref('object')), channel: opt(id), delivered: opt({ type: 'context' }),
 } },
 operational_issue: { fields: { reason: t(id), owner: opt(ref('owner')), subject: opt(ref('object')), data: opt({ type: 'context' }) } },
};

/** Static diagnostic reasons with their evidence band (1 structure/references, 2 types/bindings, 3 behavioral analysis). */
export const STATIC_REASONS = {
 not_v1_format: { level: 1 }, unknown_format_marker: { level: 1 }, missing_revision: { level: 1 },
 invalid_table_purpose: { level: 1 }, missing_rule_field: { level: 1 }, unknown_effect_kind: { level: 1 },
 duplicate_id: { level: 1 }, duplicate_id_after_shared_expansion: { level: 1 }, duplicate_effective_handler: { level: 1 },
 input_without_type: { level: 1 }, undeclared_state: { level: 1 }, undeclared_work_handle: { level: 1 },
 invalid_shape: { level: 1 }, undeclared_field: { level: 1 }, unresolved_record_contract: { level: 1 },
 unresolved_event_contract: { level: 1 }, unresolved_object_contract: { level: 1 }, unresolved_workflow_definition: { level: 1 },
 unresolved_import: { level: 1 }, unsupported_predecessor: { level: 1 }, catalog_contract_conflict: { level: 1 },
 shadowed_name: { level: 1 },
 unresolved_term: { level: 1 }, term_label_conflict: { level: 1 }, missing_term: { level: 1 },
 unresolved_handler: { level: 1 }, unresolved_work_template: { level: 1 }, unavailable_work_policy: { level: 1 }, missing_work_policy: { level: 1 },
 unresolved_evidence_reference: { level: 1 }, task_without_owner: { level: 1 },
 execution_child_without_origin_end_handler: { level: 1 }, effect_reads_later_effect: { level: 1 },
 not_condition_grammar: { level: 1 }, mixed_and_or_without_brackets: { level: 1 }, history_query_in_rule_condition: { level: 1 },
 missingness_guard_in_clinical_decision: { level: 1 }, unsupported_hit_policy: { level: 1 },
 missing_rank: { level: 1 }, non_numeric_rank: { level: 1 }, missing_precedence_evidence: { level: 1 },
 decision_state_without_question_or_authority: { level: 1 }, clinical_write_without_decision_authority: { level: 1 },
 handler_fabricates_clinical_outcome: { level: 1 }, cross_workflow_state_write: { level: 1 },
 stage_write_outside_designated_lifecycle: { level: 1 },
 override_without_base_revision: { level: 1 }, override_without_rationale_or_status: { level: 1 },
 incompatible_unit: { level: 2 }, value_outside_declared_domain: { level: 2 }, type_mismatch: { level: 2 },
 term_type_mismatch: { level: 2 }, term_binding_conflict: { level: 2 },
 calculation_cycle: { level: 2 },
 unknown_input_path: { level: 2 }, unknown_binding_path: { level: 2 }, unstructured_context_in_condition: { level: 2 },
 overlap: { level: 3 }, coverage_gap: { level: 3 }, unconditional_self_emit_loop: { level: 3 },
 unreachable_state: { level: 3 }, unconditional_internal_loop: { level: 3 },
} as const satisfies Readonly<Record<string, { level: 1 | 2 | 3 }>>;
export type StaticReason = keyof typeof STATIC_REASONS;

/** Runtime attempt reasons: execution evidence, not a fourth validation level. */
export const RUNTIME_REASONS = [
 ...FAILURE_CLASSES, 'not_enabled', 'unsubscribed', 'revision_conflict', 'event_identity_conflict', 'binding_conflict',
 'handler_failed', 'missing_completion_evidence', 'step_limit_exhausted',
] as const;
export type RuntimeReason = typeof RUNTIME_REASONS[number];

/** Reasons the engine gives an unknown; a supplied `{unknown: reason}` keeps its own reason. */
export const UNKNOWN_REASONS = ['absent', 'source_unavailable', 'invalid_value', 'unresolved_precision', 'unresolved_selection'] as const;

/** The catalog every document is checked against before any host contract is added. */
export function standardCatalog(): ContractCatalog {
 return {
  references: REFERENCE_KINDS, sources: {}, objects: {}, registries: {},
  events: STANDARD_EVENTS, records: STANDARD_RECORDS,
  orders: { laboratory: { content: {}, protected: [] }, prescription: { content: {}, protected: ['*'] }, referral: { content: {}, protected: [] } },
  tasks: {}, policies: {},
  reasons: { static: STATIC_REASONS, runtime: RUNTIME_REASONS },
 };
}

/** A host's named domain contracts. Kinds, references and reasons are closed. */
export interface CatalogExtension {
 terms?: ContractCatalog['terms'];
 sources?: ContractCatalog['sources'];
 objects?: ContractCatalog['objects'];
 registries?: ContractCatalog['registries'];
 events?: Readonly<Record<string, EventContract>>;
 records?: Readonly<Record<string, RecordContract>>;
 /** Adds content fields and protected fields; it can only tighten what the standard catalog protects. */
 orders?: Partial<Readonly<Record<typeof ORDER_KINDS[number], { content?: Readonly<Record<string, FieldDecl>>; protected?: readonly string[] }>>>;
 tasks?: Readonly<Record<string, WorkTemplate>>;
 policies?: Readonly<Record<string, WorkPolicy>>;
}

/** The standard catalog plus a host's contracts. Throws when the extension redefines a standard event or record. */
export function defineCatalog(extension: CatalogExtension): ContractCatalog {
 const base = standardCatalog();
 for (const [names, standard, kind] of [[extension.events, base.events, 'event'], [extension.records, base.records, 'record']] as const)
  for (const name of Object.keys(names ?? {}))
   if (Object.hasOwn(standard, name)) throw new Error(`${name} is a standard ${kind}; a host catalog cannot redefine it.`);
 const orders = { ...base.orders };
 for (const kind of ORDER_KINDS) {
  const more = extension.orders?.[kind];
  if (more) orders[kind] = { content: { ...orders[kind].content, ...more.content }, protected: [...new Set([...orders[kind].protected, ...more.protected ?? []])] };
 }
 return {
  ...base, orders,
  ...(extension.terms && Object.keys(extension.terms).length ? { terms: extension.terms } : {}),
  sources: { ...extension.sources }, objects: { ...extension.objects }, registries: { ...extension.registries },
  events: { ...base.events, ...extension.events }, records: { ...base.records, ...extension.records },
  tasks: { ...extension.tasks }, policies: { ...extension.policies },
 };
}

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isJson = (v: unknown): v is JsonValue =>
 v === null || typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))
 || (Array.isArray(v) && v.every(isJson)) || (isRecord(v) && Object.values(v).every(isJson));

/**
 * Read a supplied informational datum: a typed value, or `{unknown: reason}` (exactly that one key, a nonempty reason).
 * A recorded answer spelled `unknown` is a known value. Absence and invalid values are unknown, never false or null.
 * Type and domain checks against the declaration come after; the raw value stays in its source evidence.
 */
export function readSuppliedDatum(raw: unknown, provenance: { source?: string; revision?: string } = {}): ResolvedInput {
 const unknown = (reason: string, detail?: string): ResolvedInput => ({ state: 'unknown', reason, ...(detail ? { detail } : {}), ...provenance });
 if (raw === undefined) return unknown('absent');
 if (raw === null) return unknown('invalid_value', 'null is not a typed value');
 if (isRecord(raw) && Object.hasOwn(raw, 'unknown')) {
  const keys = Object.keys(raw);
  return keys.length === 1 && typeof raw.unknown === 'string' && raw.unknown.trim() !== '' ? unknown(raw.unknown)
   : unknown('invalid_value', 'a supplied unknown is exactly {unknown: reason} with a nonempty reason');
 }
 if (!isJson(raw)) return unknown('invalid_value', 'not a JSON value');
 return { state: 'known', value: raw, ...provenance };
}

/** Keep raw identity/control fields outside the informational unknown path until ingress validates their type. */
export function readSourceField(decl: SourceFieldDecl, raw: unknown, provenance: { source?: string; revision?: string } = {}):
 { kind: 'information'; input: ResolvedInput } | { kind: 'control'; raw: unknown } {
 return decl.role === 'information'
  ? { kind: 'information', input: readSuppliedDatum(raw, provenance) }
  : { kind: 'control', raw };
}

const isQuantity = (v: JsonValue): v is { value: number; unit: string } =>
 isRecord(v) && Object.keys(v).length === 2 && typeof v.value === 'number' && typeof v.unit === 'string';
/** The kernel's view of a resolved input. Throws on a value no condition can read, such as a record: read its declared fields. */
export function toFinding(input: ResolvedInput): Finding {
 if (input.state === 'unknown') return { status: 'unknown', reason: input.reason };
 const v = input.value;
 if (typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return { status: 'known', value: v };
 if (isQuantity(v)) return { status: 'known', value: { value: v.value, unit: v.unit } };
 if (Array.isArray(v) && v.every(i => typeof i === 'boolean' || typeof i === 'number' || typeof i === 'string')) return { status: 'known', value: v as Value };
 throw new Error(`${JSON.stringify(v)} is not a condition value. Read one of its declared fields instead.`);
}

export type EventField =
 | { kind: 'envelope'; field: string }
 | { kind: 'payload'; field: string; type: TypeDescriptor; optional: boolean; rest?: string }
 | { kind: 'undeclared'; path: string };
/**
 * Resolve an `event.` path for one event type: an envelope field, or a payload field the catalog declares for that type.
 * A payload field is never read at the envelope level. `rest` is left for typed traversal of the field's declared type.
 */
export function eventField(catalog: ContractCatalog, type: string, path: string): EventField {
 const undeclared: EventField = { kind: 'undeclared', path };
 const [root, first, ...more] = path.split('.');
 if (root !== 'event' || !first) return undeclared;
 if (first === 'payload') {
  const contract = Object.hasOwn(catalog.events, type) ? catalog.events[type] : undefined;
  const [field, ...rest] = more;
  if (!contract || !field || !Object.hasOwn(contract.payload, field)) return undeclared;
  const decl = contract.payload[field];
  return { kind: 'payload', field, type: decl.type, optional: decl.optional === true, ...(rest.length ? { rest: rest.join('.') } : {}) };
 }
 let shape: Shape | null = envelope;
 for (const segment of [first, ...more]) {
  if (shape === null || !Object.hasOwn(shape, segment)) return undeclared;
  shape = shape[segment];
 }
 return { kind: 'envelope', field: [first, ...more].join('.') };
}
