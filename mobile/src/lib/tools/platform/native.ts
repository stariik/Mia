import { NativeModules, Platform } from 'react-native';
import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
  EventType,
  TimestampTrigger,
  TriggerType,
} from '@notifee/react-native';

import { useToolsStore } from '@/stores/toolsStore';

import type { AlarmRequest, TimerRequest, ToolPlatform } from './index';

// IDs match `AlarmModule.kt` constants. iOS ignores channels.
export const ALARM_CHANNEL_ID = 'alarms-v1';
export const TIMER_CHANNEL_ID = 'timers-v1';

export const SNOOZE_MS = 9 * 60 * 1000;

const ANDROID_ALARM_PATTERN = [0, 800, 400, 800, 400, 800];
const ANDROID_TIMER_PATTERN = [0, 400, 200, 400];

const timerHandles = new Map<string, ReturnType<typeof setTimeout>>();
const alarmHandles = new Map<string, ReturnType<typeof setTimeout>>();

type NativeAlarm = {
  getDefaultAlarmUri(): Promise<string | null>;
  createChannels(): Promise<void>;
  setLockScreenFlags(enabled: boolean): void;
};

const AlarmNative = (NativeModules.AlarmModule || null) as NativeAlarm | null;

/**
 * Show-when-locked window flags. Enabled only while the AlarmRing screen is
 * up; leaving them on permanently breaks soft-keyboard focus app-wide.
 */
export function setLockScreenFlags(enabled: boolean) {
  if (Platform.OS !== 'android') return;
  AlarmNative?.setLockScreenFlags?.(enabled);
}

async function ensureNotifeeChannelsFallback() {
  // iOS or pre-AlarmModule fallback. Notifee channels are Android-only.
  if (Platform.OS !== 'android') return;
  await notifee.createChannel({
    id: ALARM_CHANNEL_ID,
    name: 'მაღვიძარა',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
    vibrationPattern: ANDROID_ALARM_PATTERN,
    visibility: AndroidVisibility.PUBLIC,
    bypassDnd: true,
  });
  await notifee.createChannel({
    id: TIMER_CHANNEL_ID,
    name: 'ტაიმერი',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
    vibrationPattern: ANDROID_TIMER_PATTERN,
    visibility: AndroidVisibility.PUBLIC,
  });
}

export async function ensureChannel() {
  if (Platform.OS === 'android' && AlarmNative?.createChannels) {
    try {
      await AlarmNative.createChannels();
      return;
    } catch {
      // Fall through to Notifee-managed channels.
    }
  }
  await ensureNotifeeChannelsFallback();
}

async function requestPermission() {
  try {
    await notifee.requestPermission({
      alert: true,
      sound: true,
      badge: true,
      criticalAlert: false,
      provisional: false,
    });
  } catch {
    // Permission denial isn't fatal — the in-app chip still works in foreground.
  }
}

/**
 * Compute the next absolute timestamp at which a recurring alarm should fire.
 *
 *  - `days` is a list of weekday numbers 0=Sun..6=Sat.
 *  - If `days` is empty/undefined → returns `baseTs` (one-shot).
 *  - Returned timestamp preserves the hour:minute of `baseTs` and lands on
 *    the next allowed weekday strictly after `now` (today qualifies if its
 *    weekday is in `days` AND the time hasn't passed).
 */
export function nextOccurrence(
  baseTs: number,
  days: number[] | undefined,
  now: number = Date.now(),
): number {
  if (!days || days.length === 0) return baseTs;
  const base = new Date(baseTs);
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setHours(base.getHours(), base.getMinutes(), 0, 0);

  for (let i = 0; i < 8; i++) {
    if (days.includes(candidate.getDay()) && candidate.getTime() > now) {
      return candidate.getTime();
    }
    candidate.setDate(candidate.getDate() + 1);
  }
  return baseTs; // safety; shouldn't hit
}

async function scheduleAlarmTrigger(
  id: string,
  title: string,
  body: string,
  fireAt: number,
) {
  const trigger: TimestampTrigger = {
    type: TriggerType.TIMESTAMP,
    timestamp: Math.max(fireAt, Date.now() + 1000),
    alarmManager: { allowWhileIdle: true },
  };
  try {
    await notifee.createTriggerNotification(
      {
        id,
        title,
        body,
        data: { kind: 'alarm', alarmId: id, ringsAt: String(fireAt) },
        android: {
          channelId: ALARM_CHANNEL_ID,
          category: AndroidCategory.ALARM,
          importance: AndroidImportance.HIGH,
          visibility: AndroidVisibility.PUBLIC,
          autoCancel: false,
          ongoing: true,
          showTimestamp: true,
          smallIcon: 'ic_launcher',
          fullScreenAction: { id: 'alarm-ring', launchActivity: 'default' },
          pressAction: { id: 'alarm-ring', launchActivity: 'default' },
          actions: [
            {
              title: 'გადავადება (9 წთ)',
              pressAction: { id: 'snooze' },
            },
            {
              title: 'გაჩერება',
              pressAction: { id: 'dismiss' },
            },
          ],
        },
      },
      trigger,
    );
  } catch {
    // If the OS denies exact alarm scheduling we still have the in-process
    // setTimeout fallback for as long as the app is alive — swallow.
  }
}

