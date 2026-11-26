import { create } from 'zustand';

export type E2eeStatus = 'idle' | 'setting_up' | 'ready' | 'error';

export interface KeyNotice {
  kind: 'new_device' | 'key_changed';
  at: number;
}

interface E2eeState {
  status: E2eeStatus;
  deviceId: string | null;
  error: string | null;
  /** Per user id: a trust change we have not shown yet (new device / key changed). */
  notices: Record<string, KeyNotice>;
  setStatus: (status: E2eeStatus, extra?: { deviceId?: string | null; error?: string | null }) => void;
  setNotice: (userId: string, notice: KeyNotice) => void;
  dismissNotice: (userId: string) => void;
  reset: () => void;
}

export const useE2eeStore = create<E2eeState>((set) => ({
  status: 'idle',
  deviceId: null,
  error: null,
  notices: {},
  setStatus: (status, extra) => set((s) => ({ status, deviceId: extra?.deviceId === undefined ? s.deviceId : extra.deviceId, error: extra?.error === undefined ? (status === 'error' ? s.error : null) : extra.error })),
  setNotice: (userId, notice) => set((s) => ({ notices: { ...s.notices, [userId]: notice } })),
  dismissNotice: (userId) =>
    set((s) => {
      const notices = { ...s.notices };
      delete notices[userId];
      return { notices };
    }),
  reset: () => set({ status: 'idle', deviceId: null, error: null, notices: {} }),
}));
