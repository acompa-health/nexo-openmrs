/**
 * Fact resolution: each declared input becomes a known value or an unknown with a reason, read from one pinned snapshot
 * per attempt. The source forms are a typed path, `latest`/`earliest`, `exists`, `unique` and authored `content`.
 * A bad external value is an attributed unknown (`invalid_value`) that keeps the raw value in its detail; a bad
 * declaration (an undeclared root, a missing content map) throws, because the validator should have refused it.
 * Source: the resolved v1 contract, "Named inputs, values and conditions".
 */
import { compareQuantities, unitDimension } from '../../logic/index.ts';
import type { Concepts } from '../../logic/index.ts';
import { REFERENCE_KINDS, readSuppliedDatum } from '../contracts.ts';
import type { HistoryRecord, Id, InputDecl, JsonValue, ObjectRef, ProtocolDefinitions, ReferenceKind, RegistryResponse, ResolvedInput, Revision, TypeDescriptor } from '../types.ts';
export type { HistoryRecord, RegistryResponse } from '../types.ts';
import { patientOfObject } from './events.ts';
import { objectReferenceShapeError, OBJECT_REFERENCE_FIELDS } from './references.ts';
import { compareTimes, parseTime } from './time.ts';

/**
 * One revision of a clinical object, as the snapshot holds it. `superseded_by` marks a revision that a later
 * host-attested revision replaced: a pinned reference still reads it, an unpinned one reads the current revision.
 */
export interface SnapshotObject { type: Id; id: Id; revision: Revision; fields: Readonly<Record<string, JsonValue>>; superseded_by?: Revision }
/** The committed state one attempt reads. Pin it with pinSnapshot; it is not re-read during the attempt. */
export interface Snapshot {
 readonly attempt: Id;
 /** Path roots: `event`, `this_execution`, `entry`, and the execution's bindings by name. */
 readonly roots: Readonly<Record<string, JsonValue>>;
 /** Typed local aliases, alias → path (`request` → `event.payload`). */
 readonly aliases?: Readonly<Record<string, string>>;
 readonly objects?: readonly SnapshotObject[];
 /** Cases awaiting a host-confirmed stage revision. */
 readonly pending_stages?: readonly ObjectRef[];
 readonly stage_records?: readonly { subject: Id; record: Id }[];
 readonly confirmed_stages?: readonly { subject: ObjectRef; record: Id; stage: JsonValue }[];
 readonly history?: readonly HistoryRecord[];
 /** Records of this execution, including ones staged earlier in this attempt. */
 readonly execution_records?: readonly { record: Id; staged?: boolean }[];
 readonly registries?: Readonly<Record<Id, RegistryResponse>>;
 readonly content?: ProtocolDefinitions['content'];
}

const pinned = new WeakSet<Snapshot>();
const freeze = <T>(value: T): T => {
 if (typeof value === 'object' && value !== null) { for (const v of Object.values(value)) freeze(v); Object.freeze(value); }
 return value;
};
/** A frozen copy of the snapshot: later changes to the source are not seen by this attempt. */
export function pinSnapshot(snapshot: Snapshot): Snapshot {
 const copy = freeze(structuredClone(snapshot));
 pinned.add(copy);
 return copy;
}

const isRecord = (v: unknown): v is Readonly<Record<string, JsonValue>> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isRef = (v: unknown): v is ObjectRef => isRecord(v) && typeof v.type === 'string' && typeof v.id === 'string';
const isQuantity = (v: unknown): v is { value: number; unit: string } =>
 isRecord(v) && Object.keys(v).length === 2 && typeof v.value === 'number' && Number.isFinite(v.value) && typeof v.unit === 'string';
const unknown = (reason: string, detail?: string): ResolvedInput => ({ state: 'unknown', reason, ...(detail ? { detail } : {}) });
const absent = (): ResolvedInput => ({ state: 'unknown', reason: 'absent' });
type Provenance = { source?: string; revision?: string };

