import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { storage as AsyncStorage } from '@/lib/storage';

export type ActiveTimer = {
  id: string;
  label: string;
  endsAt: number;
  // Optional — older persisted entries may not have it. Used by UI to render
  // a progress bar (elapsed = now - startedAt, total = endsAt - startedAt).
  startedAt?: number;
};

export type ActiveAlarm = {
  id: string;
  label: string;
  ringsAt: number;
  // Recurrence: weekday numbers (0=Sun..6=Sat). Empty/undefined = one-shot.
  days?: number[];
};

type ToolsState = {
  timers: ActiveTimer[];
  alarms: ActiveAlarm[];

  addTimer: (t: ActiveTimer) => void;
  removeTimer: (id: string) => void;
  addAlarm: (a: ActiveAlarm) => void;
  removeAlarm: (id: string) => void;
  updateAlarm: (id: string, patch: Partial<ActiveAlarm>) => void;
};

export const useToolsStore = create<ToolsState>()(
  persist(
    (set) => ({
      timers: [],
      alarms: [],

      addTimer: (t) =>
        set((s) => ({ timers: [...s.timers.filter((x) => x.id !== t.id), t] })),
      removeTimer: (id) =>
        set((s) => ({ timers: s.timers.filter((t) => t.id !== id) })),
      addAlarm: (a) =>
        set((s) => ({ alarms: [...s.alarms.filter((x) => x.id !== a.id), a] })),
      removeAlarm: (id) =>
        set((s) => ({ alarms: s.alarms.filter((a) => a.id !== id) })),
      updateAlarm: (id, patch) =>
        set((s) => ({
          alarms: s.alarms.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        })),
    }),
    {
      name: 'tools-store-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ timers: s.timers, alarms: s.alarms }),
    },
  ),
);
