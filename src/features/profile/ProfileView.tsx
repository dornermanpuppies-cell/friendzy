import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Share, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Pill, VerifiedBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { ListItem } from '@/components/ui/ListItem';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import type { InterestItem } from '@/constants/interests';
import { countryName, flagEmoji } from '@/constants/countries';
import { languageNames } from '@/constants/languages';
import { PostCard } from '@/features/feed/PostCard';
import { useAsync } from '@/hooks/useAsync';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { env } from '@/lib/env';
import { fetchSavedPosts, fetchUserPosts } from '@/services/posts';
import { getHighlights, getUserStories } from '@/services/stories';
import { usePostStore } from '@/store/postStore';
import { useTheme } from '@/theme/ThemeProvider';
import { gradients, layout, palette, radius, spacing } from '@/theme/tokens';
import type { PresenceInfo, ProfileRow } from '@/types/database';
import type { DiscoverCard, PostCard as PostCardModel } from '@/types/social';
import { formatCount, formatDate, lastSeenLabel } from '@/utils/format';

import { ReportSheet } from './ReportSheet';

export type ProfileTab = 'posts' | 'photos' | 'videos' | 'reels' | 'saved' | 'live';

export interface ProfileViewProps {
  profile: ProfileRow;
  isOwner: boolean;
  interests?: InterestItem[];
  /** Spoken languages (ISO 639-1). Empty when hidden by the owner. */
  languages?: string[];
  /** Age — only provided when the owner is an adult who shows it. */
  age?: number | null;
  /** Friends in common with the viewer (not shown for the owner). */
  mutualFriends?: DiscoverCard[];
  presence?: PresenceInfo | null;
  actions?: ReactNode;
  onBlock?: () => void;
  onUnblock?: () => void;
  isBlocking?: boolean;
  header?: ReactNode;
  /** Slot for phase-specific tabs (short videos, live history) supplied by the host screen. */
  renderTab?: (tab: ProfileTab) => ReactNode | null;
}

const TABS: { id: ProfileTab; label: string; icon: keyof typeof Ionicons.glyphMap; ownerOnly?: boolean }[] = [
  { id: 'posts', label: 'Posts', icon: 'grid-outline' },
  { id: 'photos', label: 'Photos', icon: 'images-outline' },
  { id: 'videos', label: 'Videos', icon: 'videocam-outline' },
  { id: 'reels', label: 'Reels', icon: 'film-outline' },
  { id: 'live', label: 'Live', icon: 'radio-outline' },
  { id: 'saved', label: 'Saved', icon: 'bookmark-outline', ownerOnly: true },
];

