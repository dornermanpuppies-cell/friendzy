import { supabase } from '@/lib/supabase';
import type { FollowRequestRow, FriendRequestRow, ProfileCard, Relationship } from '@/types/database';

import { getProfilesByIds } from './profiles';

export type FollowState = 'none' | 'following' | 'requested';

export async function getRelationship(targetId: string): Promise<Relationship> {
  const { data, error } = await supabase.rpc('get_relationship', { p_target: targetId });
  if (error) throw error;
  return data as unknown as Relationship;
}

export async function followUser(targetId: string): Promise<FollowState> {
  const { data, error } = await supabase.rpc('follow_user', { p_target: targetId });
  if (error) throw error;
  return (data as FollowState) ?? 'following';
}

export async function unfollowUser(targetId: string): Promise<FollowState> {
  const { error } = await supabase.rpc('unfollow_user', { p_target: targetId });
  if (error) throw error;
  return 'none';
}

export async function removeFollower(followerId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_follower', { p_follower: followerId });
  if (error) throw error;
}

export async function respondFollowRequest(requestId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_follow_request', { p_request: requestId, p_accept: accept });
  if (error) throw error;
}

export async function sendFriendRequest(targetId: string, message?: string): Promise<string> {
  const { data, error } = await supabase.rpc('send_friend_request', { p_target: targetId, p_message: message ?? null });
  if (error) throw error;
  return data as string;
}

export async function respondFriendRequest(requestId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_friend_request', { p_request: requestId, p_accept: accept });
  if (error) throw error;
}

export async function cancelFriendRequest(requestId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_friend_request', { p_request: requestId });
  if (error) throw error;
}

export async function unfriend(otherId: string): Promise<void> {
  const { error } = await supabase.rpc('unfriend', { p_other: otherId });
  if (error) throw error;
}

export interface FriendRequestWithProfile extends FriendRequestRow {
  profile: ProfileCard | null;
}

export async function listIncomingFriendRequests(myUserId: string): Promise<FriendRequestWithProfile[]> {
  const { data, error } = await supabase
    .from('friend_requests')
    .select('*')
    .eq('receiver_id', myUserId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return attachProfiles(data ?? [], (r) => r.sender_id);
}

export async function listOutgoingFriendRequests(myUserId: string): Promise<FriendRequestWithProfile[]> {
  const { data, error } = await supabase
    .from('friend_requests')
    .select('*')
    .eq('sender_id', myUserId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return attachProfiles(data ?? [], (r) => r.receiver_id);
}

export interface FollowRequestWithProfile extends FollowRequestRow {
  profile: ProfileCard | null;
}

export async function listIncomingFollowRequests(myUserId: string): Promise<FollowRequestWithProfile[]> {
  const { data, error } = await supabase
    .from('follow_requests')
    .select('*')
    .eq('target_id', myUserId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return attachProfiles(data ?? [], (r) => r.requester_id);
}

async function attachProfiles<T>(rows: T[], pick: (row: T) => string): Promise<(T & { profile: ProfileCard | null })[]> {
  const ids = Array.from(new Set(rows.map(pick)));
  const profiles = await getProfilesByIds(ids);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return rows.map((row) => ({ ...row, profile: byId.get(pick(row)) ?? null }));
}

export async function countPendingRequests(myUserId: string): Promise<number> {
  const [friends, follows] = await Promise.all([
    supabase.from('friend_requests').select('id', { count: 'exact', head: true }).eq('receiver_id', myUserId).eq('status', 'pending'),
    supabase.from('follow_requests').select('id', { count: 'exact', head: true }).eq('target_id', myUserId).eq('status', 'pending'),
  ]);
  return (friends.count ?? 0) + (follows.count ?? 0);
}
