/**
 * The schema as data: each shape's fields in schema order, mirroring types.ts field for field. One table drives the
 * level 1 shape check and the canonical print, so the two cannot disagree. The v1 declarations (`v1Shapes`, below)
 * also generate the exported JSON Schema, v1.schema.json. The first part is the obsolete schemaVersion 1 schema,
 * kept only while load.ts and the old validator still read it.
 */
import { EFFECT_KINDS, FAILURE_CLASSES, ORDER_KINDS, PROTOCOL_FORMAT, TABLE_PURPOSES } from './contracts.ts';
import type { Input } from './types.ts';

export type Spec =
 | 'string' | 'number' | 'boolean' | 'unknown'
 | { literal: string | number | boolean }
 | { enum: readonly string[] }
 | { list: Spec } | { tuple: readonly Spec[] } | { record: Spec }
 | { shape: string }
 | { oneOf: readonly Spec[] };

const S = 'string', N = 'number', B = 'boolean';
const list = (of: Spec): Spec => ({ list: of });
const shape = (name: string): Spec => ({ shape: name });
const oneOf = (...of: Spec[]): Spec => ({ oneOf: of });
const literal = (value: string | number | boolean): Spec => ({ literal: value });
const choice = (...values: string[]): Spec => ({ enum: values });

const cite = oneOf(shape('SnippetCite'), shape('DecisionCite'), shape('ProgramCite'));
const cites = list(cite);
const urgency = choice('emergency', 'urgent', 'routine');
// A quantity is `{ value, unit }` or the shorter string an author writes, `"100 mg"` (UCUM unit).
const quantity = oneOf(shape('Quantity'), S);
const clock = oneOf(shape('ClockAfter'), shape('ClockAt'));
const schedule = shape('Schedule');
// A union's variants are told apart by their first field; `count` is tried before `since`.
const history = oneOf(shape('HistoryCount'), shape('HistorySince'), shape('HistoryConsecutive'), shape('HistoryPrevious'), shape('HistoryLatest'));
const input = oneOf(literal('immediate'), shape('Done'), shape('TimerInput'), shape('EventInput'), shape('Overdue'), shape('Expired'));
const target = oneOf(shape('ToState'), shape('Again'), shape('Stay'), shape('ToEnd'));
const action = oneOf(shape('Give'), shape('Advise'), shape('Refer'), shape('Notify'), shape('Book'), shape('Set'), shape('Cancel'), shape('Start'), shape('Announce'));

/** Each shape's fields in schema order; `?` marks an optional field. */
export const shapes: Readonly<Record<string, Readonly<Record<string, Spec>>>> = {
 Protocol: { schemaVersion: literal(1), id: S, version: S, roles: list(shape('Role')), pathways: list(shape('Pathway')), states: list(shape('State')), definitions: shape('Definitions'), variants: list(shape('VariantPoint')), indicators: list('unknown'), 'imports?': list(S) },
 Role: { id: S, cadre: S, level: S, 'escalatesTo?': S },
 VariantPoint: { id: S, label: S, options: list(shape('VariantOption')) },
 VariantOption: { id: S, label: S, cite: cites },
 Definitions: { derived: list(shape('Derived')), plans: list(shape('Plan')) },
 Derived: { concept: S, when: oneOf(S, history), cite: cites },
 Plan: { concept: S, steps: S, moves: S, review: S },
 HistoryCount: { count: S, since: S },
 HistorySince: { since: S },
 HistoryConsecutive: { consecutive: N, holds: S },
 HistoryPrevious: { previous: S },
 HistoryLatest: { latest: S, n: N, 'mean?': literal(true) },
 Pathway: { id: S, title: S, purpose: S, appliesTo: S, starts: shape('Section'), sections: list(shape('Section')), outputs: list(shape('Output')), ends: list(shape('End')), cite: cites },
 End: { id: S, label: S, kind: choice('complete', 'handoff', 'transfer', 'lost', 'died'), openWork: choice('withdraw', 'hand-over') },
 State: { id: S, title: S, purpose: S, pathway: S, level: S, 'actor?': S, 'appliesTo?': S, 'awaits?': list(shape('Work')), 'gate?': shape('Gate'), 'timers?': list(shape('Timer')), sections: list(shape('Section')), outputs: list(shape('Output')), cite: cites },
 Gate: { id: S, all: list(S) },
 Work: { id: S, task: S, by: oneOf(S, shape('ModelBy')), owner: S, due: schedule, collects: list(shape('Collect')), 'instructions?': list(S), 'call?': S },
 ModelBy: { model: S, checkedBy: S },
 Collect: { concept: S, required: oneOf(B, S), cite: cites },
 Timer: { id: S, fires: clock, owner: S, label: S, cite: cites },
 Done: { done: S }, TimerInput: { timer: S }, EventInput: { event: S }, Overdue: { overdue: S }, Expired: { expired: S },
 Section: { on: input, hit: choice('first', 'unique'), 'order?': cite, rules: list(shape('Rule')) },
 Rule: { id: S, when: S, to: target, outcome: S, 'urgency?': urgency, 'direction?': choice('adds', 'reduces', 'keeps'), 'confirm?': S, 'variant?': shape('RuleVariant'), 'note?': S, cite: cites },
 RuleVariant: { point: S, option: S },
 ToState: { state: S }, Again: { again: literal(true), 'due?': schedule }, Stay: { stay: literal(true) }, ToEnd: { end: S },
 Output: { id: S, on: list(S), 'when?': S, strength: oneOf(literal('do'), shape('Offer')), do: action, label: S, 'detail?': S, cite: cites },
 Offer: { offer: S },
 Give: { give: S, dose: oneOf(shape('Dose'), shape('DoseTable')), by: S, 'with?': S, 'schedule?': schedule },
 Advise: { advise: S, to: S },
 Refer: { refer: S, urgency, 'reason?': S },
 Notify: { notify: S, 'via?': S, message: S },
 Book: { book: S, as: S, by: S, owner: S, due: schedule, lasts: choice('while-here', 'pathway', 'independent') },
 Set: { set: S, to: S },
 Cancel: { cancel: S },
 Start: { start: S, 'with?': { record: S } },
 Announce: { announce: S, 'with?': { record: S } },
 Dose: { amount: oneOf(quantity, S), 'perKg?': B, 'max?': quantity, route: S, frequency: S, 'duration?': S, 'form?': S },
 DoseTable: { table: S, by: list(S) },
 Quantity: { value: N, unit: S },
 ClockAfter: { after: S, from: oneOf(literal('arrival'), shape('FromDue'), shape('FromEvent')) },
 ClockAt: { at: shape('Reaches') },
 Reaches: { concept: S, reaches: quantity },
 FromDue: { due: S }, FromEvent: { event: S, which: oneOf(choice('first', 'latest'), N) },
 Schedule: { 'first?': oneOf(clock, S), 'gap?': oneOf(S, list(shape('Band'))), 'anchor?': list(shape('Anchor')), 'window?': { tuple: [S, S] }, 'overdue?': S, 'expires?': S, 'done?': S, 'end?': oneOf(clock, S, shape('Count')), 'snap?': S },
 Band: { while: S, gap: S }, Anchor: { concept: S, at: quantity }, Count: { count: N },
 SnippetCite: { snippet: S, 'row?': S, 'quote?': S, 'hash?': S }, DecisionCite: { decision: S }, ProgramCite: { program: S },
};

