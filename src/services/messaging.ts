import type { RealtimeChannel } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { invalidateRecipients } from '@/lib/e2ee/devices';
import { newFileKey } from '@/lib/e2ee/files';
import { encryptLocalFile, secretFromMaterial } from '@/lib/e2ee/io';
import { decryptMessage, decryptMessages, sealForConversation, type AttachmentSecret, type EnvelopePayloadV1 } from '@/lib/e2ee/messages';
import { acquireBroadcastChannel, privateChannel, subscribeShared } from '@/lib/realtime';
import { supabase } from '@/lib/supabase';
import { generateVideoThumbnail } from '@/services/thumbnail';
import { guessMime, objectPath, prepareImage, uploadFile, type UploadProgress } from '@/services/upload';
import type { Json } from '@/types/database';
import type { ConversationDetail, ConversationSummary, InboxFilter, Message, MessageAttachment, MessageKind, MessageMetadata, Sticker } from '@/types/messaging';
import type { StoryCard } from '@/types/social';
import { AppError } from '@/utils/errors';

const CHAT_BUCKET = 'chat';
/** Plaintext limit per attachment; the sealed file is a few KB larger. */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

function rows<T>(data: Json[] | Json | null): T[] {
  return (data ?? []) as unknown as T[];
}

function isStale(error: { message?: string; hint?: string | null } | null): boolean {
  return Boolean(error) && /STALE_RECIPIENTS/.test(`${error?.message ?? ''} ${error?.hint ?? ''}`);
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
  const detail = data as unknown as ConversationDetail;
  return { ...detail, pins: await decryptMessages(detail.pins ?? []) };
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
  invalidateRecipients(id);
  return (data as number) ?? 0;
}

export async function removeMember(id: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_member', { p_conversation: id, p_user: userId });
  if (error) throw error;
  invalidateRecipients(id);
}

export async function setMemberRole(id: string, userId: string, role: 'owner' | 'admin' | 'member'): Promise<void> {
  const { error } = await supabase.rpc('set_member_role', { p_conversation: id, p_user: userId, p_role: role });
  if (error) throw error;
}

export async function leaveConversation(id: string): Promise<void> {
  const { error } = await supabase.rpc('leave_conversation', { p_conversation: id });
  if (error) throw error;
  invalidateRecipients(id);
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
  invalidateRecipients();
}

