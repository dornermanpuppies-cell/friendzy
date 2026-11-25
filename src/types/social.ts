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

export type PresenceActivity = 'chatting' | 'live' | 'gaming';

export interface CardPresence {
  /** null when the person hides their online status. */
  is_online: boolean | null;
  /** null when the person hides their last-seen time. */
  last_seen_at: string | null;
  /** Only present when the person opted in to sharing what they are doing. */
  activity: PresenceActivity | null;
}

export interface CardRelationship {
  is_following: boolean;
  is_followed_by: boolean;
  follow_requested: boolean;
  is_friend: boolean;
  is_blocking: boolean;
  friend_request: { id: string; direction: 'incoming' | 'outgoing'; created_at: string } | null;
}

export interface CardInterest {
  id: number;
  name: string;
  emoji: string | null;
  /** True when the viewer shares this interest. */
  shared: boolean;
}

/**
 * Rich discovery profile returned by `discover_people`, `search_people`,
 * `get_friends_list`, `get_mutual_friends`, `match_find` and `get_discover_card`.
 * Every field already respects the owner's privacy settings (server-side).
 */
export interface DiscoverCard extends AuthorCard {
  bio: string | null;
  /** null when hidden by the owner. */
  city: string | null;
  /** Only present when the owner is an adult who chose to show their age. */
  age: number | null;
  /** Only present when the owner chose to show their gender. */
  gender: string | null;
  followers_count: number;
  friends_count: number;
  joined_at: string;
  interests: CardInterest[];
  shared_interests: number;
  languages: string[];
  shared_languages: number;
  presence: CardPresence;
  mutual_friends: number;
  looking_for: string[];
  relationship: CardRelationship;
  /** Ranking score (recommended section only). */
  score?: number;
  /** Rounded distance in km (nearby section only). */
  distance_km?: number | null;
}

export type DiscoverSection = 'recommended' | 'online' | 'nearby' | 'new' | 'popular' | 'interests' | 'countries' | 'active';

export type PeopleSort = 'relevance' | 'newest' | 'popular' | 'active' | 'name';

export interface PeopleSearchParams {
  query?: string;
  country?: string | null;
  city?: string | null;
  gender?: string | null;
  interestIds?: number[];
  languages?: string[];
  onlineOnly?: boolean;
  /** Premium-only filters. */
  minAge?: number | null;
  maxAge?: number | null;
  sort?: PeopleSort;
  limit?: number;
  offset?: number;
}

export type MatchFindResult =
  | { status: 'searching'; waited_seconds: number; searching_now: number }
  | { status: 'matched'; live: true; match_id: string; candidate: DiscoverCard }
  | { status: 'suggested'; live: false; match_id: null; candidate: DiscoverCard; waited_seconds: number }
  | { status: 'empty'; live: false; waited_seconds: number };

export type MatchActionKind = 'skip' | 'friend' | 'chat' | 'report' | 'block';

export interface MatchActionResult {
  friend_request_id?: string;
  conversation_id?: string;
  match_id?: string | null;
}

export interface FriendRequestCard {
  id: string;
  message: string | null;
  created_at: string;
  user: DiscoverCard;
}

export interface MatchCandidate {
  profile: DiscoverCard;
  shared_interests: number;
  interests: CardInterest[];
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
