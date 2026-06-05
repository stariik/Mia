import type { ToolPlatform, TimerRequest, AlarmRequest } from "./index";
import { useToolsStore } from "@/stores/toolsStore";

// Web implementation uses setTimeout (foreground only) + Notification API.
// Background/closed-tab reliability is a mobile-only capability.

const timerHandles = new Map<string, ReturnType<typeof setTimeout>>();
const alarmHandles = new Map<string, ReturnType<typeof setTimeout>>();

async function ensureNotificationPermission() {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {}
  }
}

export const webPlatform: ToolPlatform = {
  async scheduleTimer(req: TimerRequest) {
    await ensureNotificationPermission();
    const endsAt = Date.now() + req.durationSeconds * 1000;
    useToolsStore.getState().addTimer({ id: req.id, label: req.label, endsAt });
    const handle = setTimeout(() => {
      useToolsStore.getState().removeTimer(req.id);
      webPlatform.notify("ტაიმერი", req.label || "დრო ამოიწურა");
      timerHandles.delete(req.id);
    }, req.durationSeconds * 1000);
    timerHandles.set(req.id, handle);
  },

  async cancelTimer(id: string) {
    const h = timerHandles.get(id);
    if (h) clearTimeout(h);
    timerHandles.delete(id);
    useToolsStore.getState().removeTimer(id);
  },

  async scheduleAlarm(req: AlarmRequest) {
    await ensureNotificationPermission();
    const delay = req.ringsAt - Date.now();
    if (delay <= 0) return;
    useToolsStore
      .getState()
      .addAlarm({ id: req.id, label: req.label, ringsAt: req.ringsAt });
    const handle = setTimeout(() => {
      useToolsStore.getState().removeAlarm(req.id);
      webPlatform.notify("მაღვიძარა", req.label || "გაღვიძების დროა");
      alarmHandles.delete(req.id);
    }, delay);
    alarmHandles.set(req.id, handle);
  },

  async cancelAlarm(id: string) {
    const h = alarmHandles.get(id);
    if (h) clearTimeout(h);
    alarmHandles.delete(id);
    useToolsStore.getState().removeAlarm(id);
  },

  async notify(title: string, body?: string) {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {}
    }
    if (Notification.permission === "granted") {
      new Notification(title, { body });
    }
  },
};
