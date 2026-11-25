import type { AuthorCard, PostAudience } from '@/types/social';

export type VideoFeedKind = 'for_you' | 'following' | 'trending';
export type VideoFilter = 'none' | 'warm' | 'cool' | 'mono' | 'vivid' | 'fade' | 'noir';

export const VIDEO_FILTERS: { id: VideoFilter; label: string; tint: string | null; saturation?: number }[] = [
  { id: 'none', label: 'Original', tint: null },
  { id: 'warm', label: 'Warm', tint: 'rgba(255,140,0,0.18)' },
  { id: 'cool', label: 'Cool', tint: 'rgba(39,107,255,0.18)' },
  { id: 'vivid', label: 'Vivid', tint: 'rgba(255,40,185,0.14)' },
  { id: 'fade', label: 'Fade', tint: 'rgba(255,255,255,0.18)' },
  { id: 'mono', label: 'Mono', tint: 'rgba(120,120,120,0.35)' },
  { id: 'noir', label: 'Noir', tint: 'rgba(0,0,0,0.35)' },
];

export interface SoundItem {
  id: string;
  title: string;
  artist: string | null;
  url: string | null;
  cover_url: string | null;
  duration_ms: number | null;
  is_original: boolean;
  uses_count: number;
  origin_video_id: string | null;
  owner: AuthorCard | null;
}

export interface VideoOverlay {
  id: string;
  kind: 'text' | 'sticker';
  text?: string;
  emoji?: string;
  /** Normalised position (0..1) relative to the video frame. */
  x: number;
  y: number;
  scale?: number;
  color?: string;
  background?: string | null;
  start_ms?: number | null;
  end_ms?: number | null;
}

export interface VideoViewerState {
  liked: boolean;
  saved: boolean;
  reposted: boolean;
  following_author: boolean;
  is_author: boolean;
}

export interface VideoCard {
  id: string;
  caption: string | null;
  status: 'processing' | 'ready' | 'failed';
  provider: 'supabase' | 'cloudflare';
  media_url: string | null;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  audience: PostAudience;
  allow_comments: boolean;
  allow_duet: boolean;
  allow_stitch: boolean;
  allow_download: boolean;
  sound: SoundItem | null;
  sound_volume: number;
  original_volume: number;
  trim_start_ms: number;
  trim_end_ms: number | null;
  playback_rate: number;
  overlays: VideoOverlay[];
  filter: VideoFilter | string;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  saves_count: number;
  reposts_count: number;
  views_count: number;
  created_at: string;
  removed: boolean;
  author: AuthorCard;
  hashtags: string[];
  viewer: VideoViewerState;
  duet_of?: VideoCard | { unavailable: true };
  stitch_of?: (VideoCard & { stitch_start_ms: number | null; stitch_end_ms: number | null }) | { unavailable: true };
  reply_to_comment?: { id: string; video_id: string; text: string; author: AuthorCard } | null;
  /** Present in saved / repost listings. */
  saved_at?: string;
  reposted_at?: string;
}

export interface VideoCommentCard {
  id: string;
  video_id: string;
  parent_id: string | null;
  text: string | null;
  removed: boolean;
  likes_count: number;
  replies_count: number;
  created_at: string;
  edited_at: string | null;
  author: AuthorCard;
  reply_video: { id: string; thumbnail_url: string | null } | null;
  viewer: { liked: boolean; is_author: boolean };
}

export interface PlaylistItem {
  id: string;
  title: string;
  description: string | null;
  is_public: boolean;
  owner?: AuthorCard;
  items_count?: number;
  videos_count?: number;
  cover_url?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ChallengeItem {
  id: string;
  tag: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  ends_at: string | null;
  videos_count?: number;
  created_at?: string;
  creator?: AuthorCard | null;
  is_active?: boolean;
}

export interface CreatorAnalytics {
  range_days: number;
  totals: { videos: number; views: number; likes: number; comments: number; shares: number; new_followers: number; followers: number; avg_watch_ms: number; completion_rate: number };
  daily: { day: string; views: number; likes: number; followers: number }[];
  top_videos: VideoCard[];
}

export interface VideoAnalytics {
  video: VideoCard;
  unique_viewers: number;
  avg_watch_ms: number;
  completion_rate: number;
  views_by_day: { day: string; views: number }[];
}

/** Everything the composer needs to resume a draft. Media stays on-device until publish. */
export interface VideoDraftData {
  uri: string | null;
  mime?: string;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  caption: string;
  audience: PostAudience;
  allow_comments: boolean;
  allow_duet: boolean;
  allow_stitch: boolean;
  allow_download: boolean;
  sound_id: string | null;
  sound_title?: string | null;
  sound_volume: number;
  original_volume: number;
  trim_start_ms: number;
  trim_end_ms: number | null;
  playback_rate: number;
  overlays: VideoOverlay[];
  filter: VideoFilter;
  cover_time_ms: number;
  duet_of?: string | null;
  stitch_of?: string | null;
  stitch_start_ms?: number | null;
  stitch_end_ms?: number | null;
  reply_to_comment_id?: string | null;
}

export interface VideoDraft {
  id: string;
  data: VideoDraftData;
  created_at: string;
  updated_at: string;
}

export interface VideoPage {
  items: VideoCard[];
  nextCursor: string | number | null;
}
