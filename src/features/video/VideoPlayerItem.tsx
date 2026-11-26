import { Ionicons } from '@/components/ui/Ionicons';
import { useEventListener } from 'expo';
import { useAudioPlayer } from 'expo-audio';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { memo, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { Text } from '@/components/ui/Text';
import { recordVideoView } from '@/services/videos';
import { useVideoStore } from '@/store/videoStore';
import { absoluteFillObject, palette, radius, spacing } from '@/theme/tokens';
import { VIDEO_FILTERS, type VideoCard } from '@/types/video';
import { formatCount } from '@/utils/format';

import { useVideoActions } from './useVideoActions';

export interface VideoPlayerItemProps {
  video: VideoCard;
  active: boolean;
  height: number;
  width: number;
  onOpenComments: (video: VideoCard) => void;
  onOpenGift: (video: VideoCard) => void;
  onOpenMore: (video: VideoCard) => void;
  showBack?: boolean;
  bottomInset?: number;
}

function RailButton({ icon, label, active, color, onPress }: { icon: keyof typeof Ionicons.glyphMap; label?: string; active?: boolean; color?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.railButton} hitSlop={6} accessibilityRole="button" accessibilityLabel={label ?? icon}>
      <Ionicons name={icon} size={30} color={active ? (color ?? palette.pink) : palette.white} style={styles.railIcon} />
      {label !== undefined ? (
        <Text variant="caption" color={palette.white} style={styles.railLabel}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

function filterStyle(filter: string) {
  const f = VIDEO_FILTERS.find((x) => x.id === filter);
  return f?.tint ?? null;
}

/**
 * One full-screen video. Playback-time composition: trim range, playback rate,
 * external sound mix, colour filter, text/sticker overlays, duet split-screen
 * and stitch (reference segment first) are all applied here — no server
 * transcoding is required.
 */
export const VideoPlayerItem = memo(function VideoPlayerItem({ video, active, height, width, onOpenComments, onOpenGift, onOpenMore, showBack, bottomInset = 0 }: VideoPlayerItemProps) {
  const insets = useSafeAreaInsets();
  const actions = useVideoActions();
  const muted = useVideoStore((s) => s.muted);
  const setMuted = useVideoStore((s) => s.setMuted);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [heart, setHeart] = useState(false);
  const watchedMs = useRef(0);
  const lastTime = useRef<number | null>(null);
  const reportedView = useRef(false);
  const lastTap = useRef(0);

  const duet = video.duet_of && !('unavailable' in video.duet_of) ? video.duet_of : null;
  const stitch = video.stitch_of && !('unavailable' in video.stitch_of) ? video.stitch_of : null;
  const [phase, setPhase] = useState<'ref' | 'main'>(stitch ? 'ref' : 'main');

  const player = useVideoPlayer(video.media_url ?? '', (p) => {
    p.loop = !stitch;
    p.timeUpdateEventInterval = 0.25;
    p.playbackRate = video.playback_rate ?? 1;
    p.volume = video.original_volume ?? 1;
  });
  const refPlayer = useVideoPlayer(duet?.media_url ?? stitch?.media_url ?? '', (p) => {
    p.loop = Boolean(duet);
    p.timeUpdateEventInterval = 0.25;
    p.volume = duet ? 0.6 : 1;
  });
  const sound = useAudioPlayer(video.sound && !video.sound.is_original && video.sound.url ? { uri: video.sound.url } : null);

  const playing = active && !paused;
  const trimStart = (video.trim_start_ms ?? 0) / 1000;
  const trimEnd = video.trim_end_ms ? video.trim_end_ms / 1000 : null;

  useEffect(() => {
    player.muted = muted;
    refPlayer.muted = muted;
    sound.volume = muted ? 0 : (video.sound_volume ?? 1);
  }, [muted, player, refPlayer, sound, video.sound_volume]);

  useEffect(() => {
    if (playing) {
      if (phase === 'main' || duet) {
        if (player.currentTime < trimStart) player.currentTime = trimStart;
        player.play();
        if (video.sound && !video.sound.is_original && video.sound.url) {
          sound.loop = true;
          sound.play();
        }
      }
      if (duet || (stitch && phase === 'ref')) {
        if (stitch && phase === 'ref') refPlayer.currentTime = (stitch.stitch_start_ms ?? 0) / 1000;
        refPlayer.play();
      }
    } else {
      player.pause();
      refPlayer.pause();
      sound.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, phase]);

  // Reset playback state when the item scrolls away (derived during render).
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) {
      setPaused(false);
      setPhase(stitch ? 'ref' : 'main');
    }
  }
  // Report a partial view once the item leaves the screen.
  useEffect(() => {
    if (active) return;
    if (watchedMs.current > 1000 && !reportedView.current) {
      reportedView.current = true;
      void recordVideoView(video.id, watchedMs.current, false);
    }
  }, [active, video.id]);

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (!active) return;
    if (lastTime.current !== null && currentTime > lastTime.current) watchedMs.current += (currentTime - lastTime.current) * 1000;
    lastTime.current = currentTime;
    const duration = player.duration || (video.duration_ms ?? 0) / 1000;
    const end = trimEnd ?? duration;
    if (end > 0) setProgress(Math.min(1, Math.max(0, (currentTime - trimStart) / Math.max(0.1, end - trimStart))));
    if (trimEnd && currentTime >= trimEnd) {
      player.currentTime = trimStart;
      if (sound.playing) sound.seekTo(0);
      if (!reportedView.current) {
        reportedView.current = true;
        void recordVideoView(video.id, watchedMs.current, true);
      }
    } else if (currentTime < 0.3 && lastTime.current !== null && sound.playing && sound.currentTime > 1) {
      sound.seekTo(0);
    }
  });

  useEventListener(player, 'playToEnd', () => {
    if (!reportedView.current) {
      reportedView.current = true;
      void recordVideoView(video.id, watchedMs.current, true);
    }
    if (stitch) {
      setPhase('ref');
    }
  });

  useEventListener(refPlayer, 'timeUpdate', ({ currentTime }) => {
    if (!stitch || phase !== 'ref' || !active) return;
    const end = stitch.stitch_end_ms ? stitch.stitch_end_ms / 1000 : (stitch.stitch_start_ms ?? 0) / 1000 + 5;
    if (currentTime >= end) {
      refPlayer.pause();
      setPhase('main');
      player.currentTime = trimStart;
    }
  });

  const onTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      lastTap.current = 0;
      if (!video.viewer.liked) void actions.like(video);
      setHeart(true);
      setTimeout(() => setHeart(false), 700);
      return;
    }
    lastTap.current = now;
    setTimeout(() => {
      if (lastTap.current === now) setPaused((p) => !p);
    }, 290);
  };

  const tint = filterStyle(video.filter);
  const overlays = video.overlays ?? [];
  const captionLines = captionExpanded ? undefined : 2;
  const showRef = Boolean(duet) || (Boolean(stitch) && phase === 'ref');

  return (
    <View style={{ width, height, backgroundColor: palette.black }}>
      <Pressable onPress={onTap} style={StyleSheet.absoluteFill} accessibilityLabel="Video">
        {duet ? (
          <View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
            <View style={{ flex: 1 }}>
              <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
            </View>
            <View style={{ flex: 1 }}>
              <VideoView player={refPlayer} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
            </View>
          </View>
        ) : (
          <>
            <VideoView player={player} style={[StyleSheet.absoluteFill, showRef && !duet ? { opacity: 0 } : null]} contentFit="cover" nativeControls={false} />
            {stitch ? <VideoView player={refPlayer} style={[StyleSheet.absoluteFill, phase === 'main' ? { opacity: 0 } : null]} contentFit="cover" nativeControls={false} /> : null}
          </>
        )}
        {!active && video.thumbnail_url ? <Image source={{ uri: video.thumbnail_url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
        {tint ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} /> : null}
        {overlays.map((o) => (
          <View key={o.id} pointerEvents="none" style={{ position: 'absolute', left: o.x * width, top: o.y * height, transform: [{ translateX: -50 }, { scale: o.scale ?? 1 }] }}>
            {o.kind === 'sticker' ? (
              <Text style={{ fontSize: 48 }}>{o.emoji}</Text>
            ) : (
              <Text variant="h3" color={o.color ?? palette.white} style={[styles.overlayText, o.background ? { backgroundColor: o.background } : null]}>
                {o.text}
              </Text>
            )}
          </View>
        ))}
        {stitch && phase === 'ref' ? (
          <View style={[styles.stitchBadge, { top: insets.top + spacing.md }]}>
            <Ionicons name="cut-outline" size={14} color={palette.white} />
            <Text variant="caption" color={palette.white} style={{ marginLeft: 4 }}>
              Stitched from @{stitch.author.username}
            </Text>
          </View>
        ) : null}
        {paused ? (
          <View style={styles.center} pointerEvents="none">
            <Ionicons name="play" size={72} color="rgba(255,255,255,0.85)" />
          </View>
        ) : null}
        {heart ? (
          <View style={styles.center} pointerEvents="none">
            <Ionicons name="heart" size={110} color={palette.pink} />
          </View>
        ) : null}
      </Pressable>

      <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.75)']} style={styles.bottomShade} />

      {showBack ? (
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))} style={[styles.back, { top: insets.top + spacing.sm }]} accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color={palette.white} />
        </Pressable>
      ) : null}

      <Pressable onPress={() => setMuted(!muted)} style={[styles.mute, { top: insets.top + spacing.sm }]} accessibilityLabel={muted ? 'Unmute' : 'Mute'}>
        <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={20} color={palette.white} />
      </Pressable>

      {/* Right action rail */}
      <View style={[styles.rail, { bottom: bottomInset + spacing['4xl'] }]}>
        <Pressable onPress={() => router.navigate(`/u/${video.author.username}` as never)} style={styles.railAvatar} accessibilityLabel={`Open ${video.author.display_name}'s profile`}>
          <Avatar uri={video.author.avatar_url} name={video.author.display_name} size={46} verified={video.author.is_verified} />
          {!video.viewer.following_author && !video.viewer.is_author ? (
            <View style={styles.followPlus}>
              <Ionicons name="add" size={14} color={palette.white} />
            </View>
          ) : null}
        </Pressable>
        <RailButton icon={video.viewer.liked ? 'heart' : 'heart-outline'} active={video.viewer.liked} label={formatCount(video.likes_count)} onPress={() => void actions.like(video)} />
        <RailButton icon="chatbubble-ellipses-outline" label={formatCount(video.comments_count)} onPress={() => onOpenComments(video)} />
        <RailButton icon={video.viewer.saved ? 'bookmark' : 'bookmark-outline'} active={video.viewer.saved} color={palette.gold} label={formatCount(video.saves_count)} onPress={() => void actions.save(video)} />
        <RailButton icon="gift-outline" label="Gift" onPress={() => onOpenGift(video)} />
        <RailButton icon="arrow-redo-outline" label={formatCount(video.shares_count)} onPress={() => void actions.share(video)} />
        <RailButton icon="ellipsis-horizontal" onPress={() => onOpenMore(video)} />
        {video.sound ? (
          <Pressable onPress={() => router.navigate(`/sound/${video.sound!.id}` as never)} style={styles.disc} accessibilityLabel="Open sound">
            {video.sound.cover_url ? <Image source={{ uri: video.sound.cover_url }} style={styles.discImage} /> : <Ionicons name="musical-notes" size={18} color={palette.white} />}
          </Pressable>
        ) : null}
      </View>

      {/* Caption */}
      <View style={[styles.caption, { bottom: bottomInset + spacing.lg, maxWidth: width - 96 }]}>
        <Pressable onPress={() => router.navigate(`/u/${video.author.username}` as never)}>
          <Text variant="bodySemibold" color={palette.white}>
            @{video.author.username}
            {video.author.is_premium ? '  💎' : ''}
          </Text>
        </Pressable>
        {video.caption ? (
          <Pressable onPress={() => setCaptionExpanded((e) => !e)}>
            <Text variant="small" color={palette.white} numberOfLines={captionLines} style={{ marginTop: 4 }}>
              {video.caption}
            </Text>
          </Pressable>
        ) : null}
        {video.hashtags.length > 0 ? (
          <View style={styles.tags}>
            {video.hashtags.slice(0, 4).map((t) => (
              <Pressable key={t} onPress={() => router.navigate(`/tag/${t}` as never)}>
                <Text variant="smallMedium" color={palette.lavender}>
                  #{t}{' '}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {video.sound ? (
          <Pressable onPress={() => router.navigate(`/sound/${video.sound!.id}` as never)} style={styles.soundRow}>
            <Ionicons name="musical-note" size={14} color={palette.white} />
            <Text variant="caption" color={palette.white} numberOfLines={1} style={{ marginLeft: 6, flex: 1 }}>
              {video.sound.title}
              {video.sound.artist ? ` · ${video.sound.artist}` : ''}
            </Text>
          </Pressable>
        ) : null}
        {duet ? (
          <Text variant="caption" color="rgba(255,255,255,0.8)" style={{ marginTop: 4 }}>
            Duet with @{duet.author.username}
          </Text>
        ) : null}
      </View>

      {/* Progress */}
      <View style={[styles.progress, { bottom: bottomInset }]} pointerEvents="none">
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>
      {Platform.OS === 'web' && !active ? null : null}
    </View>
  );
});

const styles = StyleSheet.create({
  center: { ...absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  bottomShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 220 },
  back: { position: 'absolute', left: spacing.md, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  mute: { position: 'absolute', right: spacing.md, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  rail: { position: 'absolute', right: spacing.sm, alignItems: 'center' },
  railAvatar: { marginBottom: spacing.lg, alignItems: 'center' },
  followPlus: { position: 'absolute', bottom: -8, width: 20, height: 20, borderRadius: 10, backgroundColor: palette.pink, alignItems: 'center', justifyContent: 'center' },
  railButton: { alignItems: 'center', marginBottom: spacing.md, minWidth: 48 },
  railIcon: { textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6 },
  railLabel: { marginTop: 2 },
  disc: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.night3, borderWidth: 6, borderColor: palette.night4, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, overflow: 'hidden' },
  discImage: { width: 40, height: 40 },
  caption: { position: 'absolute', left: spacing.lg },
  tags: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
  soundRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  overlayText: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6 },
  stitchBadge: { position: 'absolute', left: spacing.lg + 48, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  progress: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.2)' },
  progressFill: { height: 2, backgroundColor: palette.white },
});