/** The template of a known work occurrence, for a `work:<template>` reference; undefined when no such occurrence exists. */
export type WorkTemplateOf = (ref: { id: Id; occurrence: Id }) => Id | undefined;
/**
 * Why a value does not fit its declared type, or undefined when it does. A `work:<template>` reference has the work
 * reference shape; with `workTemplate`, it must also name a known occurrence whose captured template is that template.
 */
export function typeError(type: TypeDescriptor, v: JsonValue, workTemplate?: WorkTemplateOf): string | undefined {
 const fail = (what: string) => `not ${what}`;
 switch (type.type) {
  case 'yes_no': return v === true || v === false || v === 'yes' || v === 'no' ? undefined : fail('yes or no');
  case 'listed': return typeof v === 'string' && type.values.includes(v) ? undefined : fail(`one of ${type.values.join(', ')}`);
  case 'count': return Number.isInteger(v) && (v as number) >= 0 ? undefined : fail('a whole number of zero or more');
  case 'number': return typeof v === 'number' && Number.isFinite(v) ? undefined : fail('a finite number');
  case 'quantity':
   if (!isQuantity(v)) return fail(`a quantity with its unit (${type.unit})`);
   return unitDimension(v.unit) !== undefined && unitDimension(v.unit) === unitDimension(type.unit) ? undefined : fail(`a quantity comparable with ${type.unit}`);
  case 'date': return typeof v === 'string' && parseTime(v) && parseTime(v)!.precision !== 'instant' ? undefined : fail('a date');
  case 'datetime': case 'instant': return typeof v === 'string' && parseTime(v)?.precision === 'instant' ? undefined : fail('an instant with an offset');
  case 'time': return typeof v === 'string' && parseTime(v) ? undefined : fail('a date or an instant');
  case 'text': case 'revision': return typeof v === 'string' ? undefined : fail('text');
  case 'identifier': return typeof v === 'string' && v !== '' ? undefined : fail('an identifier');
  case 'context': case 'record': return isRecord(v) ? undefined : fail('a record');
  case 'list': {
   if (!Array.isArray(v)) return fail('a list');
   const bad = v.map(i => typeError(type.items, i, workTemplate)).find(e => e);
   return bad ? `a list item is ${bad}` : undefined;
  }
  case 'reference': {
   if (!isRecord(v)) return fail(`a ${type.target} reference`);
   if (type.target.startsWith('object:')) return isRef(v) && v.type === type.target.slice(7)
    ? objectReferenceShapeError(v) : fail(`a ${type.target.slice(7)} reference`);
   if (type.target.startsWith('work:')) {
    const template = type.target.slice(5);
    if (typeof v.id !== 'string' || typeof v.occurrence !== 'string') return fail(`a ${type.target} reference`);
    if (!workTemplate) return undefined;
    const actual = workTemplate({ id: v.id, occurrence: v.occurrence });
    return actual === undefined ? fail(`a known work occurrence (${v.id}/${v.occurrence})`) : actual === template ? undefined : `a ${actual} occurrence, not ${type.target}`;
   }
   const kind = REFERENCE_KINDS[type.target as ReferenceKind];
   return kind.required.every(f => Object.hasOwn(v, f)) ? undefined : fail(`a ${type.target} reference`);
  }
  case 'window': {
   if (!isRecord(v) || Object.keys(v).length !== 2 || !Object.hasOwn(v, 'min') || !Object.hasOwn(v, 'max')) return fail('a window {min, max}');
   const bad = typeError(type.of, v.min, workTemplate) ?? typeError(type.of, v.max, workTemplate);
   if (bad) return `a window bound is ${bad}`;
   const order = isQuantity(v.min) && isQuantity(v.max) ? compareQuantities(v.min, v.max)
    : typeof v.min === 'number' && typeof v.max === 'number' ? Math.sign(v.min - v.max)
    : compareTimes(v.min as string, v.max as string);
   return order === 1 ? 'a window whose min is after its max' : undefined;
  }
 }
}

