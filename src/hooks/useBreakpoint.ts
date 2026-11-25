import { Platform, useWindowDimensions } from 'react-native';

import { breakpoints } from '@/theme/tokens';

export interface Breakpoint {
  width: number;
  height: number;
  /** < 768px: phone layout with bottom tabs */
  isMobile: boolean;
  /** 768–1023px */
  isTablet: boolean;
  /** >= 1024px: desktop layout with sidebar */
  isDesktop: boolean;
  /** >= 1280px: wide desktop with secondary column */
  isWide: boolean;
  isWeb: boolean;
}

export function useBreakpoint(): Breakpoint {
  const { width, height } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  return {
    width,
    height,
    isMobile: width < breakpoints.md,
    isTablet: width >= breakpoints.md && width < breakpoints.lg,
    isDesktop: isWeb && width >= breakpoints.lg,
    isWide: isWeb && width >= breakpoints.xl,
    isWeb,
  };
}