export async function respondMessageRequest(conversationId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_message_request', { p_conversation: conversationId, p_accept: accept });
  if (error) throw error;
  invalidateRecipients(conversationId);
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

export interface ArchivedSummary {
  chats: number;
  unread_chats: number;
  unread_messages: number;
  names: string[];
  keep_archived: boolean;
}

/** Feeds the single "Archived" row at the top of the inbox. */
export async function getArchivedSummary(): Promise<ArchivedSummary> {
  const { data, error } = await supabase.rpc('get_archived_summary');
  if (error) throw error;
  return data as unknown as ArchivedSummary;
}

/** Empties the archive and returns how many chats moved back. */
export async function unarchiveAllChats(): Promise<number> {
  const { data, error } = await supabase.rpc('unarchive_all_chats');
  if (error) throw error;
  return (data ?? 0) as number;
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
// Messages (every fetch decrypts sealed envelopes on this device)
// ----------------------------------------------------------------------------
export async function fetchMessages(conversationId: string, before: string | null = null, limit = 40): Promise<Message[]> {
  const { data, error } = await supabase.rpc('get_messages', { p_conversation: conversationId, p_limit: limit, p_before: before, p_after: null });
  if (error) throw error;
  // Server returns newest first; keep chronological order locally.
  return decryptMessages(rows<Message>(data).reverse());
}

export async function fetchMessagesAfter(conversationId: string, after: string, limit = 100): Promise<Message[]> {
  const { data, error } = await supabase.rpc('get_messages', { p_conversation: conversationId, p_limit: limit, p_before: null, p_after: after });
  if (error) throw error;
  return decryptMessages(rows<Message>(data).reverse());
}

export async function fetchMessage(id: string): Promise<Message | null> {
  const { data, error } = await supabase.rpc('get_message', { p_id: id });
  if (error) throw error;
  const message = (data as unknown as Message | null) ?? null;
  return message ? decryptMessage(message) : null;
}

/** A sealed, uploaded attachment: what the server stores vs. what only recipients can read. */
export interface EncryptedUpload {
  server: { path: string; kind: MessageAttachment['kind']; size_bytes: number; thumbnail_path: string | null };
  secret: AttachmentSecret;
}

export interface SendEncryptedInput {
  conversationId: string;
  userId: string;
  kind?: MessageKind;
  text?: string | null;
  metadata?: MessageMetadata;
  attachments?: EncryptedUpload[];
  replyToId?: string | null;
  clientId?: string;
  forwarded?: boolean;
}

/**
 * Seals the content for every device in the conversation and stores only the
 * envelope. If the device list changed meanwhile (STALE_RECIPIENTS) it refreshes
 * the recipients and seals once more.
 */
export async function sendEncryptedMessage(input: SendEncryptedInput): Promise<Message> {
  const kind = input.kind ?? 'text';
  const payload: EnvelopePayloadV1 = { text: input.text ?? null, metadata: input.metadata ?? {}, attachments: (input.attachments ?? []).map((a) => a.secret) };
  const attachments = (input.attachments ?? []).map((a) => a.server);
  const attempt = async (force: boolean) => {
    const { envelope } = await sealForConversation({ conversationId: input.conversationId, kind, payload, userId: input.userId, force });
    return supabase.rpc('send_encrypted_message', {
      p_conversation: input.conversationId,
      p_kind: kind,
      p_envelope: envelope as unknown as Json,
      p_attachments: attachments as unknown as Json,
      p_reply_to: input.replyToId ?? null,
      p_client_id: input.clientId ?? null,
      p_forwarded: Boolean(input.forwarded),
    });
  };
  let result = await attempt(false);
  if (isStale(result.error)) {
    invalidateRecipients(input.conversationId);
    result = await attempt(true);
  }
  if (result.error) throw result.error;
  return decryptMessage(result.data as unknown as Message);
}

export async function editMessage(message: Message, text: string, userId: string): Promise<Message> {
  if (!message.encrypted) throw new AppError('This message was sent before end-to-end encryption and cannot be edited.', 'CANNOT_EDIT');
  const payload: EnvelopePayloadV1 = { text, metadata: message.metadata ?? {}, attachments: [] };
  const attempt = async (force: boolean) => {
    const { envelope } = await sealForConversation({ conversationId: message.conversation_id, kind: 'text', payload, userId, force });
    return supabase.rpc('edit_encrypted_message', { p_id: message.id, p_envelope: envelope as unknown as Json });
  };
  let result = await attempt(false);
  if (isStale(result.error)) {
    invalidateRecipients(message.conversation_id);
    result = await attempt(true);
  }
  if (result.error) throw result.error;
  return decryptMessage(result.data as unknown as Message);
}

export async function deleteMessage(id: string, forEveryone: boolean): Promise<void> {
  const { error } = await supabase.rpc('delete_message', { p_id: id, p_for_everyone: forEveryone });
  if (error) throw error;
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

/** Server-side search only covers messages sent before end-to-end encryption; sealed text is searched on the device. */
export async function searchMessages(query: string, conversationId?: string): Promise<Message[]> {
  const { data, error } = await supabase.rpc('search_messages', { p_query: query, p_conversation: conversationId ?? null, p_limit: 50 });
  if (error) throw error;
  return decryptMessages(rows<Message>(data));
}

export async function getStarredMessages(): Promise<Message[]> {
  const { data, error } = await supabase.rpc('get_starred_messages', { p_limit: 100 });
  if (error) throw error;
  return decryptMessages(rows<Message>(data));
}

export async function getSharedMedia(conversationId: string, kind: 'media' | 'docs' | 'audio' | 'links', before: string | null = null): Promise<Message[]> {
  const { data, error } = await supabase.rpc('get_shared_media', { p_conversation: conversationId, p_kind: kind, p_limit: 60, p_before: before });
  if (error) throw error;
  return decryptMessages(rows<Message>(data));
}

export async function sendStoryReply(story: StoryCard, text: string, userId: string): Promise<Message> {
  const conversationId = await startDirectConversation(story.author.id);
  const payload: EnvelopePayloadV1 = {
    text,
    metadata: { story_id: story.id, thumbnail_url: story.thumbnail_url ?? story.media_url, story_kind: story.kind, story_text: (story.text ?? '').slice(0, 120) },
    attachments: [],
  };
  const clientId = newClientId();
  const attempt = async (force: boolean) => {
    const { envelope } = await sealForConversation({ conversationId, kind: 'story_reply', payload, userId, force });
    return supabase.rpc('send_story_reply', { p_story: story.id, p_envelope: envelope as unknown as Json, p_client_id: clientId });
  };
  let result = await attempt(false);
  if (isStale(result.error)) {
    invalidateRecipients(conversationId);
    result = await attempt(true);
  }
  if (result.error) throw result.error;
  return decryptMessage(result.data as unknown as Message);
}

export async function getStickers(): Promise<Sticker[]> {
  const { data, error } = await supabase.from('stickers').select('id, pack, emoji, url, label').eq('is_active', true).order('sort_order');
  if (error) throw error;
  return (data ?? []) as Sticker[];
}

// ----------------------------------------------------------------------------
// Attachments: encrypted on the device, stored as opaque blobs in the private bucket
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

async function uploadSealed(conversationId: string, userId: string, tag: string, uri: string, onProgress?: (p: UploadProgress) => void): Promise<{ path: string; bytes: number; plainBytes: number; secret: { key: string; nonce: string } }> {
  const material = newFileKey();
  const sealed = await encryptLocalFile(uri, material, MAX_ATTACHMENT_BYTES);
  const path = `${conversationId}/${objectPath(userId, tag, 'application/octet-stream')}`;
  try {
    await uploadFile({ bucket: CHAT_BUCKET, path, uri: sealed.uri, contentType: 'application/octet-stream', onProgress });
  } finally {
    await sealed.cleanup();
  }
  return { path, bytes: sealed.bytes, plainBytes: sealed.plainBytes, secret: secretFromMaterial(material) };
}

export async function uploadEncryptedAttachment(conversationId: string, userId: string, item: LocalAttachment, onProgress?: (p: UploadProgress) => void): Promise<EncryptedUpload> {
  let uri = item.uri;
  let mime = item.mime ?? guessMime(item.uri);
  let width = item.width ?? null;
  let height = item.height ?? null;
  let thumbnail: { path: string; secret: { key: string; nonce: string } } | null = null;

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
        const sealed = await uploadSealed(conversationId, userId, 'thumb', prepared.uri);
        thumbnail = { path: sealed.path, secret: sealed.secret };
        width = width ?? thumb.width;
        height = height ?? thumb.height;
      } catch (error) {
        console.warn('[chat] thumbnail failed', error);
      }
    }
  }
  const tag = item.kind === 'image' ? 'img' : item.kind === 'video' ? 'vid' : item.kind === 'audio' ? 'voice' : 'doc';
  const sealed = await uploadSealed(conversationId, userId, tag, uri, onProgress);
  return {
    server: { path: sealed.path, kind: item.kind, size_bytes: sealed.bytes, thumbnail_path: thumbnail?.path ?? null },
    secret: {
      name: item.name ?? null,
      mime,
      width,
      height,
      duration_ms: item.durationMs ?? null,
      waveform: item.waveform ?? null,
      size_bytes: sealed.plainBytes,
      key: sealed.secret.key,
      nonce: sealed.secret.nonce,
      thumb: thumbnail?.secret ?? null,
    },
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
  // Database events: a channel of our own (topics must not be shared between listeners).
  const channel = privateChannel(`chat-db:${conversationId}`)
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
    .subscribe();

  // Typing indicators: a broadcast topic shared by everyone in the conversation (and by any
  // second copy of this screen on the same device).
  const typingTopic = `chat:${conversationId}`;
  const typing = acquireBroadcastChannel(typingTopic);
  typing.channel.on('broadcast', { event: 'typing' }, ({ payload }) => handlers.onTyping?.(payload as { user_id: string; name: string; typing: boolean }));
  subscribeShared(typingTopic);

  return {
    channel,
    sendTyping: (typingNow, name, userId) => {
      typing.channel.send({ type: 'broadcast', event: 'typing', payload: { user_id: userId, name, typing: typingNow } }).catch(() => undefined);
    },
    unsubscribe: () => {
      supabase.removeChannel(channel).catch(() => undefined);
      typing.release();
    },
  };
}

/** Global listener for new messages in any of my conversations (RLS-filtered server-side). */
export function subscribeToInbox(onMessage: (row: { id: string; conversation_id: string; sender_id: string | null; created_at: string }) => void): () => void {
  const channel = privateChannel('inbox:messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => onMessage(payload.new as { id: string; conversation_id: string; sender_id: string | null; created_at: string }))
    .subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => undefined);
  };
}

export function newClientId(): string {
  return `${Platform.OS}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
