/**
 * The OpenMRS host for Nexo, in the browser. It turns the protocol state into a worklist with generated forms, fills
 * each form from the task and the patient's history, and turns a saved O3 encounter back into a Nexo event.
 *
 * It decides nothing clinical. Core selects every rule. This file only moves values between OpenMRS observations
 * and the Nexo objects that the catalog declares, through the binding map that the compiler wrote.
 */
import type { FormSpec, HostFill, Hints, QuestionBinding } from './compile.ts';
import {
  NexoSession, actorFor, completion, hostEvent, launch,
  type JsonValue, type LogEntry, type NewEntry, type PatientFacts, type Prepared, type ScenarioObject, type StepReport, type WorkSnapshot,
} from './session.ts';

export type FormBinding = Omit<FormSpec, 'o3'> & { o3: { uuid: string; name: string } };
export interface HostHints {
  existing?: Hints['existing'];
  carryOver?: string[];
  roles?: Hints['roles'];
}
export interface Binding { protocol: { id: string; revision: string; identity: string; status: string }; labels?: Record<string, string>; host?: HostHints; forms: FormBinding[] }

export interface O3Obs { uuid?: string; concept: { uuid: string } | string; value: unknown; formFieldPath?: string; groupMembers?: O3Obs[] | null }
export interface O3Encounter { uuid: string; encounterDatetime: string; obs?: O3Obs[] | null }

export interface ContextLine { key: string; label: string; value: string }
export interface HistoryDecision {
  id: string;
  table: string;
  rule: string;
  evidence: string[];
  hasEffects: boolean;
  description?: string;
}

export interface MissingField { input: string; object: { type: string; id: string }; field: string; label: string }

export type Action =
  | { kind: 'form'; form: FormBinding; label: string }
  | { kind: 'update'; form: FormBinding; object: { type: string; id: string }; label: string }
  | { kind: 'event'; form: FormBinding; label: string }
  | { kind: 'confirm'; label: string };

export interface TaskView {
  work: WorkSnapshot;
  title: string;
  role?: string;
  roleLabel?: string;
  due?: string;
  overdue: boolean;
  kind: WorkSnapshot['kind'];
  context: ContextLine[];
  missing: MissingField[];
  actions: Action[];
  workflow?: string;
  state?: string;
}

export interface StartOption { form: FormBinding; workflow: string; label: string; choice?: Record<string, string> }

const PATIENT = 'patient';

export class NexoHost {
  readonly forms = new Map<string, FormBinding>();

  readonly labels: Record<string, string>;

  constructor(readonly prepared: Prepared, readonly binding: Binding, labels?: Record<string, string>) {
    this.labels = labels ?? binding.labels ?? {};
    if (binding.protocol.identity !== prepared.protocol.content.identity)
      throw new Error(`The forms were compiled for ${binding.protocol.identity}, not ${prepared.protocol.content.identity}.`);
    for (const f of binding.forms) this.forms.set(f.name, f);
  }

  label(key: string, fallback?: string) { return this.labels[key] ?? fallback ?? humanize(key); }
  valueLabel(v: string) { return this.labels[`value:${v}`] ?? this.label(v); }
  /** A task's title for a person: a `title:<template>` label, else the protocol's title, else the template's label. */
  taskTitle(template: string) { return this.label(`title:${template}`, this.templateTitle(template) ?? this.label(template)); }
  private get hints(): HostHints { return this.binding.host ?? {}; }

  /** Replay the patient's log up to `now`, by default the current time, so that work overdue now has fired. */
  session(patient: PatientFacts, log: readonly LogEntry[], now = new Date().toISOString()) { return new NexoSession(this.prepared, patient, log, now); }

