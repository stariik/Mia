import { create } from "zustand";

export type TTSProvider = "camb" | "openai" | "browser";
export type STTProvider = "browser" | "whisper" | "google";

type VoiceState = {
  isListening: boolean;
  isThinking: boolean;
  isSpeaking: boolean;
  currentTranscript: string;
  error: string | null;
  ttsProvider: TTSProvider;
  sttProvider: STTProvider;
  openaiVoice: string;
  speechLang: string;

  setListening: (v: boolean) => void;
  setThinking: (v: boolean) => void;
  setSpeaking: (v: boolean) => void;
  setTranscript: (v: string) => void;
  setError: (v: string | null) => void;
  setTtsProvider: (v: TTSProvider) => void;
  setSttProvider: (v: STTProvider) => void;
  setOpenaiVoice: (v: string) => void;
  setSpeechLang: (v: string) => void;
};

export const useVoiceStore = create<VoiceState>((set) => ({
  isListening: false,
  isThinking: false,
  isSpeaking: false,
  currentTranscript: "",
  error: null,
  ttsProvider: "camb",
  sttProvider: "google",
  openaiVoice: "nova",
  speechLang: "ka-GE",

  setListening: (v) => set({ isListening: v }),
  setThinking: (v) => set({ isThinking: v }),
  setSpeaking: (v) => set({ isSpeaking: v }),
  setTranscript: (v) => set({ currentTranscript: v }),
  setError: (v) => set({ error: v }),
  setTtsProvider: (v) => set({ ttsProvider: v }),
  setSttProvider: (v) => set({ sttProvider: v }),
  setOpenaiVoice: (v) => set({ openaiVoice: v }),
  setSpeechLang: (v) => set({ speechLang: v }),
}));
