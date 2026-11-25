import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { TabListProps, TabTriggerSlotProps } from 'expo-router/ui';
import { type PropsWithChildren } from 'react';
import { Platform, Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { gradients, layout, palette, radius, shadows, spacing } from '@/theme/tokens';

export type TabIcon = { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap };

export const TAB_ICONS: Record<'home' | 'discover' | 'live' | 'profile', TabIcon> = {
  home: { active: 'home', inactive: 'home-outline' },
  discover: { active: 'compass', inactive: 'compass-outline' },
  live: { active: 'radio', inactive: 'radio-outline' },
  profile: { active: 'person', inactive: 'person-outline' },
};

/** Container rendered via `<TabList asChild>`; hidden on desktop where the sidebar takes over. */
export function MobileTabBar({ children, hidden, style, ...props }: PropsWithChildren<TabListProps & { hidden?: boolean }>) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (hidden) {
    return (
      <View {...props} style={styles.hidden} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {children}
      </View>
    );
  }
  return (
    <View
      {...props}
      style={[
        styles.bar,
        { backgroundColor: colors.tabBar, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 8 : 6) },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function TabButton({ icon, label, isFocused, badge, style: _style, ...props }: TabTriggerSlotProps & { icon: TabIcon; label: string; badge?: number }) {
  const { colors } = useTheme();
  const color = isFocused ? colors.tabIconActive : colors.tabIcon;
  return (
    <Pressable {...(props as unknown as PressableProps)} accessibilityRole="tab" accessibilityState={{ selected: Boolean(isFocused) }} accessibilityLabel={label} style={({ pressed }) => [styles.tab, pressed && { opacity: 0.7 }]}>
      <View>
        <Ionicons name={isFocused ? icon.active : icon.inactive} size={24} color={color} />
        {badge ? (
          <View style={styles.badge}>
            <Text variant="caption" color={palette.white} style={styles.badgeText}>
              {badge > 99 ? '99+' : badge}
            </Text>
          </View>
        ) : null}
      </View>
      <Text variant="caption" style={{ color, marginTop: 3, fontWeight: isFocused ? '700' : '500' }}>
        {label}
      </Text>
      {isFocused ? <View style={[styles.indicator, { backgroundColor: colors.tabIconActive }]} /> : null}
    </Pressable>
  );
}

/** The prominent gradient Create button in the middle of the tab bar. */
export function CreateTabButton({ isFocused, style: _style, ...props }: TabTriggerSlotProps) {
  return (
    <Pressable {...(props as unknown as PressableProps)} accessibilityRole="tab" accessibilityLabel="Create" accessibilityState={{ selected: Boolean(isFocused) }} style={({ pressed }) => [styles.tab, pressed && { opacity: 0.8 }]}>
      <View style={[styles.createOuter, shadows.glowPink]}>
        <LinearGradient colors={[...gradients.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.create}>
          <Ionicons name="add" size={28} color={palette.white} />
        </LinearGradient>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    minHeight: layout.tabBarHeight,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' } as object) : null),
  },
  hidden: { height: 0, width: 0, overflow: 'hidden', position: 'absolute', opacity: 0 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: spacing.xs, minHeight: 50, ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : null) },
  indicator: { position: 'absolute', top: -spacing.sm, width: 18, height: 3, borderRadius: 2 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: palette.pink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 9, lineHeight: 11, fontWeight: '700' },
  createOuter: { marginBottom: 6, borderRadius: radius.full },
  create: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
});
