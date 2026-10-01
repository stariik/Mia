import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { expireSessionIf401 } from '@/api/client';
import { transcribeGooglePcm } from '@/api/transcribeGoogle';
import { runAssistantTurn, type TurnResult } from '@/lib/assistantTurn';
import { translator } from '@/lib/translator/session';
import { matchTranslatorCommand } from '@/lib/translatorCommands';
import { orbPlayback } from '@/lib/orbPlayback';
import { wakeWord } from '@/lib/wakeWord';
import { useVoiceStore } from '@/stores/voiceStore';
import { useAuthStore } from '@/stores/authStore';
import { streamingEnabled, streamUrl } from '@/stt/client';
import { SttController, type Socket } from '@/stt/controller';
import { expoCapture } from '@/stt/expoCapture';
import { ensureMicrophonePermission } from './usePermissions';

import { usePcmRecorder } from './usePcmRecorder';

type Mode = 'idle' | 'connecting' | 'recording';

// Orchestrates record → STT → assistant turn (chat SSE → TTS → playback).
//
// The chat→TTS→playback half lives in `runAssistantTurn` (UI-agnostic) so it's
// shared verbatim with the screen-off headless wake turn; this hook owns the
// foreground concerns: recording, turn/interrupt bookkeeping, and orb playback.
//
// The server selects foreground streaming or the preserved legacy recorder
// before each utterance. Streaming always uses Expo AudioStream on both
// platforms. A failed utterance is never replayed through another provider.
//
// Turns run as a hands-free CONVERSATION: one tap opens a session and the mic
// re-arms itself after every answer, so a back-and-forth costs exactly one tap
// at the start and one to end it. A session survives only clean turns — any
// error, empty turn, or silent listen window closes it rather than looping.

