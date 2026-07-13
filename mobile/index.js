/**
 * @format
 */

import { AppRegistry } from 'react-native';
import notifee, { EventType } from '@notifee/react-native';
import * as Sentry from '@sentry/react-native';

import App from './App';
import { name as appName } from './app.json';
import { env } from './src/config/env';
import {
  rescheduleAllFromStorage,
  snoozeAlarmHeadless,
  dismissAlarmHeadless,
  rollRecurringAlarm,
} from './src/lib/tools/platform/headless';
import { runWakeSession } from './src/lib/wakeSession';

// Crash reporting (JS + native). No-ops until env.sentryDsn is set. Captures the
// main app, the headless wake/alarm tasks, and native crashes (autolinked SDK).
if (env.sentryDsn) {
  Sentry.init({ dsn: env.sentryDsn, tracesSampleRate: 0.2 });
}

// Re-arm scheduled alarms after device reboot (Android BootReceiver →
// RescheduleAlarmsService → this task).
AppRegistry.registerHeadlessTask('RescheduleAlarms', () => async () => {
  await rescheduleAllFromStorage();
});

// App-closed "Hey Jarvis / Hey Mia" voice session (mobile/docs/hey-jarvis-
// rebuild-prompt.md). WakeWordService always routes a background turn through
// this headless task — it reuses the warm JS runtime the mic FGS keeps alive,
// or boots one when cold. Running inside a headless task is what keeps RN's JS
// timers ticking with no resumed Activity; the old in-process 'turn' event left
// them paused, hanging the turn until the app was foregrounded.
AppRegistry.registerHeadlessTask('MiaWakeTurn', () => async () => {
  await runWakeSession();
});

// Background event handler for Notifee. Fires when the app is killed/swiped
// away and the user taps a notification action (Snooze/Dismiss). Also fires
// the first time a recurring trigger fires while killed, so we use it to
// roll the schedule forward.
notifee.onBackgroundEvent(async ({ type, detail }) => {
  const data = detail.notification?.data;
  const rawId = data?.alarmId ? String(data.alarmId) : undefined;
  const alarmId = rawId ? rawId.replace(/__snooze$/, '') : undefined;

  if (type === EventType.ACTION_PRESS) {
    const action = detail.pressAction?.id;
    if (!alarmId) return;
    if (action === 'snooze') {
      await snoozeAlarmHeadless(alarmId);
    } else if (action === 'dismiss') {
      await dismissAlarmHeadless(alarmId);
    }
    return;
  }

  if (type === EventType.DELIVERED && data?.kind === 'alarm' && alarmId) {
    // Recurring alarm fired while app was killed — roll forward.
    await rollRecurringAlarm(alarmId);
  }
});

AppRegistry.registerComponent(appName, () => Sentry.wrap(App));
