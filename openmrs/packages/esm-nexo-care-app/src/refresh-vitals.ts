import type { ScopedMutator } from 'swr';
import { unstable_serialize } from 'swr/infinite';

/** O3 useVitalsAndBiometrics uses object page keys and a separate SWR infinite key. Revalidate that list too. */
export async function refreshVitals(mutate: ScopedMutator, patientUuid: string): Promise<void> {
  const firstPages: object[] = [];
  await mutate((key: unknown) => {
    if (key && typeof key === 'object' && 'swrKeyNeedle' in key &&
      typeof key.swrKeyNeedle === 'symbol' && key.swrKeyNeedle.description === 'vitalsAndBiometrics' &&
      'patientUuid' in key && key.patientUuid === patientUuid && 'page' in key && key.page === 0) {
      firstPages.push(key);
    }
    return false;
  });
  await Promise.all(firstPages.map(key => mutate(unstable_serialize(() => key))));
}
