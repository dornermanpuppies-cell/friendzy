import { FALLBACK_INTERESTS, type InterestItem } from '@/constants/interests';
import { supabase } from '@/lib/supabase';

let cache: InterestItem[] | null = null;

export async function listInterests(): Promise<InterestItem[]> {
  if (cache) return cache;
  const { data, error } = await supabase
    .from('interests')
    .select('id, slug, name, emoji, category, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error || !data?.length) {
    if (error) console.warn('[interests] falling back to bundled catalogue', error.message);
    return FALLBACK_INTERESTS;
  }
  cache = data;
  return data;
}

export async function getUserInterestIds(userId: string): Promise<number[]> {
  const { data, error } = await supabase.from('user_interests').select('interest_id').eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).map((r) => r.interest_id);
}

export async function getUserInterests(userId: string): Promise<InterestItem[]> {
  const [all, ids] = await Promise.all([listInterests(), getUserInterestIds(userId)]);
  const set = new Set(ids);
  return all.filter((i) => set.has(i.id));
}

/** Replaces the user's interests with the given set (max 10, enforced server-side too). */
export async function setUserInterests(userId: string, interestIds: number[]): Promise<void> {
  const unique = Array.from(new Set(interestIds.filter((id) => id > 0))).slice(0, 10);
  const current = await getUserInterestIds(userId);
  const toRemove = current.filter((id) => !unique.includes(id));
  const toAdd = unique.filter((id) => !current.includes(id));

  if (toRemove.length) {
    const { error } = await supabase.from('user_interests').delete().eq('user_id', userId).in('interest_id', toRemove);
    if (error) throw error;
  }
  if (toAdd.length) {
    const { error } = await supabase
      .from('user_interests')
      .insert(toAdd.map((interest_id) => ({ user_id: userId, interest_id })));
    if (error) throw error;
  }
}

export function groupInterestsByCategory(items: InterestItem[]): { category: string; items: InterestItem[] }[] {
  const map = new Map<string, InterestItem[]>();
  for (const item of items) {
    const list = map.get(item.category) ?? [];
    list.push(item);
    map.set(item.category, list);
  }
  return Array.from(map.entries()).map(([category, list]) => ({ category, items: list }));
}
