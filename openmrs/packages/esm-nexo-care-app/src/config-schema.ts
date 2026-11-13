import { Type } from '@openmrs/esm-framework';

export const configSchema = {
  protocolName: {
    _type: Type.String,
    _default: '',
    _description:
      'The protocol folder name that the nexo backend module serves (GET /ws/rest/v1/nexo/protocols). Empty means the first protocol in that list.',
  },
};

export interface NexoCareConfig {
  protocolName: string;
}
