import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { VideoGrid } from '@/features/video/VideoGrid';
import { useAsync } from '@/hooks/useAsync';
import type { PagedQuery } from '@/hooks/usePagedQuery';
import { getPlaylistVideos } from '@/services/videos';
import { spacing } from '@/theme/tokens';
import type { VideoCard } from '@/types/video';

export default function PlaylistScreen() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const videos = useAsync(() => getPlaylistVideos(String(id)), [id]);
  const query = useMemo<PagedQuery<VideoCard>>(
    () => ({
      items: videos.data ?? [],
      loading: videos.loading,
      refreshing: videos.refreshing,
      loadingMore: false,
      error: videos.error,
      hasMore: false,
      refresh: videos.refresh,
      loadMore: async () => undefined,
      setItems: () => undefined,
      prepend: () => undefined,
      removeWhere: () => undefined,
    }),
    [videos],
  );
  return (
    <Screen header={<ScreenHeader title={title ? String(title) : 'Playlist'} fallbackHref="/profile" />} scroll padded={false} maxWidth={false}>
      <View style={{ padding: spacing.lg }}>
        <Text variant="h3">{title ? String(title) : 'Playlist'}</Text>
        <Text variant="small" color="textMuted">
          {videos.data ? `${videos.data.length} video${videos.data.length === 1 ? '' : 's'}` : ''}
        </Text>
      </View>
      {videos.error ? <EmptyState compact icon="cloud-offline-outline" title="Couldn't load playlist" description={videos.error} action={{ title: 'Retry', onPress: () => void videos.reload(), variant: 'secondary' }} /> : <VideoGrid query={query} empty={{ emoji: '📂', title: 'This playlist is empty', description: 'Add videos from your Creator Studio.', action: { title: 'Open studio', onPress: () => router.navigate('/studio?tab=playlists' as never) } }} />}
    </Screen>
  );
}
