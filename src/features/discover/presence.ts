import { countryName, flagEmoji } from '@/constants/countries';
import type { CardPresence, DiscoverCard } from '@/types/social';
import { timeAgo } from '@/utils/format';

export interface PresenceLabel {
  text: string;
  tone: 'online' | 'muted';
  activity: boolean;
}

/** Human label for a discovery card's presence (already privacy-filtered by the server). */
export function presenceLabel(presence: CardPresence | null | undefined): PresenceLabel | null {
  if (!presence) return null;
  if (presence.is_online && presence.activity === 'chatting') return { text: 'Chatting now', tone: 'online', activity: true };
  if (presence.is_online && presence.activity === 'live') return { text: 'Live now', tone: 'online', activity: true };
  if (presence.is_online && presence.activity === 'gaming') return { text: 'Playing a game', tone: 'online', activity: true };
  if (presence.is_online) return { text: 'Online now', tone: 'online', activity: false };
  if (presence.last_seen_at) return { text: `Active ${timeAgo(presence.last_seen_at)}`, tone: 'muted', activity: false };
  return null;
}

/** "🇺🇸 Austin, United States" — only the parts the owner chose to share. */
export function locationLabel(card: Pick<DiscoverCard, 'country_code' | 'city'>): string {
  if (!card.country_code) return '';
  return `${flagEmoji(card.country_code)} ${card.city ? `${card.city}, ` : ''}${countryName(card.country_code)}`;
}

/** "@username · 24 · 🇺🇸 Austin, United States" */
export function personMeta(card: DiscoverCard, options: { username?: boolean } = {}): string {
  const parts: string[] = [];
  if (options.username !== false) parts.push(`@${card.username}`);
  if (card.age) parts.push(String(card.age));
  const location = locationLabel(card);
  if (location) parts.push(location);
  return parts.join(' · ');
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
