import { Ionicons } from '@/components/ui/Ionicons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { GameRoom } from '@/types/games';

import type { RoundsState } from '../../../supabase/functions/_shared/games/rounds.ts';
import { PlayersStrip, TurnBanner, tapHaptic, useCountdown } from './GameShared';

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
  const active = state.order.filter((u) => !state.left.includes(u));
  const kindLabel = state.kind === 'trivia' ? 'Trivia' : state.kind === 'song' ? 'Guess the Song' : 'Would You Rather';
  const myPoints = reveal?.perUser[myId]?.points ?? null;

  // A little buzz when the round is revealed: success for points, a nudge otherwise.
  const revealedRound = useRef<number | null>(null);
  useEffect(() => {
    if (!reveal || Platform.OS === 'web' || revealedRound.current === state.round) return;
    revealedRound.current = state.round;
    Haptics.notificationAsync(myPoints && myPoints > 0 ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
  }, [reveal, state.round, myPoints]);

  // Per-player status on the strip: who has answered, what they earned.
  const badges: Record<string, string> = {};
  for (const user of active) {
    if (state.phase === 'answer') badges[user] = state.answers?.[user] ? '✓' : '…';
    else if (reveal) badges[user] = reveal.perUser[user] ? `+${reveal.perUser[user].points}` : '0';
  }

  const banner = state.phase === 'done'
    ? 'Game over'
    : state.phase === 'answer'
      ? `${kindLabel} · Round ${state.round + 1} of ${state.total} · ${answered}/${active.length} answered`
      : `Round ${state.round + 1} results · next round in ${seconds}s`;

  return (
    <View>
      <TurnBanner label={banner} seconds={seconds} total={total} />
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
            const share = totalVotes ? Math.round((count / totalVotes) * 100) : 0;
            return (
              <Pressable
                key={i}
                disabled={state.phase !== 'answer' || Boolean(myAnswer) || busy}
                onPress={() => {
                  tapHaptic();
                  void onMove({ type: 'answer', index: i });
                }}
                style={[styles.option, { backgroundColor: bg, borderColor: chosen ? colors.primary : correct ? palette.success : 'transparent' }]}
                accessibilityLabel={`Option ${LETTERS[i]}: ${opt}`}
                accessibilityState={{ disabled: state.phase !== 'answer' || Boolean(myAnswer) || busy, selected: chosen }}
              >
                {reveal && totalVotes > 0 ? <View style={[styles.share, { width: `${share}%`, backgroundColor: correct || majority ? 'rgba(34,197,94,0.18)' : 'rgba(128,128,128,0.12)' }]} /> : null}
                <View style={[styles.letter, { backgroundColor: colors.background }]}>
                  <Text variant="smallMedium">{LETTERS[i] ?? i + 1}</Text>
                </View>
                <Text variant="body" style={{ flex: 1 }}>
                  {opt}
                </Text>
                {reveal ? (
                  <Text variant="smallMedium" color={correct || majority ? 'success' : 'textMuted'}>
                    {reveal.answer === null ? `${share}%` : count}
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
            Locked in. Waiting for {Math.max(0, active.length - answered)} more…
          </Text>
        ) : null}
        {state.phase === 'answer' && !myAnswer && state.kind !== 'wyr' ? (
          <Text variant="caption" color="textMuted" style={{ marginTop: spacing.sm }}>
            100 points for the right answer, up to +50 for speed.
          </Text>
        ) : null}
        {reveal ? (
          <View style={{ marginTop: spacing.md }}>
            <Text variant="smallMedium" color={myPoints && myPoints > 0 ? 'success' : 'textSecondary'}>
              {myPoints === null ? 'You did not answer this round' : myPoints > 0 ? `+${myPoints} points${reveal.answer !== null ? ' — correct!' : ' — you were with the majority'}` : reveal.answer === null ? 'Outvoted this round' : 'Not this time — 0 points'}
            </Text>
            <Button title="Next round" size="sm" variant="secondary" style={{ alignSelf: 'flex-start', marginTop: spacing.sm }} onPress={() => void onMove({ type: 'next' })} disabled={busy} />
          </View>
        ) : null}
      </View>
      <View style={{ height: spacing.md }} />
      <PlayersStrip room={room} scores={state.scores} badges={badges} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.md, padding: spacing.lg, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
  option: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, gap: spacing.sm, overflow: 'hidden' },
  share: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  letter: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  clip: { alignItems: 'center', marginTop: spacing.md, backgroundColor: palette.night3, borderRadius: radius.lg, padding: spacing.md },
});
