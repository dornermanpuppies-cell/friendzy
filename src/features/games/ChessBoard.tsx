import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { GameRoom } from '@/types/games';

import type { ChessState } from '../../../supabase/functions/_shared/games/chess.ts';
import { PlayersStrip, TurnBanner, participantById, tapHaptic, useCountdown, useTurnHaptics } from './GameShared';

const GLYPH: Record<string, string> = { wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙', bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟' };
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const START_COUNT: Record<PieceSymbol, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const ORDER: PieceSymbol[] = ['q', 'r', 'b', 'n', 'p'];

/** Pieces each side has captured, derived from what is missing from the board. */
function captured(game: Chess): { byWhite: PieceSymbol[]; byBlack: PieceSymbol[]; material: number } {
  const count: Record<Color, Record<PieceSymbol, number>> = { w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 } };
  for (const row of game.board()) for (const sq of row) if (sq) count[sq.color][sq.type] += 1;
  const missing = (color: Color): PieceSymbol[] => ORDER.flatMap((type) => Array.from({ length: Math.max(0, START_COUNT[type] - count[color][type]) }, () => type));
  const byWhite = missing('b');
  const byBlack = missing('w');
  const material = byWhite.reduce((s, t) => s + VALUE[t], 0) - byBlack.reduce((s, t) => s + VALUE[t], 0);
  return { byWhite, byBlack, material };
}

function kingSquare(game: Chess, color: Color): Square | null {
  const board = game.board();
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const sq = board[r][c];
      if (sq && sq.type === 'k' && sq.color === color) return sq.square;
    }
  }
  return null;
}

export function ChessBoard({ room, myId, onMove, busy }: { room: GameRoom; myId: string; onMove: (move: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const state = room.state as unknown as ChessState;
  const game = useMemo(() => new Chess(state.fen), [state.fen]);
  const [selected, setSelected] = useState<Square | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const seconds = useCountdown(room.turn_deadline);
  const myColor: Color | null = state.white === myId ? 'w' : state.black === myId ? 'b' : null;
  const flipped = myColor === 'b';
  const myTurn = state.turn === myId && !state.result;
  useTurnHaptics(myTurn);
  const size = Math.min(width - spacing.lg * 2, 440);
  const cell = size / 8;
  const targets = useMemo(() => (selected ? game.moves({ square: selected, verbose: true }).map((m) => m.to) : []), [game, selected]);
  const opponentId = myColor === 'w' ? state.black : state.white;
  const opponent = participantById(room, opponentId);
  const me = participantById(room, myId);
  const turnName = participantById(room, state.turn)?.display_name ?? '…';
  const taken = useMemo(() => captured(game), [game]);
  const checkSquare = state.check && !state.result ? kingSquare(game, game.turn()) : null;

  const squares: { square: Square; row: number; col: number }[] = [];
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const file = flipped ? 7 - c : c;
      const rank = flipped ? r + 1 : 8 - r;
      squares.push({ square: `${FILES[file]}${rank}` as Square, row: r, col: c });
    }
  }

  const tap = (sq: Square) => {
    if (!myTurn) return;
    const piece = game.get(sq);
    if (selected && targets.includes(sq)) {
      if (busy) return;
      const moving = game.get(selected);
      const promo = moving?.type === 'p' && (sq.endsWith('8') || sq.endsWith('1'));
      if (promo) {
        setPromotion({ from: selected, to: sq });
        return;
      }
      tapHaptic();
      void onMove({ type: 'move', from: selected, to: sq }).finally(() => setSelected(null));
      return;
    }
    if (piece && piece.color === myColor) setSelected(sq);
    else setSelected(null);
  };

  const lastFrom = state.lastMove?.from;
  const lastTo = state.lastMove?.to;
  const reason = state.result?.reason.replace(/_/g, ' ');
  const label = state.result
    ? `Game over — ${reason}${state.result.winner ? ` · ${state.result.winner === myId ? 'you won' : `${participantById(room, state.result.winner)?.display_name ?? 'opponent'} won`}` : ' · draw'}`
    : myTurn
      ? state.check ? 'Your turn — you are in check!' : 'Your turn'
      : `${turnName} to move${state.check ? ' (check)' : ''}`;
  const moveList = state.moves.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san)).slice(-10).join(' ');
  const materialLabel = (forWhite: boolean) => {
    const diff = forWhite ? taken.material : -taken.material;
    return diff > 0 ? ` +${diff}` : '';
  };
  const capturedRow = (pieces: PieceSymbol[], color: Color) => pieces.map((p) => GLYPH[`${color}${p}`]).join('') || '—';

  // Plain render helper (not a component) so hooks/compiler rules stay happy.
  const playerLine = (id: string | null, name: string, color: Color, top: boolean) => (
    <View style={[styles.playerLine, top ? { marginBottom: spacing.xs } : { marginTop: spacing.xs }]}>
      <Text variant="caption" color={state.turn === id && !state.result ? 'primary' : 'textMuted'} numberOfLines={1} style={{ flex: 1 }}>
        {color === 'w' ? '♔ White' : '♚ Black'}: {name}
        {materialLabel(color === 'w')}
      </Text>
      <Text variant="caption" color="textMuted">
        {capturedRow(color === 'w' ? taken.byWhite : taken.byBlack, color === 'w' ? 'b' : 'w')}
      </Text>
    </View>
  );

  return (
    <View style={{ alignItems: 'center' }}>
      <TurnBanner label={label} seconds={seconds} total={room.game_info.turn_seconds} />
      <View style={{ height: spacing.md }} />
      <View style={{ width: size }}>
        {playerLine(opponentId, opponent?.display_name ?? '—', flipped ? 'w' : 'b', true)}
      </View>
      <View style={[styles.board, { width: size, height: size, borderColor: colors.border }]}>
        {squares.map(({ square, row, col }) => {
          const dark = (row + col) % 2 === 1;
          const piece = game.get(square);
          const isTarget = targets.includes(square);
          const isSelected = selected === square;
          const isLast = square === lastFrom || square === lastTo;
          const isCheck = square === checkSquare;
          return (
            <Pressable key={square} onPress={() => tap(square)} style={{ position: 'absolute', top: row * cell, left: col * cell, width: cell, height: cell, backgroundColor: isCheck ? '#FF6B81' : isSelected ? '#F6D365' : isLast ? (dark ? '#B9A64A' : '#F5F0A8') : dark ? '#7A5BA8' : '#EDE4FB', alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={square}>
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
      <View style={{ width: size }}>
        {playerLine(myId, me?.display_name ?? 'You', flipped ? 'b' : 'w', false)}
      </View>
      {moveList ? (
        <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs, maxWidth: size }} numberOfLines={2}>
          {moveList}
        </Text>
      ) : null}

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
  playerLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 },
  promo: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap', justifyContent: 'center' },
});
