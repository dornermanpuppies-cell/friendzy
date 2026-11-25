import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useTheme } from '@/theme/ThemeProvider';
import { layout, spacing } from '@/theme/tokens';

export interface ScreenHeaderProps {
  title?: string;
  subtitle?: string;
  back?: boolean;
  fallbackHref?: string;
  right?: ReactNode;
  left?: ReactNode;
  transparent?: boolean;
  /** Tint for icons/text when placed over media. */
  light?: boolean;
  large?: boolean;
}

export function goBackOr(fallback: string) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback as never);
}

export function ScreenHeader({ title, subtitle, back = true, fallbackHref = '/home', right, left, transparent = false, light = false, large = false }: ScreenHeaderProps) {
  const { colors } = useTheme();
  const { isDesktop } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const tint = light ? '#FFFFFF' : colors.text;

  return (
    <View
      style={[
        styles.container,
        { paddingTop: isDesktop ? spacing.sm : 0, backgroundColor: transparent ? 'transparent' : colors.background, borderBottomColor: colors.border },
        !transparent && !large && styles.border,
        isDesktop && { paddingHorizontal: spacing['3xl'] },
        { minHeight: layout.topBarHeight + (isDesktop ? spacing.sm : 0) },
        transparent && { position: 'absolute', top: insets.top, left: 0, right: 0, zIndex: 10 },
      ]}
    >
      <View style={styles.side}>
        {left ??
          (back ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={8}
              onPress={() => goBackOr(fallbackHref)}
              style={({ pressed }) => [styles.backButton, light && styles.backLight, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="arrow-back" size={22} color={tint} />
            </Pressable>
          ) : null)}
      </View>
      {title ? (
        <View style={[styles.titleWrap, large && styles.titleLarge]}>
          <Text variant={large ? 'h2' : 'h4'} style={{ color: tint }} numberOfLines={1} align={large ? 'left' : 'center'}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="small" color={light ? 'rgba(255,255,255,0.8)' : 'textMuted'} numberOfLines={1} align={large ? 'left' : 'center'}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={styles.titleWrap} />
      )}
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm },
  border: { borderBottomWidth: StyleSheet.hairlineWidth },
  side: { minWidth: 48, flexDirection: 'row', alignItems: 'center' },
  right: { justifyContent: 'flex-end' },
  backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  backLight: { backgroundColor: 'rgba(9,8,23,0.35)' },
  titleWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  titleLarge: { alignItems: 'flex-start', paddingLeft: spacing.sm },
});
