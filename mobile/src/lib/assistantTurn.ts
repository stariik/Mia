import { streamChat } from '@/api/chat';
import {
  synthesizeWithCamb,
  synthesizeWithElevenLabs,
  synthesizeWithOpenAI,
} from '@/api/synthesize';
import { runClientToolCalls } from '@/lib/tools/runClientCalls';
import { useConversationStore } from '@/stores/conversationStore';
import { getEffectiveCity, useLocationStore } from '@/stores/locationStore';
import { useVoiceStore } from '@/stores/voiceStore';

// A pluggable TTS playback backend. Two implementations exist:
//   - orbPlayback    — plays through the WebView orb (foreground, drives the
//                      orb visualization). Requires the UI/Activity.
//   - nativePlayback — plays via nitro-sound, no UI. Used by the screen-off
//                      headless turn.
export interface TtsPlayback {
  /** Play a synthesized audio file to completion. */
  play(filePath: string, mime: string): Promise<void>;
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

export function mimeForPath(path: string): string {
  return path.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';
}

/**
 * Synthesize one phrase with whichever TTS provider the user has selected.
 * Shared by the per-sentence streaming synth below and by the hands-free
 * session's greeting/farewell lines, so they all speak in the same voice.
 */
export function synthesizeForVoice(text: string): Promise<string> {
  const { ttsProvider, openaiVoice } = useVoiceStore.getState();
  if (ttsProvider === 'elevenlabs') return synthesizeWithElevenLabs(text);
  if (ttsProvider === 'camb') return synthesizeWithCamb(text);
  return synthesizeWithOpenAI(text, openaiVoice);
}

/**
 * Orchestrates one assistant turn: chat SSE → per-sentence TTS → playback.
 * Mirrors web/src/app/page.tsx:handleUserMessage. UI-agnostic — it drives the
 * shared Zustand stores via getState() and plays audio through the injected
 * `playback` backend, so it runs identically in the foreground (orb playback)
 * and in a screen-off headless task (native playback).
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

  const history = useConversationStore
    .getState()
    .messages.slice(-11, -1)
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
    useVoiceStore.getState().setThinking(false);
    assistantAdded = true;
  };

  const locState = useLocationStore.getState();
  const userContext = {
    city: getEffectiveCity(locState),
    lat: locState.lat,
    lon: locState.lon,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
  };

  // Synthesize + play sentences as they arrive. Synthesis runs in parallel;
  // playback is sequential via a Promise chain so audio doesn't overlap.
  const synthesize = synthesizeForVoice;

  let textBuffer = '';
  let playbackChain: Promise<void> = Promise.resolve();
  let firstAudioStarted = false;

  const flushSentence = (sentence: string) => {
    const t = sentence.trim();
    if (!t) return;
    const synthPromise = synthesize(t).catch((e) => {
      console.warn('[TTS] synth failed:', e);
      return null;
    });
    playbackChain = playbackChain
      .then(async () => {
        if (!isCurrent()) return; // turn superseded — don't play stale audio
        const path = await synthPromise;
        if (!path || !isCurrent()) return;
        if (!firstAudioStarted) {
          firstAudioStarted = true;
          useVoiceStore.getState().setThinking(false);
          useVoiceStore.getState().setSpeaking(true);
        }
        await playback.play(path, mimeForPath(path));
      })
      .catch((e) => {
        console.warn('[TTS] playback failed:', e);
      });
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
        if (isCurrent()) useVoiceStore.getState().setError(msg);
      },
    });
    onChatAbort?.(abort);
    await promise;
  } catch (err) {
    if (isCurrent()) {
      const msg = err instanceof Error ? err.message : 'Chat failed';
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

  try {
    await playbackChain;
  } catch (e) {
    console.warn('[TTS] chain error:', e);
  } finally {
    if (isCurrent()) {
      onChatAbort?.(null);
      useVoiceStore.getState().setThinking(false);
      useVoiceStore.getState().setSpeaking(false);
    }
  }
}
