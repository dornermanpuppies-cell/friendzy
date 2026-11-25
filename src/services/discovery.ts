import type { RealtimeChannel } from '@supabase/supabase-js';
import * as Location from 'expo-location';

import { supabase } from '@/lib/supabase';
import type { Json, ProfileCard } from '@/types/database';
import type { DiscoverCard, DiscoverSection, MatchActionKind, MatchActionResult, MatchCandidate, MatchFindResult, NearbyPerson, PeopleSearchParams } from '@/types/social';
import { AppError } from '@/utils/errors';

function rows<T>(data: Json[] | Json | null): T[] {
  return (data ?? []) as unknown as T[];
}

/**
 * Asks for foreground location permission, reads a coarse position and stores
 * it server-side at ~1 km precision. Exact coordinates never leave the device
 * beyond this rounded value.
 */
export async function refreshMyApproximateLocation(): Promise<{ lat: number; lng: number } | null> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new AppError('Location permission is needed to show people nearby. You can enable it in your device settings.', 'permission_denied');
  }
  const position =
    (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 })) ??
    (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
  if (!position) return null;
  const lat = Math.round(position.coords.latitude * 100) / 100;
  const lng = Math.round(position.coords.longitude * 100) / 100;
  let city: string | null = null;
  try {
    const places = await Location.reverseGeocodeAsync({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    city = places[0]?.city ?? places[0]?.region ?? null;
  } catch {
    /* geocoding is best-effort */
  }
  const { error } = await supabase.rpc('update_my_location', { p_lat: lat, p_lng: lng, p_city: city });
  if (error) throw error;
  return { lat, lng };
}

export async function clearMyLocation(): Promise<void> {
  const { error } = await supabase.rpc('clear_my_location');
  if (error) throw error;
}

export async function getNearbyPeople(radiusKm = 50, limit = 30): Promise<NearbyPerson[]> {
  const { data, error } = await supabase.rpc('get_nearby_people', { p_limit: limit, p_radius_km: radiusKm });
  if (error) throw error;
  return rows<NearbyPerson>(data);
}

export async function getOnlinePeople(limit = 30): Promise<ProfileCard[]> {
  const { data, error } = await supabase.rpc('get_online_people', { p_limit: limit });
  if (error) throw error;
  return rows<ProfileCard>(data);
}

// ---------------------------------------------------------------------------
// Discover sections & worldwide people search (Phase 13)
// ---------------------------------------------------------------------------

export const DISCOVER_PAGE_SIZE = 20;

/** One page of a Discover section. Results already respect everyone's privacy settings. */
export async function discoverPeople(section: DiscoverSection, options: { limit?: number; offset?: number; radiusKm?: number } = {}): Promise<DiscoverCard[]> {
  const { data, error } = await supabase.rpc('discover_people', {
    p_section: section,
    p_limit: options.limit ?? DISCOVER_PAGE_SIZE,
    p_offset: options.offset ?? 0,
    p_radius_km: options.radiusKm ?? 50,
  });
  if (error) throw error;
  return rows<DiscoverCard>(data);
}

/** Worldwide people search. Age range is a Premium filter (the server enforces it). */
export async function searchPeople(params: PeopleSearchParams): Promise<DiscoverCard[]> {
  const { data, error } = await supabase.rpc('search_people', {
    p_query: params.query ?? '',
    p_country: params.country ?? null,
    p_city: params.city ?? null,
    p_gender: params.gender ?? null,
    p_interest_ids: params.interestIds && params.interestIds.length ? params.interestIds : null,
    p_languages: params.languages && params.languages.length ? params.languages : null,
    p_online_only: params.onlineOnly ?? false,
    p_min_age: params.minAge ?? null,
    p_max_age: params.maxAge ?? null,
    p_sort: params.sort ?? 'relevance',
    p_limit: params.limit ?? DISCOVER_PAGE_SIZE,
    p_offset: params.offset ?? 0,
  });
  if (error) throw error;
  return rows<DiscoverCard>(data);
}

export function hasAnyPeopleFilter(params: PeopleSearchParams): boolean {
  return Boolean(
    (params.query ?? '').trim() ||
      params.country ||
      (params.city ?? '').trim() ||
      params.gender ||
      (params.interestIds && params.interestIds.length) ||
      (params.languages && params.languages.length) ||
      params.onlineOnly ||
      params.minAge != null ||
      params.maxAge != null,
  );
}

export function hasPremiumPeopleFilter(params: PeopleSearchParams): boolean {
  return params.minAge != null || params.maxAge != null;
}

/** Full discovery card for one profile (null when the profile is not viewable). */
export async function getDiscoverCard(userId: string): Promise<DiscoverCard | null> {
  const { data, error } = await supabase.rpc('get_discover_card', { p_user: userId });
  if (error) throw error;
  return (data as unknown as DiscoverCard | null) ?? null;
}

// ---------------------------------------------------------------------------
// MEET SOMEONE — live matching
// ---------------------------------------------------------------------------

/** Joins/keeps the live matching queue and returns the current state. Poll every few seconds while searching. */
export async function matchFind(): Promise<MatchFindResult> {
  const { data, error } = await supabase.rpc('match_find');
  if (error) throw error;
  return data as unknown as MatchFindResult;
}

/** Leaves the queue (safe to call when not queued). */
export async function matchLeave(): Promise<void> {
  const { error } = await supabase.rpc('match_leave');
  if (error) throw error;
}

/** Legacy one-shot candidate picker (kept for older clients). */
export async function getMatchCandidate(): Promise<MatchCandidate | null> {
  const { data, error } = await supabase.rpc('get_match_candidate');
  if (error) throw error;
  return (data as unknown as MatchCandidate | null) ?? null;
}

/**
 * Acts on the shown person. 'chat' opens (or reuses) a direct conversation and
 * returns its id — nothing else is started automatically.
 */
export async function sendMatchAction(candidateId: string, action: MatchActionKind): Promise<MatchActionResult> {
  const { data, error } = await supabase.rpc('match_action', { p_candidate: candidateId, p_action: action });
  if (error) throw error;
  return (data ?? {}) as unknown as MatchActionResult;
}

/** Fires when my queue row changes (e.g. someone matched with me). Returns an unsubscribe function. */
export function subscribeToMatchQueue(userId: string, onChange: () => void): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`match_queue:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'match_queue', filter: `user_id=eq.${userId}` }, () => onChange())
    .subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => undefined);
  };
}
