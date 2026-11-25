import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';
import type { HashtagItem, RecentSearch, SearchResults } from '@/types/social';

function rows<T>(data: Json[] | Json | null): T[] {
  return (data ?? []) as unknown as T[];
}

export async function searchAll(query: string, limit = 8): Promise<SearchResults> {
  const { data, error } = await supabase.rpc('search_all', { p_query: query, p_limit: limit });
  if (error) throw error;
  return (data ?? { users: [], posts: [], hashtags: [] }) as unknown as SearchResults;
}

export async function saveSearch(query: string, kind = 'all'): Promise<void> {
  const { error } = await supabase.rpc('save_search', { p_query: query, p_kind: kind });
  if (error) console.warn('[search] save failed', error.message);
}

export async function getRecentSearches(): Promise<RecentSearch[]> {
  const { data, error } = await supabase.rpc('get_recent_searches');
  if (error) throw error;
  return rows<RecentSearch>(data);
}

export async function clearSearchHistory(id?: number): Promise<void> {
  const { error } = await supabase.rpc('clear_search_history', { p_id: id ?? null });
  if (error) throw error;
}

export async function getTrendingSearches(): Promise<{ query: string; count: number }[]> {
  const { data, error } = await supabase.rpc('get_trending_searches', { p_limit: 10 });
  if (error) throw error;
  return rows(data);
}

export async function getTrendingHashtags(limit = 10): Promise<HashtagItem[]> {
  const { data, error } = await supabase.rpc('get_trending_hashtags', { p_limit: limit });
  if (error) throw error;
  return rows<HashtagItem>(data);
}
