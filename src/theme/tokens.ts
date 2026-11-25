import { Platform } from 'react-native';

/**
 * Friendzy design tokens — the single source of truth for colour, spacing,
 * radius, typography and elevation across web, Android and iOS.
 */

export const palette = {
  purple: '#7000FF',
  purpleDeep: '#35006B',
  purpleSoft: '#A366FF',
  pink: '#FF28B9',
  pinkSoft: '#FF7AD1',
  blue: '#276BFF',
  blueSoft: '#6E9BFF',
  lavender: '#F3EEFF',
  lavenderDeep: '#E6DBFF',
  white: '#FFFFFF',
  black: '#000000',
  ink: '#171326',
  ink2: '#3D3850',
  ink3: '#6B6680',
  ink4: '#9E98B3',
  night: '#090817',
  night2: '#151326',
  night3: '#1F1C33',
  night4: '#2B2744',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#FF4D6D',
  info: '#38BDF8',
  gold: '#FFC857',
} as const;

export const gradients = {
  /** Primary action gradient (purple → pink). */
  primary: [palette.purple, palette.pink] as const,
  /** Cool brand gradient (blue → purple). */
  cool: [palette.blue, palette.purple] as const,
  /** Full brand spectrum (blue → purple → pink). */
  brand: [palette.blue, palette.purple, palette.pink] as const,
  /** Story ring gradient. */
  ring: [palette.pink, palette.purple, palette.blue] as const,
  /** Dark hero backgrounds. */
  nightHero: ['#1B0B3E', palette.night] as const,
  /** Premium / gold accent. */
  premium: ['#FFC857', '#FF28B9', '#7000FF'] as const,
} as const;

export type ColorScheme = 'light' | 'dark';

export interface ThemeColors {
  background: string;
  backgroundElevated: string;
  surface: string;
  surfaceMuted: string;
  surfaceStrong: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  primary: string;
  primarySoft: string;
  accent: string;
  accentSoft: string;
  blue: string;
  success: string;
  warning: string;
  danger: string;
  overlay: string;
  skeleton: string;
  tabBar: string;
  tabIcon: string;
  tabIconActive: string;
  inputBackground: string;
  placeholder: string;
  glow: string;
}

export const lightColors: ThemeColors = {
  background: palette.white,
  backgroundElevated: palette.white,
  surface: palette.white,
  surfaceMuted: palette.lavender,
  surfaceStrong: palette.lavenderDeep,
  border: '#ECE7F6',
  borderStrong: '#D9D1EC',
  text: palette.ink,
  textSecondary: palette.ink2,
  textMuted: palette.ink3,
  textInverse: palette.white,
  primary: palette.purple,
  primarySoft: 'rgba(112, 0, 255, 0.10)',
  accent: palette.pink,
  accentSoft: 'rgba(255, 40, 185, 0.12)',
  blue: palette.blue,
  success: palette.success,
  warning: palette.warning,
  danger: palette.danger,
  overlay: 'rgba(9, 8, 23, 0.55)',
  skeleton: '#EDE8F7',
  tabBar: 'rgba(255,255,255,0.96)',
  tabIcon: palette.ink3,
  tabIconActive: palette.purple,
  inputBackground: '#F7F4FD',
  placeholder: palette.ink4,
  glow: 'rgba(112, 0, 255, 0.35)',
};

export const darkColors: ThemeColors = {
  background: palette.night,
  backgroundElevated: palette.night2,
  surface: palette.night2,
  surfaceMuted: palette.night3,
  surfaceStrong: palette.night4,
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',
  text: palette.white,
  textSecondary: '#D4CFE6',
  textMuted: '#9E98B3',
  textInverse: palette.ink,
  primary: palette.purpleSoft,
  primarySoft: 'rgba(163, 102, 255, 0.18)',
  accent: palette.pink,
  accentSoft: 'rgba(255, 40, 185, 0.18)',
  blue: palette.blueSoft,
  success: palette.success,
  warning: palette.warning,
  danger: palette.danger,
  overlay: 'rgba(0, 0, 0, 0.6)',
  skeleton: palette.night3,
  tabBar: 'rgba(9, 8, 23, 0.94)',
  tabIcon: '#9E98B3',
  tabIconActive: palette.white,
  inputBackground: palette.night3,
  placeholder: '#7C7693',
  glow: 'rgba(255, 40, 185, 0.35)',
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
  '6xl': 64,
} as const;

export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  '2xl': 32,
  full: 999,
} as const;

export const fontFamily = {
  display: 'PlusJakartaSans',
  body: 'Inter',
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string,
} as const;

export const typography = {
  hero: { fontFamily: fontFamily.display, fontSize: 44, lineHeight: 50, fontWeight: '800' as const, letterSpacing: -1 },
  h1: { fontFamily: fontFamily.display, fontSize: 32, lineHeight: 38, fontWeight: '800' as const, letterSpacing: -0.6 },
  h2: { fontFamily: fontFamily.display, fontSize: 26, lineHeight: 32, fontWeight: '700' as const, letterSpacing: -0.4 },
  h3: { fontFamily: fontFamily.display, fontSize: 21, lineHeight: 27, fontWeight: '700' as const, letterSpacing: -0.2 },
  h4: { fontFamily: fontFamily.display, fontSize: 17, lineHeight: 23, fontWeight: '700' as const },
  bodyLg: { fontFamily: fontFamily.body, fontSize: 17, lineHeight: 26, fontWeight: '400' as const },
  body: { fontFamily: fontFamily.body, fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  bodyMedium: { fontFamily: fontFamily.body, fontSize: 15, lineHeight: 22, fontWeight: '500' as const },
  bodySemibold: { fontFamily: fontFamily.body, fontSize: 15, lineHeight: 22, fontWeight: '600' as const },
  small: { fontFamily: fontFamily.body, fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  smallMedium: { fontFamily: fontFamily.body, fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
  caption: { fontFamily: fontFamily.body, fontSize: 11, lineHeight: 15, fontWeight: '500' as const, letterSpacing: 0.2 },
  button: { fontFamily: fontFamily.display, fontSize: 15, lineHeight: 20, fontWeight: '700' as const },
  label: { fontFamily: fontFamily.body, fontSize: 12, lineHeight: 16, fontWeight: '600' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const },
} as const;

export type TypographyVariant = keyof typeof typography;

export const shadows = {
  sm: Platform.select({
    web: { boxShadow: '0 2px 10px rgba(23, 19, 38, 0.06)' },
    default: { shadowColor: '#171326', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  }) as object,
  md: Platform.select({
    web: { boxShadow: '0 8px 28px rgba(23, 19, 38, 0.10)' },
    default: { shadowColor: '#171326', shadowOpacity: 0.1, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  }) as object,
  glow: Platform.select({
    web: { boxShadow: '0 10px 30px rgba(112, 0, 255, 0.35)' },
    default: { shadowColor: '#7000FF', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  }) as object,
  glowPink: Platform.select({
    web: { boxShadow: '0 10px 30px rgba(255, 40, 185, 0.40)' },
    default: { shadowColor: '#FF28B9', shadowOpacity: 0.4, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  }) as object,
} as const;

export const breakpoints = {
  sm: 480,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

export const layout = {
  maxContentWidth: 640,
  maxPageWidth: 1200,
  sidebarWidth: 248,
  sidebarCollapsedWidth: 80,
  tabBarHeight: 64,
  topBarHeight: 56,
} as const;

export const durations = { fast: 120, base: 200, slow: 320 } as const;

/** Plain object version of StyleSheet.absoluteFill (spreadable). */
export const absoluteFillObject = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } as const;
