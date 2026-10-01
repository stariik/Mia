import { useCallback, useEffect, useRef, useState } from 'react';

import { expireSessionIf401 } from '@/api/client';
import { transcribeGooglePcm } from '@/api/transcribeGoogle';
import { translateText } from '@/api/translate';
import { synthesizeWithElevenLabs } from '@/api/synthesize';
import { fs } from '@/lib/fs';
import { nativeAudio } from '@/lib/nativeAudio';
import { wakeWord } from '@/lib/wakeWord';
import { bcp47, type Direction, type Lang } from '@/lib/translateLanguages';
import { useAuthStore } from '@/stores/authStore';
import { useTranslatorStore } from '@/stores/translatorStore';
import { mutedCapture } from '@/stt/audio';
import { streamingEnabled, streamUrl } from '@/stt/client';
import { SttController, type Socket } from '@/stt/controller';
import { expoCapture } from '@/stt/expoCapture';

import { usePcmRecorder } from './usePcmRecorder';
import { ensureMicrophonePermission } from './usePermissions';

export type { Direction, Lang } from '@/lib/translateLanguages';

export type Turn = {
  id: string;
  source: Lang;
  target: Lang;
  heard: string;
  translated: string;
};

// 'live' = streaming interpreter session (sentence-by-sentence, see startLive).
export type TranslatorStatus = 'idle' | 'listening' | 'working' | 'live';

type LiveSession = {
  direction: Direction;
  stopped: boolean;
  speaking: boolean;
  controller: SttController | null;
  muted: ReturnType<typeof mutedCapture> | null;
  // Sentences translate in parallel but land and speak in spoken order.
  chain: Promise<void>;
};

// The gateway rejects an utterance with no speech after 8 s; in a live
// session silence is normal, so these just start the next utterance.
const NO_SPEECH = /^No (complete )?speech/;

