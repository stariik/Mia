import { PermissionsAndroid, Platform } from 'react-native';

import {
  ensureLocationPermission,
  ensureNotificationPermission,
} from '@/hooks/usePermissions';

describe('Android permission requests', () => {
  const originalOS = Platform.OS;
  const originalVersion = Platform.Version;

  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    Object.defineProperty(Platform, 'Version', { get: () => 34 });
  });
  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { get: () => originalOS });
    Object.defineProperty(Platform, 'Version', { get: () => originalVersion });
  });

  test('run one at a time (Android rejects a concurrent request)', async () => {
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
    let inFlight = 0;
    let maxInFlight = 0;
    const request = jest
      .spyOn(PermissionsAndroid, 'request')
      .mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return PermissionsAndroid.RESULTS.GRANTED;
      });

    // Same as App's mount effect: both fire without awaiting each other.
    const [notifications, location] = await Promise.all([
      ensureNotificationPermission(),
      ensureLocationPermission(),
    ]);

    expect(notifications).toBe(true);
    expect(location).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
  });
});
