import { create } from 'zustand';

import { storage as AsyncStorage } from '@/lib/storage';

export type AuthUser = { id: string; email: string };

type AuthState = {
  token: string | null;
  user: AuthUser | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  login: (token: string, user: AuthUser) => Promise<void>;
  logout: () => Promise<void>;
};

const TOKEN_KEY = '@mia:auth_token';
const USER_KEY = '@mia:auth_user';

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  hydrated: false,

  hydrate: async () => {
    try {
      const result = await AsyncStorage.getMany([TOKEN_KEY, USER_KEY]);
      set({
        token: result[TOKEN_KEY] ?? null,
        user: result[USER_KEY] ? (JSON.parse(result[USER_KEY]!) as AuthUser) : null,
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },

  login: async (token, user) => {
    await AsyncStorage.setMany({ [TOKEN_KEY]: token, [USER_KEY]: JSON.stringify(user) });
    set({ token, user });
  },

  logout: async () => {
    await AsyncStorage.removeMany([TOKEN_KEY, USER_KEY]);
    set({ token: null, user: null });
  },
}));