  /** The open work of this patient as a worklist, with what a person can do for each item. */
  tasks(s: NexoSession, now = s.now ?? new Date().toISOString()): TaskView[] {
    const view = s.view();
    const states = new Map(view.workflows.map(w => [w.execution, w]));
    return view.open.map(w => {
      const template = this.prepared.protocol.document.definitions?.work_templates?.[w.template] as any;
      const form = this.forms.get(w.template);
      const execution = states.get(w.commissioned_by.id);
      // A task that names missing inputs asks for information; its answers are new revisions of known objects.
      const missing = Array.isArray(w.content?.missing_inputs) ? this.missing(s, w) : [];
      const actions: Action[] = [];
      if (missing.length) {
        const first = missing[0];
        const update = this.forms.get(`update_${first.object.type}`);
        if (update) actions.push({ kind: 'update', form: update, object: first.object, label: `Answer: ${missing.filter(m => m.object.id === first.object.id).map(m => m.label).join(', ')}` });
      } else if (form && form.questions.length) actions.push({ kind: 'form', form, label: 'Fill in the form' });
      if (execution?.state && !execution.ended) for (const ev of this.eventForms(execution.workflow!, execution.state)) actions.push({ kind: 'event', form: ev, label: ev.title });
      if (w.kind === 'task' && form && !form.questions.length && !actions.length) actions.push({ kind: 'confirm', label: 'Mark as done' });
      return {
        work: w, title: this.taskTitle(w.template), role: template?.performer?.role, roleLabel: template?.performer?.role ? this.label(template.performer.role) : undefined,
        due: w.due?.at, overdue: !!w.due?.at && Date.parse(w.due.at) < Date.parse(now), kind: w.kind,
        context: this.context(s, w), missing, actions, workflow: execution?.workflow, state: execution?.state,
      };
    });
  }

  /** Event forms whose events a rule in this workflow state hears. */
  eventForms(workflow: string, state: string): FormBinding[] {
    const wf = this.prepared.protocol.document.workflows.find(w => w.id === workflow);
    if (!wf) return [];
    return [...this.forms.values()].filter(f => f.kind === 'event' && wf.tables.some(t => t.on.event === f.event && t.rules.some(r => r.in.includes(state) || r.in.includes('*'))));
  }

  /** Workflows a person can start now: those with no running execution for this patient. */
  starts(s: NexoSession): StartOption[] {
    // Offer a start only to a patient with no running workflow of this protocol: a second entry point while one
    // runs would open parallel care that no rule coordinates.
    if (s.view().workflows.some(w => !w.ended)) return [];
    const out: StartOption[] = [];
    for (const form of this.forms.values()) for (const start of form.starts) {
      const choices = Object.entries(start.entry).filter(([, v]) => v.from === 'choice') as [string, { from: 'choice'; values: string[] }][];
      const name = this.label(start.workflow);
      if (!choices.length) { out.push({ form, workflow: start.workflow, label: name }); continue; }
      // An entry with one value is fixed by the protocol (for example a reserved empty slot), so the person has
      // nothing to choose. The label names only a real choice. The start records the value in both cases.
      const [key, { values }] = choices[0];
      for (const value of values) out.push({ form, workflow: start.workflow, label: values.length > 1 ? `${name} (${this.label(value)})` : name, choice: { [key]: value } });
    }
    return out;
  }

  /** The task content, resolved for a person to read. */
  context(s: NexoSession, w: WorkSnapshot): ContextLine[] {
    const lines = Object.entries(w.content ?? {}).map(([key, value]) => ({ key, label: this.label(key), value: this.describe(s, value) }));
    for (const q of this.forms.get(w.template)?.questions ?? []) for (const [type, source] of Object.entries(q.references ?? {})) {
      if (source !== 'latest') continue;
      const found = this.lookup(s, type);
      lines.push({ key: type, label: this.label(type), value: found ? this.describe(s, found.attest?.fields ?? this.objectFields(s, type, found.ref.id) ?? found.ref) : 'No prescription is recorded in this pathway' });
    }
    return lines;
  }

