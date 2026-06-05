import { create } from "zustand";

export type Message = {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

type ConversationState = {
  messages: Message[];
  addMessage: (msg: Message) => void;
  updateLastAssistant: (content: string) => void;
  clear: () => void;
};

export const useConversationStore = create<ConversationState>((set) => ({
  messages: [],
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  updateLastAssistant: (content) =>
    set((s) => {
      const messages = [...s.messages];
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") {
          messages[i] = { ...messages[i], content };
          break;
        }
      }
      return { messages };
    }),
  clear: () => set({ messages: [] }),
}));
