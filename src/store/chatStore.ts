import { create } from 'zustand';

import { previewText } from '@/lib/e2ee/messages';
import { fetchConversations, fetchMessage, fetchMessages, newClientId, sendEncryptedMessage, uploadEncryptedAttachment, type EncryptedUpload, type LocalAttachment } from '@/services/messaging';
import { useAuthStore } from '@/store/authStore';
import type { ConversationSummary, InboxFilter, Message, MessageKind, MessageMetadata, TypingUser } from '@/types/messaging';
import { getErrorMessage } from '@/utils/errors';

const PAGE = 40;

interface ListState {
  ids: string[];
  loaded: boolean;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
}

interface ThreadState {
  loaded: boolean;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
}

interface PendingSend {
  conversationId: string;
  kind: MessageKind;
  text: string | null;
  metadata: MessageMetadata;
  attachments: LocalAttachment[];
  replyToId: string | null;
  forwarded: boolean;
}

export interface SendInput {
  conversationId: string;
  kind?: MessageKind;
  text?: string | null;
  metadata?: MessageMetadata;
  attachments?: LocalAttachment[];
  replyToId?: string | null;
  forwarded?: boolean;
}

interface ChatState {
  conversations: Record<string, ConversationSummary>;
  lists: Partial<Record<InboxFilter, ListState>>;
  messages: Record<string, Message[]>;
  threads: Record<string, ThreadState>;
  typing: Record<string, TypingUser[]>;
  pending: Record<string, PendingSend>;

  loadConversations: (filter: InboxFilter, more?: boolean) => Promise<void>;
  upsertConversation: (conversation: ConversationSummary) => void;
  patchConversation: (id: string, patch: Partial<ConversationSummary>) => void;
  removeConversation: (id: string) => void;

  loadMessages: (conversationId: string, more?: boolean) => Promise<void>;
  upsertMessage: (message: Message) => void;
  patchMessage: (conversationId: string, messageId: string, patch: Partial<Message> | ((m: Message) => Message)) => void;
  removeMessage: (conversationId: string, messageId: string) => void;
  applyRemoteMessage: (conversationId: string, messageId: string) => Promise<void>;
  applyMemberUpdate: (conversationId: string, userId: string, lastReadAt: string, lastDeliveredAt: string) => void;
  setTyping: (conversationId: string, user: { user_id: string; name: string }, typing: boolean) => void;

  /** Sends an end-to-end encrypted message (optimistic bubble first, sealed upload + send in the background). */
  send: (input: SendInput) => Promise<void>;
  retry: (conversationId: string, clientId: string) => Promise<void>;
  discardFailed: (conversationId: string, clientId: string) => void;
}

