import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, usePathname } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { Avatar } from '@/components/ui/Avatar';
import { CountBadge } from '@/components/ui/Badge';
import { Logo } from '@/components/ui/Logo';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/store/authStore';
import { useBadgeStore } from '@/store/badgeStore';
import { useTheme } from '@/theme/ThemeProvider';
import { gradients, layout, palette, radius, shadows, spacing } from '@/theme/tokens';

interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
  badgeKey?: 'notifications' | 'inbox' | 'requests';
  match?: (pathname: string) => boolean;
}

const PRIMARY: NavItem[] = [
  { href: '/home', label: 'Home', icon: 'home-outline', activeIcon: 'home' },
  { href: '/discover', label: 'Discover', icon: 'compass-outline', activeIcon: 'compass' },
  { href: '/videos', label: 'Videos', icon: 'play-circle-outline', activeIcon: 'play-circle' },
  { href: '/search', label: 'Search', icon: 'search-outline', activeIcon: 'search' },
  { href: '/live', label: 'LIVE', icon: 'radio-outline', activeIcon: 'radio' },
  { href: '/games', label: 'Games', icon: 'game-controller-outline', activeIcon: 'game-controller' },
  { href: '/wallet', label: 'Wallet', icon: 'wallet-outline', activeIcon: 'wallet' },
  { href: '/inbox', label: 'Inbox', icon: 'chatbubbles-outline', activeIcon: 'chatbubbles', badgeKey: 'inbox' },
  { href: '/calls', label: 'Calls', icon: 'call-outline', activeIcon: 'call' },
  { href: '/notifications', label: 'Notifications', icon: 'notifications-outline', activeIcon: 'notifications', badgeKey: 'notifications' },
  { href: '/requests', label: 'Requests', icon: 'person-add-outline', activeIcon: 'person-add', badgeKey: 'requests' },
  {
    href: '/profile',
    label: 'Profile',
    icon: 'person-outline',
    activeIcon: 'person',
    match: (p) => p === '/profile' || p.startsWith('/profile/'),
  },
];

/** Desktop navigation for the logged-in web app. */
export function Sidebar() {
  const { colors, isDark } = useTheme();
  const pathname = usePathname();
  const { profile } = useAuth();
  const badges = useBadgeStore(useShallow((s) => ({ notifications: s.notifications, inbox: s.inbox, requests: s.requests })));

  return (
    <View style={[styles.container, { width: layout.sidebarWidth, backgroundColor: colors.background, borderRightColor: colors.border }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.navigate('/home')} style={styles.logo} accessibilityRole="link" accessibilityLabel="Friendzy home">
          <Logo size={34} />
        </Pressable>

        <View style={styles.nav}>
          {PRIMARY.map((item) => {
            const active = item.match ? item.match(pathname) : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const badge = item.badgeKey ? badges[item.badgeKey] : 0;
            return (
              <Pressable
                key={item.href}
                accessibilityRole="link"
                accessibilityState={{ selected: active }}
                onPress={() => router.navigate(item.href as never)}
                style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
                  styles.item,
                  active && { backgroundColor: isDark ? colors.surfaceMuted : colors.primarySoft },
                  (hovered || pressed) && !active && { backgroundColor: colors.surfaceMuted },
                ]}
              >
                <Ionicons name={active ? item.activeIcon : item.icon} size={22} color={active ? colors.primary : colors.textSecondary} />
                <Text variant={active ? 'bodySemibold' : 'bodyMedium'} color={active ? 'primary' : 'textSecondary'} style={styles.itemLabel}>
                  {item.label}
                </Text>
                {badge ? <CountBadge count={badge} /> : null}
              </Pressable>
            );
          })}
        </View>

        <Pressable onPress={() => router.navigate('/create')} accessibilityRole="button" style={({ pressed }) => [styles.createWrap, shadows.glow, pressed && { opacity: 0.9 }]}>
          <LinearGradient colors={[...gradients.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.create}>
            <Ionicons name="add-circle" size={22} color={palette.white} />
            <Text variant="button" color={palette.white} style={{ marginLeft: spacing.sm }}>
              Create
            </Text>
          </LinearGradient>
        </Pressable>

        <View style={styles.spacer} />

        <Pressable
          onPress={() => router.navigate('/settings')}
          accessibilityRole="link"
          style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
            styles.account,
            { borderColor: colors.border },
            (hovered || pressed) && { backgroundColor: colors.surfaceMuted },
          ]}
        >
          <Avatar uri={profile?.avatar_url} name={profile?.display_name} size={40} verified={profile?.is_verified} />
          <View style={styles.accountTexts}>
            <Text variant="bodySemibold" numberOfLines={1}>
              {profile?.display_name ?? 'Your account'}
            </Text>
            <Text variant="small" color="textMuted" numberOfLines={1}>
              {profile ? `@${profile.username}` : 'Settings'}
            </Text>
          </View>
          <Ionicons name="settings-outline" size={18} color={colors.textMuted} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRightWidth: StyleSheet.hairlineWidth, height: '100%' },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingVertical: spacing['2xl'] },
  logo: { paddingHorizontal: spacing.sm, marginBottom: spacing['3xl'] },
  nav: { gap: spacing.xs },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer', transitionDuration: '120ms' } as object) : null),
  },
  itemLabel: { marginLeft: spacing.md, flex: 1 },
  createWrap: { marginTop: spacing['2xl'], borderRadius: radius.full },
  create: { height: 48, borderRadius: radius.full, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  spacer: { flex: 1, minHeight: spacing['3xl'] },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : null),
  },
  accountTexts: { flex: 1, marginHorizontal: spacing.md },
});
