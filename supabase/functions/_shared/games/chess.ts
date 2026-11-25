import { GameError, type EngineContext, type GameEngine, type GameEvent, type GameResultRow, type StepResult } from './types.ts';

/**
 * Chess — rules come from chess.js, injected by the host (Deno `npm:chess.js`,
 * app `chess.js`) so this module stays runtime-agnostic.
 */
export interface ChessLike {
  move(move: { from: string; to: string; promotion?: string }): unknown;
  fen(): string;
  turn(): 'w' | 'b';
  isGameOver(): boolean;
  isCheckmate(): boolean;
  isStalemate(): boolean;
  isDraw(): boolean;
  isThreefoldRepetition(): boolean;
  isInsufficientMaterial(): boolean;
  inCheck(): boolean;
  history(): string[];
}
export type ChessCtor = new (fen?: string) => ChessLike;

export interface ChessState {
  fen: string;
  white: string;
  black: string;
  turn: string;
  moves: string[];
  lastMove: { from: string; to: string; san: string } | null;
  drawOffer: string | null;
  check: boolean;
  result: { reason: string; winner: string | null } | null;
  left: string[];
}

export type ChessMove =
  | { type: 'move'; from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' }
  | { type: 'resign' }
  | { type: 'offer_draw' }
  | { type: 'accept_draw' }
  | { type: 'decline_draw' };

function finishRows(state: ChessState): GameResultRow[] {
  const players = [state.white, state.black];
  if (!state.result || state.result.winner === null) {
    return players.map((u) => ({ user_id: u, rank: 1, score: 0, draw: true }));
  }
  return players.map((u) => ({ user_id: u, rank: u === state.result!.winner ? 1 : 2, score: u === state.result!.winner ? 1 : 0 }));
}

function step(state: ChessState, ctx: EngineContext, events: GameEvent[]): StepResult<ChessState> {
  const finished = state.result ? finishRows(state) : undefined;
  return { state, turnUser: state.result ? null : state.turn, deadline: state.result ? null : ctx.now + ctx.turnSeconds * 1000, round: Math.ceil(state.moves.length / 2), finished, events };
}

export function createChessEngine(Chess: ChessCtor): GameEngine<ChessState, ChessMove> {
  return {
    slug: 'chess',

    init(ctx) {
      if (ctx.players.length !== 2) throw new GameError('INVALID_PLAYERS', 'Chess needs exactly 2 players.');
      const ordered = [...ctx.players].sort((a, b) => a.seat - b.seat).map((p) => p.user_id);
      const whiteFirst = ctx.random() < 0.5;
      const white = whiteFirst ? ordered[0] : ordered[1];
      const black = whiteFirst ? ordered[1] : ordered[0];
      const game = new Chess();
      const state: ChessState = { fen: game.fen(), white, black, turn: white, moves: [], lastMove: null, drawOffer: null, check: false, result: null, left: [] };
      return step(state, ctx, [{ type: 'started', white, black }]);
    },

    move(prev, move, userId, ctx) {
      const state: ChessState = JSON.parse(JSON.stringify(prev));
      if (state.result) throw new GameError('GAME_OVER');
      if (userId !== state.white && userId !== state.black) throw new GameError('NOT_A_PLAYER');
      const opponent = userId === state.white ? state.black : state.white;
      const events: GameEvent[] = [];

      if (move.type === 'resign') {
        state.result = { reason: 'resignation', winner: opponent };
        events.push({ type: 'resigned', user: userId });
        return step(state, ctx, events);
      }
      if (move.type === 'offer_draw') {
        if (state.drawOffer === userId) throw new GameError('ALREADY_OFFERED');
        state.drawOffer = userId;
        events.push({ type: 'draw_offered', user: userId });
        return step(state, ctx, events);
      }
      if (move.type === 'accept_draw') {
        if (state.drawOffer !== opponent) throw new GameError('NO_DRAW_OFFER');
        state.result = { reason: 'agreement', winner: null };
        state.drawOffer = null;
        events.push({ type: 'draw_agreed' });
        return step(state, ctx, events);
      }
      if (move.type === 'decline_draw') {
        if (state.drawOffer !== opponent) throw new GameError('NO_DRAW_OFFER');
        state.drawOffer = null;
        events.push({ type: 'draw_declined', user: userId });
        return step(state, ctx, events);
      }
      if (move.type === 'move') {
        if (state.turn !== userId) throw new GameError('NOT_YOUR_TURN', 'Wait for your turn.');
        const game = new Chess(state.fen);
        let san = '';
        try {
          const made = game.move({ from: move.from, to: move.to, promotion: move.promotion }) as { san?: string } | null;
          if (!made) throw new Error('illegal');
          san = made.san ?? `${move.from}${move.to}`;
        } catch {
          throw new GameError('ILLEGAL_MOVE', 'That move is not legal.');
        }
        state.fen = game.fen();
        state.moves.push(san);
        state.lastMove = { from: move.from, to: move.to, san };
        state.check = game.inCheck();
        state.drawOffer = state.drawOffer === userId ? state.drawOffer : null;
        state.turn = opponent;
        events.push({ type: 'moved', user: userId, san, from: move.from, to: move.to, check: state.check });
        if (game.isGameOver()) {
          if (game.isCheckmate()) state.result = { reason: 'checkmate', winner: userId };
          else if (game.isStalemate()) state.result = { reason: 'stalemate', winner: null };
          else if (game.isThreefoldRepetition()) state.result = { reason: 'repetition', winner: null };
          else if (game.isInsufficientMaterial()) state.result = { reason: 'insufficient_material', winner: null };
          else state.result = { reason: 'draw', winner: null };
          events.push({ type: 'game_over', reason: state.result.reason, winner: state.result.winner });
        }
        return step(state, ctx, events);
      }
      throw new GameError('INVALID_MOVE');
    },

    timeout(prev, ctx) {
      const state: ChessState = JSON.parse(JSON.stringify(prev));
      if (state.result) return step(state, ctx, []);
      const loser = state.turn;
      state.result = { reason: 'timeout', winner: loser === state.white ? state.black : state.white };
      return step(state, ctx, [{ type: 'timeout', user: loser }]);
    },

    leave(prev, userId, ctx) {
      const state: ChessState = JSON.parse(JSON.stringify(prev));
      if (state.left.includes(userId) || (userId !== state.white && userId !== state.black)) return step(state, ctx, []);
      state.left.push(userId);
      if (!state.result) state.result = { reason: 'abandoned', winner: userId === state.white ? state.black : state.white };
      return step(state, ctx, [{ type: 'left', user: userId }]);
    },
  };
}