function PostsTab({ userId, kind, isOwner }: { userId: string; kind: 'posts' | 'photos' | 'videos' | 'saved'; isOwner: boolean }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const upsert = usePostStore((s) => s.upsert);
  const query = usePagedQuery<PostCardModel>(
    (cursor) => {
      const before = typeof cursor === 'string' ? cursor : null;
      return kind === 'saved' ? fetchSavedPosts(before) : fetchUserPosts(userId, kind, before);
    },
    (p) => p.id,
    `profile:${userId}:${kind}`,
  );
  useEffect(() => {
    if (query.items.length) upsert(query.items);
  }, [query.items, upsert]);
  const byId = usePostStore((s) => s.byId);

  if (query.loading) return <ActivityIndicator color={colors.primary} style={{ padding: spacing['2xl'] }} />;
  if (query.error) return <EmptyState compact icon="cloud-offline-outline" title="Couldn't load" description={query.error} action={{ title: 'Retry', onPress: () => void query.refresh(), variant: 'secondary' }} />;
  if (query.items.length === 0) {
    const copy =
      kind === 'saved'
        ? { emoji: '🔖', title: 'Nothing saved yet', description: 'Posts you save appear here. Only you can see them.' }
        : kind === 'photos'
          ? { emoji: '📷', title: 'No photos yet', description: isOwner ? 'Share a photo from the Create tab.' : 'Photo posts will appear here.' }
          : kind === 'videos'
            ? { emoji: '🎬', title: 'No video posts yet', description: isOwner ? 'Post a video from the Create tab.' : 'Video posts will appear here.' }
            : { emoji: '📝', title: 'No posts yet', description: isOwner ? 'Your posts will show up here. Say hello to the community!' : 'This person has not posted yet.' };
    return <EmptyState compact {...copy} action={isOwner && kind !== 'saved' ? { title: 'Create a post', onPress: () => router.navigate('/compose/post' as never) } : undefined} />;
  }

  if (kind === 'photos') {
    const columns = width >= 768 ? 4 : 3;
    const cell = Math.floor(Math.min(width, layout.maxContentWidth + spacing['3xl'] * 2) / columns);
    return (
      <View style={styles.grid}>
        {query.items.map((post) => {
          const thumb = post.media[0];
          return (
            <Pressable key={post.id} onPress={() => router.navigate(`/post/${post.id}` as never)} style={{ width: cell, height: cell, padding: 1 }}>
              <Image source={{ uri: thumb?.thumbnail_url ?? thumb?.url }} style={{ flex: 1, backgroundColor: colors.skeleton }} contentFit="cover" />
              {post.media.length > 1 ? <Ionicons name="copy" size={14} color={palette.white} style={styles.gridBadge} /> : null}
            </Pressable>
          );
        })}
        {query.hasMore ? <Button title="Load more" variant="ghost" onPress={() => void query.loadMore()} loading={query.loadingMore} style={{ margin: spacing.md }} /> : null}
      </View>
    );
  }

  return (
    <View>
      {query.items.map((post) => (
        <PostCard key={post.id} post={byId[post.id] ?? post} onRemoved={(id) => query.removeWhere((p) => p.id === id)} />
      ))}
      {query.hasMore ? <Button title="Load more" variant="ghost" onPress={() => void query.loadMore()} loading={query.loadingMore} style={{ alignSelf: 'center', margin: spacing.md }} /> : null}
    </View>
  );
}