async function scheduleTimerTrigger(
  id: string,
  title: string,
  body: string,
  fireAt: number,
) {
  const trigger: TimestampTrigger = {
    type: TriggerType.TIMESTAMP,
    timestamp: Math.max(fireAt, Date.now() + 1000),
    alarmManager: { allowWhileIdle: true },
  };
  try {
    await notifee.createTriggerNotification(
      {
        id,
        title,
        body,
        data: { kind: 'timer', timerId: id },
        android: {
          channelId: TIMER_CHANNEL_ID,
          category: AndroidCategory.ALARM,
          importance: AndroidImportance.HIGH,
          visibility: AndroidVisibility.PUBLIC,
          autoCancel: true,
          smallIcon: 'ic_launcher',
          pressAction: { id: 'default', launchActivity: 'default' },
          actions: [
            {
              title: 'OK',
              pressAction: { id: 'dismiss' },
            },
          ],
        },
      },
      trigger,
    );
  } catch {}
}

async function cancelAlarmTriggers(id: string) {
  try {
    await notifee.cancelTriggerNotification(id);
  } catch {}
}

function armTimerHandle(id: string, fireAt: number) {
  const existing = timerHandles.get(id);
  if (existing) clearTimeout(existing);
  const delay = Math.max(0, fireAt - Date.now());
  const handle = setTimeout(() => {
    useToolsStore.getState().removeTimer(id);
    timerHandles.delete(id);
  }, delay);
  timerHandles.set(id, handle);
}

function armAlarmHandle(id: string, fireAt: number, days?: number[]) {
  const existing = alarmHandles.get(id);
  if (existing) clearTimeout(existing);
  const delay = Math.max(0, fireAt - Date.now());
  const handle = setTimeout(() => {
    if (days && days.length > 0) {
      // Recurring — recompute next occurrence and re-arm.
      const next = nextOccurrence(fireAt, days, Date.now() + 1000);
      useToolsStore.getState().updateAlarm(id, { ringsAt: next });
      armAlarmHandle(id, next, days);
      // The triggered notification already fired; schedule the next one.
      const a = useToolsStore.getState().alarms.find((x) => x.id === id);
      if (a) {
        scheduleAlarmTrigger(
          id,
          'მაღვიძარა',
          a.label || 'გაღვიძების დროა',
          next,
        );
      }
    } else {
      useToolsStore.getState().removeAlarm(id);
      alarmHandles.delete(id);
    }
  }, delay);
  alarmHandles.set(id, handle);
}

/**
 * Reconciles persisted store state with notifee's actual scheduled triggers.
 * Called once after AsyncStorage hydration and after returning from
 * background. Drops one-shot entries whose trigger no longer exists, re-arms
 * recurring entries by rolling them forward, and re-arms in-process
 * setTimeout handles for entries that are still pending.
 */
export async function reconcileTools() {
  let triggers: Awaited<ReturnType<typeof notifee.getTriggerNotifications>>;
  try {
    triggers = await notifee.getTriggerNotifications();
  } catch {
    return;
  }
  const triggerIds = new Set(
    triggers.map((t) => t.notification.id).filter((x): x is string => !!x),
  );
  const now = Date.now();
  const store = useToolsStore.getState();

  for (const t of store.timers) {
    if (t.endsAt <= now || !triggerIds.has(t.id)) {
      store.removeTimer(t.id);
    } else {
      armTimerHandle(t.id, t.endsAt);
    }
  }

  for (const a of store.alarms) {
    const isRecurring = a.days && a.days.length > 0;
    if (a.ringsAt <= now) {
      if (isRecurring) {
        const next = nextOccurrence(a.ringsAt, a.days, now);
        store.updateAlarm(a.id, { ringsAt: next });
        armAlarmHandle(a.id, next, a.days);
        await cancelAlarmTriggers(a.id);
        await scheduleAlarmTrigger(
          a.id,
          'მაღვიძარა',
          a.label || 'გაღვიძების დროა',
          next,
        );
      } else {
        store.removeAlarm(a.id);
      }
    } else if (!triggerIds.has(a.id)) {
      // Persisted but trigger gone (e.g. app reinstall, OS clear). Re-arm.
      armAlarmHandle(a.id, a.ringsAt, a.days);
      await scheduleAlarmTrigger(
        a.id,
        'მაღვიძარა',
        a.label || 'გაღვიძების დროა',
        a.ringsAt,
      );
    } else {
      armAlarmHandle(a.id, a.ringsAt, a.days);
    }
  }
}

