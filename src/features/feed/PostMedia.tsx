import { Ionicons } from '@/components/ui/Ionicons';
import { Image } from 'expo-image';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { absoluteFillObject, palette, radius, spacing } from '@/theme/tokens';
import type { PostMediaItem } from '@/types/social';

export interface PostMediaProps {
  media: PostMediaItem[];
  /** Whether this card is the active one in a scrolling feed (controls video autoplay). */
  active?: boolean;
  onPressItem?: (index: number) => void;
  rounded?: boolean;
  maxAspect?: number;
}

function aspectFor(item: PostMediaItem, fallback = 1): number {
  if (item.width && item.height) {
    const ratio = item.width / item.height;
    return Math.min(Math.max(ratio, 0.8), 1.91);
  }
  return fallback;
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function FeedVideo({ item, active = false, width, height, onPress }: { item: PostMediaItem; active?: boolean; width: number; height: number; onPress?: () => void }) {
  const [muted, setMuted] = useState(true);
  const player = useVideoPlayer(item.url, (p) => {
    p.loop = true;
    p.muted = true;
    p.timeUpdateEventInterval = 0;
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });

  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  return (
    <Pressable onPress={onPress ?? (() => (isPlaying ? player.pause() : player.play()))} style={{ width, height, backgroundColor: palette.night }}>
      <VideoView player={player} style={{ width, height }} contentFit="cover" nativeControls={false} />
      {!isPlaying ? (
        <View style={styles.playOverlay} pointerEvents="none">
          <View style={styles.playButton}>
            <Ionicons name="play" size={26} color={palette.white} style={{ marginLeft: 3 }} />
          </View>
        </View>
      ) : null}
      <Pressable onPress={() => setMuted((m) => !m)} hitSlop={8} style={styles.muteButton} accessibilityLabel={muted ? 'Unmute' : 'Mute'}>
        <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={16} color={palette.white} />
      </Pressable>
      {item.duration_ms ? (
        <View style={styles.durationBadge}>
          <Text variant="caption" color={palette.white}>
            {formatDuration(item.duration_ms)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function PostMedia({ media, active = false, onPressItem, rounded = true, maxAspect }: PostMediaProps) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  if (media.length === 0) return null;

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const first = media[0];
  const aspect = Math.min(aspectFor(first, first.kind === 'video' ? 16 / 9 : 1), maxAspect ?? 1.91);
  const height = width ? Math.round(width / Math.max(aspect, 0.8)) : 0;

  const renderItem = (item: PostMediaItem, i: number) => {
    if (item.kind === 'video') {
      return <FeedVideo item={item} active={active && i === index} width={width} height={height} onPress={onPressItem ? () => onPressItem(i) : undefined} />;
    }
    return (
      <Pressable onPress={() => onPressItem?.(i)} accessibilityRole="imagebutton" accessibilityLabel={item.alt_text ?? 'Post image'}>
        <Image source={{ uri: item.url }} style={{ width, height, backgroundColor: colors.skeleton }} contentFit="cover" transition={150} cachePolicy="memory-disk" recyclingKey={item.id} />
      </Pressable>
    );
  };

  return (
    <View onLayout={onLayout} style={[styles.container, rounded && { borderRadius: radius.lg }]}>
      {width === 0 ? (
        <View style={{ aspectRatio: aspect, backgroundColor: colors.skeleton }} />
      ) : media.length === 1 ? (
        renderItem(first, 0)
      ) : (
        <>
          <FlatList
            data={media}
            keyExtractor={(m) => m.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / Math.max(width, 1)))}
            renderItem={({ item, index: i }) => <View style={{ width }}>{renderItem(item, i)}</View>}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            {...(Platform.OS === 'web' ? ({ style: { scrollSnapType: 'x mandatory' } } as object) : null)}
          />
          <View style={styles.counter}>
            <Text variant="caption" color={palette.white}>
              {index + 1}/{media.length}
            </Text>
          </View>
          <View style={styles.dots} pointerEvents="none">
            {media.map((m, i) => (
              <View key={m.id} style={[styles.dot, { backgroundColor: i === index ? palette.white : 'rgba(255,255,255,0.45)' }]} />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', width: '100%' },
  playOverlay: { ...absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  playButton: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(9,8,23,0.55)', alignItems: 'center', justifyContent: 'center' },
  muteButton: { position: 'absolute', right: spacing.md, bottom: spacing.md, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(9,8,23,0.6)', alignItems: 'center', justifyContent: 'center' },
  durationBadge: { position: 'absolute', left: spacing.md, bottom: spacing.md, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(9,8,23,0.6)' },
  counter: { position: 'absolute', top: spacing.md, right: spacing.md, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: 'rgba(9,8,23,0.6)' },
  dots: { position: 'absolute', bottom: spacing.sm, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
