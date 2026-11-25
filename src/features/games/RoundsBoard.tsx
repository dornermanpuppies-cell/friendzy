import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { GameRoom } from '@/types/games';

import type { RoundsState } from '../../../supabase/functions/_shared/games/rounds.ts';
import { PlayersStrip, TurnBanner, useCountdown } from './GameShared';

function AudioClip({ url, active }: { url: string; active: boolean }) {
  const player = useAudioPlayer({ uri: url });
  const status = useAudioPlayerStatus(player);
  useEffect(() => {
    if (active) {
      player.seekTo(0);
      player.play();
    } else player.pause();
    return () => player.pause();
  }, [active, player, url]);
  return (
    <Pressable onPress={() => (status.playing ? player.pause() : player.play())} style={styles.clip} accessibilityLabel={status.playing ? 'Pause clip' : 'Play clip'}>
      <Ionicons name={status.playing ? 'pause-circle' : 'play-circle'} size={56} color={palette.white} />
      <Text variant="caption" color={palette.white}>
        {status.playing ? 'Listening…' : 'Play the clip'}
      </Text>
    </Pressable>
  );
}

const LETTERS = ['A', 'B', 'C', 'D'];

export function RoundsBoard({ room, myId, onMove, busy }: { room: GameRoom; myId: string; onMove: (move: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const { colors } = useTheme();
  const state = room.state as unknown as RoundsState;
  const seconds = useCountdown(room.turn_deadline);
  const myAnswer = state.answers?.[myId];
  const reveal = state.phase === 'reveal' ? state.lastReveal : null;
  const total = state.phase === 'answer' ? state.answerSeconds : state.revealSeconds;
  const answered = Object.keys(state.answers ?? {}).length;
  const activePlayers = state.order.filter((u) => !state.left.includes(u)).length;
  const kindLabel = state.kind === 'trivia' ? 'Trivia' : state.kind === 'song' ? 'Guess the Song' : 'Would You Rather';

  return (
    <View>
      <TurnBanner label={state.phase === 'done' ? 'Game over' : state.phase === 'answer' ? `${kindLabel} · Round ${state.round + 1} of ${state.total} · ${answered}/${activePlayers} answered` : `Round ${state.round + 1} results`} seconds={seconds} total={total} />
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {state.current?.meta?.category ? (
          <Text variant="caption" color="primary">
            {String(state.current.meta.category)}
            {state.current.meta.difficulty ? ` · ${String(state.current.meta.difficulty)}` : ''}
          </Text>
        ) : null}
        <Text variant="h3" style={{ marginTop: spacing.xs }}>
          {state.current?.prompt ?? (state.phase === 'done' ? 'Thanks for playing!' : '…')}
        </Text>
        {state.current?.media_url ? <AudioClip url={state.current.media_url} active={state.phase === 'answer'} /> : null}
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          {(state.current?.options ?? []).map((opt, i) => {
            const chosen = myAnswer?.index === i;
            const correct = reveal ? reveal.answer === i : false;
            const wrong = reveal && reveal.answer !== null && chosen && !correct;
            const count = reveal?.counts?.[i] ?? 0;
            const totalVotes = reveal ? reveal.counts.reduce((a, b) => a + b, 0) : 0;
            const majority = reveal && reveal.answer === null && totalVotes > 0 && count === Math.max(...reveal.counts);
            const bg = correct || majority ? 'rgba(34,197,94,0.18)' : wrong ? 'rgba(255,77,109,0.18)' : chosen ? colors.primarySoft : colors.surfaceMuted;
            return (
              <Pressable key={i} disabled={state.phase !== 'answer' || Boolean(myAnswer) || busy} onPress={() => void onMove({ type: 'answer', index: i })} style={[styles.option, { backgroundColor: bg, borderColor: chosen ? colors.primary : 'transparent' }]} accessibilityLabel={`Option ${LETTERS[i]}: ${opt}`}>
                <View style={[styles.letter, { backgroundColor: colors.background }]}>
                  <Text variant="smallMedium">{LETTERS[i] ?? i + 1}</Text>
                </View>
                <Text variant="body" style={{ flex: 1 }}>
                  {opt}
                </Text>
                {reveal ? (
                  <Text variant="smallMedium" color={correct || majority ? 'success' : 'textMuted'}>
                    {reveal.answer === null ? `${totalVotes ? Math.round((count / totalVotes) * 100) : 0}%` : count}
                    {correct ? ' ✓' : ''}
                  </Text>
                ) : chosen ? (
                  <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
        {state.phase === 'answer' && myAnswer ? (
          <Text variant="caption" color="textMuted" style={{ marginTop: spacing.sm }}>
            Locked in. Waiting for the others…
          </Text>
        ) : null}
        {reveal ? (
          <View style={{ marginTop: spacing.md }}>
            <Text variant="smallMedium">
              {reveal.perUser[myId] ? `You earned ${reveal.perUser[myId].points} points` : 'You did not answer this round'}
            </Text>
            <Button title="Next round" size="sm" variant="secondary" style={{ alignSelf: 'flex-start', marginTop: spacing.sm }} onPress={() => void onMove({ type: 'next' })} disabled={busy} />
          </View>
        ) : null}
      </View>
      <View style={{ height: spacing.md }} />
      <PlayersStrip room={room} scores={state.scores} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.md, padding: spacing.lg, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
  option: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, gap: spacing.sm },
  letter: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  clip: { alignItems: 'center', marginTop: spacing.md, backgroundColor: palette.night3, borderRadius: radius.lg, padding: spacing.md },
});
