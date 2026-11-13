/**
 * Validation levels 1 to 3 of the V2 contract, each a pure function of a protocol and its references, returning
 * diagnostics keyed by stable id: `<pathway>/<state>/<input>/<rule>`, `<pathway>/<state>/<output>`,
 * `<pathway>/<input>/<rule>` for a pathway's own sections, `<pathway>/start/<rule>`, `roles/<id>`, `definitions/<concept>`.
 *
 * 1 Well-formed: the shape, unique ids, every condition, expression and timing parses.
 * 2 Resolved: every concept, event, role, level, state, end, rule, work, timer, booking, calendar and cite resolves.
 * 3 Analysed: sections end with `otherwise`; no rule is shadowed; outputs go with rules; nothing acts on arrival;
 *   care is reduced only with `confirm`; doses are complete; waits can end; events are handled at every waiting
 *   state; and the unknown report, checked against option a of the register's unknown-value policy. Option c lists
 *   it as info; other selected options report an error and leave it unchecked. A section whose search reaches its
 *   limit reports an error without making claims from its unfinished analysis.
 * Levels 2 and 3 run only when level 1 finds nothing; level 3 runs whatever level 2 finds.
 */
import { conditionNames, convert, parseCondition, parseValue as parseExpr, parseTiming, timingParts, unitDimension } from '../logic/index.ts';
import type { Concept, Concepts, Expr, Parsed, Quantity } from '../logic/index.ts';
import { analyzeFlow } from './flow-analysis.ts';
import { always, analyseSection, directSelfEmitLoops, TooMany } from './analyze.ts';
import { analyzeSelectionCached } from './selection-cache.ts';
import type { AxisSpec, Giving, Landing, Report, Row } from './analyze.ts';
import { checkShape, inputKey } from './schema.ts';
import { validApproval } from './approval.ts';
import type { Action, Cite, Clock, Output, Pathway, Protocol, RegisterEntry, Rule, Schedule, Section, State } from './types.ts';
import { printCondition } from '../logic/index.ts';
import { FAILURE_CLASSES, ORDER_KINDS, PROTOCOL_FORMAT, REFERENCE_KINDS, STANDARD_EVENTS, STANDARD_RECORDS, STATIC_REASONS, eventField, standardCatalog } from './contracts.ts';
import type { StaticReason } from './contracts.ts';
import { checkV1Shape } from './schema.ts';
import { calculationNamesRead, tableNamesRead } from './runtime/calculations.ts';
import type { V1ShapeProblem, V1Spec } from './schema.ts';
import type {
 AnalysisReport, Calculation, ContentRef, ContractCatalog, Diagnostic as StaticDiagnostic, Due, DueOffset, Effect, EmitEffect, EventContract, FailureClass, Fallback,
 FieldDecl, InputDecl, JsonValue, Operand, PreparationResult, PreparedProtocol, ProtocolDefinitions, ProtocolDocument, RecordContract, SourceFieldDecl,
 PolicyRef, ReferenceKind, RequestContract, ReissueTaskEffect, SemanticId, StartEffect, StateDecl, Table, TableRule, TypeDescriptor, ValidationReport, ValueTemplate, WorkPolicy, WorkTemplate, Workflow,
} from './types.ts';

export interface Diagnostic { level: 1 | 2 | 3; severity: 'error' | 'warning' | 'info'; code: string; id: string; message: string }
/** A concept registry entry (core/vocabulary/concepts/README.md), as far as validation reads it. */
export interface RegistryConcept { kind: string; scope?: string; unit?: string; values?: string[]; ordered?: boolean; range?: [number, number]; payload?: Record<string, string> }
/** The concept registry: every core/vocabulary/concepts file merged, name → entry. Events, roles and `care.level` are in it. */
export type Registry = Readonly<Record<string, RegistryConcept>>;
export interface References {
 registry: Registry;
 /** Snippet ids (`snippetIds`). */
 snippets: ReadonlySet<string>;
 /** The decision register, studio/decisions. Its `policy-unknown-values` entry is the policy the unknown report checks. */
 register: readonly RegisterEntry[];
 /** Site calendars a schedule may snap to. When absent, `snap` is not checked. */
 calendars?: readonly string[];
}

/** The ids of the snippets among repository paths: `<id>.md` anywhere under library/snippets, in a version folder or a wip draft. */
export function snippetIds(paths: readonly string[]): Set<string> {
 const ids = new Set<string>();
 for (const p of paths) {
  const m = /^library\/snippets\/(?:.+\/)?([^/]+)\.md$/.exec(p);
  if (m && m[1] !== 'INDEX' && m[1] !== 'README') ids.add(m[1]);
 }
 return ids;
}

export { parseExpr };

// ── Where every condition, timing and reference sits ────────────────────────────────────────────

interface At { id: string; field: string }
type Named = At & { name: string };
/** A quantity as JSON holds it: `{ value, unit }`, or the string `"100 mg"`; an unreadable string keeps its text as the unit so the unit check reports it. */
const asQuantity = (q: Quantity | string): Quantity => {
 if (typeof q !== 'string') return q;
 const m = /^\s*(-?\d+(?:\.\d+)?)\s*(\S+)\s*$/.exec(q);
 return m ? { value: Number(m[1]), unit: m[2] } : { value: Number.NaN, unit: q };
};
interface Leaves {
 conditions: (At & { text: string; definition: boolean })[];
 durations: (At & { text: string; orExpr: boolean })[];
 timings: (At & { text: string })[];
 exprs: (At & { text: string })[];
 quantities: (At & { quantity: Quantity })[];
 concepts: Named[]; events: Named[]; roles: Named[]; levels: (Named & { orRole: boolean })[];
 cites: (At & { cite: Cite })[]; snippets: Named[]; calendars: Named[]; bookings: Named[]; pathways: Named[];
}

const stateId = (s: State) => `${s.pathway}/${s.id}`;
const sectionsOf = (pw: Pathway): [Section, string][] => [[pw.starts, `${pw.id}/start`], ...pw.sections.map((s): [Section, string] => [s, `${pw.id}/${inputKey(s.on)}`])];
const stateSections = (s: State): [Section, string][] => s.sections.map(sec => [sec, `${stateId(s)}/${inputKey(sec.on)}`]);

function leaves(p: Protocol): Leaves {
 const L: Leaves = { conditions: [], durations: [], timings: [], exprs: [], quantities: [], concepts: [], events: [], roles: [], levels: [], cites: [], snippets: [], calendars: [], bookings: [], pathways: [] };
 const condition = (id: string, field: string, text: string, definition = false) => L.conditions.push({ id, field, text, definition });
 const duration = (id: string, field: string, text: string, orExpr = false) => L.durations.push({ id, field, text, orExpr });
 const cites = (id: string, field: string, list: readonly Cite[]) => list.forEach((cite, i) => L.cites.push({ id, field: `${field}[${i}]`, cite }));
 const clock = (id: string, field: string, c: Clock) => {
  if ('at' in c) { L.concepts.push({ id, field: `${field}.at.concept`, name: c.at.concept }); L.quantities.push({ id, field: `${field}.at.reaches`, quantity: asQuantity(c.at.reaches) }); return; }
  duration(id, `${field}.after`, c.after, true);
  if (typeof c.from === 'object' && 'event' in c.from) L.events.push({ id, field: `${field}.from.event`, name: c.from.event });
  if (typeof c.from === 'object' && 'due' in c.from) L.bookings.push({ id, field: `${field}.from.due`, name: c.from.due });
 };
 const schedule = (id: string, field: string, s: Schedule) => {
  if (typeof s.first === 'string') L.exprs.push({ id, field: `${field}.first`, text: s.first });
  else if (s.first) clock(id, `${field}.first`, s.first);
  if (typeof s.gap === 'string') duration(id, `${field}.gap`, s.gap);
  else s.gap?.forEach((b, i) => { condition(id, `${field}.gap[${i}].while`, b.while); duration(id, `${field}.gap[${i}].gap`, b.gap); });
  s.anchor?.forEach((a, i) => { L.concepts.push({ id, field: `${field}.anchor[${i}].concept`, name: a.concept }); L.quantities.push({ id, field: `${field}.anchor[${i}].at`, quantity: asQuantity(a.at) }); });
  s.window?.forEach((d, i) => duration(id, `${field}.window[${i}]`, d));
  if (s.overdue !== undefined) duration(id, `${field}.overdue`, s.overdue);
  if (s.expires !== undefined) duration(id, `${field}.expires`, s.expires);
  if (s.done !== undefined) condition(id, `${field}.done`, s.done);
  if (typeof s.end === 'string') condition(id, `${field}.end`, s.end);
  else if (s.end && !('count' in s.end)) clock(id, `${field}.end`, s.end);
  if (s.snap !== undefined) L.calendars.push({ id, field: `${field}.snap`, name: s.snap });
 };
 const role = (id: string, field: string, name: string) => L.roles.push({ id, field, name });
 const withValues = (id: string, w: Readonly<Record<string, string>> | undefined) => {
  for (const [k, v] of Object.entries(w ?? {})) { L.concepts.push({ id, field: `do.with.${k}`, name: k }); L.exprs.push({ id, field: `do.with.${k}`, text: v }); }
 };
 const action = (id: string, a: Action) => {
  if ('give' in a) {
   L.concepts.push({ id, field: 'do.give', name: a.give });
   if ('table' in a.dose) { L.snippets.push({ id, field: 'do.dose.table', name: a.dose.table }); a.dose.by.forEach((n, i) => L.concepts.push({ id, field: `do.dose.by[${i}]`, name: n })); }
   else {
    const d = a.dose;
    if (typeof d.amount === 'string') L.exprs.push({ id, field: 'do.dose.amount', text: d.amount }); else L.quantities.push({ id, field: 'do.dose.amount', quantity: d.amount });
    if (d.max) L.quantities.push({ id, field: 'do.dose.max', quantity: asQuantity(d.max) });
    L.timings.push({ id, field: 'do.dose.frequency', text: d.frequency });
    if (d.duration !== undefined) duration(id, 'do.dose.duration', d.duration);
   }
   role(id, 'do.by', a.by);
   if (a.with !== undefined) role(id, 'do.with', a.with);
   if (a.schedule) schedule(id, 'do.schedule', a.schedule);
  } else if ('advise' in a) { if (a.to !== 'patient' && a.to !== 'caregiver') role(id, 'do.to', a.to); }
  else if ('refer' in a) L.levels.push({ id, field: 'do.refer', name: a.refer, orRole: true });
  else if ('notify' in a) role(id, 'do.notify', a.notify);
  else if ('book' in a) { role(id, 'do.by', a.by); role(id, 'do.owner', a.owner); schedule(id, 'do.due', a.due); }
  else if ('set' in a) { L.concepts.push({ id, field: 'do.set', name: a.set }); L.exprs.push({ id, field: 'do.to', text: a.to }); }
  else if ('cancel' in a) L.bookings.push({ id, field: 'do.cancel', name: a.cancel });
  else if ('start' in a) { L.pathways.push({ id, field: 'do.start', name: a.start }); withValues(id, a.with); }
  else { L.events.push({ id, field: 'do.announce', name: a.announce }); withValues(id, a.with); }
 };
 const section = (id: string, s: Section) => {
  if (s.order) cites(id, 'order', [s.order]);
  if (typeof s.on === 'object' && 'event' in s.on) L.events.push({ id, field: 'on.event', name: s.on.event });
  for (const r of s.rules) {
   const rid = `${id}/${r.id}`;
   if (r.when !== 'otherwise') condition(rid, 'when', r.when);
   if ('again' in r.to && r.to.due) schedule(rid, 'to.due', r.to.due);
   if (r.confirm !== undefined) role(rid, 'confirm', r.confirm);
   cites(rid, 'cite', r.cite);
  }
 };
 const outputs = (owner: string, list: readonly Output[]) => {
  for (const o of list) {
   const id = `${owner}/${o.id}`;
   if (o.when !== undefined) condition(id, 'when', o.when);
   if (typeof o.strength === 'object') role(id, 'strength.offer', o.strength.offer);
   action(id, o.do);
   cites(id, 'cite', o.cite);
  }
 };

 for (const r of p.roles) L.levels.push({ id: `roles/${r.id}`, field: 'level', name: r.level, orRole: false });
 for (const v of p.variants) for (const o of v.options) cites(`variants/${v.id}`, `options.${o.id}.cite`, o.cite);
 for (const d of p.definitions.derived) {
  const id = `definitions/${d.concept}`, w = d.when;
  L.concepts.push({ id, field: 'concept', name: d.concept });
  if (typeof w === 'string') condition(id, 'when', w, true);
  else if ('count' in w) { L.events.push({ id, field: 'when.count', name: w.count }); L.events.push({ id, field: 'when.since', name: w.since }); }
  else if ('since' in w) condition(id, 'when.since', w.since, true);
  else if ('consecutive' in w) condition(id, 'when.holds', w.holds, true);
  else if ('previous' in w) L.concepts.push({ id, field: 'when.previous', name: w.previous });
  else L.concepts.push({ id, field: 'when.latest', name: w.latest });
  cites(id, 'cite', d.cite);
 }
 for (const pl of p.definitions.plans) {
  const id = `definitions/plans/${pl.concept}`;
  L.concepts.push({ id, field: 'concept', name: pl.concept });
  for (const k of ['steps', 'moves', 'review'] as const) L.snippets.push({ id, field: k, name: pl[k] });
 }
 for (const pw of p.pathways) {
  condition(pw.id, 'appliesTo', pw.appliesTo);
  for (const [s, id] of sectionsOf(pw)) section(id, s);
  outputs(pw.id, pw.outputs);
  cites(pw.id, 'cite', pw.cite);
 }
 for (const s of p.states) {
  const id = stateId(s);
  L.levels.push({ id, field: 'level', name: s.level, orRole: false });
  if (s.actor !== undefined) role(id, 'actor', s.actor);
  if (s.appliesTo !== undefined) condition(id, 'appliesTo', s.appliesTo);
  for (const w of s.awaits ?? []) {
   const wid = `${id}/${w.id}`;
   if (typeof w.by === 'string') role(wid, 'by', w.by); else role(wid, 'by.checkedBy', w.by.checkedBy);
   role(wid, 'owner', w.owner);
   schedule(wid, 'due', w.due);
   w.collects.forEach((c, i) => {
    L.concepts.push({ id: wid, field: `collects[${i}].concept`, name: c.concept });
    if (typeof c.required === 'string') condition(wid, `collects[${i}].required`, c.required);
    cites(wid, `collects[${i}].cite`, c.cite);
   });
   if (w.call !== undefined) L.pathways.push({ id: wid, field: 'call', name: w.call });
  }
  for (const t of s.timers ?? []) { const tid = `${id}/${t.id}`; clock(tid, 'fires', t.fires); role(tid, 'owner', t.owner); cites(tid, 'cite', t.cite); }
  for (const [sec, sid] of stateSections(s)) section(sid, sec);
  outputs(id, s.outputs);
  cites(id, 'cite', s.cite);
 }
 return L;
}

// ── Level 1: well-formed ───────────────────────────────────────────────────────────────────────

/** Parsed conditions and expressions by their text, so levels 2 and 3 read what level 1 parsed. */
class Parses {
 private concepts: Concepts;
 constructor(concepts: Concepts) { this.concepts = concepts; }
 private cache = new Map<string, Parsed<Expr>>();
 condition(text: string, definition = false): Parsed<Expr> { return this.memo(`${definition ? 'd' : 'c'}${text}`, () => parseCondition(text, { definition, concepts: this.concepts })); }
 expr(text: string): Parsed<Expr> { return this.memo(`e${text}`, () => parseExpr(text)); }
 timing(text: string) { return parseTiming(text, { concepts: this.concepts }); }
 private memo(key: string, parse: () => Parsed<Expr>) { let r = this.cache.get(key); if (!r) this.cache.set(key, r = parse()); return r; }
}
const ok = (r: Parsed<Expr>): Expr | undefined => r.ok ? r.value : undefined;

function level1(p: Protocol, L: Leaves, parses: Parses, out: Diagnostic[]): void {
 const error = (code: string, id: string, message: string) => out.push({ level: 1, severity: 'error', code, id, message });
 const unique = (owner: string, kind: string, ids: readonly string[], idOf: (x: string) => string = x => `${owner}/${x}`) => {
  const seen = new Set<string>();
  for (const x of ids) { if (seen.has(x)) error('duplicate-id', idOf(x), `Two ${kind} are called '${x}'${owner ? ` in ${owner}` : ''}.`); seen.add(x); }
 };
 unique('', 'pathways', p.pathways.map(x => x.id), x => x);
 unique('', 'states', p.states.map(x => x.id), x => x);
 unique('', 'roles', p.roles.map(x => x.id), x => `roles/${x}`);
 unique('', 'variant points', p.variants.map(x => x.id), x => `variants/${x}`);
 unique('', 'definitions', p.definitions.derived.map(x => x.concept), x => `definitions/${x}`);
 unique('', 'plans', p.definitions.plans.map(x => x.concept), x => `definitions/plans/${x}`);
 for (const v of p.variants) unique(`variants/${v.id}`, 'options', v.options.map(o => o.id));
 for (const pw of p.pathways) {
  unique(pw.id, 'ends', pw.ends.map(e => e.id));
  unique(pw.id, 'rules', sectionsOf(pw).flatMap(([s]) => s.rules.map(r => r.id)));
  unique(pw.id, 'outputs', pw.outputs.map(o => o.id));
  unique(pw.id, 'sections on one input', pw.sections.map(s => inputKey(s.on)));
 }
 for (const s of p.states) {
  const id = stateId(s);
  unique(id, 'rules', s.sections.flatMap(sec => sec.rules.map(r => r.id)));
  unique(id, 'sections on one input', s.sections.map(sec => inputKey(sec.on)));
  unique(id, 'outputs, works, gates or timers', [...s.outputs.map(o => o.id), ...(s.awaits ?? []).map(w => w.id), ...s.gate ? [s.gate.id] : [], ...(s.timers ?? []).map(t => t.id)]);
 }
 const fail = (code: string, at: At, r: Parsed<unknown>) => { if (!r.ok) error(code, at.id, `${at.field}: ${r.error.message} (at ${r.error.at})`); };
 for (const c of L.conditions) fail('condition', c, parses.condition(c.text, c.definition));
 for (const e of L.exprs) fail('expression', e, parses.expr(e.text));
 for (const t of L.timings) fail('timing', t, parses.timing(t.text));
 for (const d of L.durations) {
  const t = parses.timing(d.text);
  if (t.ok && t.value.kind === 'duration') continue;
  const e = d.orExpr ? ok(parses.expr(d.text)) : undefined;
  if (!t.ok && (e?.kind === 'name' || (e?.kind === 'word' && !['yes', 'no'].includes(e.value)))) continue;
  const problem = t.ok || e ? `'${d.text}' is not a duration. Write a number and a unit of time, such as 3 d, 2 wk or 6 mo.` : `${t.error.message} (at ${t.error.at})`;
  error('timing', d.id, `${d.field}: ${problem}${d.orExpr ? ' A concept that holds a time is also accepted.' : ''}`);
 }
 for (const q of L.quantities) if (!unitDimension(q.quantity.unit)) error('unit', q.id, `${q.field}: unknown unit '${q.quantity.unit}'. Write a UCUM unit, such as mg, kg, mo, wk or mm[Hg].`);
}

// ── Level 2: resolved ──────────────────────────────────────────────────────────────────────────

const people = new Set(['patient', 'caregiver']);

function level2(p: Protocol, refs: References, L: Leaves, parses: Parses, out: Diagnostic[]): void {
 const error = (code: string, id: string, message: string) => out.push({ level: 2, severity: 'error', code, id, message });
 const registry = refs.registry, has = (n: string) => Object.hasOwn(registry, n);
 const roles = new Set(p.roles.map(r => r.id)), levels = new Set(has('care.level') ? registry['care.level'].values ?? [] : []);
 const decisions = new Set(refs.register.map(e => e.id)), pathways = new Map(p.pathways.map(x => [x.id, x]));
 const states = new Map(p.states.map(s => [s.id, s]));
 const works = new Set(p.states.flatMap(s => (s.awaits ?? []).map(w => w.id)));
 const bookings = new Set([...works, ...[...p.pathways, ...p.states].flatMap(x => x.outputs.flatMap(o => 'book' in o.do ? [o.do.as] : []))]);
 const isEvent = (n: string) => (has(n) && registry[n].kind === 'event') || (n.endsWith('.changed') && has(n.slice(0, -'.changed'.length)));
 // A derived concept the protocol defines is declared by its definition; the registry should still hold its name.
 const defined = new Set(p.definitions.derived.map(d => d.concept)), local = new Set<string>();
 const concept = (at: At, n: string) => {
  if (has(n)) return;
  if (defined.has(n)) { if (!local.has(n)) { local.add(n); out.push({ level: 2, severity: 'info', code: 'protocol-concept', id: `definitions/${n}`, message: `'${n}' is defined by this protocol but not in the concept registry: add its name there.` }); } return; }
  error('unknown-concept', at.id, `${at.field}: '${n}' is not in the concept registry.`);
 };

 for (const c of L.concepts) concept(c, c.name);
 for (const c of L.conditions) { const e = ok(parses.condition(c.text, c.definition)); if (e) for (const n of conditionNames(e)) concept(c, n); }
 for (const x of L.exprs) {
  const e = ok(parses.expr(x.text));
  if (!e) continue;
  for (const n of conditionNames(e)) concept(x, n);
  if (e.kind === 'call' && e.args[0].kind === 'name' && has(e.args[0].name) && !registry[e.args[0].name].ordered) error('not-ordered', x.id, `${x.field}: ${e.fn}() needs an ordered concept, and '${e.args[0].name}' is not ordered in the registry.`);
 }
 for (const d of L.durations) if (d.orExpr) {
  const e = ok(parses.expr(d.text)), name = e?.kind === 'name' ? e.name : e?.kind === 'word' ? e.value : undefined;
  if (name === undefined) continue;
  concept(d, name);
  const unit = registry[name]?.unit, dimension = unit && unitDimension(unit);
  if ((has(name) || defined.has(name)) && dimension !== 'time' && dimension !== 'calendar time') error('timing', d.id, `${d.field}: '${name}' has ${unit ? `unit '${unit}'` : 'no unit'}, so it does not hold a time. Use a concept with a unit of time, such as d, mo or a.`);
 }
 for (const t of L.timings) {
  const parsed = parses.timing(t.text);
  if (!parsed.ok) continue;
  // Inspect leaves so timingParts' anchor names resolve as concepts, even inside nested timings.
  const pending = [parsed.value];
  for (const timing of pending) {
   if (timing.kind === 'list') { pending.push(...timing.items); continue; }
   if (timing.kind === 'later of') { pending.push(...timing.of); continue; }
   if (timing.kind === 'strictly after') { pending.push(timing.timing); continue; }
   if (timing.kind === 'anchor') { concept(t, timing.concept); continue; }
   const parts = timingParts(timing);
   for (const e of parts.conditions) for (const name of conditionNames(e)) concept(t, name);
   for (const name of parts.events) if (!isEvent(name)) error('unknown-event', t.id, `${t.field}: '${name}' is not an event in the concept registry.`);
  }
 }
 for (const e of L.events) if (!isEvent(e.name)) error('unknown-event', e.id, `${e.field}: '${e.name}' is not an event in the concept registry.`);
 for (const r of L.roles) if (!roles.has(r.name) && !people.has(r.name)) error('unknown-role', r.id, `${r.field}: '${r.name}' is not one of the protocol's roles.`);
 for (const l of L.levels) if (!levels.has(l.name) && !(l.orRole && roles.has(l.name))) error('unknown-level', l.id, `${l.field}: '${l.name}' is not a level of care (the registry's care.level)${l.orRole ? ' or a role' : ''}.`);
 for (const s of L.snippets) if (!refs.snippets.has(s.name)) error('unknown-snippet', s.id, `${s.field}: no snippet '${s.name}'.`);
 for (const c of L.calendars) if (refs.calendars && !refs.calendars.includes(c.name)) error('unknown-calendar', c.id, `${c.field}: '${c.name}' is not a site calendar.`);
 for (const b of L.bookings) if (!bookings.has(b.name)) error('unknown-booking', b.id, `${b.field}: no work or booking is called '${b.name}'.`);
 for (const x of L.pathways) if (!pathways.has(x.name)) error('unknown-pathway', x.id, `${x.field}: no pathway '${x.name}'.`);
 for (const { id, field, cite } of L.cites) {
  if ('snippet' in cite && !refs.snippets.has(cite.snippet)) error('unknown-cite', id, `${field}: no snippet '${cite.snippet}'.`);
  else if ('decision' in cite && !decisions.has(cite.decision)) error('unknown-cite', id, `${field}: no register entry '${cite.decision}'.`);
  else if ('program' in cite && !cite.program.trim()) error('unknown-cite', id, `${field}: a program cite says what was decided.`);
 }
 for (const r of p.roles) if (r.escalatesTo !== undefined && !roles.has(r.escalatesTo)) error('unknown-role', `roles/${r.id}`, `escalatesTo: '${r.escalatesTo}' is not one of the protocol's roles.`);

 // References inside a pathway or a state: targets, inputs, the rules outputs go with, gates, variants.
 const targets = (owner: Pathway, sid: string, s: Section, start: boolean) => {
  for (const r of s.rules) {
   const rid = `${sid}/${r.id}`, to = r.to;
   if ('state' in to && !states.has(to.state)) error('unknown-state', rid, `to: no state '${to.state}'.`);
   else if ('state' in to && states.get(to.state)!.pathway !== owner.id) error('unknown-state', rid, `to: '${to.state}' belongs to the pathway ${states.get(to.state)!.pathway}; start or call another pathway instead.`);
   if ('end' in to && !owner.ends.some(e => e.id === to.end)) error('unknown-end', rid, `to: '${to.end}' is not an end of ${owner.id}.`);
   if (start && ('again' in to || 'stay' in to)) error('bad-target', rid, `to: a start goes to a state or an end; there is no state to ${'again' in to ? 'enter again' : 'stay in'}.`);
   if (r.variant) {
    const v = p.variants.find(x => x.id === r.variant!.point);
    if (!v) error('unknown-variant', rid, `variant: no variant point '${r.variant.point}'.`);
    else if (!v.options.some(o => o.id === r.variant!.option)) error('unknown-variant', rid, `variant: '${r.variant.option}' is not an option of ${v.id}.`);
   }
  }
 };
 const rulesGo = (owner: string, list: readonly Output[], rules: ReadonlySet<string>) => {
  for (const o of list) for (const r of o.on) if (!rules.has(r)) error('unknown-rule', `${owner}/${o.id}`, `on: no rule '${r}' in ${owner}.`);
 };
 for (const pw of p.pathways) {
  if (pw.starts.on !== 'immediate' && !('event' in pw.starts.on)) error('bad-input', `${pw.id}/start`, 'on: a pathway starts at once (immediate) or on an event.');
  for (const s of pw.sections) if (s.on === 'immediate' || 'done' in s.on || 'timer' in s.on) error('bad-input', `${pw.id}/${inputKey(s.on)}`, 'on: a pathway section handles events, and the overdue and expiry points of bookings; work and timers belong to states.');
  for (const [s, sid] of sectionsOf(pw)) {
   targets(pw, sid, s, s === pw.starts);
   if (typeof s.on === 'object' && ('overdue' in s.on || 'expired' in s.on)) { const n = 'overdue' in s.on ? s.on.overdue : s.on.expired; if (!bookings.has(n)) error('unknown-booking', sid, `on: no work or booking is called '${n}'.`); }
  }
  rulesGo(pw.id, pw.outputs, new Set(sectionsOf(pw).flatMap(([s]) => s.rules.map(r => r.id))));
 }
 for (const s of p.states) {
  const id = stateId(s), pw = pathways.get(s.pathway), own = new Set((s.awaits ?? []).map(w => w.id)), timers = new Set((s.timers ?? []).map(t => t.id));
  if (!pw) { error('unknown-pathway', id, `pathway: no pathway '${s.pathway}'.`); continue; }
  for (const w of s.gate?.all ?? []) if (!own.has(w)) error('unknown-work', id, `gate.all: '${w}' is not work this state awaits.`);
  for (const [sec, sid] of stateSections(s)) {
   const on = sec.on;
   if (typeof on === 'object' && 'done' in on && !own.has(on.done) && s.gate?.id !== on.done) error('unknown-work', sid, `on: '${on.done}' is neither work this state awaits nor its gate.`);
   if (typeof on === 'object' && 'timer' in on && !timers.has(on.timer) && !(on.timer.endsWith('.end') && own.has(on.timer.slice(0, -4)))) error('unknown-timer', sid, `on: '${on.timer}' is not a timer of this state.`);
   if (typeof on === 'object' && ('overdue' in on || 'expired' in on)) { const n = 'overdue' in on ? on.overdue : on.expired; if (!bookings.has(n)) error('unknown-booking', sid, `on: no work or booking is called '${n}'.`); }
   targets(pw, sid, sec, false);
  }
  rulesGo(id, s.outputs, new Set(s.sections.flatMap(sec => sec.rules.map(r => r.id))));
 }
}

