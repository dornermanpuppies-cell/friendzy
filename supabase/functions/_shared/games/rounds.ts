import { GameError, rankByScore, shuffle, type EngineContext, type GameEngine, type GameEvent, type StepResult } from './types.ts';

/**
 * Simultaneous-answer rounds: Trivia, Would You Rather and Guess the Song.
 * Everyone answers the same prompt within a deadline, then the round is
 * revealed. Answer keys live under `state.secret` (never sent to clients).
 */
export type RoundsKind = 'trivia' | 'wyr' | 'song';

export interface RoundSpec {
  prompt: string;
  options: string[];
  /** Index of the correct option; null for opinion rounds (WYR). */
  answer: number | null;
  media_url?: string | null;
  meta?: Record<string, unknown>;
}

export interface RoundHistory {
  prompt: string;
  options: string[];
  answer: number | null;
  counts: number[];
  perUser: Record<string, { index: number; points: number }>;
}

export interface RoundsState {
  kind: RoundsKind;
  round: number;
  total: number;
  phase: 'answer' | 'reveal' | 'done';
  current: { prompt: string; options: string[]; media_url: string | null; meta: Record<string, unknown> } | null;
  answers: Record<string, { index: number; at: number }>;
  scores: Record<string, number>;
  history: RoundHistory[];
  order: string[];
  left: string[];
  phaseStartedAt: number;
  answerSeconds: number;
  revealSeconds: number;
  lastReveal: RoundHistory | null;
  secret: { rounds: RoundSpec[] };
}

export type RoundsMove = { type: 'answer'; index: number } | { type: 'next' };

function active(state: RoundsState): string[] {
  return state.order.filter((u) => !state.left.includes(u));
}

function step(state: RoundsState, ctx: EngineContext, events: GameEvent[]): StepResult<RoundsState> {
  const seconds = state.phase === 'answer' ? state.answerSeconds : state.revealSeconds;
  const finished = state.phase === 'done' ? rankByScore(state.order, state.scores, state.left) : undefined;
  return { state, turnUser: null, deadline: state.phase === 'done' ? null : state.phaseStartedAt + seconds * 1000, round: state.round + 1, finished, events };
}

function startRound(state: RoundsState, ctx: EngineContext, events: GameEvent[]): StepResult<RoundsState> {
  const spec = state.secret.rounds[state.round];
  if (!spec) {
    state.phase = 'done';
    state.current = null;
    events.push({ type: 'game_over' });
    return step(state, ctx, events);
  }
  state.phase = 'answer';
  state.current = { prompt: spec.prompt, options: spec.options, media_url: spec.media_url ?? null, meta: spec.meta ?? {} };
  state.answers = {};
  state.phaseStartedAt = ctx.now;
  events.push({ type: 'round_started', round: state.round + 1 });
  return step(state, ctx, events);
}

function reveal(state: RoundsState, ctx: EngineContext, events: GameEvent[]): StepResult<RoundsState> {
  const spec = state.secret.rounds[state.round];
  const counts = spec.options.map(() => 0);
  Object.values(state.answers).forEach((a) => { if (counts[a.index] !== undefined) counts[a.index] += 1; });
  const perUser: Record<string, { index: number; points: number }> = {};
  const deadline = state.phaseStartedAt + state.answerSeconds * 1000;
  let majority: number | null = null;
  if (spec.answer === null) {
    const max = Math.max(...counts);
    const leaders = counts.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0);
    majority = leaders.length === 1 ? leaders[0] : null;
  }
  for (const user of active(state)) {
    const a = state.answers[user];
    let points = 0;
    if (a) {
      if (spec.answer !== null) {
        if (a.index === spec.answer) {
          const remaining = Math.max(0, Math.min(1, (deadline - a.at) / (state.answerSeconds * 1000)));
          points = 100 + Math.round(remaining * 50);
        }
      } else {
        points = majority === null ? 5 : a.index === majority ? 10 : 0;
      }
      perUser[user] = { index: a.index, points };
    }
    state.scores[user] = (state.scores[user] ?? 0) + points;
  }
  const entry: RoundHistory = { prompt: spec.prompt, options: spec.options, answer: spec.answer, counts, perUser };
  state.history.push(entry);
  state.lastReveal = entry;
  state.phase = 'reveal';
  state.phaseStartedAt = ctx.now;
  events.push({ type: 'revealed', round: state.round + 1, answer: spec.answer, counts });
  return step(state, ctx, events);
}

