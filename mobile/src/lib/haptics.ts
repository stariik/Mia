import { Platform, Vibration } from 'react-native';

// Very short vibration patterns for tactile feedback. Android's VIBRATE
// permission is declared in AndroidManifest. iOS requires no permission;
// short Vibration calls map to a haptic blip on supported devices.

export const haptics = {
  tap() {
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      Vibration.vibrate(10);
    }
  },
  selection() {
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      Vibration.vibrate(6);
    }
  },
  success() {
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      Vibration.vibrate([0, 20, 40, 20]);
    }
  },
  warn() {
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      Vibration.vibrate([0, 30, 60, 30]);
    }
  },
};
