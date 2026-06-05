jest.mock('@/lib/tools/platform/native', () => ({
  nativePlatform: {
    scheduleTimer: jest.fn().mockResolvedValue(undefined),
    scheduleAlarm: jest.fn().mockResolvedValue(undefined),
    cancelTimer: jest.fn().mockResolvedValue(undefined),
    cancelAlarm: jest.fn().mockResolvedValue(undefined),
    notify: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/lib/tools/music', () => ({
  music: {
    pause: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    togglePlay: jest.fn().mockResolvedValue(undefined),
    skipNext: jest.fn().mockResolvedValue(undefined),
    skipPrevious: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    restart: jest.fn().mockResolvedValue(undefined),
    playFromSearch: jest.fn().mockResolvedValue(undefined),
    isProviderInstalled: jest.fn().mockResolvedValue(true),
  },
}));

import { runClientToolCalls } from '@/lib/tools/runClientCalls';
import { nativePlatform } from '@/lib/tools/platform/native';
import { music } from '@/lib/tools/music';

describe('runClientToolCalls', () => {
  afterEach(() => jest.clearAllMocks());

  test('set_timer passes through duration + label', async () => {
    await runClientToolCalls([
      {
        id: 'tc_1',
        name: 'set_timer',
        args: { duration_seconds: 90, label: 'ჩაი' },
      },
    ]);
    expect(nativePlatform.scheduleTimer).toHaveBeenCalledWith({
      id: 'tc_1',
      label: 'ჩაი',
      durationSeconds: 90,
    });
  });

  test('set_alarm computes ringsAt from hour + minute', async () => {
    const base = new Date('2026-04-24T00:00:00');
    jest.useFakeTimers().setSystemTime(base);

    await runClientToolCalls([
      {
        id: 'tc_2',
        name: 'set_alarm',
        args: { hour: 7, minute: 30, day_offset: 1, label: 'სამსახური' },
      },
    ]);

    expect(nativePlatform.scheduleAlarm).toHaveBeenCalledTimes(1);
    const req = (nativePlatform.scheduleAlarm as jest.Mock).mock.calls[0][0];
    const when = new Date(req.ringsAt);
    expect(when.getHours()).toBe(7);
    expect(when.getMinutes()).toBe(30);
    expect(when.getDate()).toBe(25); // next day

    jest.useRealTimers();
  });

  test('unknown tool names are ignored', async () => {
    await runClientToolCalls([{ id: 'x', name: 'bogus', args: {} }]);
    expect(nativePlatform.scheduleTimer).not.toHaveBeenCalled();
    expect(nativePlatform.scheduleAlarm).not.toHaveBeenCalled();
  });

  test('play_music forwards query and provider', async () => {
    await runClientToolCalls([
      {
        id: 'm1',
        name: 'play_music',
        args: { query: 'მზე და ცა', provider: 'spotify' },
      },
    ]);
    expect(music.playFromSearch).toHaveBeenCalledWith('მზე და ცა', 'spotify');
  });

  test('play_music falls back to undefined provider when invalid', async () => {
    await runClientToolCalls([
      {
        id: 'm2',
        name: 'play_music',
        args: { query: 'lullaby', provider: 'tidal' },
      },
    ]);
    expect(music.playFromSearch).toHaveBeenCalledWith('lullaby', undefined);
  });

  test('play_music ignored when query is empty', async () => {
    await runClientToolCalls([
      { id: 'm3', name: 'play_music', args: { query: '   ' } },
    ]);
    expect(music.playFromSearch).not.toHaveBeenCalled();
  });

  test.each([
    ['pause_music', 'pause'],
    ['resume_music', 'resume'],
    ['toggle_music', 'togglePlay'],
    ['skip_next', 'skipNext'],
    ['skip_previous', 'skipPrevious'],
    ['restart_track', 'restart'],
    ['stop_music', 'stop'],
  ])('%s dispatches music.%s', async (toolName, method) => {
    await runClientToolCalls([{ id: 't', name: toolName, args: {} }]);
    expect((music as unknown as Record<string, jest.Mock>)[method]).toHaveBeenCalledTimes(1);
  });
});
