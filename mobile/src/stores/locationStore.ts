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
  /** Why the last automatic lookup failed (not persisted; shown in test
   *  builds' Settings so a failure on a device without adb is visible). */
  lastError?: string;

  setLocation: (loc: {
    city?: string;
    lat?: number;
    lon?: number;
  }) => void;
  setManualCity: (city: string | undefined) => void;
  setPermissionDenied: (denied: boolean) => void;
  setLastError: (lastError: string | undefined) => void;
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
          lastError: undefined,
        })),
      setManualCity: (manualCity) => set(() => ({ manualCity })),
      setPermissionDenied: (permissionDenied) =>
        set(() => ({ permissionDenied })),
      setLastError: (lastError) => set(() => ({ lastError })),
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
      // v1: forget denials saved before permission requests were queued —
      // most were Android rejecting a concurrent request, not the user.
      version: 1,
      migrate: (persisted) => ({
        ...(persisted as Partial<LocationState>),
        permissionDenied: false,
      }),
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
