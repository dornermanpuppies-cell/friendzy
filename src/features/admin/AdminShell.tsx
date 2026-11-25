import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

export const ADMIN_SECTIONS: { href: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { href: '/admin', label: 'Overview', icon: 'speedometer-outline' },
  { href: '/admin/users', label: 'Users', icon: 'people-outline' },
  { href: '/admin/reports', label: 'Reports', icon: 'flag-outline' },
  { href: '/admin/content', label: 'Content', icon: 'images-outline' },
  { href: '/admin/lives', label: 'Lives', icon: 'radio-outline' },
  { href: '/admin/finance', label: 'Finance', icon: 'cash-outline' },
  { href: '/admin/verification', label: 'Verification', icon: 'checkmark-circle-outline' },
  { href: '/admin/site', label: 'Site content', icon: 'megaphone-outline' },
  { href: '/admin/settings', label: 'Settings', icon: 'settings-outline' },
  { href: '/admin/audit', label: 'Audit log', icon: 'document-text-outline' },
  { href: '/admin/admins', label: 'Admins', icon: 'shield-outline' },
];

export function AdminShell({ title, children, right, refreshing, onRefresh }: PropsWithChildren<{ title: string; right?: ReactNode; refreshing?: boolean; onRefresh?: () => void }>) {
  const { isAdmin } = useAuth();
  const { colors } = useTheme();
  const pathname = usePathname();
  if (!isAdmin) {
    return (
      <Screen header={<ScreenHeader title="Administration" fallbackHref="/settings" />}>
        <EmptyState icon="lock-closed-outline" title="Admin access required" description="Your account does not have an administrator role. Roles are granted server-side by a super admin." action={{ title: 'Back to settings', onPress: () => router.replace('/settings') }} />
      </Screen>
    );
  }
  return (
    <Screen header={<ScreenHeader title={title} fallbackHref="/settings" right={right} />} scroll padded maxWidth={1100} refreshing={refreshing} onRefresh={onRefresh}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.nav}>
        {ADMIN_SECTIONS.map((s) => {
          const active = s.href === '/admin' ? pathname === '/admin' : pathname.startsWith(s.href);
          return (
            <Pressable key={s.href} onPress={() => router.navigate(s.href as never)} style={[styles.navItem, { backgroundColor: active ? colors.primary : colors.surfaceMuted }]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
              <Ionicons name={s.icon} size={16} color={active ? '#fff' : colors.textSecondary} />
              <Text variant="smallMedium" color={active ? '#FFFFFF' : 'textSecondary'} style={{ marginLeft: 6 }}>
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {children}
    </Screen>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'danger' | 'success' | 'warning' }) {
  const { colors } = useTheme();
  const color = tone === 'danger' ? colors.danger : tone === 'success' ? colors.success : tone === 'warning' ? colors.warning : colors.text;
  return (
    <Card style={styles.stat}>
      <Text variant="h3" color={color}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </Text>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      {hint ? (
        <Text variant="caption" color="textMuted">
          {hint}
        </Text>
      ) : null}
    </Card>
  );
}

export function MiniBars({ data, color, height = 72 }: { data: number[]; color: string; height?: number }) {
  const max = Math.max(1, ...data);
  return (
    <View style={[styles.bars, { height }]}>
      {data.map((v, i) => (
        <View key={i} style={styles.barCol}>
          <View style={{ height: Math.max(2, (v / max) * (height - 8)), backgroundColor: color, borderRadius: 2 }} />
        </View>
      ))}
    </View>
  );
}

export function Row({ children, onPress }: PropsWithChildren<{ onPress?: () => void }>) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={[styles.row, { borderBottomColor: colors.border }]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  nav: { gap: spacing.xs, paddingVertical: spacing.md },
  navItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, height: 34, borderRadius: radius.full },
  stat: { minWidth: 150, flexGrow: 1 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, marginTop: spacing.sm },
  barCol: { flex: 1, justifyContent: 'flex-end' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, gap: spacing.sm },
});
