import { streamChat } from '@/api/chat';
import { expireSessionIf401 } from '@/api/client';
import { dlog } from '@/lib/log';
import { matchMusicCommand } from '@/lib/musicCommands';
import { runClientToolCalls } from '@/lib/tools/runClientCalls';
import { getPendingSmsContext } from '@/lib/tools/sms';
import {
  selectActiveMessages,
  useConversationStore,
} from '@/stores/conversationStore';
import { getEffectiveCity, useLocationStore } from '@/stores/locationStore';
import { useProfileStore } from '@/stores/profileStore';
import { useToolsStore } from '@/stores/toolsStore';
import { useVoiceStore } from '@/stores/voiceStore';

// Messages of the current conversation sent as context each turn.
const HISTORY_MESSAGES = 20;
// Silence after which the next turn starts a new conversation.
const STALE_CONVERSATION_MS = 30 * 60_000;

// A pluggable TTS playback backend. Two implementations exist:
//   - orbPlayback    — plays through the WebView orb (foreground, drives the
//                      orb visualization). Requires the UI/Activity.
//   - nativePlayback — plays via nitro-sound, no UI. Used by the screen-off
//                      headless turn.
export interface TtsPlayback {
  /**
   * Speak one sentence, resolving when IT has finished playing.
   *
   * Callers enqueue sentences as soon as they're known, without waiting for the
   * previous one — so implementations MUST serialize playback themselves while
   * letting synthesis overlap. (Synthesis used to be hoisted up here to get that
   * overlap, but the streaming backend has to own the fetch to play it as it
   * arrives, so ordering became the backend's job.)
   */
  speak(text: string, onStart?: () => void): Promise<void>;
  /** Stop current playback (interrupt). */
  stop(): void;
}

export interface RunTurnOptions {
  /** The user's (already-transcribed) message. */
  text: string;
  /** Where synthesized sentences are played. */
  playback: TtsPlayback;
  /** Returns false once this turn has been superseded (interrupt / re-send).
   *  Defaults to always-current (the headless turn never overlaps). */
  isCurrent?: () => boolean;
  /** Receives the chat-stream abort fn so the caller can interrupt. */
  onChatAbort?: (abort: (() => void) | null) => void;
}

export interface TurnResult {
  /** The turn paused or resumed music, silently. The hands-free loop must stop
   *  here rather than listen again: after "continue" it would record the music. */
  endSession: boolean;
}

// Silent server tools; must match SILENT_TOOLS in web/src/app/api/chat/route.ts.
const MUSIC_TOOLS = new Set(['pause_music', 'resume_music']);

/** Calendar days from `from` to `to` in local time: 0 = same day, 1 = tomorrow. */
export function calendarDaysFrom(from: number, to: number): number {
  const a = new Date(from);
  const b = new Date(to);
  const dayA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const dayB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((dayB - dayA) / 86_400_000);
}

/**
 * Orchestrates one assistant turn: chat SSE → per-sentence TTS → playback.
 * UI-agnostic — it drives the shared Zustand stores via getState() and plays
 * audio through the injected `playback` backend, so it runs identically in the
 * foreground (orb playback) and in a screen-off headless task (native
 * playback).
 *
 * STT happens upstream; this takes the final transcript.
 */
