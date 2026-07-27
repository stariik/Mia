import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { expireSessionIf401 } from '@/api/client';
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
//
// Turns run as a hands-free CONVERSATION: one tap opens a session and the mic
// re-arms itself after every answer, so a back-and-forth costs exactly one tap
// at the start and one to end it. A session survives only clean turns — any
// error, empty turn, or silent listen window closes it rather than looping.

export function useVoicePipeline() {
  const pcmRecorder = usePcmRecorder();
  const modeRef = useRef<Mode>('idle');

  // Each user turn gets a monotonic id. Anything async (chat SSE, sentence
  // playback) checks it before touching audio or shared state, so an interrupt
  // or a rapid re-send cleanly supersedes the previous turn.
  const turnIdRef = useRef(0);
  const chatAbortRef = useRef<(() => void) | null>(null);

  // Hands-free session state. `conversationRef` is what the orb tap reads to
  // decide start-vs-stop; `sessionRef` is a monotonic id so a turn that lands
  // after the user tapped stop can't re-arm the mic behind their back (the turn
  // id alone can't express this — `handleText` bumps it mid-turn).
  const conversationRef = useRef(false);
  const sessionRef = useRef(0);

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
    // Opening a session (rather than re-arming inside one) gets a fresh id, so
    // turns from an earlier session are orphaned and can't drive this one.
    if (!conversationRef.current) {
      conversationRef.current = true;
      sessionRef.current += 1;
    }
    // Supersede a transcription still in flight from the PREVIOUS recording —
    // otherwise its result would fire a ghost turn while the user is already
    // re-recording (stopListeningAndSend checks this id after the STT await).
    turnIdRef.current += 1;
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
      conversationRef.current = false; // no mic, no session
      // Recording never started — let the wake word listen again.
      wakeWord.resumeDetection();
    }
  }, [pcmRecorder]);

  const stopListeningAndSend = useCallback(async () => {
    if (modeRef.current !== 'recording') return;
    modeRef.current = 'idle';
    useVoiceStore.getState().setListening(false);

    // This send is stale once anything bumps the turn id (a new recording, an
    // interrupt) while we're waiting on STT below.
    const myTurn = turnIdRef.current;
    const isStale = () => turnIdRef.current !== myTurn;
    // Which hands-free session this turn belongs to, captured before any await:
    // stopConversation() bumps it, which is how a tap mid-answer prevents the
    // re-arm below from firing once the turn finally settles.
    const mySession = sessionRef.current;
    let answered = false;

    try {
      let text = '';
      try {
        const { audioBase64, sampleRate } = await pcmRecorder.stop();
        if (!audioBase64) {
          if (!isStale()) useVoiceStore.getState().setError('Empty recording.');
          return;
        }
        useVoiceStore.getState().setTranscript('Transcribing…');
        text = (await transcribeGooglePcm(audioBase64, sampleRate)).trim();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Transcription failed';
        expireSessionIf401(msg);
        if (!isStale()) {
          useVoiceStore.getState().setError(msg);
          useVoiceStore.getState().setTranscript('');
        }
        return;
      } finally {
        // Mic is free again — resume wake-word listening (no-op if disabled).
        // Not when superseded: a NEW recording owns the mic now and will resume
        // detection itself when it finishes.
        if (!isStale()) wakeWord.resumeDetection();
      }

      if (isStale()) return; // superseded during STT — drop the ghost turn
      useVoiceStore.getState().setTranscript('');
      if (!text) {
        useVoiceStore.getState().setError('Empty transcription.');
        return;
      }
      await handleText(text);
      answered = true;
    } finally {
      // Hands-free re-arm: Mia has finished speaking, so listen for the reply
      // without another tap. Skipped entirely once the session id has moved on
      // (the user tapped stop), so a turn that settles late can't reopen the mic.
      if (sessionRef.current === mySession) {
        if (answered) {
          if (conversationRef.current) await startListening();
        } else if (!isStale()) {
          // This turn failed on its own merits (bad audio, STT error, nothing
          // said) — end the session rather than retry, so a failing backend
          // can't spin the mic in a loop. A STALE turn is excluded: something
          // else (wake word, a fresh tap) already owns the session now.
          conversationRef.current = false;
        }
      }
    }
  }, [pcmRecorder, handleText, startListening]);

  // Ends the hands-free session: stops the mic (discarding audio), kills the
  // in-flight turn, and drops the orb to idle. This is what the second orb tap
  // does, at any point in the loop.
  const stopConversation = useCallback(async () => {
    conversationRef.current = false;
    sessionRef.current += 1; // orphan any turn still in flight
    cancelActiveTurn();
    useVoiceStore.getState().setSpeaking(false);
    useVoiceStore.getState().setThinking(false);
    useVoiceStore.getState().setTranscript('');

    if (modeRef.current === 'recording') {
      modeRef.current = 'idle';
      useVoiceStore.getState().setListening(false);
      try {
        await pcmRecorder.stop(); // audio is deliberately dropped, not sent
      } catch {
        // Already stopped / never really started — nothing to salvage.
      }
      wakeWord.resumeDetection();
    }
  }, [cancelActiveTurn, pcmRecorder]);

  // Leaving the foreground ends the session and drops the recording.
  //
  // This is not just tidiness: RN pauses JS timers once no Activity is resumed
  // (see WakeWordService.startBackgroundTurn), so useSilenceAutoStop's interval
  // stops firing and the VAD can never auto-close the turn. Nothing else
  // releases the mic — usePcmRecorder's cleanup runs on unmount, and
  // backgrounding doesn't unmount — so the orb would sit recording until the
  // user came back, then ship the whole buffered stretch to STT. With "Hey Mia"
  // enabled that capture is real audio, not silence: pauseDetection() keeps the
  // service foreground, so the process still holds a microphone-type FGS.
  //
  // Background and screen-off conversations are the wake word's job, and it has
  // the service and headless runtime to do them properly.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') return;
      // Only when a turn is genuinely in flight. Android reports a pause while
      // the runtime mic-permission dialog is up, which happens inside
      // startListening() before `recording` is set — reacting to that would
      // close the session the user is in the middle of opening.
      const { isThinking, isSpeaking } = useVoiceStore.getState();
      if (modeRef.current === 'recording' || isThinking || isSpeaking) {
        void stopConversation();
      }
    });
    return () => sub.remove();
  }, [stopConversation]);

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
    stopConversation,
    isConversationActive: () => conversationRef.current,
    sendText: handleText,
    stopSpeaking,
  };
}
