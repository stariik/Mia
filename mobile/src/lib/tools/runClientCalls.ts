import { useProfileStore } from '@/stores/profileStore';
import { useToolsStore } from '@/stores/toolsStore';

import { queueDirections } from './maps';
import { music } from './music';
import { cancelSms, confirmSms, prepareSms } from './sms';
import { nativePlatform } from './platform/native';
import type { ClientToolCall } from './types';

// Maps the LLM's client-side tool calls onto the native platform adapter.
// The set of names here must match the client tools in
// web/src/lib/tools/registry.ts — the server only ever emits those.
//
// Returns what Mia should say, for tools whose outcome only the phone knows
// (SMS: contact lookup, send result). The server skips the model's reply for
// those — see `speaksResult` in web/src/lib/tools/types.ts.
export async function runClientToolCalls(
  calls: ClientToolCall[],
): Promise<string | undefined> {
  let say: string | undefined;
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
      } else if (call.name === 'remember_fact') {
        if (typeof call.args.fact === 'string') {
          useProfileStore
            .getState()
            .addFact(
              call.args.fact,
              typeof call.args.replaces_id === 'string'
                ? call.args.replaces_id
                : undefined,
            );
        }
      } else if (call.name === 'forget_fact') {
        const profile = useProfileStore.getState();
        if (call.args.all === true) profile.clear();
        else if (typeof call.args.id === 'string') profile.removeFact(call.args.id);
      } else if (call.name === 'prepare_sms') {
        say = await prepareSms(String(call.args.to ?? ''), String(call.args.text ?? ''));
      } else if (call.name === 'confirm_sms') {
        say = await confirmSms();
      } else if (call.name === 'cancel_sms') {
        say = cancelSms();
      } else if (call.name === 'open_directions') {
        queueDirections(
          String(call.args.destination ?? ''),
          typeof call.args.mode === 'string' ? call.args.mode : undefined,
        );
      }
    } catch (err) {
      // The user asked for something and nothing happened — release-worthy.
      console.error('Client tool failed', call.name, err);
    }
  }
  return say;
}
