import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import type { NotificationRow, ProfileCard } from '@/types/database';

import { getProfilesByIds } from './profiles';

export interface NotificationItem extends NotificationRow {
  actor: ProfileCard | null;
}

export async function listNotifications(userId: string, limit = 30, before?: string): Promise<NotificationItem[]> {
  let query = supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  const actorIds = Array.from(new Set(rows.map((r) => r.actor_id).filter((id): id is string => Boolean(id))));
  const actors = actorIds.length ? await getProfilesByIds(actorIds).catch(() => [] as ProfileCard[]) : [];
  const byId = new Map(actors.map((a) => [a.id, a]));
  return rows.map((row) => ({ ...row, actor: row.actor_id ? (byId.get(row.actor_id) ?? null) : null }));
}

export async function getUnreadCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);
  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('is_read', false);
  if (error) throw error;
}

export async function deleteNotification(id: string): Promise<void> {
  const { error } = await supabase.from('notifications').delete().eq('id', id);
  if (error) throw error;
}

/** Subscribes to new notifications for the signed-in user. Returns an unsubscribe function. */
export function subscribeToNotifications(userId: string, onInsert: (row: NotificationRow) => void): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload) => onInsert(payload.new as NotificationRow),
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => undefined);
  };
}

export function describeNotification(item: NotificationItem): { title: string; body: string; href: string | null } {
  const name = item.actor?.display_name ?? 'Someone';
  const username = item.actor?.username;
  const profileHref = username ? `/u/${username}` : null;
  switch (item.type) {
    case 'new_follower':
      return { title: name, body: 'started following you', href: profileHref };
    case 'follow_request':
      return { title: name, body: 'requested to follow you', href: '/requests' };
    case 'follow_request_accepted':
      return { title: name, body: 'accepted your follow request', href: profileHref };
    case 'friend_request':
      return { title: name, body: 'sent you a friend request', href: '/requests' };
    case 'friend_request_accepted':
      return { title: name, body: 'accepted your friend request — you are now friends', href: profileHref };
    case 'post_like': {
      const reaction = String((item.data as { reaction?: string })?.reaction ?? 'like');
      return { title: name, body: reaction === 'like' ? 'liked your post' : `reacted ${reaction} to your post`, href: item.entity_id ? `/post/${item.entity_id}` : null };
    }
    case 'post_comment': {
      const data = item.data as { post_id?: string; preview?: string };
      return { title: name, body: `commented: “${data?.preview ?? ''}”`, href: data?.post_id ? `/post/${data.post_id}` : null };
    }
    case 'comment_reply': {
      const data = item.data as { post_id?: string; preview?: string };
      return { title: name, body: `replied: “${data?.preview ?? ''}”`, href: data?.post_id ? `/post/${data.post_id}` : null };
    }
    case 'comment_like':
      return { title: name, body: 'liked your comment', href: null };
    case 'mention': {
      const data = item.data as { post_id?: string };
      const postId = item.entity_type === 'post' ? item.entity_id : data?.post_id;
      return { title: name, body: 'mentioned you', href: postId ? `/post/${postId}` : null };
    }
    case 'post_repost':
      return { title: name, body: 'reposted your post', href: item.entity_id ? `/post/${item.entity_id}` : null };
    case 'story_reaction':
      return { title: name, body: `reacted ${String((item.data as { emoji?: string })?.emoji ?? '')} to your story`, href: profileHref };
    case 'message':
    case 'message_request':
      return { title: name, body: item.type === 'message_request' ? 'sent you a message request' : 'sent you a message', href: item.entity_id ? `/chat/${item.entity_id}` : '/inbox' };
    case 'group_invite':
      return { title: name, body: `added you to ${String((item.data as { title?: string })?.title ?? 'a group')}`, href: item.entity_id ? `/chat/${item.entity_id}` : '/inbox' };
    case 'missed_call':
      return { title: name, body: `missed ${String((item.data as { kind?: string })?.kind ?? 'voice')} call`, href: '/calls' };
    case 'video_like':
      return { title: name, body: 'liked your video', href: item.entity_id ? `/video/${item.entity_id}` : null };
    case 'video_comment':
      return { title: name, body: `commented on your video: “${String((item.data as { preview?: string })?.preview ?? '')}”`, href: item.entity_id ? `/video/${item.entity_id}` : null };
    case 'video_repost':
      return { title: name, body: 'reposted your video', href: item.entity_id ? `/video/${item.entity_id}` : null };
    case 'live_started':
      return { title: name, body: 'is live now — tap to watch', href: item.entity_id ? `/live/${item.entity_id}` : '/live' };
    case 'live_scheduled':
      return { title: name, body: `scheduled a live: ${String((item.data as { title?: string })?.title ?? '')}`, href: '/live' };
    case 'live_guest_invite':
      return { title: name, body: 'invited you to join their live as a guest', href: item.entity_id ? `/live/${item.entity_id}` : '/live' };
    case 'gift_received':
      return { title: name, body: `sent you a gift: ${String((item.data as { gift?: string })?.gift ?? '')}`, href: '/wallet' };
    case 'subscription_update': {
      const status = String((item.data as { status?: string })?.status ?? '');
      const body = status === 'active' ? 'Your Premium is active — enjoy the perks!' : status === 'billing_issue' ? 'There is a problem with your payment method. Update it to keep Premium.' : status ? 'Your Premium subscription has ended.' : 'Your subscription was updated';
      return { title: 'Friendzy Premium', body, href: '/premium' };
    }
    case 'coins_credited':
      return { title: 'Coins added', body: `${String((item.data as { coins?: number })?.coins ?? '')} coins were added to your wallet`, href: '/wallet' };
    case 'coins_adjusted':
      return { title: 'Wallet update', body: String((item.data as { reason?: string })?.reason ?? 'Your coin balance was adjusted'), href: '/wallet' };
    case 'withdrawal_update':
      return { title: 'Withdrawal update', body: `Your withdrawal is ${String((item.data as { status?: string })?.status ?? 'updated')}`, href: '/wallet/earnings' };
    case 'game_invite':
      return { title: name, body: `invited you to play ${String((item.data as { game?: string })?.game ?? 'a game').replace(/_/g, ' ')}`, href: item.entity_id ? `/games/room/${item.entity_id}` : '/games' };
    case 'moderation': {
      const d = item.data as { kind?: string; reason?: string; feature?: string };
      const what = d?.kind === 'warning' ? 'Warning from the Friendzy team' : d?.kind === 'feature_restriction' ? `Temporarily restricted: ${d.feature ?? 'feature'}` : d?.kind === 'reinstated' ? 'Your account is active again' : d?.kind === 'live_ended' ? 'Your live was ended by a moderator' : 'Account notice';
      return { title: what, body: String(d?.reason ?? ''), href: '/settings/account' };
    }
    case 'content_removed':
      return { title: 'Content removed', body: String((item.data as { reason?: string })?.reason ?? 'Some of your content was removed for violating the guidelines'), href: '/guidelines' };
    case 'verification_update':
      return { title: 'Verification', body: (item.data as { verified?: boolean })?.verified ? 'Your account is now verified ✓' : `Your verification request was reviewed${(item.data as { note?: string })?.note ? `: ${(item.data as { note?: string }).note}` : ''}`, href: '/settings/verification' };
    case 'security_alert':
      return { title: 'Security alert', body: String((item.data as { message?: string })?.message ?? 'Review your account activity'), href: '/settings/security' };
    default:
      return { title: name, body: item.type.replace(/_/g, ' '), href: profileHref };
  }
}