// ── Level 3: analysed ──────────────────────────────────────────────────────────────────────────

const rank = (u: Rule['urgency']) => u === 'emergency' ? 3 : u === 'urgent' ? 2 : u === 'routine' ? 1 : 0;
const and = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
const example = (e: Record<string, string>) => Object.entries(e).map(([n, v]) => `${n}: ${v}`).join(', ');

/** A rule's care direction: stated, or read from a `set` of `next()` (adds) or `previous()` (reduces). */
function direction(r: Rule, outputs: readonly Output[], parses: Parses): Rule['direction'] {
 if (r.direction) return r.direction;
 for (const o of outputs) if (o.on.includes(r.id) && 'set' in o.do) {
  const e = ok(parses.expr(o.do.to));
  if (e?.kind === 'call' && (e.fn === 'next' || e.fn === 'previous')) return e.fn === 'next' ? 'adds' : 'reduces';
 }
 return undefined;
}

/** The inputs a medicine's dose reads: a table's `by`, an amount's concepts, and `weight` for a dose per kg. */
function doseInputs(a: Action, parses: Parses): string[] {
 if (!('give' in a)) return [];
 if ('table' in a.dose) return a.dose.by;
 const amount = typeof a.dose.amount === 'string' ? ok(parses.expr(a.dose.amount)) : undefined;
 return [...amount ? conditionNames(amount) : [], ...a.dose.perKg ? ['weight'] : []];
}

/** The policy option the unknown report checks: the register's decision, else its default. */
function policyChoice(register: readonly RegisterEntry[], out: Diagnostic[]): string | undefined {
 const e = register.find(x => x.id === 'policy-unknown-values');
 if (!e) return undefined;
 if (validApproval(e)) return e.decided.choice;
 if (e.status === 'decided' || e.decided) out.push({
  level: 3, severity: 'error', code: 'policy-undecided', id: e.id,
  message: e.decided?.kind === 'agent' && e.signoff?.status === 'pending'
   ? `The policy is decided by an agent, sign-off pending; using default option ${e.default}.`
   : `The policy needs a valid recorded decision and clinical approval; using default option ${e.default}.`,
 });
 return e.default ?? undefined;
}

function level3(p: Protocol, refs: References, parses: Parses, out: Diagnostic[]): void {
 const say = (severity: Diagnostic['severity'], code: string, id: string, message: string) => out.push({ level: 3, severity, code, id, message });
 const concepts: Concepts = Object.fromEntries(Object.entries(refs.registry).map(([n, c]) => [n, { ...c.unit ? { unit: c.unit } : {}, ...c.values ? { values: c.values } : {}, ...c.ordered ? { ordered: true } : {} }]));
 const condition = (text: string) => ok(parses.condition(text)) ?? always;
 const policy = policyChoice(refs.register, out);
 if (policy !== undefined && policy !== 'a' && policy !== 'c') {
  const e = refs.register.find(x => x.id === 'policy-unknown-values')!;
  const approval = validApproval(e) ? `, approved by ${e.signoff?.by ?? e.decided.by} on ${e.signoff?.on ?? e.decided.on}` : '';
  say('error', 'policy-unsupported', e.id, `The register selects option ${policy}${approval}. This validator cannot check that option yet, so the unknown report below is listed but not checked against any policy. The validator does not substitute another option.`);
 }
 if (policy === undefined) say('warning', 'policy-missing', 'protocol', 'The register has no policy-unknown-values entry, so the unknown report lists cases without checking them.');

 // Danger signs: `danger.*` concepts, and the inputs a `danger.*` definition reads (cough.days, muac.colour).
 const definerOf = new Map<string, string>();
 for (const d of p.definitions.derived) {
  if (!d.concept.startsWith('danger.')) continue;
  const w = d.when, text = typeof w === 'string' ? w : 'since' in w && !('count' in w) ? w.since : 'holds' in w ? w.holds : undefined;
  const e = text === undefined ? undefined : ok(parses.condition(text, true));
  for (const n of e ? conditionNames(e) : []) if (!definerOf.has(n)) definerOf.set(n, d.concept);
 }
 const isDanger = (x: string) => x.startsWith('danger.') || definerOf.has(x);
 const dangerSign = (x: string) => x.startsWith('danger.') ? `${x} is a danger sign` : `${x} is read by the definition of ${definerOf.get(x)}, so an unknown ${x} leaves a danger sign unassessed`;
 // Definitions over current values, which the analysis ties derived concepts to.
 const definitions = new Map<string, Expr>();
 for (const d of p.definitions.derived) if (typeof d.when === 'string') { const e = ok(parseCondition(d.when)); if (e) definitions.set(d.concept, e); }

 const owners = [
  ...p.pathways.map(pw => ({ id: pw.id, outputs: pw.outputs, applies: [pw.appliesTo], sections: sectionsOf(pw) })),
  ...p.states.map(s => {
   const pw = p.pathways.find(x => x.id === s.pathway);
   return { id: stateId(s), outputs: s.outputs, applies: [...pw ? [pw.appliesTo] : [], ...s.appliesTo ? [s.appliesTo] : []], sections: stateSections(s) };
  }),
 ];
 for (const owner of owners) {
  const gives: Giving[] = owner.outputs.flatMap(o => 'give' in o.do ? [{ id: o.id, on: o.on, when: o.when === undefined ? undefined : condition(o.when), inputs: doseInputs(o.do, parses) }] : []);
  for (const o of owner.outputs) if (!o.on.length) say('error', 'output-without-rule', `${owner.id}/${o.id}`, 'This output goes with no rule, so it never happens; or it would happen on arrival, which only booking work and arming timers may (R1).');
  for (const [section, sid] of owner.sections) {
   const rules = section.rules, last = rules[rules.length - 1];
   if (!last || last.when !== 'otherwise') say('error', 'no-otherwise', sid, `The section's last rule must be otherwise, so that exactly one rule fires on every input${last ? `; it is ${last.id}` : ''}.`);
   rules.slice(0, -1).filter(r => r.when === 'otherwise').forEach(r => {
    const after = rules.slice(rules.indexOf(r) + 1).map(x => x.id);
    say('error', 'otherwise-not-last', `${sid}/${r.id}`, `otherwise is not the last rule, so ${and(after)} never ${after.length > 1 ? 'fire' : 'fires'}.`);
   });
   for (const r of rules) {
    const dir = direction(r, owner.outputs, parses);
    if (dir === 'reduces' && r.confirm === undefined) say('error', 'reduces-without-confirm', `${sid}/${r.id}`, `${r.id} reduces care${r.direction ? '' : ' (it steps the plan back)'}, so it needs confirm: the role that signs it off.`);
   }
   // One analysis per choice of the variant options the section's rules depend on.
   const points = [...new Set(rules.flatMap(r => r.variant ? [r.variant.point] : []))];
   let choices: Record<string, string>[] = [{}];
   for (const pt of points) {
    const options = p.variants.find(v => v.id === pt)?.options.map(o => o.id) ?? [...new Set(rules.flatMap(r => r.variant?.point === pt ? [r.variant.option] : []))];
    choices = choices.flatMap(c => options.map(o => ({ ...c, [pt]: o })));
   }
   for (const choice of choices) {
    const chosen = rules.filter(r => !r.variant || choice[r.variant.point] === r.variant.option);
    const label = Object.keys(choice).length ? ` (variant ${Object.entries(choice).map(([k, v]) => `${k}: ${v}`).join(', ')})` : '';
    const rows: Row[] = chosen.map(r => ({ id: r.id, when: r.when === 'otherwise' ? always : condition(r.when), otherwise: r.when === 'otherwise', rank: rank(r.urgency) }));
    const dangers = policy === 'a' ? [...new Set(rows.flatMap(r => conditionNames(r.when)))].filter(isDanger) : [];
    let report: Report;
    try { report = analyseSection({ hit: section.hit, rows, gives, applies: owner.applies.map(condition), concepts, definitions, dangers }); }
    catch (error) {
     if (error instanceof TooMany) say('error', 'too-many-cases', sid, `Section ${sid}${label} was not analysed. ${error.message} Nothing in this section was proved. This is a limit of the validator rather than a protocol error. A real protocol that reaches this limit must be escalated: https://github.com/acompa-health/abrazos-v2/issues/57`);
     else say('error', 'cannot-evaluate', sid, `Cannot analyse this section${label}: ${(error as Error).message}`);
     continue;
    }
    unknownReport(report, chosen, owner.outputs, sid, owner.id, label);
   }
  }
 }

 function unknownReport(report: Report, rules: readonly Rule[], outputs: readonly Output[], sid: string, owner: string, label: string) {
  const rule = (id: string) => rules.find(r => r.id === id)!;
  const urgency = (r: Rule) => r.when === 'otherwise' ? `otherwise, ${r.urgency ?? 'no urgency'}` : r.urgency ?? 'no urgency';
  const where = (ls: readonly Landing[]) => and(ls.map(l => `${l.rule} (${urgency(rule(l.rule))})`));
  const last = <T>(xs: readonly T[]) => xs[xs.length - 1];
  const policyA = policy === 'a', cite = 'policy-unknown-values, option a';
  for (const n of report.neverFires) say('error', 'shadowed', `${sid}/${n.rule}`, n.neverTrue ? `${n.rule} is never true${label}.` : `${n.rule} never fires${label}: rules before it catch every case where it is true.`);
  for (const o of report.overlaps) say('error', 'overlap', `${sid}/${o.rules[0]}`, `${o.rules[0]} and ${o.rules[1]} are both true in one case of a unique section${label}, for example ${example(o.example)}.`);
  // Errors go on the rule that cannot fire; the rest of the report on the rule the case lands on, as the contract
  // words it: which unknown inputs land on each otherwise, or on a less urgent rule.
  for (const { input: x, rule: uid, lands } of report.dangers) {
   const u = rule(uid);
   say('error', 'unknown-danger-sign', `${sid}/${uid}`, `${dangerSign(x)}. When ${x} is unknown, ${uid} (${urgency(u)}) cannot fire, and the case lands on ${where(lands)}${label}. An unassessed danger sign is handled as present (${cite}), so it must land on a rule at least as urgent as ${uid}. For example: ${example(last(lands).example)}.`);
  }
  const landsHere = new Map<string, Map<string, { skipped: string[]; example: Record<string, string> }>>();
  for (const { rule: uid, input: x, lands } of report.unknown) {
   const u = rule(uid), id = `${sid}/${uid}`, reported = new Set<string>();
   if (policyA && isDanger(x)) lands.forEach(l => { if (rank(rule(l.rule).urgency) < rank(u.urgency)) reported.add(l.rule); });
   if (policyA && direction(u, outputs, parses) === 'reduces') {
    const bad = lands.filter(l => { const d = direction(rule(l.rule), outputs, parses); return d === 'adds' || d === 'reduces'; });
    if (bad.length) {
     say('error', 'unknown-step-down', id, `${uid} steps care down. When ${x} is unknown it cannot fire, and the case lands on ${and(bad.map(l => `${l.rule} (${direction(rule(l.rule), outputs, parses)} care)`))}${label}. An unknown reading used to step care down keeps the current care (${cite}). For example: ${example(last(bad).example)}.`);
     bad.forEach(l => reported.add(l.rule));
    }
   }
   for (const l of lands) {
    const lr = rule(l.rule);
    if (reported.has(l.rule) || !(rank(lr.urgency) < rank(u.urgency) || lr.when === 'otherwise')) continue;
    const byInput = landsHere.get(l.rule) ?? new Map(), entry = byInput.get(x) ?? { skipped: [], example: l.example };
    entry.skipped.push(uid); byInput.set(x, entry); landsHere.set(l.rule, byInput);
   }
  }
  for (const [lid, byInput] of landsHere) {
   const cases = [...byInput].map(([x, e]) => `${x} is unknown (${and(e.skipped)} cannot fire)`);
   say('info', 'unknown-lands', `${sid}/${lid}`, `The case lands on ${lid} (${urgency(rule(lid))}) when ${cases.join('; or when ')}${label}. For example: ${example([...byInput.values()][0].example)}.`);
  }
  for (const { output, input: d, lands } of report.doses) {
   const o = outputs.find(x => x.id === output)!, give = 'give' in o.do ? o.do.give : output;
   const text = `${output} gives ${give} with a dose that reads ${d}. When ${d} is unknown it is still given, on ${and(lands.map(l => l.rule))}${label}`;
   if (policyA) say('error', 'unknown-dose', `${owner}/${output}`, `${text}. An unknown input to a dose means do not dose: measure, or refer (${cite}). For example: ${example(lands[0].example)}.`);
   else say('info', 'unknown-dose', `${owner}/${output}`, `${text}.`);
  }
 }

 // Doses: a quantity or quantity concept (or a table), positive finite literals and maxima, a route and frequency.
 for (const owner of owners) for (const o of owner.outputs) {
  if (!('give' in o.do)) continue;
  const d = o.do.dose, id = `${owner.id}/${o.id}`;
  if ('table' in d) { if (!d.by.length) say('error', 'dose', id, `The dose table ${d.table} is read by no input: say which concepts pick the row (by).`); continue; }
  const amount = typeof d.amount === 'string' ? ok(parses.expr(d.amount)) : { kind: 'number' as const, ...d.amount };
  if (amount?.kind === 'number') {
   if (!amount.unit) say('error', 'dose', id, `The dose amount ${amount.value} has no unit.`);
   if (!Number.isFinite(amount.value) || amount.value <= 0) say('error', 'dose', id, `The dose amount must be finite and more than 0, not ${amount.value}${amount.unit ? ` ${amount.unit}` : ''}.`);
  } else if (amount) {
   // Value expressions parse bare concepts such as weight as words.
   const concept = amount.kind === 'name' ? amount.name : amount.kind === 'word' ? amount.value : undefined;
   if (!concept || !refs.registry[concept]?.unit) say('error', 'dose', id, `The dose amount ${d.amount} is not a quantity; write a number with its unit, such as 500 mg, or a concept that holds one.`);
  }
  if (d.max !== undefined) {
   const max = asQuantity(d.max);
   if (!Number.isFinite(max.value) || max.value <= 0) say('error', 'dose', id, `The dose maximum must be finite and more than 0, not ${max.value} ${max.unit}.`);
  }
  if (!d.route.trim()) say('error', 'dose', id, 'The dose has no route.');
  if (!d.frequency.trim()) say('error', 'dose', id, 'The dose has no frequency.');
 }

 // Nothing acts on arrival: a decision (an immediate section) waits for nothing, and instructions only collect.
 const condWord = /\b(if|when|unless)\b/i, actWord = /\b(give|refer|treat|prescribe|administer)\b/i;
 for (const s of p.states) {
  const id = stateId(s), decision = s.sections.some(sec => sec.on === 'immediate');
  if (decision && (s.awaits?.length || s.timers?.length || s.gate || s.sections.length > 1)) say('error', 'acts-on-arrival', id, 'A state with an immediate section acts on arrival, so it may not also await work, have timers or a gate, or other sections: arrival only books work and arms timers.');
  for (const w of s.awaits ?? []) for (const [i, text] of (w.instructions ?? []).entries()) {
   const sentence = text.split(/[.;]/).find(x => condWord.test(x) && actWord.test(x));
   if (sentence) say('warning', 'instruction-acts', `${id}/${w.id}`, `instructions[${i}] reads as a conditional action ("${sentence.trim()}"). Instructions say how to collect; make the action a rule and an output.`);
  }
 }

 // Waits: every waiting state can end through a timer or the overdue or expiry point of a booking.
 for (const s of p.states) {
  const pw = p.pathways.find(x => x.id === s.pathway);
  if (s.sections.some(sec => sec.on === 'immediate')) continue;
  const lapses = (sec: Section) => typeof sec.on === 'object' && ('overdue' in sec.on || 'expired' in sec.on);
  if (!s.timers?.length && !s.sections.some(lapses) && !pw?.sections.some(lapses)) say('error', 'wait-cannot-end', stateId(s), 'This state waits, but nothing ends the wait if the work is never done: add a timer, or a section on an overdue or expired booking, with an owner who traces the miss.');
 }
 for (const r of p.roles) {
  const seen = [r.id];
  for (let next = r.escalatesTo; next !== undefined; next = p.roles.find(x => x.id === next)?.escalatesTo) {
   if (seen.includes(next)) { say('error', 'escalation-cycle', `roles/${r.id}`, `Escalation goes round in a circle: ${[...seen, next].join(' → ')}.`); break; }
   seen.push(next);
  }
 }

 // Events: every event a pathway hears is handled at every waiting state (a pathway section counts).
 for (const pw of p.pathways) {
  const mine = p.states.filter(s => s.pathway === pw.id);
  const events = (secs: readonly Section[]) => secs.flatMap(sec => typeof sec.on === 'object' && 'event' in sec.on ? [sec.on.event] : []);
  const inherited = new Set(events(pw.sections)), heard = new Set([...inherited, ...mine.flatMap(s => events(s.sections))]);
  for (const s of mine) {
   if (s.sections.some(sec => sec.on === 'immediate')) continue;
   const missing = [...heard].filter(e => !inherited.has(e) && !events(s.sections).includes(e));
   if (missing.length) say('error', 'event-unhandled', stateId(s), `The pathway hears ${and(missing)}, but this state does not handle ${missing.length > 1 ? 'them' : 'it'}: add a section here, or one on the pathway (otherwise → stay).`);
  }
 }
}

/** Validate levels 1 to 3. Levels 2 and 3 run only when level 1 finds nothing. */
export function validate(protocol: Protocol, refs: References): Diagnostic[] {
 const out: Diagnostic[] = [], shape: { id: string; message: string }[] = [];
 checkShape(protocol, { shape: 'Protocol' }, shape);
 for (const s of shape) out.push({ level: 1, severity: 'error', code: 'shape', id: s.id, message: s.message });
 if (shape.length) return out;
 const parses = new Parses(refs.registry), L = leaves(protocol);
 level1(protocol, L, parses, out);
 if (out.length) return out;
 level2(protocol, refs, L, parses, out);
 level3(protocol, refs, parses, out);
 return out;
}

// ── Protocol language v1 (`abrazos.protocol/v1`): levels 1 and 2, and preparation ─────────────────
// One validator for Studio commands, agents and execution. Level 1: the marker, the declared shape (schema.ts) and
// every reference. Level 2: types and bindings of inputs, paths, conditions, calculations and effect values. A level-1
// fault that needs the binding environment (an untyped input, a shadowed name) is found in the binding pass. Each pass
// runs only when the one before it is clean. Level 3 (behavioral analysis, analyze.ts) runs only on a document with no
// level-1 or level-2 error: each table's overlap and coverage over its declared domains, and the direct unconditional
// self-emit loop. Shared definitions are checked at each use site. The validator performs no clinical action.

type V1Reason = StaticReason;
const levelOf = (r: V1Reason): 1 | 2 | 3 => STATIC_REASONS[r].level;
type Data = Record<string, JsonValue>;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const ptr = (at: string, ...keys: (string | number)[]) => keys.reduce<string>((p, k) => `${p}/${String(k).replace(/~/g, '~0').replace(/\//g, '~1')}`, at);
const atPointer = (value: unknown, pointer: string): unknown => pointer.startsWith('/') && !/~(?![01])/.test(pointer)
 ? pointer.slice(1).split('/').map(k => k.replace(/~1/g, '/').replace(/~0/g, '~')).reduce<unknown>((node, key) =>
   Array.isArray(node) && /^\d+$/.test(key) ? node[Number(key)] : isObj(node) && Object.hasOwn(node, key) ? node[key] : undefined, value)
 : undefined;
const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