/** A supplied value checked against its declaration: known, or unknown with its reason and the raw value in the detail. */
function typed(type: TypeDescriptor | undefined, raw: unknown, provenance: Provenance): ResolvedInput {
 const r = readSuppliedDatum(raw, provenance);
 if (r.state === 'unknown' || !type) return r;
 const error = typeError(type, r.value);
 return error ? { state: 'unknown', reason: 'invalid_value', detail: `${error}: ${JSON.stringify(r.value)}`, ...provenance } : r;
}

/** Follow an object reference to its one current revision in the snapshot, or exactly the pinned one. */
function dereference(snapshot: Snapshot, ref: ObjectRef): SnapshotObject | ResolvedInput {
 const all = (snapshot.objects ?? []).filter(o => o.type === ref.type && o.id === ref.id);
 const label = `${ref.type}:${ref.id}`;
 if (ref.revision !== undefined) return all.find(o => o.revision === ref.revision) ?? unknown('source_unavailable', `${label} at revision ${ref.revision} is not in this snapshot`);
 if (snapshot.pending_stages?.some(o => o.type === ref.type && o.id === ref.id)) return unknown('source_unavailable', `${label} has a pending stage handoff`);
 const current = all.filter(o => o.superseded_by === undefined);
 if (current.length === 1) return current[0];
 return current.length ? unknown('unresolved_selection', `${label} has ${current.length} revisions here and the reference pins none`) : unknown('source_unavailable', `${label} is not in this snapshot`);
}

/**
 * Read a typed path. Field names may contain dots (`event.data.a.count`): the longest own key wins at each step.
 * A reference is followed into its object, recording the revision read. Absence is `absent`; no latest-record search.
 */
export function readPath(snapshot: Snapshot, path: string, type?: TypeDescriptor): ResolvedInput {
 let segments = path.split('.');
 const alias = snapshot.aliases?.[segments[0]];
 if (alias !== undefined) segments = [...alias.split('.'), ...segments.slice(1)];
 const [root, ...rest] = segments;
 if (!Object.hasOwn(snapshot.roots, root)) throw new Error(`${path}: ${root} is not a root of this snapshot.`);
 let value: unknown = snapshot.roots[root], provenance: Provenance = {};
 while (rest.length) {
  if (value !== snapshot.roots.event && isRef(value) && !OBJECT_REFERENCE_FIELDS.includes(rest[0])) {
   const target = dereference(snapshot, value);
   if ('state' in target) return { ...target, ...provenance };
   provenance = { source: `${target.type}:${target.id}`, revision: target.revision };
   value = target.fields;
   continue;
  }
  if (isRecord(value) && !isRef(value) && Object.hasOwn(value, 'unknown')) break;
  if (!isRecord(value)) return { state: 'unknown', reason: 'invalid_value', detail: `${path}: cannot read ${rest.join('.')} of ${JSON.stringify(value)}`, ...provenance };
  let n = value !== snapshot.roots.event && isRef(value) ? 1 : rest.length;
  while (n > 0 && !Object.hasOwn(value, rest.slice(0, n).join('.'))) n--;
  if (n === 0) return { ...absent(), ...provenance };
  value = value[rest.splice(0, n).join('.')];
 }
 return typed(type, value, provenance);
}

