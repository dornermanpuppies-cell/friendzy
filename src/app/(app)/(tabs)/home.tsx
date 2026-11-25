import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TopBar } from '@/components/layout/TopBar';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { Text } from '@/components/ui/Text';
import { FeedList } from '@/features/feed/FeedList';
import { AnnouncementBar, BannerRail } from '@/features/site/AnnouncementBar';
import { StoryTray } from '@/features/stories/StoryTray';
import { VideoFeedScreen } from '@/features/video/VideoFeedScreen';
import { useAsync } from '@/hooks/useAsync';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { fetchFeed } from '@/services/posts';
import { getStoryTray } from '@/services/stories';
import { useAuth } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { layout, palette, radius, spacing } from '@/theme/tokens';
import type { FeedKind, PostCard } from '@/types/social';

const TABS: { id: FeedKind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'for_you', label: 'For you', icon: 'sparkles-outline' },
  { id: 'following', label: 'Following', icon: 'people-outline' },
  { id: 'nearby', label: 'Nearby', icon: 'location-outline' },
  { id: 'trending', label: 'Trending', icon: 'flame-outline' },
];

const EMPTY: Record<FeedKind, { title: string; description: string; emoji: string }> = {
  for_you: { emoji: '✨', title: 'Nothing here yet', description: 'Follow people and pick interests to get personalised posts. Be the first to post something!' },
  following: { emoji: '👋', title: 'Your following feed is quiet', description: 'Posts from people you follow and your friends appear here.' },
  nearby: { emoji: '📍', title: 'No posts nearby yet', description: 'Turn on nearby discovery in Settings → Privacy and share your approximate location to see posts from people around you.' },
  trending: { emoji: '🔥', title: 'Nothing trending right now', description: 'Popular public posts from the last few days show up here.' },
};

export default function HomeScreen() {
  const { profile, settings } = useAuth();
  const { colors } = useTheme();
  const [tab, setTab] = useState<FeedKind>('for_you');
  const [mode, setMode] = useState<'posts' | 'videos'>('posts');
  const tray = useAsync(() => getStoryTray(), []);
  const feed = usePagedQuery<PostCard>((cursor) => fetchFeed(tab, cursor), (p) => p.id, `feed:${tab}`);

  useFocusEffect(
    useCallback(() => {
      void tray.refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  if (mode === 'videos') {
    return <VideoFeedScreen onExit={() => setMode('posts')} bottomInset={0} />;
  }

  const header = (
    <View>
      <AnnouncementBar />
      <StoryTray items={tray.data} loading={tray.loading} />
      <Pressable onPress={() => router.navigate('/compose/post' as never)} style={[styles.composer, { borderBottomColor: colors.border }]} accessibilityRole="button" accessibilityLabel="Create a post">
        <Avatar uri={profile?.avatar_url} name={profile?.display_name} size={40} />
        <View style={[styles.composerInput, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
          <Text variant="body" color="placeholder">
            What&apos;s on your mind, {profile?.display_name?.split(' ')[0] ?? 'friend'}?
          </Text>
        </View>
        <Ionicons name="images-outline" size={22} color={colors.primary} />
      </Pressable>
      <BannerRail placement="home" />
      <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
        {TABS.map((t) => (
          <Chip key={t.id} label={t.label} icon={t.icon} size="sm" selected={tab === t.id} onPress={() => setTab(t.id)} />
        ))}
      </View>
      {tab === 'nearby' && !settings?.nearby_enabled ? (
        <Pressable onPress={() => router.navigate('/people/nearby' as never)} style={[styles.notice, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="location-outline" size={18} color={colors.primary} />
          <Text variant="small" color="primary" style={{ flex: 1, marginLeft: spacing.sm }}>
            Nearby is off. Tap to enable approximate location and see what people around you are sharing.
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar
        showLogo
        right={
          <View style={styles.topRight}>
            <Pressable onPress={() => setMode('videos')} style={[styles.videosPill, { backgroundColor: colors.primarySoft }]} accessibilityRole="button" accessibilityLabel="Open short videos">
              <Ionicons name="play-circle" size={18} color={colors.primary} />
              <Text variant="smallMedium" color="primary" style={{ marginLeft: 4 }}>
                Videos
              </Text>
            </Pressable>
            <IconButton icon="search-outline" accessibilityLabel="Search" onPress={() => router.navigate('/search' as never)} />
          </View>
        }
      />
      <FeedList query={feed} header={header} empty={{ ...EMPTY[tab], action: { title: 'Create a post', onPress: () => router.navigate('/compose/post' as never), leftIcon: 'create-outline' } }} />
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, maxWidth: layout.maxContentWidth, width: '100%' },
  composerInput: { flex: 1, marginHorizontal: spacing.md, height: 40, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center', paddingHorizontal: spacing.lg },
  tabs: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, flexWrap: 'wrap' },
  notice: { flexDirection: 'row', alignItems: 'center', margin: spacing.lg, padding: spacing.md, borderRadius: radius.md },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  videosPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, height: 34, borderRadius: radius.full },
  unused: { color: palette.white },
});
