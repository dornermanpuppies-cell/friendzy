import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useAsync } from '@/hooks/useAsync';
import { dismissAnnouncement, getActiveAnnouncements, getBanners } from '@/services/siteContent';
import { useTheme } from '@/theme/ThemeProvider';
import { gradients, palette, radius, spacing } from '@/theme/tokens';
import type { Banner } from '@/types/admin';

const KIND_ICON = { info: 'information-circle', update: 'sparkles', warning: 'warning', promo: 'gift' } as const;

function open(link: string | null) {
  if (!link) return;
  router.navigate(link as never);
}

/** Admin announcements (dismissible) shown at the top of Home. */
export function AnnouncementBar() {
  const { colors } = useTheme();
  const items = useAsync(() => getActiveAnnouncements(), []);
  if (!items.data || items.data.length === 0) return null;
  const a = items.data[0];
  const tone = a.kind === 'warning' ? colors.warning : a.kind === 'promo' ? colors.accent : colors.primary;
  return (
    <Pressable onPress={() => open(a.link)} style={[styles.bar, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]} accessibilityRole={a.link ? 'link' : 'text'}>
      <Ionicons name={KIND_ICON[a.kind] ?? 'information-circle'} size={20} color={tone} />
      <View style={{ flex: 1, marginHorizontal: spacing.sm }}>
        <Text variant="smallMedium">{a.title}</Text>
        <Text variant="caption" color="textMuted" numberOfLines={2}>
          {a.body}
        </Text>
      </View>
      <Pressable onPress={() => { void dismissAnnouncement(a.id); items.setData((prev) => (prev ?? []).filter((x) => x.id !== a.id)); }} hitSlop={8} accessibilityLabel="Dismiss announcement">
        <Ionicons name="close" size={18} color={colors.textMuted} />
      </Pressable>
    </Pressable>
  );
}

/** Promotional banners configured by admins for a placement. */
export function BannerRail({ placement }: { placement: Banner['placement'] }) {
  const banners = useAsync(() => getBanners(placement), [placement]);
  if (!banners.data || banners.data.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
      {banners.data.map((b) => (
        <Pressable key={b.id} onPress={() => open(b.link)} style={styles.banner} accessibilityRole="link" accessibilityLabel={b.title}>
          {b.image_url ? <Image source={{ uri: b.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
          <LinearGradient colors={['transparent', 'rgba(9,8,23,0.8)']} style={StyleSheet.absoluteFill} />
          <View style={styles.bannerText}>
            <Text variant="bodySemibold" color={palette.white} numberOfLines={1}>
              {b.title}
            </Text>
            {b.subtitle ? (
              <Text variant="caption" color="rgba(255,255,255,0.85)" numberOfLines={2}>
                {b.subtitle}
              </Text>
            ) : null}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  rail: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  banner: { width: 260, height: 110, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: palette.night3 },
  bannerText: { position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.sm },
});
