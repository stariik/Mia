import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type TTSProvider = 'elevenlabs' | 'camb' | 'openai';

type VoiceState = {
  isListening: boolean;
  isThinking: boolean;
  isSpeaking: boolean;
  currentTranscript: string;
  error: string | null;
  ttsProvider: TTSProvider;
  openaiVoice: string;

  setListening: (v: boolean) => void;
  setThinking: (v: boolean) => void;
  setSpeaking: (v: boolean) => void;
  setTranscript: (v: string) => void;
  setError: (v: string | null) => void;
  setTtsProvider: (v: TTSProvider) => void;
  setOpenaiVoice: (v: string) => void;
};

export const useVoiceStore = create<VoiceState>()(
  persist(
    (set) => ({
      isListening: false,
      isThinking: false,
      isSpeaking: false,
      currentTranscript: '',
      error: null,
      ttsProvider: 'elevenlabs',
      openaiVoice: 'nova',

      setListening: (v) => set({ isListening: v }),
      setThinking: (v) => set({ isThinking: v }),
      setSpeaking: (v) => set({ isSpeaking: v }),
      setTranscript: (v) => set({ currentTranscript: v }),
      setError: (v) => set({ error: v }),
      setTtsProvider: (v) => set({ ttsProvider: v }),
      setOpenaiVoice: (v) => set({ openaiVoice: v }),
    }),
    {
      name: 'voice-settings-v1',
      storage: createJSONStorage(() => AsyncStorage),
      // Only the user's choices survive restarts — never transient pipeline
      // state like isListening/isSpeaking.
      partialize: (s) => ({
        ttsProvider: s.ttsProvider,
        openaiVoice: s.openaiVoice,
      }),
    },
  ),
);
