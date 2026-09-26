import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { storage as AsyncStorage } from '@/lib/storage';

// Mia's long-term memory about the user (name, city, likes…). On-device only;
// sent with every chat turn and saved/forgotten via the remember_fact /
// forget_fact tools or the Memory screen.
export type ProfileFact = { id: string; text: string; createdAt: number };

const MAX_FACTS = 50; // the server caps the same — oldest drop first
const MAX_FACT_CHARS = 200;

type ProfileState = {
  facts: ProfileFact[];
  addFact: (text: string, replacesId?: string) => void;
  removeFact: (id: string) => void;
  clear: () => void;
};

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      facts: [],

      addFact: (text, replacesId) =>
        set((s) => {
          const t = text.trim().slice(0, MAX_FACT_CHARS);
          if (!t) return s;
          const fact = {
            id: `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            text: t,
            createdAt: Date.now(),
          };
          const kept = s.facts.filter(
            (f) => f.id !== replacesId && f.text !== t,
          );
          return { facts: [...kept, fact].slice(-MAX_FACTS) };
        }),
      removeFact: (id) =>
        set((s) => ({ facts: s.facts.filter((f) => f.id !== id) })),
      clear: () => set({ facts: [] }),
    }),
    {
      name: 'profile-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ facts: s.facts }),
    },
  ),
);
