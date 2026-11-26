import { Ionicons } from '@/components/ui/Ionicons';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { GameRoom } from '@/types/games';

import { HOME, SAFE_CELLS, SEAT_COLORS, absoluteCell, type LudoState } from '../../../supabase/functions/_shared/games/ludo.ts';
import { Dice, PlayersStrip, PulseRing, TurnBanner, participantById, tapHaptic, useCountdown, useTurnHaptics } from './GameShared';

// 15×15 board. Track cells in play order starting from seat 0's start cell.
const TRACK: [number, number][] = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7],
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14],
  [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7],
  [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0],
  [6, 0],
];
const HOME_COLUMNS: [number, number][][] = [
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
];
const BASES: [number, number][][] = [
  [[1.5, 1.5], [1.5, 3.5], [3.5, 1.5], [3.5, 3.5]],
  [[1.5, 10.5], [1.5, 12.5], [3.5, 10.5], [3.5, 12.5]],
  [[10.5, 10.5], [10.5, 12.5], [12.5, 10.5], [12.5, 12.5]],
  [[10.5, 1.5], [10.5, 3.5], [12.5, 1.5], [12.5, 3.5]],
];
const BASE_ORIGIN: [number, number][] = [[0, 0], [0, 9], [9, 9], [9, 0]];

function cellFor(seat: number, rel: number, tokenIndex: number): [number, number] {
  if (rel === -1) return BASES[seat][tokenIndex];
  if (rel === HOME) return [7, 7];
  if (rel >= 51) return HOME_COLUMNS[seat][rel - 51];
  const abs = absoluteCell(seat, rel) ?? 0;
  return TRACK[abs];
}

