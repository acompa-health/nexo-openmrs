/**
 * Compile a Nexo protocol and its catalog into O3 form schemas and the metadata they need.
 *
 * Inputs: the prepared document, its catalog, and an optional hints file (labels, concept codes, order, and extra
 * fields with a written reason). Output: one FormSpec per task template that a person completes and per host event
 * that a person records. Each spec carries the O3 form JSON and a binding map from questions back to Nexo paths.
 */
import { createHash } from 'node:crypto';
import type { ProtocolDocument } from '../../../../core/protocol/types.ts';
import type { CatalogExtension } from '../../../../core/protocol/contracts.ts';
import { objectTarget, ProtocolModel, type FieldDecl, type NexoType, type Table, type Template, type Workflow } from './model.ts';
import { alwaysRead, fieldReads, readOccurrences, resolveBinding, type FieldRead, type Gate, type Occurrence } from './reads.ts';
import { branchReads, rowSignals, shapesByQuestion, type BranchRead, type Domain, type PotentialGate, type RowSignal } from './signals.ts';
import { groupQuestions, type Group } from './design.ts';
import { toO3 } from './o3.ts';
import { checkLabelDecisions, checkLayout, type FieldDecision, type Layout } from './layout.ts';
import { explainGroup, explainQuestion, type QuestionFacts, type Words } from './explain.ts';
import { isMapping } from './dictionary.ts';

export interface ExtraField { id: string; label: string; type: NexoType; concept?: string; reason: string; after?: string }
export interface Hints {
  concepts?: Record<string, string>;
  values?: Record<string, string>;
  labels?: Record<string, string>;
  /** Why a label replaces authoring words of the protocol, who decided and its status (layout.ts checks it). */
  $labelDecisions?: Record<string, unknown>;
  /**
   * Object types the host looks up instead of asking for. "latest": the patient's latest object of the type.
   * `fromWork`: the host attests the object from the latest work of a template (for example the current
   * prescription from the protocol's own prescription order), mapping fields and setting constants.
   */
  existing?: Record<string, 'latest' | { fromWork: { template: string; fields: Record<string, string>; set?: Record<string, string> } }>;
  /** Object-reference fields a person selects: look up an object, or explicitly attest one at this encounter. */
  references?: Record<string, Record<string, 'latest' | 'attest'>>;
  /** Object fields that carry over from the patient's last object of the same type as a prefill, e.g. comorbidities. */
  carryOver?: string[];
  /** The role that records host events and starts workflows, when no task names one. */
  roles?: { event?: string; start?: Record<string, string> };
  units?: Record<string, string>;
  extra?: Record<string, ExtraField[]>;
  encounterTypes?: Record<string, string>;
  /**
   * The OpenMRS form version starts with a digit. Default "1" keeps existing form UUIDs stable.
   * The form description records the Nexo revision and content identity.
   */
  formVersion?: string;
}

/** How the host fills a value that the form does not ask for. */
export type HostFill =
  | { from: 'patient' } | { from: 'now' } | { from: 'owner' } | { from: 'actor' }
  | { from: 'content'; key: string } | { from: 'latest'; object: string } | { from: 'object'; path: string[] };

export interface QuestionBinding {
  id: string;
  /** Path in the Nexo result or payload, for example ["assessment", "pregnant"]. */
  path: string[];
  object?: string;
  field: string;
  type: NexoType;
  concept: string;
  answers?: Record<string, string>;
  label: string;
  required: boolean;
  hide?: string;
  /** Questions the hide condition reads. */
  gates?: string[];
  /** The template or catalog declares the field required (not optional): Core refuses the completion without it. */
  mandatory?: boolean;
  /**
   * The answer that records "not known". Nexo has no unknown value: an absent answer is unknown, and the protocol
   * then asks for it through its own fallback. Offered on a coded field that the catalog declares optional but a
   * decision reads, so a person who does not know does not have to guess.
   */
  unknownAnswer?: string;
  /** The hide condition in protocol words, for people. */
  shownWhen?: string;
  /** For each question in `gates`, the answers that show this one. */
  shownOn?: Record<string, string[]>;
  why: string;
  extra?: boolean;
  /** The selected object type is resolved by the host, never inferred from missing history. */
  references?: Record<string, 'latest' | 'attest'>;
}

/** A new object the form creates, and how to fill the fields it does not ask for. */
export interface ObjectBinding { path: string[]; object: string; host: Record<string, HostFill>; asked: string[]; /** The result or field that holds it is optional. */ optional?: boolean }

export interface FormSpec {
  name: string;
  uuid: string;
  encounterType: { uuid: string; name: string; description: string };
  kind: 'task' | 'event' | 'update';
  /** For an update form: the object type whose next revision it records. */
  object?: string;
  template?: string;
  event?: string;
  role?: string;
  title: string;
  evidence?: string;
  content: Record<string, FieldDecl>;
  questions: QuestionBinding[];
  objects: ObjectBinding[];
  host: Record<string, HostFill>;
  /** Workflows a person can start with this form's objects. */
  starts: { workflow: string; entry: Record<string, HostFill | { from: 'choice'; values: string[] }> }[];
  /** The production form. */
  o3: O3Form;
  /** The same form for review: every section and question shows its reason on the page (rule D4). */
  review: O3Form;
  /** What the form designer read from the rules. Not part of binding.json: the host does not need it. */
  design: FormDesign;
}

