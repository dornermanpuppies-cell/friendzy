import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, use, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type PropsWithChildren } from 'react';
import { useColorScheme as useSystemScheme } from 'react-native';

import { useAuthStore } from '@/store/authStore';
import { darkColors, lightColors, type ColorScheme, type ThemeColors } from '@/theme/tokens';
import { ACCENTS } from '@/types/economy';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'friendzy.theme-preference';

interface ThemeContextValue {
  scheme: ColorScheme;
  colors: ThemeColors;
  isDark: boolean;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  /** Premium accent id (default = Friendzy purple). */
  accent: string;
  /** True once the client has mounted (used to avoid hydration mismatches on web). */
  hydrated: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const subscribeNoop = () => () => undefined;

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

/** Applies a Premium accent on top of the base palette (primary colour + soft tints). */
export function applyAccent(base: ThemeColors, accentId: string, dark: boolean): ThemeColors {
  const accent = ACCENTS.find((a) => a.id === accentId);
  if (!accent || accent.id === 'default') return base;
  const primary = dark ? accent.colors[0] : accent.primary;
  return { ...base, primary, primarySoft: hexToRgba(primary, dark ? 0.2 : 0.1), tabIconActive: dark ? base.tabIconActive : primary, glow: hexToRgba(primary, 0.35) };
}

/**
 * Resolves the device colour scheme in a hydration-safe way: static HTML is always
 * rendered with the light theme (server snapshot), and the client switches to the
 * real scheme immediately after hydration.
 */
function useHydratedSystemScheme(): { scheme: ColorScheme; hydrated: boolean } {
  const hydrated = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const system = useSystemScheme();
  return { scheme: hydrated && system === 'dark' ? 'dark' : 'light', hydrated };
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const { scheme: systemScheme, hydrated } = useHydratedSystemScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const accent = useAuthStore((s) => s.settings?.accent ?? 'default');

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (!cancelled && (value === 'light' || value === 'dark' || value === 'system')) {
          setPreferenceState(value);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const scheme: ColorScheme = preference === 'system' ? systemScheme : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      scheme,
      colors: applyAccent(scheme === 'dark' ? darkColors : lightColors, accent, scheme === 'dark'),
      isDark: scheme === 'dark',
      preference,
      setPreference,
      accent,
      hydrated,
    }),
    [scheme, preference, setPreference, hydrated, accent],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Forces a colour scheme for a subtree. Friendzy uses dark surfaces for
 * messaging, video and live screens and light surfaces for discovery,
 * profiles and settings.
 */
export function ThemeScope({ scheme, children }: PropsWithChildren<{ scheme: ColorScheme }>) {
  const parent = use(ThemeContext);
  const accent = parent?.accent ?? 'default';
  const value = useMemo<ThemeContextValue>(
    () => ({
      scheme,
      colors: applyAccent(scheme === 'dark' ? darkColors : lightColors, accent, scheme === 'dark'),
      isDark: scheme === 'dark',
      preference: parent?.preference ?? 'system',
      setPreference: parent?.setPreference ?? (() => undefined),
      accent,
      hydrated: parent?.hydrated ?? true,
    }),
    [scheme, parent, accent],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = use(ThemeContext);
  if (!ctx) {
    // Allow usage outside the provider (tests, static rendering edge cases).
    return {
      scheme: 'light',
      colors: lightColors,
      isDark: false,
      preference: 'system',
      setPreference: () => undefined,
      accent: 'default',
      hydrated: true,
    };
  }
  return ctx;
}
