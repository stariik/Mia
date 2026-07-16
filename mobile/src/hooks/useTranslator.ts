import { useCallback, useRef, useState } from 'react';

import { transcribeGooglePcm } from '@/api/transcribeGoogle';
import { translateText } from '@/api/translate';
import { synthesizeWithElevenLabs } from '@/api/synthesize';
import { playAudioFile, stopAudio } from '@/lib/audioPlayer';
import { bcp47 } from '@/lib/translateLanguages';

import { usePcmRecorder } from './usePcmRecorder';

export type Lang = 'ka' | 'ru' | 'en';
export type ForeignLang = 'ru' | 'en';

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

// Synthesize + play a line in its language. ElevenLabs Flash v2.5 is
// multilingual and handles Georgian/Russian/English from the text alone;
// OpenAI is the fallback.
async function speak(text: string) {
  if (!text) return;
  try {
    // Flash v2.5 is multilingual, so the same voice handles ka/ru/en. The old
    // OpenAI fallback is gone: if ElevenLabs fails this now throws and the turn
    // is silent (logged below) rather than switching to a worse voice mid-
    // conversation.
    const path = await synthesizeWithElevenLabs(text);
    await playAudioFile(path);
  } catch (e) {
    console.warn('[Translator] speak failed', e);
  }
}

/**
 * Drives the Translator screen: one tap records in a known language, then
 * transcribes (single-language STT — fast + accurate), translates to the other
 * side of the pair, appends the turn, and speaks the result.
 */
export function useTranslator() {
  const recorder = usePcmRecorder();
  const [other, setOther] = useState<ForeignLang>('ru');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<TranslatorStatus>('idle');
  const [activeSource, setActiveSource] = useState<Lang | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recordingRef = useRef(false);

  const startListening = useCallback(
    async (source: Lang) => {
      if (status !== 'idle') return;
      setError(null);
      await stopAudio();
      try {
        await recorder.start();
        recordingRef.current = true;
        setActiveSource(source);
        setStatus('listening');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'მიკროფონი ვერ ჩაირთო');
        setActiveSource(null);
        setStatus('idle');
      }
    },
    [recorder, status],
  );

  const stopAndTranslate = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    const source = activeSource ?? 'ka';
    const target: Lang = source === 'ka' ? other : 'ka';
    setStatus('working');
    try {
      const { audioBase64, sampleRate } = await recorder.stop();
      if (!audioBase64) {
        setStatus('idle');
        setActiveSource(null);
        return;
      }
      const heard = (
        await transcribeGooglePcm(audioBase64, sampleRate, [bcp47(source)])
      ).trim();
      if (!heard) {
        setError('ვერ გავიგე, სცადე თავიდან');
        setStatus('idle');
        setActiveSource(null);
        return;
      }
      const translated = (await translateText(heard, source, target)).trim();
      setTurns((prev) => [
        ...prev,
        { id: newId(), source, target, heard, translated },
      ]);
      setStatus('idle');
      setActiveSource(null);
      void speak(translated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'თარგმნა ვერ მოხერხდა');
      setStatus('idle');
      setActiveSource(null);
    }
  }, [recorder, activeSource, other]);

  // Tap a language: start if idle, stop+translate if it's the one recording.
  const toggleListen = useCallback(
    (source: Lang) => {
      if (status === 'listening' && activeSource === source) {
        void stopAndTranslate();
      } else if (status === 'idle') {
        void startListening(source);
      }
    },
    [status, activeSource, startListening, stopAndTranslate],
  );

  const replay = useCallback((turn: Turn) => {
    void speak(turn.translated);
  }, []);

  const clear = useCallback(() => {
    void stopAudio();
    setTurns([]);
    setError(null);
  }, []);

  return {
    other,
    setOther,
    turns,
    status,
    activeSource,
    error,
    toggleListen,
    stopAndTranslate,
    replay,
    clear,
  };
}
