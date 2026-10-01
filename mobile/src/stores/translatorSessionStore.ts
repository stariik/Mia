import { create } from 'zustand';

import type { Lang } from '@/lib/translateLanguages';

// Live state of translator mode (not persisted — a session ends with the app).
// Written only by lib/translator/session.ts; the screen just reads it.

/**
 * - off: normal chat
 * - paused: translator view open, mic closed (tap the orb or say "Hey Mia")
 * - connecting / listening: the mic is open in the "from" language
 * - working: a sentence is being transcribed or translated
 * - speaking: a translation is being read aloud
 */
export type TranslatorPhase =
  | 'off'
  | 'paused'
  | 'connecting'
  | 'listening'
  | 'working'
  | 'speaking';

export type TranslationTurn = {
  id: string;
  source: Lang;
  target: Lang;
  heard: string;
  translated: string;
  /** Heard, translation still on its way. */
  pending: boolean;
  failed?: boolean;
};

type TranslatorSessionState = {
  active: boolean;
  phase: TranslatorPhase;
  turns: TranslationTurn[];
  /** The sentence being spoken right now (live mode). */
  liveText: string;
  error: string | null;
};

export const useTranslatorSession = create<TranslatorSessionState>(() => ({
  active: false,
  phase: 'off',
  turns: [],
  liveText: '',
  error: null,
}));