function newId() {
  return `t_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
}

// Synthesize + play a line in its language. eleven_v3 is multilingual and
// handles Georgian/Russian/English from the text alone.
async function speak(text: string) {
  if (!text) return;
  try {
    // One multilingual voice covers ka/ru/en. The old OpenAI fallback is gone:
    // if ElevenLabs fails this now throws and the turn is silent (logged below)
    // rather than switching to a worse voice mid-conversation.
    const path = (await synthesizeWithElevenLabs(text)).replace(/^file:\/\//, '');
    try {
      await nativeAudio.play(path);
    } finally {
      // One-shot cache file — a replay re-synthesizes.
      fs.unlink(path);
    }
  } catch (e) {
    // The turn stays visible but silent — a real failure worth release logs.
    console.error('[Translator] speak failed', e);
  }
}

/**
 * Drives the Translator screen. The user picks a direction (from → to, any two
 * different languages). One tap records in the "from" language, transcribes it
 * (single-language STT — fast + accurate), translates into the "to" language,
 * appends the turn, and speaks the result if auto-speak is on. Typed text goes
 * through the same translate step and lands in the same turn list.
 */
export function useTranslator() {
  const recorder = usePcmRecorder();
  const direction = useTranslatorStore((s) => s.direction);
  const swap = useTranslatorStore((s) => s.swap);
  const setFrom = useTranslatorStore((s) => s.setFrom);
  const setTo = useTranslatorStore((s) => s.setTo);
  const autoSpeak = useTranslatorStore((s) => s.autoSpeak);
  const setAutoSpeakPref = useTranslatorStore((s) => s.setAutoSpeak);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<TranslatorStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const recordingRef = useRef(false);
  // Set synchronously so a double tap can't send the same typed text twice
  // before the 'working' status renders.
  const typingRef = useRef(false);
  // Direction captured when recording starts, so a change mid-recording can't
  // mismatch the STT language and the translation pair.
  const directionRef = useRef<Direction>(direction);
  const liveRef = useRef<LiveSession | null>(null);
  // The live speaker's unfinished sentence (finished ones become turns).
  const [liveText, setLiveText] = useState('');

  const addTurn = useCallback(
    (source: Lang, target: Lang, heard: string, translated: string) => {
      setTurns((prev) => [
        ...prev,
        { id: newId(), source, target, heard, translated },
      ]);
    },
    [],
  );

  const finishTurn = useCallback(
    (source: Lang, target: Lang, heard: string, translated: string) => {
      addTurn(source, target, heard, translated);
      setStatus('idle');
      // Read the latest pref, not the one captured when the turn started.
      if (useTranslatorStore.getState().autoSpeak) void speak(translated);
    },
    [addTurn],
  );

  // `resetStatus` false: a live session reports the error and keeps going.
  const fail = useCallback((e: unknown, resetStatus = true) => {
    const msg = e instanceof Error ? e.message : 'თარგმნა ვერ მოხერხდა';
    expireSessionIf401(msg);
    setError(msg);
    if (resetStatus) setStatus('idle');
  }, []);

  const startListening = useCallback(async () => {
    if (status !== 'idle') return;
    setError(null);
    nativeAudio.stop();
    try {
      directionRef.current = direction;
      await recorder.start();
      recordingRef.current = true;
      setStatus('listening');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'მიკროფონი ვერ ჩაირთო');
      setStatus('idle');
    }
  }, [recorder, status, direction]);

  const stopAndTranslate = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    const { from, to } = directionRef.current;
    setStatus('working');
    try {
      const { audioBase64, sampleRate } = await recorder.stop();
      if (!audioBase64) {
        setStatus('idle');
        return;
      }
      const heard = (
        await transcribeGooglePcm(audioBase64, sampleRate, [bcp47(from)])
      ).trim();
      if (!heard) {
        setError('ვერ გავიგე, სცადე თავიდან');
        setStatus('idle');
        return;
      }
      const translated = (await translateText(heard, from, to)).trim();
      finishTurn(from, to, heard, translated);
    } catch (e) {
      fail(e);
    }
  }, [recorder, finishTurn, fail]);

  // ── Live interpreter ─────────────────────────────────────────────────────
  // One session = a chain of streaming utterances (the gateway caps each at
  // 60 s). Every committed sentence (Scribe VAD pause) is translated at once,
  // appended as a turn and spoken; the mic is fed silence while it speaks so
  // the session never translates its own voice.

  const endLive = useCallback(async (live: LiveSession) => {
    await live.chain;
    if (liveRef.current !== live) return;
    liveRef.current = null;
    setLiveText('');
    setStatus('idle');
    wakeWord.resumeDetection();
  }, []);

  const onSentence = useCallback(
    (live: LiveSession, heard: string) => {
      const { from, to } = live.direction;
      const translation = translateText(heard, from, to);
      live.chain = live.chain.then(async () => {
        let translated: string;
        try {
          translated = (await translation).trim();
        } catch (e) {
          if (liveRef.current === live) fail(e, false);
          return;
        }
        if (liveRef.current !== live) return;
        addTurn(from, to, heard, translated);
        if (!translated || !useTranslatorStore.getState().autoSpeak) return;
        live.speaking = true;
        live.muted?.setMuted(true);
        try {
          await speak(translated);
        } finally {
          live.speaking = false;
          live.muted?.setMuted(false);
        }
      });
    },
    [addTurn, fail],
  );

  const startUtterance = useCallback(
    (live: LiveSession) => {
      if (live.stopped || liveRef.current !== live) return;
      const muted = mutedCapture(expoCapture());
      muted.setMuted(live.speaking);
      live.muted = muted;
      const committed: string[] = [];
      const controller: SttController = new SttController({
        capture: muted,
        socket: () => new WebSocket(streamUrl()) as unknown as Socket,
        token: useAuthStore.getState().token ?? '',
        identity: { sessionId: `tr_${Date.now()}`, utteranceId: newId() },
        language: live.direction.from,
        // Pauses are sentence boundaries, not the end of the turn.
        state: (s) => {
          if (s === 'listening') controller.keepListening();
        },
        partial: (text) => {
          if (liveRef.current !== live) return;
          // Partials repeat this utterance's committed sentences; show only the
          // unfinished one.
          const done = committed.join(' ');
          setLiveText(
            (done && text.startsWith(done) ? text.slice(done.length) : text).trim(),
          );
        },
        segment: (text) => {
          committed.push(text);
          onSentence(live, text);
        },
        elapsed: () => {},
      });
      live.controller = controller;
      controller
        .start()
        .then(() => (live.stopped ? endLive(live) : startUtterance(live)))
        .catch((e: Error) => {
          if (live.stopped) return endLive(live);
          if (NO_SPEECH.test(e.message)) return startUtterance(live);
          live.stopped = true;
          if (liveRef.current === live) fail(e, false);
          return endLive(live);
        });
    },
    [onSentence, endLive, fail],
  );

  const startLive = useCallback(async () => {
    const live: LiveSession = {
      direction,
      stopped: false,
      speaking: false,
      controller: null,
      muted: null,
      chain: Promise.resolve(),
    };
    liveRef.current = live;
    setLiveText('');
    setStatus('live');
    // Hand the mic off from the "Hey Mia" service (no-op when it isn't running).
    wakeWord.pauseDetection();
    if (!(await ensureMicrophonePermission())) {
      live.stopped = true;
      setError('მიკროფონის ნებართვა არ არის');
      return endLive(live);
    }
    startUtterance(live);
  }, [direction, startUtterance, endLive]);

  const stopLive = useCallback(() => {
    const live = liveRef.current;
    if (!live || live.stopped) return;
    live.stopped = true;
    setStatus('working');
    const c = live.controller;
    // Finish flushes the unfinished sentence as a last segment; anything not
    // yet listening has nothing to flush.
    if (c?.state === 'listening') c.finish();
    else if (c) c.cancel();
    else void endLive(live);
  }, [endLive]);

  // Leaving the screen ends the session without speaking queued lines.
  useEffect(
    () => () => {
      const live = liveRef.current;
      liveRef.current = null;
      if (!live) return;
      live.stopped = true;
      live.controller?.cancel();
      nativeAudio.stop();
      wakeWord.resumeDetection();
    },
    [],
  );

  // Mic tap: live session when the streaming gateway is on, else the legacy
  // record → stop → translate turn. Tapping again stops either.
  const toggleListen = useCallback(async () => {
    if (status === 'live') return stopLive();
    if (status === 'listening') return void stopAndTranslate();
    if (status !== 'idle') return;
    setError(null);
    nativeAudio.stop();
    setStatus('working');
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 5000);
    let live = false;
    try {
      live = await streamingEnabled(abort.signal);
    } catch {
      // Config check failed: the legacy path still works.
    } finally {
      clearTimeout(timeout);
    }
    setStatus('idle');
    if (live) await startLive();
    else await startListening();
  }, [status, stopLive, stopAndTranslate, startLive, startListening]);

  // Translate typed text in the current direction. Resolves true on success so
  // the caller can clear its input.
  const translateTyped = useCallback(
    async (input: string): Promise<boolean> => {
      const text = input.trim();
      if (!text || status !== 'idle' || typingRef.current) return false;
      typingRef.current = true;
      const { from, to } = direction;
      setError(null);
      nativeAudio.stop();
      setStatus('working');
      try {
        const translated = (await translateText(text, from, to)).trim();
        finishTurn(from, to, text, translated);
        return true;
      } catch (e) {
        fail(e);
        return false;
      } finally {
        typingRef.current = false;
      }
    },
    [status, direction, finishTurn, fail],
  );

  const setAutoSpeak = useCallback(
    (on: boolean) => {
      if (!on) nativeAudio.stop();
      setAutoSpeakPref(on);
    },
    [setAutoSpeakPref],
  );

  const replay = useCallback((turn: Turn) => {
    void speak(turn.translated);
  }, []);

  const clear = useCallback(() => {
    nativeAudio.stop();
    setTurns([]);
    setError(null);
  }, []);

  return {
    direction,
    swap,
    setFrom,
    setTo,
    autoSpeak,
    setAutoSpeak,
    turns,
    status,
    liveText,
    error,
    toggleListen,
    stopAndTranslate,
    translateTyped,
    replay,
    clear,
  };
}
