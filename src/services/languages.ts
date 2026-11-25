import { MAX_LANGUAGES } from '@/constants/languages';
import { supabase } from '@/lib/supabase';

/** Languages a person speaks (empty when they hide them — enforced by RLS). */
export async function getUserLanguages(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from('user_languages').select('code, created_at').eq('user_id', userId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => r.code);
}

/** Replaces my spoken languages (max 6, enforced server-side too). */
export async function setMyLanguages(userId: string, codes: string[]): Promise<void> {
  const unique = Array.from(new Set(codes.map((c) => c.toLowerCase()).filter((c) => /^[a-z]{2,3}$/.test(c)))).slice(0, MAX_LANGUAGES);
  const current = await getUserLanguages(userId);
  const toRemove = current.filter((c) => !unique.includes(c));
  const toAdd = unique.filter((c) => !current.includes(c));
  if (toRemove.length) {
    const { error } = await supabase.from('user_languages').delete().eq('user_id', userId).in('code', toRemove);
    if (error) throw error;
  }
  if (toAdd.length) {
    const { error } = await supabase.from('user_languages').insert(toAdd.map((code) => ({ user_id: userId, code })));
    if (error) throw error;
  }
}
