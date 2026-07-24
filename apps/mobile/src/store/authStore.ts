import { create } from 'zustand';
import { setTokens, clearTokens } from '@/api/client';
import type { UserProfile } from '@/api/endpoints';

interface AuthState {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isHydrating: boolean;
  setUser: (user: UserProfile, access: string, refresh: string) => Promise<void>;
  logout: () => Promise<void>;
  setHydrating: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isHydrating: true,
  setUser: async (user, access, refresh) => {
    await setTokens(access, refresh);
    set({ user, isAuthenticated: true, isHydrating: false });
  },
  logout: async () => {
    await clearTokens();
    set({ user: null, isAuthenticated: false });
  },
  setHydrating: (v) => set({ isHydrating: v }),
}));
