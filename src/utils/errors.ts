/**
 * Converts Supabase / Postgres / network errors into short, user-facing messages.
 * Database functions raise well-known codes (e.g. USERNAME_COOLDOWN) which are
 * mapped here so the UI never shows raw SQL errors.
 */

const KNOWN_MESSAGES: Record<string, string> = {
  USERNAME_COOLDOWN: 'You can change your username once every 14 days.',
  USERNAME_RESERVED: 'That username is reserved.',
  AGE_REQUIREMENT: 'You must be at least 16 years old to use Friendzy.',
  INVALID_BIRTH_DATE: 'Please enter a valid date of birth.',
  INTEREST_LIMIT: 'You can pick up to 10 interests.',
  NOT_AUTHENTICATED: 'Please sign in again.',
  CANNOT_FOLLOW_SELF: 'You cannot follow yourself.',
  CANNOT_FRIEND_SELF: 'You cannot add yourself as a friend.',
  CANNOT_BLOCK_SELF: 'You cannot block yourself.',
  PROFILE_NOT_FOUND: 'This profile is not available.',
  REQUEST_NOT_FOUND: 'This request is no longer available.',
  ALREADY_FRIENDS: 'You are already friends.',
  BLOCKED: 'This action is not available.',
  FORBIDDEN: 'You do not have permission to do that.',
  INSUFFICIENT_COINS: 'You do not have enough coins.',
  PREMIUM_REQUIRED: 'This is a Friendzy Premium perk.',
  ADULTS_ONLY: 'This feature is available from age 18.',
  ACCOUNT_SUSPENDED: 'Your account is currently restricted.',
  ACCOUNT_RESTRICTED: 'Your account is currently restricted.',
  FEATURE_RESTRICTED: 'This feature is temporarily unavailable on your account.',
  ALREADY_IN_GAME: 'Leave your current game before starting another.',
  ROOM_FULL: 'This game room is full.',
  ROOM_CLOSED: 'This game has already started.',
  ROOM_NOT_FOUND: 'That game room does not exist or the code is wrong.',
  PRIVATE_ROOM: 'You need an invite or the room code to join.',
  NOT_YOUR_TURN: 'Wait for your turn.',
  ILLEGAL_MOVE: 'That move is not allowed.',
  STALE: 'The game moved on — refreshing.',
  LIVE_NOT_FOUND: 'This live is not available.',
  ALREADY_LIVE: 'End your current broadcast before starting another.',
  SLOW_MODE: 'Slow mode is on. Wait a moment before commenting again.',
  MUTED: 'You are muted in this live.',
  BANNED: 'You cannot join this live.',
  WITHDRAWALS_DISABLED: 'Withdrawals open once payouts are enabled. Your earnings stay in your balance.',
  BELOW_MINIMUM: 'That amount is below the minimum withdrawal.',
  INSUFFICIENT_EARNINGS: 'Not enough available earnings.',
  WITHDRAWAL_PENDING: 'You already have a withdrawal in progress.',
  VIDEO_NOT_FOUND: 'This video is not available.',
  REQUEST_PENDING: 'Your previous request is still being reviewed.',
  ALREADY_VERIFIED: 'Your account is already verified.',
  profiles_username_key: 'That username is already taken.',
  profiles_username_format: 'Use only lowercase letters, numbers, underscores and periods.',
  profiles_display_name_len: 'Display name must be between 1 and 50 characters.',
  profiles_bio_len: 'Bio must be 300 characters or fewer.',
};

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Incorrect email or password.',
  email_not_confirmed: 'Please confirm your email address first. Check your inbox for the verification link.',
  user_already_exists: 'An account with this email already exists. Try signing in instead.',
  email_exists: 'An account with this email already exists. Try signing in instead.',
  weak_password: 'Please choose a stronger password.',
  over_email_send_rate_limit: 'Too many emails were sent recently. Please wait a minute and try again.',
  over_request_rate_limit: 'Too many attempts. Please wait a moment and try again.',
  same_password: 'Choose a password you have not used before.',
  otp_expired: 'This link has expired. Please request a new one.',
  session_not_found: 'Your session has expired. Please sign in again.',
  reauthentication_needed: 'Please sign in again to confirm this change.',
  signup_disabled: 'Sign-ups are currently disabled.',
  validation_failed: 'Please check the information you entered.',
  bad_code_verifier: 'This link was opened in a different browser or device. Request a new link and open it here.',
  flow_state_not_found: 'This link was opened in a different browser or device. Request a new link and open it here.',
};

type ErrorLike = { message?: unknown; code?: unknown; details?: unknown; hint?: unknown; status?: unknown } | null | undefined;

export function getErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!error) return fallback;
  if (typeof error === 'string') return mapMessage(error) ?? error;

  const e = error as ErrorLike;
  const code = typeof e?.code === 'string' ? e.code : undefined;
  const message = typeof e?.message === 'string' ? e.message : undefined;
  const hint = typeof e?.hint === 'string' ? e.hint : undefined;
  const details = typeof e?.details === 'string' ? e.details : undefined;

  if (code && AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
  if (message) {
    const mapped = mapMessage(message);
    if (mapped) return mapped;
  }
  if (details) {
    const mapped = mapMessage(details);
    if (mapped) return mapped;
  }
  if (hint) return hint;

  if (message) {
    if (/network request failed|failed to fetch|load failed/i.test(message)) {
      return 'No internet connection. Check your network and try again.';
    }
    if (/jwt|token/i.test(message) && /expired|invalid/i.test(message)) {
      return 'Your session has expired. Please sign in again.';
    }
    if (/row-level security/i.test(message)) return 'You do not have permission to do that.';
    if (/database error saving new user/i.test(message)) {
      return 'We could not create your account. Check your details (you must be at least 16) and try again.';
    }
    if (/schema cache|relation .* does not exist|could not find the table/i.test(message)) {
      return 'The Friendzy database is not set up yet. Apply the Supabase migrations (see docs/SETUP.md).';
    }
    if (/rate limit/i.test(message)) return 'Too many attempts. Please wait a moment and try again.';
    return message;
  }
  return fallback;
}

function mapMessage(raw: string): string | null {
  for (const key of Object.keys(KNOWN_MESSAGES)) {
    if (raw.includes(key)) return KNOWN_MESSAGES[key];
  }
  for (const key of Object.keys(AUTH_MESSAGES)) {
    if (raw.toLowerCase().includes(key.replace(/_/g, ' ')) || raw.includes(key)) return AUTH_MESSAGES[key];
  }
  if (/duplicate key value/i.test(raw) && /username/i.test(raw)) return 'That username is already taken.';
  return null;
}

export class AppError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'AppError';
  }
}