export async function runAssistantTurn({
  text,
  playback,
  isCurrent = () => true,
  onChatAbort,
}: RunTurnOptions): Promise<TurnResult> {
  const trimmed = text.trim();
  if (!trimmed) return { endSession: false };

  const voice = useVoiceStore.getState();
  voice.setTranscript('');
  voice.setError(null);

  const { updateLastAssistant, addActions } = useConversationStore.getState();

  // After a long silence start a fresh conversation, so old context (and a
  // wake-word turn landing in yesterday's chat) doesn't leak into this one.
  const convState = useConversationStore.getState();
  const active = convState.activeId
    ? convState.conversations[convState.activeId]
    : undefined;
  if (
    active?.messages.length &&
    Date.now() - Math.max(active.updatedAt, convState.selectedAt) >
      STALE_CONVERSATION_MS
  ) {
    convState.newConversation();
  }

  useConversationStore.getState().addMessage({
    role: 'user',
    content: trimmed,
    timestamp: Date.now(),
  });

  // "Mia, pause" / "continue": act on the phone right away, no chat round trip.
  // The action is logged so a later turn knows the music was paused.
  const local = matchMusicCommand(trimmed);
  if (local) {
    const name = local === 'pause' ? 'pause_music' : 'resume_music';
    await runClientToolCalls([{ id: `local_${Date.now()}`, name, args: {} }]);
    addActions([`${name} {} → {"scheduled":true}`]);
    return { endSession: true };
  }

  // ponytail: fixed 20-message window; summarise older turns if cost matters.
  const recent = selectActiveMessages(useConversationStore.getState()).slice(
    -HISTORY_MESSAGES - 1,
    -1,
  );
  const history = recent.map(({ role, content }) => ({ role, content }));
  const recentActions = recent.flatMap((m) => m.actions ?? []).slice(-8);

  voice.setThinking(true);

  let fullReply = '';
  let ranMusicTool = false;
  let assistantAdded = false;
  const ensureAssistant = () => {
    if (assistantAdded) return;
    useConversationStore.getState().addMessage({
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    });
    // Deliberately does NOT clear `thinking`. The first token arrives well
    // before the first audio does — the sentence still has to finish generating,
    // then synthesize. Clearing here dropped the orb to `idle` for that whole
    // gap, so Mia went visually dead mid-turn and the wait read as a freeze.
    // `thinking` now stays on until audio actually starts (see firstAudioStarted
    // below), which is the honest signal: she is still working.
    assistantAdded = true;
  };

  const locState = useLocationStore.getState();
  const toolsState = useToolsStore.getState();
  const now = Date.now();
  // A Settings city means "I'm here": GPS coords would describe another place.
  const manual = Boolean(locState.manualCity?.trim());
  const userContext = {
    city: getEffectiveCity(locState),
    lat: manual ? undefined : locState.lat,
    lon: manual ? undefined : locState.lon,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
    profile: useProfileStore
      .getState()
      .facts.map((f) => ({ id: f.id, text: f.text })),
    recentActions,
    // An SMS waiting for "კი" / "არა" (names + text only, no numbers).
    pendingSms: getPendingSmsContext(),
    // Lets the model answer "how long is left?" and cancel the right
    // timer/alarm by id (see cancel_* tools).
    timers: toolsState.timers.map((t) => ({
      id: t.id,
      label: t.label || undefined,
      remainingSeconds: Math.max(0, Math.round((t.endsAt - now) / 1000)),
    })),
    alarms: toolsState.alarms.map((a) => {
      const d = new Date(a.ringsAt);
      return {
        id: a.id,
        label: a.label || undefined,
        hour: d.getHours(),
        minute: d.getMinutes(),
        dayOffset: calendarDaysFrom(now, a.ringsAt),
        days: a.days?.length ? a.days : undefined,
      };
    }),
  };

  // Hand each sentence to the playback backend the moment it's complete. The
  // backend overlaps synthesis and serializes playback (see TtsPlayback.speak),
  // so we deliberately do NOT chain here — chaining would delay the next
  // sentence's synthesis until the previous finished playing and reintroduce a
  // gap mid-reply.
  let textBuffer = '';
  const spoken: Promise<void>[] = [];
  const toolRuns: Promise<string | undefined>[] = [];
  let firstAudioStarted = false;

  const flushSentence = (sentence: string) => {
    const t = sentence.trim();
    if (!t) return;
    if (!isCurrent()) return; // turn superseded — don't synthesize stale audio
    const onStart = () => {
      // Fires when audio is genuinely audible, not when the text was ready —
      // synthesis still takes ~1.4s after this sentence is known. Flipping the
      // orb to "speaking" any earlier would show her talking in silence.
      if (firstAudioStarted || !isCurrent()) return;
      firstAudioStarted = true;
      useVoiceStore.getState().setThinking(false);
      useVoiceStore.getState().setSpeaking(true);
    };
    spoken.push(
      playback.speak(t, onStart).catch((e) => {
        dlog('[TTS] speak failed:', e); // includes deliberate interrupts
      }),
    );
  };

  const SENTENCE_RE = /[.!?…]+\s+/;
  const consumeSentences = () => {
    let m: RegExpExecArray | null;
    while ((m = SENTENCE_RE.exec(textBuffer)) !== null) {
      const endIdx = m.index + m[0].length;
      const sentence = textBuffer.slice(0, endIdx);
      textBuffer = textBuffer.slice(endIdx);
      flushSentence(sentence);
    }
  };

  try {
    const { promise, abort } = streamChat({
      message: trimmed,
      history,
      userContext,
      onContent: (chunk) => {
        if (!isCurrent()) return;
        ensureAssistant();
        fullReply += chunk;
        updateLastAssistant(fullReply);
        textBuffer += chunk;
        consumeSentences();
      },
      onToolCalls: (calls) => {
        if (!isCurrent()) return;
        if (calls.some((c) => MUSIC_TOOLS.has(c.name))) ranMusicTool = true;
        toolRuns.push(runClientToolCalls(calls));
      },
      onActions: (actions) => {
        if (isCurrent()) addActions(actions);
      },
      onError: (msg) => {
        expireSessionIf401(msg);
        if (isCurrent()) useVoiceStore.getState().setError(msg);
      },
    });
    onChatAbort?.(abort);
    await promise;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Chat failed';
    expireSessionIf401(msg);
    if (isCurrent()) {
      useVoiceStore.getState().setError(msg);
      useVoiceStore.getState().setThinking(false);
    }
    return { endSession: false };
  }

  // Final sentence (no trailing whitespace, so the regex didn't catch it).
  if (textBuffer.trim()) {
    flushSentence(textBuffer);
    textBuffer = '';
  }

  // Tools whose outcome only the phone knows (SMS) return what to say; the
  // server sent no model reply for those, so speak it and keep it in history.
  const toolSay = (await Promise.all(toolRuns)).filter(Boolean).join(' ');
  if (toolSay && isCurrent()) {
    ensureAssistant();
    fullReply = fullReply ? `${fullReply} ${toolSay}` : toolSay;
    updateLastAssistant(fullReply);
    flushSentence(toolSay);
  }

  if (!fullReply) {
    if (isCurrent()) useVoiceStore.getState().setThinking(false);
    return { endSession: ranMusicTool };
  }

  // Every sentence is already in flight; wait for the last one to finish
  // playing. Individual failures are swallowed at the call site, so this only
  // settles once the backend has worked through its queue.
  try {
    await Promise.all(spoken);
  } catch (e) {
    dlog('[TTS] playback error:', e);
  } finally {
    if (isCurrent()) {
      onChatAbort?.(null);
      useVoiceStore.getState().setThinking(false);
      useVoiceStore.getState().setSpeaking(false);
    }
  }
  return { endSession: ranMusicTool };
}
