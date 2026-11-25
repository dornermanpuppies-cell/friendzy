import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Chip } from '@/components/ui/Chip';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { FeedList } from '@/features/feed/FeedList';
import { VideoGrid } from '@/features/video/VideoGrid';
import { useAsync } from '@/hooks/useAsync';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { fetchHashtagPosts } from '@/services/posts';
import { fetchHashtagVideos, getChallenge } from '@/services/videos';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import type { PostCard } from '@/types/social';
import type { VideoCard } from '@/types/video';

export default function HashtagScreen() {
  const { tag } = useLocalSearchParams<{ tag: string }>();
  const { colors } = useTheme();
  const clean = String(tag ?? '').replace(/^#/, '').toLowerCase();
  const [kind, setKind] = useState<'posts' | 'videos'>('posts');
  const feed = usePagedQuery<PostCard>((cursor) => fetchHashtagPosts(clean, typeof cursor === 'string' ? cursor : null), (p) => p.id, `tag:${clean}`);
  const videos = usePagedQuery<VideoCard>((cursor) => fetchHashtagVideos(clean, typeof cursor === 'number' ? cursor : 0), (v) => v.id, `tagvideos:${clean}`, { enabled: kind === 'videos' });
  const challenge = useAsync(() => getChallenge(clean), [clean]);

  const header = (
    <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.lg }}>
      <Text variant="h2">#{clean}</Text>
      <Text variant="small" color="textMuted" style={{ marginTop: 2 }}>
        Public posts and videos tagged #{clean}
      </Text>
      {challenge.data ? (
        <View style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft }}>
          <Text variant="smallMedium" color="primary">
            🏆 Challenge: {challenge.data.title}
          </Text>
          {challenge.data.description ? (
            <Text variant="caption" color="textMuted" style={{ marginTop: 2 }}>
              {challenge.data.description}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        <Chip label="Posts" icon="newspaper-outline" size="sm" selected={kind === 'posts'} onPress={() => setKind('posts')} />
        <Chip label="Videos" icon="videocam-outline" size="sm" selected={kind === 'videos'} onPress={() => setKind('videos')} />
      </View>
    </View>
  );

  if (kind === 'videos') {
    return (
      <Screen header={<ScreenHeader title={`#${clean}`} fallbackHref="/search" />} scroll padded={false} maxWidth={false}>
        {header}
        <VideoGrid query={videos} empty={{ emoji: '🎬', title: `No videos with #${clean} yet`, description: 'Be the first to post one.', action: { title: 'Create a video', onPress: () => router.navigate(`/compose/video?tag=${clean}` as never) } }} />
      </Screen>
    );
  }

  return (
    <Screen header={<ScreenHeader title={`#${clean}`} fallbackHref="/search" />} padded={false} maxWidth={false}>
      <FeedList
        query={feed}
        header={header}
        empty={{ emoji: '#️⃣', title: `No posts with #${clean} yet`, description: 'Be the first to use this hashtag.', action: { title: 'Create a post', onPress: () => router.navigate({ pathname: '/compose/post', params: { text: `#${clean} ` } } as never) } }}
        trackViews={false}
      />
    </Screen>
  );
}