export function LudoBoard({ room, myId, onMove, busy }: { room: GameRoom; myId: string; onMove: (move: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const state = room.state as unknown as LudoState;
  const size = Math.min(width - spacing.lg * 2, 440);
  const cell = size / 15;
  const seconds = useCountdown(room.turn_deadline);
  const turnUser = room.current_turn_user_id;
  const mine = turnUser === myId;
  const turnName = participantById(room, turnUser)?.display_name ?? '…';
  const colorFor = (user: string) => SEAT_COLORS[(state.seats?.[user] ?? 0) % 4];
  useTurnHaptics(mine && state.phase === 'roll');

  const tokens: { user: string; seat: number; idx: number; rel: number; legal: boolean }[] = [];
  Object.entries(state.tokens ?? {}).forEach(([user, rels]) => {
    rels.forEach((rel, idx) => tokens.push({ user, seat: state.seats[user], idx, rel, legal: mine && user === myId && state.phase === 'move' && state.legal.includes(idx) }));
  });
  // Offset stacked tokens slightly.
  const seen = new Map<string, number>();

  const highlight: Record<string, string> = {};
  room.participants.forEach((p) => { highlight[p.id] = colorFor(p.id); });

  const last = state.lastMove;
  const lastCell = last && last.to !== HOME ? cellFor(state.seats[last.user] ?? 0, last.to, last.token) : null;
  const lastName = last ? (last.user === myId ? 'You' : (participantById(room, last.user)?.display_name ?? 'Someone')) : null;
  const rollKey = state.lastRoll ? `${room.version}-${state.lastRoll.user}-${state.lastRoll.dice}` : null;
  const diceValue = state.dice ?? state.lastRoll?.dice ?? null;
  const diceColor = state.lastRoll ? colorFor(state.lastRoll.user) : colors.textMuted;

  const banner = state.phase === 'done'
    ? 'Game over'
    : mine
      ? state.phase === 'roll'
        ? state.sixes > 0 ? `Another six — roll again! (${state.sixes}/3)` : 'Your turn — roll the dice'
        : 'Pick a highlighted token to move'
      : state.phase === 'roll'
        ? `${turnName} is rolling…`
        : `${turnName} is choosing a token…`;

  return (
    <View style={{ alignItems: 'center' }}>
      <TurnBanner label={banner} seconds={seconds} total={room.game_info.turn_seconds} />
      <View style={{ height: spacing.md }} />
      <View style={[styles.board, { width: size, height: size, backgroundColor: colors.surface, borderColor: colors.border }]}>
        {/* Bases */}
        {BASE_ORIGIN.map(([r, c], seat) => (
          <View key={seat} style={{ position: 'absolute', top: r * cell, left: c * cell, width: 6 * cell, height: 6 * cell, backgroundColor: SEAT_COLORS[seat] + '33', borderWidth: 2, borderColor: SEAT_COLORS[seat], borderRadius: cell * 0.6 }} />
        ))}
        {/* Track */}
        {TRACK.map(([r, c], i) => {
          const start = i % 13 === 0;
          const seat = i / 13;
          const isLast = lastCell ? lastCell[0] === r && lastCell[1] === c : false;
          return (
            <View key={`t${i}`} style={{ position: 'absolute', top: r * cell, left: c * cell, width: cell, height: cell, borderWidth: isLast ? 2 : StyleSheet.hairlineWidth, borderColor: isLast && last ? colorFor(last.user) : colors.border, backgroundColor: start ? SEAT_COLORS[seat] + '55' : colors.background, alignItems: 'center', justifyContent: 'center' }}>
              {SAFE_CELLS.has(i) && !start ? <Ionicons name="star" size={cell * 0.5} color={colors.textMuted} /> : null}
            </View>
          );
        })}
        {/* Home columns */}
        {HOME_COLUMNS.map((col, seat) => col.map(([r, c], i) => <View key={`h${seat}${i}`} style={{ position: 'absolute', top: r * cell, left: c * cell, width: cell, height: cell, backgroundColor: SEAT_COLORS[seat] + '66', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }} />))}
        {/* Centre */}
        <View style={{ position: 'absolute', top: 6 * cell, left: 6 * cell, width: 3 * cell, height: 3 * cell, backgroundColor: colors.surfaceStrong, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: cell * 1.2 }}>🏠</Text>
        </View>
        {/* Tokens */}
        {tokens.map((t) => {
          const [r, c] = cellFor(t.seat, t.rel, t.idx);
          const key = `${r},${c}`;
          const n = seen.get(key) ?? 0;
          seen.set(key, n + 1);
          const offset = t.rel === -1 || t.rel === HOME ? 0 : n * cell * 0.18;
          const d = cell * 0.78;
          return (
            <Pressable
              key={`${t.user}-${t.idx}`}
              disabled={!t.legal || busy}
              onPress={() => {
                tapHaptic();
                void onMove({ type: 'move', token: t.idx });
              }}
              style={{ position: 'absolute', top: r * cell + (cell - d) / 2 - offset, left: c * cell + (cell - d) / 2 + offset, width: d, height: d, borderRadius: d / 2, backgroundColor: SEAT_COLORS[t.seat], borderWidth: t.legal ? 3 : 1.5, borderColor: t.legal ? palette.white : 'rgba(0,0,0,0.35)', zIndex: t.legal ? 3 : 2, alignItems: 'center', justifyContent: 'center' }}
              accessibilityLabel={`Token ${t.idx + 1}`}
              accessibilityState={{ disabled: !t.legal || busy }}
            >
              {t.legal ? <PulseRing size={d + 10} color={palette.white} /> : null}
              {t.legal ? <View style={{ width: d * 0.35, height: d * 0.35, borderRadius: d, backgroundColor: palette.white }} /> : null}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.controls}>
        <Dice value={diceValue} rollKey={rollKey} color={diceColor} />
        {mine && state.phase === 'roll' ? (
          <Button
            title="Roll"
            leftIcon="dice-outline"
            onPress={() => {
              tapHaptic();
              void onMove({ type: 'roll' });
            }}
            loading={busy}
            glow
          />
        ) : (
          <View style={{ flex: 1 }}>
            {state.lastRoll ? (
              <Text variant="small" color="textMuted">
                {state.lastRoll.user === myId ? 'You' : (participantById(room, state.lastRoll.user)?.display_name ?? 'Someone')} rolled a {state.lastRoll.dice}
                {state.lastRoll.dice === 6 ? ' — bonus turn' : ''}
              </Text>
            ) : null}
            {last?.captured.length ? (
              <Text variant="smallMedium" color="danger">
                {lastName} captured {last.captured.length} token{last.captured.length > 1 ? 's' : ''}!
              </Text>
            ) : last && last.to === HOME ? (
              <Text variant="smallMedium" color="success">
                {lastName} brought a token home 🏠
              </Text>
            ) : null}
          </View>
        )}
      </View>
      <View style={{ height: spacing.md }} />
      <PlayersStrip room={room} turnUser={turnUser} highlight={highlight} scores={Object.fromEntries(Object.entries(state.tokens ?? {}).map(([u, rels]) => [u, rels.filter((x) => x === HOME).length]))} />
      <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs }}>
        Score = tokens home · roll a 6 to leave the base · stars are safe · 3 sixes in a row lose the turn
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  board: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md, width: '100%', paddingHorizontal: spacing.sm },
});
