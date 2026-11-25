import { supabase } from '@/lib/supabase';
import type { ProfileCard, ProfileRow, ProfileUpdate, UserPrivateRow, UserSettingsRow } from '@/types/database';
import { normalizeUsername } from '@/utils/validation';

export async function getProfileById(id: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getProfileByUsername(username: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('username', normalizeUsername(username))
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateMyProfile(userId: string, patch: ProfileUpdate): Promise<ProfileRow> {
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', userId).select('*').single();
  if (error) throw error;
  return data;
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_username_available', { p_username: normalizeUsername(username) });
  if (error) throw error;
  return Boolean(data);
}

export async function getMySettings(userId: string): Promise<UserSettingsRow | null> {
  const { data, error } = await supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateMySettings(
  userId: string,
  patch: Partial<Omit<UserSettingsRow, 'user_id' | 'created_at' | 'updated_at'>>,
): Promise<UserSettingsRow> {
  const { data, error } = await supabase.from('user_settings').update(patch).eq('user_id', userId).select('*').single();
  if (error) throw error;
  return data;
}

export async function updateMyPrivate(
  userId: string,
  patch: Partial<Pick<UserPrivateRow, 'gender' | 'phone'>>,
): Promise<UserPrivateRow> {
  const { data, error } = await supabase.from('user_private').update(patch).eq('user_id', userId).select('*').single();
  if (error) throw error;
  return data;
}

export async function searchProfiles(params: {
  query?: string;
  country?: string | null;
  limit?: number;
  offset?: number;
}): Promise<ProfileCard[]> {
  const { data, error } = await supabase.rpc('search_profiles', {
    p_query: params.query ?? '',
    p_country: params.country ?? null,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  });
  if (error) throw error;
  return (data ?? []) as ProfileCard[];
}

export async function getSuggestedProfiles(limit = 20): Promise<ProfileCard[]> {
  const { data, error } = await supabase.rpc('get_suggested_profiles', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ProfileCard[];
}

export async function getNewMembers(myUserId: string | undefined, limit = 20): Promise<ProfileCard[]> {
  let query = supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, country_code, bio, is_verified, is_private, followers_count')
    .eq('discoverable', true)
    .eq('onboarding_completed', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (myUserId) query = query.neq('id', myUserId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ProfileCard[];
}

export async function getPopularProfiles(myUserId: string | undefined, limit = 20): Promise<ProfileCard[]> {
  let query = supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, country_code, bio, is_verified, is_private, followers_count')
    .eq('discoverable', true)
    .eq('onboarding_completed', true)
    .order('popularity_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (myUserId) query = query.neq('id', myUserId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ProfileCard[];
}

const CARD_COLUMNS = 'id, username, display_name, avatar_url, country_code, bio, is_verified, is_private, followers_count';

export async function listFollowers(userId: string, limit = 30, offset = 0): Promise<ProfileCard[]> {
  const { data, error } = await supabase
    .from('follows')
    .select(`created_at, profile:profiles!follows_follower_id_fkey(${CARD_COLUMNS})`)
    .eq('following_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []).map((row) => row.profile as unknown as ProfileCard).filter(Boolean);
}

export async function listFollowing(userId: string, limit = 30, offset = 0): Promise<ProfileCard[]> {
  const { data, error } = await supabase
    .from('follows')
    .select(`created_at, profile:profiles!follows_following_id_fkey(${CARD_COLUMNS})`)
    .eq('follower_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []).map((row) => row.profile as unknown as ProfileCard).filter(Boolean);
}

export async function listFriends(userId: string, limit = 50): Promise<ProfileCard[]> {
  const { data, error } = await supabase
    .from('friendships')
    .select('user_a, user_b, created_at')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const ids = (data ?? []).map((f) => (f.user_a === userId ? f.user_b : f.user_a));
  if (ids.length === 0) return [];
  const { data: profiles, error: pErr } = await supabase.from('profiles').select(CARD_COLUMNS).in('id', ids);
  if (pErr) throw pErr;
  const byId = new Map((profiles ?? []).map((p) => [p.id, p as ProfileCard]));
  return ids.map((id) => byId.get(id)).filter((p): p is ProfileCard => Boolean(p));
}

export async function getProfilesByIds(ids: string[]): Promise<ProfileCard[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from('profiles').select(CARD_COLUMNS).in('id', ids);
  if (error) throw error;
  return (data ?? []) as ProfileCard[];
}