  describe(s: NexoSession, value: JsonValue): string {
    if (value === null || value === undefined) return 'unknown';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.map(v => this.describe(s, v)).join(', ');
    if (typeof value === 'object') {
      const v = value as Record<string, JsonValue>;
      if (v.medicine) return `${this.label(String(v.medicine))} ${this.describe(s, v.dose ?? null)}${v.second_medicine && v.second_medicine !== 'none' ? ` + ${this.label(String(v.second_medicine))} ${this.describe(s, v.second_dose ?? null)}` : ''}${v.valid_until ? `, valid until ${when(v.valid_until)}` : ''}`;
      if (typeof v.value === 'number' && typeof v.unit === 'string') return `${v.value} ${this.labels[v.unit] ?? v.unit}`;
      if (typeof v.id === 'string' && (v.kind === 'simulation' || v.kind === 'live') && v.type === undefined) {
        const grant = this.prepared.trust.roles.find(r => (r.actor as any)?.id === v.id);
        return grant ? `${this.label(grant.role)} (${v.kind === 'simulation' ? 'simulated' : 'live'})` : String(v.id);
      }
      if (typeof v.type === 'string' && typeof v.id === 'string') {
        const fields = this.objectFields(s, v.type, v.id);
        if (v.type === 'observation' && fields) return `${num(fields.systolic)}/${num(fields.diastolic)} mmHg, ${this.valueLabel(String(fields.setting ?? ''))}, ${when(fields.time)}`;
        if (fields?.time) return `${this.label(v.type)} recorded ${when(fields.time)}`;
        return this.label(v.type);
      }
      if (typeof v.id === 'string' && typeof v.occurrence === 'string') {
        const work = this.workContent(s, v.id);
        if (work?.medicine) return `${this.label(String(work.medicine))} ${this.describe(s, work.dose ?? null)}${work.second_medicine && work.second_medicine !== 'none' ? ` + ${this.label(String(work.second_medicine))} ${this.describe(s, work.second_dose ?? null)}` : ''}${work.frequency ? `, ${this.label(String(work.frequency))}` : ''}`;
        const template = this.workTemplate(s, v.id);
        return template ? this.taskTitle(template) : 'Earlier work';
      }
      return JSON.stringify(value);
    }
    if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value)) return when(value);
    return this.valueLabel(String(value));
  }

  objectFields(s: NexoSession, type: string, id: string): Record<string, JsonValue> | undefined {
    const o = s.harness.observe()[`object:${type}:${id}`]?.fields;
    return o?.status === 'observed' ? o.value as Record<string, JsonValue> : undefined;
  }

  objectRevision(s: NexoSession, type: string, id: string): string | undefined {
    const o = s.harness.observe()[`object:${type}:${id}`]?.revisions;
    const list = o?.status === 'observed' ? o.value as { revision: string }[] : [];
    return list.at(-1)?.revision;
  }

  workContent(s: NexoSession, id: string): Record<string, JsonValue> | undefined {
    const o = s.harness.observe()[`work:${id}`]?.content;
    return o?.status === 'observed' ? o.value as Record<string, JsonValue> : undefined;
  }

  /** The newest object of a type for this patient, by the order the host recorded them. */
  latest(s: NexoSession, type: string): { type: string; id: string } | undefined {
    return this.lookup(s, type)?.ref;
  }

  /**
   * The object the host supplies for a looked-up type, and the object revision to attest when it is not yet known to
   * Core. A `fromWork` type comes from the latest live work of a template: the protocol's own order is the source.
   */
  lookup(s: NexoSession, type: string): { ref: { type: string; id: string }; attest?: ScenarioObject } | undefined {
    const rule = this.hints.existing?.[type];
    const observed = s.harness.observe();
    if (rule && typeof rule === 'object') {
      const works = Object.keys(observed).filter(k => k.startsWith('work:')).map(k => k.slice(5))
        .filter(id => observed[`work:${id}`]?.template?.status === 'observed' && (observed[`work:${id}`].template as any).value?.template === rule.fromWork.template)
        .filter(id => !['cancelled', 'failed', 'cancellation_requested'].includes((observed[`work:${id}`]?.status as any)?.value));
      const id = works.at(-1);
      if (!id) return undefined;
      const ref = { type, id: `${rule.fromWork.template}-${id}` };
      if (this.objectFields(s, ref.type, ref.id)) return { ref };
      const content = this.workContent(s, id) ?? {};
      const fields: Record<string, JsonValue> = { patient: { type: PATIENT, id: s.patient.id }, ...(rule.fromWork.set ?? {}) };
      for (const [field, key] of Object.entries(rule.fromWork.fields)) if (content[key] !== undefined && content[key] !== null) fields[field] = content[key];
      return { ref, attest: { ...ref, revision: '1', fields } };
    }
    const ids = Object.keys(observed).filter(k => k.startsWith(`object:${type}:`)).map(k => k.slice(`object:${type}:`.length));
    for (const id of ids.reverse()) {
      const f = this.objectFields(s, type, id);
      if (f && (f.status === undefined || f.status === 'active')) return { ref: { type, id } };
    }
    return undefined;
  }

  /**
   * The facts a `collect_information` task names, as object fields. The unresolved attempt that created the task
   * says which table it ran; that table's input bindings say where each fact lives.
   */
  missing(s: NexoSession, w: WorkSnapshot): MissingField[] {
    const names = (w.content?.missing_inputs ?? []) as string[];
    const execution = w.commissioned_by.id;
    const attempt = [...s.steps].reverse().flatMap(r => r.attempts).find(a => a.execution === execution && a.selection?.result === 'unresolved'
      && names.every(n => ((a.selection as any).unknown_inputs ?? []).includes(n)));
    const table = attempt?.table ? this.findTable(attempt.table) : undefined;
    const out: MissingField[] = [];
    for (const input of names) {
      const binding = table?.inputs?.[input]?.binding;
      const resolved = typeof binding === 'string' ? this.resolveObject(s, binding, execution) : undefined;
      if (resolved) out.push({ input, ...resolved, label: this.label(resolved.field, this.label(input)) });
    }
    return out;
  }

  private findTable(id: string) {
    for (const w of this.prepared.protocol.document.workflows) for (const t of w.tables) if (t.id === id) return t;
    return (this.prepared.protocol.document.definitions?.tables as any)?.[id];
  }

  /** Follow a dotted binding from the attempt's resolved references to the object that holds the last field. */
  private resolveObject(s: NexoSession, binding: string, execution: string): { object: { type: string; id: string }; field: string } | undefined {
    const parts = binding.replace(/^event\.payload\.(fixed|collected)\./, '').split('.');
    const field = parts.pop()!;
    let ref: { type: string; id: string } | undefined;
    const head = parts.shift();
    // Start from an input of the execution that asked, and walk the reference fields.
    const snap = s.harness.observe()[`execution:${execution}`]?.snapshot;
    const bindings = snap?.status === 'observed' ? (snap.value as any).bindings : undefined;
    if (head && bindings?.[head]?.type && bindings[head].id) ref = { type: bindings[head].type, id: bindings[head].id };
    for (const p of parts) {
      if (!ref) return undefined;
      const fields = this.objectFields(s, ref.type, ref.id);
      const next = fields?.[p] as any;
      ref = next?.type && next?.id ? { type: next.type, id: next.id } : undefined;
    }
    return ref ? { object: ref, field } : undefined;
  }

  /** Values to show in the form before a person answers, as O3 prefill strings keyed by question ID. */
  prefill(s: NexoSession, form: FormBinding, w?: WorkSnapshot, update?: { type: string; id: string }): Record<string, string> {
    return Object.fromEntries(Object.entries(this.prefillWithSources(s, form, w, update)).map(([k, v]) => [k, v.value]));
  }

  /**
   * Prefill with the reason for each value. Only three sources: the object being updated; values the protocol passed
   * into this task (a content value of the same name, or a field of an object or order the content names, for a field
   * of a new object); and facts the hints name as carrying over from the patient's last object of that type. A
   * decision the person makes now (a top-level result) and this visit's findings are never prefilled from history.
   */
  prefillWithSources(s: NexoSession, form: FormBinding, w?: WorkSnapshot, update?: { type: string; id: string }): Record<string, { value: string; from: string }> {
    const out: Record<string, { value: string; from: string }> = {};
    const put = (q: QuestionBinding, v: JsonValue | undefined, from: string) => {
      const text = toO3Value(q, v);
      if (text !== undefined && out[q.id] === undefined) out[q.id] = { value: text, from };
    };
    if (update) {
      const fields = this.objectFields(s, update.type, update.id) ?? {};
      for (const q of form.questions) put(q, fields[q.field], `current ${this.label(update.type).toLowerCase()}`);
      return out;
    }
    const content = w?.content ?? {};
    const sources: { fields: Record<string, JsonValue>; from: string }[] = [];
    for (const [key, v] of Object.entries(content)) {
      const r = v as any;
      if (r?.type && r?.id) {
        const f = this.objectFields(s, r.type, r.id);
        if (f) {
          sources.push({ fields: f, from: `task: ${this.label(key)}` });
          for (const x of Object.values(f)) { const rr = x as any; if (rr?.type && rr?.id && rr.type !== PATIENT) { const ff = this.objectFields(s, rr.type, rr.id); if (ff) sources.push({ fields: ff, from: `task: ${this.label(key)}` }); } }
        }
      } else if (r?.id && r?.occurrence) { const c = this.workContent(s, r.id); if (c) sources.push({ fields: c, from: `task: ${this.label(key)}` }); }
    }
    for (const q of form.questions) {
      const value = content[q.field];
      if (value !== undefined && value !== null && typeof value !== 'object') put(q, value, 'task');
      if (q.path.length < 2) continue;
      for (const src of sources) if (src.fields[q.field] !== undefined) { put(q, src.fields[q.field], src.from); break; }
    }
    for (const key of this.hints.carryOver ?? []) {
      const [object, field] = key.split('.');
      for (const q of form.questions.filter(q => q.object === object && q.field === field)) {
        const ref = this.lookup(s, object)?.ref;
        const f = ref && this.objectFields(s, ref.type, ref.id);
        if (f) put(q, f[field], `last ${this.label(object).toLowerCase()}`);
      }
    }
    return out;
  }

  /**
   * Dispatch the entry on a scratch copy of the session, at the same time, and report whether Core applied it. An
   * event Core refuses at ingestion (wrong work, missing required result, wrong patient) must not be stored.
   */
  check(s: NexoSession, entry: NewEntry): { ok: boolean; reasons: string[]; report: StepReport } {
    const scratch = new NexoSession(this.prepared, s.patient, [...s.log, { ...entry, seq: s.log.length } as LogEntry], s.now);
    const report = scratch.reports.at(-1)!;
    const own = report.failures.filter(f => (f.data as any)?.event === entry.event.id);
    const refused = report.attempts.length === 0 && report.committed.length === 0 && own.length > 0;
    return { ok: !refused, reasons: own.map(f => `${f.reason}: ${(f.data as any)?.detail ?? ''}`.trim()), report };
  }

  /**
   * Build the log entry for a saved encounter. `task` completes open work; `start` launches a workflow with the
   * objects this form created; otherwise an event form records a host event.
   */
  entryFor(s: NexoSession, form: FormBinding, encounter: O3Encounter, how: { task?: WorkSnapshot; start?: StartOption; update?: { type: string; id: string; collect: WorkSnapshot }; user?: string }): NewEntry {
    const at = normalizeInstant(encounter.encounterDatetime);
    const answers = readAnswers(form, encounter);
    const fallback = this.hints.roles?.event ?? this.prepared.trust.roles[0]?.role;
    const role = form.role ?? (how.start ? this.hints.roles?.start?.[how.start.workflow] ?? fallback : fallback);
    const { actor, owner } = actorFor(this.prepared.trust, how.update ? (this.templateRole(how.update.collect.template) ?? role) : role);
    const patient = s.patient.id;
    const base = { patient, actor, at, id: `enc-${encounter.uuid}` };
    const meta = { encounter: encounter.uuid, user: how.user, recorded_at: new Date().toISOString() };
    const attested = new Map<string, ScenarioObject>();
    for (const q of form.questions) {
      if (!q.references || !answers.has(q.id)) continue;
      const type = String(answers.get(q.id)), source = q.references[type];
      if (source === 'latest') {
        const found = this.lookup(s, type);
        if (!found) throw new Error(`No ${this.label(type).toLowerCase()} is recorded for this patient. Record the prescription before selecting it.`);
        if (found.attest) attested.set(`${type}:${found.ref.id}`, found.attest);
        answers.set(q.id, found.ref);
      } else if (source === 'attest') {
        const ref = { type, id: `${encounter.uuid}/${q.path.join('.')}` };
        const fields: Record<string, JsonValue> = {};
        for (const [name, decl] of Object.entries(this.prepared.bundle.catalog.objects![type].fields)) {
          if (name === 'patient') fields[name] = { type: PATIENT, id: patient };
          else if (decl.type.type === 'reference') fields[name] = actor as unknown as JsonValue;
          else if (name === 'time') fields[name] = at;
        }
        attested.set(`${type}:${ref.id}`, { ...ref, revision: '1', fields });
        answers.set(q.id, ref);
      } else throw new Error(`Invalid reference choice for ${q.label}.`);
    }

    if (how.update) {
      const previous = this.objectFields(s, how.update.type, how.update.id) ?? {};
      const revision = String((Number(this.objectRevision(s, how.update.type, how.update.id)) || 1) + 1);
      // The saved form is the record of every field it asks. A field it asks but did not save (cleared, "Not known",
      // or hidden) is unknown in the new revision. Only the fields the form does not ask keep their earlier value.
      const fields: Record<string, JsonValue> = { ...previous };
      for (const q of form.questions) {
        if (answers.has(q.id)) fields[q.field] = answers.get(q.id)!;
        else delete fields[q.field];
      }
      const object: ScenarioObject = { type: how.update.type, id: how.update.id, revision, fields };
      const event = completion(how.update.collect, { ...base, objects: [...attested.values(), object], result: {} }, this.declares(how.update.collect.template));
      return { kind: 'event', event, ...meta };
    }

    const objects = new Map<string, ScenarioObject>();
    const idOf = (path: string[]) => `${encounter.uuid}/${path.join('.')}`;
    // An optional object nobody answered is left out, with the result field that would name it.
    const skipped = new Set(form.objects.filter(o => o.optional && !form.questions.some(q => q.path.slice(0, o.path.length).join('.') === o.path.join('.') && answers.has(q.id))).map(o => o.path.join('.')));
    const fill = (f: HostFill, w?: WorkSnapshot): JsonValue | undefined => {
      switch (f.from) {
        case 'patient': return { type: PATIENT, id: patient };
        case 'now': return at;
        case 'owner': return owner as unknown as JsonValue;
        case 'actor': return actor as unknown as JsonValue;
        case 'content': return w?.content?.[f.key];
        case 'latest': {
          const found = this.lookup(s, f.object);
          if (found?.attest) attested.set(`${found.ref.type}:${found.ref.id}`, found.attest);
          return found?.ref as unknown as JsonValue;
        }
        case 'object': {
          const ob = form.objects.find(o => o.path.join('.') === f.path.join('.'));
          return ob && !skipped.has(ob.path.join('.')) ? { type: ob.object, id: idOf(f.path) } : undefined;
        }
      }
    };
    for (const ob of [...form.objects].sort((a, b) => b.path.length - a.path.length)) {
      if (skipped.has(ob.path.join('.'))) continue;
      const fields: Record<string, JsonValue> = {};
      for (const [k, f] of Object.entries(ob.host)) { const v = fill(f, how.task); if (v !== undefined && v !== null) fields[k] = v; }
      for (const q of form.questions) if (q.path.slice(0, -1).join('.') === ob.path.join('.') && answers.has(q.id)) fields[q.field] = answers.get(q.id)!;
      objects.set(ob.path.join('.'), { type: ob.object, id: idOf(ob.path), revision: '1', fields });
    }
    const top: Record<string, JsonValue> = {};
    for (const [k, f] of Object.entries(form.host)) { const v = fill(f, how.task); if (v !== undefined && v !== null) top[k] = v; }
    for (const q of form.questions) if (q.path.length === 1 && answers.has(q.id)) top[q.field] = answers.get(q.id)!;
    const list = [...attested.values(), ...objects.values()];

    if (how.task) return { kind: 'event', event: completion(how.task, { ...base, objects: list, result: top }, this.declares(how.task.template)), ...meta };
    if (how.start) {
      const start = form.starts.find(x => x.workflow === how.start!.workflow)!;
      const bindings: Record<string, JsonValue> = {};
      for (const [k, f] of Object.entries(start.entry)) {
        if (f.from === 'choice') bindings[k] = how.start.choice?.[k] ?? f.values[0];
        else { const v = fill(f as HostFill); if (v !== undefined) bindings[k] = v; }
      }
      return { ...launch(this.prepared, start.workflow, { ...base, objects: list, bindings }), patient: { ...s.patient }, ...meta };
    }
    return { kind: 'event', event: hostEvent(form.event!, { ...base, objects: list, payload: top }), ...meta };
  }

  /** Complete a task that asks for no answers ("Mark as done"). */
  confirm(s: NexoSession, w: WorkSnapshot, at = new Date().toISOString(), user?: string): NewEntry {
    const { actor } = actorFor(this.prepared.trust, this.templateRole(w.template) ?? this.hints.roles?.event ?? this.prepared.trust.roles[0]!.role);
    const event = completion(w, { patient: s.patient.id, actor, at: normalizeInstant(at), result: {} }, this.declares(w.template));
    return { kind: 'event', event, user, recorded_at: new Date().toISOString() };
  }

  /** Selected rules and their care effects. Preserve the raw rule IDs for audit consumers. */
  history(s: NexoSession): { seq: number; type: string; at: string; encounter?: string; task?: string; decisions: HistoryDecision[] }[] {
    const rules = new Map<string, { evidence?: readonly string[] }>();
    for (const w of this.prepared.protocol.document.workflows) for (const t of w.tables) for (const r of t.rules) rules.set(`${t.id}/${r.id}`, r);
    const observed = s.harness.observe();
    return s.log.map((entry, i) => ({
      seq: entry.seq, type: entry.event.type, at: entry.event.occurred_at, encounter: entry.encounter,
      task: entry.event.work ? this.workTemplate(s, entry.event.work.id) : undefined,
      decisions: (s.reports[i]?.attempts ?? []).filter(a => a.selection?.result === 'selected' && !a.id.endsWith('/handler')).map(a => {
        const rule = (a.selection as { rule: string }).rule;
        const report = s.reports[i];
        const effects = report.committed.filter(e => e.attempt === a.id);
        const decision: HistoryDecision = { id: a.id, table: a.table ?? '', rule, evidence: [...(rules.get(`${a.table}/${rule}`)?.evidence ?? [])], hasEffects: effects.length > 0 };
        const resolved = a.resolved?.work;
        const ref = resolved?.state === 'known' ? resolved.value : undefined;
        if (!isJsonRecord(ref) || typeof ref.id !== 'string' || typeof ref.occurrence !== 'string') return decision;
        // Exact occurrences keep an earlier cancellation separate from a later reissue of the same work.
        const work = observed[`work-ref:${JSON.stringify([ref.id, ref.occurrence])}`];
        const template = work?.template;
        const name = template?.status === 'observed' && isJsonRecord(template.value)
          ? template.value.template : undefined;
        if (typeof name !== 'string') return decision;
        // History keeps the short name of the work, not the protocol's long title, unless a label renames the task.
        const title = this.label(`title:${name}`, humanize(name));
        if (a.table === 'stop_on_execution_end' && rule === 'cancel_owned_work' && effects.some(e => e.kind === 'change_work')) {
          const cancellations = work?.cancellations;
          const cancellation = cancellations?.status === 'observed' && Array.isArray(cancellations.value)
            ? cancellations.value.find(c => isJsonRecord(c) && c.event === a.event) : undefined;
          if (isJsonRecord(cancellation)) {
            const reason = typeof cancellation.reason === 'string' ? this.labels[cancellation.reason] ?? humanize(cancellation.reason).replace(/^./, c => c.toLowerCase()) : this.describe(s, cancellation.reason);
            const pending = report.retained.some(w => w.ref.id === ref.id && w.ref.occurrence === ref.occurrence && w.status === 'cancellation_requested');
            decision.description = `${title} ${pending ? 'cancellation requested' : 'cancelled'}: ${reason}`;
          }
        }
        if (a.table === 'record_unmet_work' && rule === 'report_unmet_need' && effects.some(e => e.kind === 'record')) {
          const content = work?.content;
          const missing = content?.status === 'observed' && isJsonRecord(content.value) && Array.isArray(content.value.missing_inputs)
            ? content.value.missing_inputs.filter((input): input is string => typeof input === 'string').map(input => this.label(input)) : [];
          // Work can fall due and end in the same step, for example the second reading that this step then checks.
          // Then "still needed" would be false at the end of the step, so the entry names how the work ended.
          const open = report.retained.some(w => w.ref.id === ref.id && w.ref.occurrence === ref.occurrence);
          const status = work?.status?.status === 'observed' ? work.status.value : undefined;
          const ended = status === 'completed' || status === 'cancelled' ? status : 'closed';
          decision.description = `${title} ${open ? 'still needed' : `was due and was ${ended} in the same step`}${missing.length ? `: ${missing.join(', ')}` : ''}`;
        }
        return decision;
      }),
    }));
  }

  /** The template of a work item, for a person to read the history ("Task completed: …"). */
  workTemplate(s: NexoSession, id: string): string | undefined {
    const t = s.harness.observe()[`work:${id}`]?.template;
    return t?.status === 'observed' ? (t.value as any)?.template : undefined;
  }

  private templateTitle(template: string): string | undefined {
    return (this.prepared.protocol.document.definitions?.work_templates?.[template] as any)?.title;
  }

  private templateRole(template: string): string | undefined {
    return (this.prepared.protocol.document.definitions?.work_templates?.[template] as any)?.performer?.role;
  }

  private declares(template: string) {
    const result = (this.prepared.protocol.document.definitions?.work_templates?.[template] as any)?.result ?? {};
    return (name: string) => !!result[name];
  }
}

