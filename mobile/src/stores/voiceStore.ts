import { create } from 'zustand';
import type { ListeningState } from '@/stt/controller';

type SttState = { streaming: boolean; sttState: ListeningState; listeningSeconds: number; keepListening: boolean };

type VoiceState = SttState & {
  setStt: (state: Partial<SttState>) => void;
  isListening: boolean;
  isThinking: boolean;
  isSpeaking: boolean;
  /** Speech captured, awaiting the reply (transcribing) — still "thinking"
   *  for the orb, so it never drops to idle between listening and thinking. */
  isProcessing: boolean;
  /** The mic is being opened (config check, permission, recorder start) —
   *  the orb wakes into listening right away instead of sitting idle. */
  isArming: boolean;
  currentTranscript: string;
  error: string | null;

  setListening: (v: boolean) => void;
  setThinking: (v: boolean) => void;
  setSpeaking: (v: boolean) => void;
  setProcessing: (v: boolean) => void;
  setArming: (v: boolean) => void;
  setTranscript: (v: string) => void;
  setError: (v: string | null) => void;
};

// Not persisted: every field here is transient pipeline state. The TTS provider
// picker used to live here (elevenlabs | camb | openai) and was the only reason
// this store touched AsyncStorage. ElevenLabs Flash is now the only provider —
// Camb polls for seconds and OpenAI mispronounces Georgian — so there is no
// choice left to remember.
export const useVoiceStore = create<VoiceState>((set) => ({
  streaming: false, sttState: 'idle', listeningSeconds: 0, keepListening: false,
  setStt: (state) => set(state),
  isListening: false,
  isThinking: false,
  isSpeaking: false,
  isProcessing: false,
  isArming: false,
  currentTranscript: '',
  error: null,

  setListening: (v) => set({ isListening: v }),
  setThinking: (v) => set({ isThinking: v }),
  setSpeaking: (v) => set({ isSpeaking: v }),
  setProcessing: (v) => set({ isProcessing: v }),
  setArming: (v) => set({ isArming: v }),
  setTranscript: (v) => set({ currentTranscript: v }),
  setError: (v) => set({ error: v }),
}));