/** Identified children of a JSON Pointer step: an array of objects with `id`, or a map whose keys are names. */
const listKinds: Readonly<Record<string, string>> = { workflows: 'workflow', states: 'state', tables: 'table', rules: 'rule', effects: 'effect' };
const mapKinds: Readonly<Record<string, string>> = {
 tables: 'table', work_policies: 'policy', policies: 'policy', work_templates: 'work_template', records: 'record', events: 'event',
 inputs: 'input', calculations: 'calculation', parameters: 'parameter', content: 'content', evidence: 'evidence', sops: 'sop', roles: 'role', terms: 'term', fallback: 'fallback',
};
/** The stable semantic identity of the object a pointer is in: `workflow:booking_preparation/table:follow_reschedule/rule:reschedule_preparation`. */
export function semanticId(document: unknown, at: string, catalog?: ContractCatalog): SemanticId {
 const parts: string[] = [];
 let node: unknown = at.startsWith('/catalog/') ? { catalog } : document;
 const keys = at === '' ? [] : at.slice(1).split('/').map(k => k.replace(/~1/g, '/').replace(/~0/g, '~'));
 keys.forEach((k, i) => {
  const parent = keys[i - 1], child: unknown = Array.isArray(node) ? node[Number(k)] : isObj(node) ? node[k] : undefined;
  if (Array.isArray(node) && parent && Object.hasOwn(listKinds, parent)) parts.push(`${listKinds[parent]}:${isObj(child) && typeof child.id === 'string' ? child.id : `#${k}`}`);
  else if (isObj(node) && parent && Object.hasOwn(mapKinds, parent) && (i === 1 || ['definitions', 'catalog'].includes(keys[i - 2]) || ['inputs', 'calculations', 'fallback'].includes(parent))) parts.push(`${mapKinds[parent]}:${k}`);
  node = child;
 });
 return parts.join('/') || `protocol:${isObj(document) && typeof document.id === 'string' ? document.id : '?'}`;
}

/** Diagnostics keyed by reason, location and message; a shared definition's diagnostic lists every use site once. */
class V1Findings {
 private readonly entries = new Map<string, { d: StaticDiagnostic; sites: Set<string> }>();
 constructor(private readonly document: unknown, private readonly catalog: ContractCatalog) {}
 add(reason: V1Reason, at: string, message: string, data: Data = {}, site?: string, severity: StaticDiagnostic['severity'] = 'error'): void {
  const key = `${reason}\u0000${at}\u0000${message}`, seen = this.entries.get(key);
  if (seen) { if (site) seen.sites.add(site); return; }
  const d: StaticDiagnostic = { level: levelOf(reason), severity, reason, at, id: semanticId(this.document, at, this.catalog), message, ...(Object.keys(data).length ? { data } : {}) };
  this.entries.set(key, { d, sites: new Set(site ? [site] : []) });
 }
 get hasErrors(): boolean { return [...this.entries.values()].some(({ d }) => d.severity === 'error'); }
 list(): StaticDiagnostic[] {
  return [...this.entries.values()].map(({ d, sites }) => d.at.startsWith('/definitions/') && sites.size ? { ...d, data: { ...d.data, use_sites: sorted(sites) } } : d);
 }
}

// ── Types ─────────────────────────────────────────────────────────────────────────────────────────

const ty = {
 id: { type: 'identifier' } as TypeDescriptor, rev: { type: 'revision' } as TypeDescriptor, yesNo: { type: 'yes_no' } as TypeDescriptor,
 ref: (target: string): TypeDescriptor => ({ type: 'reference', target: target as ReferenceKind }),
 listed: (values: readonly string[]): TypeDescriptor => ({ type: 'listed', values }),
 context: { type: 'context' } as TypeDescriptor,
};
/** The readable leaves of the normalized event envelope (contracts.ts EVENT_ENVELOPE_FIELDS), with their types. */
const ENVELOPE_TYPES: Readonly<Record<string, TypeDescriptor>> = {
 id: ty.id, type: ty.id, occurrence: ty.id, 'scope.patient': ty.id, 'scope.subject': ty.ref('object'), 'scope.cases': { type: 'list', items: ty.id },
 actor: ty.ref('actor'), occurred_at: { type: 'time' }, received_at: { type: 'instant' }, mode: ty.listed(['live', 'simulation']),
 work: ty.ref('work'), 'work.attempt': ty.id, 'target.execution': ty.id, 'target.activation': ty.id, 'target.content': ty.ref('content'),
 caused_by: ty.id, root: ty.id, corrects: ty.id,
};
/** Each reference kind's serialized field types (contracts.ts REFERENCE_KINDS names the fields). */
const REFERENCE_FIELD_TYPES: Readonly<Record<string, TypeDescriptor>> = {
 'object.type': ty.id, 'object.id': ty.id, 'object.revision': ty.rev, 'content.protocol': ty.id, 'content.revision': ty.rev, 'content.identity': ty.id,
 'definition.content': ty.ref('content'), 'definition.workflow': ty.id, 'definition.policy': ty.id,
 'actor.id': ty.id, 'actor.kind': ty.listed(['human', 'service', 'simulation']), 'owner.id': ty.id, 'owner.revision': ty.rev,
 'work.id': ty.id, 'work.occurrence': ty.id, 'work.revision': ty.rev, 'execution.id': ty.id, 'execution.content': ty.ref('content'),
 'activation.execution': ty.id, 'activation.activation': ty.id, 'event.id': ty.id,
};
/**
 * The readable fields of a bound work handle (types.ts WorkSnapshot) and of `this_execution` (ExecutionSnapshot).
 * Proposed for contracts.ts beside the envelope; kept here until the coordinator pins them.
 */
const WORK_HANDLE: RecordContract = { fields: {
 id: { type: ty.id }, occurrence: { type: ty.id }, revision: { type: ty.rev }, kind: { type: ty.listed(['task', 'order', 'publication']) },
 template: { type: ty.id }, subject: { type: ty.ref('object') }, owner: { type: ty.ref('owner') },
 status: { type: ty.listed(['queued', 'dispatched', 'completed', 'failed', 'cancellation_requested', 'cancelled']) },
 due: { type: { type: 'record', record: '#due' } }, lifetime: { type: ty.listed(['execution', 'independent']) }, policy: { type: { type: 'record', record: '#policy' } },
} };
const POLICY: RecordContract = { fields: { id: { type: ty.id }, revision: { type: ty.rev } } };
const DUE: RecordContract = { fields: { revision: { type: ty.rev }, at: { type: { type: 'instant' } }, window: { type: { type: 'window', of: { type: 'time' } } } } };
const WORK_TYPE: TypeDescriptor = { type: 'record', record: '#work' };
const TIME_TYPES = new Set(['date', 'datetime', 'time', 'instant']);
const FIXED_TIME_UNITS = new Set(['s', 'min', 'h', 'd', 'wk']);
const CALENDAR_TIME_UNITS = new Set(['d', 'wk', 'mo', 'a']);
const validTimeZone = (zone: string): boolean => {
 try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; }
};
const NUMERIC_TYPES = new Set(['count', 'number']);
const UNSTRUCTURED = new Set(['context', 'text']);
const containsUnstructured = (t: TypeDescriptor): boolean => UNSTRUCTURED.has(t.type)
 || (t.type === 'list' && containsUnstructured(t.items))
 || (t.type === 'window' && containsUnstructured(t.of));
/**
 * Time literal formats. A date keeps its precision (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`); an instant carries an offset. The
 * contract does not yet pin how a datetime writes its IANA zone, so a datetime is checked as far as its local date and time.
 */
const TIME_FORMATS = {
 date: 'YYYY, YYYY-MM or YYYY-MM-DD', instant: 'YYYY-MM-DDThh:mm[:ss[.f]] with Z or ±hh:mm',
 datetime: 'YYYY-MM-DDThh:mm[:ss[.f]], optionally with an offset', time: 'a date or a datetime',
} as const;
function validDate(y: string, m?: string, d?: string): boolean {
 if (m === undefined) return true;
 const month = +m, year = +y;
 if (month < 1 || month > 12) return false;
 const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
 const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
 return d === undefined || (+d >= 1 && +d <= days[month - 1]);
}
function timeLiteral(type: keyof typeof TIME_FORMATS, v: string): boolean {
 const date = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(v);
 if (type === 'date' || (type === 'time' && date)) return !!date && validDate(date[1], date[2], date[3]);
 const dt = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(.*)$/.exec(v);
 if (!dt || !validDate(dt[1], dt[2], dt[3]) || +dt[4] > 23 || +dt[5] > 59 || (dt[6] !== undefined && +dt[6] > 59)) return false;
 const offset = /^(?:Z|[+-](\d{2}):(\d{2}))$/.exec(dt[7]);
 const validOffset = !!offset && (offset[1] === undefined || (+offset[1] <= 23 && +offset[2] <= 59));
 return type === 'instant' ? validOffset : dt[7] === '' || validOffset;
}
const show = (t: TypeDescriptor): string => t.type === 'quantity' ? `quantity in ${t.unit}` : t.type === 'reference' ? `reference to ${t.target}`
 : t.type === 'listed' ? `listed (${t.values.join(', ')})` : t.type === 'record' ? `record ${t.record}` : t.type === 'list' ? `list of ${show(t.items)}` : t.type;

/** Whether a value of type `from` may stand where `to` is declared: same kind, compatible unit, same reference target. */
function assignable(from: TypeDescriptor, to: TypeDescriptor): boolean {
 if (to.type === 'context') return true;
 if (from.type === 'listed' && (to.type === 'identifier' || to.type === 'listed')) return to.type === 'identifier' || from.values.every(x => to.values.includes(x));
 if (NUMERIC_TYPES.has(from.type) && NUMERIC_TYPES.has(to.type)) return to.type === 'number' || from.type === 'count';
 if (TIME_TYPES.has(from.type) && TIME_TYPES.has(to.type)) return to.type === 'time' || from.type === to.type || (from.type === 'instant' && to.type === 'datetime');
 if (from.type !== to.type) return false;
 switch (to.type) {
  case 'quantity': return unitDimension((from as { unit: string }).unit) === unitDimension(to.unit);
  case 'reference': {
   // A plain work reference never stands for a template's work: only a typed one exposes that template's content.
   const f = (from as { target: string }).target;
   return f === to.target || (to.target === 'object' && f.startsWith('object:')) || (f === 'object' && to.target.startsWith('object:')) || (to.target === 'work' && f.startsWith('work:'));
  }
  case 'list': return assignable((from as { items: TypeDescriptor }).items, to.items);
  case 'window': return assignable((from as { of: TypeDescriptor }).of, to.of);
  case 'record': return (from as { record: string }).record === to.record;
  default: return true;
 }
}

/** The first missingness test in a condition, if any: `known`, `unknown` or `any_unknown`. */
const missingness = (x: Expr): string | undefined => x.kind === 'call' && ['known', 'unknown', 'any_unknown'].includes(x.fn) ? x.fn
 : x.kind === 'and' || x.kind === 'or' || x.kind === 'call' ? x.args.map(missingness).find(Boolean) : x.kind === 'not' ? missingness(x.arg) : undefined;

/** Effect fields whose value is a map from names to value templates, not a template itself. */
const TEMPLATE_MAPS = new Set(['fields', 'bindings', 'content', 'set']);
/**
 * Every `{effect: id}` an effect reads, with its pointer. A one-key `{value}` is an escaped literal only in a template
 * position; in a template map it is the entry for a field named `value`.
 */
function effectReads(e: Effect, at: string): [string, string][] {
 const out: [string, string][] = [];
 const template = (x: unknown, p: string): void => {
  if (Array.isArray(x)) return x.forEach((y, i) => template(y, ptr(p, i)));
  if (!isObj(x)) return;
  const keys = Object.keys(x);
  if (keys.length === 1 && keys[0] === 'value') return;
  if (keys.length === 1 && typeof x.effect === 'string') { out.push([x.effect, ptr(p, 'effect')]); return; }
  for (const [k, y] of Object.entries(x)) template(y, ptr(p, k));
 };
 for (const [k, x] of Object.entries(e)) {
  if (k === 'id' || k === 'kind' || k === 'when') continue;
  if (TEMPLATE_MAPS.has(k) && isObj(x)) for (const [name, y] of Object.entries(x)) template(y, ptr(at, k, name));
  else template(x, ptr(at, k));
 }
 return out;
}

/** A request's decision table: structural, so a bare identifier or `{value: identifier}`, never an expression. */
const requestTableName = (e: EmitEffect): string | undefined => {
 const t: unknown = e.fields.table;
 return typeof t === 'string' ? t : isObj(t) && Object.keys(t).length === 1 && typeof t.value === 'string' ? t.value : undefined;
};

// ── The document's sites: each workflow and work policy, with its shared tables expanded ─────────────

interface SiteTable { table: Table; at: string; shared: boolean }
/** The handle an effect assigns, with typed captured content for tasks and orders. A reissue replaces its handle. */
const assignedHandle = (e: Effect): { name: string; type: TypeDescriptor } | undefined => {
 if (e.kind !== 'task' && e.kind !== 'order' && e.kind !== 'publish') return undefined;
 const name = 'reissue' in e ? e.reissue.handle : typeof e.as === 'string' ? e.as : isObj(e.as) ? e.as.handle : undefined;
 return name === undefined ? undefined : { name, type: e.kind === 'task' ? { type: 'reference', target: `work:${e.task}` }
  : e.kind === 'order' ? { type: 'reference', target: `work:order:${e.order}` } : WORK_TYPE };
};
const sameType = (a: TypeDescriptor, b: TypeDescriptor) => JSON.stringify(a) === JSON.stringify(b);
interface Site {
 id: SemanticId; label: string; at: string; kind: 'workflow' | 'policy';
 subject?: string; lifecycle?: string; initial: string;
 stateList: readonly StateDecl[]; states: Map<string, StateDecl>; inputs: Readonly<Record<string, InputDecl>>; calculations: Readonly<Record<string, Calculation>>;
 tables: SiteTable[]; fallback?: Fallback;
 bindings: Map<string, TypeDescriptor>; handles: Set<string>;
}
interface Scope { site: Site; table?: SiteTable }
/** A name's type, or `undefined` when its declaration is itself in error (reported there). */
type Typed = { type?: TypeDescriptor; term?: string };

class V1Checker {
 private readonly defs: ProtocolDefinitions;
 private readonly events: Readonly<Record<string, EventContract>>;
 private readonly records: Readonly<Record<string, RecordContract>>;
 private readonly sharedTables: Readonly<Record<string, Table>>;
 readonly sites: Site[] = [];
 readonly contracts = new Set<string>();
 private readonly calcStack = new Set<string>();
 private readonly resolving = new Set<string>();
 private readonly doc: ProtocolDocument;
 private readonly catalog: ContractCatalog;
 private readonly out: V1Findings;

 constructor(doc: ProtocolDocument, catalog: ContractCatalog, out: V1Findings) {
  this.doc = doc; this.catalog = catalog; this.out = out;
  this.defs = doc.definitions ?? {};
  // A trusted catalog contract is never replaced by a document definition of the same name (reported in references).
  this.events = { ...this.defs.events, ...catalog.events };
  // Captured task and order content is read through the work reference as `content.<field>`.
  const content = [
   ...Object.entries({ ...this.defs.work_templates, ...catalog.tasks }).map(([k, w]): [string, RecordContract] => [`#content:${k}`, { fields: w.content ?? {} }]),
   ...Object.entries(catalog.orders).map(([k, w]): [string, RecordContract] => [`#content:order:${k}`, { fields: w.content }]),
  ];
  this.records = { ...this.defs.records, ...catalog.records, '#work': WORK_HANDLE, '#due': DUE, '#policy': POLICY, ...Object.fromEntries(content) };
  this.sharedTables = this.defs.tables ?? {};
  doc.workflows.forEach((w, i) => this.sites.push(this.site('workflow', w, ptr('', 'workflows', i))));
  for (const [key, p] of Object.entries(this.defs.work_policies ?? {})) this.sites.push(this.site('policy', p, ptr('', 'definitions', 'work_policies', key)));
  for (const [key, p] of Object.entries(catalog.policies)) this.sites.push(this.site('policy', p, ptr('', 'catalog', 'policies', key)));
 }

 private site(kind: Site['kind'], w: Workflow | WorkPolicy, at: string): Site {
  const local = w.tables.map((table, i): SiteTable => ({ table, at: ptr(at, 'tables', i), shared: false }));
  const handlers = new Set([...Object.values(this.defs.fallback ?? {}), ...Object.values(w.fallback ?? {}), ...w.tables.flatMap(t => Object.values(t.fallback ?? {}))]);
  const shared = [...handlers].filter(h => Object.hasOwn(this.sharedTables, h)).sort()
   .map((h): SiteTable => ({ table: this.sharedTables[h], at: ptr('', 'definitions', 'tables', h), shared: true }));
  const bindings = new Map<string, TypeDescriptor>([['this_execution', ty.ref('execution')]]);
  for (const [name, decl] of Object.entries(w.inputs)) if (decl.type && ['reference', 'record'].includes(decl.type.type)) bindings.set(name, decl.type);
  // A handle is assigned by local tables and by the shared handlers expanded here. Its first assignment types it; a
  // different later one is a type mismatch (effectBindings).
  const handles = new Set<string>();
  for (const { table } of [...local, ...shared]) for (const r of table.rules) for (const e of r.effects) {
   const work = assignedHandle(e);
   if (work) { if (!handles.has(work.name)) { handles.add(work.name); bindings.set(work.name, work.type); } continue; }
   if ((e.kind === 'start' || e.kind === 'record') && typeof e.as === 'string' && !handles.has(e.as))
    bindings.set(e.as, e.kind === 'start' ? ty.ref('execution') : { type: 'record', record: e.record });
  }
  const wf = kind === 'workflow' ? w as Workflow : undefined;
  return {
   id: `${kind}:${w.id}`, label: `${kind} ${w.id}`, at, kind, subject: wf?.subject, lifecycle: wf?.lifecycle_of?.binding, initial: w.initial,
   stateList: w.states, states: new Map(w.states.map(s => [s.id, s])), inputs: w.inputs, calculations: wf?.calculations ?? {},
   tables: [...local, ...shared], fallback: w.fallback, bindings, handles,
  };
 }

 private say(reason: V1Reason, at: string, message: string, data: Data = {}, scope?: Scope): void {
  // A shared definition checked in a table's scope names that table's site as a use site.
  this.out.add(reason, at, message, data, scope?.table && (scope.table.shared || at.startsWith('/definitions/')) ? scope.site.id : undefined);
 }

 // ── Level 1: identities and references ──

 references(): void {
  const { doc, defs } = this;
  this.termAnnotations();
  const resources = (inputs: Readonly<Record<string, InputDecl>>, at: string): void => {
   for (const [name, decl] of Object.entries(inputs)) if (decl.resource) {
    if (!decl.type) this.say('input_without_type', ptr(at, name), 'A local resource needs an explicit type on its input declaration.');
    if (typeof decl.binding === 'object' && 'content' in decl.binding)
     this.say('invalid_shape', ptr(at, name, 'binding'), 'A local resource reads site-supplied data, not authored protocol content.');
   }
  };
  resources(defs.inputs ?? {}, '/definitions/inputs');
  for (const [name, table] of Object.entries(this.sharedTables)) resources(table.inputs ?? {}, ptr('', 'definitions', 'tables', name, 'inputs'));
  for (const site of this.sites) {
   resources(site.inputs, ptr(site.at, 'inputs'));
   for (const table of site.tables) resources(table.table.inputs ?? {}, ptr(table.at, 'inputs'));
  }
  (doc.imports ?? []).forEach((c, i) => this.unresolvedImport(c, ptr('', 'imports', i)));
  for (const [id, sop] of Object.entries(doc.sops ?? {})) {
   const at = ptr('', 'sops', id);
   for (const key of ['title', 'note', 'status'] as const) if (!sop[key].trim())
    this.say('invalid_shape', ptr(at, key), `SOP ${id} needs a nonempty ${key}.`, { sop: id });
   if ((sop.basis === 'source_fits' || sop.basis === 'source_adapted') && !sop.evidence.length)
    this.say('invalid_shape', ptr(at, 'evidence'), `Source-based SOP ${id} must cite its evidence.`, { sop: id });
   this.evidenceRefs(sop.evidence, ptr(at, 'evidence'));
  }
  (doc.overrides ?? []).forEach((o, i) => {
   const at = ptr('', 'overrides', i);
   if (!o.base || !/^.+@[^@]+$/.test(o.base))
    this.say('override_without_base_revision', ptr(at, 'base'), 'A local override names the base protocol and revision.', { base: o.base ?? null });
   if (!o.rationale?.trim() || !o.status?.trim())
    this.say('override_without_rationale_or_status', at, 'A local override needs a rationale and a status.', { missing: [!o.rationale?.trim() ? 'rationale' : '', !o.status?.trim() ? 'status' : ''].filter(Boolean) });
   if (o.kind === 'sop') {
    if (!o.sop || !Object.hasOwn(doc.sops ?? {}, o.sop))
     this.say('invalid_shape', ptr(at, 'sop'), 'An SOP replacement names a declared SOP.', { sop: o.sop ?? null });
    else {
     const declaration = ptr('', 'sops', o.sop);
     const under = (root: string) => o.element === root || o.element.startsWith(`${root}/`);
     const implementsSop = this.sites.some(site => site.tables.some(t => t.table.rules.some((r, ri) =>
      r.sops?.includes(o.sop!) && under(ptr(t.at, 'rules', ri)))));
     if (!under(declaration) && !implementsSop)
      this.say('invalid_shape', ptr(at, 'element'), `SOP replacement ${o.sop} must change its declaration or a rule that implements it.`, { sop: o.sop });
    }
   } else if (o.sop !== undefined) this.say('invalid_shape', ptr(at, 'sop'), 'Only an SOP replacement names sop; a pilot or study is a protocol departure.');
   const effective = atPointer(doc, o.element);
   if (effective === undefined || o.element.startsWith('/overrides/'))
    this.say('invalid_shape', ptr(at, 'element'), `Override element ${o.element} does not name an effective protocol field.`, { element: o.element });
   else if (stableJson(effective) !== stableJson(o.replacement))
    this.say('invalid_shape', ptr(at, 'replacement'), `Override replacement does not match effective content at ${o.element}.`, { element: o.element });
  });
  for (const [map, trusted, kind] of [['events', this.catalog.events, 'event'], ['records', this.catalog.records, 'record'], ['work_templates', this.catalog.tasks, 'task']] as const)
   for (const name of Object.keys(defs[map] ?? {})) if (Object.hasOwn(trusted, name))
    this.say('catalog_contract_conflict', ptr('', 'definitions', map, name), `The catalog already defines the ${kind} ${name}; a document cannot redefine a trusted contract or remove its protection.`, { [kind]: name });
  for (const [key, p] of Object.entries(this.catalog.policies)) if (p.id !== key)
   this.say('invalid_shape', ptr('', 'catalog', 'policies', key, 'id'), `Catalog work policy ${key} declares ID ${p.id}; the declaration ID must match its catalog key.`, { expected: key, value: p.id });
  // Runtime policy executions and handlers are keyed by ID within one content. Revisions can differ across contents,
  // but a local policy must not mask a catalog policy of the same ID inside one prepared content.
  for (const [key, p] of Object.entries(defs.work_policies ?? {})) if (Object.hasOwn(this.catalog.policies, p.id))
   this.say('catalog_contract_conflict', ptr('', 'definitions', 'work_policies', key), `The catalog already defines work policy ${p.id} at revision ${this.catalog.policies[p.id].revision}; use a distinct local policy ID.`, { policy: p.id, revision: p.revision, catalog_revision: this.catalog.policies[p.id].revision });
  this.unique(doc.workflows, '/workflows', `workflows of protocol ${doc.id}`);
  for (const [map, kind] of [['tables', 'table'], ['work_policies', 'policy']] as const)
   for (const [key, x] of Object.entries(defs[map] ?? {})) if (x.id !== key)
    this.say('invalid_shape', ptr('', 'definitions', map, key, 'id'), `This ${kind} is filed under ${key}, so its id must be ${key}, not ${x.id}.`, { expected: key, value: x.id });
  for (const [cls, h] of Object.entries(defs.fallback ?? {})) if (!Object.hasOwn(this.sharedTables, h))
   this.say('unresolved_handler', ptr('', 'definitions', 'fallback', cls), `The document's ${cls} handler ${h} is not a table in definitions.tables.`, { handler: h });
  for (const [key, t] of Object.entries(defs.work_templates ?? {})) {
   const at = ptr('', 'definitions', 'work_templates', key);
   if (t.performer && !Object.hasOwn(doc.roles ?? {}, t.performer.role)) this.say('unknown_binding_path', ptr(at, 'performer', 'role'), `Role ${t.performer.role} is not declared in the document's roles.`, { role: t.performer.role });
  }
  for (const [root, templates] of [['/definitions/work_templates', defs.work_templates ?? {}], ['/catalog/tasks', this.catalog.tasks]] as const)
   for (const [key, t] of Object.entries(templates)) if (t.completion.delivery) for (const part of ['content', 'recipient'] as const) {
    const field = t.completion.delivery[part], decl = t.content?.[field];
    if (!decl || decl.optional || (part === 'recipient' && (decl.type.type !== 'reference' || !decl.type.target.startsWith('object:'))))
     this.say('invalid_shape', ptr(root, key, 'completion', 'delivery', part), `Delivery ${part} must name a required ${part === 'recipient' ? 'object reference ' : ''}captured content field.`, { field });
   }

  for (const [key, w] of Object.entries(defs.work_policies ?? {}))
   for (const [name, wait] of Object.entries(w.waiting ?? {})) this.evidenceRefs(wait.evidence, ptr('', 'definitions', 'work_policies', key, 'waiting', name, 'evidence'));
  for (const site of this.sites) this.siteReferences(site);
 }