/** A section's input as it appears in ids: `done:visit`, `timer:visit.overdue`, `event:bp.reading`, `immediate`. */
export function inputKey(on: Input): string {
 if (on === 'immediate') return on;
 const [kind, name] = Object.entries(on)[0] ?? ['?', '?'];
 return `${kind}:${String(name)}`;
}

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const fields = (name: string) => Object.entries(shapes[name]).map(([k, spec]) => ({ key: k.replace(/\?$/, ''), optional: k.endsWith('?'), spec }));
const flat = (specs: readonly Spec[]): Spec[] => specs.flatMap(s => typeof s === 'object' && 'oneOf' in s ? flat(s.oneOf) : [s]);

/** The variant of a union that a value is written in, if any. */
function pick(v: unknown, specs: readonly Spec[]): Spec | undefined {
 return flat(specs).find(s => {
  if (typeof s === 'string') return s === 'unknown' || (s === 'string' && typeof v === 'string') || (s === 'number' && typeof v === 'number') || (s === 'boolean' && typeof v === 'boolean');
  if ('literal' in s) return v === s.literal;
  if ('enum' in s) return typeof v === 'string' && s.enum.includes(v);
  if ('list' in s || 'tuple' in s) return Array.isArray(v);
  if ('shape' in s) return isObject(v) && fields(s.shape)[0].key in v;
  return isObject(v);
 });
}
function describe(s: Spec): string {
 if (typeof s === 'string') return s === 'unknown' ? 'anything' : `a ${s}`;
 if ('literal' in s) return JSON.stringify(s.literal);
 if ('enum' in s) return s.enum.map(v => JSON.stringify(v)).join(' or ');
 if ('list' in s) return 'a list';
 if ('tuple' in s) return `a list of ${s.tuple.length}`;
 if ('record' in s) return 'an object';
 if ('shape' in s) return `{ ${fields(s.shape)[0].key} … }`;
 return flat(s.oneOf).map(describe).join(', or ');
}

/** The stable id an object gives its diagnostics, from its parent's. Objects without one report under their parent. */
function scope(name: string, v: Obj, parent: string, key: string): string {
 const id = String(v.id ?? '?');
 switch (name) {
  case 'Protocol': return 'protocol';
  case 'Pathway': return id;
  case 'State': return `${String(v.pathway ?? '?')}/${id}`;
  case 'Section': return key === 'starts' ? `${parent}/start` : `${parent}/${typeof v.on === 'string' || isObject(v.on) ? inputKey(v.on as Input) : '?'}`;
  case 'Rule': case 'Output': case 'Work': case 'Timer': case 'End': return `${parent}/${id}`;
  case 'Role': return `roles/${id}`;
  case 'VariantPoint': return `variants/${id}`;
  case 'Derived': return `definitions/${String(v.concept ?? '?')}`;
  case 'Plan': return `definitions/plans/${String(v.concept ?? '?')}`;
  default: return parent;
 }
}

export interface ShapeProblem { id: string; message: string }

