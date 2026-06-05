import { create } from "zustand";

export type ActiveTimer = {
  id: string;
  label: string;
  endsAt: number;
};

export type ActiveAlarm = {
  id: string;
  label: string;
  ringsAt: number;
};

type ToolsState = {
  timers: ActiveTimer[];
  alarms: ActiveAlarm[];

  addTimer: (t: ActiveTimer) => void;
  removeTimer: (id: string) => void;
  addAlarm: (a: ActiveAlarm) => void;
  removeAlarm: (id: string) => void;
};

export const useToolsStore = create<ToolsState>((set) => ({
  timers: [],
  alarms: [],

  addTimer: (t) => set((s) => ({ timers: [...s.timers, t] })),
  removeTimer: (id) =>
    set((s) => ({ timers: s.timers.filter((t) => t.id !== id) })),
  addAlarm: (a) => set((s) => ({ alarms: [...s.alarms, a] })),
  removeAlarm: (id) =>
    set((s) => ({ alarms: s.alarms.filter((a) => a.id !== id) })),
}));
