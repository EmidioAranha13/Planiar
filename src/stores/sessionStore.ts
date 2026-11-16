import { create } from 'zustand';
import type { CurrentUser } from '../domain/entities/types';

const DEVICE_USER_KEY = 'planiar.device-user';

type SessionStatus = 'unknown' | 'anonymous' | 'authenticated' | 'offline';

type SessionState = {
  user: CurrentUser | null;
  status: SessionStatus;
  setUser: (user: CurrentUser | null, status?: SessionStatus) => void;
  remember: (user: CurrentUser) => void;
  forget: () => void;
  readRemembered: () => CurrentUser | null;
};

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  status: 'unknown',
  setUser: (user, status) => set({ user, status: status ?? (user ? 'authenticated' : 'anonymous') }),
  remember: (user) => {
    localStorage.setItem(DEVICE_USER_KEY, JSON.stringify(user));
    set({ user, status: navigator.onLine ? 'authenticated' : 'offline' });
  },
  forget: () => {
    localStorage.removeItem(DEVICE_USER_KEY);
    set({ user: null, status: 'anonymous' });
  },
  readRemembered: () => {
    const raw = localStorage.getItem(DEVICE_USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CurrentUser;
    } catch {
      return null;
    }
  },
}));
