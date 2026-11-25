import type { AuthorCard, PostAudience, StoryAudience } from '@/types/social';

export type LiveStatus = 'scheduled' | 'preparing' | 'live' | 'ended' | 'cancelled';
export type LiveRole = 'viewer' | 'guest' | 'cohost' | 'moderator';
export type LiveParticipantState = 'watching' | 'requested' | 'invited' | 'on_stage' | 'left' | 'removed';
export type LiveCategory = 'chat' | 'music' | 'gaming' | 'talent' | 'travel' | 'learning' | 'fitness' | 'cooking' | 'battles' | 'other';

export const LIVE_CATEGORIES: { id: LiveCategory; label: string; emoji: string }[] = [
  { id: 'chat', label: 'Chat', emoji: '💬' },
  { id: 'music', label: 'Music', emoji: '🎵' },
  { id: 'gaming', label: 'Gaming', emoji: '🎮' },
  { id: 'talent', label: 'Talent', emoji: '🌟' },
  { id: 'travel', label: 'Travel', emoji: '✈️' },
  { id: 'learning', label: 'Learning', emoji: '📚' },
  { id: 'fitness', label: 'Fitness', emoji: '💪' },
  { id: 'cooking', label: 'Cooking', emoji: '🍳' },
  { id: 'battles', label: 'Battles', emoji: '⚔️' },
  { id: 'other', label: 'Other', emoji: '✨' },
];

export interface FanBadge {
  level: number;
  points: number;
  joined_at?: string;
}

export interface LiveStageMember extends AuthorCard {
  role: LiveRole;
  mic_enabled: boolean;
  cam_enabled: boolean;
}

export interface LiveParticipant extends AuthorCard {
  role: LiveRole;
  state: LiveParticipantState;
  joined_at: string;
  mic_enabled: boolean;
  cam_enabled: boolean;
}

export interface LiveBattle {
  id: string;
  host: AuthorCard;
  opponent: AuthorCard;
  host_score: number;
  opponent_score: number;
  started_at: string;
  ends_at: string;
  status: 'active' | 'finished' | 'cancelled';
  winner_id: string | null;
}

export interface LiveSession {
  id: string;
  title: string;
  category: LiveCategory;
  cover_url: string | null;
  status: LiveStatus;
  visibility: PostAudience;
  room_name: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  viewers_count: number;
  peak_viewers: number;
  total_views: number;
  likes_count: number;
  comments_count: number;
  gifts_count: number;
  gifts_coins: number;
  allow_guests: boolean;
  allow_comments: boolean;
  comment_audience: StoryAudience;
  slow_mode_seconds: number;
  created_at: string;
  host: AuthorCard & { followers_count: number };
  is_host: boolean;
  is_moderator: boolean;
  following_host: boolean;
  my_state: LiveParticipantState | null;
  my_role: LiveRole | null;
  reminder_set: boolean;
  stage: LiveStageMember[];
  pending_requests: number;
  pinned_comment: { id: string; text: string | null; user: AuthorCard | null } | null;
  battle: LiveBattle | null;
  fan_badge: FanBadge | null;
}

export interface LiveComment {
  id: string;
  live_id: string;
  kind: 'comment' | 'gift' | 'join' | 'system';
  text: string | null;
  metadata: Record<string, unknown>;
  pinned: boolean;
  removed: boolean;
  created_at: string;
  user: AuthorCard | null;
  fan_badge: FanBadge | null;
  is_moderator: boolean;
}

export interface LiveDiscovery {
  live: LiveSession[];
  following: LiveSession[];
  scheduled: LiveSession[];
  trending_hosts: (AuthorCard & { total_views: number })[];
  categories: LiveCategory[];
}

export interface LiveSummary extends LiveSession {
  duration_seconds: number;
  unique_viewers: number;
  new_followers: number;
  top_gifters: { user: AuthorCard; coins: number }[];
}

export interface FanClub {
  creator: AuthorCard;
  members_count: number;
  my_membership: FanBadge | null;
  top_fans: { user: AuthorCard; points: number; level: number }[];
  levels: { level: number; points: number }[];
}

export interface LiveGiftEvent {
  id: number;
  live_id: string;
  gift: {
    id: string;
    sender: AuthorCard;
    receiver: AuthorCard;
    gift: { id: number; slug: string; name: string; emoji: string; coins: number; tier: string; animation: string };
    quantity: number;
    coins_total: number;
    message: string | null;
  };
  created_at: string;
}
