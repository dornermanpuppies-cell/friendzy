import { supabase } from '@/lib/supabase';
import type { Announcement, Banner, FeaturedCreator, TrendingTopic } from '@/types/admin';
import type { Json } from '@/types/database';

function rows<T>(data: Json[] | Json | null): T[] {
  return (data ?? []) as unknown as T[];
}

export async function getActiveAnnouncements(): Promise<Announcement[]> {
  const { data, error } = await supabase.rpc('get_active_announcements');
  if (error) throw error;
  return rows<Announcement>(data);
}

export async function dismissAnnouncement(id: string): Promise<void> {
  await supabase.rpc('dismiss_announcement', { p_id: id });
}

export async function getBanners(placement: Banner['placement']): Promise<Banner[]> {
  const { data, error } = await supabase.rpc('get_banners', { p_placement: placement });
  if (error) throw error;
  return rows<Banner>(data);
}

export async function getFeaturedCreators(limit = 20): Promise<FeaturedCreator[]> {
  const { data, error } = await supabase.rpc('get_featured_creators', { p_limit: limit });
  if (error) throw error;
  return rows<FeaturedCreator>(data);
}

export async function getTrendingTopics(limit = 12): Promise<TrendingTopic[]> {
  const { data, error } = await supabase.rpc('get_trending_topics', { p_limit: limit });
  if (error) throw error;
  return rows<TrendingTopic>(data);
}

export async function getMySanctions(): Promise<{ id: string; kind: string; feature: string | null; reason: string; starts_at: string; ends_at: string | null; created_at: string }[]> {
  const { data, error } = await supabase.rpc('get_my_sanctions');
  if (error) throw error;
  return rows(data);
}
