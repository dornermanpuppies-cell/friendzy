import { privateChannel } from '@/lib/realtime';
import { supabase } from '@/lib/supabase';
import { objectPath, prepareImage, uploadFile, type UploadProgress } from '@/services/upload';
import { generateVideoThumbnail } from '@/services/thumbnail';
import type { Json } from '@/types/database';
import type { CommentCard, FeedKind, HashtagItem, PostAudience, PostCard, PostPoll, PostType, ReactionType } from '@/types/social';

const PAGE = 20;

function rows<T>(data: Json[] | Json | null): T[] {
  return (data ?? []) as unknown as T[];
}

export interface FeedPage {
  items: PostCard[];
  /** Cursor for the next page: ISO timestamp (following) or offset (others). */
  nextCursor: string | number | null;
}

export async function fetchFeed(kind: FeedKind, cursor: string | number | null, limit = PAGE): Promise<FeedPage> {
  if (kind === 'following') {
    const { data, error } = await supabase.rpc('get_feed_following', { p_limit: limit, p_before: (cursor as string | null) ?? null });
    if (error) throw error;
    const items = rows<PostCard>(data);
    return { items, nextCursor: items.length < limit ? null : items[items.length - 1].created_at };
  }
  const offset = typeof cursor === 'number' ? cursor : 0;
  const fn = kind === 'for_you' ? 'get_feed_for_you' : kind === 'trending' ? 'get_feed_trending' : 'get_feed_nearby';
  const { data, error } = await supabase.rpc(fn, { p_limit: limit, p_offset: offset });
  if (error) throw error;
  const items = rows<PostCard>(data);
  return { items, nextCursor: items.length < limit ? null : offset + items.length };
}

export async function fetchUserPosts(userId: string, kind: 'posts' | 'photos' | 'videos' | 'polls', before: string | null, limit = PAGE): Promise<FeedPage> {
  const { data, error } = await supabase.rpc('get_user_posts', { p_user: userId, p_kind: kind, p_limit: limit, p_before: before });
  if (error) throw error;
  const items = rows<PostCard>(data);
  return { items, nextCursor: items.length < limit ? null : items[items.length - 1].created_at };
}

export async function fetchUserReposts(userId: string, before: string | null, limit = PAGE): Promise<FeedPage> {
  const { data, error } = await supabase.rpc('get_user_reposts', { p_user: userId, p_limit: limit, p_before: before });
  if (error) throw error;
  const items = rows<PostCard>(data);
  return { items, nextCursor: items.length < limit ? null : items[items.length - 1].reposted_at ?? null };
}

export async function fetchSavedPosts(before: string | null, limit = PAGE): Promise<FeedPage> {
  const { data, error } = await supabase.rpc('get_saved_posts', { p_limit: limit, p_before: before });
  if (error) throw error;
  const items = rows<PostCard>(data);
  return { items, nextCursor: items.length < limit ? null : items[items.length - 1].saved_at ?? null };
}

export async function fetchHashtagPosts(tag: string, before: string | null, limit = PAGE): Promise<FeedPage> {
  const { data, error } = await supabase.rpc('get_hashtag_posts', { p_tag: tag, p_limit: limit, p_before: before });
  if (error) throw error;
  const items = rows<PostCard>(data);
  return { items, nextCursor: items.length < limit ? null : items[items.length - 1].created_at };
}

export async function searchPosts(query: string, offset: number, limit = PAGE): Promise<FeedPage> {
  const { data, error } = await supabase.rpc('search_posts', { p_query: query, p_limit: limit, p_offset: offset });
  if (error) throw error;
  const items = rows<PostCard>(data);
  return { items, nextCursor: items.length < limit ? null : offset + items.length };
}

export async function getPost(id: string): Promise<PostCard> {
  const { data, error } = await supabase.rpc('get_post', { p_id: id });
  if (error) throw error;
  return data as unknown as PostCard;
}

