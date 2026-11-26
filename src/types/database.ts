/**
 * Hand-maintained Supabase schema types for Phase 1.
 * Keep in sync with supabase/migrations/*. Once the project is linked you can
 * regenerate with `npm run db:types` and switch the import in lib/supabase.ts.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type GenderType = 'woman' | 'man' | 'non_binary' | 'other' | 'prefer_not_to_say';
export type AccountStatus = 'active' | 'suspended' | 'banned' | 'deactivated';
export type AdminRoleType = 'super_admin' | 'admin' | 'moderator' | 'support' | 'finance';
export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';
export type AudienceType = 'everyone' | 'followers' | 'friends' | 'nobody';
export type ThemePreference = 'system' | 'light' | 'dark';
export type ReportTargetType = 'profile' | 'post' | 'video' | 'comment' | 'message' | 'live' | 'gift' | 'other';
export type ReportStatus = 'open' | 'in_review' | 'resolved' | 'dismissed';
export type DevicePlatform = 'ios' | 'android' | 'web';

export type ProfileRow = {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  country_code: string | null;
  city: string | null;
  website: string | null;
  is_verified: boolean;
  is_private: boolean;
  discoverable: boolean;
  account_status: AccountStatus;
  onboarding_completed: boolean;
  onboarding_step: number;
  followers_count: number;
  following_count: number;
  friends_count: number;
  posts_count: number;
  videos_count: number;
  likes_count: number;
  popularity_score: number;
  username_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ProfileUpdate = Partial<
  Pick<
    ProfileRow,
    | 'username'
    | 'display_name'
    | 'bio'
    | 'avatar_url'
    | 'cover_url'
    | 'country_code'
    | 'city'
    | 'website'
    | 'is_private'
    | 'discoverable'
    | 'onboarding_completed'
    | 'onboarding_step'
  >
>;

export type UserPrivateRow = {
  user_id: string;
  email: string | null;
  birth_date: string | null;
  gender: GenderType | null;
  phone: string | null;
  terms_accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export type UserSettingsRow = {
  user_id: string;
  theme: ThemePreference;
  language: string;
  show_online_status: boolean;
  show_last_seen: boolean;
  show_gender: boolean;
  show_country: boolean;
  nearby_enabled: boolean;
  random_match_enabled: boolean;
  who_can_message: AudienceType;
  who_can_comment: AudienceType;
  who_can_see_friends: AudienceType;
  story_audience: AudienceType;
  read_receipts: boolean;
  looking_for: string[];
  preferred_min_age: number | null;
  preferred_max_age: number | null;
  accent: string;
  /** Phase 13 — discovery privacy & Meet Someone preferences. */
  show_age: boolean;
  show_city: boolean;
  show_languages: boolean;
  show_activity: boolean;
  match_countries: string[];
  match_languages: string[];
  match_genders: string[];
  match_shared_interests: boolean;
  created_at: string;
  updated_at: string;
}

export type NotificationPreferencesRow = {
  user_id: string;
  push_enabled: boolean;
  email_enabled: boolean;
  new_followers: boolean;
  friend_requests: boolean;
  likes: boolean;
  comments: boolean;
  mentions: boolean;
  reposts: boolean;
  messages: boolean;
  calls: boolean;
  live: boolean;
  gifts: boolean;
  subscription: boolean;
  security: boolean;
  matches: boolean;
  created_at: string;
  updated_at: string;
}

export type UserLanguageRow = {
  user_id: string;
  code: string;
  created_at: string;
}

export type InterestRow = {
  id: number;
  slug: string;
  name: string;
  emoji: string | null;
  category: string;
  sort_order: number;
  is_active: boolean;
}

export type UserInterestRow = {
  user_id: string;
  interest_id: number;
  created_at: string;
}

export type FollowRow = {
  follower_id: string;
  following_id: string;
  created_at: string;
}

export type FollowRequestRow = {
  id: string;
  requester_id: string;
  target_id: string;
  status: RequestStatus;
  created_at: string;
  responded_at: string | null;
}

export type FriendRequestRow = {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: RequestStatus;
  message: string | null;
  created_at: string;
  responded_at: string | null;
}

export type FriendshipRow = {
  user_a: string;
  user_b: string;
  created_at: string;
}

export type BlockRow = {
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}

export type NotificationRow = {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  data: Json;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export type ReportRow = {
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
}

export type UserDeviceRow = {
  id: string;
  user_id: string;
  platform: DevicePlatform;
  push_token: string | null;
  device_name: string | null;
  app_version: string | null;
  last_active_at: string;
  created_at: string;
}

export type UserPresenceRow = {
  user_id: string;
  is_online: boolean;
  last_seen_at: string;
  updated_at: string;
  activity: string | null;
  activity_until: string | null;
}

export type AdminRoleRow = {
  user_id: string;
  role: AdminRoleType;
  granted_by: string | null;
  created_at: string;
}

export type AdminAuditLogRow = {
  id: number;
  admin_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Json;
  created_at: string;
}

/** Compact profile returned by search / suggestion functions. */
export type ProfileCard = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  country_code: string | null;
  bio: string | null;
  is_verified: boolean;
  is_private?: boolean;
  followers_count: number;
  shared_interests?: number;
}

