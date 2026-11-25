import { GameError, rankByScore, type EngineContext, type GameEngine, type GameEvent, type StepResult } from './types.ts';

/**
 * Ludo (2–4 players, 4 tokens each).
 * Token positions are relative to the owner's start: -1 = base, 0..50 = main
 * track, 51..55 = home column, 56 = home. Absolute track cell = (seat*13 + rel) % 52.
 * Safe cells (no captures): every start cell and the four star cells.
 */
export const HOME = 56;
export const TRACK_LEN = 52;
export const SAFE_CELLS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
export const SEAT_COLORS = ['#FF4D6D', '#22C55E', '#FFC857', '#276BFF'] as const;

export interface LudoLastMove {
  user: string;
  token: number;
  from: number;
  to: number;
  dice: number;
  captured: { user: string; token: number }[];
}

export interface LudoState {
  order: string[];
  seats: Record<string, number>;
  tokens: Record<string, number[]>;
  turnIndex: number;
  phase: 'roll' | 'move' | 'done';
  dice: number | null;
  sixes: number;
  legal: number[];
  lastMove: LudoLastMove | null;
  lastRoll: { user: string; dice: number } | null;
  left: string[];
  finished: string[];
  winner: string | null;
}

export type LudoMove = { type: 'roll' } | { type: 'move'; token: number };

export function absoluteCell(seat: number, rel: number): number | null {
  if (rel < 0 || rel > 50) return null;
  return (seat * 13 + rel) % TRACK_LEN;
}

export function legalTokens(state: LudoState, user: string, dice: number): number[] {
  const tokens = state.tokens[user] ?? [];
  const legal: number[] = [];
  tokens.forEach((rel, idx) => {
    if (rel === HOME) return;
    if (rel === -1) {
      if (dice === 6) legal.push(idx);
      return;
    }
    if (rel + dice <= HOME) legal.push(idx);
  });
  return legal;
}

function activePlayers(state: LudoState): string[] {
  return state.order.filter((u) => !state.left.includes(u) && !state.finished.includes(u));
}

function nextTurnIndex(state: LudoState, from: number): number {
  const n = state.order.length;
  for (let step = 1; step <= n; step += 1) {
    const idx = (from + step) % n;
    const u = state.order[idx];
    if (!state.left.includes(u) && !state.finished.includes(u)) return idx;
  }
  return from;
}

function progress(state: LudoState, user: string): number {
  return (state.tokens[user] ?? []).reduce((sum, rel) => sum + Math.max(0, rel), 0);
}

function result(state: LudoState, ctx: EngineContext, events: GameEvent[], finishedNow = false): StepResult<LudoState> {
  const turnUser = state.phase === 'done' ? null : state.order[state.turnIndex];
  const base: StepResult<LudoState> = {
    state,
    turnUser,
    deadline: state.phase === 'done' ? null : ctx.now + ctx.turnSeconds * 1000,
    round: state.finished.length,
    events,
  };
  if (finishedNow) {
    const scores: Record<string, number> = {};
    state.order.forEach((u) => { scores[u] = progress(state, u) + (state.finished.includes(u) ? 1000 - state.finished.indexOf(u) * 100 : 0); });
    base.finished = rankByScore(state.order, scores, state.left);
  }
  return base;
}

function finishIfNeeded(state: LudoState, ctx: EngineContext, events: GameEvent[]): StepResult<LudoState> | null {
  const active = activePlayers(state);
  if (state.winner || active.length <= 1) {
    if (!state.winner && active.length === 1) {
      state.winner = active[0];
      if (!state.finished.includes(active[0])) state.finished.push(active[0]);
    }
    state.phase = 'done';
    events.push({ type: 'game_over', winner: state.winner });
    return result(state, ctx, events, true);
  }
  return null;
}

function advanceTurn(state: LudoState, extra: boolean): void {
  state.dice = null;
  state.legal = [];
  state.phase = 'roll';
  if (extra) return;
  state.sixes = 0;
  state.turnIndex = nextTurnIndex(state, state.turnIndex);
}

