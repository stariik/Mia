import * as ExpoLocation from 'expo-location';

import { ensureLocationPermission } from '@/hooks/usePermissions';
import { isExpoGo } from '@/lib/runtime';
import { useLocationStore } from '@/stores/locationStore';

// Community geolocation isn't in Expo Go (importing it throws there), so it is
// required only in native builds; Expo Go uses expo-location instead.
type CommunityGeolocation =
  typeof import('@react-native-community/geolocation').default;
const Geolocation: CommunityGeolocation | null = isExpoGo
  ? null
  : require('@react-native-community/geolocation').default;

// Without this, the native module requests [COARSE, FINE] itself on every
// getCurrentPosition(). FINE isn't in our manifest, so Android auto-denies it
// via an invisible GrantPermissionsActivity — a window-focus steal on every
// call, which the AppState 'active' handler turns into an infinite loop that
// breaks keyboard focus app-wide (same symptom as the usePermissions loop,
// but through the module's back door, bypassing our guards). We gate every
// call through ensureLocationPermission ourselves, so the module must never
// touch the permission system.
Geolocation?.setRNConfiguration({ skipPermissionRequests: true });

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
// A failed fix (location services off, no signal) must not retry on every
// app-foreground: any retry path keyed off AppState 'active' can resonate
// with window-focus changes. One attempt, then back off.
const RETRY_AFTER_MS = 5 * 60 * 1000;
let lastAttemptAt = 0;

type Coords = { lat: number; lon: number };

async function getCurrentPosition(): Promise<Coords> {
  if (!Geolocation) {
    const pos = await ExpoLocation.getCurrentPositionAsync({
      accuracy: ExpoLocation.Accuracy.Low,
    });
    return { lat: pos.coords.latitude, lon: pos.coords.longitude };
  }
  return new Promise((resolve, reject) => {
    Geolocation.getCurrentPosition(
      (pos) =>
        resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60_000 },
    );
  });
}

async function reverseGeocode({ lat, lon }: Coords): Promise<string | undefined> {
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
    return a.city || a.town || a.village || a.municipality || a.county || a.state;
  } catch {
    return undefined;
  }
}

export async function refreshLocation(opts: { force?: boolean } = {}): Promise<void> {
  const state = useLocationStore.getState();
  const fresh =
    !opts.force &&
    state.lastUpdatedAt !== undefined &&
    Date.now() - state.lastUpdatedAt < STALE_AFTER_MS;
  if (fresh) return;

  // After a denial, only an explicit user action (force) may re-prompt —
  // automatic retries loop through the system permission activity and break
  // keyboard focus app-wide.
  if (state.permissionDenied && !opts.force) return;

  if (!opts.force && Date.now() - lastAttemptAt < RETRY_AFTER_MS) return;
  lastAttemptAt = Date.now();

  const granted = Geolocation
    ? await ensureLocationPermission({ userInitiated: opts.force })
    : (await ExpoLocation.requestForegroundPermissionsAsync()).granted;
  if (!granted) {
    useLocationStore.getState().setPermissionDenied(true);
    return;
  }
  useLocationStore.getState().setPermissionDenied(false);

  let coords: Coords;
  try {
    coords = await getCurrentPosition();
  } catch {
    return;
  }

  const city = await reverseGeocode(coords);
  useLocationStore.getState().setLocation({
    city,
    lat: coords.lat,
    lon: coords.lon,
  });
}
