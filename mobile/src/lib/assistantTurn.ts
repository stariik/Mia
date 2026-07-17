import { streamChat } from '@/api/chat';
import { expireSessionIf401 } from '@/api/client';
import { dlog } from '@/lib/log';
import { runClientToolCalls } from '@/lib/tools/runClientCalls';
import {
  selectActiveMessages,
  useConversationStore,
} from '@/stores/conversationStore';
import { getEffectiveCity, useLocationStore } from '@/stores/locationStore';
import { useVoiceStore } from '@/stores/voiceStore';

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
}: RunTurnOptions): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const voice = useVoiceStore.getState();
  voice.setTranscript('');
  voice.setError(null);

  const { updateLastAssistant } = useConversationStore.getState();

  useConversationStore.getState().addMessage({
    role: 'user',
    content: trimmed,
    timestamp: Date.now(),
  });

  const history = selectActiveMessages(useConversationStore.getState())
    .slice(-11, -1)
    .map(({ role, content }) => ({ role, content }));

  voice.setThinking(true);

  let fullReply = '';
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
  const userContext = {
    city: getEffectiveCity(locState),
    lat: locState.lat,
    lon: locState.lon,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
  };

  // Hand each sentence to the playback backend the moment it's complete. The
  // backend overlaps synthesis and serializes playback (see TtsPlayback.speak),
  // so we deliberately do NOT chain here — chaining would delay the next
  // sentence's synthesis until the previous finished playing and reintroduce a
  // gap mid-reply.
  let textBuffer = '';
  const spoken: Promise<void>[] = [];
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
        runClientToolCalls(calls);
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
    return;
  }

  // Final sentence (no trailing whitespace, so the regex didn't catch it).
  if (textBuffer.trim()) {
    flushSentence(textBuffer);
    textBuffer = '';
  }

  if (!fullReply) {
    if (isCurrent()) useVoiceStore.getState().setThinking(false);
    return;
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
}
