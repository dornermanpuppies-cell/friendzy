import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { VideoGrid } from '@/features/video/VideoGrid';
import { useAsync } from '@/hooks/useAsync';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { fetchHashtagVideos, getChallenge } from '@/services/videos';
import { gradients, palette, radius, spacing } from '@/theme/tokens';
import type { VideoCard } from '@/types/video';
import { formatCount, formatDate } from '@/utils/format';

export default function ChallengeScreen() {
  const { tag } = useLocalSearchParams<{ tag: string }>();
  const clean = String(tag ?? '').replace(/^#/, '').toLowerCase();
  const challenge = useAsync(() => getChallenge(clean), [clean]);
  const videos = usePagedQuery<VideoCard>((cursor) => fetchHashtagVideos(clean, typeof cursor === 'number' ? cursor : 0), (v) => v.id, `challenge:${clean}`);

  return (
    <Screen header={<ScreenHeader title="Challenge" fallbackHref="/challenges" />} scroll padded={false} maxWidth={false}>
      {challenge.loading ? (
        <Skeleton height={180} rounded={0} />
      ) : !challenge.data ? (
        <EmptyState emoji="🏆" title="Challenge not found" description={challenge.error ?? `There is no challenge for #${clean} yet.`} action={{ title: 'Start one', onPress: () => router.navigate('/studio?tab=challenges' as never) }} />
      ) : (
        <View style={styles.hero}>
          {challenge.data.cover_url ? <Image source={{ uri: challenge.data.cover_url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
          <LinearGradient colors={['transparent', 'rgba(9,8,23,0.85)']} style={StyleSheet.absoluteFill} />
          <View style={styles.heroText}>
            <Text variant="caption" color="rgba(255,255,255,0.8)">
              #{challenge.data.tag}
              {challenge.data.creator ? ` · by @${challenge.data.creator.username}` : ''}
            </Text>
            <Text variant="h2" color={palette.white}>
              {challenge.data.title}
            </Text>
            {challenge.data.description ? (
              <Text variant="small" color="rgba(255,255,255,0.85)" numberOfLines={3}>
                {challenge.data.description}
              </Text>
            ) : null}
            <Text variant="caption" color="rgba(255,255,255,0.8)" style={{ marginTop: 4 }}>
              {formatCount(challenge.data.videos_count ?? 0)} videos{challenge.data.ends_at ? ` · ends ${formatDate(challenge.data.ends_at, 'd MMM')}` : ''}
            </Text>
            <Button title="Join the challenge" leftIcon="videocam-outline" style={{ alignSelf: 'flex-start', marginTop: spacing.md }} onPress={() => router.navigate(`/compose/video?tag=${clean}` as never)} glow />
          </View>
        </View>
      )}
      <VideoGrid query={videos} empty={{ emoji: '🎬', title: 'No entries yet', description: 'Be the first to join.' }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { height: 240, justifyContent: 'flex-end', backgroundColor: palette.night3 },
  heroText: { padding: spacing.lg, borderBottomLeftRadius: radius.xl },
});