/** Read the saved observations back into Nexo values, by the question that wrote each one. */
export function readAnswers(form: FormBinding, encounter: O3Encounter): Map<string, JsonValue> {
  const out = new Map<string, JsonValue>();
  const flat: O3Obs[] = [];
  const walk = (list?: O3Obs[] | null) => { for (const o of list ?? []) { flat.push(o); walk(o.groupMembers); } };
  walk(encounter.obs);
  for (const q of form.questions) {
    const obs = flat.find(o => o.formFieldPath === `rfe-forms-${q.id}`) ?? flat.find(o => conceptOf(o) === q.concept && !o.formFieldPath);
    if (!obs) continue;
    const v = fromO3Value(q, obs.value);
    if (v !== undefined) out.set(q.id, v);
  }
  return out;
}

const conceptOf = (o: O3Obs) => typeof o.concept === 'string' ? o.concept : o.concept?.uuid;

export function fromO3Value(q: QuestionBinding, raw: unknown): JsonValue | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  switch (q.type.type) {
    case 'yes_no': case 'listed': {
      const uuid = typeof raw === 'string' ? raw : (raw as any)?.uuid;
      if (uuid && uuid === q.unknownAnswer) return undefined; // "Not known": Nexo reads an absent answer as unknown.
      return Object.entries(q.answers ?? {}).find(([, u]) => u === uuid)?.[0];
    }
    case 'quantity': { const n = typeof raw === 'number' ? raw : Number(raw); return Number.isFinite(n) ? { value: n, unit: (q.type as any).unit ?? '' } as JsonValue : undefined; }
    case 'instant': case 'datetime': return normalizeInstant(String(raw));
    case 'date': return String(raw).slice(0, 10);
    default: return String(raw);
  }
}

