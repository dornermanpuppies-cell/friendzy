import { supabase } from '@/lib/supabase';
import type { PresenceInfo } from '@/types/database';

/** Marks the current user as online/offline (respects their privacy settings when read by others). */
export async function touchPresence(online = true): Promise<void> {
  const { error } = await supabase.rpc('touch_presence', { p_online: online });
  if (error) console.warn('[presence] touch failed', error.message);
}

export async function getPresence(userIds: string[]): Promise<Map<string, PresenceInfo>> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await supabase.rpc('get_presence', { p_user_ids: userIds });
  if (error) throw error;
  return new Map(((data ?? []) as PresenceInfo[]).map((p) => [p.user_id, p]));
}
