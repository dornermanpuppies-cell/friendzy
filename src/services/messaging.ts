import type { RealtimeChannel } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { generateVideoThumbnail } from '@/services/thumbnail';
import { guessMime, objectPath, prepareImage, uploadFile, type UploadProgress } from '@/services/upload';
import type { Json } from '@/types/database';
import type { ConversationDetail, ConversationSummary, InboxFilter, Message, MessageAttachment, MessageKind, MessageMetadata, Sticker } from '@/types/messaging';
import type { StoryCard } from '@/types/social';

const CHAT_BUCKET = 'chat';
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

function rows<T>(data: Json[] | Json | null): T[] {
  return (data ?? []) as unknown as T[];
}

// ----------------------------------------------------------------------------
// Conversations
// ----------------------------------------------------------------------------
export async function fetchConversations(filter: InboxFilter, before: string | null = null, limit = 30): Promise<ConversationSummary[]> {
  const { data, error } = await supabase.rpc('get_conversations', { p_filter: filter, p_limit: limit, p_before: before });
  if (error) throw error;
  return rows<ConversationSummary>(data);
}

export async function fetchConversation(id: string): Promise<ConversationDetail> {
  const { data, error } = await supabase.rpc('get_conversation', { p_id: id });
  if (error) throw error;
  return data as unknown as ConversationDetail;
}

export async function startDirectConversation(userId: string): Promise<string> {
  const { data, error } = await supabase.rpc('start_direct_conversation', { p_user: userId });
  if (error) throw error;
  return data as string;
}

export async function createGroup(title: string, memberIds: string[], description?: string, avatarUrl?: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('create_group', { p_title: title, p_member_ids: memberIds, p_description: description ?? null, p_avatar_url: avatarUrl ?? null });
  if (error) throw error;
  return data as string;
}

export async function updateGroup(id: string, patch: { title?: string; description?: string; avatarUrl?: string | null; joinApproval?: boolean }): Promise<ConversationSummary> {
  const { data, error } = await supabase.rpc('update_group', {
    p_conversation: id,
    p_title: patch.title ?? null,
    p_description: patch.description ?? null,
    p_avatar_url: patch.avatarUrl ?? null,
    p_join_approval: patch.joinApproval ?? null,
  });
  if (error) throw error;
  return data as unknown as ConversationSummary;
}

