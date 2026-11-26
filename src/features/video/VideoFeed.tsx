import { Ionicons } from '@/components/ui/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/EmptyState';
import { Text } from '@/components/ui/Text';
import { GiftSheet } from '@/features/economy/GiftSheet';
import type { PagedQuery } from '@/hooks/usePagedQuery';
import { useVideoStore } from '@/store/videoStore';
import { palette, spacing } from '@/theme/tokens';
import type { VideoCard } from '@/types/video';

import { VideoCommentsSheet } from './VideoCommentsSheet';
import { VideoMoreSheet } from './VideoMoreSheet';
import { VideoPlayerItem } from './VideoPlayerItem';

interface ViewableItem {
  index: number | null | undefined;
  isViewable: boolean;
  item: VideoCard;
}

export interface VideoFeedProps {
  query: PagedQuery<VideoCard>;
  header?: ReactNode;
  initialIndex?: number;
  showBack?: boolean;
  bottomInset?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  focused?: boolean;
}

/** Full-screen vertical video pager (TikTok-style) with autoplay of the visible item. */
export function VideoFeed({ query, header, initialIndex = 0, showBack, bottomInset = 0, emptyTitle = 'No videos yet', emptyDescription = 'Follow creators or be the first to post a short video.', focused = true }: VideoFeedProps) {
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [comments, setComments] = useState<VideoCard | null>(null);
  const [gift, setGift] = useState<VideoCard | null>(null);
  const [more, setMore] = useState<VideoCard | null>(null);
  const upsert = useVideoStore((s) => s.upsert);
  const byId = useVideoStore((s) => s.byId);
  const removed = useVideoStore((s) => s.removed);
  const listRef = useRef<FlatList<VideoCard>>(null);

  useEffect(() => {
    if (query.items.length) upsert(query.items);
  }, [query.items, upsert]);

  const items = useMemo(() => query.items.filter((v) => !removed[v.id]).map((v) => byId[v.id] ?? v), [query.items, byId, removed]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.width || height !== size.height) setSize({ width, height });
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewableItem[] }) => {
    const first = viewableItems.find((v) => v.isViewable && v.index !== null);
    if (first && first.index != null) setActiveIndex(first.index);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  const renderItem = useCallback(
    ({ item, index }: { item: VideoCard; index: number }) => (
      <VideoPlayerItem video={item} active={focused && index === activeIndex} height={size.height} width={size.width} onOpenComments={setComments} onOpenGift={setGift} onOpenMore={setMore} showBack={showBack} bottomInset={bottomInset} />
    ),
    [activeIndex, size.height, size.width, showBack, bottomInset, focused],
  );

  const sheetOpen = Boolean(comments || gift || more);

  return (
    <View style={styles.root} onLayout={onLayout}>
      {size.height > 0 ? (
        query.loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={palette.white} />
          </View>
        ) : query.error ? (
          <View style={styles.center}>
            <EmptyState icon="cloud-offline-outline" title="Couldn't load videos" description={query.error} action={{ title: 'Retry', onPress: () => void query.refresh(), variant: 'secondary' }} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.center}>
            <EmptyState emoji="🎬" title={emptyTitle} description={emptyDescription} action={{ title: 'Create a video', onPress: () => router.navigate('/compose/video' as never), leftIcon: 'videocam-outline' }} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={items}
            keyExtractor={(v) => v.id}
            renderItem={renderItem}
            pagingEnabled
            snapToInterval={size.height}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum
            showsVerticalScrollIndicator={false}
            getItemLayout={(_, index) => ({ length: size.height, offset: size.height * index, index })}
            initialScrollIndex={initialIndex > 0 && initialIndex < items.length ? initialIndex : undefined}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            onEndReached={() => void query.loadMore()}
            onEndReachedThreshold={2}
            windowSize={3}
            maxToRenderPerBatch={2}
            initialNumToRender={1}
            removeClippedSubviews={false}
            extraData={`${activeIndex}:${sheetOpen}:${focused}`}
          />
        )
      ) : null}
      {header ? <View style={[styles.header, { top: insets.top }]}>{header}</View> : null}
      {query.loadingMore ? (
        <View style={[styles.loadingMore, { bottom: bottomInset + spacing.md }]}>
          <ActivityIndicator color={palette.white} size="small" />
        </View>
      ) : null}
      {items.length > 0 && query.refreshing ? (
        <View style={[styles.refreshing, { top: insets.top + 56 }]}>
          <ActivityIndicator color={palette.white} size="small" />
          <Text variant="caption" color={palette.white} style={{ marginLeft: spacing.sm }}>
            Refreshing…
          </Text>
        </View>
      ) : null}
      {items.length > 0 ? (
        <Pressable onPress={() => void query.refresh()} style={[styles.refreshButton, { top: insets.top + spacing.sm }]} accessibilityLabel="Refresh videos">
          <Ionicons name="refresh" size={18} color={palette.white} />
        </Pressable>
      ) : null}

      <VideoCommentsSheet video={comments} onClose={() => setComments(null)} />
      <GiftSheet visible={Boolean(gift)} onClose={() => setGift(null)} targetType="video" targetId={gift?.id ?? null} recipient={gift?.author ?? null} />
      <VideoMoreSheet video={more} onClose={() => setMore(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.black },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing['2xl'] },
  header: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  loadingMore: { position: 'absolute', alignSelf: 'center' },
  refreshing: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: 6 },
  refreshButton: { position: 'absolute', right: spacing.md + 44, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
});