/** The form designer's view of one form (docs/form-design.md). */
export interface FormDesign {
  /** Each row of the tables that hear this form, in priority order: outcome, test shapes and stop questions. */
  rows: RowSignal[];
  /** For each answer of each choice, the questions that a rule can still read. */
  branches: BranchRead[];
  /** The sections of the form, in order, with their questions in order. */
  groups: Group[];
  /** The clinician ⓘ text of each question that has one (rule D3). Only layout decisions set it. */
  info: Record<string, string>;
  /** The layout decision about each question that has one, by question ID. */
  fields: Record<string, FieldDecision>;
  /** The review text: why each section's questions are together, and why each question is asked. */
  review: { sections: Record<string, string[]>; questions: Record<string, string[]> };
}

export interface ConceptSpec {
  /**
   * How the forms, the binding and the Initializer files name the concept. A CIEL concept is named by its mapping,
   * `CIEL:<code>`, which each server resolves to its own concept: the PIH EMR holds most CIEL concepts under PIH UUIDs.
   * A local Nexo concept is named by its UUID, the same on every server.
   */
  reference: string;
  /** The UUID to create the concept with: the CIEL UUID (<code> padded with "A") or the local UUID. */
  uuid: string;
  name: string; fsn?: string; datatype: 'Coded' | 'Numeric' | 'Text' | 'Date' | 'Datetime' | 'N/A'; conceptClass: string; units?: string;
  /** The references of the answers of a coded concept. */
  answers?: string[];
  mapping?: string; key: string;
}

export interface Compiled {
  protocol: { id: string; revision: string; identity: string; status: string };
  forms: FormSpec[];
  concepts: ConceptSpec[];
  /** Problems the form builder fixes in the hints or the layout file. */
  warnings: string[];
  /** Points for the protocol author. The forms ask what the protocol needs; they do not work around these. */
  findings: Finding[];
}

/** A point for the protocol author, found while designing a form (docs/form-design.md, rules A3 and A5). */
export interface Finding {
  form: string;
  /** "removed": the form does not ask an optional question that changes nothing. "unread": the task requires an
   * answer that no rule reads. "any answer": a rule needs an answer but accepts every answer. "unread on a branch":
   * the task requires answers that no rule reads after a choice. */
  kind: 'removed' | 'unread' | 'any answer' | 'unread on a branch';
  questions: string[];
  text: string;
}

export interface O3Form {
  name: string; uuid: string; version: string; description: string; encounterType: string; encounter: string; processor: 'EncounterFormProcessor';
  published: boolean; retired: boolean; referencedForms: unknown[]; pages: { label: string; sections: O3Section[] }[];
  translations?: Record<string, unknown>;
}
export interface O3Section { label: string; isExpanded: string; questions: O3Question[] }
export interface O3Question {
  id: string; label: string; type: string; required?: boolean; questionInfo?: string; value?: unknown; default?: unknown;
  questionOptions: Record<string, unknown>; hide?: { hideWhenExpression: string }; validators?: unknown[]; hideSteppers?: boolean;
}

