import { useCallback, useRef } from 'react';
import ReactNativeBlobUtil from 'react-native-blob-util';

import { streamChat } from '@/api/chat';
import { transcribeGooglePcm } from '@/api/transcribeGoogle';
import {
  synthesizeWithCamb,
  synthesizeWithElevenLabs,
  synthesizeWithOpenAI,
} from '@/api/synthesize';
import { streamTranscribe } from '@/api/transcribe';
import { orbAudio } from '@/lib/orbAudio';
import { runClientToolCalls } from '@/lib/tools/runClientCalls';
import { useConversationStore } from '@/stores/conversationStore';
import { getEffectiveCity, useLocationStore } from '@/stores/locationStore';
import { useVoiceStore } from '@/stores/voiceStore';

import { useAudioRecorder } from './useAudioRecorder';
import { usePcmRecorder } from './usePcmRecorder';

function mimeForPath(path: string): string {
  return path.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';
}

type Mode = 'idle' | 'recording';
type RecorderKind = 'pcm' | 'file';

// Orchestrates record → STT → chat SSE → TTS → playback.
// Mirrors web/src/app/page.tsx:handleUserMessage.
//
// Two recording paths:
//   `pcm`  (preferred) — usePcmRecorder captures raw PCM16 locally, then sends
//                        the whole buffer to Chirp 2 on stop.
//   `file` (fallback)  — nitro-sound records an .m4a, uploaded to
//                        /api/transcribe-stream as SSE.
//
// We try the PCM recorder first; if its native module isn't linked we silently
// fall back to file mode so the app still works.

// Dev-only pipeline diagnostics; silenced in release builds.
const dlog = (...args: unknown[]) => {
  if (__DEV__) console.warn('[Pipeline]', ...args);
};

