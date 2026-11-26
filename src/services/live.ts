import { privateChannel } from '@/lib/realtime';
import { supabase } from '@/lib/supabase';
import { objectPath, prepareImage, uploadFile } from '@/services/upload';
import type { Json } from '@/types/database';
import type { FanClub, LiveCategory, LiveComment, LiveDiscovery, LiveGiftEvent, LiveParticipant, LiveSession, LiveSummary } from '@/types/live';
import type { PostAudience, StoryAudience } from '@/types/social';

function rows<T>(data: Json[] | Json | null): T[] {
  return (data ?? []) as unknown as T[];
}

export interface CreateLiveInput {
  title: string;
  category: LiveCategory;
  cover_url?: string | null;
  visibility?: PostAudience;
  scheduled_at?: string | null;
  allow_guests?: boolean;
  allow_comments?: boolean;
  comment_audience?: StoryAudience;
}

export async function uploadLiveCover(userId: string, uri: string): Promise<string> {
  const prepared = await prepareImage(uri, { maxDimension: 1280, quality: 0.82 });
  const uploaded = await uploadFile({ bucket: 'live', path: objectPath(userId, 'cover', prepared.mime), uri: prepared.uri, contentType: prepared.mime, maxBytes: 8_000_000 });
  return uploaded.publicUrl;
}

export async function createLive(input: CreateLiveInput): Promise<LiveSession> {
  const { data, error } = await supabase.rpc('create_live', {
    p_title: input.title,
    p_category: input.category,
    p_cover_url: input.cover_url ?? null,
    p_visibility: input.visibility ?? 'public',
    p_scheduled_at: input.scheduled_at ?? null,
    p_allow_guests: input.allow_guests ?? true,
    p_allow_comments: input.allow_comments ?? true,
    p_comment_audience: input.comment_audience ?? 'everyone',
  });
  if (error) throw error;
  return data as unknown as LiveSession;
}

export async function updateLive(id: string, patch: Partial<Omit<CreateLiveInput, 'visibility'>> & { slow_mode_seconds?: number | null }): Promise<LiveSession> {
  const { data, error } = await supabase.rpc('update_live', {
    p_id: id,
    p_title: patch.title ?? null,
    p_category: patch.category ?? null,
    p_cover_url: patch.cover_url ?? null,
    p_allow_guests: patch.allow_guests ?? null,
    p_allow_comments: patch.allow_comments ?? null,
    p_comment_audience: patch.comment_audience ?? null,
    p_slow_mode_seconds: patch.slow_mode_seconds ?? null,
    p_scheduled_at: patch.scheduled_at ?? null,
  });
  if (error) throw error;
  return data as unknown as LiveSession;
}

export async function startLive(id: string): Promise<LiveSession> {
  const { data, error } = await supabase.rpc('start_live', { p_id: id });
  if (error) throw error;
  return data as unknown as LiveSession;
}

export async function endLive(id: string): Promise<LiveSession> {
  const { data, error } = await supabase.rpc('end_live', { p_id: id });
  if (error) throw error;
  return data as unknown as LiveSession;
}

export async function getLive(id: string): Promise<LiveSession | null> {
  const { data, error } = await supabase.rpc('get_live', { p_id: id });
  if (error) throw error;
  return (data as unknown as LiveSession | null) ?? null;
}

export async function joinLive(id: string): Promise<LiveSession> {
  const { data, error } = await supabase.rpc('join_live', { p_id: id });
  if (error) throw error;
  return data as unknown as LiveSession;
}

export async function leaveLive(id: string): Promise<void> {
  await supabase.rpc('leave_live', { p_id: id });
}

export async function liveHeartbeat(id: string): Promise<{ viewers_count: number } | null> {
  const { data } = await supabase.rpc('live_heartbeat', { p_id: id });
  return (data as unknown as { viewers_count: number } | null) ?? null;
}

export async function getLiveDiscovery(category?: LiveCategory | null): Promise<LiveDiscovery> {
  const { data, error } = await supabase.rpc('get_live_discovery', { p_category: category ?? null, p_limit: 30 });
  if (error) throw error;
  return data as unknown as LiveDiscovery;
}

export async function getMyLives(limit = 20): Promise<LiveSession[]> {
  const { data, error } = await supabase.rpc('get_my_lives', { p_limit: limit });
  if (error) throw error;
  return rows<LiveSession>(data);
}

export async function getUserLives(userId: string, limit = 20): Promise<LiveSession[]> {
  const { data, error } = await supabase.rpc('get_user_lives', { p_user: userId, p_limit: limit });
  if (error) throw error;
  return rows<LiveSession>(data);
}

export async function getLiveSummary(id: string): Promise<LiveSummary | null> {
  const { data, error } = await supabase.rpc('get_live_summary', { p_id: id });
  if (error) throw error;
  return (data as unknown as LiveSummary | null) ?? null;
}

export async function setLiveReminder(id: string, on: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_live_reminder', { p_id: id, p_on: on });
  if (error) throw error;
}

// Comments, likes
export async function getLiveComments(id: string, before: string | null = null, limit = 50): Promise<LiveComment[]> {
  const { data, error } = await supabase.rpc('get_live_comments', { p_id: id, p_limit: limit, p_before: before });
  if (error) throw error;
  return rows<LiveComment>(data);
}

export async function sendLiveComment(id: string, text: string): Promise<LiveComment> {
  const { data, error } = await supabase.rpc('send_live_comment', { p_id: id, p_text: text });
  if (error) throw error;
  return data as unknown as LiveComment;
}

export async function pinLiveComment(commentId: string, pin: boolean): Promise<void> {
  const { error } = await supabase.rpc('pin_live_comment', { p_comment: commentId, p_pin: pin });
  if (error) throw error;
}

