import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

/**
 * Progressive-web-app install state for the website.
 *
 * `src/app/+html.tsx` stores the browser's `beforeinstallprompt` event on
 * `window.__friendzyInstallPrompt` before React hydrates and re-broadcasts it as
 * `friendzy:installable`; this hook turns that into render-safe state and a
 * `prompt()` action. Everything is derived through useSyncExternalStore so the
 * statically rendered HTML and the first client render agree (no hydration mismatch).
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    __friendzyInstallPrompt?: BeforeInstallPromptEvent | null;
    __friendzyInstalled?: boolean;
  }
}

export type InstallPlatform = 'ios' | 'android' | 'desktop' | 'native';
export type InstallBrowser = 'safari' | 'chrome' | 'samsung' | 'firefox' | 'edge' | 'other';

export interface InstallState {
  /** True once the client has mounted; before that, platform/browser are placeholders. */
  hydrated: boolean;
  /** Running inside the installed web app (home-screen icon) or the native app. */
  standalone: boolean;
  /** The browser handed us a native install prompt that `prompt()` can show. */
  canPrompt: boolean;
  /** The user installed the app during this visit. */
  installed: boolean;
  platform: InstallPlatform;
  browser: InstallBrowser;
  prompt: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

const subscribeNoop = () => () => undefined;

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('friendzy:installable', onChange);
  window.addEventListener('appinstalled', onChange);
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(display-mode: standalone)') : null;
  media?.addEventListener?.('change', onChange);
  return () => {
    window.removeEventListener('friendzy:installable', onChange);
    window.removeEventListener('appinstalled', onChange);
    media?.removeEventListener?.('change', onChange);
  };
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const media = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return Boolean(media || iosStandalone);
}

function snapshot(): string {
  if (typeof window === 'undefined') return 'ssr';
  return `${window.__friendzyInstallPrompt ? 1 : 0}|${isStandaloneDisplay() ? 1 : 0}|${window.__friendzyInstalled ? 1 : 0}`;
}

function detect(): { platform: InstallPlatform; browser: InstallBrowser } {
  if (Platform.OS !== 'web') return { platform: 'native', browser: 'other' };
  if (typeof navigator === 'undefined') return { platform: 'desktop', browser: 'other' };
  const ua = navigator.userAgent;
  const iPadDesktopMode = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const platform: InstallPlatform = /iPhone|iPad|iPod/.test(ua) || iPadDesktopMode ? 'ios' : /Android/.test(ua) ? 'android' : 'desktop';
  const browser: InstallBrowser = /SamsungBrowser/.test(ua) ? 'samsung' : /Edg\//.test(ua) ? 'edge' : /FxiOS|Firefox/.test(ua) ? 'firefox' : /CriOS|Chrome/.test(ua) ? 'chrome' : /Safari/.test(ua) ? 'safari' : 'other';
  return { platform, browser };
}

export function useInstallPrompt(): InstallState {
  const hydrated = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const state = useSyncExternalStore(subscribe, snapshot, () => 'ssr');
  const [canPromptFlag, standaloneFlag, installedFlag] = state === 'ssr' ? ['0', '0', '0'] : state.split('|');
  const detected = useMemo(() => (hydrated ? detect() : { platform: 'desktop' as InstallPlatform, browser: 'other' as InstallBrowser }), [hydrated]);

  const prompt = useCallback(async () => {
    const event = typeof window !== 'undefined' ? window.__friendzyInstallPrompt : null;
    if (!event) return 'unavailable' as const;
    await event.prompt();
    const choice = await event.userChoice;
    window.__friendzyInstallPrompt = null;
    if (choice.outcome === 'accepted') window.__friendzyInstalled = true;
    window.dispatchEvent(new Event('friendzy:installable'));
    return choice.outcome;
  }, []);

  return {
    hydrated,
    standalone: Platform.OS !== 'web' || standaloneFlag === '1',
    canPrompt: canPromptFlag === '1',
    installed: installedFlag === '1',
    platform: detected.platform,
    browser: detected.browser,
    prompt,
  };
}
