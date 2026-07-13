import { useCallback, useRef } from 'react';

import { transcribeGooglePcm } from '@/api/transcribeGoogle';
import { streamTranscribe } from '@/api/transcribe';
import { runAssistantTurn } from '@/lib/assistantTurn';
import { orbPlayback } from '@/lib/orbPlayback';
import { wakeWord } from '@/lib/wakeWord';
import { useVoiceStore } from '@/stores/voiceStore';

import { useAudioRecorder } from './useAudioRecorder';
import { usePcmRecorder } from './usePcmRecorder';

type Mode = 'idle' | 'recording';
type RecorderKind = 'pcm' | 'file';

// Orchestrates record → STT → assistant turn (chat SSE → TTS → playback).
//
// The chat→TTS→playback half lives in `runAssistantTurn` (UI-agnostic) so it's
// shared verbatim with the screen-off headless wake turn; this hook owns the
// foreground concerns: recording, turn/interrupt bookkeeping, and orb playback.
//
// Two recording paths:
//   `pcm`  (preferred) — usePcmRecorder captures raw PCM16 locally, then sends
//                        the whole buffer to Chirp 2 on stop.
//   `file` (fallback)  — nitro-sound records an .m4a, uploaded to
//                        /api/transcribe-stream as SSE.

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
  // or a rapid re-send cleanly supersedes the previous turn.
  const turnIdRef = useRef(0);
  const chatAbortRef = useRef<(() => void) | null>(null);

  const cancelActiveTurn = useCallback(() => {
    turnIdRef.current += 1; // invalidate whatever turn is in flight
    chatAbortRef.current?.(); // stop the chat SSE
    chatAbortRef.current = null;
    orbPlayback.stop(); // stop the current sentence + resolve its pending promise
  }, []);

  const handleText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Supersede any in-flight turn (interrupt, or a rapid second send).
      cancelActiveTurn();
      const myTurn = ++turnIdRef.current;

      await runAssistantTurn({
        text: trimmed,
        playback: orbPlayback,
        isCurrent: () => turnIdRef.current === myTurn,
        onChatAbort: (abort) => {
          chatAbortRef.current = abort;
        },
      });
    },
    [cancelActiveTurn],
  );

  const startListening = useCallback(async () => {
    if (modeRef.current === 'recording') return;
    useVoiceStore.getState().setError(null);
    useVoiceStore.getState().setTranscript('');

    // Hand the mic off from the "Hey Mia" service so two AudioRecord consumers
    // don't fight over it (no-op when the wake word isn't running).
    wakeWord.pauseDetection();

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
      // Recording never started — let the wake word listen again.
      wakeWord.resumeDetection();
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
    } finally {
      // Mic is free again — resume wake-word listening (no-op if disabled).
      wakeWord.resumeDetection();
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
