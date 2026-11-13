import type { WorkSnapshot } from '../../../nexo-forms/src/browser.ts';
import type { Recording } from '../nexo.resource';

export const CARE_TASK_WORKSPACE = 'nexo-care-task-workspace';

/** What the dashboard passes when it opens a generated form. */
export interface CareTaskWorkspaceProps {
  recording: Recording;
  title: string;
  /** For a start: the pathway this form starts. */
  starts?: string;
  formUuid: string;
  /** The open work this form serves, if any. Its context and prefill are read from a fresh log. */
  work?: WorkSnapshot['ref'];
}