export function useVoicePipeline() {
  const pcmRecorder = usePcmRecorder();
  const modeRef = useRef<Mode>('idle');
  const streamRef = useRef<SttController | null>(null);
  const configAbort = useRef<AbortController | null>(null);
  const permissionPending = useRef(false);

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
    async (text: string): Promise<TurnResult> => {
      const trimmed = text.trim();
      if (!trimmed) return { endSession: false };

      // Supersede any in-flight turn (interrupt, or a rapid second send).
      cancelActiveTurn();
      const myTurn = ++turnIdRef.current;

      // "Translate to English" / "თარგმნე ინგლისურად": switch modes on the
      // phone at once, no chat round trip. Ending the session keeps the
      // hands-free loop from re-arming the chat mic under the translator's.
      const command = matchTranslatorCommand(trimmed, { inSession: false });
      let result: TurnResult;
      if (command?.kind === 'start') {
        result = {
          endSession: true,
          translator: {
            ...(command.from && { from: command.from }),
            ...(command.to && { to: command.to }),
          },
        };
      } else {
        result = await runAssistantTurn({
          text: trimmed,
          playback: orbPlayback,
          isCurrent: () => turnIdRef.current === myTurn,
          onChatAbort: (abort) => {
            chatAbortRef.current = abort;
          },
        });
      }
      // Every caller has released the mic by now (the STT finished, or
      // sendText stopped the conversation), so the translator can take it.
      if (result.translator && turnIdRef.current === myTurn) {
        conversationRef.current = false;
        void translator.start(result.translator);
      }
      return result;
    },
    [cancelActiveTurn],
  );

  const startListening = useCallback(async (): Promise<void> => {
    if (modeRef.current !== 'idle') return;
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
    const myTurn = turnIdRef.current;
    const mySession = sessionRef.current;
    modeRef.current = 'connecting';
    useVoiceStore.getState().setError(null);
    useVoiceStore.getState().setTranscript('');

    // Hand the mic off from the "Hey Mia" service so two AudioRecord consumers
    // don't fight over it (no-op when the wake word isn't running).
    wakeWord.pauseDetection();

    // Opening the mic takes a network check and a recorder start; show the orb
    // waking now rather than idle until the mic is live. Cleared in finally.
    useVoiceStore.getState().setArming(true);
    try {
      const abort = new AbortController();
      configAbort.current = abort;
      const timeout = setTimeout(() => abort.abort(), 5000);
      let streaming: boolean;
      try { streaming = await streamingEnabled(abort.signal); }
      finally { clearTimeout(timeout); if (configAbort.current === abort) configAbort.current = null; }
      if (myTurn !== turnIdRef.current || mySession !== sessionRef.current) return;
      if (AppState.currentState === 'background') throw new Error('Listening stopped while the app was in the background.');
      if (streaming) {
        // Ask permission before connecting; OS permission dialogs briefly background the app.
        permissionPending.current = true;
        let granted: boolean;
        try { granted = await ensureMicrophonePermission(); }
        finally { permissionPending.current = false; }
        if (myTurn !== turnIdRef.current || mySession !== sessionRef.current) return;
        if (!granted) throw new Error('Microphone permission denied');
        if (String(AppState.currentState) === 'background') throw new Error('Listening stopped while the app was in the background.');
        const store = useVoiceStore.getState();
        store.setStt({ streaming: true, sttState: 'connecting', listeningSeconds: 0, keepListening: false });
        const controller = new SttController({
          capture: expoCapture(), socket: () => new WebSocket(streamUrl()) as unknown as Socket,
          token: useAuthStore.getState().token ?? '',
          identity: { sessionId: `s${mySession}_${Date.now()}`, utteranceId: `u${myTurn}_${Date.now()}` },
          state: state => {
            if (myTurn !== turnIdRef.current) return;
            useVoiceStore.getState().setStt({ sttState: state });
            useVoiceStore.getState().setListening(state === 'listening');
            modeRef.current = state === 'listening' ? 'recording' : state === 'connecting' || state === 'finalizing' ? 'connecting' : 'idle';
          },
          partial: text => { if (myTurn === turnIdRef.current) useVoiceStore.getState().setTranscript(text); },
          elapsed: seconds => { if (myTurn === turnIdRef.current) useVoiceStore.getState().setStt({ listeningSeconds: seconds }); },
        });
        streamRef.current = controller;
        void controller.start().then(async text => {
          if (myTurn !== turnIdRef.current || mySession !== sessionRef.current) return;
          streamRef.current = null;
          wakeWord.resumeDetection();
          useVoiceStore.getState().setTranscript('');
          if (!text) { conversationRef.current = false; return; }
          // Music paused/resumed: end hands-free rather than record the music.
          if ((await handleText(text)).endSession) conversationRef.current = false;
          if (mySession === sessionRef.current && conversationRef.current && !useVoiceStore.getState().error) await startListening();
          else if (mySession === sessionRef.current) conversationRef.current = false;
        }).catch(error => {
          if (myTurn !== turnIdRef.current || mySession !== sessionRef.current) return;
          streamRef.current = null; conversationRef.current = false; modeRef.current = 'idle';
          expireSessionIf401(error.message);
          useVoiceStore.getState().setError(error.message);
          useVoiceStore.getState().setTranscript('');
          useVoiceStore.getState().setListening(false);
          wakeWord.resumeDetection();
        });
        return;
      }
      useVoiceStore.getState().setStt({ streaming: false, sttState: 'idle' });
      permissionPending.current = true;
      try { await pcmRecorder.start(); } finally { permissionPending.current = false; }
      if (myTurn !== turnIdRef.current || mySession !== sessionRef.current) { await pcmRecorder.stop(); return; }
      modeRef.current = 'recording';
      useVoiceStore.getState().setListening(true);
    } catch (err) {
      if (myTurn !== turnIdRef.current || mySession !== sessionRef.current) return;
      const msg = err instanceof Error ? err.message : 'Recording failed';
      expireSessionIf401(msg);
      useVoiceStore.getState().setError(msg);
      useVoiceStore.getState().setListening(false);
      modeRef.current = 'idle';
      conversationRef.current = false; // no mic, no session
      // Recording never started — let the wake word listen again.
      wakeWord.resumeDetection();
    } finally {
      useVoiceStore.getState().setArming(false);
    }
  }, [pcmRecorder, handleText]);

  const stopListeningAndSend = useCallback(async () => {
    if (streamRef.current) { streamRef.current.finish(); return; }
    if (modeRef.current !== 'recording') return;
    modeRef.current = 'idle';
    // Same tick: the orb goes straight from listening to thinking while the
    // recording is transcribed, instead of dropping to idle for the STT wait.
    useVoiceStore.getState().setListening(false);
    useVoiceStore.getState().setProcessing(true);

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
      // Hand over to the turn, which sets "thinking" in this same tick.
      useVoiceStore.getState().setProcessing(false);
      // Music paused/resumed: end hands-free rather than record the music.
      if ((await handleText(text)).endSession) conversationRef.current = false;
      answered = true;
    } finally {
      useVoiceStore.getState().setProcessing(false);
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
    configAbort.current?.abort(); configAbort.current = null;
    const streaming = streamRef.current;
    streamRef.current = null;
    streaming?.cancel();
    useVoiceStore.getState().setStt({ sttState: 'idle', listeningSeconds: 0, keepListening: false });
    if (streaming || modeRef.current === 'connecting') {
      modeRef.current = 'idle';
      useVoiceStore.getState().setListening(false);
      wakeWord.resumeDetection();
    }
    useVoiceStore.getState().setSpeaking(false);
    useVoiceStore.getState().setThinking(false);
    useVoiceStore.getState().setProcessing(false);
    useVoiceStore.getState().setArming(false);
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
      if (streamRef.current || (modeRef.current === 'connecting' && !permissionPending.current) || modeRef.current === 'recording' || isThinking || isSpeaking) {
        void stopConversation();
      }
    });
    return () => sub.remove();
  }, [stopConversation]);

  useEffect(() => () => { void stopConversation(); }, [stopConversation]);

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
    sendText: async (text: string) => { await stopConversation(); await handleText(text); },
    keepListening: () => {
      streamRef.current?.keepListening();
      useVoiceStore.getState().setStt({ keepListening: true });
    },
    stopSpeaking,
  };
}