export function createRoundsEngine(kind: RoundsKind, slug: string): GameEngine<RoundsState, RoundsMove> {
  return {
    slug,

    init(ctx, options) {
      const rounds = (options.rounds as RoundSpec[] | undefined) ?? [];
      if (ctx.players.length < 2) throw new GameError('INVALID_PLAYERS', 'This game needs at least 2 players.');
      if (rounds.length < 3) throw new GameError('NOT_ENOUGH_CONTENT', 'Not enough rounds available for this game yet.');
      const order = [...ctx.players].sort((a, b) => a.seat - b.seat).map((p) => p.user_id);
      const scores: Record<string, number> = {};
      order.forEach((u) => { scores[u] = 0; });
      const state: RoundsState = {
        kind, round: 0, total: rounds.length, phase: 'answer', current: null, answers: {}, scores, history: [], order, left: [],
        phaseStartedAt: ctx.now, answerSeconds: Number(options.answerSeconds ?? ctx.turnSeconds ?? 15), revealSeconds: Number(options.revealSeconds ?? 5), lastReveal: null,
        secret: { rounds: shuffle(rounds, ctx.random) },
      };
      return startRound(state, ctx, [{ type: 'started' }]);
    },

    move(prev, move, userId, ctx) {
      const state: RoundsState = JSON.parse(JSON.stringify(prev));
      if (state.phase === 'done') throw new GameError('GAME_OVER');
      if (!active(state).includes(userId)) throw new GameError('NOT_A_PLAYER');
      const events: GameEvent[] = [];
      if (move.type === 'answer') {
        if (state.phase !== 'answer' || !state.current) throw new GameError('NOT_ACCEPTING_ANSWERS', 'The round is over.');
        if (state.answers[userId]) throw new GameError('ALREADY_ANSWERED');
        if (!Number.isInteger(move.index) || move.index < 0 || move.index >= state.current.options.length) throw new GameError('INVALID_MOVE');
        state.answers[userId] = { index: move.index, at: ctx.now };
        events.push({ type: 'answered', user: userId });
        if (active(state).every((u) => state.answers[u])) return reveal(state, ctx, events);
        return step(state, ctx, events);
      }
      if (move.type === 'next') {
        if (state.phase !== 'reveal') throw new GameError('INVALID_MOVE');
        if (ctx.now < state.phaseStartedAt + 2000) throw new GameError('TOO_SOON');
        state.round += 1;
        return startRound(state, ctx, events);
      }
      throw new GameError('INVALID_MOVE');
    },

    timeout(prev, ctx) {
      const state: RoundsState = JSON.parse(JSON.stringify(prev));
      if (state.phase === 'done') return step(state, ctx, []);
      if (state.phase === 'answer') return reveal(state, ctx, [{ type: 'timeout' }]);
      state.round += 1;
      return startRound(state, ctx, []);
    },

    leave(prev, userId, ctx) {
      const state: RoundsState = JSON.parse(JSON.stringify(prev));
      if (state.left.includes(userId) || !state.order.includes(userId)) return step(state, ctx, []);
      state.left.push(userId);
      const events: GameEvent[] = [{ type: 'left', user: userId }];
      if (active(state).length < 2) {
        state.phase = 'done';
        state.current = null;
        events.push({ type: 'game_over' });
        return step(state, ctx, events);
      }
      if (state.phase === 'answer' && active(state).every((u) => state.answers[u])) return reveal(state, ctx, events);
      return step(state, ctx, events);
    },
  };
}