 /** Check declarations, including unused ones. A shared term names a concept, not an observation or an authority. */
 private termAnnotations(): void {
  for (const [id, term] of Object.entries(this.catalog.terms ?? {})) {
   const at = ptr('/catalog/terms', id);
   if (term.unit && !unitDimension(term.unit)) this.say('incompatible_unit', ptr(at, 'unit'), `${term.unit} is not a unit of the pinned unit catalog.`, { term: id });
   if (term.unit && term.values) this.say('invalid_shape', at, 'A shared term has one scalar domain: a unit or coded answers, not both.', { term: id });
   if (term.values && (!term.values.length || new Set(term.values).size !== term.values.length))
    this.say('invalid_shape', ptr(at, 'values'), 'Shared answers must be nonempty and distinct.', { term: id });
   if (term.ordered && !term.values) this.say('invalid_shape', ptr(at, 'ordered'), 'Only coded answers can be ordered.', { term: id });
   if (term.range && (!term.unit || term.range.length !== 2 || term.range[0] > term.range[1]))
    this.say('invalid_shape', ptr(at, 'range'), 'A plausible range needs a unit and two bounds in ascending order.', { term: id });
  }
  const fields = (entries: Readonly<Record<string, InputDecl | FieldDecl | SourceFieldDecl>>, at: string) => {
   for (const [name, decl] of Object.entries(entries)) this.termAnnotation(decl, decl.type, ptr(at, name));
  };
  const inputs = (w: Workflow | WorkPolicy, at: string) => {
   fields(w.inputs, ptr(at, 'inputs'));
   w.tables.forEach((t, i) => fields(t.inputs ?? {}, ptr(at, 'tables', i, 'inputs')));
  };
  fields(this.defs.inputs ?? {}, '/definitions/inputs');
  for (const [name, t] of Object.entries(this.sharedTables)) fields(t.inputs ?? {}, ptr('/definitions/tables', name, 'inputs'));
  this.doc.workflows.forEach((w, i) => inputs(w, ptr('/workflows', i)));
  for (const [root, policies] of [['/definitions/work_policies', this.defs.work_policies ?? {}], ['/catalog/policies', this.catalog.policies]] as const)
   for (const [name, p] of Object.entries(policies)) inputs(p, ptr(root, name));
  for (const [root, entries, part] of [
   ['/catalog/objects', this.catalog.objects, 'fields'], ['/catalog/sources', this.catalog.sources, 'fields'],
   ['/catalog/records', this.catalog.records, 'fields'], ['/catalog/events', this.catalog.events, 'payload'],
   ['/catalog/orders', this.catalog.orders, 'content'], ['/definitions/records', this.defs.records ?? {}, 'fields'],
   ['/definitions/events', this.defs.events ?? {}, 'payload'],
  ] as const) for (const [name, contract] of Object.entries(entries)) {
   if ((root === '/catalog/events' && Object.hasOwn(STANDARD_EVENTS, name)) || (root === '/catalog/records' && Object.hasOwn(STANDARD_RECORDS, name))) continue;
   fields((contract as unknown as Record<string, Readonly<Record<string, FieldDecl>>>)[part], ptr(root, name, part));
  }
  for (const [root, templates] of [['/definitions/work_templates', this.defs.work_templates ?? {}], ['/catalog/tasks', this.catalog.tasks]] as const)
   for (const [name, w] of Object.entries(templates)) for (const part of ['content', 'result'] as const) fields(w[part] ?? {}, ptr(root, name, part));
  for (const [name, role] of Object.entries(this.doc.roles ?? {})) for (const [i, id] of (role.terms ?? []).entries()) {
   const term = this.catalog.terms && Object.hasOwn(this.catalog.terms, id) ? this.catalog.terms[id] : undefined;
   if (!term || term.kind !== 'role') this.say('unresolved_term', ptr('/roles', name, 'terms', i), `${id} must name a shared role term in the pinned catalog.`, { term: id });
   else this.contracts.add(`term:${id}`);
  }
 }

 private termAnnotation(decl: { term?: string; label?: string; role?: string }, type: TypeDescriptor | undefined, at: string): void {
  if (!decl.term) {
   if (Object.keys(this.catalog.terms ?? {}).length && !decl.label && decl.role !== 'control' && type && ['yes_no', 'listed', 'count', 'number', 'quantity', 'text'].includes(type.type))
    this.out.add('missing_term', at, 'Name the shared clinical term, or add a protocol label if this is a workflow field.', {}, undefined, 'warning');
   return;
  }
  const term = this.catalog.terms && Object.hasOwn(this.catalog.terms, decl.term) ? this.catalog.terms[decl.term] : undefined;
  if (!term) { this.say('unresolved_term', ptr(at, 'term'), `${decl.term} is not a shared term in the pinned catalog.`, { term: decl.term }); return; }
  this.contracts.add(`term:${decl.term}`);
  if (decl.label !== undefined && decl.label !== term.label)
   this.say('term_label_conflict', ptr(at, 'label'), `Use the shared display name ${JSON.stringify(term.label)} for ${decl.term}; change the shared entry instead of overriding it here.`, { term: decl.term, label: term.label });
  if (!type) return; // An input's inherited type is checked by inputType.
  let compatible = false;
  if (term.values) {
   const yesNo = term.values.length === 2 && term.values.includes('yes') && term.values.includes('no');
   compatible = yesNo ? type.type === 'yes_no'
    : type.type === 'listed' && !!type.ordered === !!term.ordered && new Set(type.values).size === term.values.length && type.values.length === term.values.length
     && (term.ordered ? type.values.every((v, i) => v === term.values![i]) : type.values.every(v => term.values!.includes(v)));
  } else if (term.unit === '1') compatible = type.type === 'count';
  else if (term.unit && type.type === 'quantity') {
   try { compatible = convert(1, type.unit, term.unit) === 1; } catch { /* An incompatible or unknown unit is refused below. */ }
  }
  if (!compatible) this.say('term_type_mismatch', ptr(at, 'term'), `${show(type)} does not have the scalar type, answers and unit magnitude of ${decl.term}. Convert explicitly before binding; a term tag never converts a value.`, { term: decl.term, actual: show(type) });
 }

 private unique(items: readonly { id: string }[], at: string, namespace: string): void {
  const seen = new Set<string>();
  items.forEach((x, i) => {
   if (seen.has(x.id)) this.say('duplicate_id', ptr(at, i, 'id'), `${x.id} is already used among the ${namespace}.`, { id: x.id, namespace });
   seen.add(x.id);
  });
 }

 private evidenceRefs(ids: readonly string[], at: string, scope?: Scope): void {
  ids.forEach((e, i) => { if (!Object.hasOwn(this.doc.evidence ?? {}, e)) this.say('unresolved_evidence_reference', ptr(at, i), `Evidence ${e} is not declared in the document's evidence.`, { evidence: e }, scope); });
 }

 private eventRef(event: string, at: string, scope?: Scope): EventContract | undefined {
  if (event === 'host.stage_confirmed') {
   this.say('unresolved_event_contract', at, `${event} is reserved for host stage confirmation and cannot be subscribed to or emitted.`, { event }, scope);
   return undefined;
  }
  if (Object.hasOwn(this.events, event)) { if (Object.hasOwn(this.catalog.events, event)) this.contracts.add(`event:${event}`); return this.events[event]; }
  this.say('unresolved_event_contract', at, `Event ${event} has no contract in definitions.events or the catalog.`, { event }, scope);
  return undefined;
 }

 private recordRef(record: string, at: string, scope?: Scope): RecordContract | undefined {
  if (Object.hasOwn(this.records, record) && !record.startsWith('#')) { if (Object.hasOwn(this.catalog.records, record)) this.contracts.add(`record:${record}`); return this.records[record]; }
  this.say('unresolved_record_contract', at, `Record ${record} has no contract in definitions.records or the catalog.`, { record }, scope);
  return undefined;
 }

 /** No verified content resolver exists yet, so named external content cannot be checked or given an identity. */
 private unresolvedImport(c: ContentRef, at: string, scope?: Scope): void {
  this.say('unresolved_import', at, `Content ${c.protocol} at revision ${c.revision} cannot be resolved: this validator has no verified content resolver, so the document has no effective identity.`, { protocol: c.protocol, revision: c.revision }, scope);
 }

 private siteReferences(site: Site): void {
  const local = site.tables.filter(t => !t.shared), all = local.map(t => t.table);
  this.unique(site.stateList, ptr(site.at, 'states'), `states of ${site.label}`);
  this.unique(all, ptr(site.at, 'tables'), `tables of ${site.label}`);
  if (!site.states.has(site.initial)) this.say('undeclared_state', ptr(site.at, 'initial'), `The initial state ${site.initial} is not a state of ${site.label}.`, { state: site.initial });
  const handlerTables = new Set([...all.map(t => t.id), ...Object.keys(this.sharedTables)]);
  for (const t of local) if (Object.hasOwn(this.sharedTables, t.table.id) && site.tables.some(s => s.shared && s.table.id === t.table.id))
   this.say('duplicate_id_after_shared_expansion', ptr(t.at, 'id'), `Table ${t.table.id} is also the shared table that the fallback handlers bring into ${site.label}.`, { id: t.table.id });
  const fallbacks: [Fallback | undefined, string][] = [[site.fallback, ptr(site.at, 'fallback')], ...local.map((t): [Fallback | undefined, string] => [t.table.fallback, ptr(t.at, 'fallback')])];
  for (const [fb, at] of fallbacks) for (const [cls, h] of Object.entries(fb ?? {})) if (!handlerTables.has(h))
   this.say('unresolved_handler', ptr(at, cls), `The ${cls} handler ${h} is not a table of ${site.label} or of definitions.tables.`, { handler: h });
  site.stateList.forEach((s, i) => {
   if (s.decision?.authority.kind === 'role' && !Object.hasOwn(this.doc.roles ?? {}, s.decision.authority.role)) {
    this.say('unknown_binding_path', ptr(site.at, 'states', i, 'decision', 'authority', 'role'), `Role ${s.decision.authority.role} is not declared in the document's roles.`, { role: s.decision.authority.role });
   }
  });
  for (const t of site.tables) this.tableReferences(t, { site, table: t });
  this.duplicateHandlers(site);
 }

 private tableReferences({ table, at }: SiteTable, scope: Scope): void {
  const { site } = scope;
  const enabled = (r: TableRule) => r.in.includes('*') ? [...site.states.keys()] : r.in;
  this.unique(table.rules, ptr(at, 'rules'), `rules of table ${table.id}`);
  if (table.on.work !== undefined && !site.handles.has(table.on.work))
   this.say('undeclared_work_handle', ptr(at, 'on', 'work'), `No effect of ${site.label} assigns the work handle ${table.on.work}.`, { handle: table.on.work }, scope);
  this.eventRef(table.on.event, ptr(at, 'on', 'event'), scope);
  if (table.on.for === undefined && table.on.work === undefined && !['decision.requested', 'evaluation.failed'].includes(table.on.event))
   this.say('invalid_shape', ptr(at, 'on'), 'A routed subscription names its scope with for or work.', { event: table.on.event }, scope);
  // A resumable decision takes the requests of one table of its site, typed by that table's request contract.
  if (table.on.event === 'decision.requested') {
   if (table.on.for !== undefined && table.on.for.binding !== 'this_execution')
    this.say('invalid_shape', ptr(at, 'on', 'for', 'binding'), 'A decision.requested subscription takes only requests addressed to this_execution.', { binding: table.on.for.binding }, scope);
   if (table.on.table === undefined) this.say('invalid_shape', ptr(at, 'on'), 'A decision.requested subscription names the table whose requests it takes.', { field: 'table' }, scope);
   else if (!site.tables.some(t => t.table.id === table.on.table && t.table.request))
    this.say('invalid_shape', ptr(at, 'on', 'table'), `${table.on.table} is not a table of ${site.label} with a request contract.`, { table: table.on.table }, scope);
  } else if (table.on.table !== undefined)
   this.say('invalid_shape', ptr(at, 'on', 'table'), `Only a decision.requested subscription names a request table; this one is on ${table.on.event}.`, { event: table.on.event, table: table.on.table }, scope);
  const priority = table.hit === 'priority';
  if (priority && !table.precedence_evidence?.length) this.say('missing_precedence_evidence', at, `A priority table needs a nonempty precedence_evidence list.`, {}, scope);
  this.evidenceRefs(table.precedence_evidence ?? [], ptr(at, 'precedence_evidence'), scope);
  const clinical = table.purpose === 'clinical_decision', handler = table.on.event === 'evaluation.failed';
  table.rules.forEach((r, ri) => {
   const rat = ptr(at, 'rules', ri);
   this.unique(r.effects, ptr(rat, 'effects'), `effects of rule ${r.id}`);
   if (priority && r.rank === undefined) this.say('missing_rank', rat, `Every row of a priority table has a rank.`, {}, scope);
   if (r.rank !== undefined && (!Number.isInteger(r.rank) || r.rank < 1)) this.say('non_numeric_rank', ptr(rat, 'rank'), `A rank is a positive whole number, 1 highest.`, { value: r.rank }, scope);
   else if (r.rank !== undefined && !priority) this.say('unsupported_hit_policy', ptr(rat, 'rank'), `Only a priority table ranks its rows; this table is ${table.hit ?? 'unique'}.`, {}, scope);
   r.in.forEach((s, i) => {
    if (s === '*' && !scope.table?.shared) this.say('undeclared_state', ptr(rat, 'in', i), 'Only a shared handler definition runs in every state ("*"); name the states this row runs in.', { state: s }, scope);
    else if (s !== '*' && !site.states.has(s)) this.say('undeclared_state', ptr(rat, 'in', i), `${s} is not a state of ${site.label}.`, { state: s }, scope);
    else if (clinical) for (const st of s === '*' ? [...site.states.keys()] : [s]) if (!site.states.get(st)?.decision)
     this.say('decision_state_without_question_or_authority', ptr(rat, 'in', i), `A clinical decision row runs in ${st}, which declares no decision question and authority.`, { state: st }, scope);
   });
   if ('state' in r.to && !site.states.has(r.to.state)) {
    const other = this.sites.find(x => x !== site && x.states.has((r.to as { state: string }).state));
    if (other) this.say('cross_workflow_state_write', ptr(rat, 'to', 'state'), `${r.to.state} is a state of ${other.label}; a rule moves only its own execution, through its own states.`, { state: r.to.state, owner: other.id }, scope);
    else this.say('undeclared_state', ptr(rat, 'to', 'state'), `${r.to.state} is not a state of ${site.label}.`, { state: r.to.state }, scope);
   }
   if ('end' in r.to && r.to.handoff) {
    const h = r.to.handoff, hat = ptr(rat, 'to', 'handoff');
    if (h.pathway === 'unspecified') {
     if (!h.description?.trim()) this.say('invalid_shape', ptr(hat, 'description'), 'An unspecified receiving pathway needs a short description.', {}, scope);
    } else if (typeof h.pathway === 'string') {
     if (!this.doc.workflows.some(w => w.id === h.pathway))
      this.say('unresolved_workflow_definition', ptr(hat, 'pathway'), `Receiving pathway ${h.pathway} is not a workflow in this document. Name an existing workflow, an external reference, or unspecified with a description.`, { workflow: h.pathway }, scope);
    } else if (h.pathway.document === this.doc.id) {
     this.say('invalid_shape', ptr(hat, 'pathway', 'document'), 'An external handoff must name another document. Use a local workflow ID for this document.', { document: h.pathway.document }, scope);
    } else {
     this.out.add('unresolved_workflow_definition', ptr(hat, 'pathway'), `Receiving pathway ${h.pathway.document}/${h.pathway.workflow} is external, not checked. Its existence and start state need a cross-document resolver.`,
      { document: h.pathway.document, workflow: h.pathway.workflow }, scope.table?.shared ? scope.site.id : undefined, 'warning');
    }
   }
   this.evidenceRefs(r.evidence, ptr(rat, 'evidence'), scope);
   (r.sops ?? []).forEach((id, i) => {
    if (!Object.hasOwn(this.doc.sops ?? {}, id)) this.say('invalid_shape', ptr(rat, 'sops', i), `SOP ${id} is not declared.`, { sop: id }, scope);
   });
   this.condition(r.when, ptr(rat, 'when'), scope, clinical);
   const authorized = clinical && enabled(r).every(s => site.states.get(s)?.decision);
   r.effects.forEach((e, ei) => this.effectReferences(e, ptr(rat, 'effects', ei), r, ei, scope, { clinical, handler, authorized }));
  });
  // A clinical condition includes every calculation it reads.
  if (clinical) for (const name of this.calculationsRead(table, site)) {
   const own = Object.hasOwn(site.calculations, name), c = own ? site.calculations[name] : this.defs.calculations![name];
   const cat = own ? ptr(site.at, 'calculations', name) : ptr('', 'definitions', 'calculations', name);
   const texts: [string, string][] = 'when' in c ? [[c.when, ptr(cat, 'when')]] : 'cases' in c ? c.cases.map((k, i): [string, string] => [k.when, ptr(cat, 'cases', i, 'when')]) : [];
   for (const [text, p] of texts) {
    const parsed = parseCondition(text), fn = parsed.ok ? missingness(parsed.value) : undefined;
    if (fn) this.say('missingness_guard_in_clinical_decision', p, `${fn}() tests missing information, and clinical decision table ${table.id} reads ${name}.`, { function: fn, table: table.id }, scope);
   }
  }
 }

 /** Two tables of one site on the same subscription with a state in common: the event would have two handlers. */
 private duplicateHandlers(site: Site): void {
  const key = (t: Table) => JSON.stringify([t.on.event, t.on.for?.binding ?? null, t.on.work ?? null, t.on.table ?? null]);
  const states = (t: Table) => new Set(t.rules.flatMap(r => r.in.includes('*') ? [...site.states.keys()] : r.in));
  const subscribed = site.tables.filter(t => t.table.on.event !== 'evaluation.failed');
  subscribed.forEach((b, j) => {
   for (const a of subscribed.slice(0, j)) {
    if (key(a.table) !== key(b.table)) continue;
    const sb = states(b.table), common = sorted([...states(a.table)].filter(s => sb.has(s)));
    if (common.length) this.say('duplicate_effective_handler', b.at, `Tables ${a.table.id} and ${b.table.id} both handle ${b.table.on.event} in ${common[0]}; one subscription has one table.`,
     { event: b.table.on.event, state: common[0], tables: sorted([a.table.id, b.table.id]) }, { site, table: b });
   }
  });
 }

 private effectReferences(e: Effect, at: string, rule: TableRule, index: number, scope: Scope, table: { clinical: boolean; handler: boolean; authorized: boolean }): void {
  const { site } = scope;
  if (e.when !== undefined) this.condition(e.when, ptr(at, 'when'), scope, table.clinical);
  this.effectOrder(e, at, rule, index, scope);
  const role = (o: unknown, oat: string) => { if (isObj(o) && typeof o.role === 'string' && !Object.hasOwn(this.doc.roles ?? {}, o.role)) this.say('unknown_binding_path', ptr(oat, 'role'), `Role ${o.role} is not declared in the document's roles.`, { role: o.role }, scope); };
  if ('owner' in e) role(e.owner, ptr(at, 'owner'));
  if ('performer' in e) role(e.performer, ptr(at, 'performer'));
  if (e.kind === 'task' || e.kind === 'order' || e.kind === 'publish') {
   // A reissue carries the owner and pinned policy of the completed task it asks again.
   if (!('reissue' in e)) {
    if (e.owner === undefined) this.say('task_without_owner', at, `${e.kind === 'publish' ? 'Publication' : e.kind === 'order' ? 'Order' : 'Task'} ${e.id} is work with no accountable owner.`, {}, scope);
    if (e.kind !== 'publish' && e.policy === undefined) this.say('missing_work_policy', at, `${e.kind === 'order' ? 'Order' : 'Task'} ${e.id} needs an explicit pinned work policy.`, {}, scope);
    if (e.policy !== undefined && !this.policy(e.policy)) this.say('unavailable_work_policy', ptr(at, 'policy'), `Work policy ${e.policy.id} is not available at revision ${e.policy.revision}.`, { policy: e.policy.id, revision: e.policy.revision }, scope);
   }
   if (e.due && 'work' in e.due.from && !site.handles.has(e.due.from.work)) this.say('undeclared_work_handle', ptr(at, 'due', 'from', 'work'), `No effect assigns the work handle ${e.due.from.work}.`, { handle: e.due.from.work }, scope);
  }
  if (e.kind === 'publish' && e.policy === undefined) {
   for (const field of ['due', 'as', 'occurrence', 'lifetime', 'purpose', 'performer'] as const) if (e[field] !== undefined)
    this.say('invalid_shape', ptr(at, field), `An owner notice without a policy cannot set ${field}; pin a policy for tracked publication work.`, { field }, scope);
  }
  if (e.kind === 'task') {
   const template = this.workTemplate(e.task);
   if (!template) this.say('unresolved_work_template', ptr(at, 'task'), `Task template ${e.task} is not in definitions.work_templates or the catalog.`, { task: e.task }, scope);
   if (template?.protected) this.protectedWrite(at, `task ${e.task}`, scope, table);
   if ('reissue' in e) this.reissueReferences(e, at, scope);
  }
  if (e.kind === 'order') {
   const order = this.catalog.orders[e.order];
   if (order.protected.includes('*') || Object.keys(e.content).some(k => order.protected.includes(k))) this.protectedWrite(at, `${e.order} order`, scope, table);
  }
  if (e.kind === 'record') {
   const contract = this.recordRef(e.record, ptr(at, 'record'), scope);
   if (contract?.protected?.some(f => Object.hasOwn(e.fields, f))) this.protectedWrite(at, `record ${e.record}`, scope, table);
   if (contract?.stage) {
    const target = (e.for as { binding?: unknown } | undefined)?.binding;
    if (site.kind !== 'workflow' || !site.lifecycle || target !== site.lifecycle)
     this.say('stage_write_outside_designated_lifecycle', at, `Only the designated lifecycle execution records ${e.record}; ${site.label} is not the lifecycle of that subject.`, { record: e.record }, scope);
   }
  }
  if (e.kind === 'change_work') {
   const w = e.work;
   if (isObj(w) && 'handle' in w && typeof w.handle === 'string' && !site.handles.has(w.handle))
    this.say('undeclared_work_handle', ptr(at, 'work', 'handle'), `No effect of ${site.label} assigns the work handle ${w.handle}.`, { handle: w.handle }, scope);
   if (e.operation === 'reschedule' && 'work' in e.due.from && !site.handles.has(e.due.from.work))
    this.say('undeclared_work_handle', ptr(at, 'due', 'from', 'work'), `No effect assigns the work handle ${e.due.from.work}.`, { handle: e.due.from.work }, scope);
  }
  if (e.kind === 'emit') this.eventRef(e.event, ptr(at, 'event'), scope);
  if (e.kind === 'emit' && e.event === 'decision.requested') this.requestReferences(e, at, scope);
  if (e.kind === 'start') this.startReferences(e, at, scope);
 }

 /** A request names its activation and, as a literal, a decision table that declares a request contract. */
 private requestReferences(e: EmitEffect, at: string, scope: Scope): void {
  if (e.activation === undefined) this.say('invalid_shape', at, 'A decision request names its activation: current or destination.', { field: 'activation' }, scope);
  if (!Object.hasOwn(e.fields, 'table')) return; // a missing payload field is reported with the payload
  const name = requestTableName(e);
  if (name === undefined) this.say('invalid_shape', ptr(at, 'fields', 'table'), 'A request names its decision table as a literal identifier.', { field: 'table' }, scope);
  else if (!this.requestContract(name, scope.site)) this.say('invalid_shape', ptr(at, 'fields', 'table'), `${name} is not a table with a request contract.`, { table: name }, scope);
 }

 /** The request contract of the named table: in this site first, then in another workflow or policy of the document. */
 private requestContract(name: string, site: Site): RequestContract | undefined {
  for (const s of [site, ...this.sites.filter(x => x !== site)]) {
   const t = s.tables.find(x => x.table.id === name && x.table.request);
   if (t) return t.table.request;
  }
  return undefined;
 }