function sortByTime(list: Message[]): Message[] {
  return [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function mergeMessage(list: Message[], incoming: Message): Message[] {
  const index = list.findIndex((m) => m.id === incoming.id || (incoming.client_id && m.client_id === incoming.client_id));
  if (index === -1) return sortByTime([...list, incoming]);
  const next = [...list];
  next[index] = { ...next[index], ...incoming, upload_progress: undefined, error: undefined };
  return sortByTime(next);
}

function myCard() {
  const profile = useAuthStore.getState().profile;
  return profile
    ? { id: profile.id, username: profile.username, display_name: profile.display_name, avatar_url: profile.avatar_url, is_verified: profile.is_verified, is_private: profile.is_private, country_code: profile.country_code }
    : null;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: {},
  lists: {},
  messages: {},
  threads: {},
  typing: {},
  pending: {},

  loadConversations: async (filter, more = false) => {
    const current = get().lists[filter] ?? { ids: [], loaded: false, hasMore: true, loading: false, error: null };
    if (current.loading) return;
    set((s) => ({ lists: { ...s.lists, [filter]: { ...current, loading: true, error: null } } }));
    try {
      const last = more ? get().conversations[current.ids[current.ids.length - 1]] : undefined;
      const before = last ? (last.last_message_at ?? last.created_at) : null;
      const page = await fetchConversations(filter, before, 30);
      set((s) => {
        const conversations = { ...s.conversations };
        for (const c of page) conversations[c.id] = c;
        const ids = more ? [...current.ids, ...page.map((c) => c.id).filter((id) => !current.ids.includes(id))] : page.map((c) => c.id);
        return { conversations, lists: { ...s.lists, [filter]: { ids, loaded: true, hasMore: page.length === 30, loading: false, error: null } } };
      });
    } catch (error) {
      set((s) => ({ lists: { ...s.lists, [filter]: { ...current, loaded: true, loading: false, error: getErrorMessage(error) } } }));
    }
  },

  upsertConversation: (conversation) =>
    set((s) => {
      const lists = { ...s.lists };
      const target: InboxFilter = conversation.is_request ? 'requests' : conversation.is_archived ? 'archived' : 'inbox';
      const list = lists[target];
      if (list && !list.ids.includes(conversation.id)) lists[target] = { ...list, ids: [conversation.id, ...list.ids] };
      return { conversations: { ...s.conversations, [conversation.id]: conversation }, lists };
    }),

  patchConversation: (id, patch) =>
    set((s) => (s.conversations[id] ? { conversations: { ...s.conversations, [id]: { ...s.conversations[id], ...patch } } } : s)),

  removeConversation: (id) =>
    set((s) => {
      const conversations = { ...s.conversations };
      delete conversations[id];
      const lists = Object.fromEntries(Object.entries(s.lists).map(([k, v]) => [k, v ? { ...v, ids: v.ids.filter((x) => x !== id) } : v]));
      return { conversations, lists };
    }),

  loadMessages: async (conversationId, more = false) => {
    const thread = get().threads[conversationId] ?? { loaded: false, hasMore: true, loading: false, error: null };
    if (thread.loading || (more && !thread.hasMore)) return;
    set((s) => ({ threads: { ...s.threads, [conversationId]: { ...thread, loading: true, error: null } } }));
    try {
      const existing = get().messages[conversationId] ?? [];
      const before = more && existing.length ? existing[0].created_at : null;
      const page = await fetchMessages(conversationId, before, PAGE);
      set((s) => {
        const current = s.messages[conversationId] ?? [];
        let merged = more ? current : current.filter((m) => m.status === 'sending' || m.status === 'failed');
        for (const m of page) merged = mergeMessage(merged, m);
        return {
          messages: { ...s.messages, [conversationId]: merged },
          threads: { ...s.threads, [conversationId]: { loaded: true, hasMore: page.length === PAGE, loading: false, error: null } },
        };
      });
    } catch (error) {
      set((s) => ({ threads: { ...s.threads, [conversationId]: { ...thread, loaded: true, loading: false, error: getErrorMessage(error) } } }));
    }
  },

  upsertMessage: (message) =>
    set((s) => ({ messages: { ...s.messages, [message.conversation_id]: mergeMessage(s.messages[message.conversation_id] ?? [], message) } })),

  patchMessage: (conversationId, messageId, patch) =>
    set((s) => {
      const list = s.messages[conversationId];
      if (!list) return s;
      return {
        messages: {
          ...s.messages,
          [conversationId]: list.map((m) => (m.id === messageId || m.client_id === messageId ? (typeof patch === 'function' ? patch(m) : { ...m, ...patch }) : m)),
        },
      };
    }),

  removeMessage: (conversationId, messageId) =>
    set((s) => ({ messages: { ...s.messages, [conversationId]: (s.messages[conversationId] ?? []).filter((m) => m.id !== messageId && m.client_id !== messageId) } })),

  applyRemoteMessage: async (conversationId, messageId) => {
    try {
      const message = await fetchMessage(messageId);
      if (!message) return;
      get().upsertMessage(message);
      const conv = get().conversations[conversationId];
      if (conv) {
        const myId = useAuthStore.getState().user?.id;
        get().patchConversation(conversationId, {
          last_message: {
            id: message.id,
            kind: message.kind,
            preview: previewFor(message),
            sender_id: message.sender?.id ?? null,
            sender_name: message.sender?.display_name ?? null,
            created_at: message.created_at,
            is_mine: message.is_mine,
            status: message.status,
            encrypted: message.encrypted,
            envelope: message.envelope ?? null,
          },
          last_message_at: message.created_at,
          unread_count: message.sender?.id && message.sender.id !== myId ? conv.unread_count + 1 : conv.unread_count,
          is_archived: false,
        });
      }
    } catch (error) {
      console.warn('[chat] applyRemoteMessage failed', error);
    }
  },

  applyMemberUpdate: (conversationId, userId, lastReadAt, lastDeliveredAt) => {
    const myId = useAuthStore.getState().user?.id;
    if (userId === myId) return;
    const conv = get().conversations[conversationId];
    // Precise for DMs; groups refresh their statuses on next load.
    if (conv && conv.kind !== 'direct') return;
    set((s) => {
      const list = s.messages[conversationId];
      if (!list) return s;
      return {
        messages: {
          ...s.messages,
          [conversationId]: list.map((m) => {
            if (!m.is_mine || m.status === 'sending' || m.status === 'failed') return m;
            if (m.created_at <= lastReadAt) return m.status === 'read' ? m : { ...m, status: 'read' };
            if (m.created_at <= lastDeliveredAt) return m.status === 'delivered' || m.status === 'read' ? m : { ...m, status: 'delivered' };
            return m;
          }),
        },
      };
    });
  },

  setTyping: (conversationId, user, typing) =>
    set((s) => {
      const current = (s.typing[conversationId] ?? []).filter((t) => t.user_id !== user.user_id && t.until > Date.now());
      const next = typing ? [...current, { user_id: user.user_id, name: user.name, until: Date.now() + 6000 }] : current;
      return { typing: { ...s.typing, [conversationId]: next } };
    }),

  send: async ({ conversationId, kind = 'text', text = null, metadata = {}, attachments = [], replyToId = null, forwarded = false }) => {
    const clientId = newClientId();
    const me = myCard();
    const now = new Date().toISOString();
    const replyTo = replyToId ? (get().messages[conversationId] ?? []).find((m) => m.id === replyToId) : undefined;
    const optimistic: Message = {
      id: clientId,
      conversation_id: conversationId,
      sender: me,
      kind,
      text,
      metadata,
      attachments: attachments.map((a, i) => ({
        id: `${clientId}-${i}`,
        kind: a.kind,
        path: a.uri,
        name: a.name ?? null,
        mime: a.mime ?? null,
        size_bytes: a.size ?? null,
        width: a.width ?? null,
        height: a.height ?? null,
        duration_ms: a.durationMs ?? null,
        thumbnail_path: null,
        waveform: a.waveform ?? null,
      })),
      reply_to: replyTo ? { id: replyTo.id, sender: replyTo.sender, kind: replyTo.kind, preview: previewFor(replyTo), deleted: replyTo.deleted } : null,
      reactions: [],
      my_reaction: null,
      starred: false,
      pinned: false,
      forwarded,
      edited_at: null,
      deleted: false,
      expires_at: null,
      created_at: now,
      client_id: clientId,
      is_mine: true,
      status: 'sending',
      encrypted: true,
      verified: true,
      upload_progress: attachments.length ? 0 : undefined,
    };
    set((s) => ({
      messages: { ...s.messages, [conversationId]: mergeMessage(s.messages[conversationId] ?? [], optimistic) },
      pending: { ...s.pending, [clientId]: { conversationId, kind, text, metadata, attachments, replyToId, forwarded } },
    }));
    get().patchConversation(conversationId, { last_message: { id: clientId, kind, preview: previewFor(optimistic), sender_id: me?.id ?? null, sender_name: me?.display_name ?? null, created_at: now, is_mine: true, status: 'sending' }, last_message_at: now });
    await get().retry(conversationId, clientId);
  },

  retry: async (conversationId, clientId) => {
    const job = get().pending[clientId];
    if (!job) return;
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;
    get().patchMessage(conversationId, clientId, { status: 'sending', error: undefined });
    try {
      const uploaded: EncryptedUpload[] = [];
      for (let i = 0; i < job.attachments.length; i += 1) {
        const item = job.attachments[i];
        uploaded.push(
          await uploadEncryptedAttachment(conversationId, userId, item, (p) =>
            get().patchMessage(conversationId, clientId, { upload_progress: (i + p.fraction) / job.attachments.length }),
          ),
        );
      }
      const message = await sendEncryptedMessage({ conversationId, userId, kind: job.kind, text: job.text, metadata: job.metadata, attachments: uploaded, replyToId: job.replyToId, clientId, forwarded: job.forwarded });
      set((s) => {
        const pending = { ...s.pending };
        delete pending[clientId];
        return { pending };
      });
      get().upsertMessage(message);
      get().patchConversation(conversationId, {
        last_message: { id: message.id, kind: message.kind, preview: previewFor(message), sender_id: userId, sender_name: message.sender?.display_name ?? null, created_at: message.created_at, is_mine: true, status: message.status, encrypted: message.encrypted, envelope: message.envelope ?? null },
        last_message_at: message.created_at,
        is_archived: false,
        marked_unread: false,
      });
    } catch (error) {
      get().patchMessage(conversationId, clientId, { status: 'failed', error: getErrorMessage(error), upload_progress: undefined });
    }
  },

  discardFailed: (conversationId, clientId) => {
    set((s) => {
      const pending = { ...s.pending };
      delete pending[clientId];
      return { pending };
    });
    get().removeMessage(conversationId, clientId);
  },
}));

/** One-line preview for a (decrypted) message; sealed messages this device cannot open stay opaque. */
export function previewFor(m: Pick<Message, 'kind' | 'text' | 'deleted'> & { decrypt_error?: Message['decrypt_error'] }): string {
  if (!m.deleted && m.decrypt_error) return '🔒 Encrypted message';
  return previewText(m);
}

export function useConversation(id: string | undefined) {
  return useChatStore((s) => (id ? s.conversations[id] : undefined));
}

export function useThreadMessages(id: string | undefined): Message[] {
  return useChatStore((s) => (id ? (s.messages[id] ?? EMPTY) : EMPTY));
}

const EMPTY: Message[] = [];
