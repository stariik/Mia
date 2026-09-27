import * as ExpoLocation from 'expo-location';
import { Platform } from 'react-native';

import { ensureLocationPermission } from '@/hooks/usePermissions';
import { isExpoGo } from '@/lib/runtime';
import { useLocationStore } from '@/stores/locationStore';

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
// A failed fix (location services off, no signal) must not retry on every
// app-foreground: any retry path keyed off AppState 'active' can resonate
// with window-focus changes. One attempt, then back off.
const RETRY_AFTER_MS = 5 * 60 * 1000;
let lastAttemptAt = 0;

type Coords = { lat: number; lon: number };

// expo-location on every platform: it asks Google's fused provider, which
// gives a city-level fix with COARSE alone. The community geolocation module
// used here before read Android's raw network provider and, when that was
// off, fell back to GPS — which needs FINE (stripped from our manifest) — so
// it failed silently and Android never sent a location.
// mayShowUserSettingsDialog: false — the "turn on location accuracy" dialog
// is a system activity, and this runs on every app-foreground (see the
// focus-loop notes in usePermissions).
const FIX_TIMEOUT_MS = 15_000;

async function getCurrentPosition(): Promise<Coords> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), FIX_TIMEOUT_MS);
  });
  try {
    const pos = await Promise.race([
      ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
        mayShowUserSettingsDialog: false,
      }),
      timeout,
    ]);
    return { lat: pos.coords.latitude, lon: pos.coords.longitude };
  } finally {
    clearTimeout(timer);
  }
}

async function reverseGeocode({
  lat,
  lon,
}: Coords): Promise<string | undefined> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&accept-language=ka`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'voice-ai-mobile/1.0 (mia)' },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      address?: {
        city?: string;
        town?: string;
        village?: string;
        municipality?: string;
        county?: string;
        state?: string;
      };
    };
    const a = data.address ?? {};
    return (
      a.city || a.town || a.village || a.municipality || a.county || a.state
    );
  } catch {
    return undefined;
  }
}

export async function refreshLocation(
  opts: { force?: boolean } = {},
): Promise<void> {
  const state = useLocationStore.getState();
  const fresh =
    !opts.force &&
    state.lastUpdatedAt !== undefined &&
    Date.now() - state.lastUpdatedAt < STALE_AFTER_MS;
  if (fresh) return;

  // After a denial, only an explicit user action (force) may re-prompt —
  // automatic retries loop through the system permission activity and break
  // keyboard focus app-wide.
  if (state.permissionDenied && !opts.force) {
    state.setLastError('permission denied earlier — tap refresh');
    return;
  }

  if (!opts.force && Date.now() - lastAttemptAt < RETRY_AFTER_MS) return;
  lastAttemptAt = Date.now();

  // Android native builds gate through our own COARSE-only request:
  // expo-location's request also asks for FINE, which the manifest strips
  // (auto-denied). iOS has no such split.
  const granted =
    isExpoGo || Platform.OS === 'ios'
      ? (await ExpoLocation.requestForegroundPermissionsAsync()).granted
      : await ensureLocationPermission({ userInitiated: opts.force });
  if (!granted) {
    useLocationStore.getState().setPermissionDenied(true);
    useLocationStore.getState().setLastError('permission denied');
    return;
  }
  useLocationStore.getState().setPermissionDenied(false);

  let coords: Coords;
  try {
    coords = await getCurrentPosition();
  } catch (e) {
    const err = e as { code?: string; message?: string };
    useLocationStore
      .getState()
      .setLastError(`fix failed: ${err.code ?? ''} ${err.message ?? e}`.trim());
    return;
  }

  const city = await reverseGeocode(coords);
  useLocationStore.getState().setLocation({
    city,
    lat: coords.lat,
    lon: coords.lon,
  });
}
