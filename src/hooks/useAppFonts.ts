import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { useFonts } from 'expo-font';
import { useEffect } from 'react';

import { fontFamily } from '@/theme/tokens';

/**
 * Loads the Friendzy typefaces as weighted families so components can use
 * `fontFamily` + `fontWeight` consistently on web, Android and iOS.
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts([
    {
      fontFamily: fontFamily.display,
      fontDefinitions: [
        { path: PlusJakartaSans_400Regular, weight: 400 },
        { path: PlusJakartaSans_500Medium, weight: 500 },
        { path: PlusJakartaSans_600SemiBold, weight: 600 },
        { path: PlusJakartaSans_700Bold, weight: 700 },
        { path: PlusJakartaSans_800ExtraBold, weight: 800 },
      ],
    },
    {
      fontFamily: fontFamily.body,
      fontDefinitions: [
        { path: Inter_400Regular, weight: 400 },
        { path: Inter_500Medium, weight: 500 },
        { path: Inter_600SemiBold, weight: 600 },
        { path: Inter_700Bold, weight: 700 },
      ],
    },
  ]);

  useEffect(() => {
    if (error) console.warn('[fonts] failed to load custom fonts, falling back to system fonts', error);
  }, [error]);

  return loaded || Boolean(error);
}
