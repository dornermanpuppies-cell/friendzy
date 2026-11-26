import { Ionicons } from '@/components/ui/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { useScreenFocus } from '@/hooks/useScreenFocus';
import { fetchVideoFeed } from '@/services/videos';
import { ThemeScope } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { VideoCard, VideoFeedKind } from '@/types/video';

import { VideoFeed } from './VideoFeed';

const TABS: { id: VideoFeedKind; label: string }[] = [
  { id: 'following', label: 'Following' },
  { id: 'for_you', label: 'For you' },
  { id: 'trending', label: 'Trending' },
];

const EMPTY: Record<VideoFeedKind, { title: string; description: string }> = {
  for_you: { title: 'No videos yet', description: 'Short videos from the community appear here. Be the first to post one!' },
  following: { title: 'Nobody you follow has posted videos', description: 'Follow creators to fill this feed, or check For you.' },
  trending: { title: 'Nothing trending yet', description: 'Popular videos from the last days show up here.' },
};

/** The short-video feed with its For you / Following / Trending tabs. */
export function VideoFeedScreen({ onExit, showBack, bottomInset }: { onExit?: () => void; showBack?: boolean; bottomInset?: number }) {
  const [tab, setTab] = useState<VideoFeedKind>('for_you');
  const focused = useScreenFocus();
  const { isDesktop } = useBreakpoint();
  const feed = usePagedQuery<VideoCard>((cursor) => fetchVideoFeed(tab, cursor), (v) => v.id, `videos:${tab}`);

  const header = (
    <View style={styles.headerRow}>
      {onExit ? (
        <Pressable onPress={onExit} style={styles.exit} accessibilityLabel="Back to posts">
          <Ionicons name="newspaper-outline" size={16} color={palette.white} />
          <Text variant="caption" color={palette.white} style={{ marginLeft: 4 }}>
            Posts
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable key={t.id} onPress={() => setTab(t.id)} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: tab === t.id }}>
            <Text variant={tab === t.id ? 'bodySemibold' : 'bodyMedium'} color={tab === t.id ? palette.white : 'rgba(255,255,255,0.65)'}>
              {t.label}
            </Text>
            {tab === t.id ? <View style={styles.indicator} /> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <ThemeScope scheme="dark">
      <View style={[styles.root, isDesktop && styles.desktop]}>
        <View style={[styles.stage, isDesktop && styles.stageDesktop]}>
          <VideoFeed query={feed} header={header} showBack={showBack} bottomInset={bottomInset} emptyTitle={EMPTY[tab].title} emptyDescription={EMPTY[tab].description} focused={focused} />
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
  headerRow: { width: '100%', alignItems: 'center' },
  exit: { position: 'absolute', left: spacing.md, top: spacing.sm, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  tabs: { flexDirection: 'row', justifyContent: 'center', gap: spacing['2xl'], paddingVertical: spacing.sm },
  tab: { alignItems: 'center', paddingVertical: 4 },
  indicator: { width: 24, height: 3, borderRadius: 2, backgroundColor: palette.white, marginTop: 4 },
});
