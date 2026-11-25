import type { AdminRoleType, ProfileRow, ReportStatus, ReportTargetType } from '@/types/database';
import type { AuthorCard } from '@/types/social';

export type SanctionKind = 'warning' | 'feature_restriction' | 'suspension' | 'ban';
export type RestrictableFeature = 'post' | 'comment' | 'message' | 'live' | 'gift' | 'game';

export interface Sanction {
  id: string;
  user_id: string;
  kind: SanctionKind;
  feature: RestrictableFeature | null;
  reason: string;
  report_id: string | null;
  starts_at: string;
  ends_at: string | null;
  created_by: string | null;
  lifted_at: string | null;
  lifted_by: string | null;
  lift_reason: string | null;
  created_at: string;
  created_by_user?: AuthorCard | null;
}

export interface AdminDiscoveryPerson extends AuthorCard {
  sent?: number;
  declined?: number;
  blocks?: number;
  reports?: number;
  actions?: number;
}

export interface AdminDiscoveryAbuse {
  since: string;
  stats: {
    searching_now: number;
    live_matches: number;
    match_actions: Record<string, number>;
    friend_requests: number;
    friend_requests_declined: number;
    blocks: number;
  };
  top_requesters: AdminDiscoveryPerson[];
  most_blocked: AdminDiscoveryPerson[];
  match_reported: AdminDiscoveryPerson[];
  heavy_skippers: AdminDiscoveryPerson[];
}

export interface AdminUser extends ProfileRow {
  email: string | null;
  birth_date: string | null;
  gender: string | null;
  age: number | null;
  is_premium: boolean;
  admin_role: AdminRoleType | null;
  last_seen_at: string | null;
  open_reports: number;
  active_sanctions: number;
  wallet: { balance: number; earnings_balance: number; pending_earnings: number; lifetime_purchased: number; lifetime_received: number; lifetime_withdrawn: number } | null;
  // full detail
  phone?: string | null;
  terms_accepted_at?: string | null;
  subscription?: Record<string, unknown> | null;
  sanctions?: Sanction[];
  notes?: { id: number; note: string; created_at: string; admin: AuthorCard | null }[];
  reports_made?: number;
  reports_received?: number;
  devices?: number;
  stats?: { lives: number; gifts_sent_coins: number; gifts_received_coins: number; coin_purchases_cents: number; games_played: number };
  verification?: VerificationRequest | null;
}

export interface AdminReport {
  id: string;
  reporter_id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: string;
  details: string | null;
  status: ReportStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  resolution: string | null;
  created_at: string;
  reporter: AuthorCard | null;
  reviewer: AuthorCard | null;
  target: Record<string, unknown> | null;
  target_owner: string | null;
  similar_reports: number;
}

export interface AdminOverview {
  users: { total: number; new_today: number; new_7d: number; new_30d: number; online_now: number; active_24h: number; suspended: number; banned: number; premium: number; verified: number };
  content: { posts_today: number; videos_today: number; stories_today: number; messages_today: number; lives_now: number; lives_today: number; games_today: number; removed_posts: number; removed_videos: number };
  moderation: { open_reports: number; in_review: number; pending_verifications: number; active_sanctions: number };
  finance: { coins_purchased_30d: number; revenue_cents_30d: number; gifts_coins_30d: number; commission_coins_30d: number; pending_withdrawals: number; pending_withdrawal_cents: number; coins_in_circulation: number; creator_earnings_outstanding: number; payouts_enabled: boolean };
  series: { day: string; signups: number; posts: number; videos: number }[];
  generated_at: string;
}

export interface AdminAnalytics {
  days: number;
  series: { day: string; signups: number; posts: number; videos: number; lives: number; messages: number; games: number; gifts_coins: number; purchase_cents: number; new_premium: number; reports: number }[];
  top_countries: { country_code: string; users: number }[];
  top_creators: (AuthorCard & { coins: number })[];
  games: { game: string; rooms: number }[];
}

export interface AdminContentItem {
  id: string;
  type?: string;
  text?: string | null;
  caption?: string | null;
  kind?: string;
  scope?: string;
  author: AuthorCard | null;
  created_at: string;
  removed_at: string | null;
  removed_reason?: string | null;
  thumbnail_url?: string | null;
  media_url?: string | null;
  playback_url?: string | null;
  media?: { kind: string; url: string; thumbnail_url: string | null }[];
  likes_count?: number;
  comments_count?: number;
  views_count?: number;
  reports_count?: number;
  parent?: string;
  expires_at?: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  kind: 'info' | 'update' | 'warning' | 'promo';
  audience: 'all' | 'premium' | 'free' | 'creators';
  link: string | null;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  created_at?: string;
  dismissals?: number;
}

export interface Banner {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  link: string | null;
  placement: 'home' | 'discover' | 'live' | 'wallet' | 'games';
  sort_order?: number;
  is_active?: boolean;
  starts_at?: string;
  ends_at?: string | null;
}

export interface TrendingTopic {
  id?: number;
  tag: string;
  label: string | null;
  kind: 'hashtag' | 'topic' | 'challenge';
  pinned?: boolean;
  posts_count?: number;
  recent_count?: number;
  sort_order?: number;
  is_active?: boolean;
}

export interface FeaturedCreator extends AuthorCard {
  note: string | null;
  followers_count: number;
  bio: string | null;
  is_live: boolean;
}

export interface VerificationRequest {
  id: string;
  user_id: string;
  full_name: string;
  category: 'creator' | 'public_figure' | 'business' | 'community' | 'other';
  links: string[];
  document_path: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  decision_note: string | null;
  created_at: string;
  user?: AdminUser;
  reviewer?: AuthorCard | null;
}

export interface AuditLog {
  id: string;
  admin_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  admin: AuthorCard | null;
}

export interface AdminSetting {
  key: string;
  value: unknown;
  is_public: boolean;
  updated_at: string;
  updated_by: AuthorCard | null;
}

export interface AdminWithdrawal {
  id: string;
  user_id: string;
  coins: number;
  amount_cents: number;
  currency: string;
  method: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'paid' | 'cancelled';
  note: string | null;
  reviewed_at: string | null;
  paid_at: string | null;
  created_at: string;
  user: AdminUser;
  reviewer: AuthorCard | null;
}

export interface AdminTransaction {
  id: number;
  user_id: string;
  kind: string;
  coins: number;
  balance_after: number;
  earnings_after: number;
  reference_type: string | null;
  reference_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  user: AuthorCard | null;
}

export interface AdminMember extends AuthorCard {
  role: AdminRoleType;
  granted_by: AuthorCard | null;
  created_at: string;
}
