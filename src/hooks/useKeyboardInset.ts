import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Height of the on-screen keyboard currently covering the app, in pixels (0 when it is closed).
 *
 * On the web the app box is already resized to the visible area by the bootstrap in `src/app/+html.tsx`,
 * so layout fixes itself and this hook is only useful for components that need the number (for
 * example to scroll something into view). On iOS and Android it reports the real keyboard height.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const vv = typeof window !== 'undefined' ? window.visualViewport : null;
      if (!vv) return;
      const read = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
      read();
      vv.addEventListener('resize', read);
      vv.addEventListener('scroll', read);
      return () => {
        vv.removeEventListener('resize', read);
        vv.removeEventListener('scroll', read);
      };
    }
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setInset(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return inset;
}