export const ludoEngine: GameEngine<LudoState, LudoMove> = {
  slug: 'ludo',

  init(ctx) {
    if (ctx.players.length < 2 || ctx.players.length > 4) throw new GameError('INVALID_PLAYERS', 'Ludo needs 2 to 4 players.');
    const order = [...ctx.players].sort((a, b) => a.seat - b.seat).map((p) => p.user_id);
    const seats: Record<string, number> = {};
    const tokens: Record<string, number[]> = {};
    ctx.players.forEach((p) => { seats[p.user_id] = p.seat; tokens[p.user_id] = [-1, -1, -1, -1]; });
    const state: LudoState = { order, seats, tokens, turnIndex: 0, phase: 'roll', dice: null, sixes: 0, legal: [], lastMove: null, lastRoll: null, left: [], finished: [], winner: null };
    return result(state, ctx, [{ type: 'started' }]);
  },

  move(prev, move, userId, ctx) {
    const state: LudoState = JSON.parse(JSON.stringify(prev));
    if (state.phase === 'done') throw new GameError('GAME_OVER');
    const current = state.order[state.turnIndex];
    if (current !== userId) throw new GameError('NOT_YOUR_TURN', 'Wait for your turn.');
    const events: GameEvent[] = [];

    if (move.type === 'roll') {
      if (state.phase !== 'roll') throw new GameError('ALREADY_ROLLED', 'Pick a token to move.');
      const dice = 1 + Math.floor(ctx.random() * 6);
      state.dice = dice;
      state.lastRoll = { user: userId, dice };
      state.sixes = dice === 6 ? state.sixes + 1 : 0;
      events.push({ type: 'rolled', user: userId, dice });
      if (dice === 6 && state.sixes >= 3) {
        events.push({ type: 'three_sixes', user: userId });
        advanceTurn(state, false);
        return result(state, ctx, events);
      }
      const legal = legalTokens(state, userId, dice);
      if (legal.length === 0) {
        events.push({ type: 'no_moves', user: userId });
        advanceTurn(state, dice === 6);
        return result(state, ctx, events);
      }
      state.legal = legal;
      state.phase = 'move';
      // Auto-move when there is exactly one option.
      if (legal.length === 1) return this.move(state, { type: 'move', token: legal[0] }, userId, ctx);
      return result(state, ctx, events);
    }

    if (move.type === 'move') {
      if (state.phase !== 'move' || state.dice === null) throw new GameError('ROLL_FIRST', 'Roll the dice first.');
      if (!state.legal.includes(move.token)) throw new GameError('ILLEGAL_MOVE', 'That token cannot move.');
      const dice = state.dice;
      const tokens = state.tokens[userId];
      const from = tokens[move.token];
      const to = from === -1 ? 0 : from + dice;
      tokens[move.token] = to;
      const captured: { user: string; token: number }[] = [];
      const cell = absoluteCell(state.seats[userId], to);
      if (cell !== null && !SAFE_CELLS.has(cell)) {
        for (const other of state.order) {
          if (other === userId || state.left.includes(other)) continue;
          state.tokens[other].forEach((rel, idx) => {
            if (absoluteCell(state.seats[other], rel) === cell) {
              state.tokens[other][idx] = -1;
              captured.push({ user: other, token: idx });
            }
          });
        }
      }
      state.lastMove = { user: userId, token: move.token, from, to, dice, captured };
      events.push({ type: 'moved', user: userId, token: move.token, from, to, captured });
      let extra = dice === 6 || captured.length > 0 || to === HOME;
      if (tokens.every((t) => t === HOME)) {
        state.finished.push(userId);
        events.push({ type: 'finished', user: userId, place: state.finished.length });
        if (state.finished.length === 1) state.winner = userId;
        extra = false;
      }
      const done = finishIfNeeded(state, ctx, events);
      if (done) return done;
      advanceTurn(state, extra);
      return result(state, ctx, events);
    }

    throw new GameError('INVALID_MOVE');
  },

  timeout(prev, ctx) {
    const state: LudoState = JSON.parse(JSON.stringify(prev));
    if (state.phase === 'done') return result(state, ctx, []);
    const user = state.order[state.turnIndex];
    if (state.phase === 'roll') {
      const step = this.move(state, { type: 'roll' }, user, ctx);
      if (step.state.phase === 'move') return this.move(step.state, { type: 'move', token: step.state.legal[0] }, user, ctx);
      step.events.push({ type: 'timeout', user });
      return step;
    }
    const step = this.move(state, { type: 'move', token: state.legal[0] }, user, ctx);
    step.events.push({ type: 'timeout', user });
    return step;
  },

  leave(prev, userId, ctx) {
    const state: LudoState = JSON.parse(JSON.stringify(prev));
    if (state.left.includes(userId) || !state.order.includes(userId)) return result(state, ctx, []);
    state.left.push(userId);
    state.tokens[userId] = state.tokens[userId].map((t) => (t === HOME ? HOME : -1));
    const events: GameEvent[] = [{ type: 'left', user: userId }];
    if (state.phase !== 'done' && state.order[state.turnIndex] === userId) advanceTurn(state, false);
    const done = finishIfNeeded(state, ctx, events);
    return done ?? result(state, ctx, events);
  },
};
