import { Chess, type Square } from 'chess.js';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { GameRoom } from '@/types/games';

import type { ChessState } from '../../../supabase/functions/_shared/games/chess.ts';
import { PlayersStrip, TurnBanner, useCountdown } from './GameShared';

const GLYPH: Record<string, string> = { wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙', bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟' };
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

export function ChessBoard({ room, myId, onMove, busy }: { room: GameRoom; myId: string; onMove: (move: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const state = room.state as unknown as ChessState;
  const game = useMemo(() => new Chess(state.fen), [state.fen]);
  const [selected, setSelected] = useState<Square | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const seconds = useCountdown(room.turn_deadline);
  const myColor = state.white === myId ? 'w' : state.black === myId ? 'b' : null;
  const flipped = myColor === 'b';
  const myTurn = state.turn === myId && !state.result;
  const size = Math.min(width - spacing.lg * 2, 440);
  const cell = size / 8;
  const targets = useMemo(() => (selected ? game.moves({ square: selected, verbose: true }).map((m) => m.to) : []), [game, selected]);
  const opponentId = myColor === 'w' ? state.black : state.white;
  const opponent = room.participants.find((p) => p.id === opponentId);
  const turnName = room.participants.find((p) => p.id === state.turn)?.display_name ?? '…';

  const squares: { square: Square; row: number; col: number }[] = [];
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const file = flipped ? 7 - c : c;
      const rank = flipped ? r + 1 : 8 - r;
      squares.push({ square: `${FILES[file]}${rank}` as Square, row: r, col: c });
    }
  }

  const tap = (sq: Square) => {
    if (!myTurn || busy) return;
    const piece = game.get(sq);
    if (selected && targets.includes(sq)) {
      const moving = game.get(selected);
      const promo = moving?.type === 'p' && (sq.endsWith('8') || sq.endsWith('1'));
      if (promo) {
        setPromotion({ from: selected, to: sq });
        return;
      }
      void onMove({ type: 'move', from: selected, to: sq }).finally(() => setSelected(null));
      return;
    }
    if (piece && piece.color === myColor) setSelected(sq);
    else setSelected(null);
  };

  const lastFrom = state.lastMove?.from;
  const lastTo = state.lastMove?.to;
  const label = state.result ? `Game over — ${state.result.reason.replace(/_/g, ' ')}` : myTurn ? (state.check ? 'Your turn — you are in check!' : 'Your turn') : `${turnName} to move${state.check ? ' (check)' : ''}`;

  return (
    <View style={{ alignItems: 'center' }}>
      <TurnBanner label={label} seconds={seconds} total={room.game_info.turn_seconds} />
      <View style={{ height: spacing.md }} />
      <Text variant="caption" color="textMuted" style={{ marginBottom: spacing.xs }}>
        {flipped ? '♔ White' : '♚ Black'}: {opponent?.display_name ?? '—'}
      </Text>
      <View style={[styles.board, { width: size, height: size, borderColor: colors.border }]}>
        {squares.map(({ square, row, col }) => {
          const dark = (row + col) % 2 === 1;
          const piece = game.get(square);
          const isTarget = targets.includes(square);
          const isSelected = selected === square;
          const isLast = square === lastFrom || square === lastTo;
          return (
            <Pressable key={square} onPress={() => tap(square)} style={{ position: 'absolute', top: row * cell, left: col * cell, width: cell, height: cell, backgroundColor: isSelected ? '#F6D365' : isLast ? (dark ? '#B9A64A' : '#F5F0A8') : dark ? '#7A5BA8' : '#EDE4FB', alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={square}>
              {piece ? <Text style={{ fontSize: cell * 0.72, color: piece.color === 'w' ? palette.white : palette.ink, textShadowColor: piece.color === 'w' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.3)', textShadowRadius: 2 }}>{GLYPH[`${piece.color}${piece.type}`]}</Text> : null}
              {isTarget ? <View style={{ position: 'absolute', width: piece ? cell * 0.9 : cell * 0.3, height: piece ? cell * 0.9 : cell * 0.3, borderRadius: cell, borderWidth: piece ? 3 : 0, borderColor: 'rgba(0,0,0,0.35)', backgroundColor: piece ? 'transparent' : 'rgba(0,0,0,0.3)' }} /> : null}
              {col === 0 ? (
                <Text style={{ position: 'absolute', left: 2, top: 1, fontSize: 9, color: dark ? '#EDE4FB' : '#7A5BA8' }}>{square[1]}</Text>
              ) : null}
              {row === 7 ? (
                <Text style={{ position: 'absolute', right: 2, bottom: 0, fontSize: 9, color: dark ? '#EDE4FB' : '#7A5BA8' }}>{square[0]}</Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs }}>
        {flipped ? '♚ Black' : '♔ White'}: {room.participants.find((p) => p.id === myId)?.display_name ?? 'You'}
        {state.moves.length ? ` · ${state.moves.slice(-6).join(' ')}` : ''}
      </Text>

      {promotion ? (
        <View style={[styles.promo, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text variant="smallMedium">Promote to</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {(['q', 'r', 'b', 'n'] as const).map((p) => (
              <Chip key={p} label={GLYPH[`${myColor}${p}`]} onPress={() => { void onMove({ type: 'move', from: promotion.from, to: promotion.to, promotion: p }); setPromotion(null); setSelected(null); }} />
            ))}
          </View>
        </View>
      ) : null}

      {myColor && !state.result ? (
        <View style={styles.actions}>
          {state.drawOffer && state.drawOffer !== myId ? (
            <>
              <Button title="Accept draw" size="sm" onPress={() => void onMove({ type: 'accept_draw' })} disabled={busy} />
              <Button title="Decline" size="sm" variant="ghost" onPress={() => void onMove({ type: 'decline_draw' })} disabled={busy} />
            </>
          ) : (
            <Button title={state.drawOffer === myId ? 'Draw offered' : 'Offer draw'} size="sm" variant="ghost" onPress={() => void onMove({ type: 'offer_draw' })} disabled={busy || state.drawOffer === myId} />
          )}
          <Button title="Resign" size="sm" variant="ghost" onPress={() => void onMove({ type: 'resign' })} disabled={busy} />
        </View>
      ) : null}
      <View style={{ height: spacing.md }} />
      <PlayersStrip room={room} turnUser={state.result ? null : state.turn} />
    </View>
  );
}

const styles = StyleSheet.create({
  board: { borderRadius: radius.sm, overflow: 'hidden', borderWidth: 2 },
  promo: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap', justifyContent: 'center' },
});
