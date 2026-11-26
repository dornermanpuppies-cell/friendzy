import { Ionicons } from '@/components/ui/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/ui/EmptyState';
import { Text } from '@/components/ui/Text';
import { VideoGrid } from '@/features/video/VideoGrid';
import { useAsync } from '@/hooks/useAsync';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { getUserLives } from '@/services/live';
import { fetchUserVideos } from '@/services/videos';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { VideoCard } from '@/types/video';
import { formatCount, formatDate } from '@/utils/format';

/** Short videos ("Reels") grid for a profile. */
export function ReelsTab({ userId, isOwner }: { userId: string; isOwner: boolean }) {
  const query = usePagedQuery<VideoCard>((cursor) => fetchUserVideos(userId, typeof cursor === 'string' ? cursor : null), (v) => v.id, `reels:${userId}`);
  return (
    <VideoGrid
      query={query}
      empty={{ emoji: '✨', title: 'No reels yet', description: isOwner ? 'Record or upload a short video from the Create tab.' : 'Short videos appear here once published.', action: isOwner ? { title: 'Create a video', onPress: () => router.navigate('/compose/video' as never) } : undefined }}
    />
  );
}

/** Past and upcoming livestreams of a profile. */
export function LiveHistoryTab({ userId, isOwner }: { userId: string; isOwner: boolean }) {
  const { colors } = useTheme();
  const lives = useAsync(() => getUserLives(userId, 30), [userId]);
  if (lives.loading) return <ActivityIndicator color={colors.primary} style={{ padding: spacing['2xl'] }} />;
  if (!lives.data || lives.data.length === 0) {
    return <EmptyState compact emoji="📡" title="No live history" description={isOwner ? 'Go live from the Create tab — your broadcasts will be listed here.' : 'Past broadcasts appear here.'} action={isOwner ? { title: 'Go LIVE', onPress: () => router.navigate('/live/go' as never) } : undefined} />;
  }
  return (
    <View style={{ padding: spacing.md, gap: spacing.sm }}>
      {lives.data.map((l) => (
        <Pressable key={l.id} onPress={() => router.navigate(`/live/${l.id}` as never)} style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.cover, { backgroundColor: palette.night3 }]}>
            {l.cover_url ? <Image source={{ uri: l.cover_url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="radio" size={20} color={palette.white} />}
            {l.status === 'live' ? (
              <View style={styles.liveBadge}>
                <Text variant="caption" color={palette.white}>
                  LIVE
                </Text>
              </View>
            ) : null}
          </View>
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text variant="bodySemibold" numberOfLines={1}>
              {l.title}
            </Text>
            <Text variant="caption" color="textMuted">
              {l.status === 'scheduled' ? `Scheduled · ${formatDate(l.scheduled_at, 'd MMM, HH:mm')}` : l.status === 'live' ? `${formatCount(l.viewers_count)} watching now` : `${formatDate(l.started_at ?? l.created_at, 'd MMM yyyy')} · ${formatCount(l.total_views)} views · ${formatCount(l.likes_count)} likes`}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.sm, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  cover: { width: 56, height: 72, borderRadius: radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  liveBadge: { position: 'absolute', top: 4, left: 4, backgroundColor: palette.danger, borderRadius: 4, paddingHorizontal: 4 },
});
