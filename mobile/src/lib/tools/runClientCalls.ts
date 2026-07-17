import { useToolsStore } from '@/stores/toolsStore';

import { music } from './music';
import { nativePlatform } from './platform/native';
import type { ClientToolCall } from './types';

// Maps the LLM's client-side tool calls onto the native platform adapter.
// The set of names here must match the client tools in
// web/src/lib/tools/registry.ts — the server only ever emits those.
export async function runClientToolCalls(calls: ClientToolCall[]) {
  for (const call of calls) {
    try {
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
      } else if (call.name === 'cancel_timer') {
        // id targets one; all=true clears everything; neither + exactly one
        // active cancels that one (the model omitted the id for a lone timer).
        const timers = useToolsStore.getState().timers;
        if (call.args.all === true) {
          for (const t of [...timers]) await nativePlatform.cancelTimer(t.id);
        } else if (typeof call.args.id === 'string') {
          await nativePlatform.cancelTimer(call.args.id);
        } else if (timers.length === 1) {
          await nativePlatform.cancelTimer(timers[0].id);
        }
      } else if (call.name === 'cancel_alarm') {
        const alarms = useToolsStore.getState().alarms;
        if (call.args.all === true) {
          for (const a of [...alarms]) await nativePlatform.cancelAlarm(a.id);
        } else if (typeof call.args.id === 'string') {
          await nativePlatform.cancelAlarm(call.args.id);
        } else if (alarms.length === 1) {
          await nativePlatform.cancelAlarm(alarms[0].id);
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
      }
    } catch (err) {
      // The user asked for something and nothing happened — release-worthy.
      console.error('Client tool failed', call.name, err);
    }
  }
}
