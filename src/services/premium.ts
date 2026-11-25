import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';
import type { PremiumPlan, PremiumStatus } from '@/types/economy';
import type { AuthorCard } from '@/types/social';

function rows<T>(data: Json[] | Json | null): T[] {
  return (data ?? []) as unknown as T[];
}

export async function getPremiumStatus(): Promise<PremiumStatus> {
  const { data, error } = await supabase.rpc('get_premium_status');
  if (error) throw error;
  return data as unknown as PremiumStatus;
}

export async function getPremiumPlans(): Promise<PremiumPlan[]> {
  const { data, error } = await supabase.rpc('get_premium_plans');
  if (error) throw error;
  return rows<PremiumPlan>(data);
}

export async function recordProfileView(profileId: string): Promise<void> {
  await supabase.rpc('record_profile_view', { p_profile: profileId });
}

export interface LockedList<T> {
  locked: boolean;
  count: number;
  items: T[];
}

export async function getProfileViewers(limit = 30): Promise<LockedList<AuthorCard & { viewed_at: string; views: number }>> {
  const { data, error } = await supabase.rpc('get_profile_viewers', { p_limit: limit });
  if (error) throw error;
  const d = data as unknown as { locked: boolean; count: number; viewers: (AuthorCard & { viewed_at: string; views: number })[] };
  return { locked: d.locked, count: d.count, items: d.viewers ?? [] };
}

export async function getMatchAdmirers(limit = 30): Promise<LockedList<AuthorCard & { liked_at: string }>> {
  const { data, error } = await supabase.rpc('get_match_admirers', { p_limit: limit });
  if (error) throw error;
  const d = data as unknown as { locked: boolean; count: number; people: (AuthorCard & { liked_at: string })[] };
  return { locked: d.locked, count: d.count, items: d.people ?? [] };
}

export interface AdvancedSearchParams {
  query?: string;
  country?: string | null;
  minAge?: number | null;
  maxAge?: number | null;
  gender?: string | null;
  onlineOnly?: boolean;
  verifiedOnly?: boolean;
  interestIds?: number[] | null;
  limit?: number;
  offset?: number;
}

export type AdvancedSearchResult = AuthorCard & { bio: string | null; followers_count: number; is_online: boolean; shared_interests: number };

export async function searchProfilesAdvanced(params: AdvancedSearchParams): Promise<AdvancedSearchResult[]> {
  const { data, error } = await supabase.rpc('search_profiles_advanced', {
    p_query: params.query ?? '',
    p_country: params.country ?? null,
    p_min_age: params.minAge ?? null,
    p_max_age: params.maxAge ?? null,
    p_gender: params.gender ?? null,
    p_online_only: params.onlineOnly ?? false,
    p_verified_only: params.verifiedOnly ?? false,
    p_interest_ids: params.interestIds ?? null,
    p_limit: params.limit ?? 30,
    p_offset: params.offset ?? 0,
  });
  if (error) throw error;
  return rows<AdvancedSearchResult>(data);
}

export function hasPremiumFilters(params: AdvancedSearchParams): boolean {
  return params.minAge != null || params.maxAge != null || Boolean(params.gender) || Boolean(params.onlineOnly) || Boolean(params.interestIds && params.interestIds.length > 0);
}
