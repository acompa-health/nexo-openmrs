/**
 * Render a compiled form as an O3 form schema: the "About this step" section, then one section per group in the
 * form designer's order (docs/form-design.md).
 *
 * Two modes (rule D4). "production": a question shows an ⓘ only when a layout decision gives it clinician text.
 * "review": the same form, and each section and question also shows its reason on the page, in a markdown block
 * that saves nothing. O3 has no switch between the two, so the compiler writes both.
 */
import { humanize, type FormSpec, type Hints, type O3Form, type O3Question, type O3Section, type QuestionBinding } from './compile.ts';
import type { FieldDecision } from './layout.ts';

export type Mode = 'production' | 'review';

export function toO3(spec: FormSpec, formName: string, version: string, provenance: string, hints: Hints, label: (k: string, f: string) => string, mode: Mode): O3Form {
  const review = mode === 'review';
  const sections: O3Section[] = [];
  // The stored form is the same for every task occurrence. The workspace shows the task's own values above it.
  sections.push({
    label: 'About this step', isExpanded: 'true',
    questions: [{
      id: 'nexo_context', label: 'About this step', type: 'markdown', questionOptions: { rendering: 'markdown' },
      value: [
        `**${spec.title}**`,
        ...(spec.role ? [`Done by: ${label(spec.role, humanize(spec.role))}.`] : []),
        ...(spec.evidence ? [`What the protocol needs: ${spec.evidence}`] : []),
        `Generated from Nexo. Draft for clinical review, not for care.`,
        ...(review ? ['**Review build.** Each section and question shows why it is there. Production shows only the ⓘ.'] : []),
      ],
    }],
  });
  const byId = new Map(spec.questions.map(q => [q.id, q]));
  for (const [index, g] of spec.design.groups.entries()) {
    // The form engine reads a dot in an ID as a nested path, so the section's ID is its position.
    const questions: O3Question[] = review ? [markdown(`review__section__${index + 1}`, 'Why these questions', spec.design.review.sections[g.id])] : [];
    for (const id of g.questions) {
      const q = byId.get(id)!;
      questions.push(toO3Question(q, hints, spec.design.info[id], spec.design.fields[id]));
      // The reason hides with its question.
      if (review) questions.push({ ...markdown(`review__${id}`, 'Why this question', spec.design.review.questions[id]), ...(q.hide ? { hide: { hideWhenExpression: q.hide } } : {}) });
    }
    sections.push({ label: g.label, isExpanded: g.closed && !review ? 'false' : 'true', questions });
  }
  const description = `${review ? 'Review build: shows why each question is asked. ' : ''}${spec.evidence ?? spec.title} ${provenance}`;
  return {
    name: formName, uuid: spec.uuid, version, description: description.slice(0, 1000),
    encounterType: spec.encounterType.uuid, encounter: spec.encounterType.name, processor: 'EncounterFormProcessor', published: true, retired: false,
    referencedForms: [], pages: [{ label: spec.title.slice(0, 80), sections }],
  };
}

const markdown = (id: string, label: string, value: string[]): O3Question =>
  ({ id, label, type: 'markdown', questionOptions: { rendering: 'markdown' }, value });

/** C2: one answer from a list. Radios up to this many answers (counting "Not known"), a dropdown above. */
export const RADIO_MAX = 5;

function toO3Question(q: QuestionBinding, hints: Hints, info: string | undefined, decision: FieldDecision | undefined): O3Question {
  // E2: mark every optional question, including object updates.
  const optional = q.required ? '' : ' (optional)';
  const base: O3Question = { id: q.id, label: q.label + optional, type: 'obs', required: q.required, questionOptions: { concept: q.concept }, ...(info ? { questionInfo: info } : {}) };
  if (q.hide) base.hide = { hideWhenExpression: q.hide };
  const answerLabel = (v: string) => hints.labels?.[`value:${v}`] ?? hints.labels?.[v] ?? humanize(v);
  const unknown = q.unknownAnswer ? [{ concept: q.unknownAnswer, label: hints.labels?.['value:not_known'] ?? 'Not known' }] : [];
  const coded = (answers: { concept: string; label: string }[]) => {
    // C1, C2: radios for a short list, a dropdown for a longer one. F2: radio answers stack, one per line.
    const control = decision?.control ?? (answers.length <= RADIO_MAX ? 'radio' : 'dropdown');
    return control === 'radio'
      ? { rendering: 'radio', concept: q.concept, answers, orientation: decision?.orientation ?? 'vertical' }
      : { rendering: 'select', concept: q.concept, answers };
  };
  switch (q.type.type) {
    case 'yes_no': base.questionOptions = coded([{ concept: q.answers!.yes, label: 'Yes' }, { concept: q.answers!.no, label: 'No' }, ...unknown]); break;
    case 'listed': base.questionOptions = coded([...((q.type as any).values as string[]).map(v => ({ concept: q.answers![v], label: answerLabel(v) })), ...unknown]); break;
    case 'quantity': {
      const unit = (q.type as any).unit as string | undefined;
      const shown = unit ? hints.units?.[unit] ?? unit : undefined;
      base.label = (shown && !q.label.includes(`(${shown})`) ? `${q.label} (${shown})` : q.label) + optional;
      // C4: a measurement is typed. Steppers do not suit a continuous quantity. The engine reads hideSteppers on the
      // question, not in questionOptions.
      base.questionOptions = { rendering: 'number', concept: q.concept, min: '0' };
      base.hideSteppers = true;
      break;
    }
    case 'instant': case 'datetime': base.questionOptions = { rendering: 'datetime', concept: q.concept }; break;
    case 'date': base.questionOptions = { rendering: 'date', concept: q.concept }; break;
    case 'text': base.questionOptions = { rendering: 'textarea', concept: q.concept, rows: 3 }; break;
    default: base.questionOptions = { rendering: 'text', concept: q.concept };
  }
  return base;
}
