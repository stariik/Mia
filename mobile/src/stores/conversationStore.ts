import { create } from 'zustand';

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

const titleFromMessages = (msgs: Message[]) => {
  const first = msgs.find((m) => m.role === 'user');
  if (!first) return 'New chat';
  const t = first.content.trim();
  if (!t) return 'New chat';
  return t.length > 40 ? t.slice(0, 40) + '…' : t;
};

export const useConversationStore = create<ConversationState>((set) => ({
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

      return {
        activeId,
        conversations: { ...conversations, [activeId]: updated },
        order: newOrder,
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
}));