/** Check a value against a spec: types, required and unknown fields, listed values. */
export function checkShape(value: unknown, spec: Spec, out: ShapeProblem[], id = 'protocol', path = '', key = ''): void {
 const say = (message: string): void => { out.push({ id, message: path ? `${path}: ${message}` : message }); };
 const at = (k: string | number) => typeof k === 'number' ? `${path}[${k}]` : path ? `${path}.${k}` : k;
 if (typeof spec === 'string' || 'literal' in spec || 'enum' in spec) {
  if (!pick(value, [spec])) say(`expected ${describe(spec)}, not ${JSON.stringify(value)}`);
  return;
 }
 if ('oneOf' in spec) {
  const s = pick(value, spec.oneOf);
  if (s) checkShape(value, s, out, id, path, key);
  else say(`expected ${describe(spec)}, not ${JSON.stringify(value)}`);
  return;
 }
 if ('list' in spec || 'tuple' in spec) {
  if (!Array.isArray(value)) return say(`expected ${describe(spec)}`);
  if ('tuple' in spec && value.length !== spec.tuple.length) return say(`expected ${describe(spec)}`);
  value.forEach((v, i) => checkShape(v, 'list' in spec ? spec.list : spec.tuple[i], out, id, at(i), key));
  return;
 }
 if (!isObject(value)) return say(`expected ${describe(spec)}`);
 if ('record' in spec) { for (const [k, v] of Object.entries(value)) checkShape(v, spec.record, out, id, at(k), key); return; }
 const own = scope(spec.shape, value, id, key), inner = own === id ? path : '';
 const sayIn = (message: string) => out.push({ id: own, message: inner ? `${inner}: ${message}` : message });
 const known = fields(spec.shape);
 for (const f of known) {
  if (!(f.key in value)) { if (!f.optional) sayIn(`${f.key} is missing`); continue; }
  checkShape(value[f.key], f.spec, out, own, inner ? `${inner}.${f.key}` : f.key, f.key);
 }
 for (const k of Object.keys(value)) if (!known.some(f => f.key === k)) sayIn(`${k} is not a field of ${spec.shape}`);
}

/** The value with every object's fields in schema order; fields the schema does not know keep their place at the end. */
export function canonical(value: unknown, spec: Spec): unknown {
 if (typeof spec === 'string' || 'literal' in spec || 'enum' in spec) return value;
 if ('oneOf' in spec) { const s = pick(value, spec.oneOf); return s ? canonical(value, s) : value; }
 if ('list' in spec || 'tuple' in spec) return Array.isArray(value) ? value.map((v, i) => canonical(v, 'list' in spec ? spec.list : spec.tuple[i] ?? 'unknown')) : value;
 if (!isObject(value)) return value;
 if ('record' in spec) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, canonical(v, spec.record)]));
 const known = fields(spec.shape), out: Obj = {};
 for (const f of known) if (f.key in value) out[f.key] = canonical(value[f.key], f.spec);
 for (const [k, v] of Object.entries(value)) if (!(k in out)) out[k] = v;
 return out;
}

// ── Protocol language v1 (`abrazos.protocol/v1`) ────────────────────────────────────────────────
// The v1 schema as data, field for field with types.ts. One declaration drives the level 1 shape check
// (checkV1Shape), the canonical print (canonicalV1) and the exported JSON Schema (v1JsonSchema, v1.schema.json).
// The obsolete declarations above stay only while their old readers exist.


/**
 * `id` is a nonempty string; `json` any JSON value; `template` a value template (types.ts ValueTemplate).
 * `reason` on an enum or tagged union names the catalogued reason for a value outside it.
 * A `oneOf` of shapes is read as the shape whose required fields the value has, then the one it matches best.
 * `present` reads an object as `then` when it has that field and as `else` otherwise.
 */
export type V1Spec =
 | 'id' | 'string' | 'number' | 'boolean' | 'json' | 'template'
 | { literal: string | number | boolean }
 | { enum: readonly string[]; reason?: string }
 | { list: V1Spec }
 | { map: V1Spec }
 | { shape: string }
 | { tagged: string; variants: Readonly<Record<string, V1Spec>>; reason?: string }
 | { present: string; then: V1Spec; else: V1Spec }
 | { oneOf: readonly V1Spec[] };

const v = {
 list: (of: V1Spec): V1Spec => ({ list: of }),
 map: (of: V1Spec): V1Spec => ({ map: of }),
 shape: (name: string): V1Spec => ({ shape: name }),
 oneOf: (...of: V1Spec[]): V1Spec => ({ oneOf: of }),
 literal: (value: string | number | boolean): V1Spec => ({ literal: value }),
 choice: (values: readonly string[], reason?: string): V1Spec => ({ enum: values, ...(reason ? { reason } : {}) }),
};
const ids = v.list('id');
const owner = v.oneOf(v.shape('RoleSpec'), v.shape('BindingRef'));
const typeDescriptor = v.shape('TypeDescriptor');
const operand = v.oneOf(v.shape('InputOperand'), v.shape('ValueOperand'));
const fallback = v.shape('Fallback');
const workFields = {
 'owner?': owner, 'performer?': owner, 'policy?': v.shape('PolicyRef'), 'due?': v.shape('Due'),
 'lifetime?': v.choice(['execution', 'independent']), 'purpose?': 'string',
 'as?': v.oneOf('string', v.shape('HandleReplace')), 'occurrence?': 'template',
} as const satisfies Record<string, V1Spec>;
const effectBase = { id: 'id', kind: 'id', 'when?': 'string', 'decision?': v.oneOf(v.shape('EffectCitation'), v.shape('RecordCitation')) } as const satisfies Record<string, V1Spec>;
const changeBase = { ...effectBase, work: v.oneOf(v.shape('HandleSelector'), 'template'), expected_revision: 'template', operation: 'id' } as const satisfies Record<string, V1Spec>;
const typeVariants: Record<string, V1Spec> = Object.fromEntries(
 ['yes_no', 'count', 'number', 'date', 'datetime', 'time', 'instant', 'text', 'identifier', 'revision', 'context'].map(t => [t, v.shape('ScalarType')]));