export interface LocalMedia {
  uri: string;
  kind: 'image' | 'video';
  mime: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface UploadedMedia {
  url: string;
  kind: 'image' | 'video';
  thumbnail_url?: string | null;
  width?: number;
  height?: number;
  duration_ms?: number;
}

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

/** Compresses (images), generates thumbnails (videos) and uploads one media item to the given bucket. */
export async function uploadMediaItem(
  userId: string,
  bucket: 'posts' | 'stories' | 'chat' | 'videos',
  item: LocalMedia,
  onProgress?: (p: UploadProgress) => void,
): Promise<UploadedMedia> {
  if (item.kind === 'image') {
    const prepared = await prepareImage(item.uri);
    const result = await uploadFile({
      bucket,
      path: objectPath(userId, 'img', prepared.mime),
      uri: prepared.uri,
      contentType: prepared.mime,
      onProgress,
      maxBytes: MAX_IMAGE_BYTES,
    });
    return { url: result.publicUrl, kind: 'image', width: prepared.width, height: prepared.height };
  }
  const mime = item.mime || 'video/mp4';
  let thumbnailUrl: string | null = null;
  const thumb = await generateVideoThumbnail(item.uri, 500);
  if (thumb) {
    try {
      const prepared = await prepareImage(thumb.uri, { maxDimension: 1080, quality: 0.8 });
      const up = await uploadFile({ bucket, path: objectPath(userId, 'thumb', prepared.mime), uri: prepared.uri, contentType: prepared.mime });
      thumbnailUrl = up.publicUrl;
    } catch (error) {
      console.warn('[posts] thumbnail upload failed', error);
    }
  }
  const result = await uploadFile({ bucket, path: objectPath(userId, 'vid', mime), uri: item.uri, contentType: mime, onProgress, maxBytes: MAX_VIDEO_BYTES });
  return { url: result.publicUrl, kind: 'video', thumbnail_url: thumbnailUrl, width: item.width, height: item.height, duration_ms: item.durationMs };
}

export interface CreatePostInput {
  type: PostType;
  text?: string;
  audience?: PostAudience;
  allowComments?: boolean;
  media?: UploadedMedia[];
  poll?: { options: string[]; multiple?: boolean; durationHours?: number | null };
  sharedPostId?: string;
  locationName?: string;
}

export async function createPost(input: CreatePostInput): Promise<PostCard> {
  const { data, error } = await supabase.rpc('create_post', {
    p_type: input.type,
    p_text: input.text ?? null,
    p_audience: input.audience ?? 'public',
    p_allow_comments: input.allowComments ?? true,
    p_media: (input.media ?? []) as unknown as Json,
    p_poll: input.poll
      ? ({ options: input.poll.options, multiple: input.poll.multiple ?? false, duration_hours: input.poll.durationHours ?? null } as unknown as Json)
      : null,
    p_shared_post_id: input.sharedPostId ?? null,
    p_location_name: input.locationName ?? null,
  });
  if (error) throw error;
  return data as unknown as PostCard;
}

export async function editPost(id: string, patch: { text: string; audience?: PostAudience; allowComments?: boolean }): Promise<PostCard> {
  const { data, error } = await supabase.rpc('edit_post', { p_id: id, p_text: patch.text, p_audience: patch.audience ?? null, p_allow_comments: patch.allowComments ?? null });
  if (error) throw error;
  return data as unknown as PostCard;
}

export async function deletePost(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_post', { p_id: id });
  if (error) throw error;
}

export async function togglePostReaction(postId: string, reaction: ReactionType | null): Promise<{ reaction: ReactionType | null; likes_count: number }> {
  const { data, error } = await supabase.rpc('toggle_post_reaction', { p_post: postId, p_reaction: reaction });
  if (error) throw error;
  return data as unknown as { reaction: ReactionType | null; likes_count: number };
}

export async function getPostReactions(postId: string, offset = 0): Promise<{ user: PostCard['author']; reaction: ReactionType; created_at: string }[]> {
  const { data, error } = await supabase.rpc('get_post_reactions', { p_post: postId, p_limit: 50, p_offset: offset });
  if (error) throw error;
  return rows(data);
}

export async function toggleRepost(postId: string): Promise<{ reposted: boolean; reposts_count: number }> {
  const { data, error } = await supabase.rpc('toggle_repost', { p_post: postId });
  if (error) throw error;
  return data as unknown as { reposted: boolean; reposts_count: number };
}

export async function toggleSave(postId: string): Promise<{ saved: boolean }> {
  const { data, error } = await supabase.rpc('toggle_save_post', { p_post: postId });
  if (error) throw error;
  return data as unknown as { saved: boolean };
}

export async function sendFeedFeedback(postId: string, kind: 'hide' | 'not_interested'): Promise<void> {
  const { error } = await supabase.rpc('feed_feedback', { p_post: postId, p_kind: kind });
  if (error) throw error;
}

export async function undoFeedFeedback(postId: string): Promise<void> {
  const { error } = await supabase.rpc('undo_feed_feedback', { p_post: postId });
  if (error) throw error;
}

let impressionBuffer = new Set<string>();
let impressionTimer: ReturnType<typeof setTimeout> | null = null;

/** Batches "seen" events so the feed can avoid repeating content. */
export function queueImpression(postId: string) {
  impressionBuffer.add(postId);
  if (impressionTimer) return;
  impressionTimer = setTimeout(() => {
    const ids = Array.from(impressionBuffer);
    impressionBuffer = new Set();
    impressionTimer = null;
    if (ids.length) supabase.rpc('record_impressions', { p_post_ids: ids }).then(({ error }) => error && console.warn('[impressions]', error.message));
  }, 2500);
}

export async function votePoll(postId: string, optionIds: string[]): Promise<PostPoll> {
  const { data, error } = await supabase.rpc('vote_poll', { p_post: postId, p_option_ids: optionIds });
  if (error) throw error;
  return data as unknown as PostPoll;
}

export async function fetchComments(postId: string, before: string | null, parentId: string | null = null, limit = 20): Promise<CommentCard[]> {
  const { data, error } = await supabase.rpc('get_comments', { p_post: postId, p_limit: limit, p_before: before, p_parent: parentId });
  if (error) throw error;
  return rows<CommentCard>(data);
}

export async function addComment(postId: string, text: string, parentId?: string | null, mediaUrl?: string | null): Promise<CommentCard> {
  const { data, error } = await supabase.rpc('add_comment', { p_post: postId, p_text: text, p_parent: parentId ?? null, p_media_url: mediaUrl ?? null });
  if (error) throw error;
  return data as unknown as CommentCard;
}

export async function editComment(id: string, text: string): Promise<CommentCard> {
  const { data, error } = await supabase.rpc('edit_comment', { p_id: id, p_text: text });
  if (error) throw error;
  return data as unknown as CommentCard;
}

export async function deleteComment(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_comment', { p_id: id });
  if (error) throw error;
}

export async function toggleCommentReaction(commentId: string, reaction: ReactionType | null): Promise<{ reaction: ReactionType | null; likes_count: number }> {
  const { data, error } = await supabase.rpc('toggle_comment_reaction', { p_comment: commentId, p_reaction: reaction });
  if (error) throw error;
  return data as unknown as { reaction: ReactionType | null; likes_count: number };
}

export async function getTrendingHashtags(limit = 10): Promise<HashtagItem[]> {
  const { data, error } = await supabase.rpc('get_trending_hashtags', { p_limit: limit });
  if (error) throw error;
  return rows<HashtagItem>(data);
}

/** Subscribes to new top-level comments / replies on a post. */
export function subscribeToComments(postId: string, onInsert: (commentId: string) => void): () => void {
  const channel = privateChannel(`comments:${postId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` }, (payload) => {
      onInsert((payload.new as { id: string }).id);
    })
    .subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => undefined);
  };
}