const NAMESPACE = 'b5f1c3a0-6e0f-5d2e-9f3a-6e65786f2d6f';
export function uuidV5(name: string, namespace = NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
export const cielUuid = (code: string) => code + 'A'.repeat(36 - code.length);
/** A CIEL binding from the hints ("CIEL:5085") is also the reference the forms use; any other concept is local. */
const cielCode = (mapping?: string) => (mapping?.startsWith('CIEL:') ? mapping.slice(5) : undefined);
/** Java's UUID.nameUUIDFromBytes: MD5, version 3. Initializer names a form "794c…_<name>_<version>" this way. */
export function javaNameUuid(text: string): string {
  const hash = createHash('md5').update(Buffer.from(text, 'utf8')).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30; hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
const INITIALIZER_FORM_SEED = '794c4598-ab82-47ca-8d18-483a8abe6f4f';

const ABBREVIATIONS: Record<string, string> = { htn: 'hypertension', bp: 'BP', sr: 'SR', id: 'ID', ncd: 'NCD', hc: 'HC' };
export function humanize(name: string): string {
  const words = name.split(/[_.]/).filter(Boolean).map(w => ABBREVIATIONS[w] ?? w);
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const SKIP_TYPES = new Set(['actor', 'owner']);

export function compile(document: ProtocolDocument, catalog: CatalogExtension, content: { identity: string }, hints: Hints = {}, layoutFile?: unknown): Compiled {
  const model = new ProtocolModel(document, catalog);
  const layout: Layout = checkLayout(layoutFile);
  if ((hints as any).help) throw new Error('The hints file may not set "help". The ⓘ text is a layout decision: put it in forms.layout.json with its reason.');
  checkLabelDecisions(hints.$labelDecisions, hints.labels);
  const reads = fieldReads(model);
  const warnings: string[] = [];
  const findings: Finding[] = [];
  const concepts = new Map<string, ConceptSpec>();
  const protocolId = (document as any).id as string, revision = (document as any).revision as string;
  const label = (key: string, fallback: string) => hints.labels?.[key] ?? fallback;
  const unitLabel = (u?: string) => (u ? hints.units?.[u] ?? u : undefined);
  const formVersion = hints.formVersion ?? '1';
  // D1: a label a person reads on a form comes from the hints file. One made from a field name is a fallback, and the
  // compiler warns once per name, listing where it shows.
  const fallbacks = new Map<string, Set<string>>();
  const shown = (keys: string[], word: string, where: string) => {
    for (const k of keys) if (hints.labels?.[k] !== undefined) return hints.labels[k];
    (fallbacks.get(word) ?? fallbacks.set(word, new Set()).get(word)!).add(where);
    return humanize(word);
  };
  const allTables = [...model.tables()].map(x => x.table);
  const taskTitle = (id: string) => model.templates[id] ? label(`title:${id}`, model.templates[id].title) : label(id, humanize(id));
  const words: Words = {
    step: table => { const work = allTables.find(t => t.id === table)?.on.work; const t = work ? model.handleTemplates(work)[0] : undefined; return t ? taskTitle(t.id) : undefined; },
    task: taskTitle,
    plain: word => label(word, humanize(word)),
  };
  if (!/^\d/.test(formVersion)) throw new Error(`formVersion "${formVersion}" must start with a digit (OpenMRS rule).`);

  const valueConcept = (value: string): string => {
    const mapped = hints.values?.[value], code = cielCode(mapped);
    const uuid = code ? cielUuid(code) : uuidV5(`${protocolId}/value/${value}`), reference = code ? mapped! : uuid;
    const valueLabel = label(`value:${value}`, label(value, humanize(value)));
    if (!concepts.has(reference)) concepts.set(reference, { reference, uuid, key: `value:${value}`, name: valueLabel, fsn: `${valueLabel} (Nexo answer)`, datatype: 'N/A', conceptClass: 'Misc', mapping: mapped });
    return reference;
  };

  const questionConcept = (key: string, type: NexoType, name: string): { concept: string; answers?: Record<string, string> } => {
    const mapped = hints.concepts?.[key], code = cielCode(mapped);
    const uuid = code ? cielUuid(code) : uuidV5(`${protocolId}/concept/${key}`), reference = code ? mapped! : uuid;
    const base = { reference, uuid, key, name, mapping: mapped };
    let answers: Record<string, string> | undefined;
    let spec: ConceptSpec;
    switch (type.type) {
      case 'yes_no': answers = { yes: valueConcept('yes'), no: valueConcept('no') }; spec = { ...base, datatype: 'Coded', conceptClass: 'Question', answers: Object.values(answers) }; break;
      case 'listed': answers = Object.fromEntries(((type as any).values as string[]).map(v => [v, valueConcept(v)])); spec = { ...base, datatype: 'Coded', conceptClass: 'Question', answers: Object.values(answers) }; break;
      case 'quantity': spec = { ...base, datatype: 'Numeric', conceptClass: 'Finding', units: unitLabel((type as any).unit) }; break;
      case 'instant': case 'datetime': spec = { ...base, datatype: 'Datetime', conceptClass: 'Question' }; break;
      case 'date': spec = { ...base, datatype: 'Date', conceptClass: 'Question' }; break;
      default: spec = { ...base, datatype: 'Text', conceptClass: 'Question' };
    }
    // A readable, unique fully specified name: the label and the object it belongs to.
    const owner = key.includes('.extra.') ? 'extra' : key.split('.')[0];
    spec.fsn = `${name} (Nexo ${label(owner, humanize(owner)).toLowerCase()})`;
    const existing = concepts.get(reference);
    if (existing && existing.datatype !== spec.datatype) warnings.push(`Concept ${key} is ${spec.datatype} here but ${existing.datatype} at ${existing.key}.`);
    if (!existing) concepts.set(reference, spec);
    return { concept: reference, answers };
  };

  const forms: FormSpec[] = [];
  for (const t of model.personTemplates()) forms.push(buildForm(model, reads, t, undefined));
  for (const [event, decl] of Object.entries(model.events)) {
    const hasObject = Object.values(decl.payload ?? {}).some(f => objectTarget(f.type));
    if (hasObject && model.listeners(event).length) forms.push(buildForm(model, reads, undefined, event));
  }
  // One update form per object type that rules read: it records the next revision of an existing object when the
  // protocol asks for missing information (`collect_information`).
  for (const object of [...new Set(reads.map(r => r.object))].sort()) {
    if (object === 'patient' || !model.objects[object]) continue;
    forms.push(updateForm(object));
  }

  function updateForm(object: string): FormSpec {
    const name = `update_${object}`;
    const objectName = shown([object], object, name);
    const title = `Update ${objectName.toLowerCase()}`;
    const questions: QuestionBinding[] = [];
    const binding: ObjectBinding = { path: [object], object, host: {}, asked: [] };
    const facts = new Map<string, QuestionFacts>();
    for (const [field, decl] of Object.entries(model.objects[object].fields)) {
      const reference = referenceQuestion(object, field, [object, field], decl);
      if (reference) { binding.asked.push(field); questions.push(reference); continue; }
      if (decl.type.type === 'reference') { binding.host[field] = { from: 'object', path: ['previous', field] }; continue; }
      if (field === 'time' && (decl.type.type === 'instant' || decl.type.type === 'datetime')) { binding.host[field] = { from: 'object', path: ['previous', field] }; continue; }
      const key = `${object}.${field}`;
      const qLabel = shown([key, field], field, `${name}.${field}`);
      for (const v of decl.type.type === 'listed' ? (decl.type as any).values as string[] : []) shown([`value:${v}`, v], v, `${name}.${field}`);
      const { concept, answers } = questionConcept(key, decl.type, qLabel);
      const tables = [...new Set(reads.filter(r => r.object === object && r.field === field).map(r => r.table))];
      binding.asked.push(field);
      // A field the catalog requires is required here too: the host records every field the form asks, and Core
      // refuses a revision without a required field.
      const mandatory = !decl.optional;
      questions.push({ id: `${object}__${field}`, path: [object, field], object, field, type: decl.type, concept, answers, label: qLabel, required: mandatory,
        ...(mandatory ? { mandatory } : {}),
        why: mandatory ? `Every revision of the ${objectName.toLowerCase()} has it.${tables.length ? ` Read by ${tables.join(', ')}.` : ''}`
          : tables.length ? `Read by ${tables.join(', ')}. Required when the protocol names it as missing.` : 'Declared by the catalog. No rule reads it.' });
      facts.set(`${object}__${field}`, { now: [], later: tables, findings: [] });
    }
    return finish({ name, title, kind: 'update', object, content: {}, questions, objects: [binding], host: {}, starts: [], design: designOf(name, 'update', questions, [], [], applyLayout(name, [{ id: object, label: objectName, questions: questions.map(q => q.id) }]), facts),
      evidence: `A new revision of this ${objectName.toLowerCase()}. The protocol reads the fields it named as missing.` }, name);
  }

  function referenceQuestion(object: string, field: string, path: string[], decl: FieldDecl): QuestionBinding | undefined {
    const key = `${object}.${field}`, references = hints.references?.[key];
    if (!references) return undefined;
    if (decl.type.type !== 'reference' || (decl.type as any).target !== 'object')
      throw new Error(`${key}: reference choices need a generic object reference.`);
    for (const [type, source] of Object.entries(references)) {
      const contract = model.objects[type];
      if (!contract || !['latest', 'attest'].includes(source)) throw new Error(`${key}: invalid reference choice ${type}.`);
      if (source === 'attest' && Object.entries(contract.fields).some(([name, d]) =>
        !(name === 'patient' && objectTarget(d.type) === 'patient') &&
        !(d.type.type === 'reference' && (d.type as any).target === 'actor') &&
        !(name === 'time' && d.type.type === 'instant')))
        throw new Error(`${key}: ${type} needs fields that an encounter cannot attest.`);
    }
    if (!Object.keys(references).length) throw new Error(`${key}: reference choices must not be empty.`);
    const type: NexoType = { type: 'listed', values: Object.keys(references) };
    const qLabel = shown([key, field], field, key);
    const { concept, answers } = questionConcept(key, type, qLabel);
    return { id: path.join('__'), path, object, field, type, concept, answers, references, label: qLabel,
      required: !decl.optional, mandatory: !decl.optional, why: 'Select the object evidence for this field.' };
  }

  /** The ⓘ text from the layout decisions file, and the review text for each section and question (D3, D4). */
  function designOf(form: string, kind: FormSpec['kind'], questions: QuestionBinding[], rows: RowSignal[], branches: BranchRead[], groups: Group[], facts: Map<string, QuestionFacts>): FormDesign {
    const info: Record<string, string> = {};
    const fields: Record<string, FieldDecision> = {};
    for (const [path, d] of Object.entries(layout[form]?.fields ?? {})) {
      const q = questions.find(x => x.path.join('.') === path);
      if (!q) { warnings.push(`${form}: forms.layout.json decides about the question "${path}", but the form does not ask it.`); continue; }
      fields[q.id] = d;
      const coded = q.type.type === 'yes_no' || q.type.type === 'listed';
      if (d.control && !coded) throw new Error(`forms.layout.json: ${form}.fields.${path}.control applies only to a question with listed answers.`);
      if (d.orientation && !coded) throw new Error(`forms.layout.json: ${form}.fields.${path}.orientation applies only to radio answers.`);
      const f = facts.get(q.id);
      if (f && d.info) f.info = d;
      if (!d.info || d.info === 'none') continue;
      info[q.id] = d.info;
      // D3: the ⓘ is for a clinician. At most two short sentences, and no builder words such as table names.
      if (/\b[a-z]+_[a-z0-9_]+\b/.test(d.info)) warnings.push(`${form}: the ⓘ of "${path}" uses a builder word. Write it for a clinician.`);
      // A sentence ends at a stop before a capital letter or at the end ("Fig. 9" is not an end).
      if ((d.info.match(/[.!?](?=\s+[A-Z]|\s*$)/g) ?? []).length > 2) warnings.push(`${form}: the ⓘ of "${path}" has more than two sentences.`);
    }
    const review = { sections: {} as Record<string, string[]>, questions: {} as Record<string, string[]> };
    for (const g of groups) review.sections[g.id] = explainGroup(g, words);
    for (const q of questions) review.questions[q.id] = explainQuestion(q, facts.get(q.id) ?? { now: [], later: [], findings: [] }, kind, words);
    return { rows, branches, groups, info, fields, review };
  }

  /** Section headings from the layout decisions file. A stop section without one shows the object's name. */
  function applyLayout(form: string, groups: Group[]): Group[] {
    const decided = layout[form]?.groups ?? {};
    for (const g of groups) {
      const d = decided[g.id];
      if (d) { g.label = d.label; g.decision = d; delete g.fallbackLabel; }
      else if (g.fallbackLabel) warnings.push(`${form}: the section for rule ${g.stop!.row} has no heading, so it shows "${g.label}". Add one in forms.layout.json.`);
    }
    for (const id of Object.keys(decided)) if (!groups.some(g => g.id === id))
      warnings.push(`${form}: forms.layout.json gives a heading to section "${id}", but the rules make no such section.`);
    return groups;
  }

  function finish(partial: Omit<FormSpec, 'uuid' | 'encounterType' | 'o3' | 'review'>, key: string): FormSpec {
    const etName = hints.encounterTypes?.[key] ?? `Nexo ${shorten(partial.title, 44)}`;
    const encounterType = { uuid: uuidV5(`${protocolId}/encounter-type/${partial.name}`), name: etName, description: `Nexo ${partial.kind} ${key} (${protocolId})` };
    const formName = `Nexo: ${partial.title}`.slice(0, 255);
    const spec: FormSpec = { ...partial, uuid: javaNameUuid(`${INITIALIZER_FORM_SEED}_${formName}_${formVersion}`), encounterType, o3: undefined as unknown as O3Form, review: undefined as unknown as O3Form };
    const provenance = `Nexo ${protocolId} ${revision} (${content.identity}).`;
    spec.o3 = toO3(spec, formName, formVersion, provenance, hints, label, 'production');
    spec.review = toO3(spec, formName, formVersion, provenance, hints, label, 'review');
    return spec;
  }

  function buildForm(model: ProtocolModel, reads: FieldRead[], template: Template | undefined, event: string | undefined): FormSpec {
    const name = template ? template.id : `event_${event!.replace(/\W+/g, '_')}`;
    // A template title can be renamed only by a "title:<template>" label, so an object label never renames a task.
    const title = template ? label(`title:${template.id}`, template.title) : shown([event!], event!.split('.').reverse().join('_'), name);
    if (template?.performer?.role) shown([template.performer.role], template.performer.role, name);
    const declared: Record<string, FieldDecl> = template ? template.result ?? {} : model.events[event!].payload;
    const contentDecl = template?.content ?? {};
    const questions: QuestionBinding[] = [];
    const objects: ObjectBinding[] = [];
    const host: Record<string, HostFill> = {};
    const consumers = template ? model.consumers(template.id) : model.listeners(event!);
    const root = template ? 'event.payload.result.' : 'event.payload.';

    // Map consumer inputs (bound inside this form's result or payload) to form paths.
    const inputPaths = new Map<string, { table: string; path: string[] }[]>();
    for (const { table } of consumers) for (const [input, d] of Object.entries(table.inputs ?? {})) {
      if (typeof d.binding !== 'string' || !d.binding.startsWith(root)) continue;
      const path = d.binding.slice(root.length).split('.');
      (inputPaths.get(input) ?? inputPaths.set(input, []).get(input)!).push({ table: table.id, path });
    }

    const addQuestion = (path: string[], object: string | undefined, field: string, decl: FieldDecl, mandatory: boolean) => {
      const key = object ? `${object}.${field}` : `${name}.${field}`;
      const qLabel = shown([key, field], field, `${name}.${path.join('.')}`);
      for (const v of decl.type.type === 'listed' ? (decl.type as any).values as string[] : []) shown([`value:${v}`, v], v, `${name}.${path.join('.')}`);
      const { concept, answers } = questionConcept(key, decl.type, qLabel);
      questions.push({ id: path.join('__'), path, object, field, type: decl.type, concept, answers, label: qLabel, required: false, why: '', mandatory });
    };

    const expandObject = (path: string[], object: string, depth: number, mandatory: boolean) => {
      const contract = model.objects[object];
      if (!contract) { warnings.push(`${name}: object ${object} has no catalog contract.`); return; }
      const binding: ObjectBinding = { path, object, host: {}, asked: [], ...(mandatory ? {} : { optional: true }) };
      objects.push(binding);
      for (const [field, decl] of Object.entries(contract.fields)) {
        const reference = referenceQuestion(object, field, [...path, field], decl);
        if (reference) { binding.asked.push(field); questions.push(reference); continue; }
        const target = objectTarget(decl.type);
        const contentKey = Object.entries(contentDecl).find(([k, c]) => k === field || (target && objectTarget(c.type) === target))?.[0];
        if (target === 'patient') { binding.host[field] = { from: 'patient' }; continue; }
        if (decl.type.type === 'reference' && contentKey) { binding.host[field] = { from: 'content', key: contentKey }; continue; }
        if (decl.type.type === 'reference' && !target) {
          const ref = (decl.type as any).target;
          if (ref === 'actor' || ref === 'owner') binding.host[field] = { from: ref };
          else warnings.push(`${name}: ${object}.${field} needs object reference choices in the hints.`);
          continue;
        }
        if (target && hints.existing?.[target]) { binding.host[field] = { from: 'latest', object: target }; continue; }
        if (target && depth < 2) { binding.host[field] = { from: 'object', path: [...path, field] }; expandObject([...path, field], target, depth + 1, mandatory && !decl.optional); continue; }
        if (target) { warnings.push(`${name}: ${object}.${field} references ${target}, which the form cannot fill.`); continue; }
        if (field === 'time' && (decl.type.type === 'instant' || decl.type.type === 'datetime')) { binding.host[field] = { from: 'now' }; continue; }
        if (contentKey && !target) { binding.host[field] = { from: 'content', key: contentKey }; continue; }
        binding.asked.push(field);
        addQuestion([...path, field], object, field, decl, mandatory && !decl.optional);
      }
    };

    for (const [field, decl] of Object.entries(declared)) {
      const target = objectTarget(decl.type);
      if (field === 'asserted_at') { host[field] = { from: 'now' }; continue; }
      if (target === 'patient') { host[field] = { from: 'patient' }; continue; }
      if (target && hints.existing?.[target]) { host[field] = { from: 'latest', object: target }; continue; }
      if (target) { host[field] = { from: 'object', path: [field] }; expandObject([field], target, 0, !decl.optional); continue; }
      if (decl.type.type === 'reference') { host[field] = { from: 'actor' }; continue; }
      addQuestion([field], undefined, field, decl, !decl.optional);
    }

    // Required and conditional, from the rules that read each question.
    const formInputs = new Set<string>();
    const questionOf = new Map<string, QuestionBinding>();
    for (const [input, uses] of inputPaths) {
      const q = questions.find(q => uses.some(u => u.path.join('__') === q.id));
      if (q) { questionOf.set(input, q); if (q.type.type === 'listed' || q.type.type === 'yes_no') formInputs.add(input); }
    }
    const occurrences = new Map<string, Occurrence[]>();
    let alwaysByQuestion = new Set<string>();
    const gateOf = new Map<string, PotentialGate>();
    const readByRule = new Set<string>();
    const readLater = new Set<string>();
    const removed: QuestionBinding[] = [];
    const facts = new Map<string, QuestionFacts>();
    for (const { table, workflow } of consumers) {
      const occ = readOccurrences(table, workflow, formInputs);
      for (const [input, list] of occ) {
        const q = questionOf.get(input);
        if (!q) continue;
        if (alwaysRead(list)) alwaysByQuestion.add(q.id);
        (occurrences.get(q.id) ?? occurrences.set(q.id, []).get(q.id)!).push(...list);
      }
    }
    for (const q of questions) {
      const direct = [...inputPaths.entries()].filter(([, uses]) => uses.some(u => u.path.join('__') === q.id));
      const decisionRead = direct.some(([input]) => consumers.some(c => c.table.inputs?.[input]?.required === 'decision'));
      // Another form's result is a different object instance, even when both forms use the same catalog type.
      const later = q.object ? reads.filter(r => r.object === q.object && r.field === q.field && !r.binding.startsWith('event.payload.result.') && !consumers.some(c => c.table.id === r.table)) : [];
      const tables = [...new Set([...direct.flatMap(([, u]) => u.map(x => x.table)), ...later.map(r => r.table)])];
      q.required = decisionRead || later.some(r => r.required === 'decision');
      const occ = occurrences.get(q.id);
      // The answers of other questions that every rule reading this one needs, whether or not it may hide.
      const potential = occ?.length && !alwaysByQuestion.has(q.id) && later.length === 0 ? hideExpression(occ, questionOf, q) : undefined;
      if (potential?.allowed && !potential.complex && !potential.never) gateOf.set(q.id, { gates: potential.gates!, allowed: potential.allowed });
      if (tables.length && !potential?.never) readByRule.add(q.id);
      if (later.length) readLater.add(q.id);
      facts.set(q.id, { now: [...new Set(direct.flatMap(([, u]) => u.map(x => x.table)))], later: [...new Set(later.map(r => r.table))], findings: [] });
      // A field the template or catalog requires is never hidden: Core refuses a completion without it.
      const conditional = q.required && !q.mandatory ? potential : undefined;
      if (q.mandatory) {
        q.required = true;
        q.why = `The ${template ? 'task' : 'event'} declares it required.${tables.length ? ` Read by ${tables.join(', ')}.` : ' No rule reads it.'}`;
        if (!tables.length) findings.push({ form: name, kind: 'unread', questions: [q.id], text: `${name}: the ${template ? 'task' : 'event'} requires "${q.label}" (${q.path.join('.')}), but no rule reads it. The form still asks it, because the pathway refuses the step without it.` });
        continue;
      }
      if (conditional?.never) {
        // A5: an optional question that no answer of which changes anything is not asked.
        removed.push(q);
        findings.push({ form: name, kind: 'removed', questions: [q.id], text: `${name}: the form does not ask "${q.label}" (${q.path.join('.')}). It is optional, and no answer to it changes the next step: other answers already settle each rule that looks at it (${tables.join(', ')}).` });
      } else if (conditional?.complex) {
        q.why = `Read on the main path, when ${conditional.readable}. Read by ${tables.join(', ')}.`;
      } else if (conditional) {
        q.hide = conditional.expression; q.shownWhen = conditional.readable; q.gates = conditional.gates; q.shownOn = conditional.allowed;
        q.why = `Every rule that reads it first needs: ${conditional.readable}. Read by ${tables.join(', ')}.`;
      } else q.why = tables.length ? `Read by ${tables.join(', ')}.` : 'Declared by the catalog. No rule reads it.';
      if (!tables.length) {
        q.required = false;
        removed.push(q);
        findings.push({ form: name, kind: 'removed', questions: [q.id], text: `${name}: the form does not ask "${q.label}" (${q.path.join('.')}). It is optional, and no rule reads it.` });
      }
    }
    for (const q of removed) {
      questions.splice(questions.indexOf(q), 1);
      for (const o of objects) if (o.path.join('.') === q.path.slice(0, -1).join('.')) o.asked = o.asked.filter(f => f !== q.field);
      for (const [input, x] of questionOf) if (x === q) questionOf.delete(input);
    }
    // A required coded field that the catalog declares optional gets a "Not known" answer.
    for (const q of questions) {
      if (!q.required || q.mandatory || !(q.type.type === 'yes_no' || q.type.type === 'listed')) continue;
      q.unknownAnswer = valueConcept('not_known');
      const spec = concepts.get(q.concept);
      if (spec?.answers && !spec.answers.includes(q.unknownAnswer)) spec.answers.push(q.unknownAnswer);
      q.why += ' "Not known" leaves it unknown; the protocol then asks for it.';
    }
    // A field may not hide behind a question that hides behind it: drop every hide on a cycle.
    const onCycle = (start: QuestionBinding) => {
      const seen = new Set<string>(); const stack = [...(start.gates ?? [])];
      while (stack.length) { const id = stack.pop()!; if (id === start.id) return true; if (seen.has(id)) continue; seen.add(id); stack.push(...(questions.find(x => x.id === id)?.gates ?? [])); }
      return false;
    };
    for (const q of questions.filter(onCycle)) {
      warnings.push(`${name}: ${q.path.join('.')} hid behind a question that hides behind it; it is always shown.`);
      delete q.hide; delete q.shownWhen; delete q.gates; delete q.shownOn;
    }

    // The form designer's signals: row outcomes, test shapes and stop questions, and branch reads.
    const domain: Domain = id => {
      const t = questions.find(x => x.id === id)?.type;
      return t?.type === 'yes_no' ? ['yes', 'no'] : t?.type === 'listed' ? (t as any).values as string[] : undefined;
    };
    const inputToQuestion = new Map([...questionOf].map(([input, q]) => [input, q.id]));
    const claimed = new Set<string>();
    const rows = consumers.flatMap(({ table, workflow }) => rowSignals(table, workflow, inputToQuestion, domain, claimed));
    const branches = branchReads(questions.filter(x => readByRule.has(x.id)).map(x => x.id), domain, gateOf);
    // A question changes nothing when every test of it accepts any answer and no later step reads it.
    const shapes = shapesByQuestion(rows);
    const inert = new Set([...shapes].filter(([id, s]) => s.size === 1 && s.has('any') && !readLater.has(id)).map(([id]) => id));
    const byId = new Map(questions.map(q => [q.id, q]));
    const answerLabel = (v: string) => label(`value:${v}`, label(v, humanize(v)));
    const list = (ids: string[]) => ids.map(id => byId.get(id)!.label).join(', ').replace(/, ([^,]*)$/, ' and $1');
    for (const id of inert) {
      const q = byId.get(id)!;
      if (q.required) findings.push({ form: name, kind: 'any answer', questions: [id], text: `${name}: "${q.label}" (${q.path.join('.')}) must be answered, but every rule accepts any answer and no later step reads it. The form keeps it, because the rule cannot run without an answer.` });
    }
    // A3: a field the task requires but that no rule reads after one answer of a choice. Reported only: the form
    // cannot hide it, because Core refuses a completion without it.
    for (const b of branches) {
      const unread = questions.filter(q => q.mandatory && q.id !== b.choice && readByRule.has(q.id) && !b.reads.includes(q.id)).map(q => q.id);
      if (unread.length) findings.push({ form: name, kind: 'unread on a branch', questions: unread,
        text: `${name}: when "${byId.get(b.choice)!.label}" is "${answerLabel(b.value)}", no rule reads ${list(unread)}. The task still requires ${unread.length > 1 ? 'them' : 'it'}, so the form still asks ${unread.length > 1 ? 'them' : 'it'}.` });
    }

    // Extra fields from the hints, each with its reason.
    for (const x of hints.extra?.[template?.id ?? event!] ?? []) {
      const { concept, answers } = questionConcept(`${name}.extra.${x.id}`, x.type, x.label);
      const code = cielCode(x.concept), reference = code ? x.concept! : concept;
      if (code) { const c = concepts.get(concept); if (c) { concepts.delete(concept); concepts.set(reference, { ...c, reference, uuid: cielUuid(code), mapping: x.concept }); } }
      questions.push({ id: `extra__${x.id}`, path: ['extra', x.id], field: x.id, type: x.type, concept: reference, answers, label: x.label, required: false, why: `Added by the hints file: ${x.reason}`, extra: true });
    }

    const starts = template ? [] : startable(model, event!, objects);
    const groups = applyLayout(name, groupQuestions(questions, rows, inert, (path, object) => path.length ? shown([object ?? path.join('.')], path.at(-1)!, name) : 'Decision'));
    for (const r of rows) for (const id of r.stopQuestions) { const f = facts.get(id); if (f) f.stop = { row: r.row, outcome: r.outcome }; }
    for (const q of questions) {
      const f = facts.get(q.id) ?? facts.set(q.id, { now: [], later: [], findings: [] }).get(q.id)!;
      f.shapes = shapes.get(q.id);
      // D3: an ⓘ may help when the question shows after an earlier answer, or a later step uses it.
      f.candidate = q.hide ? 'it shows only after an earlier answer' : readLater.has(q.id) ? 'a later step uses the answer' : undefined;
    }
    for (const x of findings) if (x.form === name) for (const id of x.questions) facts.get(id)?.findings.push(x.text.slice(name.length + 2));
    return finish({
      name, kind: template ? 'task' : 'event', template: template?.id, event, role: template?.performer?.role, title,
      evidence: template?.completion?.evidence, content: contentDecl, questions, objects, host, starts, design: designOf(name, template ? 'task' : 'event', questions, rows, branches, groups, facts),
    }, template?.id ?? event!);
  }

  /**
   * A field is conditional on another form question only when every way a rule can read it tests that question.
   * The allowed answers are the union over those ways. Hide the field until the answer is one of them.
   * Returns undefined when no question constrains every way.
   */
  function hideExpression(occ: Occurrence[], questionOf: Map<string, QuestionBinding>, self: QuestionBinding): { expression: string; readable: string; complex?: boolean; never?: boolean; gates?: string[]; allowed?: Record<string, string[]> } | undefined {
    const domain = (q: QuestionBinding) => q.type.type === 'yes_no' ? ['yes', 'no'] : ((q.type as any).values as string[] ?? []);
    // A way of reading the field is impossible when its own tests on one question leave no answer.
    const possible = (o: Occurrence) => [...new Set(o.map(g => g.input))].every(input => {
      const q = questionOf.get(input);
      if (!q) return true;
      let here = new Set(domain(q));
      for (const g of o.filter(g => g.input === input)) here = new Set([...here].filter(v => g.negate ? !g.values.includes(v) : g.values.includes(v)));
      return here.size > 0;
    });
    occ = occ.filter(possible);
    if (!occ.length) return { expression: '', readable: '', never: true, gates: [] };
    const detail = !(self.type.type === 'yes_no' || self.type.type === 'listed');
    occ = occ.map(o => o.filter(g => detail || !g.fromOr));
    const inputs = new Set(occ.flatMap(o => o.map(g => g.input)));
    const terms: string[] = [], words: string[] = [], gates: string[] = [], allowedBy: Record<string, string[]> = {};
    for (const input of inputs) {
      const q = questionOf.get(input);
      if (!q || q.id === self.id) continue;
      let allowed: Set<string> | undefined = new Set();
      for (const o of occ) {
        const gates = o.filter(g => g.input === input);
        if (!gates.length) { allowed = undefined; break; }
        let here = new Set(domain(q));
        for (const g of gates) here = new Set([...here].filter(v => g.negate ? !g.values.includes(v) : g.values.includes(v)));
        for (const v of here) allowed.add(v);
      }
      if (!allowed || allowed.size === domain(q).length) continue;
      const refs = [...allowed].map(v => q.answers?.[v]).filter(Boolean) as string[];
      if (refs.some(isMapping)) {
        // The form engine replaces a mapped answer with the server's UUID, which the build cannot know. Test the
        // position among concept answers instead; dropdown placeholders have no concept and must not shift it.
        const positions = [...allowed].map(v => domain(q).indexOf(v)).filter(i => i >= 0).sort((a, b) => a - b);
        terms.push(`[${positions.join(', ')}].indexOf(${answerPosition(q.id)}) === -1`);
      } else terms.push(refs.length ? `!(${refs.map(u => `${q.id} === '${u}'`).join(' || ')})` : 'true');
      gates.push(q.id);
      allowedBy[q.id] = [...allowed];
      words.push(`${q.label} is ${[...allowed].map(v => v === 'yes' ? 'Yes' : v === 'no' ? 'No' : label(`value:${v}`, label(v, humanize(v)))).join(' or ')}`);
    }
    if (terms.length > 3) return { expression: '', readable: words.join(' and '), complex: true, gates };
    return terms.length ? { expression: terms.join(' || '), readable: words.join(' and '), gates, allowed: allowedBy } : undefined;
  }

  for (const [word, where] of fallbacks)
    warnings.push(`The label "${humanize(word)}" is made from the name "${word}" (${[...where].join(', ')}). Add a clinical label in the hints file.`);
  for (const form of Object.keys(layout)) if (!forms.some(f => f.name === form))
    warnings.push(`forms.layout.json names the form "${form}", but the protocol makes no such form.`);
  for (const [what, key] of [['encounter type name', (f: FormSpec) => f.encounterType.name], ['form name', (f: FormSpec) => f.o3.name], ['form UUID', (f: FormSpec) => f.uuid]] as const) {
    const seen = new Map<string, string>();
    for (const f of forms) {
      const k = key(f);
      if (seen.has(k)) throw new Error(`Two forms (${seen.get(k)}, ${f.name}) share the ${what} "${k}". OpenMRS needs it unique.`);
      seen.set(k, f.name);
    }
  }
  return {
    protocol: { id: protocolId, revision, identity: content.identity, status: (document as any).status },
    forms, concepts: [...concepts.values()], warnings, findings,
  };
}

/** Workflows that a person can start with the objects this event form creates. */
function startable(model: ProtocolModel, event: string, objects: ObjectBinding[]): FormSpec['starts'] {
  const created = new Map(objects.filter(o => o.path.length === 1).map(o => [o.object, o.path]));
  const out: FormSpec['starts'] = [];
  for (const w of model.workflows) {
    const entry: FormSpec['starts'][number]['entry'] = {};
    let ok = w.tables.some(t => t.on.event === 'workflow.started');
    for (const [name, decl] of Object.entries(w.inputs)) {
      if (typeof decl.binding !== 'string' || !decl.binding.startsWith('entry.')) continue;
      const key = decl.binding.slice('entry.'.length), target = objectTarget(decl.type);
      if (target === 'patient') entry[key] = { from: 'patient' };
      else if (decl.type?.type === 'reference' && (decl.type as any).target === 'owner') entry[key] = { from: 'owner' };
      else if (target && created.has(target)) entry[key] = { from: 'object', path: created.get(target)! };
      else if (decl.type?.type === 'listed') entry[key] = { from: 'choice', values: (decl.type as any).values };
      else if (decl.required === 'entry') { ok = false; break; }
      void name;
    }
    if (ok && Object.values(entry).some(e => e.from === 'object')) out.push({ workflow: w.id, entry });
  }
  void event;
  return out;
}

/**
 * An O3 expression for the position of the chosen answer of question `id` among its concept answers, or -1 when
 * none is chosen. It excludes renderer placeholders, which have no concept. It reads the form engine's own fields
 * (`allFields`, after the engine resolved each mapped answer to the server's concept) through its
 * `extractRepeatingGroupValues` helper, because the expression evaluator refuses an arrow function over a field object.
 */
export function answerPosition(id: string): string {
  return `extractRepeatingGroupValues('concept', allFields[extractRepeatingGroupValues('id', allFields).indexOf('${id}')].questionOptions.answers).filter(Boolean).indexOf(${id})`;
}

function shorten(text: string, max: number) {
  const plain = text.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length <= max ? plain : `${plain.slice(0, max - 1).trimEnd()}…`;
}

export type { NexoType, Template, Table, Workflow, FieldRead };
export { resolveBinding };