/** Each v1 shape's fields in schema order; `?` marks an optional field. The unions are in v1Unions. */
export const v1Shapes: Readonly<Record<string, Readonly<Record<string, V1Spec>>>> = {
 ProtocolDocument: {
  format: v.literal(PROTOCOL_FORMAT), id: 'id', revision: 'id', status: 'string', 'imports?': v.list(v.shape('ContentRef')),
  'roles?': v.map(v.shape('Role')), 'definitions?': v.shape('Definitions'), workflows: v.list(v.shape('Workflow')), 'evidence?': v.map(v.shape('Evidence')),
  'overrides?': v.list(v.shape('LocalOverride')), 'sops?': v.map(v.shape('Sop')),
 },
 ContentRef: { protocol: 'id', revision: 'id', identity: 'id' },
 Role: { title: 'string', 'terms?': ids },
 Evidence: { kind: 'string', 'note?': 'string', 'locator?': 'string', 'hash?': 'string' },
 Sop: { title: 'string', basis: v.choice(['source_fits', 'source_adapted', 'source_unclear', 'local_choice']), evidence: ids, note: 'string', status: 'string' },
 LocalOverride: { kind: v.choice(['sop', 'pilot', 'study']), 'sop?': 'id', 'base?': 'id', element: 'string', original: 'json', replacement: 'json', site: 'id', author: 'id', 'rationale?': 'string', 'status?': 'string' },
 Definitions: {
  'inputs?': v.map(v.shape('InputDecl')), 'calculations?': v.map(v.shape('Calculation')), 'parameters?': v.map(v.shape('Parameter')),
  'content?': v.map(v.shape('ContentMap')), 'events?': v.map(v.shape('EventContract')), 'records?': v.map(v.shape('RecordContract')),
  'tables?': v.map(v.shape('Table')), 'work_templates?': v.map(v.shape('WorkTemplate')), 'work_policies?': v.map(v.shape('WorkPolicy')), 'fallback?': fallback,
 },
 Parameter: { type: typeDescriptor, value: 'json' },
 ContentMap: { key: typeDescriptor, entries: v.map(v.map('json')) },
 Workflow: {
  id: 'id', subject: 'id', 'lifecycle_of?': v.shape('BindingRef'), inputs: v.map(v.shape('InputDecl')), 'calculations?': v.map(v.shape('Calculation')),
  initial: 'id', states: v.list(v.shape('StateDecl')), 'fallback?': fallback, tables: v.list(v.shape('Table')),
 },
 StateDecl: { id: 'id', title: 'string', 'decision?': v.shape('DecisionDecl') },
 DecisionDecl: { question: 'string', authority: { tagged: 'kind', variants: { role: v.shape('RoleAuthority'), protocol: v.shape('ProtocolAuthority') } } },
 RoleAuthority: { kind: v.literal('role'), role: 'id' },
 ProtocolAuthority: { kind: v.literal('protocol'), 'authorization?': v.shape('IdRef') },
 IdRef: { id: 'id' },
 Fallback: Object.fromEntries(FAILURE_CLASSES.map(c => [`${c}?`, 'id' as V1Spec])),
 Trigger: { event: 'id', 'for?': v.shape('BindingRef'), 'work?': 'string', 'table?': 'id' },
 BindingRef: { binding: 'string' },
 RoleSpec: { role: 'id' },
 RequestContract: { fixed: v.map(v.shape('FixedField')), collected: v.map(v.shape('CollectedField')) },
 FixedField: { target: 'string' },
 CollectedField: { target: 'string', 'optional?': v.literal(true) },
 Table: {
  id: 'id', purpose: v.choice(TABLE_PURPOSES, 'invalid_table_purpose'), on: v.shape('Trigger'), 'inputs?': v.map(v.shape('InputDecl')),
  'hit?': v.choice(['unique', 'priority'], 'unsupported_hit_policy'), 'precedence_evidence?': ids, 'request?': v.shape('RequestContract'),
  'fallback?': fallback, 'aliases?': v.map('string'), rules: v.list(v.shape('TableRule')),
 },
 TableRule: { id: 'id', in: ids, when: 'string', 'rank?': 'number', effects: v.list(v.shape('Effect')), to: v.oneOf(v.shape('ToState'), v.shape('Stay'), v.shape('ToEnd')), evidence: ids, 'sops?': ids },
 ToState: { state: 'id' }, Stay: { stay: v.literal(true) }, ToEnd: { end: 'id', 'handoff?': v.shape('Handoff') },
 Handoff: { level: 'id', pathway: v.oneOf('id', v.shape('ExternalPathway')), 'description?': 'id' },
 ExternalPathway: { document: 'id', workflow: 'id' },
 InputDecl: { 'type?': typeDescriptor, 'term?': 'id', 'label?': 'id', binding: v.oneOf('string', v.shape('Latest'), v.shape('Earliest'), v.shape('ExistsIn'), v.shape('ExistsOf'), v.shape('UniqueOf'), v.shape('ContentKey'), v.shape('ContentEntry')), 'required?': v.choice(['entry', 'decision', 'optional']), 'resource?': v.shape('LocalResource') },
 LocalResource: { updates: v.choice(['deployment', 'case']), supplied_by: 'id' },
 Latest: { latest: 'id', of: 'string', 'in?': 'string', 'before?': 'string', 'field?': 'string' },
 Earliest: { earliest: 'id', of: 'string', 'in?': 'string', 'before?': 'string', 'field?': 'string' },
 ExistsIn: { exists: 'id', in: v.literal('this_execution') },
 ExistsOf: { exists: 'id', of: 'string' },
 UniqueOf: { unique: 'id', of: 'string' },
 ContentKey: { content: 'id', key: 'string', field: 'string' },
 ContentEntry: { content: 'id', entry: 'string', field: 'string' },
 ScalarType: { type: 'id' },
 ListedType: { type: v.literal('listed'), values: v.list('id'), 'ordered?': 'boolean' },
 QuantityType: { type: v.literal('quantity'), unit: 'string' },
 ReferenceType: { type: v.literal('reference'), target: 'string' },
 ListType: { type: v.literal('list'), items: typeDescriptor },
 WindowType: { type: v.literal('window'), of: typeDescriptor },
 RecordType: { type: v.literal('record'), record: 'id' },
 FieldDecl: { type: typeDescriptor, 'optional?': v.literal(true), 'none?': v.literal(true), 'term?': 'id', 'label?': 'id' },
 SharedTerm: {
  label: 'id', kind: 'id', scope: 'id', meaning: 'id', 'unit?': 'id', 'values?': ids, 'ordered?': 'boolean',
  'range?': v.list('number'), 'unknown?': 'string', 'payload?': 'json', map: v.shape('TermMapping'),
 },
 TermMapping: {
  relation: v.choice(['same', 'close', 'answer', 'derived', 'local']), version: 'id', 'ciel?': 'id', 'question?': 'id',
  'differs?': 'string', 'note?': 'string', 'values?': v.map(v.shape('TermValueMapping')),
 },
 TermValueMapping: { relation: v.choice(['same', 'close', 'answer', 'derived', 'local']), 'ciel?': 'id', 'differs?': 'string', 'note?': 'string' },
 EventContract: { payload: v.map(v.shape('FieldDecl')) },
 RecordContract: { fields: v.map(v.shape('FieldDecl')), 'subject?': 'id', 'protected?': v.list('string') },
 WorkTemplate: { title: 'string', 'performer?': v.shape('RoleSpec'), completion: v.shape('Completion'), 'content?': v.map(v.shape('FieldDecl')), 'result?': v.map(v.shape('SourceFieldDecl')), 'protected?': v.literal(true) },
 Completion: { evidence: 'string', 'delivery?': v.shape('DeliveryCompletion') },
 DeliveryCompletion: { content: 'id', recipient: 'id' },
 SourceFieldDecl: { type: typeDescriptor, role: v.choice(['information', 'control']), 'optional?': v.literal(true), 'term?': 'id', 'label?': 'id' },
 WorkPolicy: {
  id: 'id', revision: 'id', subject: v.choice(['task', 'order', 'publication']), inputs: v.map(v.shape('InputDecl')), initial: 'id',
  states: v.list(v.shape('StateDecl')), 'fallback?': fallback, tables: v.list(v.shape('Table')), 'waiting?': v.map(v.shape('Waiting')),
 },
 Waiting: { limit: 'string', owner, reason: 'string', approval: 'string', evidence: ids },
 CalcWhen: { when: 'string' },
 CalcCases: { cases: v.list(v.shape('CalcCase')) },
 CalcCase: { when: 'string', value: operand },
 CalcMultiply: { multiply: v.list(operand) },
 CalcMin: { min: v.list(operand) },
 CalcChange: { change_percent: v.shape('FromTo') },
 FromTo: { from: operand, to: operand },
 CalcElapsed: { elapsed: v.shape('Elapsed') },
 Elapsed: { from: operand, to: operand, unit: v.choice(['s', 'min', 'h', 'd', 'wk', 'mo', 'a']), basis: v.choice(['duration', 'calendar']), 'dates_in?': 'string' },
 CalcAllCompleted: { all_completed: v.list(operand) },
 InputOperand: { input: 'string' },
 ValueOperand: { value: 'json' },
 RecordEffect: { ...effectBase, record: 'id', fields: v.map('template'), 'for?': 'template', 'as?': 'string' },
 PublishEffect: { ...effectBase, record: 'template', to: 'template', ...workFields },
 OrderEffect: { ...effectBase, order: v.choice(ORDER_KINDS), for: 'template', content: v.map('template'), 'limits?': v.list(v.shape('OrderLimit')), ...workFields },
 OrderLimit: { field: 'id', maximum: 'template' },
 TaskEffect: { ...effectBase, task: 'id', for: 'template', 'content?': v.map('template'), ...workFields },
 // A reissue takes its subject, owner, performer, policy and lifetime from the completed task and replaces that task's
 // handle, so it states no for, as, owner, performer, policy, lifetime or purpose.
 ReissueTaskEffect: { ...effectBase, task: 'id', reissue: v.shape('Reissue'), 'content?': v.map('template'), 'due?': v.shape('Due'), 'occurrence?': 'template' },
 Reissue: { handle: 'string' },
 StartEffect: {
  ...effectBase, mode: v.choice(['new', 'bind']), definition: v.oneOf(v.shape('DefinitionWorkflow'), v.shape('DefinitionPolicy'), v.shape('LocalWorkflow')),
  for: 'template', bindings: v.map('template'), 'as?': 'string', 'instance?': 'template', 'owner?': owner,
  'lifetime?': v.choice(['execution', 'independent']), 'purpose?': 'string', 'predecessor?': 'template', 'allow_ended?': v.literal(true),
 },
 DefinitionWorkflow: { content: v.shape('ContentRef'), workflow: 'id' },
 DefinitionPolicy: { content: v.shape('ContentRef'), policy: 'id' },
 LocalWorkflow: { workflow: 'id' },
 EmitEffect: { ...effectBase, event: 'id', fields: v.map('template'), 'for?': 'template', 'to?': 'template', 'activation?': v.choice(['current', 'destination']) },
 RescheduleWork: { ...changeBase, due: v.shape('Due') },
 RebindWork: { ...changeBase, set: v.shape('RebindSet'), 'due?': v.shape('Due'), 'acceptance?': 'template', 'replacement?': 'template' },
 RebindSet: { 'subject?': 'template', 'anchor?': 'template', 'owner?': 'template', 'lifetime?': 'template', 'purpose?': 'template' },
 SatisfyWork: { ...changeBase, evidence: 'template' },
 CancelWork: { ...changeBase, reason: 'template' },
 RetryWork: { ...changeBase, attempt: 'template' },
 HandleSelector: { handle: 'string', 'occurrence?': 'template' },
 HandleReplace: { handle: 'string', replace: v.literal(true) },
 EffectCitation: { effect: 'id' },
 RecordCitation: { record: 'template' },
 // Exactly one of after, before and window; validateProtocol checks that and that each offset is a nonnegative time.
 Due: { from: v.oneOf(v.shape('TriggerAnchor'), v.shape('InputAnchor'), v.shape('WorkAnchor')), 'after?': v.shape('DueOffset'), 'before?': v.shape('DueOffset'), 'window?': v.shape('DueWindow'), basis: v.choice(['duration', 'calendar']), 'zone?': 'string' },
 TriggerAnchor: { event: v.literal('trigger') },
 InputAnchor: { input: 'string' },
 WorkAnchor: { work: 'string', field: 'string' },
 DueWindow: { min: v.shape('DueOffset'), max: v.shape('DueOffset') },
 Quantity: { value: 'number', unit: 'string' },
 PolicyRef: { id: 'id', revision: 'id' },
};

