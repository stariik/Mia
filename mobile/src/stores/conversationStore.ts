import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type Message = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
};

export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
};

type ConversationState = {
  conversations: Record<string, Conversation>;
  order: string[]; // most recent first
  activeId: string | null;
  /** Mirror of active conversation's messages — kept for backwards-compatible selectors. */
  messages: Message[];

  addMessage: (msg: Message) => void;
  updateLastAssistant: (content: string) => void;
  clear: () => void;

  newConversation: () => string;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
};

const newId = () =>
  `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// Storage cap: keep the most recent conversations, drop the rest on write so
// AsyncStorage doesn't grow without bound.
const MAX_CONVERSATIONS = 30;

const capConversations = (
  conversations: Record<string, Conversation>,
  order: string[],
): { conversations: Record<string, Conversation>; order: string[] } => {
  if (order.length <= MAX_CONVERSATIONS) return { conversations, order };
  const kept = order.slice(0, MAX_CONVERSATIONS);
  const next: Record<string, Conversation> = {};
  for (const id of kept) {
    if (conversations[id]) next[id] = conversations[id];
  }
  return { conversations: next, order: kept };
};

const titleFromMessages = (msgs: Message[]) => {
  const first = msgs.find((m) => m.role === 'user');
  if (!first) return 'New chat';
  const t = first.content.trim();
  if (!t) return 'New chat';
  return t.length > 40 ? t.slice(0, 40) + '…' : t;
};

export const useConversationStore = create<ConversationState>()(
  persist(
    (set) => ({
  conversations: {},
  order: [],
  activeId: null,
  messages: [],

  addMessage: (msg) =>
    set((s) => {
      let activeId = s.activeId;
      let conversations = s.conversations;
      let order = s.order;

      if (!activeId || !conversations[activeId]) {
        activeId = newId();
        conversations = {
          ...conversations,
          [activeId]: {
            id: activeId,
            title: 'New chat',
            messages: [],
            updatedAt: Date.now(),
          },
        };
        order = [activeId, ...order.filter((id) => id !== activeId)];
      }

      const conv = conversations[activeId];
      const messages = [...conv.messages, msg];
      const updated: Conversation = {
        ...conv,
        messages,
        updatedAt: Date.now(),
        title:
          conv.title === 'New chat' && msg.role === 'user'
            ? titleFromMessages(messages)
            : conv.title,
      };

      const newOrder = [activeId, ...order.filter((id) => id !== activeId)];
      const capped = capConversations(
        { ...conversations, [activeId]: updated },
        newOrder,
      );

      return {
        activeId,
        ...capped,
        messages,
      };
    }),

  updateLastAssistant: (content) =>
    set((s) => {
      if (!s.activeId) return s;
      const conv = s.conversations[s.activeId];
      if (!conv) return s;
      const messages = [...conv.messages];
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
          messages[i] = { ...messages[i], content };
          break;
        }
      }
      return {
        conversations: {
          ...s.conversations,
          [s.activeId]: { ...conv, messages, updatedAt: Date.now() },
        },
        messages,
      };
    }),

  clear: () =>
    set((s) => {
      if (!s.activeId) return { messages: [] };
      const conv = s.conversations[s.activeId];
      if (!conv) return { messages: [] };
      return {
        conversations: {
          ...s.conversations,
          [s.activeId]: { ...conv, messages: [], updatedAt: Date.now() },
        },
        messages: [],
      };
    }),

  newConversation: () => {
    const id = newId();
    set((s) => ({
      conversations: {
        ...s.conversations,
        [id]: { id, title: 'New chat', messages: [], updatedAt: Date.now() },
      },
      order: [id, ...s.order.filter((x) => x !== id)],
      activeId: id,
      messages: [],
    }));
    return id;
  },

  selectConversation: (id) =>
    set((s) => {
      const conv = s.conversations[id];
      if (!conv) return s;
      return { activeId: id, messages: conv.messages };
    }),

  deleteConversation: (id) =>
    set((s) => {
      if (!s.conversations[id]) return s;
      const { [id]: _removed, ...rest } = s.conversations;
      const order = s.order.filter((x) => x !== id);
      let activeId = s.activeId;
      let messages = s.messages;
      if (s.activeId === id) {
        activeId = order[0] ?? null;
        messages = activeId ? rest[activeId].messages : [];
      }
      return { conversations: rest, order, activeId, messages };
    }),
    }),
    {
      name: 'conversations-v1',
      storage: createJSONStorage(() => AsyncStorage),
      // `messages` is a derived mirror of the active conversation — rebuild it
      // after hydration instead of persisting it.
      partialize: (s) => ({
        conversations: s.conversations,
        order: s.order,
        activeId: s.activeId,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<ConversationState> | undefined;
        const activeId = p?.activeId ?? null;
        const conversations = p?.conversations ?? {};
        return {
          ...current,
          conversations,
          order: p?.order ?? [],
          activeId,
          messages: activeId ? conversations[activeId]?.messages ?? [] : [],
        };
      },
    },
  ),
);