export function ProfileView({ profile, isOwner, interests = [], languages = [], age, mutualFriends = [], presence, actions, onBlock, onUnblock, isBlocking, header, renderTab }: ProfileViewProps) {
  const { colors } = useTheme();
  const { isDesktop } = useBreakpoint();
  const toast = useToast();
  const [tab, setTab] = useState<ProfileTab>('posts');
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const highlights = useAsync(() => getHighlights(profile.id), [profile.id]);
  const activeStories = useAsync(() => getUserStories(profile.id), [profile.id]);
  const hasStories = (activeStories.data?.length ?? 0) > 0;

  const profileUrl = `${env.siteUrl}/u/${profile.username}`;

  const share = async () => {
    try {
      if (Platform.OS === 'web') {
        const nav = typeof navigator !== 'undefined' ? navigator : undefined;
        if (nav?.share) await nav.share({ title: `${profile.display_name} on Friendzy`, url: profileUrl });
        else {
          await Clipboard.setStringAsync(profileUrl);
          toast.success('Profile link copied');
        }
      } else {
        await Share.share({ message: `${profile.display_name} on Friendzy — ${profileUrl}`, url: profileUrl });
      }
    } catch {
      /* cancelled */
    }
  };

  const stats = [
    { label: 'Followers', value: profile.followers_count, href: `/connections/${profile.username}?tab=followers` },
    { label: 'Following', value: profile.following_count, href: `/connections/${profile.username}?tab=following` },
    { label: 'Friends', value: profile.friends_count, href: `/connections/${profile.username}?tab=friends` },
  ];

  const visibleTabs = TABS.filter((t) => !t.ownerOnly || isOwner);
  const coverHeight = isDesktop ? 220 : 160;

  const renderTabContent = () => {
    const custom = renderTab?.(tab);
    if (custom) return custom;
    if (tab === 'posts' || tab === 'photos' || tab === 'videos' || tab === 'saved') return <PostsTab userId={profile.id} kind={tab} isOwner={isOwner} />;
    if (tab === 'reels') return <EmptyState compact emoji="✨" title="No reels yet" description="Short videos appear here once published." />;
    return <EmptyState compact emoji="📡" title="No live history" description="Past broadcasts appear here." />;
  };

  return (
    <View style={styles.root}>
      <View style={{ height: coverHeight }}>
        {profile.cover_url ? <Image source={{ uri: profile.cover_url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} /> : <LinearGradient colors={['#1B0B3E', palette.purple, palette.pink]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
        <LinearGradient colors={['rgba(9,8,23,0.25)', 'transparent', 'rgba(9,8,23,0.35)']} style={StyleSheet.absoluteFill} />
        {header}
      </View>

      <View style={[styles.body, isDesktop && { paddingHorizontal: spacing['3xl'] }]}>
        <View style={styles.avatarRow}>
          <Pressable
            onPress={() => (hasStories ? router.navigate({ pathname: '/story/[userId]', params: { userId: profile.id } } as never) : isOwner ? router.navigate('/compose/story' as never) : undefined)}
            accessibilityLabel={hasStories ? 'View story' : 'Profile picture'}
            style={[styles.avatarRing, { borderColor: colors.background, backgroundColor: colors.background }]}
          >
            <Avatar uri={profile.avatar_url} name={profile.display_name} size={isDesktop ? 120 : 96} online={presence?.is_online} ring={hasStories} />
          </Pressable>
          <View style={styles.quickActions}>
            {isOwner ? (
              <>
                <Button title="Edit profile" variant="secondary" size="sm" leftIcon="create-outline" onPress={() => router.navigate('/profile/edit')} />
                <IconButton icon="share-outline" accessibilityLabel="Share profile" variant="surface" size={38} onPress={share} />
                <IconButton icon="settings-outline" accessibilityLabel="Settings" variant="surface" size={38} onPress={() => router.navigate('/settings')} />
              </>
            ) : (
              <>
                <IconButton icon="share-outline" accessibilityLabel="Share profile" variant="surface" size={38} onPress={share} />
                <IconButton icon="ellipsis-horizontal" accessibilityLabel="More options" variant="surface" size={38} onPress={() => setMenuOpen(true)} />
              </>
            )}
          </View>
        </View>

        <View style={{ marginTop: spacing.md }}>
          <View style={styles.nameRow}>
            <Text variant="h2" numberOfLines={1} style={{ flexShrink: 1 }}>
              {profile.display_name}
            </Text>
            {profile.is_verified ? <VerifiedBadge size={20} style={{ marginLeft: spacing.sm }} /> : null}
            {profile.is_private ? <Ionicons name="lock-closed" size={16} color={colors.textMuted} style={{ marginLeft: spacing.sm }} /> : null}
          </View>
          <View style={styles.metaRow}>
            <Text variant="body" color="textMuted">
              @{profile.username}
            </Text>
            {age ? (
              <Text variant="body" color="textMuted">
                {'  ·  '}
                {age}
              </Text>
            ) : null}
            {profile.country_code ? (
              <Text variant="body" color="textMuted">
                {'  ·  '}
                {flagEmoji(profile.country_code)} {profile.city ? `${profile.city}, ` : ''}
                {countryName(profile.country_code)}
              </Text>
            ) : null}
          </View>
          {presence && (presence.is_online || presence.last_seen_at) ? (
            <View style={styles.presenceRow}>
              <View style={[styles.presenceDot, { backgroundColor: presence.is_online ? palette.success : colors.textMuted }]} />
              <Text variant="small" color={presence.is_online ? 'success' : 'textMuted'}>
                {presence.is_online && presence.activity === 'chatting' ? 'Chatting now' : presence.is_online && presence.activity === 'live' ? 'Live now' : presence.is_online && presence.activity === 'gaming' ? 'Playing a game' : lastSeenLabel(presence.last_seen_at, presence.is_online)}
              </Text>
            </View>
          ) : null}
          <View style={styles.factsRow}>
            <View style={styles.fact}>
              <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
              <Text variant="small" color="textMuted" style={{ marginLeft: 4 }}>
                Joined {formatDate(profile.created_at, 'MMM yyyy')}
              </Text>
            </View>
            {languages.length > 0 ? (
              <View style={styles.fact}>
                <Ionicons name="language-outline" size={14} color={colors.textMuted} />
                <Text variant="small" color="textMuted" style={{ marginLeft: 4 }} numberOfLines={1}>
                  Speaks {languageNames(languages, 4)}
                </Text>
              </View>
            ) : isOwner ? (
              <Pressable onPress={() => router.navigate('/profile/edit')} style={styles.fact} accessibilityRole="button">
                <Ionicons name="language-outline" size={14} color={colors.primary} />
                <Text variant="smallMedium" color="primary" style={{ marginLeft: 4 }}>
                  Add languages you speak
                </Text>
              </Pressable>
            ) : null}
          </View>
          {!isOwner && mutualFriends.length > 0 ? (
            <Pressable onPress={() => router.navigate(`/connections/${profile.username}?tab=friends` as never)} style={styles.mutualRow} accessibilityRole="button" accessibilityLabel={`${mutualFriends.length} mutual friends`}>
              <View style={styles.mutualAvatars}>
                {mutualFriends.slice(0, 3).map((m, i) => (
                  <View key={m.id} style={[styles.mutualAvatar, { borderColor: colors.background, marginLeft: i === 0 ? 0 : -10 }]}>
                    <Avatar uri={m.avatar_url} name={m.display_name} size={26} />
                  </View>
                ))}
              </View>
              <Text variant="small" color="textSecondary" style={{ flex: 1, marginLeft: spacing.sm }} numberOfLines={1}>
                {mutualFriends.length === 1 ? `Friends with ${mutualFriends[0].display_name}` : `Friends with ${mutualFriends[0].display_name} and ${mutualFriends.length - 1} other${mutualFriends.length - 1 === 1 ? '' : 's'}`}
              </Text>
            </Pressable>
          ) : null}
          {profile.bio ? (
            <Text variant="body" style={{ marginTop: spacing.md }}>
              {profile.bio}
            </Text>
          ) : isOwner ? (
            <Pressable onPress={() => router.navigate('/profile/edit')}>
              <Text variant="body" color="primary" style={{ marginTop: spacing.md }}>
                + Add a bio
              </Text>
            </Pressable>
          ) : null}
          {profile.website ? (
            <Pressable onPress={() => (Platform.OS === 'web' ? window.open(profile.website!, '_blank', 'noopener') : undefined)} style={styles.websiteRow}>
              <Ionicons name="link-outline" size={16} color={colors.primary} />
              <Text variant="smallMedium" color="primary" numberOfLines={1} style={{ marginLeft: 4 }}>
                {profile.website.replace(/^https?:\/\//, '')}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View style={[styles.stats, { borderColor: colors.border }]}>
          {stats.map((s) => (
            <Pressable key={s.label} style={styles.stat} onPress={() => router.navigate(s.href as never)} accessibilityRole="button" accessibilityLabel={`${s.value} ${s.label}`}>
              <Text variant="h3">{formatCount(s.value)}</Text>
              <Text variant="small" color="textMuted">
                {s.label}
              </Text>
            </Pressable>
          ))}
          <View style={styles.stat}>
            <Text variant="h3">{formatCount(profile.likes_count)}</Text>
            <Text variant="small" color="textMuted">
              Likes
            </Text>
          </View>
        </View>

        <View style={styles.pills}>
          <Pill label={`${formatCount(profile.posts_count)} posts`} icon="grid-outline" />
          <Pill label={`${formatCount(profile.videos_count)} videos`} icon="videocam-outline" />
          {profile.popularity_score >= 50 ? <Pill label="Rising" tone="gradient" icon="trending-up-outline" /> : null}
        </View>

        {actions ? <View style={styles.actions}>{actions}</View> : null}

        {/* Highlights */}
        {(highlights.data?.length ?? 0) > 0 || isOwner ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.highlights}>
            {isOwner ? (
              <Pressable onPress={() => router.navigate('/profile/highlights' as never)} style={styles.highlight} accessibilityLabel="Manage highlights">
                <View style={[styles.highlightCircle, { borderColor: colors.borderStrong, backgroundColor: colors.surfaceMuted }]}>
                  <Ionicons name="add" size={24} color={colors.textSecondary} />
                </View>
                <Text variant="caption" color="textMuted" numberOfLines={1}>
                  New
                </Text>
              </Pressable>
            ) : null}
            {(highlights.data ?? []).map((h) => (
              <Pressable key={h.id} onPress={() => router.navigate({ pathname: '/highlight/[id]', params: { id: h.id } } as never)} style={styles.highlight} accessibilityLabel={`Highlight ${h.title}`}>
                <View style={[styles.highlightCircle, { borderColor: colors.borderStrong }]}>
                  {h.cover_url ? <Image source={{ uri: h.cover_url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <LinearGradient colors={[...gradients.cool]} style={StyleSheet.absoluteFill} />}
                </View>
                <Text variant="caption" numberOfLines={1}>
                  {h.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {interests.length > 0 ? (
          <View style={{ marginTop: spacing.lg }}>
            <Text variant="label" color="textMuted" style={{ marginBottom: spacing.sm }}>
              Interests
            </Text>
            <View style={styles.interests}>
              {interests.map((i) => (
                <Chip key={i.id} label={i.name} emoji={i.emoji} size="sm" disabled />
              ))}
            </View>
          </View>
        ) : isOwner ? (
          <Pressable onPress={() => router.navigate('/onboarding/interests')} style={{ marginTop: spacing.lg }}>
            <Text variant="smallMedium" color="primary">
              + Add interests to get better suggestions
            </Text>
          </Pressable>
        ) : null}

        <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
          {visibleTabs.map((t) => {
            const active = t.id === tab;
            return (
              <Pressable key={t.id} onPress={() => setTab(t.id)} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: active }}>
                <Ionicons name={t.icon} size={18} color={active ? colors.primary : colors.textMuted} />
                <Text variant="caption" color={active ? 'primary' : 'textMuted'} style={{ marginTop: 4 }}>
                  {t.label}
                </Text>
                {active ? <LinearGradient colors={[...gradients.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.tabIndicator} /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.tabContent}>{renderTabContent()}</View>

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={`@${profile.username}`}>
        <ListItem
          icon="copy-outline"
          title="Copy profile link"
          onPress={async () => {
            setMenuOpen(false);
            await Clipboard.setStringAsync(profileUrl);
            toast.success('Profile link copied');
          }}
        />
        <ListItem icon="flag-outline" title="Report" subtitle="Report this profile to the Friendzy safety team" onPress={() => { setMenuOpen(false); setTimeout(() => setReportOpen(true), 250); }} />
        {isBlocking ? (
          <ListItem icon="checkmark-circle-outline" title="Unblock" onPress={() => { setMenuOpen(false); onUnblock?.(); }} />
        ) : (
          <ListItem icon="ban-outline" title="Block" subtitle="They won't be able to find or contact you" danger onPress={() => { setMenuOpen(false); onBlock?.(); }} />
        )}
        <View style={{ height: spacing.lg }} />
      </Sheet>
      <ReportSheet visible={reportOpen} onClose={() => setReportOpen(false)} targetType="profile" targetId={profile.id} targetLabel="profile" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', maxWidth: layout.maxContentWidth + spacing['3xl'] * 2, alignSelf: 'center' },
  body: { paddingHorizontal: spacing.lg },
  tabContent: { paddingBottom: spacing['4xl'] },
  avatarRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: -48 },
  avatarRing: { borderWidth: 4, borderRadius: radius.full, padding: 0 },
  quickActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 2 },
  presenceRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  presenceDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  factsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  fact: { flexDirection: 'row', alignItems: 'center' },
  mutualRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  mutualAvatars: { flexDirection: 'row', alignItems: 'center' },
  mutualAvatar: { borderWidth: 2, borderRadius: 15 },
  websiteRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  stats: { flexDirection: 'row', marginTop: spacing.xl, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  stat: { flex: 1, alignItems: 'center' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  highlights: { gap: spacing.md, paddingVertical: spacing.lg },
  highlight: { width: 68, alignItems: 'center' },
  highlightCircle: { width: 60, height: 60, borderRadius: 30, borderWidth: 1.5, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  interests: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tabs: { flexDirection: 'row', marginTop: spacing['2xl'], borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: 'center', paddingVertical: spacing.md },
  tabIndicator: { position: 'absolute', bottom: -1, height: 3, width: 32, borderRadius: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridBadge: { position: 'absolute', top: 6, right: 6 },
});
