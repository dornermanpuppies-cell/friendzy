import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { VideoGrid } from '@/features/video/VideoGrid';
import { useAsync } from '@/hooks/useAsync';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { fetchSoundVideos, getSound } from '@/services/videos';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { VideoCard } from '@/types/video';
import { formatCount } from '@/utils/format';

export default function SoundScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const sound = useAsync(() => getSound(String(id)), [id]);
  const videos = usePagedQuery<VideoCard>((cursor) => fetchSoundVideos(String(id), typeof cursor === 'number' ? cursor : 0), (v) => v.id, `sound:${id}`);
  const player = useAudioPlayer(sound.data?.url ? { uri: sound.data.url } : null);
  const status = useAudioPlayerStatus(player);

  const toggle = () => {
    if (status.playing) player.pause();
    else {
      if (status.didJustFinish) player.seekTo(0);
      player.play();
    }
  };

  return (
    <Screen header={<ScreenHeader title="Sound" fallbackHref="/videos" />} scroll padded={false} maxWidth={false}>
      {sound.loading ? (
        <View style={{ padding: spacing.lg }}>
          <Skeleton height={96} />
        </View>
      ) : !sound.data ? (
        <EmptyState emoji="🎵" title="Sound not available" description={sound.error ?? 'This sound may have been removed.'} />
      ) : (
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={toggle} style={styles.cover} accessibilityLabel={status.playing ? 'Pause sound' : 'Play sound'} disabled={!sound.data.url}>
            {sound.data.cover_url ? <Image source={{ uri: sound.data.cover_url }} style={StyleSheet.absoluteFill} /> : null}
            <Ionicons name={status.playing ? 'pause' : 'play'} size={30} color={palette.white} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text variant="h3" numberOfLines={2}>
              {sound.data.title}
            </Text>
            <Text variant="small" color="textMuted">
              {sound.data.artist ?? (sound.data.owner ? `Original sound · @${sound.data.owner.username}` : 'Original sound')}
            </Text>
            <Text variant="caption" color="textMuted" style={{ marginTop: 2 }}>
              {formatCount(sound.data.uses_count)} video{sound.data.uses_count === 1 ? '' : 's'}
              {sound.data.duration_ms ? ` · ${Math.round(sound.data.duration_ms / 1000)}s` : ''}
            </Text>
            <Button title="Use this sound" size="sm" leftIcon="videocam-outline" style={{ alignSelf: 'flex-start', marginTop: spacing.sm }} onPress={() => router.navigate(`/compose/video?sound=${sound.data!.id}` as never)} />
          </View>
        </View>
      )}
      <VideoGrid query={videos} empty={{ emoji: '🎵', title: 'No videos with this sound yet', description: 'Be the first to use it.' }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  cover: { width: 96, height: 96, borderRadius: radius.lg, backgroundColor: palette.night3, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
