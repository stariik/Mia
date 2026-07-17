import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import notifee, { EventType } from '@notifee/react-native';
import BootSplash from 'react-native-bootsplash';
import ReactNativeBlobUtil from 'react-native-blob-util';

import { RootNavigator } from '@/navigation/RootNavigator';
import { navigateRef } from '@/navigation/navigationRef';
import {
  ensureChannel,
  reconcileTools,
  registerForegroundEvents,
  setOnAlarmRing,
} from '@/lib/tools/platform/native';
import { ensureNotificationPermission } from '@/hooks/usePermissions';
import { refreshLocation } from '@/lib/location';
import { useToolsStore } from '@/stores/toolsStore';

function App() {
  useEffect(() => {
    // Hide the native splash once the first frame renders. We don't wait for
    // tools/auth hydration — RN handles its own initial blank state quickly,
    // and a 300ms crossfade out of BootSplash hides it.
    BootSplash.hide({ fade: true }).catch(() => {});

    ensureChannel();
    ensureNotificationPermission();

    // TTS cache files are deleted right after playback; this sweeps leftovers
    // from crashes / interrupted turns (blob-util names them RNFetchBlob*).
    const cacheDir = ReactNativeBlobUtil.fs.dirs.CacheDir;
    ReactNativeBlobUtil.fs
      .ls(cacheDir)
      .then((names) =>
        names
          .filter((n) => n.startsWith('RNFetchBlob'))
          .forEach((n) =>
            ReactNativeBlobUtil.fs.unlink(`${cacheDir}/${n}`).catch(() => {}),
          ),
      )
      .catch(() => {});

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

    refreshLocation().catch(() => {});
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshLocation().catch(() => {});
      }
    });

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

  return (
    <SafeAreaProvider>
      <RootNavigator />
    </SafeAreaProvider>
  );
}

export default App;