/** The single latest (or earliest) qualifying record by occurrence time, or unknown. Receipt order never breaks a tie. */
function select(snapshot: Snapshot, s: { latest?: Id; earliest?: Id; of: string; in?: string; before?: string; field?: string }, type?: TypeDescriptor): ResolvedInput {
 const kind = (s.latest ?? s.earliest)!, direction = s.latest !== undefined ? 1 : -1;
 const of = readPath(snapshot, s.of);
 if (of.state === 'unknown') return of;
 if (!isRef(of.value)) return unknown('invalid_value', `${s.of} is not an object reference: ${JSON.stringify(of.value)}`);
 const subject = of.value;
 if (s.latest !== undefined && s.before === undefined && snapshot.stage_records?.some(r => r.subject === subject.type && r.record === kind)
  && snapshot.pending_stages?.some(o => o.type === subject.type && o.id === subject.id)) return unknown('source_unavailable', `${subject.type}:${subject.id} has a pending stage handoff`);
 let candidates = (snapshot.history ?? []).filter(r => r.kind === kind && !r.retracted && r.of.type === subject.type && r.of.id === subject.id);
 if (s.in !== undefined) {
  const encounter = readPath(snapshot, s.in);
  if (encounter.state === 'unknown') return encounter;
  const id = isRef(encounter.value) ? encounter.value.id : encounter.value;
  candidates = candidates.filter(r => r.encounter === id);
 }
 if (s.before !== undefined) {
  const limit = readPath(snapshot, s.before);
  if (limit.state === 'unknown') return limit;
  const order = candidates.map(r => compareTimes(r.at, limit.value as string));
  if (order.includes(undefined)) return unknown('unresolved_selection', `a ${kind} may or may not be before ${limit.value}`);
  candidates = candidates.filter((_, i) => order[i] === -1);
 }
 if (!candidates.length) return absent();
 const winner = candidates.find(c => candidates.every(o => o === c || compareTimes(c.at, o.at) === direction));
 if (!winner) return unknown('unresolved_selection', `no single ${s.latest !== undefined ? 'latest' : 'earliest'} ${kind}: ${candidates.map(c => `${c.id}@${c.at}`).join(', ')}`);
 const confirmed = s.latest && s.before === undefined && snapshot.confirmed_stages?.find(c => c.record === kind && c.subject.type === subject.type && c.subject.id === subject.id);
 if (confirmed && winner.fields.stage !== confirmed.stage) return unknown('source_unavailable', `${kind} history does not reflect the confirmed stage`);
 const provenance = { source: `${winner.kind}:${winner.id}`, revision: winner.revision };
 if (s.field === undefined) return typed(type, { type: winner.kind, id: winner.id, revision: winner.revision }, provenance);
 return Object.hasOwn(winner.fields, s.field) ? typed(type, winner.fields[s.field], provenance) : { ...absent(), ...provenance };
}

/** `exists` in this execution, or in a named registry view whose complete, current response alone can prove no. */
function exists(snapshot: Snapshot, s: { exists: Id; in: 'this_execution' } | { exists: Id; of: string }): ResolvedInput {
 if ('in' in s) return { state: 'known', value: (snapshot.execution_records ?? []).some(r => r.record === s.exists) };
 const of = readPath(snapshot, s.of);
 if (of.state === 'unknown') return of;
 const response = snapshot.registries?.[s.exists];
 if (!response) return unknown('source_unavailable', `no response from registry view ${s.exists}`);
 if (!isRef(of.value) || response.of.type !== of.value.type || response.of.id !== of.value.id) return unknown('source_unavailable', `registry view ${s.exists} answered for another scope`);
 if (response.matches.length) return { state: 'known', value: true, source: s.exists };
 if (response.status === 'complete') return { state: 'known', value: false, source: s.exists };
 return unknown('source_unavailable', `registry view ${s.exists} is ${response.status}; it cannot prove no`);
}

