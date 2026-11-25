import type { ProfileCard } from '@/types/database';

export type PostType = 'text' | 'photo' | 'video' | 'carousel' | 'poll' | 'question' | 'share';
export type PostAudience = 'public' | 'followers' | 'friends';
export type ReactionType = 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'fire';
export type MediaKind = 'image' | 'video' | 'audio' | 'document';
export type StoryKind = 'image' | 'video' | 'text';
export type StoryAudience = 'everyone' | 'followers' | 'friends';

export interface AuthorCard {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_verified: boolean;
  is_private: boolean;
  country_code: string | null;
  is_premium?: boolean;
}

export interface PostMediaItem {
  id: string;
  kind: MediaKind;
  url: string;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  alt_text: string | null;
}

export interface PollOption {
  id: string;
  text: string;
  votes_count: number;
}

export interface PostPoll {
  multiple: boolean;
  ends_at: string | null;
  total_votes: number;
  ended: boolean;
  options: PollOption[];
  my_votes: string[];
}

export interface PostViewerState {
  reaction: ReactionType | null;
  saved: boolean;
  reposted: boolean;
  following_author: boolean;
  is_author: boolean;
}

export interface PostCard {
  id: string;
  type: PostType;
  text: string | null;
  audience: PostAudience;
  allow_comments: boolean;
  location_name: string | null;
  likes_count: number;
  comments_count: number;
  reposts_count: number;
  saves_count: number;
  views_count: number;
  created_at: string;
  edited_at: string | null;
  removed: boolean;
  author: AuthorCard;
  media: PostMediaItem[];
  hashtags: string[];
  viewer: PostViewerState;
  poll?: PostPoll | null;
  shared_post?: (PostCard & { unavailable?: false }) | { unavailable: true } | null;
  /** Present on nearby feed results. */
  distance_km?: number;
  /** Present on repost listings. */
  reposted_at?: string;
  reposted_by?: AuthorCard;
  saved_at?: string;
}

export interface CommentCard {
  id: string;
  post_id: string;
  parent_id: string | null;
  text: string | null;
  removed: boolean;
  media_url: string | null;
  likes_count: number;
  replies_count: number;
  created_at: string;
  edited_at: string | null;
  author: AuthorCard;
  viewer: { reaction: ReactionType | null; is_author: boolean };
}

export interface StoryCard {
  id: string;
  kind: StoryKind;
  media_url: string | null;
  thumbnail_url: string | null;
  text: string | null;
  style: { bg?: string; bg2?: string; font?: 'display' | 'body' | 'mono'; align?: 'left' | 'center' | 'right'; color?: string };
  stickers: StorySticker[];
  caption: string | null;
  music_title: string | null;
  audience: StoryAudience;
  duration_ms: number | null;
  views_count: number;
  created_at: string;
  expires_at: string;
  author: AuthorCard;
  viewer: { seen: boolean; reaction: string | null; is_author: boolean };
}

export interface StorySticker {
  id: string;
  emoji: string;
  /** 0..1 relative position */
  x: number;
  y: number;
  scale: number;
}

export interface StoryTrayItem {
  author: AuthorCard;
  story_count: number;
  latest_at: string;
  has_unseen: boolean;
  preview_url: string | null;
  is_self: boolean;
}

export interface StoryViewer {
  user: AuthorCard;
  viewed_at: string;
  reaction: string | null;
}

export interface StoryHighlight {
  id: string;
  title: string;
  position: number;
  cover_url: string | null;
  count: number;
}

export interface HashtagItem {
  tag: string;
  posts_count: number;
  videos_count?: number;
  recent_count?: number;
}

export interface NearbyPerson {
  profile: ProfileCard;
  distance_km: number;
  city: string | null;
  is_online: boolean | null;
}

export interface MatchCandidate {
  profile: ProfileCard;
  shared_interests: number;
  interests: { id: number; name: string; emoji: string | null }[];
  looking_for: string[];
}

export interface SearchResults {
  users: ProfileCard[];
  posts: PostCard[];
  hashtags: HashtagItem[];
}

export interface RecentSearch {
  id: number;
  query: string;
  kind: string;
  created_at: string;
}

export type FeedKind = 'for_you' | 'following' | 'nearby' | 'trending';

export const REACTIONS: { type: ReactionType; emoji: string; label: string }[] = [
  { type: 'like', emoji: '👍', label: 'Like' },
  { type: 'love', emoji: '❤️', label: 'Love' },
  { type: 'haha', emoji: '😂', label: 'Haha' },
  { type: 'wow', emoji: '😮', label: 'Wow' },
  { type: 'sad', emoji: '😢', label: 'Sad' },
  { type: 'fire', emoji: '🔥', label: 'Fire' },
];

export function reactionEmoji(type: ReactionType | null | undefined): string {
  return REACTIONS.find((r) => r.type === type)?.emoji ?? '👍';
}
