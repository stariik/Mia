import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';

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

const EMPTY_MESSAGES: Message[] = [];

/** The active conversation's messages. Returns the conversation's own array
 *  (stable reference), so it's safe as a zustand selector. */
export const selectActiveMessages = (s: {
  activeId: string | null;
  conversations: Record<string, Conversation>;
}): Message[] =>
  (s.activeId && s.conversations[s.activeId]?.messages) || EMPTY_MESSAGES;

type Persisted = Pick<ConversationState, 'conversations' | 'order' | 'activeId'>;

// persist() writes on EVERY set(), and updateLastAssistant fires once per
// streamed token — serializing all 30 conversations dozens of times per reply.
// Debounce the write and stringify only on flush. Cost: a hard kill inside the
// window loses the last ~300 ms of streamed text from history (never from the
// screen); the next write closes the gap.
const WRITE_DEBOUNCE_MS = 300;
let pendingWrite: StorageValue<Persisted> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

const debouncedStorage: PersistStorage<Persisted> = {
  getItem: async (name) => {
    const raw = await AsyncStorage.getItem(name);
    return raw ? (JSON.parse(raw) as StorageValue<Persisted>) : null;
  },
  setItem: (name, value) => {
    pendingWrite = value;
    if (writeTimer) return; // trailing write picks up the latest pendingWrite
    writeTimer = setTimeout(() => {
      writeTimer = null;
      const v = pendingWrite;
      pendingWrite = null;
      if (v) AsyncStorage.setItem(name, JSON.stringify(v)).catch(() => {});
    }, WRITE_DEBOUNCE_MS);
  },
  removeItem: (name) => AsyncStorage.removeItem(name),
};

export const useConversationStore = create<ConversationState>()(
  persist(
    (set) => ({
      conversations: {},
      order: [],
      activeId: null,

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

          return { activeId, ...capped };
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
          };
        }),

      clear: () =>
        set((s) => {
          if (!s.activeId) return s;
          const conv = s.conversations[s.activeId];
          if (!conv) return s;
          return {
            conversations: {
              ...s.conversations,
              [s.activeId]: { ...conv, messages: [], updatedAt: Date.now() },
            },
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
        }));
        return id;
      },

      selectConversation: (id) =>
        set((s) => (s.conversations[id] ? { activeId: id } : s)),

      deleteConversation: (id) =>
        set((s) => {
          if (!s.conversations[id]) return s;
          const { [id]: _removed, ...rest } = s.conversations;
          const order = s.order.filter((x) => x !== id);
          const activeId = s.activeId === id ? order[0] ?? null : s.activeId;
          return { conversations: rest, order, activeId };
        }),
    }),
    {
      name: 'conversations-v1',
      storage: debouncedStorage,
      partialize: (s) => ({
        conversations: s.conversations,
        order: s.order,
        activeId: s.activeId,
      }),
    },
  ),
);
