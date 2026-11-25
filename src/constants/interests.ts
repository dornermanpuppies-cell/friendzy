/**
 * Fallback interest catalogue. The database table `interests` is the source of
 * truth (seeded by the Phase 1 migration); this list is used only when the
 * catalogue cannot be loaded (offline / misconfigured backend).
 */
export interface InterestItem {
  id: number;
  slug: string;
  name: string;
  emoji: string | null;
  category: string;
  sort_order: number;
}

export const MAX_INTERESTS = 10;
export const MIN_INTERESTS = 3;

export const FALLBACK_INTERESTS: InterestItem[] = [
  { id: -1, slug: 'music', name: 'Music', emoji: '🎵', category: 'Entertainment', sort_order: 1 },
  { id: -2, slug: 'movies', name: 'Movies & Series', emoji: '🎬', category: 'Entertainment', sort_order: 2 },
  { id: -3, slug: 'gaming', name: 'Gaming', emoji: '🎮', category: 'Entertainment', sort_order: 3 },
  { id: -4, slug: 'anime', name: 'Anime & Manga', emoji: '🍥', category: 'Entertainment', sort_order: 4 },
  { id: -5, slug: 'kpop', name: 'K-Pop', emoji: '💜', category: 'Entertainment', sort_order: 5 },
  { id: -6, slug: 'comedy', name: 'Comedy & Memes', emoji: '😂', category: 'Entertainment', sort_order: 6 },
  { id: -7, slug: 'live-streaming', name: 'Live streaming', emoji: '📡', category: 'Entertainment', sort_order: 7 },
  { id: -8, slug: 'podcasts', name: 'Podcasts', emoji: '🎙️', category: 'Entertainment', sort_order: 8 },
  { id: -9, slug: 'football', name: 'Football', emoji: '⚽', category: 'Sports', sort_order: 10 },
  { id: -10, slug: 'basketball', name: 'Basketball', emoji: '🏀', category: 'Sports', sort_order: 11 },
  { id: -11, slug: 'fitness', name: 'Fitness & Gym', emoji: '💪', category: 'Sports', sort_order: 12 },
  { id: -12, slug: 'running', name: 'Running', emoji: '🏃', category: 'Sports', sort_order: 13 },
  { id: -13, slug: 'yoga', name: 'Yoga & Wellness', emoji: '🧘', category: 'Sports', sort_order: 14 },
  { id: -14, slug: 'esports', name: 'Esports', emoji: '🏆', category: 'Sports', sort_order: 15 },
  { id: -15, slug: 'travel', name: 'Travel', emoji: '✈️', category: 'Lifestyle', sort_order: 20 },
  { id: -16, slug: 'food', name: 'Food & Cooking', emoji: '🍜', category: 'Lifestyle', sort_order: 21 },
  { id: -17, slug: 'fashion', name: 'Fashion', emoji: '👗', category: 'Lifestyle', sort_order: 22 },
  { id: -18, slug: 'beauty', name: 'Beauty & Skincare', emoji: '💄', category: 'Lifestyle', sort_order: 23 },
  { id: -19, slug: 'pets', name: 'Pets & Animals', emoji: '🐶', category: 'Lifestyle', sort_order: 24 },
  { id: -20, slug: 'cars', name: 'Cars & Motors', emoji: '🏎️', category: 'Lifestyle', sort_order: 25 },
  { id: -21, slug: 'coffee', name: 'Coffee & Cafés', emoji: '☕', category: 'Lifestyle', sort_order: 26 },
  { id: -22, slug: 'nightlife', name: 'Nightlife & Parties', emoji: '🪩', category: 'Lifestyle', sort_order: 27 },
  { id: -23, slug: 'nature', name: 'Nature & Outdoors', emoji: '🌿', category: 'Lifestyle', sort_order: 28 },
  { id: -24, slug: 'photography', name: 'Photography', emoji: '📸', category: 'Creative', sort_order: 30 },
  { id: -25, slug: 'art', name: 'Art & Design', emoji: '🎨', category: 'Creative', sort_order: 31 },
  { id: -26, slug: 'dance', name: 'Dance', emoji: '💃', category: 'Creative', sort_order: 32 },
  { id: -27, slug: 'singing', name: 'Singing', emoji: '🎤', category: 'Creative', sort_order: 33 },
  { id: -28, slug: 'writing', name: 'Writing & Poetry', emoji: '✍️', category: 'Creative', sort_order: 34 },
  { id: -29, slug: 'content-creation', name: 'Content creation', emoji: '🎥', category: 'Creative', sort_order: 35 },
  { id: -30, slug: 'technology', name: 'Technology', emoji: '💻', category: 'Tech & Learning', sort_order: 40 },
  { id: -31, slug: 'ai', name: 'AI & Future', emoji: '🤖', category: 'Tech & Learning', sort_order: 41 },
  { id: -32, slug: 'science', name: 'Science & Space', emoji: '🚀', category: 'Tech & Learning', sort_order: 43 },
  { id: -33, slug: 'books', name: 'Books & Reading', emoji: '📚', category: 'Tech & Learning', sort_order: 44 },
  { id: -34, slug: 'languages', name: 'Language exchange', emoji: '🗣️', category: 'Tech & Learning', sort_order: 45 },
  { id: -35, slug: 'entrepreneurship', name: 'Startups & Business', emoji: '💼', category: 'Tech & Learning', sort_order: 46 },
  { id: -36, slug: 'making-friends', name: 'Making new friends', emoji: '🤝', category: 'Social', sort_order: 50 },
  { id: -37, slug: 'deep-talks', name: 'Deep conversations', emoji: '💭', category: 'Social', sort_order: 51 },
  { id: -38, slug: 'voice-chats', name: 'Voice chats', emoji: '🎧', category: 'Social', sort_order: 52 },
  { id: -39, slug: 'board-games', name: 'Board games & Trivia', emoji: '🎲', category: 'Social', sort_order: 53 },
  { id: -40, slug: 'motivation', name: 'Motivation & Growth', emoji: '🌟', category: 'Social', sort_order: 56 },
];

/** What people are looking for on Friendzy (stored in user_settings.looking_for). */
export const LOOKING_FOR_OPTIONS = [
  { id: 'friends', label: 'New friends', emoji: '🤝' },
  { id: 'chat', label: 'Chat & voice calls', emoji: '💬' },
  { id: 'gaming', label: 'Gaming buddies', emoji: '🎮' },
  { id: 'language', label: 'Language exchange', emoji: '🗣️' },
  { id: 'creators', label: 'Creators & live', emoji: '📡' },
  { id: 'local', label: 'People nearby', emoji: '📍' },
  { id: 'worldwide', label: 'People worldwide', emoji: '🌍' },
] as const;

export type LookingForId = (typeof LOOKING_FOR_OPTIONS)[number]['id'];
