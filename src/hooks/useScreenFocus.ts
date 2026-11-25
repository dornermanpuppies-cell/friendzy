import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

/** True while the screen is focused (used to pause media when navigating away). */
export function useScreenFocus(): boolean {
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return focused;
}