export function toO3Value(q: QuestionBinding, v: JsonValue | undefined): string | undefined {
  if (v === undefined || v === null) return undefined;
  switch (q.type.type) {
    case 'yes_no': case 'listed': return typeof v === 'string' ? q.answers?.[v] : undefined;
    case 'quantity': return typeof v === 'object' && v && 'value' in (v as any) ? String((v as any).value) : typeof v === 'number' ? String(v) : undefined;
    default: return typeof v === 'string' ? v : undefined;
  }
}

/** OpenMRS writes "2026-11-17T09:15:00.000+0000"; Nexo instants carry a colon in the offset. */
export function normalizeInstant(text: string): string {
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?(Z|[+-]\d\d:?\d\d)?$/.exec(text.trim());
  if (!m) return new Date(text).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const zone = !m[3] || m[3] === 'Z' ? 'Z' : m[3].includes(':') ? m[3] : `${m[3].slice(0, 3)}:${m[3].slice(3)}`;
  return `${m[1]}${zone === '+00:00' ? 'Z' : zone}`;
}

const num = (v: JsonValue | undefined) => (v && typeof v === 'object' && 'value' in (v as any) ? (v as any).value : '?');
/** An instant in the reader's own time zone, for example "7 Nov 2026, 01:18". */
const when = (v: JsonValue | undefined) => {
  if (typeof v !== 'string') return '';
  const t = Date.parse(v);
  return Number.isNaN(t) ? v : new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const ABBREVIATIONS: Record<string, string> = { htn: 'hypertension', bp: 'BP', ncd: 'NCD', hc: 'HC', sr: 'SR' };
export function humanize(name: string): string {
  const text = name.split(/[_.]/).filter(Boolean).map(w => ABBREVIATIONS[w] ?? w).join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isJsonRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
