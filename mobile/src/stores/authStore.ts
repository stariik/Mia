import { create } from 'zustand';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

type AuthState = {
  isAuthenticated: boolean;
  user: AuthUser | null;
  /** True while a sign-in/sign-up call is in flight. */
  pending: boolean;
  error: string | null;

  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => void;
  clearError: () => void;
};

const fakeNetwork = (ms = 600) =>
  new Promise<void>((r) => setTimeout(() => r(), ms));

const newId = () =>
  `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// Stub auth — accepts any non-empty email/password. Replace with real backend
// when the API is ready. State is in-memory only (lost on app restart).
export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  user: null,
  pending: false,
  error: null,

  signIn: async (email, password) => {
    set({ pending: true, error: null });
    try {
      const e = email.trim();
      if (!e || !e.includes('@')) throw new Error('Invalid email.');
      if (!password || password.length < 4) throw new Error('Password too short.');
      await fakeNetwork();
      set({
        isAuthenticated: true,
        user: { id: newId(), email: e, name: e.split('@')[0] },
        pending: false,
      });
    } catch (err) {
      set({ pending: false, error: err instanceof Error ? err.message : 'Sign in failed.' });
    }
  },

  signUp: async (name, email, password) => {
    set({ pending: true, error: null });
    try {
      const n = name.trim();
      const e = email.trim();
      if (!n) throw new Error('Name is required.');
      if (!e || !e.includes('@')) throw new Error('Invalid email.');
      if (!password || password.length < 4) throw new Error('Password too short.');
      await fakeNetwork();
      set({
        isAuthenticated: true,
        user: { id: newId(), email: e, name: n },
        pending: false,
      });
    } catch (err) {
      set({ pending: false, error: err instanceof Error ? err.message : 'Sign up failed.' });
    }
  },

  signOut: () => set({ isAuthenticated: false, user: null, error: null }),
  clearError: () => set({ error: null }),
}));
