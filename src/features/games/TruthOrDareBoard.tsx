import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import type { GameRoom } from '@/types/games';

import type { TodState } from '../../../supabase/functions/_shared/games/truth_or_dare.ts';
import { PlayersStrip, TurnBanner, participantById, useCountdown } from './GameShared';

export function TruthOrDareBoard({ room, myId, onMove, busy }: { room: GameRoom; myId: string; onMove: (move: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const { colors } = useTheme();
  const state = room.state as unknown as TodState;
  const seconds = useCountdown(room.turn_deadline);
  const current = state.order[state.turnIndex];
  const me = current === myId;
  const player = participantById(room, current);
  const total = state.phase === 'choose' ? state.chooseSeconds : state.phase === 'perform' ? state.performSeconds : state.voteSeconds;
  const myVote = state.votes?.[myId];
  const label = state.phase === 'done' ? 'Game over' : state.phase === 'choose' ? (me ? 'Your turn — truth or dare?' : `${player?.display_name ?? '…'} is choosing…`) : state.phase === 'perform' ? (me ? `Your ${state.current?.kind} — go!` : `${player?.display_name} is doing a ${state.current?.kind}`) : me ? 'The others are voting…' : `Did ${player?.display_name} deliver?`;

  return (
    <View>
      <TurnBanner label={`Turn ${state.turn}/${state.totalTurns} · ${label}`} seconds={seconds} total={total} />
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {state.phase === 'choose' ? (
          me ? (
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <Button title="Truth" leftIcon="chatbubble-ellipses-outline" onPress={() => void onMove({ type: 'choose', pick: 'truth' })} disabled={busy} style={{ flex: 1 }} />
              <Button title="Dare" leftIcon="flame-outline" variant="secondary" onPress={() => void onMove({ type: 'choose', pick: 'dare' })} disabled={busy} style={{ flex: 1 }} />
            </View>
          ) : (
            <Text variant="body" color="textMuted">
              Waiting for {player?.display_name}…
            </Text>
          )
        ) : null}
        {state.current && state.phase !== 'choose' ? (
          <View>
            <Text variant="caption" color="primary">
              {state.current.kind.toUpperCase()} for {me ? 'you' : player?.display_name}
            </Text>
            <Text variant="h3" style={{ marginTop: spacing.xs }}>
              {state.current.prompt}
            </Text>
          </View>
        ) : null}
        {state.phase === 'perform' && me ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
            <Button title="I did it!" leftIcon="checkmark-circle-outline" onPress={() => void onMove({ type: 'complete' })} disabled={busy} glow />
            <Button title="Skip" variant="ghost" onPress={() => void onMove({ type: 'skip' })} disabled={busy} />
          </View>
        ) : null}
        {state.phase === 'perform' && !me ? (
          <Text variant="small" color="textMuted" style={{ marginTop: spacing.md }}>
            Use the room chat or a call to watch it happen. You will vote next.
          </Text>
        ) : null}
        {state.phase === 'vote' && !me ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
            <Button title="Done ✓" onPress={() => void onMove({ type: 'vote', value: 'done' })} disabled={busy || Boolean(myVote)} variant={myVote === 'done' ? 'primary' : 'secondary'} />
            <Button title="Nope" onPress={() => void onMove({ type: 'vote', value: 'skip' })} disabled={busy || Boolean(myVote)} variant={myVote === 'skip' ? 'primary' : 'ghost'} />
          </View>
        ) : null}
        {state.phase === 'vote' ? (
          <Text variant="caption" color="textMuted" style={{ marginTop: spacing.sm }}>
            {Object.keys(state.votes ?? {}).length} vote{Object.keys(state.votes ?? {}).length === 1 ? '' : 's'} in
          </Text>
        ) : null}
      </View>
      {state.history.length > 0 ? (
        <View style={{ marginTop: spacing.md }}>
          <Text variant="label" color="textMuted" style={{ marginBottom: spacing.xs }}>
            Recent
          </Text>
          {state.history.slice(-3).reverse().map((h, i) => (
            <Text key={i} variant="caption" color="textMuted" numberOfLines={1}>
              {h.completed ? '✅' : '⏭️'} {participantById(room, h.user)?.display_name}: {h.prompt}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={{ height: spacing.md }} />
      <PlayersStrip room={room} scores={state.scores} turnUser={state.phase === 'done' ? null : current} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.md, padding: spacing.lg, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
});
