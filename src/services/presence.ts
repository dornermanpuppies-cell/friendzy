import { supabase } from '@/lib/supabase';
import type { PresenceInfo } from '@/types/database';
import type { PresenceActivity } from '@/types/social';

/**
 * Marks the current user as online/offline. Pass `activity` to also set (or
 * clear with null) what they are doing; omit it to leave the activity as is.
 * Others only see the activity when the owner enabled "Show what I'm doing".
 */
export async function touchPresence(online = true, activity?: PresenceActivity | null): Promise<void> {
  const args = activity === undefined ? { p_online: online } : { p_online: online, p_activity: activity, p_set_activity: true };
  const { error } = await supabase.rpc('touch_presence', args);
  if (error) console.warn('[presence] touch failed', error.message);
}

/** Sets or clears the current activity (kept alive for ~3 minutes per call). */
export async function setPresenceActivity(activity: PresenceActivity | null): Promise<void> {
  await touchPresence(true, activity);
}

export async function getPresence(userIds: string[]): Promise<Map<string, PresenceInfo>> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await supabase.rpc('get_presence', { p_user_ids: userIds });
  if (error) throw error;
  return new Map(((data ?? []) as PresenceInfo[]).map((p) => [p.user_id, p]));
}