export async function addMembers(id: string, userIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('add_members', { p_conversation: id, p_user_ids: userIds });
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function removeMember(id: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_member', { p_conversation: id, p_user: userId });
  if (error) throw error;
}

export async function setMemberRole(id: string, userId: string, role: 'owner' | 'admin' | 'member'): Promise<void> {
  const { error } = await supabase.rpc('set_member_role', { p_conversation: id, p_user: userId, p_role: role });
  if (error) throw error;
}

export async function leaveConversation(id: string): Promise<void> {
  const { error } = await supabase.rpc('leave_conversation', { p_conversation: id });
  if (error) throw error;
}

export async function rotateInviteLink(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('rotate_invite_link', { p_conversation: id });
  if (error) throw error;
  return data as string;
}

export async function previewInvite(code: string): Promise<{ id: string; title: string; avatar_url: string | null; description: string | null; members_count: number; join_approval: boolean; already_member: boolean } | null> {
  const { data, error } = await supabase.rpc('preview_invite', { p_code: code });
  if (error) throw error;
  return (data as unknown as { id: string; title: string; avatar_url: string | null; description: string | null; members_count: number; join_approval: boolean; already_member: boolean } | null) ?? null;
}

export async function joinViaInvite(code: string): Promise<{ status: 'joined' | 'requested' | 'member'; conversation_id: string }> {
  const { data, error } = await supabase.rpc('join_via_invite', { p_code: code });
  if (error) throw error;
  return data as unknown as { status: 'joined' | 'requested' | 'member'; conversation_id: string };
}

export async function getJoinRequests(id: string): Promise<{ id: string; user: Message['sender']; created_at: string }[]> {
  const { data, error } = await supabase.rpc('get_join_requests', { p_conversation: id });
  if (error) throw error;
  return rows(data);
}

export async function respondJoinRequest(requestId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_join_request', { p_request: requestId, p_accept: accept });
  if (error) throw error;
}

export async function respondMessageRequest(conversationId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_message_request', { p_conversation: conversationId, p_accept: accept });
  if (error) throw error;
}

export interface ConversationSettingsPatch {
  mutedUntil?: string | null;
  isArchived?: boolean;
  isPinned?: boolean;
  markedUnread?: boolean;
  wallpaper?: string | null;
  notifications?: boolean;
}

export async function setConversationSettings(id: string, patch: ConversationSettingsPatch): Promise<ConversationSummary> {
  const { data, error } = await supabase.rpc('set_conversation_settings', {
    p_conversation: id,
    p_muted_until: patch.mutedUntil ?? null,
    p_set_mute: patch.mutedUntil !== undefined,
    p_is_archived: patch.isArchived ?? null,
    p_is_pinned: patch.isPinned ?? null,
    p_marked_unread: patch.markedUnread ?? null,
    p_wallpaper: patch.wallpaper ?? null,
    p_set_wallpaper: patch.wallpaper !== undefined,
    p_notifications: patch.notifications ?? null,
  });
  if (error) throw error;
  return data as unknown as ConversationSummary;
}

export async function clearConversation(id: string): Promise<void> {
  const { error } = await supabase.rpc('clear_conversation', { p_conversation: id });
  if (error) throw error;
}

export async function setDisappearing(id: string, seconds: number): Promise<void> {
  const { error } = await supabase.rpc('set_disappearing', { p_conversation: id, p_seconds: seconds });
  if (error) throw error;
}

export async function markConversationRead(id: string): Promise<void> {
  const { error } = await supabase.rpc('mark_conversation_read', { p_conversation: id });
  if (error) console.warn('[chat] mark read failed', error.message);
}

export async function markDelivered(ids?: string[]): Promise<void> {
  const { error } = await supabase.rpc('mark_delivered', { p_conversation_ids: ids ?? null });
  if (error) console.warn('[chat] mark delivered failed', error.message);
}

export async function getUnreadTotal(): Promise<number> {
  const { data, error } = await supabase.rpc('get_unread_total');
  if (error) throw error;
  return (data as number) ?? 0;
}

// ----------------------------------------------------------------------------
// Messages
// ----------------------------------------------------------------------------
export async function fetchMessages(conversationId: string, before: string | null = null, limit = 40): Promise<Message[]> {
  const { data, error } = await supabase.rpc('get_messages', { p_conversation: conversationId, p_limit: limit, p_before: before, p_after: null });
  if (error) throw error;
  // Server returns newest first; keep chronological order locally.
  return rows<Message>(data).reverse();
}

export async function fetchMessagesAfter(conversationId: string, after: string, limit = 100): Promise<Message[]> {
  const { data, error } = await supabase.rpc('get_messages', { p_conversation: conversationId, p_limit: limit, p_before: null, p_after: after });
  if (error) throw error;
  return rows<Message>(data).reverse();
}

export async function fetchMessage(id: string): Promise<Message | null> {
  const { data, error } = await supabase.rpc('get_message', { p_id: id });
  if (error) throw error;
  return (data as unknown as Message | null) ?? null;
}

export interface SendMessageInput {
  conversationId: string;
  kind?: MessageKind;
  text?: string | null;
  metadata?: MessageMetadata;
  attachments?: Omit<MessageAttachment, 'id'>[];
  replyToId?: string | null;
  clientId?: string;
}

export async function sendMessage(input: SendMessageInput): Promise<Message> {
  const { data, error } = await supabase.rpc('send_message', {
    p_conversation: input.conversationId,
    p_kind: input.kind ?? 'text',
    p_text: input.text ?? null,
    p_metadata: (input.metadata ?? {}) as unknown as Json,
    p_attachments: (input.attachments ?? []) as unknown as Json,
    p_reply_to: input.replyToId ?? null,
    p_client_id: input.clientId ?? null,
  });
  if (error) throw error;
  return data as unknown as Message;
}

export async function editMessage(id: string, text: string): Promise<Message> {
  const { data, error } = await supabase.rpc('edit_message', { p_id: id, p_text: text });
  if (error) throw error;
  return data as unknown as Message;
}

export async function deleteMessage(id: string, forEveryone: boolean): Promise<void> {
  const { error } = await supabase.rpc('delete_message', { p_id: id, p_for_everyone: forEveryone });
  if (error) throw error;
}

export async function forwardMessages(messageIds: string[], conversationIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('forward_messages', { p_message_ids: messageIds, p_conversation_ids: conversationIds });
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function reactToMessage(id: string, emoji: string | null): Promise<void> {
  const { error } = await supabase.rpc('react_message', { p_id: id, p_emoji: emoji ?? '' });
  if (error) throw error;
}

export async function starMessage(id: string, star: boolean): Promise<void> {
  const { error } = await supabase.rpc('star_message', { p_id: id, p_star: star });
  if (error) throw error;
}

export async function pinMessage(id: string, pin: boolean): Promise<void> {
  const { error } = await supabase.rpc('pin_message', { p_id: id, p_pin: pin });
  if (error) throw error;
}

export async function getMessageInfo(id: string): Promise<{ user: Message['sender']; delivered_at: string | null; read_at: string | null }[]> {
  const { data, error } = await supabase.rpc('get_message_info', { p_id: id });
  if (error) throw error;
  return rows(data);
}

export async function searchMessages(query: string, conversationId?: string): Promise<Message[]> {
  const { data, error } = await supabase.rpc('search_messages', { p_query: query, p_conversation: conversationId ?? null, p_limit: 50 });
  if (error) throw error;
  return rows<Message>(data);
}

export async function getStarredMessages(): Promise<Message[]> {
  const { data, error } = await supabase.rpc('get_starred_messages', { p_limit: 100 });
  if (error) throw error;
  return rows<Message>(data);
}

export async function getSharedMedia(conversationId: string, kind: 'media' | 'docs' | 'audio' | 'links', before: string | null = null): Promise<Message[]> {
  const { data, error } = await supabase.rpc('get_shared_media', { p_conversation: conversationId, p_kind: kind, p_limit: 60, p_before: before });
  if (error) throw error;
  return rows<Message>(data);
}

export async function sendStoryReply(story: StoryCard, text: string): Promise<Message> {
  const { data, error } = await supabase.rpc('send_story_reply', { p_story: story.id, p_text: text });
  if (error) throw error;
  return data as unknown as Message;
}

export async function getStickers(): Promise<Sticker[]> {
  const { data, error } = await supabase.from('stickers').select('id, pack, emoji, url, label').eq('is_active', true).order('sort_order');
  if (error) throw error;
  return (data ?? []) as Sticker[];
}

// ----------------------------------------------------------------------------
// Attachments (private bucket, signed URLs)
// ----------------------------------------------------------------------------
export interface LocalAttachment {
  uri: string;
  kind: 'image' | 'video' | 'audio' | 'document';
  mime?: string;
  name?: string;
  size?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  waveform?: number[];
}

export async function uploadChatAttachment(conversationId: string, userId: string, item: LocalAttachment, onProgress?: (p: UploadProgress) => void): Promise<Omit<MessageAttachment, 'id'>> {
  let uri = item.uri;
  let mime = item.mime ?? guessMime(item.uri);
  let width = item.width ?? null;
  let height = item.height ?? null;
  let thumbnailPath: string | null = null;

  if (item.kind === 'image') {
    const prepared = await prepareImage(item.uri, { maxDimension: 1600, quality: 0.82 });
    uri = prepared.uri;
    mime = prepared.mime;
    width = prepared.width;
    height = prepared.height;
  }
  if (item.kind === 'video') {
    const thumb = await generateVideoThumbnail(item.uri, 300);
    if (thumb) {
      try {
        const prepared = await prepareImage(thumb.uri, { maxDimension: 720, quality: 0.75 });
        const path = `${conversationId}/${objectPath(userId, 'thumb', prepared.mime)}`;
        await uploadFile({ bucket: CHAT_BUCKET, path, uri: prepared.uri, contentType: prepared.mime });
        thumbnailPath = path;
        width = width ?? thumb.width;
        height = height ?? thumb.height;
      } catch (error) {
        console.warn('[chat] thumbnail failed', error);
      }
    }
  }
  const path = `${conversationId}/${objectPath(userId, item.kind === 'image' ? 'img' : item.kind === 'video' ? 'vid' : item.kind === 'audio' ? 'voice' : 'doc', mime)}`;
  const result = await uploadFile({ bucket: CHAT_BUCKET, path, uri, contentType: mime, onProgress, maxBytes: MAX_ATTACHMENT_BYTES });
  return {
    kind: item.kind,
    path,
    name: item.name ?? null,
    mime,
    size_bytes: result.bytes,
    width,
    height,
    duration_ms: item.durationMs ?? null,
    thumbnail_path: thumbnailPath,
    waveform: item.waveform ?? null,
  };
}

const signedUrlCache = new Map<string, { url: string; expires: number }>();

export async function getSignedChatUrl(path: string, ttlSeconds = 3600): Promise<string> {
  const cached = signedUrlCache.get(path);
  if (cached && cached.expires > Date.now() + 60_000) return cached.url;
  const { data, error } = await supabase.storage.from(CHAT_BUCKET).createSignedUrl(path, ttlSeconds);
  if (error || !data) throw error ?? new Error('Could not sign URL');
  signedUrlCache.set(path, { url: data.signedUrl, expires: Date.now() + ttlSeconds * 1000 });
  return data.signedUrl;
}

// ----------------------------------------------------------------------------
// Realtime
// ----------------------------------------------------------------------------
export interface ConversationRealtimeHandlers {
  onMessageInsert?: (row: { id: string; conversation_id: string; sender_id: string | null; created_at: string }) => void;
  onMessageUpdate?: (row: { id: string; conversation_id: string; deleted_at: string | null; edited_at: string | null; text: string | null }) => void;
  onMessageDelete?: (row: { id: string }) => void;
  onReactionChange?: (messageId: string) => void;
  onMemberUpdate?: (row: { conversation_id: string; user_id: string; last_read_at: string; last_delivered_at: string }) => void;
  onTyping?: (payload: { user_id: string; name: string; typing: boolean }) => void;
}

/** Subscribes to everything happening inside one open conversation. */
export function subscribeToConversation(conversationId: string, handlers: ConversationRealtimeHandlers): { channel: RealtimeChannel; sendTyping: (typing: boolean, name: string, userId: string) => void; unsubscribe: () => void } {
  const channel = supabase
    .channel(`chat:${conversationId}`, { config: { broadcast: { self: false } } })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) =>
      handlers.onMessageInsert?.(payload.new as { id: string; conversation_id: string; sender_id: string | null; created_at: string }),
    )
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) =>
      handlers.onMessageUpdate?.(payload.new as { id: string; conversation_id: string; deleted_at: string | null; edited_at: string | null; text: string | null }),
    )
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) => handlers.onMessageDelete?.(payload.old as { id: string }))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, (payload) => {
      const row = (payload.new ?? payload.old) as { message_id?: string };
      if (row?.message_id) handlers.onReactionChange?.(row.message_id);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${conversationId}` }, (payload) =>
      handlers.onMemberUpdate?.(payload.new as { conversation_id: string; user_id: string; last_read_at: string; last_delivered_at: string }),
    )
    .on('broadcast', { event: 'typing' }, ({ payload }) => handlers.onTyping?.(payload as { user_id: string; name: string; typing: boolean }))
    .subscribe();

  return {
    channel,
    sendTyping: (typing, name, userId) => {
      channel.send({ type: 'broadcast', event: 'typing', payload: { user_id: userId, name, typing } }).catch(() => undefined);
    },
    unsubscribe: () => {
      supabase.removeChannel(channel).catch(() => undefined);
    },
  };
}

/** Global listener for new messages in any of my conversations (RLS-filtered server-side). */
export function subscribeToInbox(onMessage: (row: { id: string; conversation_id: string; sender_id: string | null; created_at: string }) => void): () => void {
  const channel = supabase
    .channel('inbox:messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => onMessage(payload.new as { id: string; conversation_id: string; sender_id: string | null; created_at: string }))
    .subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => undefined);
  };
}

export function newClientId(): string {
  return `${Platform.OS}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
