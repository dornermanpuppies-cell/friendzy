import { supabase } from '@/lib/supabase';
import { generateVideoThumbnail } from '@/services/thumbnail';
import { guessMime, objectPath, uploadFile, type UploadProgress } from '@/services/upload';
import type { Json } from '@/types/database';
import type { PostAudience } from '@/types/social';
import type { ChallengeItem, CreatorAnalytics, PlaylistItem, SoundItem, VideoAnalytics, VideoCard, VideoCommentCard, VideoDraft, VideoDraftData, VideoFeedKind, VideoPage } from '@/types/video';

const PAGE = 10;
export const MAX_VIDEO_BYTES = 262_144_000; // matches the `videos` bucket limit (250 MB)
export const MAX_VIDEO_SECONDS = 180;

function rows<T>(data: Json[] | Json | null): T[] {
  return (data ?? []) as unknown as T[];
}

// ---------------------------------------------------------------------------
// Upload & publish
// ---------------------------------------------------------------------------
export interface UploadedVideo {
  mediaUrl: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}

/** Uploads the clip (and a cover frame) to the `videos` bucket with progress. */
export async function uploadVideoMedia(
  userId: string,
  uri: string,
  options: { mime?: string; coverTimeMs?: number; coverUri?: string | null; onProgress?: (p: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<UploadedVideo> {
  const mime = options.mime ?? guessMime(uri, 'video/mp4');
  const media = await uploadFile({ bucket: 'videos', path: objectPath(userId, 'video', mime), uri, contentType: mime, maxBytes: MAX_VIDEO_BYTES, onProgress: options.onProgress, signal: options.signal });
  let thumbnailUrl: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  try {
    const thumb = options.coverUri ? { uri: options.coverUri, width: null, height: null } : await generateVideoThumbnail(uri, options.coverTimeMs ?? 500);
    if (thumb) {
      width = (thumb as { width?: number | null }).width ?? null;
      height = (thumb as { height?: number | null }).height ?? null;
      const cover = await uploadFile({ bucket: 'videos', path: objectPath(userId, 'cover', 'image/jpeg'), uri: thumb.uri, contentType: 'image/jpeg', maxBytes: 5_000_000 });
      thumbnailUrl = cover.publicUrl;
    }
  } catch {
    /* a missing cover never blocks publishing */
  }
  return { mediaUrl: media.publicUrl, thumbnailUrl, width, height };
}

export interface PublishVideoInput extends Omit<VideoDraftData, 'uri' | 'mime' | 'cover_time_ms'> {
  media_url: string;
  thumbnail_url: string | null;
}

export async function createVideo(input: PublishVideoInput): Promise<VideoCard> {
  const { data, error } = await supabase.rpc('create_video', {
    p_media_url: input.media_url,
    p_thumbnail_url: input.thumbnail_url,
    p_caption: input.caption || null,
    p_width: input.width ?? null,
    p_height: input.height ?? null,
    p_duration_ms: input.duration_ms ?? null,
    p_audience: input.audience,
    p_allow_comments: input.allow_comments,
    p_allow_duet: input.allow_duet,
    p_allow_stitch: input.allow_stitch,
    p_allow_download: input.allow_download,
    p_sound_id: input.sound_id,
    p_sound_volume: input.sound_volume,
    p_original_volume: input.original_volume,
    p_trim_start_ms: input.trim_start_ms,
    p_trim_end_ms: input.trim_end_ms,
    p_playback_rate: input.playback_rate,
    p_overlays: input.overlays as unknown as Json,
    p_filter: input.filter,
    p_duet_of: input.duet_of ?? null,
    p_stitch_of: input.stitch_of ?? null,
    p_stitch_start_ms: input.stitch_start_ms ?? null,
    p_stitch_end_ms: input.stitch_end_ms ?? null,
    p_reply_to_comment_id: input.reply_to_comment_id ?? null,
    p_create_original_sound: !input.sound_id,
  });
  if (error) throw error;
  return data as unknown as VideoCard;
}

export async function updateVideo(id: string, patch: { caption?: string | null; audience?: PostAudience; allow_comments?: boolean; allow_duet?: boolean; allow_stitch?: boolean; allow_download?: boolean; thumbnail_url?: string | null }): Promise<VideoCard> {
  const { data, error } = await supabase.rpc('update_video', {
    p_id: id,
    p_caption: patch.caption ?? null,
    p_audience: patch.audience ?? null,
    p_allow_comments: patch.allow_comments ?? null,
    p_allow_duet: patch.allow_duet ?? null,
    p_allow_stitch: patch.allow_stitch ?? null,
    p_allow_download: patch.allow_download ?? null,
    p_thumbnail_url: patch.thumbnail_url ?? null,
  });
  if (error) throw error;
  return data as unknown as VideoCard;
}

export async function deleteVideo(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_video', { p_id: id });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Feeds & lookups
// ---------------------------------------------------------------------------
export async function fetchVideoFeed(kind: VideoFeedKind, cursor: string | number | null, limit = PAGE): Promise<VideoPage> {
  if (kind === 'following') {
    const { data, error } = await supabase.rpc('get_video_feed_following', { p_limit: limit, p_before: (cursor as string | null) ?? null });
    if (error) throw error;
    const items = rows<VideoCard>(data);
    return { items, nextCursor: items.length < limit ? null : items[items.length - 1].created_at };
  }
  const offset = typeof cursor === 'number' ? cursor : 0;
  const { data, error } = await supabase.rpc(kind === 'trending' ? 'get_video_feed_trending' : 'get_video_feed_for_you', { p_limit: limit, p_offset: offset });
  if (error) throw error;
  const items = rows<VideoCard>(data);
  return { items, nextCursor: items.length < limit ? null : offset + items.length };
}

export async function getVideo(id: string): Promise<VideoCard> {
  const { data, error } = await supabase.rpc('get_video', { p_id: id });
  if (error) throw error;
  return data as unknown as VideoCard;
}

export async function fetchUserVideos(userId: string, before: string | null, limit = 18): Promise<VideoPage> {
  const { data, error } = await supabase.rpc('get_user_videos', { p_user: userId, p_limit: limit, p_before: before });
  if (error) throw error;
  const items = rows<VideoCard>(data);
  return { items, nextCursor: items.length < limit ? null : items[items.length - 1].created_at };
}

export async function fetchSavedVideos(before: string | null, limit = 18): Promise<VideoPage> {
  const { data, error } = await supabase.rpc('get_saved_videos', { p_limit: limit, p_before: before });
  if (error) throw error;
  const items = rows<VideoCard>(data);
  return { items, nextCursor: items.length < limit ? null : (items[items.length - 1].saved_at ?? null) };
}

export async function fetchHashtagVideos(tag: string, offset: number, limit = 18): Promise<VideoPage> {
  const { data, error } = await supabase.rpc('get_hashtag_videos', { p_tag: tag, p_limit: limit, p_offset: offset });
  if (error) throw error;
  const items = rows<VideoCard>(data);
  return { items, nextCursor: items.length < limit ? null : offset + items.length };
}

export async function fetchSoundVideos(soundId: string, offset: number, limit = 18): Promise<VideoPage> {
  const { data, error } = await supabase.rpc('get_sound_videos', { p_sound: soundId, p_limit: limit, p_offset: offset });
  if (error) throw error;
  const items = rows<VideoCard>(data);
  return { items, nextCursor: items.length < limit ? null : offset + items.length };
}

export async function getVideoDuets(videoId: string, limit = 18): Promise<VideoCard[]> {
  const { data, error } = await supabase.rpc('get_video_duets', { p_video: videoId, p_limit: limit });
  if (error) throw error;
  return rows<VideoCard>(data);
}

export async function searchVideos(query: string, offset = 0, limit = 20): Promise<VideoPage> {
  const { data, error } = await supabase.rpc('search_videos', { p_query: query, p_limit: limit, p_offset: offset });
  if (error) throw error;
  const items = rows<VideoCard>(data);
  return { items, nextCursor: items.length < limit ? null : offset + items.length };
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------
export async function toggleVideoLike(id: string): Promise<{ liked: boolean; likes_count: number }> {
  const { data, error } = await supabase.rpc('toggle_video_like', { p_video: id });
  if (error) throw error;
  return data as unknown as { liked: boolean; likes_count: number };
}

export async function toggleVideoSave(id: string): Promise<{ saved: boolean; saves_count: number }> {
  const { data, error } = await supabase.rpc('toggle_video_save', { p_video: id });
  if (error) throw error;
  return data as unknown as { saved: boolean; saves_count: number };
}

export async function toggleVideoRepost(id: string): Promise<{ reposted: boolean; reposts_count: number }> {
  const { data, error } = await supabase.rpc('toggle_video_repost', { p_video: id });
  if (error) throw error;
  return data as unknown as { reposted: boolean; reposts_count: number };
}

export async function recordVideoShare(id: string): Promise<void> {
  await supabase.rpc('record_video_share', { p_video: id });
}

export async function recordVideoView(id: string, watchedMs: number, completed: boolean): Promise<void> {
  await supabase.rpc('record_video_view', { p_video: id, p_watched_ms: Math.max(0, Math.round(watchedMs)), p_completed: completed });
}

export async function sendVideoFeedback(id: string, kind: 'hide' | 'not_interested'): Promise<void> {
  const { error } = await supabase.rpc('video_feedback', { p_video: id, p_kind: kind });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------
export async function fetchVideoComments(videoId: string, before: string | null, parent: string | null = null, limit = 20): Promise<VideoCommentCard[]> {
  const { data, error } = await supabase.rpc('get_video_comments', { p_video: videoId, p_limit: limit, p_before: before, p_parent: parent });
  if (error) throw error;
  return rows<VideoCommentCard>(data);
}

export async function addVideoComment(videoId: string, text: string, parent: string | null = null): Promise<VideoCommentCard> {
  const { data, error } = await supabase.rpc('add_video_comment', { p_video: videoId, p_text: text, p_parent: parent });
  if (error) throw error;
  return data as unknown as VideoCommentCard;
}

export async function editVideoComment(id: string, text: string): Promise<VideoCommentCard> {
  const { data, error } = await supabase.rpc('edit_video_comment', { p_id: id, p_text: text });
  if (error) throw error;
  return data as unknown as VideoCommentCard;
}

export async function deleteVideoComment(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_video_comment', { p_id: id });
  if (error) throw error;
}

export async function toggleVideoCommentLike(id: string): Promise<{ liked: boolean; likes_count: number }> {
  const { data, error } = await supabase.rpc('toggle_video_comment_like', { p_comment: id });
  if (error) throw error;
  return data as unknown as { liked: boolean; likes_count: number };
}

// ---------------------------------------------------------------------------
// Sounds
// ---------------------------------------------------------------------------
export async function getTrendingSounds(limit = 20, query?: string): Promise<SoundItem[]> {
  const { data, error } = await supabase.rpc('get_trending_sounds', { p_limit: limit, p_query: query?.trim() || null });
  if (error) throw error;
  return rows<SoundItem>(data);
}

export async function getSound(id: string): Promise<SoundItem | null> {
  const { data, error } = await supabase.rpc('get_sound', { p_id: id });
  if (error) throw error;
  return (data as unknown as SoundItem | null) ?? null;
}

export async function uploadSound(userId: string, uri: string, input: { title: string; artist?: string | null; duration_ms?: number | null; license_note?: string | null }, onProgress?: (p: UploadProgress) => void): Promise<SoundItem> {
  const mime = guessMime(uri, 'audio/mp4');
  const uploaded = await uploadFile({ bucket: 'videos', path: objectPath(userId, 'sound', mime), uri, contentType: mime, maxBytes: 25_000_000, onProgress });
  const { data, error } = await supabase.rpc('create_sound', { p_title: input.title, p_url: uploaded.publicUrl, p_artist: input.artist ?? null, p_duration_ms: input.duration_ms ?? null, p_cover_url: null, p_license_note: input.license_note ?? null });
  if (error) throw error;
  return data as unknown as SoundItem;
}

// ---------------------------------------------------------------------------
// Playlists & challenges
// ---------------------------------------------------------------------------
export async function getPlaylists(userId: string): Promise<PlaylistItem[]> {
  const { data, error } = await supabase.rpc('get_playlists', { p_user: userId });
  if (error) throw error;
  return rows<PlaylistItem>(data);
}

export async function getPlaylistVideos(playlistId: string): Promise<VideoCard[]> {
  const { data, error } = await supabase.rpc('get_playlist_videos', { p_playlist: playlistId });
  if (error) throw error;
  return rows<VideoCard>(data);
}

export async function createPlaylist(title: string, description?: string, isPublic = true): Promise<PlaylistItem> {
  const { data, error } = await supabase.rpc('create_playlist', { p_title: title, p_description: description ?? null, p_is_public: isPublic });
  if (error) throw error;
  return data as unknown as PlaylistItem;
}

export async function updatePlaylist(id: string, patch: { title?: string; description?: string | null; is_public?: boolean; add?: string[]; remove?: string[] }): Promise<void> {
  const { error } = await supabase.rpc('update_playlist', { p_id: id, p_title: patch.title ?? null, p_description: patch.description ?? null, p_is_public: patch.is_public ?? null, p_add: patch.add ?? null, p_remove: patch.remove ?? null });
  if (error) throw error;
}

export async function deletePlaylist(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_playlist', { p_id: id });
  if (error) throw error;
}

export async function getChallenges(limit = 20): Promise<ChallengeItem[]> {
  const { data, error } = await supabase.rpc('get_challenges', { p_limit: limit });
  if (error) throw error;
  return rows<ChallengeItem>(data);
}

export async function getChallenge(tag: string): Promise<ChallengeItem | null> {
  const { data, error } = await supabase.rpc('get_challenge', { p_tag: tag });
  if (error) throw error;
  return (data as unknown as ChallengeItem | null) ?? null;
}

export async function createChallenge(input: { tag: string; title: string; description?: string; cover_url?: string | null; ends_at?: string | null }): Promise<ChallengeItem> {
  const { data, error } = await supabase.rpc('create_challenge', { p_tag: input.tag, p_title: input.title, p_description: input.description ?? null, p_cover_url: input.cover_url ?? null, p_ends_at: input.ends_at ?? null });
  if (error) throw error;
  return data as unknown as ChallengeItem;
}

// ---------------------------------------------------------------------------
// Analytics & drafts
// ---------------------------------------------------------------------------
export async function getCreatorAnalytics(days = 28): Promise<CreatorAnalytics> {
  const { data, error } = await supabase.rpc('get_creator_analytics', { p_days: days });
  if (error) throw error;
  return data as unknown as CreatorAnalytics;
}

export async function getVideoAnalytics(videoId: string): Promise<VideoAnalytics | null> {
  const { data, error } = await supabase.rpc('get_video_analytics', { p_video: videoId });
  if (error) throw error;
  return (data as unknown as VideoAnalytics | null) ?? null;
}

export async function listDrafts(userId: string): Promise<VideoDraft[]> {
  const { data, error } = await supabase.from('video_drafts').select('*').eq('user_id', userId).order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((d) => ({ id: d.id, data: d.data as unknown as VideoDraftData, created_at: d.created_at, updated_at: d.updated_at }));
}

export async function saveDraft(userId: string, draft: VideoDraftData, id?: string | null): Promise<string> {
  const payload = draft as unknown as Json;
  if (id) {
    const { error } = await supabase.from('video_drafts').update({ data: payload, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await supabase.from('video_drafts').insert({ user_id: userId, data: payload }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function deleteDraft(id: string): Promise<void> {
  const { error } = await supabase.from('video_drafts').delete().eq('id', id);
  if (error) throw error;
}

export function emptyDraft(overrides: Partial<VideoDraftData> = {}): VideoDraftData {
  return {
    uri: null,
    caption: '',
    audience: 'public',
    allow_comments: true,
    allow_duet: true,
    allow_stitch: true,
    allow_download: false,
    sound_id: null,
    sound_title: null,
    sound_volume: 1,
    original_volume: 1,
    trim_start_ms: 0,
    trim_end_ms: null,
    playback_rate: 1,
    overlays: [],
    filter: 'none',
    cover_time_ms: 500,
    ...overrides,
  };
}
