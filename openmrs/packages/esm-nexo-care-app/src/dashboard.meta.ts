import { type DashboardLinkConfig } from '@openmrs/esm-patient-common-lib';

export const dashboardMeta: DashboardLinkConfig & { slot: string } = {
  slot: 'patient-chart-nexo-care-pathway-dashboard-slot',
  path: 'care-pathway',
  title: 'Care pathway',
  icon: 'omrs-icon-list-checked',
};