/** A complete registry response can name one patient-owned object; any other cardinality stays unresolved. */
function unique(snapshot: Snapshot, s: { unique: Id; of: string }, type: TypeDescriptor | undefined): ResolvedInput {
 if (type?.type !== 'reference' || !type.target.startsWith('object:')) throw new Error(`${s.unique}: unique needs a declared object reference type.`);
 const of = readPath(snapshot, s.of);
 if (of.state === 'unknown') return of;
 const response = snapshot.registries?.[s.unique];
 if (!response || !isRef(of.value) || response.of.type !== of.value.type || response.of.id !== of.value.id)
  return unknown('source_unavailable', `registry view ${s.unique} has no response for this scope`);
 if (response.status !== 'complete') return unknown('source_unavailable', `registry view ${s.unique} is ${response.status}; it cannot identify one match`);
 if (!response.matches.length) return absent();
 if (response.matches.length !== 1) return unknown('unresolved_selection', `registry view ${s.unique} has ${response.matches.length} matches`);
 const match = response.matches[0];
 const objects = snapshot.objects ?? [];
 const scopePatient = of.value.type === 'patient' ? of.value.id : patientOfObject(of.value, objects);
 if (scopePatient === undefined || match.type !== type.target.slice('object:'.length) || patientOfObject(match, objects) !== scopePatient)
  return unknown('invalid_value', `registry view ${s.unique} does not identify a ${type.target} object of this patient`);
 const ref = { type: match.type, id: match.id, ...(match.revision !== undefined ? { revision: match.revision } : {}) };
 return typed(type, ref, { source: s.unique, ...(match.revision !== undefined ? { revision: match.revision } : {}) });
}

/**
 * Resolve every declared input from one pinned snapshot. A content lookup reads its key input first; an unknown key
 * leaves the lookup unknown with the key's reason, and an uncovered key is an attributed invalid result.
 */
export function resolveInputs(decls: Readonly<Record<string, InputDecl>>, snapshot: Snapshot): Record<string, ResolvedInput> {
 if (!pinned.has(snapshot)) throw new Error('resolveInputs needs a pinned snapshot: call pinSnapshot once per attempt.');
 const out: Record<string, ResolvedInput> = {}, visiting = new Set<string>();
 const resolve = (name: string): ResolvedInput => {
  if (Object.hasOwn(out, name)) return out[name];
  if (!Object.hasOwn(decls, name)) throw new Error(`${name} is not a declared input.`);
  if (visiting.has(name)) throw new Error(`${name} depends on itself.`);
  visiting.add(name);
  const { type, binding: b } = decls[name];
  let r: ResolvedInput;
  if (typeof b === 'string') r = readPath(snapshot, b, type);
  else if ('latest' in b || 'earliest' in b) r = select(snapshot, b, type);
  else if ('exists' in b) r = exists(snapshot, b);
  else if ('unique' in b) r = unique(snapshot, b, type);
  else {
   const map = snapshot.content?.[b.content];
   if (!map) throw new Error(`${name}: content ${b.content} is not in this snapshot.`);
   let key: string;
   if ('entry' in b) key = b.entry;
   else {
    const k = resolve(b.key);
    if (k.state === 'unknown') { out[name] = k; return k; }
    key = String(k.value);
   }
   const source = `content:${b.content}/${key}`;
   const entry = Object.hasOwn(map.entries, key) ? map.entries[key] : undefined;
   r = !entry ? unknown('invalid_value', `content ${b.content} does not cover ${JSON.stringify(key)}`)
    : Object.hasOwn(entry, b.field) ? typed(type, entry[b.field], { source }) : { ...absent(), source };
  }
  visiting.delete(name);
  return out[name] = r;
 };
 for (const name of Object.keys(decls)) resolve(name);
 return out;
}

/** What the condition evaluator needs from the declarations: units and listed values. */
export function conceptsOf(decls: Readonly<Record<string, Pick<InputDecl, 'type'>>>): Concepts {
 const out: Record<string, Concepts[string]> = {};
 for (const [name, { type }] of Object.entries(decls)) {
  if (type?.type === 'quantity') out[name] = { unit: type.unit };
  else if (type?.type === 'listed') out[name] = { values: type.values, ...(type.ordered ? { ordered: true } : {}) };
 }
 return out;
}
