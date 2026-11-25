import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { touchPresence } from '@/services/presence';

const INTERVAL_MS = 60_000;

/** Keeps the signed-in user's presence fresh while the app is in the foreground. */
export function usePresenceHeartbeat(userId: string | undefined, enabled = true) {
  useEffect(() => {
    if (!userId || !enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      void touchPresence(true);
      if (timer) clearInterval(timer);
      timer = setInterval(() => void touchPresence(true), INTERVAL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
      void touchPresence(false);
    };

    start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') start();
      else stop();
    });

    let visibility: (() => void) | null = null;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());
      document.addEventListener('visibilitychange', onVisibility);
      visibility = () => document.removeEventListener('visibilitychange', onVisibility);
    }

    return () => {
      sub.remove();
      visibility?.();
      if (timer) clearInterval(timer);
      void touchPresence(false);
    };
  }, [userId, enabled]);
}
