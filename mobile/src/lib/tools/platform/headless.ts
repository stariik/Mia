import {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
  TriggerType,
  notifee,
} from '@/lib/notifee';
import { storage as AsyncStorage } from '@/lib/storage';

import {
  ALARM_CHANNEL_ID,
  TIMER_CHANNEL_ID,
  ensureChannel,
  nextOccurrence,
} from './native';

type StoredAlarm = {
  id: string;
  label: string;
  ringsAt: number;
  days?: number[];
};

type StoredTimer = {
  id: string;
  label: string;
  endsAt: number;
};

type PersistedShape = {
  state?: {
    alarms?: StoredAlarm[];
    timers?: StoredTimer[];
  };
};

const STORAGE_KEY = 'tools-store-v1';

async function readPersisted(): Promise<PersistedShape> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as PersistedShape;
  } catch {
    return {};
  }
}

async function writePersisted(next: PersistedShape) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
}

/**
 * Re-arm every persisted alarm via Notifee triggers. Used by the boot
 * receiver (HeadlessJsTaskService) and by Notifee's background event handler
 * after a recurring alarm fires while the app is killed.
 *
 * This intentionally avoids importing the Zustand store so it runs in tiny
 * headless contexts without React being mounted.
 */
export async function rescheduleAllFromStorage() {
  await ensureChannel();
  const persisted = await readPersisted();
  const alarms = persisted.state?.alarms ?? [];
  const timers = persisted.state?.timers ?? [];
  const now = Date.now();

  const nextAlarms: StoredAlarm[] = [];
  for (const a of alarms) {
    const isRecurring = a.days && a.days.length > 0;
    let fireAt = a.ringsAt;
    if (fireAt <= now) {
      if (!isRecurring) continue; // drop expired one-shot
      fireAt = nextOccurrence(a.ringsAt, a.days, now);
    }
    nextAlarms.push({ ...a, ringsAt: fireAt });
    await scheduleAlarmHeadless(a.id, a.label, fireAt);
  }

  const nextTimers: StoredTimer[] = [];
  for (const t of timers) {
    if (t.endsAt <= now) continue;
    nextTimers.push(t);
    await scheduleTimerHeadless(t.id, t.label, t.endsAt);
  }

  await writePersisted({
    ...persisted,
    state: {
      ...(persisted.state ?? {}),
      alarms: nextAlarms,
      timers: nextTimers,
    },
  });
}

async function scheduleAlarmHeadless(
  id: string,
  label: string,
  fireAt: number,
) {
  try {
    await notifee.createTriggerNotification(
      {
        id,
        title: 'მაღვიძარა',
        body: label || 'გაღვიძების დროა',
        data: { kind: 'alarm', alarmId: id, ringsAt: String(fireAt) },
        android: {
          channelId: ALARM_CHANNEL_ID,
          category: AndroidCategory.ALARM,
          importance: AndroidImportance.HIGH,
          visibility: AndroidVisibility.PUBLIC,
          autoCancel: false,
          ongoing: true,
          smallIcon: 'ic_launcher',
          fullScreenAction: { id: 'alarm-ring', launchActivity: 'default' },
          pressAction: { id: 'alarm-ring', launchActivity: 'default' },
          actions: [
            { title: 'გადავადება (9 წთ)', pressAction: { id: 'snooze' } },
            { title: 'გაჩერება', pressAction: { id: 'dismiss' } },
          ],
        },
      },
      {
        type: TriggerType.TIMESTAMP,
        timestamp: Math.max(fireAt, Date.now() + 1000),
        alarmManager: { allowWhileIdle: true },
      },
    );
  } catch {}
}

async function scheduleTimerHeadless(
  id: string,
  label: string,
  fireAt: number,
) {
  try {
    await notifee.createTriggerNotification(
      {
        id,
        title: 'ტაიმერი',
        body: label || 'დრო ამოიწურა',
        data: { kind: 'timer', timerId: id },
        android: {
          channelId: TIMER_CHANNEL_ID,
          category: AndroidCategory.ALARM,
          importance: AndroidImportance.HIGH,
          autoCancel: true,
          smallIcon: 'ic_launcher',
          pressAction: { id: 'default', launchActivity: 'default' },
        },
      },
      {
        type: TriggerType.TIMESTAMP,
        timestamp: Math.max(fireAt, Date.now() + 1000),
        alarmManager: { allowWhileIdle: true },
      },
    );
  } catch {}
}

/**
 * Snooze without touching React state — called from the background event
 * handler. Does NOT clear the recurring schedule (separate snooze id).
 */
export async function snoozeAlarmHeadless(id: string) {
  const SNOOZE_MS = 9 * 60 * 1000;
  const fireAt = Date.now() + SNOOZE_MS;
  const persisted = await readPersisted();
  const alarm = persisted.state?.alarms?.find((a) => a.id === id);
  const label = alarm?.label || 'გაღვიძების დროა';
  try {
    await notifee.cancelDisplayedNotification(id);
  } catch {}
  await scheduleAlarmHeadless(`${id}__snooze`, label, fireAt);
}

export async function dismissAlarmHeadless(id: string) {
  try {
    await notifee.cancelDisplayedNotification(id);
    await notifee.cancelTriggerNotification(`${id}__snooze`);
    await notifee.cancelDisplayedNotification(`${id}__snooze`);
  } catch {}
}

/**
 * After a recurring alarm fires while the app is killed, re-arm the next
 * occurrence and update persisted state.
 */
export async function rollRecurringAlarm(id: string) {
  const persisted = await readPersisted();
  const alarms = persisted.state?.alarms ?? [];
  const idx = alarms.findIndex((a) => a.id === id);
  if (idx === -1) return;
  const a = alarms[idx];
  if (!a.days || a.days.length === 0) {
    // One-shot — remove.
    const next = [...alarms];
    next.splice(idx, 1);
    await writePersisted({
      ...persisted,
      state: { ...(persisted.state ?? {}), alarms: next },
    });
    return;
  }
  const nextFire = nextOccurrence(a.ringsAt, a.days, Date.now() + 1000);
  const updated: StoredAlarm = { ...a, ringsAt: nextFire };
  const next = [...alarms];
  next[idx] = updated;
  await writePersisted({
    ...persisted,
    state: { ...(persisted.state ?? {}), alarms: next },
  });
  await scheduleAlarmHeadless(id, a.label, nextFire);
}