export function useVoicePipeline() {
  const recorder = useAudioRecorder();
  const pcmRecorder = usePcmRecorder();
  const modeRef = useRef<Mode>('idle');
  const activeKindRef = useRef<RecorderKind>('pcm');

  // Each user turn gets a monotonic id. Anything async (chat SSE, sentence
  // playback) checks it before touching audio or shared state, so an interrupt
  // or a rapid re-send cleanly supersedes the previous turn instead of leaking
  // into it (e.g. queued sentences playing over a new recording).
  const turnIdRef = useRef(0);
  const chatAbortRef = useRef<(() => void) | null>(null);

  const cancelActiveTurn = useCallback(() => {
    turnIdRef.current += 1; // invalidate whatever turn is in flight
    chatAbortRef.current?.(); // stop the chat SSE
    chatAbortRef.current = null;
    orbAudio.stop(); // stop the current sentence + resolve its pending promise
  }, []);

  const { updateLastAssistant } = useConversationStore.getState();

  const handleText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Supersede any in-flight turn (interrupt, or a rapid second send).
      cancelActiveTurn();
      const myTurn = ++turnIdRef.current;
      const isCurrent = () => turnIdRef.current === myTurn;

      const voice = useVoiceStore.getState();
      voice.setTranscript('');
      voice.setError(null);

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
        timezone:
          Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
      };

      // Synthesize + play sentences as they arrive from the chat stream.
      // Synthesis runs in parallel (multiple Camb tasks in flight); playback
      // is sequential via a Promise chain so audio doesn't overlap.
      const { ttsProvider, openaiVoice } = useVoiceStore.getState();
      const synthesize = (text: string) => {
        if (ttsProvider === 'elevenlabs') return synthesizeWithElevenLabs(text);
        if (ttsProvider === 'camb') return synthesizeWithCamb(text);
        return synthesizeWithOpenAI(text, openaiVoice);
      };

      let textBuffer = '';
      let playbackChain: Promise<void> = Promise.resolve();
      let firstAudioStarted = false;

      const flushSentence = (sentence: string) => {
        const text = sentence.trim();
        if (!text) return;
        const synthPromise = synthesize(text).catch((e) => {
          console.warn('[TTS] synth failed:', e);
          return null;
        });
        playbackChain = playbackChain
          .then(async () => {
            if (!isCurrent()) return; // turn superseded — don't play stale audio
            const path = await synthPromise;
            if (!path || !isCurrent()) return;
            const cleanPath = path.replace(/^file:\/\//, '');
            const base64 = await ReactNativeBlobUtil.fs.readFile(
              cleanPath,
              'base64',
            );
            if (!isCurrent()) return;
            if (!firstAudioStarted) {
              firstAudioStarted = true;
              useVoiceStore.getState().setThinking(false);
              useVoiceStore.getState().setSpeaking(true);
            }
            await orbAudio.play(base64, mimeForPath(path));
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
        chatAbortRef.current = abort;
        await promise;
      } catch (err) {
        if (isCurrent()) {
          const msg = err instanceof Error ? err.message : 'Chat failed';
          useVoiceStore.getState().setError(msg);
          useVoiceStore.getState().setThinking(false);
        }
        return;
      }

      // Final sentence (no trailing whitespace, so regex didn't catch it).
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
          chatAbortRef.current = null;
          useVoiceStore.getState().setThinking(false);
          useVoiceStore.getState().setSpeaking(false);
        }
      }
    },
    [updateLastAssistant, cancelActiveTurn],
  );

  const startListening = useCallback(async () => {
    if (modeRef.current === 'recording') return;
    useVoiceStore.getState().setError(null);
    useVoiceStore.getState().setTranscript('');

    // Try the PCM recorder first.
    try {
      dlog('attempting PCM recorder start…');
      await pcmRecorder.start();
      activeKindRef.current = 'pcm';
      modeRef.current = 'recording';
      useVoiceStore.getState().setListening(true);
      dlog('PCM recorder active');
      return;
    } catch (err) {
      dlog(
        'PCM recorder start failed, falling back to file recorder:',
        err instanceof Error ? err.message : err,
      );
    }

    // Fallback: file recorder + /api/transcribe-stream upload.
    try {
      dlog('using file recorder fallback');
      await recorder.start();
      activeKindRef.current = 'file';
      modeRef.current = 'recording';
      useVoiceStore.getState().setListening(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Recording failed';
      useVoiceStore.getState().setError(msg);
      useVoiceStore.getState().setListening(false);
      modeRef.current = 'idle';
    }
  }, [recorder, pcmRecorder]);

  const stopListeningAndSend = useCallback(async () => {
    if (modeRef.current !== 'recording') return;
    const kind = activeKindRef.current;
    modeRef.current = 'idle';
    useVoiceStore.getState().setListening(false);

    let text = '';
    try {
      if (kind === 'pcm') {
        const { audioBase64, sampleRate } = await pcmRecorder.stop();
        if (!audioBase64) {
          useVoiceStore.getState().setError('Empty recording.');
          return;
        }
        useVoiceStore.getState().setTranscript('Transcribing…');
        text = (await transcribeGooglePcm(audioBase64, sampleRate)).trim();
      } else {
        const path = await recorder.stop();
        if (!path) return;
        useVoiceStore.getState().setTranscript('Transcribing…');
        const { promise } = streamTranscribe({
          filePath: path,
          onPartial: (partial) =>
            useVoiceStore.getState().setTranscript(partial),
        });
        text = (await promise).trim();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transcription failed';
      useVoiceStore.getState().setError(msg);
      useVoiceStore.getState().setTranscript('');
      return;
    }

    useVoiceStore.getState().setTranscript('');
    if (!text) {
      useVoiceStore.getState().setError('Empty transcription.');
      return;
    }
    await handleText(text);
  }, [recorder, pcmRecorder, handleText]);

  const stopSpeaking = useCallback(() => {
    cancelActiveTurn();
    useVoiceStore.getState().setSpeaking(false);
  }, [cancelActiveTurn]);

  return {
    startListening,
    stopListeningAndSend,
    sendText: handleText,
    stopSpeaking,
  };
}
