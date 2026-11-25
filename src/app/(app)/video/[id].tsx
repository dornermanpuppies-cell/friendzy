import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/ui/EmptyState';
import { VideoFeed } from '@/features/video/VideoFeed';
import { useAsync } from '@/hooks/useAsync';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useScreenFocus } from '@/hooks/useScreenFocus';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { fetchUserVideos, getVideo } from '@/services/videos';
import { useVideoStore } from '@/store/videoStore';
import { ThemeScope } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { VideoCard } from '@/types/video';

/** Single video deep link. Opens the clip first, then continues with more from the same creator. */
export default function VideoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const focused = useScreenFocus();
  const { isDesktop } = useBreakpoint();
  const upsert = useVideoStore((s) => s.upsert);
  const video = useAsync(() => getVideo(String(id)), [id]);
  const authorId = video.data?.author.id;
  const more = usePagedQuery<VideoCard>((cursor) => fetchUserVideos(authorId!, typeof cursor === 'string' ? cursor : null), (v) => v.id, `video-more:${authorId ?? ''}`, { enabled: Boolean(authorId) });

  useEffect(() => {
    if (video.data) upsert([video.data]);
  }, [video.data, upsert]);

  const combined = useMemo(() => {
    if (!video.data) return more;
    const rest = more.items.filter((v) => v.id !== video.data!.id);
    return { ...more, items: [video.data, ...rest], loading: false, error: null };
  }, [video.data, more]);

  if (video.error) {
    return (
      <ThemeScope scheme="dark">
        <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
          <EmptyState emoji="🎬" title="Video not available" description={video.error} action={{ title: 'Back to videos', onPress: () => router.replace('/videos' as never) }} />
        </View>
      </ThemeScope>
    );
  }

  return (
    <ThemeScope scheme="dark">
      <View style={[styles.root, isDesktop && styles.desktop]}>
        <View style={[styles.stage, isDesktop && styles.stageDesktop]}>
          <VideoFeed query={combined} showBack focused={focused} emptyTitle="Loading…" emptyDescription="" />
        </View>
      </View>
    </ThemeScope>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.black },
  desktop: { alignItems: 'center', backgroundColor: palette.night },
  stage: { flex: 1, width: '100%' },
  stageDesktop: { maxWidth: 520, borderRadius: radius.xl, overflow: 'hidden', marginVertical: spacing.lg },
});
