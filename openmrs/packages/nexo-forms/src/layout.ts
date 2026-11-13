/**
 * Layout decisions: `protocols/<name>/forms.layout.json`. The form designer derives every section, order and control
 * from the rules (docs/form-design.md). This file holds only the decisions that differ from that default, for
 * example a section heading. Each entry says why (`reason`), who decided (`decidedBy`: "agent" or "Kuang") and its
 * review status (`status`: "review pending" or "accepted"), so a person can find and revisit every choice.
 *
 * The file never sets required, never hides a question, and never changes a rule. The hints file keeps its own
 * contract (labels, concepts, host values, extra fields). Its `$labelDecisions` use the same decision shape.
 */

export const DECIDERS = ['agent', 'Kuang'] as const;
export const STATUSES = ['review pending', 'accepted'] as const;
export interface Decision { reason: string; decidedBy: (typeof DECIDERS)[number]; status: (typeof STATUSES)[number] }
export interface GroupDecision extends Decision { label: string }
/**
 * `info`: the clinician ⓘ text for the production build, or "none" to record that the question gets no ⓘ.
 * `control`: "radio" or "dropdown" for a coded question, instead of the choice by answer count (rule C2).
 * `orientation`: "vertical" or "horizontal" radio answers (rule F2; vertical by default).
 */
export interface FieldDecision extends Decision { info?: string; control?: 'radio' | 'dropdown'; orientation?: 'vertical' | 'horizontal' }
/** Fields are named by their Nexo path, for example "potassium_result.potassium". */
export interface FormLayout { groups?: Record<string, GroupDecision>; fields?: Record<string, FieldDecision> }
/** Form name (as in the report: a template ID, `event_<type>` or `update_<object>`) → its decisions. */
export type Layout = Record<string, FormLayout>;

const GROUP_KEYS = ['label'];
const FIELD_KEYS = ['info', 'control', 'orientation'];

/** Check the file's shape. A wrong entry stops the build: a layout decision must always be readable and justified. */
export function checkLayout(raw: unknown): Layout {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('forms.layout.json must be an object of forms.');
  const out: Layout = {};
  for (const [form, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (form.startsWith('$')) continue;
    if (!entry || typeof entry !== 'object') throw new Error(`forms.layout.json: ${form} must be an object.`);
    for (const key of Object.keys(entry)) if (key !== 'groups' && key !== 'fields') throw new Error(`forms.layout.json: ${form}.${key} is not a layout decision. A form may set "groups" and "fields".`);
    const groups = (entry as any).groups ?? {};
    for (const [id, g] of Object.entries(groups as Record<string, any>)) {
      checkDecision(`${form}.groups.${id}`, g, GROUP_KEYS);
      if (typeof g.label !== 'string' || !g.label.trim()) throw new Error(`forms.layout.json: ${form}.groups.${id} needs a "label".`);
    }
    for (const [path, f] of Object.entries(((entry as any).fields ?? {}) as Record<string, any>)) {
      checkDecision(`${form}.fields.${path}`, f, FIELD_KEYS);
      if (f.info !== undefined && (typeof f.info !== 'string' || !f.info.trim())) throw new Error(`forms.layout.json: ${form}.fields.${path}.info must be text, or "none".`);
      if (f.control !== undefined && !['radio', 'dropdown'].includes(f.control)) throw new Error(`forms.layout.json: ${form}.fields.${path}.control must be "radio" or "dropdown".`);
      if (f.orientation !== undefined && !['vertical', 'horizontal'].includes(f.orientation)) throw new Error(`forms.layout.json: ${form}.fields.${path}.orientation must be "vertical" or "horizontal".`);
    }
    out[form] = entry as FormLayout;
  }
  return out;
}

/**
 * Check `$labelDecisions` in the hints file. A label that replaces authoring words of the protocol records why, who
 * decided and its status there, in the same shape as a layout decision. Each entry must name a label of the file.
 */
export function checkLabelDecisions(raw: unknown, labels: Record<string, string> = {}): Record<string, Decision> {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('forms.hints.json: $labelDecisions must be an object of labels.');
  const out: Record<string, Decision> = {};
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (key.startsWith('$')) continue;
    if (labels[key] === undefined) throw new Error(`forms.hints.json: $labelDecisions names "${key}", which has no label in "labels".`);
    checkDecision(`$labelDecisions.${key}`, entry, [], 'forms.hints.json');
    out[key] = entry as Decision;
  }
  return out;
}

function checkDecision(where: string, entry: any, allowed: string[], file = 'forms.layout.json') {
  if (!entry || typeof entry !== 'object') throw new Error(`${file}: ${where} must be an object.`);
  for (const key of Object.keys(entry)) if (![...allowed, 'reason', 'decidedBy', 'status'].includes(key))
    throw new Error(allowed.length
      ? `${file}: ${where}.${key} is not a layout decision. Here the file may set ${allowed.join(', ')}. It never sets required, hides a question or changes a rule.`
      : `${file}: ${where}.${key} is not part of a decision. An entry has only "reason", "decidedBy" and "status".`);
  if (typeof entry.reason !== 'string' || !entry.reason.trim()) throw new Error(`${file}: ${where} must say why, in "reason".`);
  if (!DECIDERS.includes(entry.decidedBy)) throw new Error(`${file}: ${where}.decidedBy must be ${DECIDERS.map(d => `"${d}"`).join(' or ')}.`);
  if (!STATUSES.includes(entry.status)) throw new Error(`${file}: ${where}.status must be ${STATUSES.map(s => `"${s}"`).join(' or ')}.`);
}

/** "agent's choice, review pending" */
export const describeDecision = (d: Decision) => `${d.decidedBy === 'agent' ? "agent's" : `${d.decidedBy}'s`} choice, ${d.status}`;
