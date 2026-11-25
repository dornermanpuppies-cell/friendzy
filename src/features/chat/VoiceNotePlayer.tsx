import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { palette, radius, spacing } from '@/theme/tokens';

const RATES = [1, 1.5, 2];

export interface VoiceNotePlayerProps {
  uri: string | null;
  durationMs?: number | null;
  waveform?: number[] | null;
  tint?: string;
  trackColor?: string;
  textColor?: string;
  compact?: boolean;
}

function fmt(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function VoiceNotePlayer({ uri, durationMs, waveform, tint = palette.white, trackColor = 'rgba(255,255,255,0.35)', textColor = palette.white, compact = false }: VoiceNotePlayerProps) {
  const player = useAudioPlayer(uri ?? null);
  const status = useAudioPlayerStatus(player);
  const [rateIndex, setRateIndex] = useState(0);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
  }, []);

  const duration = status.duration > 0 ? status.duration : (durationMs ?? 0) / 1000;
  const progress = duration > 0 ? Math.min(1, status.currentTime / duration) : 0;
  const bars = useMemo(() => {
    const source = waveform && waveform.length > 0 ? waveform : Array.from({ length: 32 }, (_, i) => 0.3 + 0.5 * Math.abs(Math.sin(i * 1.3)));
    const target = compact ? 24 : 36;
    if (source.length === target) return source;
    return Array.from({ length: target }, (_, i) => source[Math.floor((i / target) * source.length)] ?? 0.4);
  }, [waveform, compact]);

  const toggle = () => {
    if (!uri) return;
    if (status.playing) player.pause();
    else {
      if (status.didJustFinish || (duration > 0 && status.currentTime >= duration - 0.05)) player.seekTo(0).catch(() => undefined);
      player.play();
    }
  };

  const cycleRate = () => {
    const next = (rateIndex + 1) % RATES.length;
    setRateIndex(next);
    player.setPlaybackRate(RATES[next]);
  };

  return (
    <View style={[styles.row, compact && { minWidth: 160 }]}>
      <Pressable onPress={toggle} style={[styles.play, { backgroundColor: tint }]} accessibilityLabel={status.playing ? 'Pause voice message' : 'Play voice message'} disabled={!uri}>
        <Ionicons name={status.playing ? 'pause' : 'play'} size={18} color={tint === palette.white ? palette.purple : palette.white} style={status.playing ? undefined : { marginLeft: 2 }} />
      </Pressable>
      <Pressable
        onPress={(e) => {
          const width = (e.nativeEvent as { layoutMeasurement?: { width: number } }).layoutMeasurement?.width;
          if (width && duration) player.seekTo((e.nativeEvent.locationX / width) * duration).catch(() => undefined);
        }}
        style={styles.wave}
        accessibilityLabel="Seek"
      >
        {bars.map((v, i) => (
          <View key={i} style={[styles.bar, { height: 4 + v * 20, backgroundColor: i / bars.length <= progress ? tint : trackColor }]} />
        ))}
      </Pressable>
      <View style={styles.meta}>
        <Text variant="caption" style={{ color: textColor }}>
          {fmt(status.playing || status.currentTime > 0 ? status.currentTime : duration)}
        </Text>
        <Pressable onPress={cycleRate} hitSlop={6} style={[styles.rate, { borderColor: trackColor }]} accessibilityLabel="Playback speed">
          <Text variant="caption" style={{ color: textColor, fontSize: 10 }}>
            {RATES[rateIndex]}x
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minWidth: 220 },
  play: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  wave: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, marginHorizontal: spacing.sm, height: 28 },
  bar: { width: 3, borderRadius: 2 },
  meta: { alignItems: 'center', gap: 2 },
  rate: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: 5, paddingVertical: 1 },
});
