import { createNavigationContainerRef } from '@react-navigation/native';

export type RootStackParamList = {
  Auth: undefined;
  Home: undefined;
  Alarms: undefined;
  Timers: undefined;
  Translator: undefined;
  AlarmRing: { alarmId: string };
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateRef<K extends keyof RootStackParamList>(
  name: K,
  params?: RootStackParamList[K],
) {
  if (navigationRef.isReady()) {
    // @ts-expect-error — navigation type-guard friction
    navigationRef.navigate(name, params);
  }
}
