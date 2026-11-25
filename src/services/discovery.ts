import * as Location from 'expo-location';

import { supabase } from '@/lib/supabase';
import type { Json, ProfileCard } from '@/types/database';
import type { MatchCandidate, NearbyPerson } from '@/types/social';
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

export async function getMatchCandidate(): Promise<MatchCandidate | null> {
  const { data, error } = await supabase.rpc('get_match_candidate');
  if (error) throw error;
  return (data as unknown as MatchCandidate | null) ?? null;
}

export async function sendMatchAction(candidateId: string, action: 'skip' | 'friend' | 'chat' | 'report' | 'block'): Promise<{ friend_request_id?: string }> {
  const { data, error } = await supabase.rpc('match_action', { p_candidate: candidateId, p_action: action });
  if (error) throw error;
  return (data ?? {}) as unknown as { friend_request_id?: string };
}
