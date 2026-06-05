import { music, type MusicProvider } from './music';
import { nativePlatform } from './platform/native';
import type { ClientToolCall } from './types';

const VALID_PROVIDERS: MusicProvider[] = [
  'spotify',
  'apple_music',
  'samsung_music',
];

function parseProvider(value: unknown): MusicProvider | undefined {
  return typeof value === 'string' &&
    (VALID_PROVIDERS as string[]).includes(value)
    ? (value as MusicProvider)
    : undefined;
}

// Maps the LLM's client-side tool calls onto the native platform adapter.
// Mirrors the logic in web/src/app/page.tsx:runClientToolCalls but uses
// nativePlatform (notifee + setTimeout) instead of webPlatform.
export async function runClientToolCalls(calls: ClientToolCall[]) {
  console.warn('[ToolCall] received', calls.map((c) => c.name).join(','));
  for (const call of calls) {
    try {
      console.warn('[ToolCall] dispatching', call.name, JSON.stringify(call.args));
      if (call.name === 'set_timer') {
        const seconds = Number(call.args.duration_seconds);
        const label =
          typeof call.args.label === 'string' ? call.args.label : '';
        if (Number.isFinite(seconds) && seconds > 0) {
          await nativePlatform.scheduleTimer({
            id: call.id,
            label,
            durationSeconds: seconds,
          });
        }
      } else if (call.name === 'set_alarm') {
        const hour = Number(call.args.hour);
        const minute = Number.isFinite(Number(call.args.minute))
          ? Number(call.args.minute)
          : 0;
        const dayOffset = Number.isFinite(Number(call.args.day_offset))
          ? Number(call.args.day_offset)
          : 0;
        const label =
          typeof call.args.label === 'string' ? call.args.label : '';

        if (Number.isFinite(hour) && hour >= 0 && hour <= 23) {
          const when = new Date();
          when.setDate(when.getDate() + dayOffset);
          when.setHours(hour, minute, 0, 0);
          if (dayOffset === 0 && when.getTime() <= Date.now()) {
            when.setDate(when.getDate() + 1);
          }
          await nativePlatform.scheduleAlarm({
            id: call.id,
            label,
            ringsAt: when.getTime(),
          });
        }
      } else if (call.name === 'play_music') {
        const query =
          typeof call.args.query === 'string' ? call.args.query.trim() : '';
        if (query) {
          await music.playFromSearch(query, parseProvider(call.args.provider));
        }
      } else if (call.name === 'pause_music') {
        await music.pause();
      } else if (call.name === 'resume_music') {
        await music.resume();
      } else if (call.name === 'toggle_music') {
        await music.togglePlay();
      } else if (call.name === 'skip_next') {
        await music.skipNext();
      } else if (call.name === 'skip_previous') {
        await music.skipPrevious();
      } else if (call.name === 'restart_track') {
        await music.restart();
      } else if (call.name === 'stop_music') {
        await music.stop();
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Client tool failed', call.name, err);
    }
  }
}
