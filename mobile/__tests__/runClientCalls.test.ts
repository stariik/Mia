jest.mock('@/lib/tools/platform/native', () => ({
  nativePlatform: {
    scheduleTimer: jest.fn().mockResolvedValue(undefined),
    scheduleAlarm: jest.fn().mockResolvedValue(undefined),
    cancelTimer: jest.fn().mockResolvedValue(undefined),
    cancelAlarm: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/lib/tools/music', () => ({
  music: {
    pause: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    togglePlay: jest.fn().mockResolvedValue(undefined),
    skipNext: jest.fn().mockResolvedValue(undefined),
    skipPrevious: jest.fn().mockResolvedValue(undefined),
    restart: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/lib/tools/sms', () => ({
  prepareSms: jest.fn().mockResolvedValue('მიმღები: დედა.'),
  confirmSms: jest.fn().mockResolvedValue('გავაგზავნე.'),
  cancelSms: jest.fn().mockReturnValue('კარგი, არ გავაგზავნე.'),
}));

const mockTimers: { id: string }[] = [];
const mockAlarms: { id: string }[] = [];
jest.mock('@/stores/toolsStore', () => ({
  useToolsStore: {
    getState: () => ({ timers: mockTimers, alarms: mockAlarms }),
  },
}));

import { runClientToolCalls } from '@/lib/tools/runClientCalls';
import { nativePlatform } from '@/lib/tools/platform/native';
import { music } from '@/lib/tools/music';

describe('runClientToolCalls', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockTimers.length = 0;
    mockAlarms.length = 0;
  });

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

  test('set_alarm with days schedules a repeating alarm and ignores day_offset', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-24T10:00:00'));

    await runClientToolCalls([
      {
        id: 'tc_3',
        name: 'set_alarm',
        args: { hour: 7, minute: 0, day_offset: 3, days: [5, 1, 3, 1, 9, 'x', 2.5] },
      },
    ]);

    const req = (nativePlatform.scheduleAlarm as jest.Mock).mock.calls[0][0];
    expect(req.days).toEqual([1, 3, 5]);
    const when = new Date(req.ringsAt);
    expect(when.getDate()).toBe(24); // today's date; nextOccurrence picks the weekday
    expect(when.getHours()).toBe(7);

    jest.useRealTimers();
  });

  test('set_alarm with no valid days stays one-shot', async () => {
    await runClientToolCalls([
      { id: 'tc_4', name: 'set_alarm', args: { hour: 7, days: [] } },
    ]);
    const req = (nativePlatform.scheduleAlarm as jest.Mock).mock.calls[0][0];
    expect(req).not.toHaveProperty('days');
  });

  test('unknown tool names are ignored', async () => {
    await runClientToolCalls([{ id: 'x', name: 'bogus', args: {} }]);
    expect(nativePlatform.scheduleTimer).not.toHaveBeenCalled();
    expect(nativePlatform.scheduleAlarm).not.toHaveBeenCalled();
  });

  test('cancel_timer targets the id the model passed', async () => {
    mockTimers.push({ id: 'timer_a' }, { id: 'timer_b' });
    await runClientToolCalls([
      { id: 'x', name: 'cancel_timer', args: { id: 'timer_b' } },
    ]);
    expect(nativePlatform.cancelTimer).toHaveBeenCalledTimes(1);
    expect(nativePlatform.cancelTimer).toHaveBeenCalledWith('timer_b');
  });

  test('cancel_timer with all=true clears every timer', async () => {
    mockTimers.push({ id: 'timer_a' }, { id: 'timer_b' });
    await runClientToolCalls([
      { id: 'x', name: 'cancel_timer', args: { all: true } },
    ]);
    expect(nativePlatform.cancelTimer).toHaveBeenCalledWith('timer_a');
    expect(nativePlatform.cancelTimer).toHaveBeenCalledWith('timer_b');
    expect(nativePlatform.cancelTimer).toHaveBeenCalledTimes(2);
  });

  test('cancel_timer with no id cancels the sole active timer', async () => {
    mockTimers.push({ id: 'only' });
    await runClientToolCalls([{ id: 'x', name: 'cancel_timer', args: {} }]);
    expect(nativePlatform.cancelTimer).toHaveBeenCalledWith('only');
  });

  test('cancel_timer with no id is a no-op when several are active', async () => {
    mockTimers.push({ id: 'a' }, { id: 'b' });
    await runClientToolCalls([{ id: 'x', name: 'cancel_timer', args: {} }]);
    expect(nativePlatform.cancelTimer).not.toHaveBeenCalled();
  });

  test('cancel_alarm targets the id the model passed', async () => {
    mockAlarms.push({ id: 'alarm_1' });
    await runClientToolCalls([
      { id: 'x', name: 'cancel_alarm', args: { id: 'alarm_1' } },
    ]);
    expect(nativePlatform.cancelAlarm).toHaveBeenCalledWith('alarm_1');
  });

  test.each([
    ['pause_music', 'pause'],
    ['resume_music', 'resume'],
    ['toggle_music', 'togglePlay'],
    ['skip_next', 'skipNext'],
    ['skip_previous', 'skipPrevious'],
    ['restart_track', 'restart'],
  ])('%s dispatches music.%s', async (toolName, method) => {
    await runClientToolCalls([{ id: 't', name: toolName, args: {} }]);
    expect((music as unknown as Record<string, jest.Mock>)[method]).toHaveBeenCalledTimes(1);
  });

  test('SMS tools return the line for Mia to speak; others return nothing', async () => {
    await expect(
      runClientToolCalls([
        { id: 's', name: 'prepare_sms', args: { to: 'დედა', text: 'მოვდივარ' } },
      ]),
    ).resolves.toBe('მიმღები: დედა.');
    await expect(
      runClientToolCalls([{ id: 's', name: 'confirm_sms', args: {} }]),
    ).resolves.toBe('გავაგზავნე.');
    await expect(
      runClientToolCalls([{ id: 't', name: 'pause_music', args: {} }]),
    ).resolves.toBeUndefined();
  });
});
