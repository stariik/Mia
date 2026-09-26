import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';

import { RootNavigator } from '@/navigation/RootNavigator';
import { navigateRef } from '@/navigation/navigationRef';
import {
  ensureChannel,
  reconcileTools,
  registerForegroundEvents,
  setOnAlarmRing,
} from '@/lib/tools/platform/native';
import { ensureNotificationPermission } from '@/hooks/usePermissions';
import { fs } from '@/lib/fs';
import { notifee } from '@/lib/notifee';
import { refreshLocation } from '@/lib/location';
import { isExpoGo } from '@/lib/runtime';
import { useToolsStore } from '@/stores/toolsStore';
import { fontFiles } from '@/theme/fontFiles';

// Keep the native splash up until fonts, auth and the first screen are all
// ready, then crossfade straight into it — hiding it any earlier fades to a
// blank frame before the UI pops in. Expo Go has no bootsplash.
function hideSplash() {
  if (isExpoGo) return;
  require('react-native-bootsplash')
    .default.hide({ fade: true })
    .catch(() => {});
}

function App() {
  // Register the bundled fonts before the first screen draws, so text never
  // flashes in the system font. On a load error, render anyway with fallbacks.
  const [fontsLoaded, fontError] = useFonts(fontFiles);

  useEffect(() => {
    // Expo Go has no Notifee, so the alarm and timer wiring below is
    // native-only. The splash is hidden by hideSplash once the first screen
    // is ready.
    if (!isExpoGo) {
      ensureChannel();
      ensureNotificationPermission();
    }

    // TTS cache files are deleted right after playback; this sweeps leftovers
    // from crashes / interrupted turns.
    fs.sweepCache();

    refreshLocation().catch(() => {});
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshLocation().catch(() => {});
      }
    });
    if (isExpoGo) {
      return () => appStateSub.remove();
    }

    const runReconcile = () => {
      reconcileTools();
    };

    if (useToolsStore.persist.hasHydrated()) {
      runReconcile();
    }
    const unsub = useToolsStore.persist.onFinishHydration(runReconcile);

    // Route alarm fire events to the AlarmRing screen.
    setOnAlarmRing((alarmId) => {
      navigateRef('AlarmRing', { alarmId });
    });
    const unsubFg = registerForegroundEvents();

    // Cold start via full-screen-intent: if the user opened the app by
    // tapping (or being launched by) an alarm notification, route there.
    notifee.getInitialNotification().then((initial) => {
      if (!initial) return;
      const data = initial.notification.data as
        | { kind?: string; alarmId?: string }
        | undefined;
      if (data?.kind === 'alarm' && data?.alarmId) {
        const id = String(data.alarmId).replace(/__snooze$/, '');
        navigateRef('AlarmRing', { alarmId: id });
      }
    });

    return () => {
      unsub();
      unsubFg();
      appStateSub.remove();
      setOnAlarmRing(null);
    };
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <RootNavigator onReady={hideSplash} />
    </SafeAreaProvider>
  );
}

export default App;
