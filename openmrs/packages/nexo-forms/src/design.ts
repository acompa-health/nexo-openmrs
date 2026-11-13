/**
 * The form designer: groups and orders a form's questions from the rule tables (docs/form-design.md, rules B1–B3).
 * It never changes what a form asks, what is required, or when a question shows. It decides only where each
 * question goes.
 */
import type { QuestionBinding } from './compile.ts';
import type { RowSignal } from './signals.ts';
import type { GroupDecision } from './layout.ts';

/** B1: a form with this many questions or fewer fits in one section, so the stop rows only order it. */
export const SECTION_MAX = 6;

export interface Group {
  /** The stop row ID for a stop group; the object path, "decision" or "extra" otherwise. */
  id: string;
  label: string;
  questions: string[];
  /** The stop row that makes this group. */
  stop?: RowSignal;
  /** Start the section closed (extra fields). */
  closed?: boolean;
  /** True when no person chose the label: the compiler used the object's name. */
  fallbackLabel?: boolean;
  /** The layout decision that set the heading. */
  decision?: GroupDecision;
}

/**
 * Group and order the questions.
 * - B1, B2: stop questions come first, in row order. In a form of more than SECTION_MAX questions, each stop row
 *   makes its own section. The other questions keep their object sections.
 * - Inside a section: questions whose answer changes nothing (every rule accepts any answer, and no later step
 *   reads them) go after the others (A5), and free text goes last (B2).
 * - B3: a conditional question comes directly after the question that shows it. When that question is a stop
 *   question, the conditional one moves only if it shows on a stop answer (a follow-up of the stop). A question that
 *   waits for "no stop", such as the supply end after stock and packing, stays on the main path.
 * - Extra fields from the hints go last, in a closed section (A5, E2).
 */
export function groupQuestions(questions: QuestionBinding[], rows: RowSignal[], inert: Set<string>,
  objectLabel: (path: string[], object: string | undefined) => string): Group[] {
  const asked = questions.filter(q => !q.extra);
  const stopRows = rows.filter(r => r.stopQuestions.length);
  const split = asked.length > SECTION_MAX && stopRows.length > 0;
  const groups: Group[] = [];
  const stopIds = new Set<string>();
  const stopOrder: QuestionBinding[] = [];
  for (const r of stopRows) {
    const qs = asked.filter(q => r.stopQuestions.includes(q.id) && !stopIds.has(q.id));
    if (!qs.length) continue;
    qs.forEach(q => stopIds.add(q.id));
    if (split) groups.push({ id: r.row, label: objectLabel(qs[0].path.slice(0, -1), qs[0].object), questions: qs.map(q => q.id), stop: r, fallbackLabel: true });
    else stopOrder.push(...qs);
  }
  const rest = [...stopOrder, ...asked.filter(q => !stopIds.has(q.id))];
  const objectGroups = new Map<string, Group>();
  for (const q of rest) {
    const id = q.path.length > 1 ? q.path.slice(0, -1).join('.') : 'decision';
    if (!objectGroups.has(id)) objectGroups.set(id, { id, label: id === 'decision' ? 'Decision' : objectLabel(q.path.slice(0, -1), q.object), questions: [] });
    objectGroups.get(id)!.questions.push(q.id);
  }
  groups.push(...objectGroups.values());

  const byId = new Map(questions.map(q => [q.id, q]));
  for (const g of groups) {
    if (g.stop) continue;
    const plain = g.questions.filter(id => !stopIds.has(id));
    const kept = g.questions.filter(id => stopIds.has(id));
    const text = (id: string) => byId.get(id)!.type.type === 'text' && !byId.get(id)!.hide;
    g.questions = [...kept, ...plain.filter(id => !inert.has(id) && !text(id)), ...plain.filter(id => inert.has(id) && !text(id)), ...plain.filter(text)];
  }
  // B3: move each conditional question directly after the question that shows it (the last of its gates).
  const order = () => groups.flatMap(g => g.questions);
  const stopAnswers = (id: string) => stopRows.find(r => r.stopQuestions.includes(id))?.stopAnswers[id] ?? [];
  for (const q of asked) {
    if (!q.gates?.length || stopIds.has(q.id)) continue;
    const position = new Map(order().map((id, i) => [id, i]));
    const trigger = [...q.gates].sort((a, b) => (position.get(a) ?? -1) - (position.get(b) ?? -1)).at(-1)!;
    if (!position.has(trigger)) continue;
    const shownOn = q.shownOn?.[trigger] ?? [];
    if (stopIds.has(trigger) && !(shownOn.length && shownOn.every(v => stopAnswers(trigger).includes(v)))) continue;
    const from = groups.find(g => g.questions.includes(q.id))!;
    from.questions = from.questions.filter(id => id !== q.id);
    const to = groups.find(g => g.questions.includes(trigger))!;
    // After the trigger and after the dependents already placed behind it.
    let at = to.questions.indexOf(trigger) + 1;
    while (at < to.questions.length && byId.get(to.questions[at])!.gates?.includes(trigger)) at++;
    to.questions.splice(at, 0, q.id);
  }
  const extra = questions.filter(q => q.extra);
  if (extra.length) groups.push({ id: 'extra', label: 'Also relevant', questions: extra.map(q => q.id), closed: true });
  return groups.filter(g => g.questions.length);
}
