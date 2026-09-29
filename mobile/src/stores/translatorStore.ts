import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { storage as AsyncStorage } from '@/lib/storage';
import {
  DEFAULT_DIRECTION,
  sanitizeDirection,
  swapDirection,
  withForeign,
  type Direction,
  type ForeignLang,
} from '@/lib/translateLanguages';

// Translator preferences that survive app launches: the last chosen direction
// and whether translations are read aloud automatically.
export type TranslatorState = {
  direction: Direction;
  autoSpeak: boolean;

  swap: () => void;
  setForeign: (lang: ForeignLang) => void;
  setAutoSpeak: (on: boolean) => void;
};

export const useTranslatorStore = create<TranslatorState>()(
  persist(
    (set) => ({
      direction: DEFAULT_DIRECTION,
      autoSpeak: true,
      swap: () => set((s) => ({ direction: swapDirection(s.direction) })),
      setForeign: (lang) =>
        set((s) => ({ direction: withForeign(s.direction, lang) })),
      setAutoSpeak: (autoSpeak) => set(() => ({ autoSpeak })),
    }),
    {
      name: 'translator-prefs-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ direction: s.direction, autoSpeak: s.autoSpeak }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<TranslatorState>;
        return {
          ...current,
          direction: sanitizeDirection(p.direction),
          autoSpeak:
            typeof p.autoSpeak === 'boolean' ? p.autoSpeak : current.autoSpeak,
        };
      },
    },
  ),
);