export const nativePlatform: ToolPlatform = {
  async scheduleTimer(req: TimerRequest) {
    await requestPermission();
    const startedAt = Date.now();
    const endsAt = startedAt + req.durationSeconds * 1000;
    useToolsStore.getState().addTimer({
      id: req.id,
      label: req.label,
      endsAt,
      startedAt,
    });
    armTimerHandle(req.id, endsAt);
    await scheduleTimerTrigger(
      req.id,
      'ტაიმერი',
      req.label || 'დრო ამოიწურა',
      endsAt,
    );
  },

  async cancelTimer(id: string) {
    const h = timerHandles.get(id);
    if (h) clearTimeout(h);
    timerHandles.delete(id);
    useToolsStore.getState().removeTimer(id);
    try {
      await notifee.cancelTriggerNotification(id);
      await notifee.cancelDisplayedNotification(id);
    } catch {}
  },

  async scheduleAlarm(req: AlarmRequest & { days?: number[] }) {
    await requestPermission();
    const initialFire = nextOccurrence(req.ringsAt, req.days);
    if (initialFire <= Date.now()) return;
    useToolsStore.getState().addAlarm({
      id: req.id,
      label: req.label,
      ringsAt: initialFire,
      days: req.days,
    });
    armAlarmHandle(req.id, initialFire, req.days);
    await scheduleAlarmTrigger(
      req.id,
      'მაღვიძარა',
      req.label || 'გაღვიძების დროა',
      initialFire,
    );
  },

  async cancelAlarm(id: string) {
    const h = alarmHandles.get(id);
    if (h) clearTimeout(h);
    alarmHandles.delete(id);
    useToolsStore.getState().removeAlarm(id);
    await cancelAlarmTriggers(id);
    try {
      await notifee.cancelDisplayedNotification(id);
    } catch {}
  },
};

/**
 * Snooze an alarm by 9 minutes. Used by both foreground UI and the Notifee
 * background event handler, so it must work without React state.
 */
export async function snoozeAlarm(id: string) {
  const fireAt = Date.now() + SNOOZE_MS;
  const a = useToolsStore.getState().alarms.find((x) => x.id === id);
  const label = a?.label || 'გაღვიძების დროა';
  // Snooze does NOT mutate the alarm's ringsAt (so its weekday schedule
  // stays intact). It schedules a one-shot under a separate id.
  const snoozeId = `${id}__snooze`;
  await notifee.cancelDisplayedNotification(id);
  await scheduleAlarmTrigger(snoozeId, 'მაღვიძარა', label, fireAt);
}

/**
 * User-initiated dismiss — stops the currently-ringing alarm and any pending
 * snooze. For recurring alarms, the next-occurrence trigger has already been
 * scheduled by `armAlarmHandle`, so dismissal does not cancel it.
 */
export async function dismissAlarm(id: string) {
  try {
    await notifee.cancelDisplayedNotification(id);
    await notifee.cancelTriggerNotification(`${id}__snooze`);
    await notifee.cancelDisplayedNotification(`${id}__snooze`);
  } catch {}
}

/**
 * Foreground event handler. Wires Snooze/Dismiss notification actions and
 * surfaces incoming alarm presses to the navigation layer (caller subscribes
 * via `setOnAlarmRing`).
 */
let onAlarmRing: ((alarmId: string) => void) | null = null;
export function setOnAlarmRing(fn: ((alarmId: string) => void) | null) {
  onAlarmRing = fn;
}

export function registerForegroundEvents() {
  return notifee.onForegroundEvent(async ({ type, detail }) => {
    const data = detail.notification?.data as
      | { kind?: string; alarmId?: string }
      | undefined;
    const alarmId = data?.alarmId
      ? String(data.alarmId).replace(/__snooze$/, '')
      : undefined;

    if (type === EventType.ACTION_PRESS) {
      const action = detail.pressAction?.id;
      if (!alarmId) return;
      if (action === 'snooze') {
        await snoozeAlarm(alarmId);
      } else if (action === 'dismiss') {
        await dismissAlarm(alarmId);
      }
      return;
    }

    if (type === EventType.PRESS && data?.kind === 'alarm' && alarmId) {
      onAlarmRing?.(alarmId);
    }

    if (type === EventType.DELIVERED && data?.kind === 'alarm' && alarmId) {
      // Full-screen-intent path: deliver on lock screen → app launches → we
      // route to the ring screen.
      onAlarmRing?.(alarmId);
    }
  });
}
