/**
 * Plain reasons for the review build (rule D4 in docs/form-design.md). For each section: why its questions are
 * together. For each question: who uses the answer, why it is required, when it shows, how the rules test it, and
 * the ⓘ that production shows. The production build shows none of this text.
 */
import type { QuestionBinding } from './compile.ts';
import type { Group } from './design.ts';
import { describeDecision, type FieldDecision } from './layout.ts';
import type { Outcome, Shape } from './signals.ts';

/** Readable names for protocol words. */
export interface Words {
  /** The title of the step whose completion a table hears, if any. */
  step: (table: string) => string | undefined;
  /** A task template's title. */
  task: (template: string) => string;
  /** A protocol word (state, end, service) in plain words. */
  plain: (word: string) => string;
}

export interface QuestionFacts {
  /** Tables that run when this step is saved and read the answer. */
  now: string[];
  /** Tables of later steps that read it. */
  later: string[];
  shapes?: Set<Shape>;
  /** The stop row whose outcome one answer of this question can select. */
  stop?: { row: string; outcome: Outcome };
  info?: FieldDecision;
  /** Why the question may deserve an ⓘ (rule D3), when no decision exists yet. */
  candidate?: string;
  findings: string[];
}

const code = (s: string) => `\`${s}\``;
/** "Urgent assessment service" → "urgent assessment service"; "NCD advanced care" stays. */
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export function outcomeWords(o: Outcome, w: Words): string {
  const first = o.kind === 'ends' ? `ends this pathway ("${w.plain(o.to)}")` : o.kind === 'continues' ? `moves the case to "${w.plain(o.to)}"` : 'asks for this step again';
  const services = o.handovers.map(h => `the ${lowerFirst(w.plain(h))}`);
  if (services.length === 1) return `${first} and hands the patient over to ${services[0]}`;
  if (services.length > 1) return `${first} and hands the patient over to ${services.slice(0, -1).join(', ')} or ${services.at(-1)}, by the other answers`;
  const tasks = o.opens.map(w.task).filter(Boolean);
  return tasks.length ? `${first} and opens ${tasks.map(t => `"${t}"`).join(' and ')}` : first;
}

export function explainGroup(g: Group, w: Words): string[] {
  const why = g.stop
    ? `One answer here can end this step: the rule ${outcomeWords(g.stop.outcome, w)} (stop row ${code(g.stop.row)}). So these questions come first.`
    : g.id === 'extra'
      ? 'Fields that the hints file adds, each with a cited reason. No rule reads them, so they are optional and the section starts closed.'
      : 'The other answers of this step. They keep the order of the protocol, except that a question that shows after an answer follows that answer, and questions whose answer changes nothing, and free text, go last.';
  const heading = g.decision
    ? `**Heading** "${g.label}": ${describeDecision(g.decision)}. ${g.decision.reason}`
    : `**Heading** "${g.label}": the name of the record or task. No person chose it.`;
  return [`**Why these questions are together.** ${why}`, heading];
}

export function explainQuestion(q: QuestionBinding, f: QuestionFacts, kind: 'task' | 'event' | 'update', w: Words): string[] {
  const later = f.later.map(t => (w.step(t) ? `"${w.step(t)}" (${code(t)})` : code(t)));
  const users = [
    ...(f.now.length ? [`the rules that run when this step is saved (${f.now.map(code).join(', ')})`] : []),
    ...(later.length ? [`a later step: ${later.join(', ')}`] : []),
  ];
  const used = users.length ? users.join('; ') : q.extra ? `no rule. ${q.why}` : 'no rule.';
  const required = kind === 'update'
    ? 'when the protocol names it as missing.'
    : q.mandatory
    ? `yes. The ${kind} declares it required, so the pathway refuses the step without it.`
    : q.required
      ? `yes. A rule needs the answer to decide.${q.unknownAnswer ? ' "Not known" is allowed: the protocol then asks for it later.' : ''}`
      : 'no.';
  const lines = [
    `**Used by:** ${used}`,
    `**Required:** ${required}`,
    `**Shows:** ${q.shownWhen ? `only when ${q.shownWhen}.` : 'always.'}`,
  ];
  const test = f.stop
    ? `one answer alone can end this step: the rule ${outcomeWords(f.stop.outcome, w)}.`
    : f.shapes?.size === 1 && f.shapes.has('any')
      ? `every rule here accepts any answer; the rule only needs an answer.${f.later.length ? ' A later step uses the answer.' : ''}`
      : f.shapes?.has('and') ? 'the answer must hold together with the other answers that the rule reads.'
      : f.shapes?.has('or') ? 'one of several answers that can select a rule.'
      : undefined;
  if (test) lines.push(`**How the rules use it:** ${test}`);
  const info = f.info?.info;
  lines.push(info && info !== 'none'
    ? `**ⓘ in production:** "${info}" (${describeDecision(f.info!)}).`
    : f.info ? `**ⓘ in production:** none (${describeDecision(f.info)}). ${f.info.reason}`
    : f.candidate ? `**ⓘ in production:** none. Candidate, because ${f.candidate}. Decide in forms.layout.json.`
    : '**ⓘ in production:** none.');
  for (const text of f.findings) lines.push(`**For the protocol author:** ${text}`);
  return lines;
}
