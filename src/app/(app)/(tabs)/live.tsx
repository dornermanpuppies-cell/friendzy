import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { TopBar } from '@/components/layout/TopBar';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { BannerRail } from '@/features/site/AnnouncementBar';
import { useAsync } from '@/hooks/useAsync';
import { getLiveDiscovery, setLiveReminder } from '@/services/live';
import { ThemeScope } from '@/theme/ThemeProvider';
import { gradients, palette, radius, shadows, spacing } from '@/theme/tokens';
import { LIVE_CATEGORIES, type LiveCategory, type LiveSession } from '@/types/live';
import { getErrorMessage } from '@/utils/errors';
import { formatCount, formatDate } from '@/utils/format';

function LiveCard({ live, width }: { live: LiveSession; width: number }) {
  return (
    <Pressable onPress={() => router.navigate(`/live/${live.id}` as never)} style={[styles.card, { width }]} accessibilityLabel={`Watch ${live.host.display_name}: ${live.title}`}>
      {live.cover_url ? <Image source={{ uri: live.cover_url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <LinearGradient colors={[...gradients.cool]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
      <LinearGradient colors={['rgba(0,0,0,0.1)', 'transparent', 'rgba(9,8,23,0.9)']} style={StyleSheet.absoluteFill} />
      <View style={styles.cardTop}>
        <View style={styles.liveBadge}>
          <Text variant="caption" color={palette.white}>
            LIVE
          </Text>
        </View>
        <View style={styles.viewers}>
          <Ionicons name="eye" size={12} color={palette.white} />
          <Text variant="caption" color={palette.white} style={{ marginLeft: 3 }}>
            {formatCount(live.viewers_count)}
          </Text>
        </View>
      </View>
      <View style={styles.cardBottom}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Avatar uri={live.host.avatar_url} name={live.host.display_name} size={24} />
          <Text variant="caption" color={palette.white} numberOfLines={1} style={{ marginLeft: 6, flex: 1 }}>
            {live.host.display_name}
          </Text>
        </View>
        <Text variant="smallMedium" color={palette.white} numberOfLines={2} style={{ marginTop: 2 }}>
          {live.title}
        </Text>
        {live.battle ? (
          <Text variant="caption" color={palette.gold}>
            ⚔️ Battle in progress
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function LiveScreen() {
  const { width } = useWindowDimensions();
  const toast = useToast();
  const [category, setCategory] = useState<LiveCategory | null>(null);
  const discovery = useAsync(() => getLiveDiscovery(category), [category]);

  useFocusEffect(
    useCallback(() => {
      void discovery.refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [category]),
  );

  const columns = width >= 1024 ? 4 : width >= 600 ? 3 : 2;
  const cardWidth = Math.floor((Math.min(width, 1200) - spacing.lg * 2 - spacing.sm * (columns - 1)) / columns);
  const data = discovery.data;

  const remind = async (live: LiveSession) => {
    try {
      await setLiveReminder(live.id, !live.reminder_set);
      await discovery.refresh();
      toast.success(live.reminder_set ? 'Reminder removed' : "We'll notify you when it starts");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <ThemeScope scheme="dark">
      <Screen header={<TopBar title="LIVE" right={<Button title="Go LIVE" size="sm" leftIcon="radio-outline" glow onPress={() => router.navigate('/live/go' as never)} />} />} scroll padded backgroundColor={palette.night} refreshing={discovery.refreshing} onRefresh={() => void discovery.refresh()}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>
          <Chip label="All" size="sm" selected={category === null} onPress={() => setCategory(null)} />
          {LIVE_CATEGORIES.map((c) => (
            <Chip key={c.id} label={c.label} emoji={c.emoji} size="sm" selected={category === c.id} onPress={() => setCategory(c.id)} />
          ))}
        </ScrollView>
        <BannerRail placement="live" />

        {discovery.loading && !data ? (
          <View style={[styles.grid, { marginTop: spacing.lg }]}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} width={cardWidth} height={cardWidth * 1.35} rounded={18} />
            ))}
          </View>
        ) : discovery.error ? (
          <EmptyState icon="cloud-offline-outline" title="Couldn't load lives" description={discovery.error} action={{ title: 'Retry', onPress: () => void discovery.reload(), variant: 'secondary' }} />
        ) : data ? (
          <>
            {data.following.length > 0 ? (
              <>
                <Text variant="h4" color={palette.white} style={styles.section}>
                  From people you follow
                </Text>
                <View style={styles.grid}>
                  {data.following.map((l) => (
                    <LiveCard key={l.id} live={l} width={cardWidth} />
                  ))}
                </View>
              </>
            ) : null}
            <Text variant="h4" color={palette.white} style={styles.section}>
              Live now
            </Text>
            {data.live.length === 0 ? (
              <View style={[styles.empty, { borderColor: 'rgba(255,255,255,0.1)' }]}>
                <EmptyState compact icon="radio-outline" title={category ? `Nobody is live in ${LIVE_CATEGORIES.find((c) => c.id === category)?.label ?? 'this category'}` : 'Nobody is live right now'} description="Be the first — go live and your followers get notified." action={{ title: 'Go LIVE', onPress: () => router.navigate('/live/go' as never), leftIcon: 'radio-outline' }} />
              </View>
            ) : (
              <View style={styles.grid}>
                {data.live.map((l) => (
                  <LiveCard key={l.id} live={l} width={cardWidth} />
                ))}
              </View>
            )}

            {data.scheduled.length > 0 ? (
              <>
                <Text variant="h4" color={palette.white} style={styles.section}>
                  Upcoming
                </Text>
                {data.scheduled.map((l) => (
                  <Pressable key={l.id} onPress={() => router.navigate(`/live/${l.id}` as never)} style={styles.upcoming}>
                    <Avatar uri={l.host.avatar_url} name={l.host.display_name} size={44} />
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <Text variant="bodySemibold" color={palette.white} numberOfLines={1}>
                        {l.title}
                      </Text>
                      <Text variant="caption" color="rgba(255,255,255,0.7)">
                        {l.host.display_name} · {formatDate(l.scheduled_at, 'EEE d MMM, HH:mm')}
                      </Text>
                    </View>
                    {l.is_host ? <Button title="Start" size="sm" onPress={() => router.navigate(`/live/${l.id}` as never)} /> : <Button title={l.reminder_set ? 'Reminder on' : 'Remind me'} size="sm" variant={l.reminder_set ? 'secondary' : 'outline'} leftIcon={l.reminder_set ? 'notifications' : 'notifications-outline'} onPress={() => void remind(l)} />}
                  </Pressable>
                ))}
              </>
            ) : null}

            {data.trending_hosts.length > 0 ? (
              <>
                <Text variant="h4" color={palette.white} style={styles.section}>
                  Trending hosts this week
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
                  {data.trending_hosts.map((h) => (
                    <Pressable key={h.id} onPress={() => router.navigate(`/u/${h.username}` as never)} style={styles.host}>
                      <Avatar uri={h.avatar_url} name={h.display_name} size={56} verified={h.is_verified} />
                      <Text variant="caption" color={palette.white} numberOfLines={1} style={{ marginTop: 4 }}>
                        {h.display_name}
                      </Text>
                      <Text variant="caption" color="rgba(255,255,255,0.6)">
                        {formatCount(h.total_views)} views
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}

            <Pressable onPress={() => router.navigate('/live/go' as never)} style={[styles.cta, shadows.glowPink]}>
              <LinearGradient colors={[palette.pink, palette.purple]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              <Ionicons name="radio" size={28} color={palette.white} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text variant="h4" color={palette.white}>
                  Start your own live
                </Text>
                <Text variant="caption" color="rgba(255,255,255,0.85)">
                  Multi-guest stage, battles, gifts and a fan club — from any device.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={palette.white} />
            </Pressable>
          </>
        ) : null}
      </Screen>
    </ThemeScope>
  );
}

const styles = StyleSheet.create({
  categories: { gap: spacing.sm, paddingVertical: spacing.md },
  section: { marginTop: spacing.xl, marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: { aspectRatio: 0.74, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: palette.night3 },
  cardTop: { position: 'absolute', top: spacing.sm, left: spacing.sm, right: spacing.sm, flexDirection: 'row', justifyContent: 'space-between' },
  liveBadge: { backgroundColor: palette.danger, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  viewers: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: radius.full, paddingHorizontal: 6, paddingVertical: 2 },
  cardBottom: { position: 'absolute', left: spacing.sm, right: spacing.sm, bottom: spacing.sm },
  empty: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.xl, padding: spacing.md },
  upcoming: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  host: { width: 84, alignItems: 'center' },
  cta: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, borderRadius: radius.xl, overflow: 'hidden', marginTop: spacing['2xl'], marginBottom: spacing['3xl'] },
});
