import Geolocation from '@react-native-community/geolocation';

import { ensureLocationPermission } from '@/hooks/usePermissions';
import { useLocationStore } from '@/stores/locationStore';

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

type Coords = { lat: number; lon: number };

function getCurrentPosition(): Promise<Coords> {
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

  const granted = await ensureLocationPermission();
  if (!granted) {
    useLocationStore.getState().setPermissionDenied(true);
    return;
  }

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
