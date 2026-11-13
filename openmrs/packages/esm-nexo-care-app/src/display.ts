import { formatDatetime } from '@openmrs/esm-framework';
import { clinicalContext } from './display-rules';
import type { ContextLine, TaskView } from '../../nexo-forms/src/browser.ts';

/** A Nexo instant in the user's locale and time zone. */
export function formatInstant(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : formatDatetime(date, { mode: 'standard' });
}

/** The context lines to show. The missing inputs are shown once, as "Missing information", not also as context. */
export function contextLines(task: TaskView): Array<ContextLine> {
  return clinicalContext(task.missing.length ? task.context.filter((c) => c.key !== 'missing_inputs') : task.context, task.work.content?.second_medicine);
}
