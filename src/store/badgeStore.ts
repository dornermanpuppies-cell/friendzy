import { create } from 'zustand';

import { getUnreadTotal, subscribeToInbox } from '@/services/messaging';
import { getUnreadCount, subscribeToNotifications } from '@/services/notifications';
import { countPendingRequests } from '@/services/relationships';
import { useChatStore } from '@/store/chatStore';

interface BadgeState {
  notifications: number;
  requests: number;
  inbox: number;
  refresh: (userId: string) => Promise<void>;
  refreshInbox: () => Promise<void>;
  start: (userId: string) => () => void;
  decrementNotifications: (by?: number) => void;
  clearNotifications: () => void;
}

export const useBadgeStore = create<BadgeState>((set, get) => ({
  notifications: 0,
  requests: 0,
  inbox: 0,

  refresh: async (userId) => {
    try {
      const [notifications, requests, inbox] = await Promise.all([getUnreadCount(userId), countPendingRequests(userId), getUnreadTotal().catch(() => 0)]);
      set({ notifications, requests, inbox });
    } catch (error) {
      console.warn('[badges] refresh failed', error);
    }
  },

  refreshInbox: async () => {
    try {
      set({ inbox: await getUnreadTotal() });
    } catch {
      /* ignore */
    }
  },

  start: (userId) => {
    void get().refresh(userId);
    const unsubscribeNotifications = subscribeToNotifications(userId, (row) => {
      set((s) => ({ notifications: s.notifications + 1 }));
      if (row.type === 'friend_request' || row.type === 'follow_request') set((s) => ({ requests: s.requests + 1 }));
    });
    // Any new message in one of my conversations: refresh the unread total and keep the inbox list fresh.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribeInbox = subscribeToInbox((row) => {
      if (row.sender_id === userId) return;
      const chat = useChatStore.getState();
      if (chat.conversations[row.conversation_id]) void chat.applyRemoteMessage(row.conversation_id, row.id);
      else void chat.loadConversations('inbox');
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void get().refreshInbox(), 800);
    });
    return () => {
      unsubscribeNotifications();
      unsubscribeInbox();
      if (timer) clearTimeout(timer);
    };
  },

  decrementNotifications: (by = 1) => set((s) => ({ notifications: Math.max(0, s.notifications - by) })),
  clearNotifications: () => set({ notifications: 0 }),
}));