export type Relationship = {
  is_self: boolean;
  is_following: boolean;
  is_followed_by: boolean;
  follow_requested: boolean;
  is_friend: boolean;
  is_blocking: boolean;
  is_blocked_by: boolean;
  friend_request: { id: string; direction: 'incoming' | 'outgoing'; created_at: string } | null;
}

export type SessionInfo = {
  id: string;
  created_at: string;
  updated_at: string | null;
  user_agent: string | null;
  ip: string | null;
  is_current: boolean;
}

export type PresenceInfo = {
  user_id: string;
  is_online: boolean | null;
  last_seen_at: string | null;
  /** 'chatting' | 'live' | 'gaming' — only when the person opted in. */
  activity: string | null;
}

type Rel<FK extends string, Col extends string, Ref extends string = 'profiles'> = {
  foreignKeyName: FK;
  columns: [Col];
  isOneToOne: false;
  referencedRelation: Ref;
  referencedColumns: ['id'];
};

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>, Relationships extends unknown[] = []> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: Relationships;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow, never, ProfileUpdate>;
      user_private: Table<UserPrivateRow, never, Partial<Pick<UserPrivateRow, 'gender' | 'phone'>>>;
      user_settings: Table<UserSettingsRow, never, Partial<Omit<UserSettingsRow, 'user_id' | 'created_at' | 'updated_at'>>>;
      notification_preferences: Table<
        NotificationPreferencesRow,
        never,
        Partial<Omit<NotificationPreferencesRow, 'user_id' | 'created_at' | 'updated_at'>>
      >;
      interests: Table<InterestRow, never, never>;
      user_interests: Table<UserInterestRow, { user_id: string; interest_id: number }, never>;
      user_languages: Table<UserLanguageRow, { user_id: string; code: string }, never>;
      e2ee_devices: Table<
        { id: string; user_id: string; device_id: string; platform: 'android' | 'ios' | 'web'; name: string | null; identity_key: string; signing_key: string; created_at: string; last_seen_at: string; revoked_at: string | null },
        never,
        never
      >;
      follows: Table<
        FollowRow,
        never,
        never,
        [Rel<'follows_follower_id_fkey', 'follower_id'>, Rel<'follows_following_id_fkey', 'following_id'>]
      >;
      follow_requests: Table<
        FollowRequestRow,
        never,
        never,
        [Rel<'follow_requests_requester_id_fkey', 'requester_id'>, Rel<'follow_requests_target_id_fkey', 'target_id'>]
      >;
      friend_requests: Table<
        FriendRequestRow,
        never,
        never,
        [Rel<'friend_requests_sender_id_fkey', 'sender_id'>, Rel<'friend_requests_receiver_id_fkey', 'receiver_id'>]
      >;
      friendships: Table<FriendshipRow, never, never, [Rel<'friendships_user_a_fkey', 'user_a'>, Rel<'friendships_user_b_fkey', 'user_b'>]>;
      blocks: Table<BlockRow, never, never, [Rel<'blocks_blocker_id_fkey', 'blocker_id'>, Rel<'blocks_blocked_id_fkey', 'blocked_id'>]>;
      notifications: Table<
        NotificationRow,
        never,
        Partial<Pick<NotificationRow, 'is_read' | 'read_at'>>,
        [Rel<'notifications_user_id_fkey', 'user_id'>, Rel<'notifications_actor_id_fkey', 'actor_id'>]
      >;
      reports: Table<
        ReportRow,
        { reporter_id: string; target_type: ReportTargetType; target_id: string; reason: string; details?: string | null },
        never
      >;
      user_devices: Table<
        UserDeviceRow,
        { user_id: string; platform: DevicePlatform; push_token?: string | null; device_name?: string | null; app_version?: string | null },
        Partial<Omit<UserDeviceRow, 'id' | 'user_id' | 'created_at'>>
      >;
      user_presence: Table<UserPresenceRow, never, never>;
      admin_roles: Table<AdminRoleRow, never, never>;
      admin_audit_logs: Table<AdminAuditLogRow, never, never>;
      stickers: Table<{ id: number; pack: string; emoji: string | null; url: string | null; label: string | null; sort_order: number; is_active: boolean }, never, never>;
      video_drafts: Table<{ id: string; user_id: string; data: Json; updated_at: string; created_at: string }, { id?: string; user_id: string; data: Json; updated_at?: string }, { data?: Json; updated_at?: string }>;
    };
    Views: { [_ in never]: never };
    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
      is_adult: { Args: { p_user?: string }; Returns: boolean };
      is_username_available: { Args: { p_username: string }; Returns: boolean };
      follow_user: { Args: { p_target: string }; Returns: string };
      unfollow_user: { Args: { p_target: string }; Returns: string };
      remove_follower: { Args: { p_follower: string }; Returns: undefined };
      respond_follow_request: { Args: { p_request: string; p_accept: boolean }; Returns: undefined };
      send_friend_request: { Args: { p_target: string; p_message?: string | null }; Returns: string };
      respond_friend_request: { Args: { p_request: string; p_accept: boolean }; Returns: undefined };
      cancel_friend_request: { Args: { p_request: string }; Returns: undefined };
      unfriend: { Args: { p_other: string }; Returns: undefined };
      block_user: { Args: { p_target: string }; Returns: undefined };
      unblock_user: { Args: { p_target: string }; Returns: undefined };
      get_relationship: { Args: { p_target: string }; Returns: Json };
      touch_presence: { Args: { p_online?: boolean; p_activity?: string | null; p_set_activity?: boolean }; Returns: undefined };
      get_presence: { Args: { p_user_ids: string[] }; Returns: PresenceInfo[] };
      get_suggested_profiles: { Args: { p_limit?: number }; Returns: ProfileCard[] };
      search_profiles: {
        Args: { p_query?: string; p_country?: string | null; p_limit?: number; p_offset?: number };
        Returns: ProfileCard[];
      };
      get_blocked_profiles: { Args: Record<string, never>; Returns: (ProfileCard & { blocked_at: string })[] };
      get_my_sessions: { Args: Record<string, never>; Returns: SessionInfo[] };
      revoke_my_session: { Args: { p_session_id: string }; Returns: undefined };
      revoke_other_sessions: { Args: Record<string, never>; Returns: undefined };
      delete_my_account: { Args: Record<string, never>; Returns: undefined };
      log_admin_action: {
        Args: { p_action: string; p_target_type?: string | null; p_target_id?: string | null; p_metadata?: Json };
        Returns: undefined;
      };
      // ---- Phase 2: social ----
      create_post: {
        Args: {
          p_type: string;
          p_text?: string | null;
          p_audience?: string;
          p_allow_comments?: boolean;
          p_media?: Json;
          p_poll?: Json | null;
          p_shared_post_id?: string | null;
          p_location_name?: string | null;
        };
        Returns: Json;
      };
      edit_post: { Args: { p_id: string; p_text: string; p_audience?: string | null; p_allow_comments?: boolean | null }; Returns: Json };
      delete_post: { Args: { p_id: string }; Returns: undefined };
      get_post: { Args: { p_id: string }; Returns: Json };
      toggle_post_reaction: { Args: { p_post: string; p_reaction?: string | null }; Returns: Json };
      get_post_reactions: { Args: { p_post: string; p_limit?: number; p_offset?: number }; Returns: Json };
      toggle_repost: { Args: { p_post: string }; Returns: Json };
      toggle_save_post: { Args: { p_post: string }; Returns: Json };
      feed_feedback: { Args: { p_post: string; p_kind: string }; Returns: undefined };
      undo_feed_feedback: { Args: { p_post: string }; Returns: undefined };
      record_impressions: { Args: { p_post_ids: string[] }; Returns: undefined };
      vote_poll: { Args: { p_post: string; p_option_ids: string[] }; Returns: Json };
      add_comment: { Args: { p_post: string; p_text: string; p_parent?: string | null; p_media_url?: string | null }; Returns: Json };
      edit_comment: { Args: { p_id: string; p_text: string }; Returns: Json };
      delete_comment: { Args: { p_id: string }; Returns: undefined };
      toggle_comment_reaction: { Args: { p_comment: string; p_reaction?: string | null }; Returns: Json };
      get_comments: { Args: { p_post: string; p_limit?: number; p_before?: string | null; p_parent?: string | null }; Returns: Json[] };
      get_feed_following: { Args: { p_limit?: number; p_before?: string | null }; Returns: Json[] };
      get_feed_for_you: { Args: { p_limit?: number; p_offset?: number }; Returns: Json[] };
      get_feed_trending: { Args: { p_limit?: number; p_offset?: number }; Returns: Json[] };
      get_feed_nearby: { Args: { p_limit?: number; p_offset?: number; p_radius_km?: number }; Returns: Json[] };
      get_user_posts: { Args: { p_user: string; p_kind?: string; p_limit?: number; p_before?: string | null }; Returns: Json[] };
      get_user_reposts: { Args: { p_user: string; p_limit?: number; p_before?: string | null }; Returns: Json[] };
      get_saved_posts: { Args: { p_limit?: number; p_before?: string | null }; Returns: Json[] };
      get_hashtag_posts: { Args: { p_tag: string; p_limit?: number; p_before?: string | null }; Returns: Json[] };
      get_trending_hashtags: { Args: { p_limit?: number }; Returns: Json };
      create_story: {
        Args: {
          p_kind: string;
          p_media_url?: string | null;
          p_thumbnail_url?: string | null;
          p_text?: string | null;
          p_style?: Json;
          p_stickers?: Json;
          p_caption?: string | null;
          p_music_title?: string | null;
          p_audience?: string | null;
          p_duration_ms?: number | null;
        };
        Returns: Json;
      };
      delete_story: { Args: { p_id: string }; Returns: undefined };
      get_story_tray: { Args: Record<string, never>; Returns: Json };
      get_user_stories: { Args: { p_user: string }; Returns: Json[] };
      mark_story_viewed: { Args: { p_story: string }; Returns: undefined };
      react_story: { Args: { p_story: string; p_emoji: string }; Returns: undefined };
      get_story_viewers: { Args: { p_story: string; p_limit?: number }; Returns: Json };
      create_highlight: { Args: { p_title: string; p_story_ids: string[]; p_cover_url?: string | null }; Returns: Json };
      update_highlight: { Args: { p_id: string; p_title?: string | null; p_add?: string[] | null; p_remove?: string[] | null; p_cover_url?: string | null }; Returns: undefined };
      delete_highlight: { Args: { p_id: string }; Returns: undefined };
      get_highlights: { Args: { p_user: string }; Returns: Json };
      get_highlight_stories: { Args: { p_highlight: string }; Returns: Json[] };
      get_my_archived_stories: { Args: { p_limit?: number }; Returns: Json[] };
      update_my_location: { Args: { p_lat: number; p_lng: number; p_city?: string | null }; Returns: undefined };
      clear_my_location: { Args: Record<string, never>; Returns: undefined };
      get_nearby_people: { Args: { p_limit?: number; p_radius_km?: number }; Returns: Json };
      get_online_people: { Args: { p_limit?: number }; Returns: Json };
      get_match_candidate: { Args: Record<string, never>; Returns: Json };
      match_action: { Args: { p_candidate: string; p_action: string }; Returns: Json };
      search_all: { Args: { p_query: string; p_limit?: number }; Returns: Json };
      search_posts: { Args: { p_query: string; p_limit?: number; p_offset?: number }; Returns: Json[] };
      save_search: { Args: { p_query: string; p_kind?: string }; Returns: undefined };
      get_recent_searches: { Args: Record<string, never>; Returns: Json };
      clear_search_history: { Args: { p_id?: number | null }; Returns: undefined };
      get_trending_searches: { Args: { p_limit?: number }; Returns: Json };
      // ---- Phase 3: messaging ----
      start_direct_conversation: { Args: { p_user: string }; Returns: string };
      create_group: { Args: { p_title: string; p_member_ids?: string[]; p_description?: string | null; p_avatar_url?: string | null }; Returns: string };
      update_group: { Args: { p_conversation: string; p_title?: string | null; p_description?: string | null; p_avatar_url?: string | null; p_join_approval?: boolean | null }; Returns: Json };
      add_members: { Args: { p_conversation: string; p_user_ids: string[] }; Returns: number };
      remove_member: { Args: { p_conversation: string; p_user: string }; Returns: undefined };
      set_member_role: { Args: { p_conversation: string; p_user: string; p_role: string }; Returns: undefined };
      leave_conversation: { Args: { p_conversation: string }; Returns: undefined };
      rotate_invite_link: { Args: { p_conversation: string }; Returns: string };
      get_invite_link: { Args: { p_conversation: string }; Returns: string };
      preview_invite: { Args: { p_code: string }; Returns: Json };
      join_via_invite: { Args: { p_code: string }; Returns: Json };
      get_join_requests: { Args: { p_conversation: string }; Returns: Json };
      respond_join_request: { Args: { p_request: string; p_accept: boolean }; Returns: undefined };
      respond_message_request: { Args: { p_conversation: string; p_accept: boolean }; Returns: undefined };
      set_conversation_settings: {
        Args: {
          p_conversation: string;
          p_muted_until?: string | null;
          p_set_mute?: boolean;
          p_is_archived?: boolean | null;
          p_is_pinned?: boolean | null;
          p_marked_unread?: boolean | null;
          p_wallpaper?: string | null;
          p_set_wallpaper?: boolean;
          p_notifications?: boolean | null;
        };
        Returns: Json;
      };
      clear_conversation: { Args: { p_conversation: string }; Returns: undefined };
      set_disappearing: { Args: { p_conversation: string; p_seconds: number }; Returns: undefined };
      mark_conversation_read: { Args: { p_conversation: string }; Returns: undefined };
      mark_delivered: { Args: { p_conversation_ids?: string[] | null }; Returns: undefined };
      get_unread_total: { Args: Record<string, never>; Returns: number };
      get_conversations: { Args: { p_filter?: string; p_limit?: number; p_before?: string | null }; Returns: Json[] };
      get_conversation: { Args: { p_id: string }; Returns: Json };
      get_messages: { Args: { p_conversation: string; p_limit?: number; p_before?: string | null; p_after?: string | null }; Returns: Json[] };
      get_message: { Args: { p_id: string }; Returns: Json };
      send_message: {
        Args: { p_conversation: string; p_kind?: string; p_text?: string | null; p_metadata?: Json; p_attachments?: Json; p_reply_to?: string | null; p_client_id?: string | null };
        Returns: Json;
      };
      edit_message: { Args: { p_id: string; p_text: string }; Returns: Json };
      delete_message: { Args: { p_id: string; p_for_everyone?: boolean }; Returns: undefined };
      forward_messages: { Args: { p_message_ids: string[]; p_conversation_ids: string[] }; Returns: number };
      react_message: { Args: { p_id: string; p_emoji?: string | null }; Returns: undefined };
      star_message: { Args: { p_id: string; p_star?: boolean }; Returns: undefined };
      pin_message: { Args: { p_id: string; p_pin?: boolean }; Returns: undefined };
      get_message_info: { Args: { p_id: string }; Returns: Json };
      search_messages: { Args: { p_query: string; p_conversation?: string | null; p_limit?: number }; Returns: Json[] };
      get_starred_messages: { Args: { p_limit?: number }; Returns: Json[] };
      get_shared_media: { Args: { p_conversation: string; p_kind?: string; p_limit?: number; p_before?: string | null }; Returns: Json[] };
      send_story_reply: { Args: { p_story: string; p_envelope: Json; p_client_id?: string | null }; Returns: Json };
      // ---- Phase 3b: end-to-end encryption ----
      register_e2ee_device: { Args: { p_device_id: string; p_platform: string; p_identity_key: string; p_signing_key: string; p_name?: string | null }; Returns: Json };
      revoke_e2ee_device: { Args: { p_device_id: string }; Returns: undefined };
      get_e2ee_devices: { Args: Record<string, never>; Returns: Json };
      e2ee_user_devices: { Args: { p_user: string }; Returns: Json };
      e2ee_recipients: { Args: { p_conversation: string }; Returns: Json };
      send_encrypted_message: {
        Args: { p_conversation: string; p_kind: string; p_envelope: Json; p_attachments?: Json; p_reply_to?: string | null; p_client_id?: string | null; p_forwarded?: boolean };
        Returns: Json;
      };
      edit_encrypted_message: { Args: { p_id: string; p_envelope: Json }; Returns: Json };
      // ---- Phase 4: calls ----
      start_call: { Args: { p_conversation: string; p_kind?: string }; Returns: Json };
      answer_call: { Args: { p_call: string }; Returns: Json };
      decline_call: { Args: { p_call: string }; Returns: undefined };
      leave_call: { Args: { p_call: string; p_reason?: string | null }; Returns: undefined };
      get_call: { Args: { p_call: string }; Returns: Json };
      get_active_call: { Args: { p_conversation: string }; Returns: Json };
      get_call_history: { Args: { p_limit?: number; p_before?: string | null }; Returns: Json[] };
      // ---- Phase 5: videos ----
      create_video: {
        Args: {
          p_media_url: string; p_thumbnail_url?: string | null; p_caption?: string | null; p_width?: number | null; p_height?: number | null; p_duration_ms?: number | null;
          p_audience?: string; p_allow_comments?: boolean; p_allow_duet?: boolean; p_allow_stitch?: boolean; p_allow_download?: boolean;
          p_sound_id?: string | null; p_sound_volume?: number; p_original_volume?: number; p_trim_start_ms?: number; p_trim_end_ms?: number | null; p_playback_rate?: number;
          p_overlays?: Json; p_filter?: string; p_duet_of?: string | null; p_stitch_of?: string | null; p_stitch_start_ms?: number | null; p_stitch_end_ms?: number | null;
          p_reply_to_comment_id?: string | null; p_create_original_sound?: boolean;
        };
        Returns: Json;
      };
      update_video: { Args: { p_id: string; p_caption?: string | null; p_audience?: string | null; p_allow_comments?: boolean | null; p_allow_duet?: boolean | null; p_allow_stitch?: boolean | null; p_allow_download?: boolean | null; p_thumbnail_url?: string | null }; Returns: Json };
      delete_video: { Args: { p_id: string }; Returns: undefined };
      get_video: { Args: { p_id: string }; Returns: Json };
      toggle_video_like: { Args: { p_video: string }; Returns: Json };
      toggle_video_save: { Args: { p_video: string }; Returns: Json };
      toggle_video_repost: { Args: { p_video: string }; Returns: Json };
      record_video_share: { Args: { p_video: string }; Returns: undefined };
      record_video_view: { Args: { p_video: string; p_watched_ms?: number; p_completed?: boolean }; Returns: undefined };
      video_feedback: { Args: { p_video: string; p_kind: string }; Returns: undefined };
      add_video_comment: { Args: { p_video: string; p_text: string; p_parent?: string | null }; Returns: Json };
      edit_video_comment: { Args: { p_id: string; p_text: string }; Returns: Json };
      delete_video_comment: { Args: { p_id: string }; Returns: undefined };
      toggle_video_comment_like: { Args: { p_comment: string }; Returns: Json };
      get_video_comments: { Args: { p_video: string; p_limit?: number; p_before?: string | null; p_parent?: string | null }; Returns: Json[] };
      get_video_feed_for_you: { Args: { p_limit?: number; p_offset?: number }; Returns: Json[] };
      get_video_feed_following: { Args: { p_limit?: number; p_before?: string | null }; Returns: Json[] };
      get_video_feed_trending: { Args: { p_limit?: number; p_offset?: number }; Returns: Json[] };
      get_user_videos: { Args: { p_user: string; p_limit?: number; p_before?: string | null }; Returns: Json[] };
      get_saved_videos: { Args: { p_limit?: number; p_before?: string | null }; Returns: Json[] };
      get_hashtag_videos: { Args: { p_tag: string; p_limit?: number; p_offset?: number }; Returns: Json[] };
      get_sound_videos: { Args: { p_sound: string; p_limit?: number; p_offset?: number }; Returns: Json[] };
      get_video_duets: { Args: { p_video: string; p_limit?: number }; Returns: Json[] };
      search_videos: { Args: { p_query: string; p_limit?: number; p_offset?: number }; Returns: Json[] };
      create_sound: { Args: { p_title: string; p_url: string; p_artist?: string | null; p_duration_ms?: number | null; p_cover_url?: string | null; p_license_note?: string | null }; Returns: Json };
      get_sound: { Args: { p_id: string }; Returns: Json };
      get_trending_sounds: { Args: { p_limit?: number; p_query?: string | null }; Returns: Json };
      create_playlist: { Args: { p_title: string; p_description?: string | null; p_is_public?: boolean }; Returns: Json };
      update_playlist: { Args: { p_id: string; p_title?: string | null; p_description?: string | null; p_is_public?: boolean | null; p_add?: string[] | null; p_remove?: string[] | null }; Returns: undefined };
      delete_playlist: { Args: { p_id: string }; Returns: undefined };
      get_playlists: { Args: { p_user: string }; Returns: Json };
      get_playlist_videos: { Args: { p_playlist: string }; Returns: Json[] };
      create_challenge: { Args: { p_tag: string; p_title: string; p_description?: string | null; p_cover_url?: string | null; p_ends_at?: string | null }; Returns: Json };
      get_challenge: { Args: { p_tag: string }; Returns: Json };
      get_challenges: { Args: { p_limit?: number }; Returns: Json };
      get_creator_analytics: { Args: { p_days?: number }; Returns: Json };
      get_video_analytics: { Args: { p_video: string }; Returns: Json };
      // ---- Phase 6: economy ----
      get_wallet: { Args: Record<string, never>; Returns: Json };
      get_wallet_transactions: { Args: { p_limit?: number; p_before?: number | null }; Returns: Json[] };
      get_coin_packages: { Args: Record<string, never>; Returns: Json };
      get_gift_catalog: { Args: Record<string, never>; Returns: Json };
      send_gift: { Args: { p_gift_id: number; p_target_type: string; p_target_id?: string | null; p_quantity?: number; p_message?: string | null }; Returns: Json };
      get_received_gifts: { Args: { p_limit?: number; p_before?: string | null }; Returns: Json[] };
      get_sent_gifts: { Args: { p_limit?: number; p_before?: string | null }; Returns: Json[] };
      get_top_supporters: { Args: { p_creator: string; p_limit?: number }; Returns: Json };
      get_earnings_summary: { Args: Record<string, never>; Returns: Json };
      request_withdrawal: { Args: { p_coins: number; p_method: Json }; Returns: Json };
      cancel_withdrawal: { Args: { p_id: string }; Returns: undefined };
      get_public_settings: { Args: Record<string, never>; Returns: Json };
      // ---- Phase 7: live ----
      create_live: { Args: { p_title: string; p_category?: string; p_cover_url?: string | null; p_visibility?: string; p_scheduled_at?: string | null; p_allow_guests?: boolean; p_allow_comments?: boolean; p_comment_audience?: string }; Returns: Json };
      update_live: { Args: { p_id: string; p_title?: string | null; p_category?: string | null; p_cover_url?: string | null; p_allow_guests?: boolean | null; p_allow_comments?: boolean | null; p_comment_audience?: string | null; p_slow_mode_seconds?: number | null; p_scheduled_at?: string | null }; Returns: Json };
      start_live: { Args: { p_id: string }; Returns: Json };
      end_live: { Args: { p_id: string }; Returns: Json };
      join_live: { Args: { p_id: string }; Returns: Json };
      leave_live: { Args: { p_id: string }; Returns: undefined };
      live_heartbeat: { Args: { p_id: string }; Returns: Json };
      send_live_comment: { Args: { p_id: string; p_text: string }; Returns: Json };
      pin_live_comment: { Args: { p_comment: string; p_pin?: boolean }; Returns: undefined };
      delete_live_comment: { Args: { p_comment: string }; Returns: undefined };
      like_live: { Args: { p_id: string; p_count?: number }; Returns: Json };
      request_live_stage: { Args: { p_id: string }; Returns: undefined };
      cancel_live_stage_request: { Args: { p_id: string }; Returns: undefined };
      invite_live_guest: { Args: { p_id: string; p_user: string }; Returns: undefined };
      approve_live_guest: { Args: { p_id: string; p_user: string; p_approve?: boolean }; Returns: undefined };
      accept_live_invite: { Args: { p_id: string }; Returns: undefined };
      set_live_guest_media: { Args: { p_id: string; p_user: string; p_mic?: boolean | null; p_cam?: boolean | null }; Returns: undefined };
      remove_live_guest: { Args: { p_id: string; p_user: string }; Returns: undefined };
      set_live_cohost: { Args: { p_id: string; p_user: string; p_cohost?: boolean }; Returns: undefined };
      set_live_moderator: { Args: { p_id: string; p_user: string; p_moderator?: boolean; p_persistent?: boolean }; Returns: undefined };
      mute_live_user: { Args: { p_id: string; p_user: string; p_minutes?: number }; Returns: undefined };
      ban_live_user: { Args: { p_id: string; p_user: string; p_ban?: boolean }; Returns: undefined };
      start_live_battle: { Args: { p_id: string; p_opponent: string; p_minutes?: number }; Returns: Json };
      end_live_battle: { Args: { p_id: string }; Returns: Json };
      join_fan_club: { Args: { p_creator: string }; Returns: Json };
      leave_fan_club: { Args: { p_creator: string }; Returns: undefined };
      get_fan_club: { Args: { p_creator: string }; Returns: Json };
      send_live_gift: { Args: { p_live: string; p_gift_id: number; p_quantity?: number; p_recipient?: string | null; p_message?: string | null }; Returns: Json };
      get_live: { Args: { p_id: string }; Returns: Json };
      get_live_comments: { Args: { p_id: string; p_limit?: number; p_before?: string | null }; Returns: Json[] };
      get_live_participants: { Args: { p_id: string; p_state?: string }; Returns: Json };
      get_live_discovery: { Args: { p_category?: string | null; p_limit?: number }; Returns: Json };
      get_my_lives: { Args: { p_limit?: number }; Returns: Json[] };
      get_user_lives: { Args: { p_user: string; p_limit?: number }; Returns: Json[] };
      get_live_summary: { Args: { p_id: string }; Returns: Json };
      set_live_reminder: { Args: { p_id: string; p_on?: boolean }; Returns: undefined };
      // ---- Phase 8: games ----
      create_game_room: { Args: { p_game: string; p_is_private?: boolean; p_max_players?: number | null }; Returns: Json };
      join_game_room: { Args: { p_room?: string | null; p_code?: string | null }; Returns: Json };
      leave_game_room: { Args: { p_room: string }; Returns: undefined };
      invite_to_game: { Args: { p_room: string; p_user: string }; Returns: undefined };
      set_game_ready: { Args: { p_room: string; p_ready?: boolean }; Returns: Json };
      get_game_room: { Args: { p_room: string }; Returns: Json };
      list_game_rooms: { Args: { p_game?: string | null }; Returns: Json };
      get_leaderboard: { Args: { p_game: string; p_limit?: number }; Returns: Json };
      get_my_game_history: { Args: { p_limit?: number }; Returns: Json[] };
      send_game_message: { Args: { p_room: string; p_text: string }; Returns: Json };
      get_game_messages: { Args: { p_room: string; p_limit?: number }; Returns: Json[] };
      create_rematch: { Args: { p_room: string }; Returns: Json };
      // ---- Phase 9: premium ----
      is_premium: { Args: { p_user?: string }; Returns: boolean };
      get_premium_status: { Args: Record<string, never>; Returns: Json };
      get_premium_plans: { Args: Record<string, never>; Returns: Json };
      premium_features: { Args: Record<string, never>; Returns: Json };
      record_profile_view: { Args: { p_profile: string }; Returns: undefined };
      get_profile_viewers: { Args: { p_limit?: number }; Returns: Json };
      get_match_admirers: { Args: { p_limit?: number }; Returns: Json };
      search_profiles_advanced: { Args: { p_query?: string; p_country?: string | null; p_min_age?: number | null; p_max_age?: number | null; p_gender?: string | null; p_online_only?: boolean; p_verified_only?: boolean; p_interest_ids?: number[] | null; p_limit?: number; p_offset?: number }; Returns: Json };
      grant_premium: { Args: { p_user: string; p_days: number; p_reason: string }; Returns: Json };
      revoke_premium: { Args: { p_user: string; p_reason: string }; Returns: undefined };
      // ---- Phase 10: admin & site content ----
      get_my_sanctions: { Args: Record<string, never>; Returns: Json };
      get_my_admin_role: { Args: Record<string, never>; Returns: string | null };
      admin_overview: { Args: Record<string, never>; Returns: Json };
      admin_analytics: { Args: { p_days?: number }; Returns: Json };
      admin_search_users: { Args: { p_query?: string; p_status?: string | null; p_filter?: string | null; p_limit?: number; p_offset?: number }; Returns: Json };
      admin_get_user: { Args: { p_user: string }; Returns: Json };
      admin_set_account_status: { Args: { p_user: string; p_status: string; p_reason: string; p_days?: number | null }; Returns: Json };
      admin_warn_user: { Args: { p_user: string; p_reason: string; p_report?: string | null }; Returns: undefined };
      admin_restrict_feature: { Args: { p_user: string; p_feature: string; p_hours: number | null; p_reason: string; p_report?: string | null }; Returns: Json };
      admin_lift_sanction: { Args: { p_id: string; p_reason?: string | null }; Returns: undefined };
      admin_set_verified: { Args: { p_user: string; p_verified: boolean; p_note?: string | null }; Returns: undefined };
      admin_add_note: { Args: { p_user: string; p_note: string }; Returns: Json };
      admin_revoke_user_sessions: { Args: { p_user: string }; Returns: number };
      admin_list_reports: { Args: { p_status?: string | null; p_target_type?: string | null; p_limit?: number; p_offset?: number }; Returns: Json };
      admin_get_report: { Args: { p_report: string }; Returns: Json };
      admin_claim_report: { Args: { p_report: string }; Returns: Json };
      admin_remove_content: { Args: { p_type: string; p_id: string; p_reason: string; p_notify?: boolean }; Returns: undefined };
      admin_restore_content: { Args: { p_type: string; p_id: string }; Returns: undefined };
      admin_resolve_report: { Args: { p_report: string; p_status: string; p_resolution?: string | null; p_action?: string; p_reason?: string | null; p_hours?: number | null }; Returns: Json };
      admin_list_content: { Args: { p_type?: string; p_query?: string; p_removed_only?: boolean; p_user?: string | null; p_limit?: number; p_offset?: number }; Returns: Json };
      admin_list_lives: { Args: { p_status?: string | null; p_limit?: number }; Returns: Json };
      admin_end_live: { Args: { p_id: string; p_reason: string; p_restrict_hours?: number | null }; Returns: Json };
      admin_list_transactions: { Args: { p_user?: string | null; p_kind?: string | null; p_limit?: number; p_before?: number | null }; Returns: Json };
      admin_list_withdrawals: { Args: { p_status?: string | null; p_limit?: number; p_offset?: number }; Returns: Json };
      admin_review_withdrawal: { Args: { p_id: string; p_decision: string; p_note?: string | null }; Returns: Json };
      admin_adjust_coins: { Args: { p_user: string; p_delta: number; p_reason: string }; Returns: Json };
      admin_list_coin_purchases: { Args: { p_limit?: number; p_offset?: number }; Returns: Json };
      admin_list_subscriptions: { Args: { p_status?: string | null; p_limit?: number; p_offset?: number }; Returns: Json };
      admin_list_settings: { Args: Record<string, never>; Returns: Json };
      admin_update_setting: { Args: { p_key: string; p_value: Json; p_is_public?: boolean | null }; Returns: Json };
      admin_upsert_gift: { Args: { p_id: number | null; p_slug: string | null; p_name: string | null; p_emoji: string | null; p_coins: number | null; p_tier?: string | null; p_animation?: string | null; p_is_premium_only?: boolean | null; p_is_active?: boolean | null; p_sort_order?: number | null }; Returns: Json };
      admin_upsert_coin_package: { Args: { p_id: number | null; p_sku: string | null; p_title: string | null; p_coins: number | null; p_bonus_coins?: number | null; p_price_cents?: number | null; p_currency?: string | null; p_is_active?: boolean | null; p_sort_order?: number | null }; Returns: Json };
      admin_upsert_premium_plan: { Args: { p_id: string; p_title: string; p_period: string; p_rc_package: string; p_price_cents: number; p_currency?: string; p_trial_days?: number; p_highlight?: string | null; p_is_active?: boolean; p_sort_order?: number }; Returns: Json };
      admin_upsert_announcement: { Args: { p_id: string | null; p_title: string | null; p_body: string | null; p_kind?: string | null; p_audience?: string | null; p_link?: string | null; p_starts_at?: string | null; p_ends_at?: string | null; p_is_active?: boolean | null }; Returns: Json };
      admin_delete_announcement: { Args: { p_id: string }; Returns: undefined };
      admin_list_announcements: { Args: Record<string, never>; Returns: Json };
      get_active_announcements: { Args: Record<string, never>; Returns: Json };
      dismiss_announcement: { Args: { p_id: string }; Returns: undefined };
      admin_upsert_banner: { Args: { p_id: string | null; p_title: string | null; p_subtitle?: string | null; p_image_url?: string | null; p_link?: string | null; p_placement?: string | null; p_sort_order?: number | null; p_is_active?: boolean | null; p_starts_at?: string | null; p_ends_at?: string | null }; Returns: Json };
      admin_delete_banner: { Args: { p_id: string }; Returns: undefined };
      admin_list_banners: { Args: Record<string, never>; Returns: Json };
      get_banners: { Args: { p_placement?: string }; Returns: Json };
      admin_set_featured_creator: { Args: { p_user: string; p_featured?: boolean; p_note?: string | null; p_until?: string | null; p_sort_order?: number }; Returns: undefined };
      get_featured_creators: { Args: { p_limit?: number }; Returns: Json };
      admin_upsert_trending_topic: { Args: { p_id: number | null; p_tag: string | null; p_label?: string | null; p_kind?: string | null; p_sort_order?: number | null; p_is_active?: boolean | null }; Returns: Json };
      admin_delete_trending_topic: { Args: { p_id: number }; Returns: undefined };
      get_trending_topics: { Args: { p_limit?: number }; Returns: Json };
      request_verification: { Args: { p_full_name: string; p_category: string; p_links?: Json; p_document_path?: string | null; p_note?: string | null }; Returns: Json };
      get_my_verification_request: { Args: Record<string, never>; Returns: Json };
      admin_list_verification_requests: { Args: { p_status?: string | null; p_limit?: number; p_offset?: number }; Returns: Json };
      admin_review_verification: { Args: { p_id: string; p_approve: boolean; p_note?: string | null }; Returns: Json };
      admin_list_audit_logs: { Args: { p_limit?: number; p_before?: string | null; p_admin?: string | null; p_action?: string | null }; Returns: Json };
      admin_list_admins: { Args: Record<string, never>; Returns: Json };
      admin_grant_role: { Args: { p_user: string; p_role: string }; Returns: undefined };
      admin_revoke_role: { Args: { p_user: string }; Returns: undefined };
      // ---- Phase 13: friend discovery & matching ----
      get_discover_card: { Args: { p_user: string }; Returns: Json };
      discover_people: { Args: { p_section?: string; p_limit?: number; p_offset?: number; p_radius_km?: number }; Returns: Json };
      search_people: {
        Args: {
          p_query?: string; p_country?: string | null; p_city?: string | null; p_gender?: string | null; p_interest_ids?: number[] | null; p_languages?: string[] | null;
          p_online_only?: boolean; p_min_age?: number | null; p_max_age?: number | null; p_sort?: string; p_limit?: number; p_offset?: number;
        };
        Returns: Json;
      };
      get_mutual_friends: { Args: { p_user: string; p_limit?: number }; Returns: Json };
      get_friends_list: { Args: { p_user?: string | null; p_query?: string; p_limit?: number; p_offset?: number }; Returns: Json };
      get_friend_requests: { Args: { p_direction?: string; p_limit?: number }; Returns: Json };
      match_find: { Args: Record<string, never>; Returns: Json };
      match_leave: { Args: Record<string, never>; Returns: undefined };
      admin_discovery_abuse: { Args: { p_hours?: number }; Returns: Json };
    };
    Enums: {
      gender_type: GenderType;
      account_status_type: AccountStatus;
      admin_role_type: AdminRoleType;
      request_status: RequestStatus;
      audience_type: AudienceType;
      theme_preference: ThemePreference;
      report_target_type: ReportTargetType;
      report_status: ReportStatus;
      device_platform: DevicePlatform;
    };
    CompositeTypes: { [_ in never]: never };
  };
}
