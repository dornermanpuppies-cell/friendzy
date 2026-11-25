import type { AuthorCard } from '@/types/social';

export type ConversationKind = 'direct' | 'group';
export type MemberRole = 'owner' | 'admin' | 'member';
export type MessageKind = 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'gif' | 'location' | 'post' | 'profile' | 'story_reply' | 'video_share' | 'call' | 'system';
export type MessageStatus = 'sending' | 'failed' | 'sent' | 'delivered' | 'read';

export interface ConversationSummary {
  id: string;
  kind: ConversationKind;
  title: string | null;
  avatar_url: string | null;
  description: string | null;
  other_user: AuthorCard | null;
  members_count: number;
  last_message: {
    id: string;
    kind: MessageKind;
    preview: string;
    sender_id: string | null;
    sender_name: string | null;
    created_at: string;
    is_mine: boolean;
    status: MessageStatus | null;
  } | null;
  last_message_at: string | null;
  unread_count: number;
  is_request: boolean;
  my_role: MemberRole;
  muted_until: string | null;
  is_muted: boolean;
  is_archived: boolean;
  is_pinned: boolean;
  marked_unread: boolean;
  wallpaper: string | null;
  notifications: boolean;
  disappearing_seconds: number;
  join_approval: boolean;
  created_at: string;
}

export interface ConversationDetail extends ConversationSummary {
  members: (AuthorCard & { role: MemberRole; joined_at: string })[];
  pins: Message[];
  invite_code: string | null;
  is_admin: boolean;
  pending_requests: number;
}

export interface MessageAttachment {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'document';
  path: string;
  name: string | null;
  mime: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  thumbnail_path: string | null;
  waveform: number[] | null;
}

export interface MessageReactionGroup {
  emoji: string;
  count: number;
  users: AuthorCard[];
}

export interface MessageMetadata {
  // location
  lat?: number;
  lng?: number;
  name?: string;
  // shared content
  post_id?: string;
  profile_id?: string;
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
  video_id?: string;
  thumbnail_url?: string | null;
  // story reply
  story_id?: string;
  story_kind?: string;
  story_text?: string;
  // sticker / gif
  sticker_id?: number;
  emoji?: string;
  url?: string;
  // call
  call_id?: string;
  call_kind?: 'voice' | 'video';
  duration_seconds?: number;
  outcome?: 'answered' | 'missed' | 'declined' | 'cancelled';
  // system
  event?: string;
  [key: string]: unknown;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender: AuthorCard | null;
  kind: MessageKind;
  text: string | null;
  metadata: MessageMetadata;
  attachments: MessageAttachment[];
  reply_to: { id: string; sender: AuthorCard | null; kind: MessageKind; preview: string; deleted: boolean } | null;
  reactions: MessageReactionGroup[];
  my_reaction: string | null;
  starred: boolean;
  pinned: boolean;
  forwarded: boolean;
  edited_at: string | null;
  deleted: boolean;
  expires_at: string | null;
  created_at: string;
  client_id: string | null;
  is_mine: boolean;
  status: MessageStatus | null;
  /** Local-only: the conversation summary when returned from search / starred lists. */
  conversation?: ConversationSummary;
  /** Local-only: upload progress for optimistic sends. */
  upload_progress?: number;
  /** Local-only: last error for failed sends. */
  error?: string;
}

export interface TypingUser {
  user_id: string;
  name: string;
  until: number;
}

export interface Sticker {
  id: number;
  pack: string;
  emoji: string | null;
  url: string | null;
  label: string | null;
}

export type InboxFilter = 'inbox' | 'unread' | 'groups' | 'requests' | 'archived';

export const DISAPPEARING_OPTIONS = [
  { seconds: 0, label: 'Off' },
  { seconds: 86400, label: '24 hours' },
  { seconds: 604800, label: '7 days' },
  { seconds: 7776000, label: '90 days' },
] as const;

export const MUTE_OPTIONS = [
  { label: '8 hours', hours: 8 },
  { label: '1 week', hours: 24 * 7 },
  { label: 'Always', hours: 24 * 365 * 50 },
] as const;
