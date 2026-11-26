import { palette } from '@/theme/tokens';

export interface ChatWallpaper {
  id: string;
  label: string;
  colors: [string, string];
  /** Bubble tint for the other person's messages on this wallpaper. */
  bubble: string;
  textOnBubble: string;
}

export const WALLPAPERS: ChatWallpaper[] = [
  { id: 'default', label: 'Night', colors: ['#120F26', palette.night], bubble: palette.night3, textOnBubble: palette.white },
  { id: 'violet', label: 'Violet', colors: ['#2A0F5A', '#140A2E'], bubble: 'rgba(255,255,255,0.12)', textOnBubble: palette.white },
  { id: 'ocean', label: 'Ocean', colors: ['#0B2A5B', '#0A1636'], bubble: 'rgba(255,255,255,0.12)', textOnBubble: palette.white },
  { id: 'sunset', label: 'Sunset', colors: ['#4A1033', '#1B0B20'], bubble: 'rgba(255,255,255,0.12)', textOnBubble: palette.white },
  { id: 'forest', label: 'Forest', colors: ['#0F3B2E', '#0A1F1A'], bubble: 'rgba(255,255,255,0.12)', textOnBubble: palette.white },
  { id: 'mono', label: 'Charcoal', colors: ['#1F1F24', '#0E0E12'], bubble: '#2A2A33', textOnBubble: palette.white },
  { id: 'lavender', label: 'Lavender', colors: ['#F3EEFF', '#E6DBFF'], bubble: palette.white, textOnBubble: palette.ink },
  { id: 'cream', label: 'Cream', colors: ['#FFF6E9', '#FFE8D1'], bubble: palette.white, textOnBubble: palette.ink },
];

/** Bubble styling used on top of a photo: a dark scrim keeps text readable on any picture. */
export const PHOTO_WALLPAPER: ChatWallpaper = {
  id: 'photo',
  label: 'Your photo',
  colors: [palette.night, palette.night],
  bubble: 'rgba(16,14,34,0.72)',
  textOnBubble: palette.white,
};

/** How much the photo is darkened so message text stays readable. */
export const PHOTO_SCRIM = 'rgba(9,8,23,0.45)';

export function wallpaperFor(id: string | null | undefined): ChatWallpaper {
  if (typeof id === 'string' && id.startsWith('img:')) return PHOTO_WALLPAPER;
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0];
}

export function isLightWallpaper(w: ChatWallpaper): boolean {
  return w.id === 'lavender' || w.id === 'cream';
}
