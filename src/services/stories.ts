import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';
import type { StoryAudience, StoryCard, StoryHighlight, StoryKind, StorySticker, StoryTrayItem, StoryViewer } from '@/types/social';

function rows<T>(data: Json[] | Json | null): T[] {
  return (data ?? []) as unknown as T[];
}

export async function getStoryTray(): Promise<StoryTrayItem[]> {
  const { data, error } = await supabase.rpc('get_story_tray');
  if (error) throw error;
  return rows<StoryTrayItem>(data);
}

export async function getUserStories(userId: string): Promise<StoryCard[]> {
  const { data, error } = await supabase.rpc('get_user_stories', { p_user: userId });
  if (error) throw error;
  return rows<StoryCard>(data);
}

export interface CreateStoryInput {
  kind: StoryKind;
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  text?: string | null;
  style?: StoryCard['style'];
  stickers?: StorySticker[];
  caption?: string | null;
  musicTitle?: string | null;
  audience?: StoryAudience | null;
  durationMs?: number | null;
}

export async function createStory(input: CreateStoryInput): Promise<StoryCard> {
  const { data, error } = await supabase.rpc('create_story', {
    p_kind: input.kind,
    p_media_url: input.mediaUrl ?? null,
    p_thumbnail_url: input.thumbnailUrl ?? null,
    p_text: input.text ?? null,
    p_style: (input.style ?? {}) as unknown as Json,
    p_stickers: (input.stickers ?? []) as unknown as Json,
    p_caption: input.caption ?? null,
    p_music_title: input.musicTitle ?? null,
    p_audience: input.audience ?? null,
    p_duration_ms: input.durationMs ?? null,
  });
  if (error) throw error;
  return data as unknown as StoryCard;
}

export async function deleteStory(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_story', { p_id: id });
  if (error) throw error;
}

export async function markStoryViewed(id: string): Promise<void> {
  const { error } = await supabase.rpc('mark_story_viewed', { p_story: id });
  if (error) console.warn('[stories] view failed', error.message);
}

export async function reactToStory(id: string, emoji: string | null): Promise<void> {
  const { error } = await supabase.rpc('react_story', { p_story: id, p_emoji: emoji ?? '' });
  if (error) throw error;
}

export async function getStoryViewers(id: string): Promise<StoryViewer[]> {
  const { data, error } = await supabase.rpc('get_story_viewers', { p_story: id, p_limit: 200 });
  if (error) throw error;
  return rows<StoryViewer>(data);
}

export async function getHighlights(userId: string): Promise<StoryHighlight[]> {
  const { data, error } = await supabase.rpc('get_highlights', { p_user: userId });
  if (error) throw error;
  return rows<StoryHighlight>(data);
}

export async function getHighlightStories(highlightId: string): Promise<StoryCard[]> {
  const { data, error } = await supabase.rpc('get_highlight_stories', { p_highlight: highlightId });
  if (error) throw error;
  return rows<StoryCard>(data);
}

export async function getMyArchivedStories(): Promise<StoryCard[]> {
  const { data, error } = await supabase.rpc('get_my_archived_stories', { p_limit: 100 });
  if (error) throw error;
  return rows<StoryCard>(data);
}

export async function createHighlight(title: string, storyIds: string[], coverUrl?: string | null): Promise<{ id: string }> {
  const { data, error } = await supabase.rpc('create_highlight', { p_title: title, p_story_ids: storyIds, p_cover_url: coverUrl ?? null });
  if (error) throw error;
  return data as unknown as { id: string };
}

export async function updateHighlight(id: string, patch: { title?: string; add?: string[]; remove?: string[]; coverUrl?: string | null }): Promise<void> {
  const { error } = await supabase.rpc('update_highlight', {
    p_id: id,
    p_title: patch.title ?? null,
    p_add: patch.add ?? null,
    p_remove: patch.remove ?? null,
    p_cover_url: patch.coverUrl ?? null,
  });
  if (error) throw error;
}

export async function deleteHighlight(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_highlight', { p_id: id });
  if (error) throw error;
}

export const STORY_BACKGROUNDS: { id: string; colors: [string, string] }[] = [
  { id: 'violet', colors: ['#7000FF', '#FF28B9'] },
  { id: 'ocean', colors: ['#276BFF', '#7000FF'] },
  { id: 'sunset', colors: ['#FF7A59', '#FF28B9'] },
  { id: 'mint', colors: ['#00C9A7', '#276BFF'] },
  { id: 'night', colors: ['#1B0B3E', '#090817'] },
  { id: 'gold', colors: ['#FFC857', '#FF7A59'] },
  { id: 'rose', colors: ['#FF28B9', '#FF7AD1'] },
  { id: 'slate', colors: ['#3D3850', '#171326'] },
];
