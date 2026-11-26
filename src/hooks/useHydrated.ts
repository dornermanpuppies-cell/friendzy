import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;

/**
 * `false` during the server render and the browser's hydration pass, `true` afterwards (and always
 * `true` on iOS/Android, which never hydrate). Use it for anything that cannot be rendered
 * identically by the static export and the browser — fonts, icons, viewport-dependent layout —
 * so React does not throw hydration errors on the public website pages.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
