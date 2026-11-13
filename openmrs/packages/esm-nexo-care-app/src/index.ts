/**
 * The Nexo care pathway in the patient chart. It adds a "Care pathway" dashboard with one widget, and a workspace
 * that shows a generated O3 form with the task context from the protocol.
 */
import { defineConfigSchema, getAsyncLifecycle, getSyncLifecycle } from '@openmrs/esm-framework';
import { createDashboardLink } from '@openmrs/esm-patient-common-lib';
import { configSchema } from './config-schema';
import { dashboardMeta } from './dashboard.meta';

const moduleName = '@nexo/esm-nexo-care-app';

const options = {
  featureName: 'nexo-care-pathway',
  moduleName,
};

export const importTranslation = require.context('../translations', false, /.json$/, 'lazy');

export function startupApp() {
  defineConfigSchema(moduleName, configSchema);
}

// t('carePathway', 'Care pathway')
export const carePathwayDashboardLink = getSyncLifecycle(createDashboardLink({ ...dashboardMeta, moduleName }), options);

export const carePathwayWidget = getAsyncLifecycle(() => import('./care-pathway/care-pathway.component'), options);

export const careTaskWorkspace = getAsyncLifecycle(() => import('./care-task/care-task.workspace'), options);
