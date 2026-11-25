import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

type ViewToken = { item: unknown; isViewable: boolean };

import { EmptyState, type EmptyStateProps } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import type { PagedQuery } from '@/hooks/usePagedQuery';
import { queueImpression } from '@/services/posts';
import { usePostStore } from '@/store/postStore';
import { useTheme } from '@/theme/ThemeProvider';
import { layout, spacing } from '@/theme/tokens';
import type { PostCard as PostCardModel } from '@/types/social';

import { PostCard } from './PostCard';

export interface FeedListProps {
  query: PagedQuery<PostCardModel>;
  header?: ReactElement | null;
  empty: EmptyStateProps;
  /** Track impressions + autoplay (disable for lists where that would be noise). */
  trackViews?: boolean;
  contentContainerStyle?: object;
  onScrollBeginDrag?: () => void;
}

function ConnectedPostCard({ id, active, onRemoved }: { id: string; active: boolean; onRemoved: (id: string) => void }) {
  const post = usePostStore((s) => s.byId[id]);
  if (!post) return null;
  return <PostCard post={post} active={active} onRemoved={onRemoved} />;
}

export function PostSkeleton() {
  return (
    <View style={styles.skeleton}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Skeleton circle height={44} />
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Skeleton width="45%" height={14} />
          <Skeleton width="30%" height={12} style={{ marginTop: spacing.sm }} />
        </View>
      </View>
      <Skeleton height={14} style={{ marginTop: spacing.lg }} />
      <Skeleton width="80%" height={14} style={{ marginTop: spacing.sm }} />
      <Skeleton height={220} rounded={16} style={{ marginTop: spacing.md }} />
    </View>
  );
}

/**
 * Virtualised list of post cards backed by the normalised post store.
 * Handles pagination, pull-to-refresh, impressions and single-video autoplay.
 */
export function FeedList({ query, header, empty, trackViews = true, contentContainerStyle, onScrollBeginDrag }: FeedListProps) {
  const { colors } = useTheme();
  const upsert = usePostStore((s) => s.upsert);
  const [activeId, setActiveId] = useState<string | null>(null);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (query.items.length) upsert(query.items);
  }, [query.items, upsert]);

  const ids = useMemo(() => query.items.map((p) => p.id), [query.items]);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const visible = viewableItems.filter((v) => v.isViewable);
    if (visible.length === 0) return;
    const first = visible[0].item as string;
    setActiveId(first);
    if (!trackViews) return;
    for (const v of visible) {
      const id = v.item as string;
      if (!seen.current.has(id)) {
        seen.current.add(id);
        queueImpression(id);
      }
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60, minimumViewTime: 400 }).current;
  const onRemoved = useCallback((id: string) => query.removeWhere((p) => p.id === id), [query]);

  if (query.loading) {
    return (
      <View style={[styles.column, contentContainerStyle]}>
        {header}
        <PostSkeleton />
        <PostSkeleton />
      </View>
    );
  }

  return (
    <FlatList
      data={ids}
      keyExtractor={(id) => id}
      renderItem={({ item }) => <ConnectedPostCard id={item} active={item === activeId} onRemoved={onRemoved} />}
      ListHeaderComponent={header ?? undefined}
      ListEmptyComponent={
        query.error ? (
          <EmptyState icon="cloud-offline-outline" title="Couldn't load the feed" description={query.error} action={{ title: 'Try again', onPress: () => void query.refresh(), variant: 'secondary' }} />
        ) : (
          <EmptyState {...empty} />
        )
      }
      ListFooterComponent={query.loadingMore ? <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing['2xl'] }} /> : <View style={{ height: spacing['3xl'] }} />}
      onEndReached={() => void query.loadMore()}
      onEndReachedThreshold={0.6}
      refreshing={query.refreshing}
      onRefresh={() => void query.refresh()}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      onScrollBeginDrag={onScrollBeginDrag}
      contentContainerStyle={[styles.column, contentContainerStyle]}
      removeClippedSubviews={false}
      initialNumToRender={4}
      maxToRenderPerBatch={4}
      windowSize={7}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  column: { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' },
  skeleton: { padding: spacing.lg },
});
