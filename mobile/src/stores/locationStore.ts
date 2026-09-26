import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { storage as AsyncStorage } from '@/lib/storage';

export type LocationState = {
  city?: string;
  lat?: number;
  lon?: number;
  lastUpdatedAt?: number;
  manualCity?: string;
  permissionDenied?: boolean;

  setLocation: (loc: {
    city?: string;
    lat?: number;
    lon?: number;
  }) => void;
  setManualCity: (city: string | undefined) => void;
  setPermissionDenied: (denied: boolean) => void;
  clear: () => void;
};

export const useLocationStore = create<LocationState>()(
  persist(
    (set) => ({
      setLocation: ({ city, lat, lon }) =>
        set(() => ({
          city,
          lat,
          lon,
          lastUpdatedAt: Date.now(),
          permissionDenied: false,
        })),
      setManualCity: (manualCity) => set(() => ({ manualCity })),
      setPermissionDenied: (permissionDenied) =>
        set(() => ({ permissionDenied })),
      clear: () =>
        set(() => ({
          city: undefined,
          lat: undefined,
          lon: undefined,
          lastUpdatedAt: undefined,
        })),
    }),
    {
      name: 'location-store-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        city: s.city,
        lat: s.lat,
        lon: s.lon,
        lastUpdatedAt: s.lastUpdatedAt,
        manualCity: s.manualCity,
        permissionDenied: s.permissionDenied,
      }),
    },
  ),
);

// Effective city to surface to the AI: manual override wins, else
// reverse-geocoded city from coords.
export function getEffectiveCity(s: LocationState): string | undefined {
  return s.manualCity?.trim() || s.city;
}
