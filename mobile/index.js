/**
 * @format
 */

import { AppRegistry } from 'react-native';
import notifee, { EventType } from '@notifee/react-native';

import App from './App';
import { name as appName } from './app.json';
import {
  rescheduleAllFromStorage,
  snoozeAlarmHeadless,
  dismissAlarmHeadless,
  rollRecurringAlarm,
} from './src/lib/tools/platform/headless';

// Re-arm scheduled alarms after device reboot (Android BootReceiver →
// RescheduleAlarmsService → this task).
AppRegistry.registerHeadlessTask('RescheduleAlarms', () => async () => {
  await rescheduleAllFromStorage();
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

AppRegistry.registerComponent(appName, () => App);
