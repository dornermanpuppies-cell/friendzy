import { Ionicons } from '@expo/vector-icons';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';

import { VoiceNotePlayer } from './VoiceNotePlayer';

export interface VoiceNoteResult {
  uri: string;
  durationMs: number;
  waveform: number[];
  mime: string;
}

export interface VoiceRecorderProps {
  onSend: (note: VoiceNoteResult) => void;
  onCancel: () => void;
}

const MAX_SECONDS = 300;

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Records a voice note: tap to start, stop to preview, then send or discard. */
export function VoiceRecorder({ onSend, onCancel }: VoiceRecorderProps) {
  const { colors } = useTheme();
  const toast = useToast();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const state = useAudioRecorderState(recorder, 100);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'preview'>('idle');
  const [preview, setPreview] = useState<VoiceNoteResult | null>(null);
  const samples = useRef<number[]>([]);
  const startedAt = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (!permission.granted) {
          toast.error('Microphone access is needed to record voice messages.');
          onCancel();
          return;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        startedAt.current = Date.now();
        samples.current = [];
        setPhase('recording');
      } catch (error) {
        toast.error(getErrorMessage(error));
        onCancel();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = async () => {
    if (phase !== 'recording') return;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      const durationMs = Math.max(state.durationMillis, Date.now() - startedAt.current);
      if (!uri || durationMs < 700) {
        toast.info('Hold a bit longer to record a voice message.');
        onCancel();
        return;
      }
      const wave = downsample(samples.current, 48);
      setPreview({ uri, durationMs, waveform: wave, mime: Platform.OS === 'web' ? 'audio/webm' : 'audio/m4a' });
      setPhase('preview');
    } catch (error) {
      toast.error(getErrorMessage(error));
      onCancel();
    }
  };

  // Collect metering samples for the waveform.
  useEffect(() => {
    if (phase !== 'recording') return;
    const metering = state.metering;
    if (typeof metering === 'number' && Number.isFinite(metering)) {
      // dBFS (≈ -160..0) → 0..1
      samples.current.push(Math.min(1, Math.max(0.05, (metering + 60) / 60)));
    }
    if (state.durationMillis >= MAX_SECONDS * 1000) void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.metering, state.durationMillis, phase]);

  const cancel = async () => {
    try {
      if (phase === 'recording') await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch {
      /* ignore */
    }
    onCancel();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
      <Pressable onPress={cancel} hitSlop={8} style={styles.iconBtn} accessibilityLabel="Discard recording">
        <Ionicons name="trash-outline" size={22} color={palette.danger} />
      </Pressable>
      {phase === 'preview' && preview ? (
        <View style={{ flex: 1 }}>
          <VoiceNotePlayer uri={preview.uri} durationMs={preview.durationMs} waveform={preview.waveform} tint={colors.primary} trackColor={colors.borderStrong} textColor={colors.textSecondary} compact />
        </View>
      ) : (
        <View style={styles.recording}>
          <View style={styles.dot} />
          <Text variant="bodyMedium" style={{ marginLeft: spacing.sm }}>
            {fmt(state.durationMillis)}
          </Text>
          <View style={styles.liveWave}>
            {samples.current.slice(-24).map((v, i) => (
              <View key={i} style={[styles.liveBar, { height: 4 + v * 18, backgroundColor: colors.primary }]} />
            ))}
          </View>
          <Text variant="caption" color="textMuted">
            {phase === 'idle' ? 'Starting…' : 'Recording'}
          </Text>
        </View>
      )}
      {phase === 'preview' && preview ? (
        <Pressable onPress={() => onSend(preview)} style={[styles.send, { backgroundColor: colors.primary }]} accessibilityLabel="Send voice message">
          <Ionicons name="send" size={18} color={palette.white} />
        </Pressable>
      ) : (
        <Pressable onPress={stop} style={[styles.send, { backgroundColor: palette.danger }]} accessibilityLabel="Stop recording" disabled={phase !== 'recording'}>
          <Ionicons name="stop" size={18} color={palette.white} />
        </Pressable>
      )}
    </View>
  );
}

function downsample(values: number[], buckets: number): number[] {
  if (values.length === 0) return [];
  const size = Math.max(1, Math.floor(values.length / buckets));
  const out: number[] = [];
  for (let i = 0; i < values.length; i += size) {
    const chunk = values.slice(i, i + size);
    out.push(Number((chunk.reduce((a, b) => a + b, 0) / chunk.length).toFixed(2)));
  }
  return out.slice(0, buckets);
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, minHeight: 52 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  recording: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.danger },
  liveWave: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, marginHorizontal: spacing.sm, height: 24 },
  liveBar: { width: 3, borderRadius: 2 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
