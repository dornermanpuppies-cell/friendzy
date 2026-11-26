import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

/**
 * Size of the area the user can actually see.
 *
 * `useWindowDimensions()` reports the layout viewport, which on a phone browser does not shrink when
 * the on-screen keyboard opens — a full-height element then runs off the bottom of the visible box and
 * takes the input with it. This reads `visualViewport` instead, so full-screen surfaces (the live
 * stage, the story viewer) stay inside the visible area while someone is typing. Native platforms get
 * the normal window dimensions, where the keyboard already resizes the screen.
 */
export function useViewportSize(): { width: number; height: number } {
  const window = useWindowDimensions();
  const [visual, setVisual] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof globalThis.window === 'undefined') return;
    const vv = globalThis.window.visualViewport;
    if (!vv) return;
    const read = () => setVisual({ width: Math.round(vv.width), height: Math.round(vv.height) });
    read();
    vv.addEventListener('resize', read);
    return () => vv.removeEventListener('resize', read);
  }, []);

  if (Platform.OS !== 'web' || !visual) return { width: window.width, height: window.height };
  // Width stays with the layout viewport: visualViewport.width also changes when the user pinch-zooms.
  return { width: window.width, height: Math.min(visual.height, window.height) };
}