 private protectedWrite(at: string, what: string, scope: Scope, table: { handler: boolean; authorized: boolean }): void {
  if (table.handler) this.say('handler_fabricates_clinical_outcome', at, `A failure handler cannot create the protected clinical write ${what}.`, {}, scope);
  else if (!table.authorized) this.say('clinical_write_without_decision_authority', at, `${what} is a protected clinical write: only a clinical decision row in a state with decision authority may make it.`, {}, scope);
 }

 /** `{effect: id}` reads an earlier effect of the same row only. A missing effect is a binding fault, found in level 2. */
 private effectOrder(e: Effect, at: string, rule: TableRule, index: number, scope: Scope): void {
  for (const [id, p] of effectReads(e, at)) {
   const j = rule.effects.findIndex(f => f.id === id);
   if (j >= index) this.say('effect_reads_later_effect', p, `${id} is staged ${j === index ? 'by this effect itself' : 'after this effect'}; a value reads only earlier effects of the row.`, { effect: id }, scope);
  }
 }

 private startReferences(e: StartEffect, at: string, scope: Scope): void {
  if ('content' in e.definition) return this.unresolvedImport(e.definition.content, ptr(at, 'definition', 'content'), scope);
  const child = this.doc.workflows.find(w => w.id === (e.definition as { workflow: string }).workflow);
  if (!child) return this.say('unresolved_workflow_definition', ptr(at, 'definition', 'workflow'), `Workflow ${e.definition.workflow} is not in this document.`, { workflow: e.definition.workflow }, scope);
  if (e.mode !== 'new' || e.lifetime === 'independent') return;
  const origins = Object.entries(e.bindings).filter(([, v]) => (v as { binding?: unknown }).binding === 'this_execution').map(([k]) => k);
  const ends = child.tables.some(t => t.on.event === 'workflow.ended' && t.on.for && origins.includes(t.on.for.binding));
  if (!ends) this.say('execution_child_without_origin_end_handler', at, `Child workflow ${child.id} lives as long as this execution but has no table on workflow.ended for the execution that starts it.`, { workflow: child.id }, scope);
 }

 /** A reissue asks again work that an ordinary task effect of the same template assigns to its handle in this site. */
 private reissueReferences(e: ReissueTaskEffect, at: string, scope: Scope): void {
  const name = e.reissue.handle, p = ptr(at, 'reissue', 'handle');
  const assigning = scope.site.tables.flatMap(t => t.table.rules.flatMap(r => r.effects)).filter(x => !('reissue' in x) && assignedHandle(x)?.name === name);
  if (!assigning.length) return this.say('undeclared_work_handle', p, `No ordinary task effect of ${scope.site.label} assigns the work handle ${name} that this reissue asks again.`, { handle: name }, scope);
  // An undeclared template is reported on its own.
  if (this.workTemplate(e.task) && !assigning.some(x => x.kind === 'task' && x.task === e.task)) {
   const holds = assignedHandle(assigning[0])!.type;
   this.say('type_mismatch', p, `Work handle ${name} holds a ${show(holds)}; a reissue of ${e.task} asks again a task of the same template.`, { handle: name, expected: show({ type: 'reference', target: `work:${e.task}` }), actual: show(holds) }, scope);
  }
 }

 private workTemplate(id: string): WorkTemplate | undefined {
  if (Object.hasOwn(this.catalog.tasks, id)) { this.contracts.add(`task:${id}`); return this.catalog.tasks[id]; }
  if (Object.hasOwn(this.defs.work_templates ?? {}, id)) return this.defs.work_templates![id];
  return undefined;
 }

 /** The pinned policy at exactly that revision: the catalog's first (a document copy is reported in references), else the document's own. */
 private policy(ref: PolicyRef): WorkPolicy | undefined {
  const pinned = Object.hasOwn(this.catalog.policies, ref.id) ? this.catalog.policies[ref.id] : undefined;
  if (pinned?.revision === ref.revision) { this.contracts.add(`policy:${ref.id}@${ref.revision}`); return pinned; }
  const local = Object.hasOwn(this.defs.work_policies ?? {}, ref.id) ? this.defs.work_policies![ref.id] : undefined;
  return local?.revision === ref.revision ? local : undefined;
 }

 /** Parse a condition with the one grammar; a fault is the reason that names it. */
 private condition(text: string, at: string, scope: Scope, clinical: boolean): Expr | undefined {
  const r = parseCondition(text);
  if (!r.ok) {
   const { at: offset, message } = r.error;
   const reason: V1Reason = /mixed without brackets/.test(message) ? 'mixed_and_or_without_brackets'
    : parseCondition(text, { definition: true }).ok || /looks back over the record/.test(message) ? 'history_query_in_rule_condition' : 'not_condition_grammar';
   this.say(reason, at, message, { offset }, scope);
   return undefined;
  }
  if (clinical) {
   const fn = missingness(r.value);
   if (fn) this.say('missingness_guard_in_clinical_decision', at, `${fn}() tests missing information; a clinical decision row cannot branch on it. Route missing information through the unresolved handler.`, { function: fn }, scope);
  }
  return r.value;
 }

 /** Each table in each site's scope, with the declared name each guard reads (and each name an expanded calculation reads). */
 analysisSites(): { site: Site; table: SiteTable; axes: Record<string, AxisSpec>; concepts: Concepts }[] {
  return this.sites.flatMap(site => site.tables.map(table => {
   const scope: Scope = { site, table }, t = table.table, defs = this.defs, axes: Record<string, AxisSpec> = {};
   const add = (n: string): void => {
    if (Object.hasOwn(axes, n)) return;
    const calc = t.inputs && Object.hasOwn(t.inputs, n) ? undefined : Object.hasOwn(site.inputs, n) ? undefined
     : Object.hasOwn(site.calculations, n) ? site.calculations[n]
     : defs.inputs && Object.hasOwn(defs.inputs, n) ? undefined : defs.calculations && Object.hasOwn(defs.calculations, n) ? defs.calculations[n] : undefined;
    const type = this.name(n, scope)?.type;
    if (calc) { axes[n] = { kind: 'calculation', calculation: calc, type }; calculationNamesRead(calc).forEach(add); return; }
    const parameter = !(t.inputs && Object.hasOwn(t.inputs, n)) && !Object.hasOwn(site.inputs, n) && !(defs.inputs && Object.hasOwn(defs.inputs, n)) && defs.parameters && Object.hasOwn(defs.parameters, n) ? defs.parameters[n] : undefined;
    axes[n] = parameter ? { kind: 'parameter', type: parameter.type, value: parameter.value } : { kind: 'input', type };
   };
   for (const r of t.rules) { const p = parseCondition(r.when); if (p.ok) conditionNames(p.value).forEach(add); }
   return { site, table, axes, concepts: this.concepts(scope) };
  }));
 }

 // ── Level 2: types and bindings ──

 bindings(): void {
  this.calculationCycles();
  const sharedUsed = new Set<string>();
  for (const site of this.sites) {
   const scope: Scope = { site };
   this.shadowing(scope);
   const inputsAt = ptr(site.at, 'inputs');
   for (const [name, decl] of Object.entries(site.inputs)) this.inputType(decl, ptr(inputsAt, name), scope, site.kind === 'workflow' ? 'workflow' : 'policy');
   if (site.subject && site.kind === 'workflow' && !Object.hasOwn(this.catalog.objects, site.subject))
    this.say('unresolved_object_contract', ptr(site.at, 'subject'), `Object type ${site.subject} has no contract in the catalog.`, { object: site.subject });
   else if (site.subject) this.contracts.add(`object:${site.subject}`);
   if (site.lifecycle !== undefined) {
    const t = site.bindings.get(site.lifecycle);
    if (!t) this.say('unknown_binding_path', ptr(site.at, 'lifecycle_of', 'binding'), `${site.lifecycle} is not a binding of ${site.label}.`, { binding: site.lifecycle });
    else if (!assignable(t, ty.ref(`object:${site.subject}`))) this.say('type_mismatch', ptr(site.at, 'lifecycle_of', 'binding'), `A lifecycle binds the workflow's own subject, a ${site.subject}; ${site.lifecycle} is a ${show(t)}.`, { binding: site.lifecycle });
    else {
     const source = site.inputs[site.lifecycle]?.binding;
     if (typeof source !== 'string' || !source.startsWith('entry.') || source.slice('entry.'.length).trim() === '')
      this.say('invalid_shape', ptr(site.at, 'lifecycle_of', 'binding'), 'A designated lifecycle subject must read entry.<name> directly, with a nonempty name. Indirect or derived inputs cannot reserve a lifecycle owner.', { binding: site.lifecycle });
    }
   }
   const used = new Set<string>();
   for (const t of site.tables) {
    const tableScope = { site, table: t };
    this.tableBindings(tableScope);
    for (const name of this.calculationsRead(t.table, site, true)) { used.add(name); sharedUsed.add(name); this.calculationAt(name, tableScope); }
    // A shared input is checked in each table that reads it.
    for (const name of tableNamesRead(t.table)) if (this.defs.inputs && Object.hasOwn(this.defs.inputs, name) && !Object.hasOwn(t.table.inputs ?? {}, name) && !Object.hasOwn(site.inputs, name))
     this.inputType(this.defs.inputs[name], ptr('', 'definitions', 'inputs', name), tableScope, 'table');
   }
   // A calculation no table reads is checked where it is declared.
   for (const name of Object.keys(site.calculations)) if (!used.has(name)) this.calculationAt(name, scope);
  }
  // A shared calculation that no site reads is checked once, where only the shared definitions are in scope.
  const neutral: Site = {
   id: 'definitions' as SemanticId, label: 'the shared definitions', at: '/definitions', kind: 'workflow', initial: '', stateList: [], states: new Map(),
   inputs: {}, calculations: {}, tables: [], bindings: new Map([['this_execution', ty.ref('execution')]]), handles: new Set(),
  };
  for (const name of Object.keys(this.defs.calculations ?? {})) if (!sharedUsed.has(name)) this.calculationAt(name, { site: neutral });
  for (const [map, kind] of [['inputs', 'Input'], ['calculations', 'Calculation'], ['parameters', 'Parameter']] as const) for (const n of Object.keys(this.defs[map] ?? {}))
   if (['event', 'this_execution', 'entry'].includes(n.split('.')[0])) this.say('shadowed_name', ptr('', 'definitions', map, n), `${kind} ${n} begins with a reserved root.`, { name: n, root: n.split('.')[0] });
  for (const [name, p] of Object.entries(this.defs.parameters ?? {})) {
   this.descriptor(p.type, ptr('', 'definitions', 'parameters', name, 'type'));
   this.literal(p.value, p.type, ptr('', 'definitions', 'parameters', name, 'value')); // a parameter has no declared absence
  }
  for (const [name, w] of Object.entries(this.defs.work_templates ?? {})) for (const part of ['content', 'result'] as const)
   for (const [f, decl] of Object.entries(w[part] ?? {})) this.descriptor(decl.type, ptr('', 'definitions', 'work_templates', name, part, f, 'type'));
  for (const [map, fieldsOf] of [['records', (r: RecordContract) => r.fields], ['events', (e: EventContract) => e.payload]] as const)
   for (const [name, c] of Object.entries(this.defs[map] ?? {})) for (const [f, decl] of Object.entries(fieldsOf(c as never)))
    this.descriptor(decl.type, ptr('', 'definitions', map, name, map === 'records' ? 'fields' : 'payload', f, 'type'));
 }

 /**
  * A local name cannot begin with a reserved root or stand for another name: a table input or alias that is also a
  * site input, calculation, shared name, binding or typed path would hide it.
  */
 private shadowing(scope: Scope): void {
  const { site } = scope, table = scope.table?.table;
  const reserved = (name: string, at: string, kind: string) => {
   const root = name.split('.')[0];
   if (!['event', 'this_execution', 'entry'].includes(root)) return false;
   this.say('shadowed_name', at, `${kind} ${name} begins with the reserved root ${root}.`, { name, root }, scope);
   return true;
  };
  if (!table) {
   for (const n of Object.keys(site.inputs)) reserved(n, ptr(site.at, 'inputs', n), 'Input');
   for (const n of Object.keys(site.calculations)) if (!reserved(n, ptr(site.at, 'calculations', n), 'Calculation') && (Object.hasOwn(site.inputs, n) || site.bindings.has(n)))
    this.say('shadowed_name', ptr(site.at, 'calculations', n), `Calculation ${n} is also an input or binding of ${site.label}.`, { name: n }, scope);
   return;
  }
  const at = scope.table!.at, defs = this.defs;
  const bare: Scope = { site, table: { ...scope.table!, table: { ...table, inputs: undefined, aliases: undefined } } };
  const other = (n: string) => Object.hasOwn(site.inputs, n) || Object.hasOwn(site.calculations, n) || site.bindings.has(n)
   || [defs.inputs, defs.calculations, defs.parameters].some(m => m && Object.hasOwn(m, n)) || (n.includes('.') && this.path(n, bare) !== undefined);
  for (const [map, kind] of [['inputs', 'Input'], ['aliases', 'Alias']] as const) for (const n of Object.keys(table[map] ?? {})) {
   const p = ptr(at, map, n);
   if (!reserved(n, p, kind) && other(n)) this.say('shadowed_name', p, `${kind} ${n} of table ${table.id} also names a declared input, calculation, binding or path of ${site.label}.`, { name: n }, scope);
  }
 }

 /** The names a condition may read in this scope, as parser concepts: a bare declared name is a name on either side. */
 private concepts(scope: Scope): Concepts {
  const { site } = scope, table = scope.table?.table, defs = this.defs;
  const names = new Set([...Object.keys(table?.inputs ?? {}), ...Object.keys(table?.aliases ?? {}), ...Object.keys(site.inputs), ...Object.keys(site.calculations),
   ...[defs.inputs, defs.calculations, defs.parameters].flatMap(m => Object.keys(m ?? {})), ...site.bindings.keys()]);
  const out: Record<string, Concept> = {};
  for (const n of names) {
   const t = this.name(n, scope)?.type;
   out[n] = t?.type === 'quantity' ? { unit: t.unit } : t?.type === 'listed' ? { values: t.values, ...(t.ordered ? { ordered: true } : {}) } : {};
  }
  return out;
 }

 /** The condition parsed with this scope's concepts. A fault only that parse finds, such as a listed input compared with a number, is a type mismatch. */
 private parsed(text: string, at: string, scope: Scope): Expr | undefined {
  const r = parseCondition(text, { concepts: this.concepts(scope) });
  if (r.ok) return r.value;
  this.say('type_mismatch', at, r.error.message, { offset: r.error.at }, scope);
  return undefined;
 }

 private tableBindings(scope: Scope & { table: SiteTable }): void {
  const { table, at } = scope.table, { site } = scope;
  this.shadowing(scope);
  if (table.on.for) {
   const t = site.bindings.get(table.on.for.binding);
   if (!t) this.say('unknown_binding_path', ptr(at, 'on', 'for', 'binding'), `${table.on.for.binding} is not a binding of ${site.label}.`, { binding: table.on.for.binding }, scope);
   else if (t && !(t.type === 'record' && t.record === '#work') && !(t.type === 'reference' && /^(object|execution|work)/.test(t.target)))
    this.say('type_mismatch', ptr(at, 'on', 'for', 'binding'), `A subscription is scoped to an object, execution or work reference; ${table.on.for.binding} is a ${show(t)}.`, { binding: table.on.for.binding }, scope);
  }
  for (const [name, decl] of Object.entries(table.inputs ?? {})) this.inputType(decl, ptr(at, 'inputs', name), scope, 'table');
  for (const [alias, target] of Object.entries(table.aliases ?? {}))
   if (!this.path(target, scope)) this.say('unknown_binding_path', ptr(at, 'aliases', alias), `Alias ${alias} names ${target}, which is not a declared path.`, { path: target }, scope);
  if (table.request) for (const part of ['fixed', 'collected'] as const) for (const [name, f] of Object.entries(table.request[part]))
   if (!this.target(f.target)) this.say('type_mismatch', ptr(at, 'request', part, name, 'target'), `${f.target} is not a reference kind, object type or task template of the catalog.`, { target: f.target }, scope);
  table.rules.forEach((r, ri) => {
   const rat = ptr(at, 'rules', ri), when = this.parsed(r.when, ptr(rat, 'when'), scope);
   if (when) this.typeCondition(when, ptr(rat, 'when'), scope);
   r.effects.forEach((e, ei) => {
    for (const [id, p] of effectReads(e, ptr(rat, 'effects', ei))) if (!r.effects.some(f => f.id === id))
     this.say('unknown_input_path', p, `No effect ${id} is staged earlier in rule ${r.id}.`, { effect: id }, scope);
    this.effectBindings(e, ptr(rat, 'effects', ei), scope);
   });
  });
 }

 /** A reference target: a catalog reference kind, object type, task work or typed order work. */
 private target(target: string): boolean {
  if (Object.hasOwn(this.catalog.references, target)) return true;
  const m = /^(object|work):(.+)$/.exec(target);
  return !!m && (m[1] === 'object' ? Object.hasOwn(this.catalog.objects, m[2])
   : !!this.workTemplate(m[2]) || (m[2].startsWith('order:') && Object.hasOwn(this.catalog.orders, m[2].slice('order:'.length))));
 }

 /** The one task template whose work a table hears: through its `on.work` handle or a `work:<template>` binding in `on.for`. */
 private subscribedTemplate(scope: Scope): string | undefined {
  const on = scope.table?.table.on;
  const name = on?.work ?? on?.for?.binding, t = name === undefined ? undefined : scope.site.bindings.get(name);
  return t?.type === 'reference' ? /^work:(.+)$/.exec(t.target)?.[1] : undefined;
 }

 /**
  * The type of `report.result.<field>` in a `not_authorized` handler: the result field of each task template whose
  * completion a table of this site hears with this table as its effective `not_authorized` handler. Every template that
  * declares the field must agree on one type; another template's report has no such field, so it is absent there.
  */
 private refusedResult(scope: Scope, field: string): FieldDecl | undefined {
  const handler = scope.table?.table.id;
  const types = scope.site.tables.filter(t => !t.shared && t.table.on.event === 'task.completed'
   && (t.table.fallback?.not_authorized ?? scope.site.fallback?.not_authorized ?? this.defs.fallback?.not_authorized) === handler)
   .map(t => this.subscribedTemplate({ site: scope.site, table: t }))
   .flatMap(template => { const r = template === undefined ? undefined : this.workTemplate(template)?.result; return r && Object.hasOwn(r, field) ? [r[field]] : []; });
  if (!types.length || !types.every(t => sameType(t.type, types[0].type))) return undefined;
  // A common type does not establish a common clinical term across different task results.
  return { type: types[0].type, ...(types[0].term && types.every(t => t.term === types[0].term) ? { term: types[0].term } : {}) };
 }

 /** The request contracts of the tables of this site whose failures, of any class, this table handles. */
 private failedRequest(scope: Scope): RequestContract[] {
  const handler = scope.table?.table.id;
  return scope.site.tables.filter(t => !t.shared && t.table.request && FAILURE_CLASSES.some(c => (t.table.fallback?.[c] ?? scope.site.fallback?.[c] ?? this.defs.fallback?.[c]) === handler))
   .map(t => t.table.request!);
 }

 /**
  * The type of `request.fixed.<field>` in a handler: the target of that fixed field in each served request contract.
  * Every contract that declares the field must agree on one target; a request of another table has no such field.
  */
 private failedRequestFixed(scope: Scope, field: string): TypeDescriptor | undefined {
  const targets = this.failedRequest(scope).flatMap(r => Object.hasOwn(r.fixed, field) ? [r.fixed[field].target] : []);
  return targets.length && targets.every(t => t === targets[0]) ? ty.ref(targets[0]) : undefined;
 }

 private descriptor(t: TypeDescriptor, at: string, scope?: Scope): void {
  if (t.type === 'quantity' && !unitDimension(t.unit)) this.say('incompatible_unit', ptr(at, 'unit'), `${t.unit} is not a unit of the pinned unit catalog.`, { unit: t.unit }, scope);
  if (t.type === 'reference' && !this.target(t.target)) this.say('type_mismatch', ptr(at, 'target'), `${t.target} is not a reference kind, object type or task template of the catalog.`, { target: t.target }, scope);
  if (t.type === 'listed' && (new Set(t.values).size !== t.values.length || t.values.some(x => x.trim() !== '' && Number.isFinite(Number(x)))))
   this.say('invalid_shape', ptr(at, 'values'), 'Listed values are distinct names, not numbers.', {}, scope);
  if (t.type === 'record' && !Object.hasOwn(this.records, t.record)) this.say('unresolved_record_contract', ptr(at, 'record'), `Record ${t.record} has no contract.`, { record: t.record }, scope);
  if (t.type === 'list') this.descriptor(t.items, ptr(at, 'items'), scope);
  if (t.type === 'window') this.descriptor(t.of, ptr(at, 'of'), scope);
 }

