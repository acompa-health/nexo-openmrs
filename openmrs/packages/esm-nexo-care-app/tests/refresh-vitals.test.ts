import { describe, expect, test } from 'bun:test';
import { refreshVitals } from '../src/refresh-vitals';
import { unstable_serialize } from 'swr/infinite';
describe('O3 vitals refresh after encounter save', () => {
  test('refreshes patient vitals and biometrics infinite keys, without other patients or unrelated keys', async () => {
    const keys = [
      { swrKeyNeedle: Symbol('vitalsAndBiometrics'), patientUuid: 'p1', mode: 'vitals', page: 0 },
      { swrKeyNeedle: Symbol('vitalsAndBiometrics'), patientUuid: 'p1', mode: 'biometrics', page: 0 },
      { swrKeyNeedle: Symbol('vitalsAndBiometrics'), patientUuid: 'p2', mode: 'vitals', page: 0 },
      '/other', undefined, { patientUuid: 'p1', page: 0 },
    ];
    const refreshed: unknown[] = [];
    const mutate = async (key: unknown) => {
      if (typeof key === 'function') keys.filter(key as any);
      else refreshed.push(key);
    };
    await refreshVitals(mutate as any, 'p1');
    expect(refreshed).toEqual(keys.slice(0, 2).map(k => unstable_serialize(() => k)));
  });
});