export async function deleteLiveComment(commentId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_live_comment', { p_comment: commentId });
  if (error) throw error;
}

export async function likeLive(id: string, count = 1): Promise<{ likes_count: number } | null> {
  const { data, error } = await supabase.rpc('like_live', { p_id: id, p_count: count });
  if (error) throw error;
  return (data as unknown as { likes_count: number } | null) ?? null;
}

// Stage & moderation
export async function requestLiveStage(id: string): Promise<void> {
  const { error } = await supabase.rpc('request_live_stage', { p_id: id });
  if (error) throw error;
}

export async function cancelLiveStageRequest(id: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_live_stage_request', { p_id: id });
  if (error) throw error;
}

export async function inviteLiveGuest(id: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('invite_live_guest', { p_id: id, p_user: userId });
  if (error) throw error;
}

export async function approveLiveGuest(id: string, userId: string, approve: boolean): Promise<void> {
  const { error } = await supabase.rpc('approve_live_guest', { p_id: id, p_user: userId, p_approve: approve });
  if (error) throw error;
}

export async function acceptLiveInvite(id: string): Promise<void> {
  const { error } = await supabase.rpc('accept_live_invite', { p_id: id });
  if (error) throw error;
}

export async function setLiveGuestMedia(id: string, userId: string, patch: { mic?: boolean; cam?: boolean }): Promise<void> {
  const { error } = await supabase.rpc('set_live_guest_media', { p_id: id, p_user: userId, p_mic: patch.mic ?? null, p_cam: patch.cam ?? null });
  if (error) throw error;
}

export async function removeLiveGuest(id: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_live_guest', { p_id: id, p_user: userId });
  if (error) throw error;
}

export async function setLiveCohost(id: string, userId: string, cohost: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_live_cohost', { p_id: id, p_user: userId, p_cohost: cohost });
  if (error) throw error;
}

export async function setLiveModerator(id: string, userId: string, moderator: boolean, persistent = false): Promise<void> {
  const { error } = await supabase.rpc('set_live_moderator', { p_id: id, p_user: userId, p_moderator: moderator, p_persistent: persistent });
  if (error) throw error;
}

export async function muteLiveUser(id: string, userId: string, minutes = 10): Promise<void> {
  const { error } = await supabase.rpc('mute_live_user', { p_id: id, p_user: userId, p_minutes: minutes });
  if (error) throw error;
}

export async function banLiveUser(id: string, userId: string, ban = true): Promise<void> {
  const { error } = await supabase.rpc('ban_live_user', { p_id: id, p_user: userId, p_ban: ban });
  if (error) throw error;
}

export async function getLiveParticipants(id: string, state: 'requested' | 'on_stage' | 'watching'): Promise<LiveParticipant[]> {
  const { data, error } = await supabase.rpc('get_live_participants', { p_id: id, p_state: state });
  if (error) throw error;
  return rows<LiveParticipant>(data);
}

export async function startLiveBattle(id: string, opponentId: string, minutes = 5): Promise<LiveSession> {
  const { data, error } = await supabase.rpc('start_live_battle', { p_id: id, p_opponent: opponentId, p_minutes: minutes });
  if (error) throw error;
  return data as unknown as LiveSession;
}

export async function endLiveBattle(id: string): Promise<LiveSession> {
  const { data, error } = await supabase.rpc('end_live_battle', { p_id: id });
  if (error) throw error;
  return data as unknown as LiveSession;
}

// Fan club
export async function getFanClub(creatorId: string): Promise<FanClub> {
  const { data, error } = await supabase.rpc('get_fan_club', { p_creator: creatorId });
  if (error) throw error;
  return data as unknown as FanClub;
}

export async function joinFanClub(creatorId: string): Promise<void> {
  const { error } = await supabase.rpc('join_fan_club', { p_creator: creatorId });
  if (error) throw error;
}

export async function leaveFanClub(creatorId: string): Promise<void> {
  const { error } = await supabase.rpc('leave_fan_club', { p_creator: creatorId });
  if (error) throw error;
}

// Gifts in a live
export async function sendLiveGift(liveId: string, giftId: number, quantity = 1, recipientId: string | null = null, message: string | null = null): Promise<{ balance: number; gift: LiveGiftEvent['gift'] }> {
  const { data, error } = await supabase.rpc('send_live_gift', { p_live: liveId, p_gift_id: giftId, p_quantity: quantity, p_recipient: recipientId, p_message: message });
  if (error) throw error;
  return data as unknown as { balance: number; gift: LiveGiftEvent['gift'] };
}

// Realtime
export interface LiveRealtimeHandlers {
  onSession?: () => void;
  onComment?: (row: { id: string }) => void;
  onParticipants?: () => void;
  onGift?: (event: LiveGiftEvent) => void;
  onBattle?: () => void;
}

export function subscribeToLive(liveId: string, handlers: LiveRealtimeHandlers): () => void {
  const channel = privateChannel(`live:${liveId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_sessions', filter: `id=eq.${liveId}` }, () => handlers.onSession?.())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_comments', filter: `live_id=eq.${liveId}` }, (payload) => handlers.onComment?.(payload.new as { id: string }))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_comments', filter: `live_id=eq.${liveId}` }, (payload) => handlers.onComment?.(payload.new as { id: string }))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'live_participants', filter: `live_id=eq.${liveId}` }, () => handlers.onParticipants?.())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_gift_events', filter: `live_id=eq.${liveId}` }, (payload) => handlers.onGift?.(payload.new as LiveGiftEvent))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'live_battles', filter: `live_id=eq.${liveId}` }, () => handlers.onBattle?.())
    .subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => undefined);
  };
}