 /**
  * An input's effective type: the declared type, or the one its source supplies, which must agree. `entry` names are
  * declarations, so an entry input states its type. A control field read as optional information is refused.
  */
 private inputType(decl: InputDecl, at: string, scope: Scope, where: 'workflow' | 'policy' | 'table', report = true): Typed {
  const say = report ? (reason: V1Reason, p: string, m: string, d: Data = {}) => this.say(reason, p, m, d, scope) : () => {};
  if (report && decl.type) this.descriptor(decl.type, ptr(at, 'type'), scope);
  if (report && decl.required !== undefined) {
   const allowed = where === 'table' ? ['decision', 'optional'] : ['entry', 'optional'];
   if (!allowed.includes(decl.required)) say('invalid_shape', ptr(at, 'required'), `A ${where} input is ${allowed.join(' or ')}, not ${decl.required}.`, { value: decl.required });
  }
  const b = decl.binding;
  let source: TypeDescriptor | undefined, sourceTerm: string | undefined, known = true;
  if (typeof b === 'string') {
   if (b.startsWith('entry.')) {
    if (where === 'table') say('unknown_binding_path', ptr(at, 'binding'), 'entry is reserved for workflow entry declarations.', { path: b });
    known = false;
   } else {
    const p = this.path(b, scope);
    if (!p) { say('unknown_binding_path', ptr(at, 'binding'), `${b} is not a declared path.`, { path: b }); return {}; }
    source = p.type;
    sourceTerm = p.term;
    if (report && p.control && decl.required === 'optional')
     say('type_mismatch', ptr(at, 'required'), `${b} is the identity/control field ${p.control.field} of source ${p.control.source}; it is validated at ingress, never optional information.`, { source: p.control.source, field: p.control.field, role: 'control' });
   }
  } else if ('latest' in b || 'earliest' in b) {
   const kind = 'latest' in b ? b.latest : b.earliest, contract = Object.hasOwn(this.records, kind) && !kind.startsWith('#') ? this.records[kind] : undefined;
   if (!contract) { say('unknown_binding_path', ptr(at, 'binding', 'latest' in b ? 'latest' : 'earliest'), `${kind} is not a declared record.`, { record: kind }); return {}; }
   if (Object.hasOwn(this.catalog.records, kind)) this.contracts.add(`record:${kind}`);
   for (const key of ['of', 'in', 'before'] as const) {
    const p = b[key];
    if (p === undefined) continue;
    const t = scope.site.bindings.get(p) ?? this.path(p, scope)?.type;
    if (!t) say('unknown_binding_path', ptr(at, 'binding', key), `${p} is not a declared binding or path.`, { path: p });
    else if (key === 'before' && !TIME_TYPES.has(t.type)) say('type_mismatch', ptr(at, 'binding', key), `before reads an occurrence time; ${p} is a ${show(t)}.`, { path: p });
    else if (key === 'of' && !(t.type === 'reference' || t.type === 'identifier')) say('type_mismatch', ptr(at, 'binding', key), `of names a reference; ${p} is a ${show(t)}.`, { path: p });
   }
   if (b.field === undefined) source = { type: 'record', record: kind };
   else {
    const field = this.traverseDeclaration({ type: { type: 'record', record: kind } }, b.field.split('.'));
    source = field?.type;
    sourceTerm = field?.term;
    if (!source) { say('unknown_binding_path', ptr(at, 'binding', 'field'), `${b.field} is not a field of record ${kind}.`, { path: b.field }); return {}; }
   }
  } else if ('exists' in b) {
   source = ty.yesNo;
   if ('in' in b) {
    if (!Object.hasOwn(this.records, b.exists) || b.exists.startsWith('#')) say('unknown_binding_path', ptr(at, 'binding'), `${b.exists} is not a declared record.`, { record: b.exists });
   } else {
    const registry = Object.hasOwn(this.catalog.registries, b.exists) ? this.catalog.registries[b.exists] : undefined;
    if (!registry) say('unknown_binding_path', ptr(at, 'binding'), `${b.exists} is not a registry view of the catalog; an open-world record cannot prove absence.`, { registry: b.exists, problem: Object.hasOwn(this.records, b.exists) ? 'not a registry view' : 'undeclared registry view' });
    else if (!registry.completeness.trim()) say('unknown_binding_path', ptr(at, 'binding'), `Registry view ${b.exists} declares no completeness or freshness, so no match cannot mean no.`, { registry: b.exists, problem: 'no declared completeness' });
    else {
     this.contracts.add(`registry:${b.exists}`);
     const t = scope.site.bindings.get(b.of) ?? this.path(b.of, scope)?.type;
     if (!t) say('unknown_binding_path', ptr(at, 'binding', 'of'), `${b.of} is not a declared binding.`, { path: b.of });
     else if (!assignable(t, ty.ref(`object:${registry.of}`))) say('type_mismatch', ptr(at, 'binding'), `Registry view ${b.exists} is scoped to a ${registry.of}; ${b.of} is a ${show(t)}.`, { registry: b.exists, path: b.of });
    }
   }
  } else if ('unique' in b) {
   const registry = Object.hasOwn(this.catalog.registries, b.unique) ? this.catalog.registries[b.unique] : undefined;
   if (!registry) say('unknown_binding_path', ptr(at, 'binding'), `${b.unique} is not a registry view of the catalog.`, { registry: b.unique, problem: 'undeclared registry view' });
   else if (!registry.completeness.trim()) say('unknown_binding_path', ptr(at, 'binding'), `Registry view ${b.unique} declares no completeness or freshness.`, { registry: b.unique, problem: 'no declared completeness' });
   else if (!Object.hasOwn(this.catalog.objects, registry.record)) say('unknown_binding_path', ptr(at, 'binding'), `Registry view ${b.unique} does not return a catalog object kind.`, { registry: b.unique, problem: 'not an object kind' });
   else {
    this.contracts.add(`registry:${b.unique}`);
    source = ty.ref(`object:${registry.record}`);
    const t = scope.site.bindings.get(b.of) ?? this.path(b.of, scope)?.type;
    if (!t) say('unknown_binding_path', ptr(at, 'binding', 'of'), `${b.of} is not a declared binding.`, { path: b.of });
    else if (!assignable(t, ty.ref(`object:${registry.of}`))) say('type_mismatch', ptr(at, 'binding'), `Registry view ${b.unique} is scoped to a ${registry.of}; ${b.of} is a ${show(t)}.`, { registry: b.unique, path: b.of });
    if (!decl.type) say('input_without_type', at, `Unique registry input ${b.unique} needs an explicit object reference type.`, { registry: b.unique });
   }
  } else {
   const map = Object.hasOwn(this.defs.content ?? {}, b.content) ? this.defs.content![b.content] : undefined;
   if (!map) { say('unknown_binding_path', ptr(at, 'binding', 'content'), `${b.content} is not declared content.`, { content: b.content }); return { type: decl.type }; }
   const entries = 'entry' in b ? [b.entry] : Object.keys(map.entries);
   if ('entry' in b && !Object.hasOwn(map.entries, b.entry)) say('unknown_binding_path', ptr(at, 'binding', 'entry'), `${b.entry} is not an entry of ${b.content}.`, { entry: b.entry });
   else if (entries.some(k => !Object.hasOwn(map.entries[k], b.field))) say('unknown_binding_path', ptr(at, 'binding', 'field'), `Not every entry of ${b.content} has the field ${b.field}.`, { path: b.field });
   if ('key' in b) {
    const key = this.name(b.key, scope);
    if (!key) say('unknown_input_path', ptr(at, 'binding', 'key'), `${b.key} is not a declared input.`, { name: b.key });
    else if (map.key.type === 'listed') {
     const missing = map.key.values.filter(x => !Object.hasOwn(map.entries, x));
     if (missing.length) say('value_outside_declared_domain', ptr(at, 'binding', 'key'), `The key domain is not covered: ${missing.join(', ')} have no entry in ${b.content}.`, { missing });
    }
   }
   known = false;
  }
  if (decl.type && source && !assignable(source, decl.type))
   say('type_mismatch', ptr(at, 'type'), `The source is a ${show(source)}; the declaration says ${show(decl.type)}.`, { declared: show(decl.type), source: show(source) });
  const type = decl.type ?? source;
  if (report && decl.term && sourceTerm && decl.term !== sourceTerm)
   say('term_binding_conflict', ptr(at, 'term'), `The source is ${sourceTerm}; this input cannot relabel it as ${decl.term}.`, { source: sourceTerm, declared: decl.term });
  const term = decl.term ?? sourceTerm;
  if (report && term && source) this.termAnnotation({ ...decl, term }, source, at);
  if (report && sourceTerm && !decl.term && decl.type) this.termAnnotation({ ...decl, term }, decl.type, at);
  if (report && !decl.type && !term) this.termAnnotation(decl, type, at);
  if (!type && !known) say('input_without_type', at, 'This input has no declared type, and no source contract supplies one.', {});
  return { type, ...(term ? { term } : {}) };
 }

 /** A typed path: `event.…`, `this_execution.…`, or a binding, alias or declared name followed by declared fields. */
 private path(path: string, scope: Scope, aliased: ReadonlySet<string> = new Set()): { type: TypeDescriptor; term?: string; control?: { source: string; field: string } } | undefined {
  const segments = path.split('.'), [root, ...rest] = segments;
  const table = scope.table?.table;
  if (root === 'event') {
   const event = table?.on.event;
   if (!event) return undefined;
   if (path === 'event.payload') return Object.hasOwn(this.events, event) ? { type: ty.context } : undefined;
   // The reported work is a reference to the subscribed template's work: its captured content is read through it.
   const template = this.subscribedTemplate(scope), work = ty.ref(template ? `work:${template}` : 'work');
   if (rest[0] === 'work' && (rest.length === 1 || rest[1] === 'content')) return this.traverseDeclaration({ type: work }, rest.slice(1));
   const f = eventField({ ...this.catalog, events: this.events }, event, path);
   if (f.kind === 'undeclared') return undefined;
   if (f.kind === 'envelope') {
    const parts = f.field.split('.');
    for (let n = parts.length; n >= 1; n--) {
     const head = parts.slice(0, n).join('.');
     if (Object.hasOwn(ENVELOPE_TYPES, head)) { const type = this.traverse(ENVELOPE_TYPES[head], parts.slice(n)); return type ? { type } : undefined; }
    }
    return undefined;
   }
   const source = Object.entries(this.catalog.sources).find(([, s]) => s.event === event && Object.hasOwn(s.fields, f.field));
   const control = source && source[1].fields[f.field].role === 'control' ? { source: source[0], field: f.field } : undefined;
   let type: TypeDescriptor | undefined = f.type, annotation: { term?: string } = this.events[event].payload[f.field], more = f.rest?.split('.') ?? [], resultControl: { source: string; field: string } | undefined;
   if (event === 'decision.requested' && (f.field === 'fixed' || f.field === 'collected') && more.length && table?.on.table) {
    const target = scope.site.tables.find(t => t.table.id === table.on.table)?.table.request?.[f.field][more[0]]?.target;
    type = target ? ty.ref(target) : undefined;
    annotation = {};
    more = more.slice(1);
   }
   // A completion's result is typed by the template of the one kind of work the table hears; otherwise it has no fields.
   if (event === 'task.completed' && f.field === 'result' && more.length) {
    const results = template === undefined ? undefined : this.workTemplate(template)?.result, decl = results && Object.hasOwn(results, more[0]) ? results[more[0]] : undefined;
    type = decl?.type;
    annotation = decl ?? {};
    if (decl?.role === 'control') resultControl = { source: `task ${template} result`, field: more[0] };
    more = more.slice(1);
   }
   // A refused proposal: its authenticated actor, and a result field typed by the templates of the refused completions.
   if (event === 'evaluation.failed' && f.field === 'report' && more.length) {
    const [part, field] = more;
    const result = part === 'result' && field !== undefined ? this.refusedResult(scope, field) : undefined;
    type = part === 'actor' ? ty.ref('actor') : result?.type;
    annotation = result ?? {};
    more = more.slice(part === 'result' ? 2 : 1);
   }
   // The failed request: its verified decision actor and a fixed reference of the request contracts the handler serves.
   if (event === 'evaluation.failed' && f.field === 'request' && more.length) {
    const [part, field] = more;
    type = part === 'actor' && more.length === 1 ? this.failedRequest(scope).length ? ty.ref('actor') : undefined
     : part === 'fixed' && field !== undefined ? this.failedRequestFixed(scope, field) : undefined;
    annotation = {};
    more = more.slice(part === 'fixed' ? 2 : 1);
   }
   const field = type && this.traverseDeclaration({ type, ...annotation }, more);
   const ctl = control ?? resultControl;
   return field ? { type: field.type, ...(field.term ? { term: field.term } : {}), ...(ctl ? { control: ctl } : {}) } : undefined;
  }
  if (root === 'this_execution') {
   if (!rest.length) return { type: ty.ref('execution') };
   const [field, ...more] = rest;
   if (field === 'requests') {
    const t = more.length === 1 && scope.site.tables.some(x => x.table.id === more[0] && x.table.request);
    return t ? { type: ty.ref('event') } : undefined;
   }
   const fields: Record<string, TypeDescriptor> = { id: ty.id, content: ty.ref('content'), workflow: ty.id, state: ty.id, activation: ty.id, ...(scope.site.subject ? { subject: ty.ref(`object:${scope.site.subject}`) } : {}) };
   return Object.hasOwn(fields, field) ? this.traverseDeclaration({ type: fields[field] }, more) : undefined;
  }
  for (let n = segments.length; n >= 1; n--) {
   const head = segments.slice(0, n).join('.'), tail = segments.slice(n);
   const alias = table?.aliases && Object.hasOwn(table.aliases, head) ? table.aliases[head] : undefined;
   if (alias !== undefined) return aliased.has(head) ? undefined : this.path([alias, ...tail].join('.'), scope, new Set([...aliased, head]));
   const bound = scope.site.bindings.get(head);
   const declared = !bound && n < segments.length ? this.name(head, scope) : undefined;
   const base = bound ?? declared?.type;
   // An unstructured prefix (such as `failure.report`), or a name read through an alias (such as the identifier
   // `failure.request`), may lack the field; a shorter prefix or the alias, as the runtime reads it, may still type the path.
   if (base) { const field = this.traverseDeclaration({ type: base, ...(declared?.term ? { term: declared.term } : {}) }, tail); if (field || (bound && base.type !== 'context')) return field; }
  }
  return undefined;
 }

 /** Follow declared fields only: reference fields and the catalog object's fields, record fields, a window's bounds. */
 private traverse(type: TypeDescriptor | undefined, segments: readonly string[]): TypeDescriptor | undefined {
  return type && this.traverseDeclaration({ type }, segments)?.type;
 }

 private traverseDeclaration(decl: FieldDecl, segments: readonly string[]): FieldDecl | undefined {
  let field: FieldDecl | undefined = decl;
  for (const s of segments) {
   const t: TypeDescriptor | undefined = field?.type;
   if (!t) return undefined;
   if (t.type === 'reference') {
    const [kind, ...parts]: string[] = t.target.split(':'), object = parts.join(':');
    const own: TypeDescriptor | undefined = REFERENCE_FIELD_TYPES[`${kind}.${s}`];
    // A work reference exposes the work projection, like a bound handle; a `work:<template>` one also its captured content.
    const content: Record<string, FieldDecl> = kind === 'work' && object && Object.hasOwn(this.records, `#content:${object}`) ? { content: { type: { type: 'record', record: `#content:${object}` } } } : {};
    const objectFields: Readonly<Record<string, FieldDecl>> = kind === 'work' ? { ...WORK_HANDLE.fields, ...content } : object && Object.hasOwn(this.catalog.objects, object) ? this.catalog.objects[object].fields : {};
    field = own ? { type: own } : Object.hasOwn(objectFields, s) ? objectFields[s] : undefined;
   } else if (t.type === 'record') {
    const fields = Object.hasOwn(this.records, t.record) ? this.records[t.record].fields : {};
    field = Object.hasOwn(fields, s) ? fields[s] : undefined;
   } else if (t.type === 'window') field = s === 'min' || s === 'max' ? { type: t.of } : undefined;
   else return undefined;
  }
  return field;
 }

 /** A declared name: table input, site input or calculation, shared input or calculation, or parameter; else a typed path. */
 private name(name: string, scope: Scope): Typed | undefined {
  const key = `${scope.site.id}\u0000${scope.table?.at ?? ''}\u0000${name}`;
  if (this.resolving.has(key)) return {}; // a binding path through its own name: reported where it is declared
  this.resolving.add(key);
  try { return this.declared(name, scope); } finally { this.resolving.delete(key); }
 }

 private declared(name: string, scope: Scope): Typed | undefined {
  const table = scope.table?.table, { site } = scope;
  if (table?.inputs && Object.hasOwn(table.inputs, name)) return this.inputType(table.inputs[name], '', scope, 'table', false);
  if (Object.hasOwn(site.inputs, name)) return this.inputType(site.inputs[name], '', scope, site.kind === 'workflow' ? 'workflow' : 'policy', false);
  if (Object.hasOwn(site.calculations, name)) return this.calculationType(name, site.calculations[name], '', scope, false);
  const defs = this.defs;
  if (defs.inputs && Object.hasOwn(defs.inputs, name)) return this.inputType(defs.inputs[name], '', scope, 'table', false);
  if (defs.calculations && Object.hasOwn(defs.calculations, name)) return this.calculationType(name, defs.calculations[name], '', scope, false);
  if (defs.parameters && Object.hasOwn(defs.parameters, name)) return { type: defs.parameters[name].type };
  const p = name.includes('.') || name === 'this_execution' ? this.path(name, scope) : scope.site.bindings.has(name) ? { type: scope.site.bindings.get(name)! } : undefined;
  return p;
 }

 /**
  * The calculations a table's conditions read, directly or through other calculations; with `values`, also those its
  * effect values read. Each is checked in that table's scope.
  */
 private calculationsRead(table: Table, site: Site, values = false): string[] {
  const calcs = { ...this.defs.calculations, ...site.calculations };
  const todo = values ? tableNamesRead(table) : table.rules.flatMap(r => [r.when, ...r.effects.flatMap(e => e.when === undefined ? [] : [e.when])])
   .flatMap(text => { const p = parseCondition(text); return p.ok ? conditionNames(p.value) : []; });
  const seen = new Set<string>();
  for (let n; (n = todo.pop()) !== undefined;) if (Object.hasOwn(calcs, n) && !(table.inputs && Object.hasOwn(table.inputs, n)) && !seen.has(n)) { seen.add(n); todo.push(...calculationNamesRead(calcs[n])); }
  return [...seen];
 }

 private calculationAt(name: string, scope: Scope): void {
  const { site } = scope, own = Object.hasOwn(site.calculations, name);
  const c = own ? site.calculations[name] : this.defs.calculations?.[name];
  if (c) this.calculationType(name, c, own ? ptr(site.at, 'calculations', name) : ptr('', 'definitions', 'calculations', name), scope, true);
 }

 private calculationCycles(): void {
  const groups: [Readonly<Record<string, Calculation>>, string][] = [
   [this.defs.calculations ?? {}, ptr('', 'definitions', 'calculations')],
   ...this.doc.workflows.map((w, i): [Readonly<Record<string, Calculation>>, string] => [{ ...this.defs.calculations, ...w.calculations }, ptr('', 'workflows', i, 'calculations')]),
  ];
  for (const [calcs, at] of groups) {
   const edges = new Map(Object.entries(calcs).map(([n, c]) => [n, calculationNamesRead(c).filter(x => Object.hasOwn(calcs, x))]));
   const reach = (from: string): Set<string> => { const seen = new Set<string>(), todo = [...edges.get(from) ?? []]; for (let x; (x = todo.pop()) !== undefined;) if (!seen.has(x)) { seen.add(x); todo.push(...edges.get(x) ?? []); } return seen; };
   for (const name of edges.keys()) {
    if (!reach(name).has(name)) continue;
    const cycle = sorted([...edges.keys()].filter(m => reach(name).has(m) && reach(m).has(name)));
    const own = at.startsWith('/definitions') || (this.doc.workflows[Number(at.split('/')[2])]?.calculations ?? {})[name] !== undefined;
    if (own) this.say('calculation_cycle', ptr(at, name), `Calculation ${name} depends on itself through ${cycle.join(', ')}; name the intermediate results without a cycle.`, { cycle });
   }
  }
 }

 private calculationType(name: string, c: Calculation, at: string, scope: Scope, report: boolean): Typed {
  const key = `${scope.site.id}\u0000${scope.table?.at ?? ''}\u0000${name}`;
  if (this.calcStack.has(key)) return {};
  this.calcStack.add(key);
  try {
   const op = (o: Operand, p: string): TypeDescriptor | undefined => {
    if ('value' in o) return this.literalType(o.value);
    const t = this.name(o.input, scope);
    if (!t && report) this.say('unknown_input_path', ptr(p, 'input'), `${o.input} is not a declared input, calculation or path.`, { name: o.input }, scope);
    return t?.type;
   };
   const cond = (text: string, p: string) => { if (report && this.condition(text, p, scope, false)) { const e = this.parsed(text, p, scope); if (e) this.typeCondition(e, p, scope); } };
   const quantities = (ops: readonly Operand[], p: string, what: string): TypeDescriptor | undefined => {
    const types = ops.map((o, i) => op(o, ptr(p, i)));
    if (types.some(t => !t)) return undefined;
    const q = types as TypeDescriptor[];
    if (q.some(t => t.type !== 'quantity') || new Set(q.map(t => unitDimension((t as { unit: string }).unit))).size > 1) {
     if (report) this.say('incompatible_unit', p, `${what} takes quantities of one dimension.`, { types: q.map(show) }, scope);
     return undefined;
    }
    return q[0];
   };
   if ('when' in c) { cond(c.when, ptr(at, 'when')); return { type: ty.yesNo }; }
   if ('cases' in c) {
    const types = c.cases.map((k, i) => { cond(k.when, ptr(at, 'cases', i, 'when')); return op(k.value, ptr(at, 'cases', i, 'value')); });
    const first = types.find(Boolean);
    if (first && types.some(t => t && !assignable(t, first) && !assignable(first, t)) && report) this.say('type_mismatch', ptr(at, 'cases'), 'Every case gives a value of one type.', { types: types.map(t => t ? show(t) : '?') }, scope);
    return { type: first };
   }
   if ('min' in c) return { type: quantities(c.min, ptr(at, 'min'), 'min') };
   if ('change_percent' in c) { quantities([c.change_percent.from, c.change_percent.to], ptr(at, 'change_percent'), 'change_percent'); return { type: { type: 'quantity', unit: '%' } }; }
   if ('elapsed' in c) {
    let needsCalendarZone = false;
    for (const end of ['from', 'to'] as const) {
     const t = op(c.elapsed[end], ptr(at, 'elapsed', end));
     if (t && !TIME_TYPES.has(t.type) && report) this.say('type_mismatch', ptr(at, 'elapsed', end), `elapsed counts between times; this is a ${show(t)}.`, {}, scope);
     else if (t && c.elapsed.basis === 'duration' && t.type !== 'instant' && report) this.say('type_mismatch', ptr(at, 'elapsed', end), 'A duration elapsed calculation needs instant endpoints.', { actual: show(t) }, scope);
     if (t?.type === 'instant' || t?.type === 'time') needsCalendarZone = true;
    }
    if (report && !(c.elapsed.basis === 'duration' ? FIXED_TIME_UNITS : CALENDAR_TIME_UNITS).has(c.elapsed.unit))
     this.say('incompatible_unit', ptr(at, 'elapsed', 'unit'), `A ${c.elapsed.basis} elapsed calculation uses ${c.elapsed.basis === 'duration' ? 'fixed units (s, min, h, d, wk)' : 'calendar units (d, wk, mo, a)'}.`, { unit: c.elapsed.unit, basis: c.elapsed.basis }, scope);
    if (report && c.elapsed.basis === 'calendar' && needsCalendarZone && !c.elapsed.dates_in)
     this.say('type_mismatch', ptr(at, 'elapsed', 'dates_in'), 'Calendar elapsed converts an instant to a date only in an explicit IANA zone.', {}, scope);
    if (report && c.elapsed.dates_in && !validTimeZone(c.elapsed.dates_in))
     this.say('value_outside_declared_domain', ptr(at, 'elapsed', 'dates_in'), `${c.elapsed.dates_in} is not an IANA time zone.`, { zone: c.elapsed.dates_in }, scope);
    return { type: { type: 'quantity', unit: c.elapsed.unit } };
   }
   if ('all_completed' in c) {
    if (!c.all_completed.length && report) this.say('invalid_shape', ptr(at, 'all_completed'), 'all_completed names at least one work reference; an empty join is never complete.', {}, scope);
    c.all_completed.forEach((o, i) => { const t = op(o, ptr(at, 'all_completed', i)); if (t && !assignable(t, ty.ref('work')) && !(t.type === 'record' && t.record === '#work') && report) this.say('type_mismatch', ptr(at, 'all_completed', i), `all_completed takes work references; this is a ${show(t)}.`, {}, scope); });
    return { type: ty.yesNo };
   }
   if (c.multiply.length !== 2) { if (report) this.say('invalid_shape', ptr(at, 'multiply'), 'multiply takes exactly two operands: a rate and a quantity.', {}, scope); return {}; }
   const [a, b] = c.multiply.map((o, i) => op(o, ptr(at, 'multiply', i)));
   if (!a || !b) return {};
   if (NUMERIC_TYPES.has(a.type) && b.type === 'quantity') return { type: b };
   if (a.type === 'quantity' && b.type === 'quantity') {
    const m = /^(.*)\/([^/]+)$/.exec(a.unit);
    if (m && unitDimension(m[2]) && unitDimension(m[2]) === unitDimension(b.unit)) return { type: m[1] ? { type: 'quantity', unit: m[1] } : { type: 'count' } };
   }
   if (report) this.say('incompatible_unit', ptr(at, 'multiply'), `${show(a)} times ${show(b)} does not cancel a denominator unit.`, { types: [show(a), show(b)] }, scope);
   return {};
  } finally { this.calcStack.delete(key); }
 }

 private literalType(v: JsonValue): TypeDescriptor | undefined {
  if (typeof v === 'boolean') return ty.yesNo;
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? { type: 'count' } : { type: 'number' };
  if (typeof v === 'string') return ty.id;
  if (isObj(v) && typeof v.value === 'number' && typeof v.unit === 'string' && Object.keys(v).length === 2) return { type: 'quantity', unit: v.unit };
  return undefined;
 }

 /** A literal against its declared type: domain, unit, format and shape. `{none: reason}` stands only where the declaration permits it. */
 private literal(v: JsonValue, t: TypeDescriptor, at: string, scope?: Scope, none = false): void {
  const bad = (reason: V1Reason, message: string, data: Data = {}) => this.say(reason, at, message, data, scope);
  if (isObj(v) && Object.keys(v).length === 1 && typeof v.none === 'string') {
   if (!none) bad('value_outside_declared_domain', 'A known absence {none: reason} is allowed only where the field declares none.', { none: v.none });
   return;
  }
  switch (t.type) {
   case 'listed': if (typeof v !== 'string') return bad('type_mismatch', `Expected one of ${t.values.join(', ')}.`); if (!t.values.includes(v)) bad('value_outside_declared_domain', `${v} is not one of ${t.values.join(', ')}.`, { value: v }); return;
   case 'yes_no': if (typeof v !== 'boolean' && v !== 'yes' && v !== 'no') bad('type_mismatch', 'Expected yes or no.'); return;
   case 'count': if (!(typeof v === 'number' && Number.isInteger(v) && v >= 0)) bad('type_mismatch', 'Expected a whole number of 0 or more.'); return;
   case 'number': if (typeof v !== 'number') bad('type_mismatch', 'Expected a number.'); return;
   case 'quantity': {
    const q = this.literalType(v);
    if (q?.type !== 'quantity') return bad('type_mismatch', `Expected a quantity in ${t.unit}, written {value, unit}.`);
    if (unitDimension(q.unit) !== unitDimension(t.unit)) bad('incompatible_unit', `${q.unit} does not measure what ${t.unit} measures.`, { declared_unit: t.unit, unit: q.unit });
    return;
   }
   case 'identifier': case 'revision': case 'text': if (typeof v !== 'string') bad('type_mismatch', `Expected a ${t.type} string.`); return;
   case 'date': case 'datetime': case 'time': case 'instant':
    if (typeof v !== 'string') return bad('type_mismatch', `Expected a ${t.type} string.`);
    if (!timeLiteral(t.type, v)) bad('value_outside_declared_domain', `${v} is not a ${t.type}: ${TIME_FORMATS[t.type]}.`, { value: v });
    return;
   case 'list': if (!Array.isArray(v)) return bad('type_mismatch', 'Expected a list.'); v.forEach((x, i) => this.literal(x, t.items, ptr(at, i), scope)); return;
   case 'reference': case 'record': case 'window': if (!isObj(v)) bad('type_mismatch', `Expected a ${show(t)}, not a scalar.`); return;
   default: return;
  }
 }

