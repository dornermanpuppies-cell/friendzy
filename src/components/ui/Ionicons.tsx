import { Ionicons as ExpoIonicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { useHydrated } from '@/hooks/useHydrated';

type IoniconsProps = ComponentProps<typeof ExpoIonicons>;
export type IoniconsName = IoniconsProps['name'];

/**
 * Ionicons that hydrate cleanly on the static website.
 *
 * The icon font is not available while Expo pre-renders the HTML, so `@expo/vector-icons` emits an
 * empty text node there and the real glyph in the browser — React then reports hydration error #418
 * on every public page that shows an icon. Rendering a same-sized placeholder until hydration has
 * finished keeps both renders identical; on iOS/Android (no hydration) the icon renders immediately.
 */
function HydratedIonicons(props: IoniconsProps) {
  const hydrated = useHydrated();
  if (!hydrated) {
    const size = props.size ?? 12;
    return <View style={[{ width: size, height: size }, StyleSheet.flatten(props.style as never)]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
  }
  return <ExpoIonicons {...props} />;
}

export const Ionicons = Object.assign(HydratedIonicons, { glyphMap: ExpoIonicons.glyphMap });
