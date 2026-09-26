import type RealNotifee from '@notifee/react-native';

import { isExpoGo } from './runtime';

// Notifee isn't in Expo Go, and merely importing its package throws there (its
// constructor grabs the native module). So the package is required only in
// native builds, and its enums come from their standalone type files, which
// load nothing native.
export {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
} from '@notifee/react-native/dist/types/NotificationAndroid';
export { EventType } from '@notifee/react-native/dist/types/Notification';
export {
  TriggerType,
  type TimestampTrigger,
} from '@notifee/react-native/dist/types/Trigger';

// In Expo Go every call resolves to undefined instead of throwing. Timers and
// alarms still ring in-app from their JS timeouts while the app is open; only
// the system notifications are missing.
const expoGoStub = new Proxy(
  {},
  { get: () => () => Promise.resolve(undefined) },
) as typeof RealNotifee;

export const notifee: typeof RealNotifee = isExpoGo
  ? expoGoStub
  : require('@notifee/react-native').default;
