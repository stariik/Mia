// Platform adapter interface — web today, native later.
// Client-side tool side-effects go through this so the same tool code
// can run in the React Native app without changes.

export type TimerRequest = {
  id: string;
  label: string;
  durationSeconds: number;
};

export type AlarmRequest = {
  id: string;
  label: string;
  ringsAt: number;
};

export interface ToolPlatform {
  scheduleTimer(req: TimerRequest): Promise<void>;
  cancelTimer(id: string): Promise<void>;
  scheduleAlarm(req: AlarmRequest): Promise<void>;
  cancelAlarm(id: string): Promise<void>;
  notify(title: string, body?: string): Promise<void>;
}
