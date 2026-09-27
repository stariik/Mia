import { Linking } from 'react-native';

import {
  directionsUrl,
  openQueuedApp,
  queueDirections,
} from '@/lib/tools/maps';

describe('directions', () => {
  test('encodes a Georgian address and defaults to driving navigation', () => {
    expect(directionsUrl('აბაშიძის ქუჩა 12, ბათუმი')).toBe(
      'https://www.google.com/maps/dir/?api=1' +
        `&destination=${encodeURIComponent('აბაშიძის ქუჩა 12, ბათუმი')}` +
        '&travelmode=driving&dir_action=navigate',
    );
  });

  test('keeps a known travel mode, falls back on junk', () => {
    expect(directionsUrl('x', 'walking')).toContain('travelmode=walking');
    expect(directionsUrl('x', 'flying')).toContain('travelmode=driving');
  });

  test('opens only after being queued, once', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await expect(openQueuedApp()).resolves.toBe(false);

    queueDirections('რუსთაველის გამზირი');
    await expect(openQueuedApp()).resolves.toBe(true);
    await expect(openQueuedApp()).resolves.toBe(false);
    expect(open).toHaveBeenCalledTimes(1);

    queueDirections('   '); // blank destination queues nothing
    await expect(openQueuedApp()).resolves.toBe(false);
  });
});
