import { useEventListener } from 'expo';
import { useAudioPlayer } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@/components/ui/Ionicons';

import { Text } from '@/components/ui/Text';
import { absoluteFillObject, palette, radius } from '@/theme/tokens';
import { VIDEO_FILTERS, type VideoDraftData, type VideoOverlay } from '@/types/video';

interface Props {
  draft: VideoDraftData;
  soundUrl: string | null;
  playing: boolean;
  onTogglePlay: () => void;
  onDuration: (ms: number) => void;
  onMoveOverlay: (id: string, x: number, y: number) => void;
  onRemoveOverlay: (id: string) => void;
  selectedOverlay?: string | null;
  onSelectOverlay?: (id: string | null) => void;
  seekTo?: number | null;
}

function Draggable({ overlay, width, height, onMove, onRemove, selected, onSelect }: { overlay: VideoOverlay; width: number; height: number; onMove: (x: number, y: number) => void; onRemove: () => void; selected: boolean; onSelect: () => void }) {
  // While dragging we render the finger position; otherwise the stored overlay position.
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const latest = useRef({ overlay, width, height, onMove, onSelect, drag: null as { x: number; y: number } | null, start: { x: overlay.x, y: overlay.y } });
  latest.current.overlay = overlay;
  latest.current.width = width;
  latest.current.height = height;
  latest.current.onMove = onMove;
  latest.current.onSelect = onSelect;
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        latest.current.start = { x: latest.current.overlay.x, y: latest.current.overlay.y };
        latest.current.onSelect();
      },
      onPanResponderMove: (_, g) => {
        const { width: w, height: h, start } = latest.current;
        if (!w || !h) return;
        const next = { x: Math.min(0.98, Math.max(0.02, start.x + g.dx / w)), y: Math.min(0.95, Math.max(0.02, start.y + g.dy / h)) };
        latest.current.drag = next;
        setDrag(next);
      },
      onPanResponderRelease: () => {
        const d = latest.current.drag;
        latest.current.drag = null;
        setDrag(null);
        if (d) latest.current.onMove(d.x, d.y);
      },
    }),
  ).current;
  const pos = drag ?? { x: overlay.x, y: overlay.y };
  return (
    <View {...responder.panHandlers} style={{ position: 'absolute', left: pos.x * width, top: pos.y * height, transform: [{ translateX: -50 }, { scale: overlay.scale ?? 1 }] }}>
      <View style={[selected && styles.selected]}>
        {overlay.kind === 'sticker' ? (
          <Text style={{ fontSize: 48 }}>{overlay.emoji}</Text>
        ) : (
          <Text variant="h3" color={overlay.color ?? palette.white} style={[styles.text, overlay.background ? { backgroundColor: overlay.background } : null]}>
            {overlay.text}
          </Text>
        )}
      </View>
      {selected ? (
        <Pressable onPress={onRemove} style={styles.remove} accessibilityLabel="Remove">
          <Ionicons name="close" size={14} color={palette.white} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Live preview of the clip with trim/speed/filter/overlays/sound applied (same rules as playback). */
export function VideoEditorPreview({ draft, soundUrl, playing, onTogglePlay, onDuration, onMoveOverlay, onRemoveOverlay, selectedOverlay, onSelectOverlay, seekTo }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const player = useVideoPlayer(draft.uri ?? '', (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 0.2;
  });
  const sound = useAudioPlayer(soundUrl ? { uri: soundUrl } : null);
  const reported = useRef(false);

  useEffect(() => {
    player.playbackRate = draft.playback_rate;
    player.volume = draft.original_volume;
    sound.volume = draft.sound_volume;
  }, [draft.playback_rate, draft.original_volume, draft.sound_volume, player, sound]);

  useEffect(() => {
    if (playing) {
      if (player.currentTime < draft.trim_start_ms / 1000) player.currentTime = draft.trim_start_ms / 1000;
      player.play();
      if (soundUrl) {
        sound.loop = true;
        sound.play();
      }
    } else {
      player.pause();
      sound.pause();
    }
  }, [playing, player, sound, soundUrl, draft.trim_start_ms]);

  useEffect(() => {
    if (seekTo != null) {
      player.currentTime = seekTo / 1000;
    }
  }, [seekTo, player]);

  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'readyToPlay' && !reported.current && player.duration > 0) {
      reported.current = true;
      onDuration(Math.round(player.duration * 1000));
    }
  });

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const end = draft.trim_end_ms ? draft.trim_end_ms / 1000 : null;
    if (end && currentTime >= end) {
      player.currentTime = draft.trim_start_ms / 1000;
      if (soundUrl) sound.seekTo(0);
    } else if (currentTime < draft.trim_start_ms / 1000 - 0.05) {
      player.currentTime = draft.trim_start_ms / 1000;
    }
  });

  const tint = VIDEO_FILTERS.find((f) => f.id === draft.filter)?.tint ?? null;

  return (
    <View style={styles.root} onLayout={(e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => { onSelectOverlay?.(null); onTogglePlay(); }} accessibilityLabel={playing ? 'Pause preview' : 'Play preview'}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
        {tint ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} /> : null}
        {!playing ? (
          <View style={styles.center} pointerEvents="none">
            <Ionicons name="play" size={64} color="rgba(255,255,255,0.85)" />
          </View>
        ) : null}
      </Pressable>
      {size.width > 0
        ? draft.overlays.map((o) => <Draggable key={o.id} overlay={o} width={size.width} height={size.height} onMove={(x, y) => onMoveOverlay(o.id, x, y)} onRemove={() => onRemoveOverlay(o.id)} selected={selectedOverlay === o.id} onSelect={() => onSelectOverlay?.(o.id)} />)
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.black, borderRadius: radius.xl, overflow: 'hidden' },
  center: { ...absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  text: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6 },
  selected: { borderWidth: 1, borderColor: palette.white, borderStyle: 'dashed', borderRadius: radius.sm },
  remove: { position: 'absolute', top: -10, right: -10, width: 22, height: 22, borderRadius: 11, backgroundColor: palette.danger, alignItems: 'center', justifyContent: 'center' },
});