/** The named unions: a type descriptor by its `type`, an effect by its `kind` (and a change by its `operation`), a calculation by its one key. */
export const v1Unions: Readonly<Record<string, V1Spec>> = {
 TypeDescriptor: { tagged: 'type', variants: {
  ...typeVariants, listed: v.shape('ListedType'), quantity: v.shape('QuantityType'), reference: v.shape('ReferenceType'),
  list: v.shape('ListType'), window: v.shape('WindowType'), record: v.shape('RecordType'),
 } },
 DueOffset: v.oneOf(v.shape('Quantity'), v.shape('InputOperand'), v.shape('BindingRef'), v.shape('EffectCitation')),
 Calculation: v.oneOf(...['CalcWhen', 'CalcCases', 'CalcMultiply', 'CalcMin', 'CalcChange', 'CalcElapsed', 'CalcAllCompleted'].map(v.shape)),
 Effect: { tagged: 'kind', reason: 'unknown_effect_kind', variants: {
  record: v.shape('RecordEffect'), publish: v.shape('PublishEffect'), order: v.shape('OrderEffect'),
  task: { present: 'reissue', then: v.shape('ReissueTaskEffect'), else: v.shape('TaskEffect') },
  start: v.shape('StartEffect'), emit: v.shape('EmitEffect'),
  change_work: { tagged: 'operation', variants: {
   reschedule: v.shape('RescheduleWork'), rebind: v.shape('RebindWork'), satisfy: v.shape('SatisfyWork'), cancel: v.shape('CancelWork'), retry: v.shape('RetryWork'),
  } },
 } satisfies Record<typeof EFFECT_KINDS[number], V1Spec> },
};

