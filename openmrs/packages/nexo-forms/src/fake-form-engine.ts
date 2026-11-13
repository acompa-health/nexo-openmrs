/**
 * For tests: how the O3 form engine evaluates a hide expression on a server whose concepts have their own UUIDs.
 *
 * It mirrors @openmrs/esm-form-engine-lib. The engine resolves each concept and answer that the form names by mapping
 * to the server's UUID (useFormFieldsMeta). The value of a coded field is the UUID of the chosen answer. An expression
 * sees the field values, `allFields` and the helper `extractRepeatingGroupValues` (CommonExpressionHelpers). The
 * dropdown renderer then inserts a concept-less placeholder. The expression itself runs in the OpenMRS expression
 * evaluator, as in the engine.
 */
import { compile, evaluateAsType } from '@openmrs/esm-expression-evaluator';
import type { O3Form } from './compile.ts';

/** The test server's UUID for a reference: "CIEL:1065" becomes "server-CIEL-1065". A local UUID stays the same. */
export const serverUuid = (reference: string) => (reference.includes(':') ? `server-${reference.replace(':', '-')}` : reference);

/** The fields after concept resolution and dropdown initialization (form-engine-lib v5.0.0). */
export function engineFields(form: O3Form) {
  return form.pages.flatMap(p => p.sections.flatMap(s => s.questions)).map(q => {
    const options = q.questionOptions as { concept?: string; rendering?: string; answers?: { concept?: string; value?: string; label: string }[] };
    const answers = options.answers?.map(a => ({ ...a, ...(a.concept ? { concept: serverUuid(a.concept) } : {}) }));
    // https://github.com/openmrs/openmrs-esm-form-engine-lib/blob/v5.0.0/src/components/inputs/select/dropdown.component.tsx
    if (options.rendering === 'select' && answers && !answers.some(a => a.value === 'null-select-option'))
      answers.unshift({ value: 'null-select-option', label: 'Choose an option' });
    return {
      ...q,
      questionOptions: {
        ...options,
        ...(options.concept ? { concept: serverUuid(options.concept) } : {}),
        ...(answers ? { answers } : {}),
      },
    };
  });
}

const extractRepeatingGroupValues = (key: string, array: Record<string, unknown>[]) => array.map(item => item[key]);

/**
 * Whether the engine hides a question with this hide expression, when each named question has the answer with the
 * given reference (as the binding names it) and every other question is empty.
 */
export function hiddenOnServer(form: O3Form, expression: string, answers: Record<string, string | undefined>): boolean {
  const fields = engineFields(form);
  const values: Record<string, string> = Object.fromEntries(fields.map(f => [f.id, '']));
  for (const [id, ref] of Object.entries(answers)) if (ref !== undefined) values[id] = serverUuid(ref);
  return evaluateAsType(compile(expression), { ...values, allFields: fields as any, extractRepeatingGroupValues },
    (r: unknown): r is boolean => typeof r === 'boolean');
}
