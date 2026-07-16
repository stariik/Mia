import { create } from 'zustand';

type VoiceState = {
  isListening: boolean;
  isThinking: boolean;
  isSpeaking: boolean;
  currentTranscript: string;
  error: string | null;

  setListening: (v: boolean) => void;
  setThinking: (v: boolean) => void;
  setSpeaking: (v: boolean) => void;
  setTranscript: (v: string) => void;
  setError: (v: string | null) => void;
};

// Not persisted: every field here is transient pipeline state. The TTS provider
// picker used to live here (elevenlabs | camb | openai) and was the only reason
// this store touched AsyncStorage. ElevenLabs Flash is now the only provider —
// Camb polls for seconds and OpenAI mispronounces Georgian — so there is no
// choice left to remember.
export const useVoiceStore = create<VoiceState>((set) => ({
  isListening: false,
  isThinking: false,
  isSpeaking: false,
  currentTranscript: '',
  error: null,

  setListening: (v) => set({ isListening: v }),
  setThinking: (v) => set({ isThinking: v }),
  setSpeaking: (v) => set({ isSpeaking: v }),
  setTranscript: (v) => set({ currentTranscript: v }),
  setError: (v) => set({ error: v }),
}));