/** The reason for a missing required field, when it is not the generic one: `Shape.field`, or `Shape` for every field. */
export const v1MissingReasons: Readonly<Record<string, string>> = {
 'ProtocolDocument.revision': 'missing_revision',
 TableRule: 'missing_rule_field',
};

/** The reason for a field whose value has the wrong shape, when it is not the generic one: `Shape.field`. */
export const v1FieldReasons: Readonly<Record<string, string>> = { 'TableRule.rank': 'non_numeric_rank' };

/** The reserved keys of a value template expression; an object with one is exactly that one key. */
export const TEMPLATE_KEYS = ['value', 'input', 'binding', 'effect'] as const;

/** A structural problem: the reason, the JSON Pointer of the value and its details. */
export interface V1ShapeProblem { reason: string; at: string; data: Record<string, string | number | boolean | readonly string[]> }

const isPlain = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const pointer = (at: string, key: string | number) => `${at}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
const resolve = (s: V1Spec): V1Spec => typeof s === 'object' && 'shape' in s && Object.hasOwn(v1Unions, s.shape) ? v1Unions[s.shape] : s;
const v1Fields = (name: string) => Object.entries(v1Shapes[name]).map(([k, spec]) => ({ key: k.replace(/\?$/, ''), optional: k.endsWith('?'), spec }));

/** The variant of a union a value is written in, or undefined. Shapes are matched by their fields, not by order. */
function pickV1(value: unknown, specs: readonly V1Spec[]): V1Spec | undefined {
 const all = specs.flatMap(function flatten(s): V1Spec[] { const r = resolve(s); return typeof r === 'object' && 'oneOf' in r ? r.oneOf.flatMap(flatten) : [r]; });
 const shapes = all.filter((s): s is { shape: string } => typeof s === 'object' && 'shape' in s);
 if (isPlain(value) && shapes.length) {
  const score = (s: { shape: string }) => {
   const f = v1Fields(s.shape), keys = Object.keys(value);
   const required = f.filter(x => !x.optional).every(x => x.key in value);
   const matched = keys.filter(k => f.some(x => x.key === k)).length;
   return { required, matched, extra: keys.length - matched };
  };
  const ranked = shapes.map(s => ({ s, ...score(s) })).filter(x => x.matched > 0)
   .sort((a, b) => Number(b.required) - Number(a.required) || b.matched - a.matched || a.extra - b.extra);
  if (ranked.length) return ranked[0].s;
 }
 return all.find(s => {
  if (s === 'json' || s === 'template') return true;
  if (s === 'id' || s === 'string') return typeof value === 'string';
  if (s === 'number') return typeof value === 'number';
  if (s === 'boolean') return typeof value === 'boolean';
  if (typeof s !== 'object') return false;
  if ('literal' in s) return value === s.literal;
  if ('enum' in s) return typeof value === 'string';
  if ('list' in s) return Array.isArray(value);
  return isPlain(value) && !('shape' in s);
 });
}
function describeV1(s: V1Spec): string {
 const r = resolve(s);
 if (typeof r === 'string') return { id: 'a nonempty identifier', string: 'a string', number: 'a number', boolean: 'true or false', json: 'a JSON value', template: 'a value template' }[r];
 if ('literal' in r) return JSON.stringify(r.literal);
 if ('enum' in r) return r.enum.map(x => JSON.stringify(x)).join(' or ');
 if ('list' in r) return 'a list';
 if ('map' in r) return 'an object';
 if ('shape' in r) return `{ ${v1Fields(r.shape).filter(f => !f.optional).map(f => f.key).join(', ')} }`;
 if ('tagged' in r) return `an object whose ${r.tagged} is ${Object.keys(r.variants).join(', ')}`;
 if ('present' in r) return `${describeV1(r.then)}, or ${describeV1(r.else)}`;
 return r.oneOf.map(describeV1).join(', or ');
}

/**
 * Check a value against a v1 spec. Problems carry a catalogued reason where one names the fault (`invalid_table_purpose`,
 * `unknown_effect_kind`, `missing_rule_field`, …); otherwise `invalid_shape` for a wrong value or a missing field and
 * `undeclared_field` for a field the schema does not have.
 */
export function checkV1Shape(value: unknown, spec: V1Spec, out: V1ShapeProblem[], at = '', shapeName?: string, reason = 'invalid_shape'): void {
 const s = resolve(spec);
 const wrong = (data: V1ShapeProblem['data'] = {}): void => { out.push({ reason, at, data: { expected: describeV1(s), ...data } }); };
 if (s === 'json') return;
 if (s === 'template') return checkTemplate(value, out, at);
 if (typeof s === 'string') {
  const ok = s === 'id' ? typeof value === 'string' && value.trim() !== '' : s === 'string' ? typeof value === 'string'
   : s === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === 'boolean';
  if (!ok) wrong();
  return;
 }
 if ('literal' in s) { if (value !== s.literal) wrong(); return; }
 if ('enum' in s) {
  if (typeof value !== 'string' || !s.enum.includes(value)) out.push({ reason: s.reason ?? 'invalid_shape', at, data: { expected: describeV1(s), ...(typeof value === 'string' ? { value } : {}) } });
  return;
 }
 if ('list' in s) { if (!Array.isArray(value)) return wrong(); value.forEach((x, i) => checkV1Shape(x, s.list, out, pointer(at, i))); return; }
 if ('map' in s) { if (!isPlain(value)) return wrong(); for (const [k, x] of Object.entries(value)) checkV1Shape(x, s.map, out, pointer(at, k)); return; }
 if ('tagged' in s) {
  if (!isPlain(value)) return wrong();
  const tag = value[s.tagged];
  if (typeof tag !== 'string' || !Object.hasOwn(s.variants, tag))
   return void out.push({ reason: s.reason ?? 'invalid_shape', at: tag === undefined ? at : pointer(at, s.tagged), data: { field: s.tagged, expected: Object.keys(s.variants).join(', '), ...(typeof tag === 'string' ? { value: tag } : {}) } });
  return checkV1Shape(value, s.variants[tag], out, at);
 }
 if ('present' in s) return checkV1Shape(value, isPlain(value) && Object.hasOwn(value, s.present) ? s.then : s.else, out, at);
 if ('oneOf' in s) { const p = pickV1(value, s.oneOf); return p ? checkV1Shape(value, p, out, at) : wrong(); }
 if (!isPlain(value)) return wrong();
 const name = s.shape, fields = v1Fields(name);
 for (const f of fields) {
  if (!(f.key in value)) {
   if (!f.optional) out.push({ reason: v1MissingReasons[`${name}.${f.key}`] ?? v1MissingReasons[name] ?? 'invalid_shape', at, data: { field: f.key } });
   continue;
  }
  checkV1Shape(value[f.key], f.spec, out, pointer(at, f.key), name, v1FieldReasons[`${name}.${f.key}`]);
 }
 for (const k of Object.keys(value)) if (!fields.some(f => f.key === k)) out.push({ reason: 'undeclared_field', at: pointer(at, k), data: { field: k, shape: shapeName ? `${name} in ${shapeName}` : name } });
}

/** A value template: a JSON scalar, a list or map of templates, or exactly one reserved expression. */
function checkTemplate(value: unknown, out: V1ShapeProblem[], at: string): void {
 if (value === null || typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return;
 if (Array.isArray(value)) return value.forEach((x, i) => checkTemplate(x, out, pointer(at, i)));
 if (!isPlain(value)) return void out.push({ reason: 'invalid_shape', at, data: { expected: 'a value template' } });
 const reserved = Object.keys(value).filter(k => (TEMPLATE_KEYS as readonly string[]).includes(k));
 if (!reserved.length) { for (const [k, x] of Object.entries(value)) checkTemplate(x, out, pointer(at, k)); return; }
 if (Object.keys(value).length !== 1)
  return void out.push({ reason: 'invalid_shape', at, data: { expected: `exactly one of ${TEMPLATE_KEYS.join(', ')}; escape an object literal as {value: …}`, keys: Object.keys(value) } });
 const [key] = reserved, x = value[key];
 if (key !== 'value' && (typeof x !== 'string' || x.trim() === '')) out.push({ reason: 'invalid_shape', at: pointer(at, key), data: { expected: 'a nonempty name' } });
}

/** The value with every object's fields in schema order. Fields the schema does not know keep their place at the end; template maps keep theirs. */
export function canonicalV1(value: unknown, spec: V1Spec = { shape: 'ProtocolDocument' }): unknown {
 const s = resolve(spec);
 if (typeof s === 'string' || 'literal' in s || 'enum' in s) return value;
 if ('list' in s) return Array.isArray(value) ? value.map(x => canonicalV1(x, s.list)) : value;
 if (!isPlain(value)) return value;
 if ('map' in s) return Object.fromEntries(Object.entries(value).map(([k, x]) => [k, canonicalV1(x, s.map)]));
 if ('tagged' in s) { const tag = value[s.tagged]; return typeof tag === 'string' && Object.hasOwn(s.variants, tag) ? canonicalV1(value, s.variants[tag]) : value; }
 if ('present' in s) return canonicalV1(value, Object.hasOwn(value, s.present) ? s.then : s.else);
 if ('oneOf' in s) { const p = pickV1(value, s.oneOf); return p ? canonicalV1(value, p) : value; }
 const out: Obj = {};
 for (const f of v1Fields(s.shape)) if (f.key in value) out[f.key] = canonicalV1(value[f.key], f.spec);
 for (const [k, x] of Object.entries(value)) if (!(k in out)) out[k] = x;
 return out;
}

/** One v1 document as JSON: fields in schema order, 2-space indent, a final newline. */
export function printV1(document: unknown): string {
 return `${JSON.stringify(canonicalV1(document), null, 2)}\n`;
}

/** An identifier or expression name has a character that is not white space, as checkV1Shape requires (`trim() !== ''`). */
const NOT_BLANK = '\\S';

/** The v1 schema as JSON Schema (draft 2020-12), generated from the same declarations; v1.schema.json is this value printed. */
export function v1JsonSchema(): Record<string, unknown> {
 const ref = (name: string) => ({ $ref: `#/$defs/${name}` });
 const json = (s: V1Spec): unknown => {
  if (s === 'json') return {};
  if (s === 'template') return ref('ValueTemplate');
  if (s === 'id') return { type: 'string', minLength: 1, pattern: NOT_BLANK };
  if (typeof s === 'string') return { type: s };
  if ('literal' in s) return { const: s.literal };
  if ('enum' in s) return { enum: s.enum };
  if ('list' in s) return { type: 'array', items: json(s.list) };
  if ('map' in s) return { type: 'object', additionalProperties: json(s.map) };
  if ('shape' in s) return ref(s.shape);
  if ('tagged' in s) return {
   type: 'object', required: [s.tagged], properties: { [s.tagged]: { enum: Object.keys(s.variants) } },
   oneOf: Object.entries(s.variants).map(([tag, x]) => ({ if: { properties: { [s.tagged]: { const: tag } } }, then: json(x), else: false })),
  };
  if ('present' in s) return { if: { required: [s.present] }, then: json(s.then), else: json(s.else) };
  return { anyOf: s.oneOf.map(json) };
 };
 const defs: Record<string, unknown> = {};
 for (const [name, union] of Object.entries(v1Unions)) defs[name] = json(union);
 for (const name of Object.keys(v1Shapes)) {
  const fields = v1Fields(name);
  defs[name] = {
   type: 'object', additionalProperties: false,
   required: fields.filter(f => !f.optional).map(f => f.key),
   properties: Object.fromEntries(fields.map(f => [f.key, json(f.spec)])),
  };
 }
 defs.ValueTemplate = { anyOf: [
  { type: ['null', 'boolean', 'number', 'string'] },
  { type: 'array', items: ref('ValueTemplate') },
  ...TEMPLATE_KEYS.map(k => ({ type: 'object', required: [k], additionalProperties: false, properties: { [k]: k === 'value' ? {} : { type: 'string', minLength: 1, pattern: NOT_BLANK } } })),
  { type: 'object', propertyNames: { not: { enum: TEMPLATE_KEYS } }, additionalProperties: ref('ValueTemplate') },
 ] };
 return {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://abrazos.health/schema/protocol/v1.schema.json',
  title: 'Abrazos protocol language v1',
  description: 'Generated from core/protocol/schema.ts (v1Shapes). Do not edit: change the declarations, then run WRITE_V1_SCHEMA=1 bun test ./core/protocol/v1-validation.test.ts. Structure only: references, types and bindings are checked by validateProtocol.',
  ...ref('ProtocolDocument'),
  $defs: defs,
 };
}
