// Types for the client-side tool platform (timers + alarms). The server
// decides WHAT to schedule (web/src/lib/tools/registry.ts); this layer is HOW
// it lands on the device (notifee, AlarmManager, the tools store).

export type TimerRequest = {
  id: string;
  label: string;
  durationSeconds: number;
};

export type AlarmRequest = {
  id: string;
  label: string;
  ringsAt: number;
  // Recurrence: weekday numbers (0=Sun..6=Sat). Empty/undefined = one-shot.
  days?: number[];
};

export interface ToolPlatform {
  scheduleTimer(req: TimerRequest): Promise<void>;
  cancelTimer(id: string): Promise<void>;
  scheduleAlarm(req: AlarmRequest): Promise<void>;
  cancelAlarm(id: string): Promise<void>;
}
