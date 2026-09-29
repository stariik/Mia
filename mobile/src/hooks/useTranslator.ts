import { useCallback, useRef, useState } from 'react';

import { expireSessionIf401 } from '@/api/client';
import { transcribeGooglePcm } from '@/api/transcribeGoogle';
import { translateText } from '@/api/translate';
import { synthesizeWithElevenLabs } from '@/api/synthesize';
import { fs } from '@/lib/fs';
import { nativeAudio } from '@/lib/nativeAudio';
import { bcp47, type Direction, type Lang } from '@/lib/translateLanguages';
import { useTranslatorStore } from '@/stores/translatorStore';

import { usePcmRecorder } from './usePcmRecorder';

export type { Direction, Lang } from '@/lib/translateLanguages';

export type Turn = {
  id: string;
  source: Lang;
  target: Lang;
  heard: string;
  translated: string;
};

export type TranslatorStatus = 'idle' | 'listening' | 'working';

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

  const finishTurn = useCallback(
    (source: Lang, target: Lang, heard: string, translated: string) => {
      setTurns((prev) => [
        ...prev,
        { id: newId(), source, target, heard, translated },
      ]);
      setStatus('idle');
      // Read the latest pref, not the one captured when the turn started.
      if (useTranslatorStore.getState().autoSpeak) void speak(translated);
    },
    [],
  );

  const fail = useCallback((e: unknown) => {
    const msg = e instanceof Error ? e.message : 'თარგმნა ვერ მოხერხდა';
    expireSessionIf401(msg);
    setError(msg);
    setStatus('idle');
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

  // Mic tap: start if idle, stop+translate if recording.
  const toggleListen = useCallback(() => {
    if (status === 'listening') {
      void stopAndTranslate();
    } else if (status === 'idle') {
      void startListening();
    }
  }, [status, startListening, stopAndTranslate]);

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
    error,
    toggleListen,
    stopAndTranslate,
    translateTyped,
    replay,
    clear,
  };
}
