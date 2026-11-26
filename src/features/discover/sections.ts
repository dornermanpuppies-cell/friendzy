import type { Ionicons } from '@/components/ui/Ionicons';

import type { DiscoverSection } from '@/types/social';

export interface DiscoverSectionMeta {
  id: DiscoverSection;
  title: string;
  short: string;
  icon: keyof typeof Ionicons.glyphMap;
  description: string;
  emptyTitle: string;
  emptyText: string;
}

/** The eight Discover sections, in display order. */
export const DISCOVER_SECTIONS: DiscoverSectionMeta[] = [
  { id: 'recommended', title: 'Recommended for you', short: 'For you', icon: 'sparkles-outline', description: 'Based on your interests, languages, country and mutual friends.', emptyTitle: 'No recommendations yet', emptyText: 'Add a few interests and languages to your profile so we can find people like you.' },
  { id: 'online', title: 'People online now', short: 'Online', icon: 'radio-button-on-outline', description: 'People who are active right now and share their online status.', emptyTitle: 'Nobody is online right now', emptyText: 'Check back in a few minutes — Friendzy is worldwide, so someone is usually around.' },
  { id: 'nearby', title: 'People near you', short: 'Nearby', icon: 'location-outline', description: 'People within 50 km who also turned on nearby discovery. Only approximate locations are used.', emptyTitle: 'No one nearby yet', emptyText: 'Turn on nearby discovery to find people around you. Your exact location is never shared.' },
  { id: 'new', title: 'New members', short: 'New', icon: 'leaf-outline', description: 'People who joined Friendzy in the last 30 days.', emptyTitle: 'No new members yet', emptyText: 'New people join every day — invite your friends to get started.' },
  { id: 'popular', title: 'Popular profiles', short: 'Popular', icon: 'flame-outline', description: 'The most followed and most active members.', emptyTitle: 'Nobody here yet', emptyText: 'Popular profiles will show up as the community grows.' },
  { id: 'interests', title: 'People who share your interests', short: 'Interests', icon: 'heart-outline', description: 'Members with at least one interest in common with you.', emptyTitle: 'No shared interests yet', emptyText: 'Pick interests on your profile to find people who love the same things.' },
  { id: 'countries', title: 'People from other countries', short: 'Worldwide', icon: 'globe-outline', description: 'Meet people around the world — one country at a time.', emptyTitle: 'No international members yet', emptyText: 'People from other countries will appear here once they join.' },
  { id: 'active', title: 'Recently active members', short: 'Active', icon: 'time-outline', description: 'People who were active in the last 24 hours.', emptyTitle: 'No recent activity', emptyText: 'Members who were active recently will show up here.' },
];

export const DISCOVER_SECTION_IDS = DISCOVER_SECTIONS.map((s) => s.id);

export function getDiscoverSection(id: string | undefined | null): DiscoverSectionMeta {
  return DISCOVER_SECTIONS.find((s) => s.id === id) ?? DISCOVER_SECTIONS[0];
}

export function isDiscoverSection(id: string | undefined | null): id is DiscoverSection {
  return DISCOVER_SECTION_IDS.includes(id as DiscoverSection);
}