 /** Level 2 on a parsed condition: every name resolves; each comparison is between compatible types. */
 private typeCondition(e: Expr, at: string, scope: Scope): void {
  const say = (reason: V1Reason, x: Expr, message: string, data: Data = {}) => this.say(reason, at, message, { offset: x.at, ...data }, scope);
  const typeOf = (x: Expr & { kind: 'name' }): TypeDescriptor | undefined => {
   const t = this.name(x.name, scope);
   if (!t) { say('unknown_input_path', x, `${x.name} is not a declared input, calculation, parameter or path.`, { name: x.name }); return undefined; }
   if (t.type && containsUnstructured(t.type)) { say('unstructured_context_in_condition', x, `${x.name} contains unstructured ${show(t.type)}; carry it into a record or review, never into a condition.`, { name: x.name }); return undefined; }
   return t.type;
  };
  const truth = (x: Expr): void => {
   if (x.kind === 'name') { const t = typeOf(x); if (t && t.type !== 'yes_no') say('type_mismatch', x, `${x.name} is a ${show(t)}, not a yes/no condition.`, { name: x.name }); return; }
   if (x.kind === 'and' || x.kind === 'or') return x.args.forEach(truth);
   if (x.kind === 'not') return truth(x.arg);
   if (x.kind === 'compare') return compare(x);
   if (x.kind === 'call') {
    // Presence is still a condition read: free-text context cannot steer a row through known/unknown.
    if (['known', 'unknown', 'any_unknown'].includes(x.fn)) return x.args.forEach(a => { if (a.kind === 'name') typeOf(a); });
    if (x.fn === 'any' || x.fn === 'all') return x.args.forEach(truth);
    if (x.fn === 'includes' && x.args[0].kind === 'name') {
     const t = typeOf(x.args[0]), member = x.args[1];
     if (t && t.type !== 'list') return say('type_mismatch', x.args[0], `includes() reads a list; ${x.args[0].name} is a ${show(t)}.`, { name: x.args[0].name });
     if (t?.type === 'list' && t.items.type === 'listed' && (member.kind === 'word' || member.kind === 'string') && !t.items.values.includes(member.value))
      say('value_outside_declared_domain', member, `${member.value} is not one of ${t.items.values.join(', ')}.`, { value: member.value });
     const blocking = this.blockingInputs(x.args[0].name, scope);
     if (blocking && (member.kind === 'word' || member.kind === 'string') && !blocking.has(member.value))
      say('value_outside_declared_domain', member, `${member.value} is not an input or calculation name of a table whose unresolved outcome this handler takes.`, { value: member.value });
     return;
    }
    return say('history_query_in_rule_condition', x, `${x.fn}() is not a rule condition function.`, { function: x.fn });
   }
  };
  const literalFits = (t: TypeDescriptor, x: Expr, name: Expr): void => {
   const mismatch = (detail: string) => say('type_mismatch', x, `${printCondition(name)} is a ${show(t)}; ${detail}`, {});
   switch (t.type) {
    case 'quantity':
     if (x.kind !== 'number' || x.unit === undefined) return mismatch(x.kind === 'number' ? 'a v1 quantity literal carries its unit.' : `${printCondition(x)} is not a quantity.`);
     if (unitDimension(x.unit) !== unitDimension(t.unit)) say('incompatible_unit', x, `${x.unit} does not measure what ${t.unit} measures.`, { declared_unit: t.unit, unit: x.unit });
     return;
    case 'count': case 'number': if (x.kind !== 'number' || x.unit !== undefined) mismatch(`${printCondition(x)} is not a plain number.`); return;
    case 'yes_no':
     if (x.kind === 'boolean') return;
     if (x.kind === 'word') { if (x.value !== 'yes' && x.value !== 'no') say('value_outside_declared_domain', x, `${x.value} is not yes or no.`, { value: x.value }); return; }
     return mismatch(`${printCondition(x)} is not yes or no.`);
    case 'listed':
     if (x.kind === 'word') { if (!t.values.includes(x.value)) say('value_outside_declared_domain', x, `${x.value} is not one of ${t.values.join(', ')}.`, { value: x.value }); return; }
     return mismatch(`${printCondition(x)} is not one of its listed values.`);
    case 'identifier': case 'revision': if (x.kind !== 'word' && x.kind !== 'string') mismatch(`${printCondition(x)} is not an identifier.`); return;
    case 'date': case 'datetime': case 'time': case 'instant':
     if (x.kind !== 'string') return mismatch(`${printCondition(x)} is not a ${t.type} string.`);
     if (!timeLiteral(t.type, x.value)) say('value_outside_declared_domain', x, `${x.value} is not a ${t.type}: ${TIME_FORMATS[t.type]}.`, { value: x.value });
     return;
    default: return mismatch('it cannot be compared with a literal.');
   }
  };
  const ordered = (t: TypeDescriptor) => NUMERIC_TYPES.has(t.type) || t.type === 'quantity' || (t.type === 'listed' && t.ordered === true);
  const compare = (x: Expr & { kind: 'compare' }): void => {
   const sides = [x.left, x.right].map(s => s.kind === 'name' ? { s, t: typeOf(s), named: true } : { s, t: undefined, named: false });
   if (sides.some(s => s.named && !s.t)) return;
   const [l, r] = sides;
   if (!l.named && !r.named) return say('type_mismatch', x, 'A comparison needs a declared input on at least one side.', {});
   if (l.named && r.named) {
    const a = l.t!, b = r.t!;
    if (a.type === 'quantity' && b.type === 'quantity' && unitDimension(a.unit) !== unitDimension(b.unit)) return say('incompatible_unit', x, `${a.unit} and ${b.unit} measure different things.`, { declared_unit: a.unit, unit: b.unit });
    if (!assignable(a, b) && !assignable(b, a)) return say('type_mismatch', x, `${printCondition(x.left)} is a ${show(a)} and ${printCondition(x.right)} is a ${show(b)}.`, {});
   } else {
    const [n, lit] = l.named ? [l, r] : [r, l];
    literalFits(n.t!, lit.s, n.s);
   }
   const t = (l.t ?? r.t)!;
   if (!['==', '!='].includes(x.op) && !ordered(t)) say('type_mismatch', x, TIME_TYPES.has(t.type)
    ? `${show(t)} values do not support ${x.op} in a condition. Use an elapsed calculation and compare its quantity. For dates, use basis: "calendar".`
    : `${show(t)} values have equality only, not ${x.op}.`, {});
  };
  truth(e);
 }

 /**
  * When `list` is the failure payload's `unknown_inputs` in a handler table, its item domain at this use site: the
  * input and calculation names declared for each table of the site whose unresolved outcome the handler takes.
  */
 private blockingInputs(list: string, scope: Scope): Set<string> | undefined {
  const { site } = scope, table = scope.table?.table, defs = this.defs;
  if (table?.on.event !== 'evaluation.failed') return undefined;
  const expand = (path: string, seen: ReadonlySet<string>): string => {
   const segments = path.split('.');
   if (table.inputs && Object.hasOwn(table.inputs, path) && typeof table.inputs[path].binding === 'string' && !seen.has(path))
    return expand(table.inputs[path].binding as string, new Set([...seen, path]));
   for (let n = segments.length; n >= 1; n--) {
    const head = segments.slice(0, n).join('.');
    if (table.aliases && Object.hasOwn(table.aliases, head) && !seen.has(head)) return expand([table.aliases[head], ...segments.slice(n)].join('.'), new Set([...seen, head]));
   }
   return path;
  };
  if (expand(list, new Set()) !== 'event.payload.unknown_inputs') return undefined;
  const served = site.tables.filter(t => t.table.on.event !== 'evaluation.failed' && (t.table.fallback?.unresolved ?? site.fallback?.unresolved ?? defs.fallback?.unresolved) === table.id);
  if (!served.length) return undefined;
  return new Set([...served.flatMap(t => Object.keys(t.table.inputs ?? {})), ...Object.keys(site.inputs), ...Object.keys(site.calculations),
   ...Object.keys(defs.inputs ?? {}), ...Object.keys(defs.calculations ?? {})]);
 }

 /** A value template's type where it has one; every name it reads must resolve. */
 private value(v: unknown, at: string, scope: Scope): TypeDescriptor | undefined {
  if (Array.isArray(v)) { v.forEach((x, i) => this.value(x, ptr(at, i), scope)); return undefined; }
  if (!isObj(v)) return v === undefined || v === null ? undefined : this.literalType(v as JsonValue);
  const keys = Object.keys(v);
  if (keys.length === 1 && typeof v.input === 'string') {
   const t = this.name(v.input, scope);
   if (!t) this.say('unknown_input_path', ptr(at, 'input'), `${v.input} is not a declared input, calculation, parameter or path.`, { name: v.input }, scope);
   return t?.type;
  }
  if (keys.length === 1 && typeof v.binding === 'string') {
   const t = scope.site.bindings.get(v.binding);
   if (!t) this.say('unknown_binding_path', ptr(at, 'binding'), `${v.binding} is not a binding or work handle of ${scope.site.label}.`, { binding: v.binding }, scope);
   return t;
  }
  if (keys.length === 1 && 'value' in v) return this.literalType(v.value as JsonValue);
  if (keys.length === 1 && 'effect' in v) return undefined;
  for (const [k, x] of Object.entries(v)) this.value(x, ptr(at, k), scope);
  return undefined;
 }

 private effectBindings(e: Effect, at: string, scope: Scope): void {
  const say = (reason: V1Reason, p: string, m: string, d: Data = {}) => this.say(reason, p, m, d, scope);
  if (e.when !== undefined) { const when = this.parsed(e.when, ptr(at, 'when'), scope); if (when) this.typeCondition(when, ptr(at, 'when'), scope); }
  if (e.decision && 'record' in e.decision) this.value(e.decision.record, ptr(at, 'decision', 'record'), scope);
  const reference = (v: unknown, p: string, to: TypeDescriptor, what: string) => {
   const t = this.value(v, p, scope);
   if (t && !assignable(t, to)) say('type_mismatch', p, `${what} is a ${show(to)}; this value is a ${show(t)}.`, { expected: show(to), actual: show(t) });
   return t;
  };
  for (const f of ['owner', 'performer'] as const) {
   const o = (e as { owner?: unknown; performer?: unknown })[f];
   if (isObj(o) && typeof o.binding === 'string') reference({ binding: o.binding }, ptr(at, f), ty.ref('owner'), `The ${f}`);
  }
  if ('due' in e && e.due) this.due(e.due, ptr(at, 'due'), scope);
  const work = assignedHandle(e), bound = work && scope.site.bindings.get(work.name);
  if (work && bound && !sameType(bound, work.type))
   say('type_mismatch', 'reissue' in e ? ptr(at, 'reissue', 'handle') : ptr(at, 'as', ...(typeof (e as { as?: unknown }).as === 'string' ? [] : ['handle'])), `Work handle ${work.name} already holds a ${show(bound)}; this ${e.kind} would make it a ${show(work.type)}. One handle has one kind of work.`, { handle: work.name, expected: show(bound), actual: show(work.type) });
  if ('occurrence' in e && e.occurrence !== undefined) this.value(e.occurrence, ptr(at, 'occurrence'), scope);
  switch (e.kind) {
   case 'record': {
    const c = Object.hasOwn(this.records, e.record) ? this.records[e.record] : undefined;
    this.fields(e.fields, c?.fields, ptr(at, 'fields'), scope, `record ${e.record}`);
    if (e.for !== undefined) reference(e.for, ptr(at, 'for'), ty.ref(c?.subject ? `object:${c.subject}` : 'object'), 'A record is for');
    else if (c?.subject) say('type_mismatch', at, `Record ${e.record} has a ${c.subject} subject; say which one with for.`, { missing: 'for' });
    return;
   }
   case 'emit': {
    const c = Object.hasOwn(this.events, e.event) ? this.events[e.event] : undefined;
    this.fields(e.fields, c?.payload, ptr(at, 'fields'), scope, `event ${e.event}`);
    const table = e.event === 'decision.requested' ? requestTableName(e) : undefined, contract = table === undefined ? undefined : this.requestContract(table, scope.site);
    if (contract) for (const part of ['fixed', 'collected'] as const) {
     const v = e.fields[part], p = ptr(at, 'fields', part);
     if (v === undefined) continue;
     if (!isObj(v) || (Object.keys(v).length === 1 && ['input', 'binding', 'effect', 'value'].includes(Object.keys(v)[0])))
      { say('type_mismatch', p, `The ${part} references of a request to ${table} are a map of its declared ${part} fields.`, { contract: `request of table ${table}` }); continue; }
     const decls = Object.fromEntries(Object.entries(contract[part]).map(([k, f]): [string, FieldDecl] => [k, { type: ty.ref(f.target), ...('optional' in f && f.optional ? { optional: true } : {}) }]));
     this.fields(v as Readonly<Record<string, ValueTemplate>>, decls, p, scope, `the ${part} request of table ${table}`);
    }
    if (e.for !== undefined) reference(e.for, ptr(at, 'for'), ty.ref('object'), 'An event is for');
    if (e.to !== undefined) this.value(e.to, ptr(at, 'to'), scope);
    if (e.for === undefined && e.to === undefined) say('invalid_shape', at, 'An emit names its subject with for, or its target with to.', { field: 'for' });
    return;
   }
   case 'task': {
    const t = this.workTemplate(e.task);
    // A reissue's content names overrides only; the completed task supplies every other field.
    if ('reissue' in e) { if (e.content) this.fields(e.content, t?.content ?? {}, ptr(at, 'content'), scope, `task ${e.task}`, false); return; }
    reference(e.for, ptr(at, 'for'), ty.ref('object'), 'A task is for');
    if (e.content) this.fields(e.content, t?.content ?? {}, ptr(at, 'content'), scope, `task ${e.task}`);
    return;
   }
   case 'order':
    reference(e.for, ptr(at, 'for'), ty.ref('object'), 'An order is for');
    this.fields(e.content, this.catalog.orders[e.order].content, ptr(at, 'content'), scope, `${e.order} order`);
    {
     const seen = new Set<string>();
     for (const [i, limit] of (e.limits ?? []).entries()) {
      const lat = ptr(at, 'limits', i), field = this.catalog.orders[e.order].content[limit.field];
      if (seen.has(limit.field)) say('duplicate_id', ptr(lat, 'field'), `An order field has one maximum limit; ${limit.field} is repeated.`, { field: limit.field });
      seen.add(limit.field);
      if (!Object.hasOwn(e.content, limit.field) || field?.type.type !== 'quantity')
       say('type_mismatch', ptr(lat, 'field'), `${limit.field} must be a quantity field in the order's captured content.`, { field: limit.field });
      const maximum = this.value(limit.maximum, ptr(lat, 'maximum'), scope);
      if (maximum && field?.type.type === 'quantity' && !assignable(maximum, field.type))
       say('type_mismatch', ptr(lat, 'maximum'), `The maximum for ${limit.field} must be ${show(field.type)}, not ${show(maximum)}.`, { field: limit.field, expected: show(field.type), actual: show(maximum) });
     }
    }
    return;
   case 'publish': {
    this.value(e.record, ptr(at, 'record'), scope);
    const destination = this.value(e.to, ptr(at, 'to'), scope);
    if (e.policy === undefined && (!destination || !assignable(destination, ty.ref('owner'))))
     say('type_mismatch', ptr(at, 'to'), 'A publication without a policy is an owner notice; its destination must be a typed owner reference.', { expected: 'owner' });
    return;
   }
   case 'start': return this.startBindings(e, at, scope);
   case 'change_work': {
    const w = e.work;
    if (isObj(w) && 'handle' in w) { if (w.occurrence !== undefined) this.value(w.occurrence, ptr(at, 'work', 'occurrence'), scope); }
    else { const t = this.value(w, ptr(at, 'work'), scope); if (t && !(t.type === 'record' && t.record === '#work') && !assignable(t, ty.ref('work'))) say('type_mismatch', ptr(at, 'work'), `change_work names work; this value is a ${show(t)}.`, {}); }
    reference(e.expected_revision, ptr(at, 'expected_revision'), ty.rev, 'The expected revision');
    if (e.operation === 'reschedule') this.due(e.due, ptr(at, 'due'), scope);
    if (e.operation === 'rebind') {
     if (!Object.keys(e.set).length) say('invalid_shape', ptr(at, 'set'), 'rebind changes at least one of subject, anchor, owner, lifetime or purpose.', {});
     for (const [k, x] of Object.entries(e.set)) this.value(x, ptr(at, 'set', k), scope);
     if (e.due) this.due(e.due, ptr(at, 'due'), scope);
     if (e.set.owner !== undefined && e.acceptance === undefined) say('invalid_shape', at, 'A change of owner cites the acceptance of that exact scope.', { field: 'acceptance' });
     if ((e.set.anchor !== undefined || e.set.subject !== undefined) && e.replacement === undefined) say('invalid_shape', at, 'A change of anchor or subject cites its replacement evidence.', { field: 'replacement' });
     for (const k of ['acceptance', 'replacement'] as const) if (e[k] !== undefined) this.value(e[k], ptr(at, k), scope);
    }
    if (e.operation === 'satisfy') this.value(e.evidence, ptr(at, 'evidence'), scope);
    if (e.operation === 'cancel') this.value(e.reason, ptr(at, 'reason'), scope);
    if (e.operation === 'retry') this.value(e.attempt, ptr(at, 'attempt'), scope);
    return;
   }
  }
 }

 private due(d: Due, at: string, scope: Scope): void {
  if (d.basis === 'calendar' && !d.zone) this.say('type_mismatch', ptr(at, 'zone'), 'A calendar due names the IANA zone used for calendar arithmetic.', {}, scope);
  if (d.zone && !validTimeZone(d.zone)) this.say('value_outside_declared_domain', ptr(at, 'zone'), `${d.zone} is not an IANA time zone.`, { zone: d.zone }, scope);
  if ('input' in d.from) {
   const t = this.name(d.from.input, scope);
   if (!t) this.say('unknown_input_path', ptr(at, 'from', 'input'), `${d.from.input} is not a declared input, calculation or path.`, { name: d.from.input }, scope);
   else if (t.type && !TIME_TYPES.has(t.type.type)) this.say('type_mismatch', ptr(at, 'from', 'input'), `A due anchor is a time; ${d.from.input} is a ${show(t.type)}.`, {}, scope);
   else if (d.basis === 'duration' && t.type?.type === 'date') this.say('type_mismatch', ptr(at, 'from', 'input'), 'A duration due needs an instant anchor; a date has no exact instant.', { actual: 'date' }, scope);
  }
  if ('work' in d.from && !this.traverse(WORK_TYPE, d.from.field.split('.'))) this.say('unknown_binding_path', ptr(at, 'from', 'field'), `${d.from.field} is not a field of a work handle.`, { path: d.from.field }, scope);
  const offset = (o: DueOffset, p: string) => {
   const t = 'unit' in o ? { type: 'quantity', unit: o.unit } as TypeDescriptor : this.value(o, p, scope);
   if (t && !(t.type === 'quantity' && ['time', 'calendar time'].includes(unitDimension(t.unit) ?? '')))
    return this.say('incompatible_unit', p, `A due offset is a duration, such as {value: 30, unit: min}; this is a ${show(t)}.`, {}, scope);
   if (t?.type === 'quantity' && d.basis && !(d.basis === 'duration' ? FIXED_TIME_UNITS : CALENDAR_TIME_UNITS).has(t.unit))
    this.say('incompatible_unit', p, `${t.unit} cannot be used with a ${d.basis} due basis.`, { unit: t.unit, basis: d.basis }, scope);
   if ('unit' in o && o.value < 0) this.say('value_outside_declared_domain', ptr(p, 'value'), 'Due offsets are nonnegative; write a time before the anchor with before.', { value: o.value }, scope);
  };
  const forms = (['after', 'before', 'window'] as const).filter(k => d[k] !== undefined);
  for (const k of forms) if (k === 'window') {
   offset(d.window!.min, ptr(at, 'window', 'min')); offset(d.window!.max, ptr(at, 'window', 'max'));
   const { min, max } = d.window!;
   if ('unit' in min && 'unit' in max) {
    try {
     if (min.value > convert(max.value, max.unit, min.unit)) this.say('value_outside_declared_domain', ptr(at, 'window'), 'A due window has a nondecreasing min and max.', { min: min.value, min_unit: min.unit, max: max.value, max_unit: max.unit }, scope);
    } catch { this.say('incompatible_unit', ptr(at, 'window'), 'A due window needs comparable min and max units.', { min_unit: min.unit, max_unit: max.unit }, scope); }
   }
  } else offset(d[k]!, ptr(at, k));
  if (!forms.length) this.say('invalid_shape', at, 'A due specification has one exact offset (after or before) or a window.', { fields: [] }, scope);
  if (forms.length > 1) this.say('invalid_shape', at, `A due specification has one exact offset or window, not ${forms.join(' and ')}.`, { fields: [...forms] }, scope);
 }

 /**
  * Supplied fields against their contract: declared names only, values of the declared type and, unless `complete` is
  * false (overrides of carried fields), every required one present.
  */
 private fields(values: Readonly<Record<string, ValueTemplate>>, decls: Readonly<Record<string, FieldDecl>> | undefined, at: string, scope: Scope, what: string, complete = true): void {
  for (const [k, v] of Object.entries(values)) {
   const t = this.value(v, ptr(at, k), scope);
   if (decls && !Object.hasOwn(decls, k)) { this.say('undeclared_field', ptr(at, k), `${k} is not a field of ${what}.`, { field: k, contract: what }, scope); continue; }
   const decl = decls?.[k];
   if (decl) this.against(v, t, decl.type, ptr(at, k), scope, decl.none, `${k} of ${what}`, { field: k });
  }
  if (complete) for (const [k, decl] of Object.entries(decls ?? {})) if (!decl.optional && !Object.hasOwn(values, k))
   this.say('type_mismatch', at, `${what} needs ${k}.`, { missing: k, contract: what }, scope);
 }

 /**
  * A value template against its declared type. A bare scalar, `{value: literal}` and `{none: reason}` are literals of that
  * type; a list or a map of templates stands only where the type is composite; an expression's type must be assignable.
  */
 private against(v: unknown, t: TypeDescriptor | undefined, to: TypeDescriptor, at: string, scope: Scope, none: boolean | undefined, what: string, data: Data = {}): void {
  const keys = isObj(v) ? Object.keys(v) : [];
  if (keys.length === 1 && keys[0] === 'value') return this.literal((v as { value: JsonValue }).value, to, ptr(at, 'value'), scope, none);
  if (!isObj(v) && !Array.isArray(v)) return this.literal(v as JsonValue, to, at, scope, none);
  if (keys.length === 1 && typeof (v as { none?: unknown }).none === 'string') return this.literal(v as JsonValue, to, at, scope, none);
  const expression = keys.length === 1 && ['input', 'binding', 'effect'].includes(keys[0]);
  if (!expression && !(Array.isArray(v) ? ['list', 'context'] : ['record', 'reference', 'window', 'context']).includes(to.type))
   return this.say('type_mismatch', at, `${what} is a ${show(to)}; a ${Array.isArray(v) ? 'list' : 'map'} of values is not.`, { ...data, expected: show(to) }, scope);
  if (t && !assignable(t, to)) this.say('type_mismatch', at, `${what} is a ${show(to)}; this value is a ${show(t)}.`, { ...data, expected: show(to), actual: show(t) }, scope);
 }

