// Platform adapter — identical shape to web/src/lib/tools/platform/index.ts.
// Client-side tool side-effects route through this so RN and web share
// tool dispatch logic.

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
  notify(title: string, body?: string): Promise<void>;
}
