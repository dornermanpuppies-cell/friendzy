import { router } from 'expo-router';
import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { IconButton } from '@/components/ui/IconButton';
import { Logo } from '@/components/ui/Logo';
import { Text } from '@/components/ui/Text';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useBadgeStore } from '@/store/badgeStore';
import { useTheme } from '@/theme/ThemeProvider';
import { layout, spacing } from '@/theme/tokens';

export interface TopBarProps {
  title?: string;
  showLogo?: boolean;
  right?: ReactNode;
  /** Show inbox + notifications shortcuts (mobile only; desktop has them in the sidebar). */
  showShortcuts?: boolean;
  transparent?: boolean;
}

/** Top bar for the main tab screens on phones and tablets. */
export function TopBar({ title, showLogo = false, right, showShortcuts = true, transparent = false }: TopBarProps) {
  const { colors } = useTheme();
  const { isDesktop } = useBreakpoint();
  const badges = useBadgeStore(useShallow((s) => ({ notifications: s.notifications, inbox: s.inbox })));

  if (isDesktop) {
    if (!title && !right) return null;
    return (
      <View style={[styles.desktop, { borderBottomColor: colors.border }]}>
        {title ? <Text variant="h2">{title}</Text> : <View />}
        <View style={styles.right}>{right}</View>
      </View>
    );
  }

  return (
    <View style={[styles.bar, { backgroundColor: transparent ? 'transparent' : colors.background, borderBottomColor: colors.border }, !transparent && styles.border]}>
      <View style={styles.left}>{showLogo ? <Logo size={30} /> : title ? <Text variant="h3">{title}</Text> : null}</View>
      <View style={styles.right}>
        {right}
        {showShortcuts ? (
          <>
            <IconButton icon="notifications-outline" accessibilityLabel="Notifications" badge={badges.notifications} onPress={() => router.navigate('/notifications')} />
            <IconButton icon="chatbubble-ellipses-outline" accessibilityLabel="Inbox" badge={badges.inbox} onPress={() => router.navigate('/inbox')} />
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: layout.topBarHeight, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md },
  border: { borderBottomWidth: StyleSheet.hairlineWidth },
  desktop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['3xl'],
    paddingVertical: spacing.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    maxWidth: layout.maxContentWidth + spacing['3xl'] * 2,
    width: '100%',
    alignSelf: 'center',
  },
  left: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.xs },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
