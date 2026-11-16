import { create } from 'zustand';

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'pending' | 'error' | 'conflict' | 'idle';

type SyncState = {
  status: SyncStatus;
  pending: number;
  conflicts: number;
  lastSyncAt: string | null;
  lastError: string | null;
  realtime: 'polling' | 'ably' | 'connected';
  setStatus: (status: SyncStatus) => void;
  setPending: (pending: number) => void;
  setConflicts: (conflicts: number) => void;
  setLastSyncAt: (lastSyncAt: string) => void;
  setLastError: (lastError: string | null) => void;
  setRealtime: (realtime: SyncState['realtime']) => void;
};

export const useSyncStore = create<SyncState>((set) => ({
  status: 'idle',
  pending: 0,
  conflicts: 0,
  lastSyncAt: null,
  lastError: null,
  realtime: 'polling',
  setStatus: (status) => set({ status }),
  setPending: (pending) => set({ pending }),
  setConflicts: (conflicts) => set({ conflicts }),
  setLastSyncAt: (lastSyncAt) => set({ lastSyncAt, lastError: null }),
  setLastError: (lastError) => set({ lastError }),
  setRealtime: (realtime) => set({ realtime }),
}));
