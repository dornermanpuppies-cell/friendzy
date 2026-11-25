import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Button } from '@/components/ui/Button';
import { EmptyState, type EmptyStateProps } from '@/components/ui/EmptyState';
import { Text } from '@/components/ui/Text';
import type { PagedQuery } from '@/hooks/usePagedQuery';
import { useVideoStore } from '@/store/videoStore';
import { useTheme } from '@/theme/ThemeProvider';
import { layout, palette, spacing } from '@/theme/tokens';
import type { VideoCard } from '@/types/video';
import { formatCount } from '@/utils/format';

export interface VideoGridProps {
  query: PagedQuery<VideoCard>;
  empty: Pick<EmptyStateProps, 'emoji' | 'title' | 'description' | 'action'>;
  /** Where tapping a thumbnail goes; defaults to the single video page. */
  onOpen?: (video: VideoCard, index: number) => void;
  columns?: number;
}

/** 3-up thumbnail grid used on profiles, hashtags, sounds and saved videos. */
export function VideoGrid({ query, empty, onOpen, columns }: VideoGridProps) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const upsert = useVideoStore((s) => s.upsert);
  const removed = useVideoStore((s) => s.removed);
  useEffect(() => {
    if (query.items.length) upsert(query.items);
  }, [query.items, upsert]);

  const cols = columns ?? (width >= 1024 ? 5 : width >= 768 ? 4 : 3);
  const cell = Math.floor(Math.min(width, layout.maxContentWidth + spacing['3xl'] * 2) / cols);
  const items = query.items.filter((v) => !removed[v.id]);

  if (query.loading) return <ActivityIndicator color={colors.primary} style={{ padding: spacing['2xl'] }} />;
  if (query.error) return <EmptyState compact icon="cloud-offline-outline" title="Couldn't load videos" description={query.error} action={{ title: 'Retry', onPress: () => void query.refresh(), variant: 'secondary' }} />;
  if (items.length === 0) return <EmptyState compact {...empty} />;

  return (
    <View>
      <View style={styles.grid}>
        {items.map((video, index) => (
          <Pressable key={video.id} onPress={() => (onOpen ? onOpen(video, index) : router.navigate(`/video/${video.id}` as never))} style={{ width: cell, height: cell * 1.5, padding: 1 }} accessibilityLabel={video.caption ?? 'Video'}>
            {video.thumbnail_url ? <Image source={{ uri: video.thumbnail_url }} style={{ flex: 1, backgroundColor: colors.skeleton }} contentFit="cover" transition={150} /> : <View style={{ flex: 1, backgroundColor: palette.night3 }} />}
            <View style={styles.views}>
              <Ionicons name="play" size={12} color={palette.white} />
              <Text variant="caption" color={palette.white} style={{ marginLeft: 3 }}>
                {formatCount(video.views_count)}
              </Text>
            </View>
            {video.duet_of ? <Ionicons name="people" size={14} color={palette.white} style={styles.badge} /> : video.stitch_of ? <Ionicons name="cut" size={14} color={palette.white} style={styles.badge} /> : null}
          </Pressable>
        ))}
      </View>
      {query.hasMore ? <Button title="Load more" variant="ghost" onPress={() => void query.loadMore()} loading={query.loadingMore} style={{ alignSelf: 'center', margin: spacing.md }} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  views: { position: 'absolute', left: 6, bottom: 6, flexDirection: 'row', alignItems: 'center' },
  badge: { position: 'absolute', right: 6, top: 6 },
});
