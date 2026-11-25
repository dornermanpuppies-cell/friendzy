import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { FeedList } from '@/features/feed/FeedList';
import { FollowButton } from '@/features/profile/FollowButton';
import { ProfileRow } from '@/features/profile/ProfileRow';
import { useAsync } from '@/hooks/useAsync';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { searchPosts } from '@/services/posts';
import { searchProfiles } from '@/services/profiles';
import { clearSearchHistory, getRecentSearches, getTrendingHashtags, getTrendingSearches, saveSearch, searchAll } from '@/services/search';
import { useAuth } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import type { PostCard } from '@/types/social';

type Tab = 'top' | 'people' | 'posts' | 'tags';

export default function SearchScreen() {
  const { q } = useLocalSearchParams<{ q?: string }>();
  const { colors } = useTheme();
  const { user } = useAuth();
  const [query, setQuery] = useState(q ?? '');
  const [debounced, setDebounced] = useState(q ?? '');
  const [tab, setTab] = useState<Tab>('top');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(query.trim()), 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const active = debounced.length > 0;
  const top = useAsync(() => searchAll(debounced, 6), [debounced], { enabled: active && tab === 'top' });
  const people = useAsync(() => searchProfiles({ query: debounced, limit: 40 }), [debounced], { enabled: active && tab === 'people' });
  const posts = usePagedQuery<PostCard>((cursor) => searchPosts(debounced, typeof cursor === 'number' ? cursor : 0), (p) => p.id, `search:${debounced}`, { enabled: active && tab === 'posts' });
  const tags = useAsync(() => searchAll(debounced, 20).then((r) => r.hashtags), [debounced], { enabled: active && tab === 'tags' });
  const recent = useAsync(() => getRecentSearches(), [active]);
  const trendingSearches = useAsync(() => getTrendingSearches(), []);
  const trendingTags = useAsync(() => getTrendingHashtags(10), []);

  useEffect(() => {
    if (debounced.length >= 2) void saveSearch(debounced);
  }, [debounced]);

  const submit = (value: string) => {
    setQuery(value);
    setDebounced(value.trim());
  };

  const header = (
    <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
      <Input placeholder="Search people, posts, #hashtags" leftIcon="search-outline" value={query} onChangeText={setQuery} autoFocus autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => submit(query)} rightElement={query ? <Pressable onPress={() => submit('')} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.textMuted} /></Pressable> : null} />
      {active ? (
        <View style={styles.tabs}>
          {(['top', 'people', 'posts', 'tags'] as Tab[]).map((t) => (
            <Chip key={t} label={t === 'top' ? 'Top' : t === 'people' ? 'People' : t === 'posts' ? 'Posts' : 'Hashtags'} size="sm" selected={tab === t} onPress={() => setTab(t)} />
          ))}
        </View>
      ) : null}
    </View>
  );

  if (active && tab === 'posts') {
    return (
      <Screen header={<ScreenHeader title="Search" fallbackHref="/home" />} padded={false} maxWidth={false}>
        <FeedList query={posts} header={header} empty={{ icon: 'search-outline', title: 'No posts found', description: `Nothing matched “${debounced}”.` }} trackViews={false} />
      </Screen>
    );
  }

  return (
    <Screen header={<ScreenHeader title="Search" fallbackHref="/home" />} scroll padded={false}>
      {header}
      <View style={{ paddingHorizontal: spacing.lg }}>
        {!active ? (
          <>
            {recent.data && recent.data.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text variant="h4">Recent</Text>
                  <Pressable onPress={() => clearSearchHistory().then(() => recent.refresh())} hitSlop={8}>
                    <Text variant="smallMedium" color="primary">
                      Clear all
                    </Text>
                  </Pressable>
                </View>
                {recent.data.map((r) => (
                  <Pressable key={r.id} onPress={() => submit(r.query)} style={styles.recentRow}>
                    <Ionicons name="time-outline" size={18} color={colors.textMuted} />
                    <Text variant="body" style={{ flex: 1, marginLeft: spacing.md }}>
                      {r.query}
                    </Text>
                    <Pressable onPress={() => clearSearchHistory(r.id).then(() => recent.refresh())} hitSlop={8} accessibilityLabel="Remove">
                      <Ionicons name="close" size={18} color={colors.textMuted} />
                    </Pressable>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <View style={styles.section}>
              <Text variant="h4" style={{ marginBottom: spacing.sm }}>
                Trending hashtags
              </Text>
              {trendingTags.data && trendingTags.data.length > 0 ? (
                <View style={styles.wrap}>
                  {trendingTags.data.map((t) => (
                    <Chip key={t.tag} label={`#${t.tag}`} size="sm" onPress={() => router.navigate(`/tag/${t.tag}` as never)} />
                  ))}
                </View>
              ) : (
                <Text variant="small" color="textMuted">
                  Hashtags people use in posts will trend here.
                </Text>
              )}
            </View>
            {trendingSearches.data && trendingSearches.data.length > 0 ? (
              <View style={styles.section}>
                <Text variant="h4" style={{ marginBottom: spacing.sm }}>
                  Trending searches
                </Text>
                {trendingSearches.data.map((t) => (
                  <Pressable key={t.query} onPress={() => submit(t.query)} style={styles.recentRow}>
                    <Ionicons name="trending-up-outline" size={18} color={colors.accent} />
                    <Text variant="body" style={{ flex: 1, marginLeft: spacing.md }}>
                      {t.query}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        ) : tab === 'top' ? (
          top.loading ? (
            <SkeletonList count={6} />
          ) : top.error ? (
            <EmptyState compact icon="cloud-offline-outline" title="Search failed" description={top.error} />
          ) : (
            <>
              {top.data?.users.length ? (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text variant="h4">People</Text>
                    <Pressable onPress={() => setTab('people')}>
                      <Text variant="smallMedium" color="primary">
                        See all
                      </Text>
                    </Pressable>
                  </View>
                  {top.data.users.map((p) => (
                    <ProfileRow key={p.id} profile={p} right={p.id !== user?.id ? <FollowButton targetId={p.id} state="none" isPrivate={p.is_private} /> : undefined} />
                  ))}
                </View>
              ) : null}
              {top.data?.hashtags.length ? (
                <View style={styles.section}>
                  <Text variant="h4" style={{ marginBottom: spacing.sm }}>
                    Hashtags
                  </Text>
                  <View style={styles.wrap}>
                    {top.data.hashtags.map((t) => (
                      <Chip key={t.tag} label={`#${t.tag} · ${t.posts_count}`} size="sm" onPress={() => router.navigate(`/tag/${t.tag}` as never)} />
                    ))}
                  </View>
                </View>
              ) : null}
              {top.data?.posts.length ? (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text variant="h4">Posts</Text>
                    <Pressable onPress={() => setTab('posts')}>
                      <Text variant="smallMedium" color="primary">
                        See all
                      </Text>
                    </Pressable>
                  </View>
                  {top.data.posts.slice(0, 3).map((p) => (
                    <Pressable key={p.id} onPress={() => router.navigate(`/post/${p.id}` as never)} style={[styles.postRow, { borderColor: colors.border }]}>
                      <Text variant="smallMedium">{p.author.display_name}</Text>
                      <Text variant="small" color="textSecondary" numberOfLines={2}>
                        {p.text}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {!top.data?.users.length && !top.data?.hashtags.length && !top.data?.posts.length ? <EmptyState compact icon="search-outline" title="No results" description={`Nothing matched “${debounced}”.`} /> : null}
            </>
          )
        ) : tab === 'people' ? (
          people.loading ? (
            <SkeletonList count={8} />
          ) : people.data && people.data.length > 0 ? (
            people.data.map((p) => <ProfileRow key={p.id} profile={p} right={p.id !== user?.id ? <FollowButton targetId={p.id} state="none" isPrivate={p.is_private} /> : undefined} />)
          ) : (
            <EmptyState compact icon="people-outline" title="No people found" description="Try a different name or username." />
          )
        ) : tags.loading ? (
          <SkeletonList count={4} />
        ) : tags.data && tags.data.length > 0 ? (
          tags.data.map((t) => (
            <Pressable key={t.tag} onPress={() => router.navigate(`/tag/${t.tag}` as never)} style={styles.recentRow}>
              <View style={[styles.tagIcon, { backgroundColor: colors.primarySoft }]}>
                <Text variant="h4" color="primary">
                  #
                </Text>
              </View>
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text variant="bodyMedium">#{t.tag}</Text>
                <Text variant="small" color="textMuted">
                  {t.posts_count} post{t.posts_count === 1 ? '' : 's'}
                </Text>
              </View>
            </Pressable>
          ))
        ) : (
          <EmptyState compact icon="pricetag-outline" title="No hashtags found" />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
  section: { marginTop: spacing['2xl'] },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  recentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  postRow: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  tagIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