 private startBindings(e: StartEffect, at: string, scope: Scope): void {
  const say = (reason: V1Reason, p: string, m: string, d: Data = {}) => this.say(reason, p, m, d, scope);
  if (e.mode === 'bind') {
   for (const f of ['owner', 'lifetime', 'purpose'] as const) if (f in e) say('invalid_shape', ptr(at, f), `bind only refers to an existing execution; it cannot assign ${f}.`, { field: f });
   if (e.instance === undefined) say('invalid_shape', at, 'bind names the existing instance.', { field: 'instance' });
  } else if (e.lifetime === 'independent') for (const f of ['owner', 'purpose'] as const) if (e[f] === undefined) say('invalid_shape', at, `Independent work names its accountable ${f}.`, { field: f });
  if (e.instance !== undefined) this.value(e.instance, ptr(at, 'instance'), scope);
  if (e.mode === 'new' && e.predecessor !== undefined)
   say('unsupported_predecessor', ptr(at, 'predecessor'), 'Lifecycle successors are not supported; predecessor is reserved until successor semantics are defined.');
  const child = 'workflow' in e.definition && !('content' in e.definition) ? this.doc.workflows.find(w => w.id === (e.definition as { workflow: string }).workflow) : undefined;
  const forType = this.value(e.for, ptr(at, 'for'), scope);
  if (!child) { for (const [k, v] of Object.entries(e.bindings)) this.value(v, ptr(at, 'bindings', k), scope); return; }
  if (forType && !assignable(forType, ty.ref(`object:${child.subject}`))) say('type_mismatch', ptr(at, 'for'), `${child.id} is for a ${child.subject}; this value is a ${show(forType)}.`, {});
  const entry = new Map(Object.values(child.inputs).flatMap(d => typeof d.binding === 'string' && d.binding.startsWith('entry.') ? [[d.binding.slice('entry.'.length), d] as const] : []));
  for (const [k, v] of Object.entries(e.bindings)) {
   const decl = entry.get(k), t = this.value(v, ptr(at, 'bindings', k), scope);
   if (!decl) say('type_mismatch', ptr(at, 'bindings', k), `${child.id} has no entry input ${k}.`, { unexpected: k });
   else if (decl.type) this.against(v, t, decl.type, ptr(at, 'bindings', k), scope, false, `Entry ${k} of ${child.id}`); // an entry input declares no absence
  }
  for (const [k, decl] of entry) if (decl.required !== 'optional' && !Object.hasOwn(e.bindings, k)) say('type_mismatch', ptr(at, 'bindings'), `${child.id} needs its entry input ${k}.`, { missing: k });
 }
}

// ── Level 3: behavioral analysis ──────────────────────────────────────────────────────────────────

/** A finding's case in words: `review.flag is yes, danger is unknown`. */
const caseText = (witness: Readonly<Record<string, JsonValue>>): string =>
 Object.entries(witness).map(([n, v]) => `${n} is ${isObj(v) && Object.hasOwn(v, 'unknown') ? 'unknown' : isObj(v) && typeof v.value === 'number' ? `${v.value} ${v.unit}` : Array.isArray(v) ? `[${v.join(', ')}]` : String(v)}`).join(', ');

/**
 * Level 3 for a document that passed levels 1 and 2. Each table of each site (shared handlers at each use site) gets a
 * `selection` analysis entry; overlaps and gaps are warnings for attributable review, never a chosen winner or default;
 * a case through an unexpanded calculation is an `info` candidate. The direct self-emit loop is an error.
 */
function behavior(checker: V1Checker, document: ProtocolDocument, catalog: ContractCatalog, out: V1Findings): { tables: AnalysisReport[]; cycles: AnalysisReport } {
 const reports: AnalysisReport[] = [];
 let internal = 0;
 for (const { site, table: st, axes, concepts } of checker.analysisSites()) {
  const { table, at } = st, tableId = st.shared ? `${site.id}/${semanticId(document, at, catalog)}` : semanticId(document, at, catalog);
  const states = site.stateList.map(s => s.id);
  const result = analyzeSelectionCached({ hit: table.hit, states, rows: table.rules, axes, concepts });
  reports.push({ analysis: 'selection', table: tableId, status: result.status, domain: result.domain || '(no names read)', ...(result.limits.length ? { limits: result.limits.join('; ') } : {}), ...(result.sampledOnly ? { sampledOnly: true } : {}) });
  const useSite = st.shared ? site.id : undefined;
  for (const f of result.findings) {
   const where = `in ${f.states.length > 1 ? 'states' : 'state'} ${f.states.join(', ')}`, example = caseText(f.witness);
   const message = f.kind === 'overlap'
    ? `Rules ${f.rows.join(' and ')} of table ${table.id} are both true at the deciding rank ${where}, for example when ${example}; selection is ambiguous there and no row order decides it.`
    : `No rule of table ${table.id} is true ${where} when ${example}; the event is unmatched there. A gap is reviewed; it does not select a default.`;
   const data: Data = { states: f.states, rows: f.rows, witness: f.witness, cases: f.cases, ...(f.candidate ? { candidate: true } : {}) };
   out.add(f.kind, at, f.candidate ? `Candidate, not a validated witness: ${message}` : message, data, useSite, f.candidate ? 'info' : 'warning');
  }
  for (const loop of directSelfEmitLoops(table, states)) {
   const rule = table.rules[loop.rule], effect = rule.effects[loop.effect];
   out.add('unconditional_self_emit_loop', ptr(at, 'rules', loop.rule),
    `Rule ${rule.id} is always true, stays, and emits ${table.on.event} to this execution, which selects it again; nothing changes its guard and nothing external is awaited.`,
    { event: table.on.event, effect: effect.id, states: loop.states }, useSite);
  }
  internal += table.rules.reduce((n, r) => n + r.effects.filter(e => e.kind === 'emit' || e.kind === 'start').length, 0);
 }
 for (const site of checker.sites) {
  const flow = analyzeFlow(site);
  for (const index of flow.unreachable) out.add('unreachable_state', ptr(site.at, 'states', index),
   `State ${site.stateList[index].id} has no possible rule path from initial state ${site.initial}. Connect it or remove the unused state.`,
   { initial: site.initial, state: site.stateList[index].id }, undefined, 'warning');
  for (const loop of flow.loops) out.add('unconditional_internal_loop', loop.at,
   `Tables ${loop.tables.join(' → ')} form an unconditional internal loop through ${loop.states.join(', ')}. Each step emits the next event without waiting. Remove a repeated emit or wait for an external event.`,
   { states: loop.states, tables: loop.tables });
  if (flow.status === 'incomplete') reports.push({ analysis: 'flow', table: site.id, status: flow.status, limits: flow.limits });
 }
 // Internal events come only from emit and start effects; with none, there is no internal cycle to analyse.
 const cycles: AnalysisReport = internal ? { analysis: 'cycles', status: 'incomplete', limits: CYCLE_LIMIT } : { analysis: 'cycles', status: 'complete' };
 return { tables: reports, cycles };
}

// ── Content identity ──────────────────────────────────────────────────────────────────────────────

/** JSON with object keys in code-point order: the same content always gives the same text. */
function stableJson(v: unknown): string {
 if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
 if (isObj(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
 return JSON.stringify(v);
}
/** SHA-256 of UTF-8 text, in hex. Pure, so the validator runs in the browser as it does on the server. */
export function sha256(text: string): string {
 const primes: number[] = [];
 for (let n = 2; primes.length < 64; n++) if (primes.every(p => n % p)) primes.push(n);
 const frac = (x: number) => ((x - Math.floor(x)) * 2 ** 32) >>> 0;
 const k = primes.map(p => frac(Math.cbrt(p))), h = primes.slice(0, 8).map(p => frac(Math.sqrt(p)));
 const bytes = new TextEncoder().encode(text), bits = bytes.length * 8;
 const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
 padded.set(bytes); padded[bytes.length] = 0x80;
 const view = new DataView(padded.buffer);
 view.setUint32(padded.length - 8, Math.floor(bits / 2 ** 32)); view.setUint32(padded.length - 4, bits >>> 0);
 const w = new Uint32Array(64), rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
 for (let o = 0; o < padded.length; o += 64) {
  for (let i = 0; i < 16; i++) w[i] = view.getUint32(o + i * 4);
  for (let i = 16; i < 64; i++) {
   const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
   w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
  }
  let [a, b, c, d, e, f, g, hh] = h;
  for (let i = 0; i < 64; i++) {
   const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + k[i] + w[i]) >>> 0;
   const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
   [hh, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
  }
  [a, b, c, d, e, f, g, hh].forEach((x, i) => { h[i] = (h[i] + x) >>> 0; });
 }
 return h.map(x => x.toString(16).padStart(8, '0')).join('');
}
/** Status and diagnostic names are labels, not executable content. The exact typed catalog is executable content. */
function contentRef(document: ProtocolDocument, catalog: ContractCatalog): ContentRef {
 const { status: _label, ...effective } = document;
 const { reasons: _diagnostics, ...contracts } = catalog;
 return { protocol: document.id, revision: document.revision, identity: `sha256:${sha256(stableJson({ document: effective, catalog: contracts }))}` };
}
/** Whether a document names content outside itself: imports, or a start definition's content. Such a document has no
 * effective identity until a verified resolver includes that content. */
const namesExternalContent = (document: Record<string, unknown>): boolean => {
 const starts = (x: unknown): boolean => Array.isArray(x) ? x.some(starts)
  : isObj(x) && ((x.kind === 'start' && isObj(x.definition) && Object.hasOwn(x.definition, 'content')) || Object.values(x).some(starts));
 return (Array.isArray(document.imports) && document.imports.length > 0) || starts(document.workflows) || starts(document.definitions);
};

// ── Entry points ──────────────────────────────────────────────────────────────────────────────────

const ANALYSES = ['structure', 'references', 'bindings', 'behavior'] as const;
const CYCLE_LIMIT = 'The direct self-emits and unconditional single-emit chains within one execution are checked; conditional cycles and cycles through starts are not proved and are bounded at runtime by max_internal_steps.';
const shapeMessage = (p: V1ShapeProblem): string => {
 const d = p.data as Record<string, string>;
 switch (p.reason) {
  case 'undeclared_field': return `${d.field} is not a field of ${d.shape}.`;
  case 'missing_rule_field': return `A rule needs ${d.field}.`;
  case 'missing_revision': return 'A v1 document names its immutable revision.';
  case 'invalid_table_purpose': return `${d.value ?? 'This'} is not a table purpose. Use ${d.expected}.`;
  case 'unknown_effect_kind': return `${d.value ?? 'This'} is not one of the seven effects (${d.expected}).`;
  case 'unsupported_hit_policy': return `${d.value ?? 'This'} is not a hit policy. Use ${d.expected}.`;
  case 'non_numeric_rank': return 'A rank is a positive whole number, 1 highest.';
  default: return d.field && !d.expected ? `${d.field} is missing.` : `Expected ${d.expected}${d.value === undefined ? '' : `, not ${JSON.stringify(d.value)}`}.`;
 }
};

const PINNED_LIMIT = 'Not run: a pinned preparation relies on an earlier full analysis of this exact content identity.';

/** Validate a v1 document: levels 1 and 2 against the pinned catalog. Nothing older is read or converted. */
export function validateProtocol(document: unknown, catalog: ContractCatalog): ValidationReport {
 return validateLevels(document, catalog, true);
}

/** Levels 1 and 2, then level 3 only when `analyze` is true. Only preparePinnedProtocol passes false. */
function validateLevels(document: unknown, catalog: ContractCatalog, analyze: boolean): ValidationReport {
 const out = new V1Findings(document, catalog);
 const report = (content: ContentRef | null, ran: number, contracts: readonly string[] = [], level3: { tables: AnalysisReport[]; cycles: AnalysisReport } | undefined = undefined, notRun = 'A prerequisite check found errors.'): ValidationReport => ({
  content, contracts, diagnostics: out.list(),
  analyses: [
   ...ANALYSES.map((analysis, i): AnalysisReport => {
    if (analysis === 'behavior' && level3) {
     const open = [...level3.tables, level3.cycles].filter(a => a.status !== 'complete');
     return open.length ? { analysis, status: 'incomplete', limits: `${open.length} of ${level3.tables.length + 1} analyses are incomplete: ${open.map(a => a.table ?? a.analysis).join(', ')}.` } : { analysis, status: 'complete' };
    }
    return i < ran ? { analysis, status: 'complete' } : { analysis, status: 'not_run', limits: notRun };
   }),
   // Level 3's parts: the cycle check and each table's selection analysis. `behavior: not_run` stands for all of them.
   ...level3 ? [level3.cycles, ...level3.tables] : [],
  ],
 });
 if (!isObj(document) || !Object.hasOwn(document, 'format')) {
  out.add('not_v1_format', '', `This is not an ${PROTOCOL_FORMAT} document${isObj(document) && Object.hasOwn(document, 'schemaVersion') ? '; schemaVersion documents have no v1 reading' : ''}.`);
  return report(null, 0);
 }
 if (document.format !== PROTOCOL_FORMAT) {
  out.add('unknown_format_marker', '/format', `The format marker is ${JSON.stringify(document.format)}; only ${PROTOCOL_FORMAT} is read.`, { value: typeof document.format === 'string' ? document.format : JSON.stringify(document.format) });
  return report(null, 0);
 }
 const content = typeof document.id === 'string' && document.id && typeof document.revision === 'string' && document.revision
  && !namesExternalContent(document) ? contentRef(document as unknown as ProtocolDocument, catalog) : null;
 const shape: V1ShapeProblem[] = [];
 checkV1Shape(document, { shape: 'ProtocolDocument' }, shape);
 if (catalog.terms !== undefined) checkV1Shape(catalog.terms, { map: { shape: 'SharedTerm' } }, shape, '/catalog/terms');
 for (const [name, task] of Object.entries(catalog.tasks)) checkV1Shape(task, { shape: 'WorkTemplate' }, shape, ptr('/catalog/tasks', name));
 for (const p of shape) out.add(p.reason as V1Reason, p.at, shapeMessage(p), p.data as Data);
 if (shape.length) return report(content, 1);
 const checker = new V1Checker(document as unknown as ProtocolDocument, catalog, out);
 checker.references();
 if (out.hasErrors) return report(content, 2, sorted(checker.contracts));
 checker.bindings();
 if (out.hasErrors) return report(content, 3, sorted(checker.contracts));
 if (!analyze) return report(content, 3, sorted(checker.contracts), undefined, PINNED_LIMIT);
 return report(content, 4, sorted(checker.contracts), behavior(checker, document as unknown as ProtocolDocument, catalog, out));
}

const deepFreeze = <T>(v: T): T => {
 if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) { Object.freeze(v); for (const x of Object.values(v)) deepFreeze(x); }
 return v;
};
/** Copy JSON data once, refusing mutable built-in objects and cycles before computing an identity. */
const standardPrototype = (prototype: object, constructor: ObjectConstructor | ArrayConstructor): boolean => {
 const own = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
 return typeof own === 'function' && own.prototype === prototype && Function.prototype.toString.call(own) === Function.prototype.toString.call(constructor);
};
export function snapshotJson(value: unknown, active = new WeakSet<object>()): JsonValue {
 if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
 if (typeof value === 'number' && Number.isFinite(value)) return value;
 if (typeof value !== 'object' || active.has(value)) throw new Error('not JSON data');
 const prototype = Object.getPrototypeOf(value);
 if (Array.isArray(value) ? !Array.isArray(prototype) || !standardPrototype(prototype, Array)
  : prototype !== null && (Object.getPrototypeOf(prototype) !== null || !standardPrototype(prototype, Object))) throw new Error('not JSON data');
 active.add(value);
 try {
  return Array.isArray(value) ? Array.from({ length: value.length }, (_, i) => snapshotJson(value[i], active))
   : Object.fromEntries(Object.keys(value).map(k => [k, snapshotJson((value as Record<string, unknown>)[k], active)]));
 } finally { active.delete(value); }
}
const preparedProtocols = new WeakSet<PreparedProtocol>();
/** Only exact objects produced by successful preparation can be reused without checking again. A pinned preparation
 * (preparePinnedProtocol) did not run level 3: a consumer that needs level 3 checks `report.analyses`. */
export const isPreparedProtocol = (protocol: PreparedProtocol): boolean => preparedProtocols.has(protocol);

/** Check even unused catalog entries before they can reach runtime. */
function catalogShape(catalog: ContractCatalog): V1ShapeProblem[] {
 const problems: V1ShapeProblem[] = [];
 const check = (value: unknown, spec: V1Spec, at: string) => checkV1Shape(value, spec, problems, at);
 if (catalog.terms !== undefined) check(catalog.terms, { map: { shape: 'SharedTerm' } }, '/catalog/terms');
 const standard = standardCatalog();
 for (const [group, entries, required] of [
  ['orders', catalog.orders, ORDER_KINDS], ['references', catalog.references, Object.keys(REFERENCE_KINDS)],
 ] as const) {
  for (const name of required) if (!Object.hasOwn(entries, name))
   problems.push({ reason: 'invalid_shape', at: ptr('/catalog', group, name), data: { expected: 'a required catalog kind' } });
  for (const name of Object.keys(entries)) if (!(required as readonly string[]).includes(name))
   problems.push({ reason: 'invalid_shape', at: ptr('/catalog', group, name), data: { expected: 'a declared catalog kind' } });
 }
 for (const [group, entries, standard] of [
  ['references', catalog.references, REFERENCE_KINDS], ['events', catalog.events, STANDARD_EVENTS], ['records', catalog.records, STANDARD_RECORDS],
 ] as const) for (const [name, contract] of Object.entries(standard)) {
  if (!Object.hasOwn(entries, name) || stableJson((entries as Record<string, unknown>)[name]) !== stableJson(contract))
   problems.push({ reason: 'invalid_shape', at: ptr('/catalog', group, name), data: { expected: 'the standard contract' } });
 }
 for (const [name, order] of Object.entries(standard.orders)) {
  const supplied = (catalog.orders as Record<string, unknown>)[name];
  const protectedFields = isObj(supplied) ? supplied.protected : undefined;
  if (Array.isArray(protectedFields) && order.protected.some(field => !protectedFields.includes(field)))
   problems.push({ reason: 'invalid_shape', at: ptr('/catalog/orders', name, 'protected'), data: { expected: 'the standard protections' } });
 }
 for (const [group, entries] of Object.entries(catalog)) {
  if (!['references', 'sources', 'objects', 'registries', 'events', 'records', 'orders', 'tasks', 'policies'].includes(group)) continue;
  for (const [name, entry] of Object.entries(entries)) {
   const at = ptr('/catalog', group, name);
   if (!isObj(entry)) { problems.push({ reason: 'invalid_shape', at, data: { expected: 'an object' } }); continue; }
   const field = (key: string, spec: V1Spec) => check(entry[key], spec, ptr(at, key));
   const fields = (key: string, shape: string) => field(key, { map: { shape } });
   if (group === 'events') check(entry, { shape: 'EventContract' }, at);
   else if (group === 'records') {
    const { stage, ...record } = entry;
    check(record, { shape: 'RecordContract' }, at);
    if (stage !== undefined) check(stage, { literal: true }, ptr(at, 'stage'));
   } else if (group === 'tasks') check(entry, { shape: 'WorkTemplate' }, at);
   else if (group === 'policies') check(entry, { shape: 'WorkPolicy' }, at);
   else if (group === 'objects') fields('fields', 'FieldDecl');
   else if (group === 'sources') { field('event', 'id'); fields('fields', 'SourceFieldDecl'); }
   else if (group === 'registries') { field('of', 'id'); field('record', 'id'); field('completeness', 'string'); }
   else if (group === 'orders') { fields('content', 'FieldDecl'); field('protected', { list: 'string' }); }
   else if (group === 'references') {
    field('required', { list: 'string' }); field('optional', { list: 'string' });
    if (entry.exactlyOneOf !== undefined) field('exactlyOneOf', { list: 'string' });
   }
  }
 }
 const reasons: unknown = catalog.reasons;
 if (!isObj(reasons)) problems.push({ reason: 'invalid_shape', at: '/catalog/reasons', data: { expected: 'an object' } });
 else {
  if (!isObj(reasons.static)) problems.push({ reason: 'invalid_shape', at: '/catalog/reasons/static', data: { expected: 'an object' } });
  else for (const [name, entry] of Object.entries(reasons.static)) {
   const at = ptr('/catalog/reasons/static', name);
   if (!isObj(entry)) problems.push({ reason: 'invalid_shape', at, data: { expected: 'an object' } });
   else check(entry.level, { oneOf: [{ literal: 1 }, { literal: 2 }, { literal: 3 }] }, ptr(at, 'level'));
  }
  check(reasons.runtime, { list: 'string' }, '/catalog/reasons/runtime');
  if (stableJson(reasons) !== stableJson(standard.reasons))
   problems.push({ reason: 'invalid_shape', at: '/catalog/reasons', data: { expected: 'the standard diagnostic reasons' } });
 }
 return problems;
}
/** A checked, immutable copy of the document with its catalog, or the exact error diagnostics. It implies no approval. */
export function prepareProtocol(document: unknown, catalog: ContractCatalog): PreparationResult {
 return prepare(document, catalog, undefined);
}

/**
 * Prepare content whose exact identity a trusted step already prepared in full with prepareProtocol, for example a
 * build that checks the identity against a recorded pin. It runs levels 1 and 2 and refuses the document unless its
 * computed identity is `identity`. It does not run the level 3 analysis (overlaps, gaps and loops): the report marks
 * `behavior` as `not_run`. Use it where the full analysis is too slow to repeat, such as a browser session. The pin
 * guards against content that changed after the full preparation. It does not guard against a party that can change
 * both the document and the pin. It implies no approval.
 */
export function preparePinnedProtocol(document: unknown, catalog: ContractCatalog, identity: string): PreparationResult {
 return prepare(document, catalog, identity);
}

function prepare(document: unknown, catalog: ContractCatalog, pin: string | undefined): PreparationResult {
 let snapshot: unknown, catalogSnapshot: ContractCatalog, at = '';
 try {
  snapshot = snapshotJson(document);
  at = '/catalog';
  catalogSnapshot = snapshotJson(catalog) as unknown as ContractCatalog;
 } catch {
  return { ok: false, diagnostics: [{ level: 1, severity: 'error', reason: 'invalid_shape', at, id: 'protocol:?',
   message: `${at ? 'The catalog' : 'The document'} could not be copied for validation; use acyclic JSON data.` }] };
 }
 for (const field of ['references', 'sources', 'objects', 'registries', 'events', 'records', 'orders', 'tasks', 'policies'] as const) {
  if (!isObj(catalogSnapshot) || !isObj(catalogSnapshot[field])) return { ok: false, diagnostics: [{
   level: 1, severity: 'error', reason: 'invalid_shape', at: `/catalog/${field}`, id: 'protocol:?',
   message: `The catalog needs an object for ${field}.`,
  }] };
 }
 const catalogProblems = catalogShape(catalogSnapshot);
 if (catalogProblems.length) return { ok: false, diagnostics: catalogProblems.map(p => ({
  level: 1, severity: 'error', reason: p.reason, at: p.at, id: semanticId(snapshot, p.at, catalogSnapshot), message: shapeMessage(p),
 })) };
 let report: ValidationReport;
 try { report = validateLevels(snapshot, catalogSnapshot, pin === undefined); }
 catch {
  return { ok: false, diagnostics: [{ level: 1, severity: 'error', reason: 'invalid_shape', at: '', id: 'protocol:?',
   message: 'The document or catalog could not be validated; check their shapes.' }] };
 }
 const errors = report.diagnostics.filter(d => d.severity === 'error');
 if (errors.length || !report.content) return { ok: false, diagnostics: errors };
 // No static diagnostic reason fits a wrong pin; like the other refusals above, it uses invalid_shape at level 1.
 if (pin !== undefined && report.content.identity !== pin) return { ok: false, diagnostics: [{ level: 1, severity: 'error',
  reason: 'invalid_shape', at: '', id: 'protocol:?', message: `The computed identity ${report.content.identity} is not the pinned ${pin}.` }] };
 const protocol = deepFreeze({ document: snapshot as ProtocolDocument, content: report.content, catalog: catalogSnapshot, report }) as unknown as PreparedProtocol;
 preparedProtocols.add(protocol);
 return { ok: true, protocol };
}

/** Each local table's effective failure handlers with the scope that supplies them; the nearest scope replaces an outer one. */
export function effectiveHandlers(document: ProtocolDocument): Record<SemanticId, Partial<Record<FailureClass, { table: string; source: string }>>> {
 const out: Record<SemanticId, Partial<Record<FailureClass, { table: string; source: string }>>> = {};
 const sites: [string, string, Workflow | WorkPolicy][] = [
  ...document.workflows.map((w): [string, string, Workflow] => ['workflow', w.id, w]),
  ...Object.values(document.definitions?.work_policies ?? {}).map((p): [string, string, WorkPolicy] => ['policy', p.id, p]),
 ];
 for (const [kind, id, w] of sites) for (const t of w.tables) {
  const handlers: Partial<Record<FailureClass, { table: string; source: string }>> = {};
  for (const cls of FAILURE_CLASSES) {
   const [table, source] = t.fallback?.[cls] !== undefined ? [t.fallback[cls], `table ${t.id} fallback`]
    : w.fallback?.[cls] !== undefined ? [w.fallback[cls], `${kind} ${id} fallback`]
    : document.definitions?.fallback?.[cls] !== undefined ? [document.definitions.fallback[cls], 'document fallback'] : [];
   if (table !== undefined) handlers[cls] = { table, source: source! };
  }
  out[`${kind}:${id}/table:${t.id}`] = handlers;
 }
 return out;
}
