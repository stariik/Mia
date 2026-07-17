import { useCallback, useRef } from 'react';

import { transcribeGooglePcm } from '@/api/transcribeGoogle';
import { runAssistantTurn } from '@/lib/assistantTurn';
import { orbPlayback } from '@/lib/orbPlayback';
import { wakeWord } from '@/lib/wakeWord';
import { useVoiceStore } from '@/stores/voiceStore';

import { usePcmRecorder } from './usePcmRecorder';

type Mode = 'idle' | 'recording';

// Orchestrates record → STT → assistant turn (chat SSE → TTS → playback).
//
// The chat→TTS→playback half lives in `runAssistantTurn` (UI-agnostic) so it's
// shared verbatim with the screen-off headless wake turn; this hook owns the
// foreground concerns: recording, turn/interrupt bookkeeping, and orb playback.
//
// Capture is raw PCM16 (usePcmRecorder → Picovoice voice-processor), buffered
// locally and sent whole to Chirp 2 on stop. There is no fallback recorder: the
// native module is compiled into every build, so a start failure is a real
// error the user should see, not a silent downgrade.

export function useVoicePipeline() {
  const pcmRecorder = usePcmRecorder();
  const modeRef = useRef<Mode>('idle');

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

    try {
      await pcmRecorder.start();
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
  }, [pcmRecorder]);

  const stopListeningAndSend = useCallback(async () => {
    if (modeRef.current !== 'recording') return;
    modeRef.current = 'idle';
    useVoiceStore.getState().setListening(false);

    let text = '';
    try {
      const { audioBase64, sampleRate } = await pcmRecorder.stop();
      if (!audioBase64) {
        useVoiceStore.getState().setError('Empty recording.');
        return;
      }
      useVoiceStore.getState().setTranscript('Transcribing…');
      text = (await transcribeGooglePcm(audioBase64, sampleRate)).trim();
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
  }, [pcmRecorder, handleText]);

  const stopSpeaking = useCallback(() => {
    cancelActiveTurn();
    useVoiceStore.getState().setSpeaking(false);
    // Also clear "thinking": a turn canceled before its first token would
    // otherwise leave the flag set forever (the superseded turn's finally
    // block is gated on isCurrent() and won't touch shared state).
    useVoiceStore.getState().setThinking(false);
  }, [cancelActiveTurn]);

  return {
    startListening,
    stopListeningAndSend,
    sendText: handleText,
    stopSpeaking,
  };
}
