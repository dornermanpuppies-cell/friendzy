import { GameError, rankByScore, shuffle, type EngineContext, type GameEngine, type GameEvent, type StepResult } from './types.ts';

/**
 * Truth or Dare — turn based. The current player picks truth or dare, gets a
 * prompt, performs it (in voice/video/chat) and the others vote whether it was
 * delivered. Points: 10 for a completed prompt.
 */
export interface TodState {
  order: string[];
  turnIndex: number;
  turn: number;
  totalTurns: number;
  phase: 'choose' | 'perform' | 'vote' | 'done';
  current: { user: string; kind: 'truth' | 'dare'; prompt: string } | null;
  votes: Record<string, 'done' | 'skip'>;
  scores: Record<string, number>;
  history: { user: string; kind: 'truth' | 'dare'; prompt: string; completed: boolean }[];
  left: string[];
  phaseStartedAt: number;
  chooseSeconds: number;
  performSeconds: number;
  voteSeconds: number;
  secret: { truths: string[]; dares: string[] };
}

export type TodMove = { type: 'choose'; pick: 'truth' | 'dare' } | { type: 'complete' } | { type: 'skip' } | { type: 'vote'; value: 'done' | 'skip' };

function active(state: TodState): string[] {
  return state.order.filter((u) => !state.left.includes(u));
}

function currentUser(state: TodState): string {
  return state.order[state.turnIndex];
}

function step(state: TodState, ctx: EngineContext, events: GameEvent[]): StepResult<TodState> {
  const seconds = state.phase === 'choose' ? state.chooseSeconds : state.phase === 'perform' ? state.performSeconds : state.voteSeconds;
  const finished = state.phase === 'done' ? rankByScore(state.order, state.scores, state.left) : undefined;
  const turnUser = state.phase === 'done' ? null : state.phase === 'vote' ? null : currentUser(state);
  return { state, turnUser, deadline: state.phase === 'done' ? null : state.phaseStartedAt + seconds * 1000, round: state.turn, finished, events };
}

function nextTurn(state: TodState, ctx: EngineContext, events: GameEvent[]): StepResult<TodState> {
  state.votes = {};
  state.current = null;
  if (state.turn >= state.totalTurns || active(state).length < 2) {
    state.phase = 'done';
    events.push({ type: 'game_over' });
    return step(state, ctx, events);
  }
  const n = state.order.length;
  for (let s = 1; s <= n; s += 1) {
    const idx = (state.turnIndex + s) % n;
    if (!state.left.includes(state.order[idx])) {
      state.turnIndex = idx;
      break;
    }
  }
  state.turn += 1;
  state.phase = 'choose';
  state.phaseStartedAt = ctx.now;
  events.push({ type: 'turn_started', user: currentUser(state), turn: state.turn });
  return step(state, ctx, events);
}

function tally(state: TodState, ctx: EngineContext, events: GameEvent[]): StepResult<TodState> {
  const values = Object.values(state.votes);
  const done = values.filter((v) => v === 'done').length;
  const skip = values.filter((v) => v === 'skip').length;
  const completed = done >= skip;
  const user = state.current!.user;
  if (completed) state.scores[user] = (state.scores[user] ?? 0) + 10;
  state.history.push({ user, kind: state.current!.kind, prompt: state.current!.prompt, completed });
  events.push({ type: 'tallied', user, completed, done, skip });
  return nextTurn(state, ctx, events);
}

export const truthOrDareEngine: GameEngine<TodState, TodMove> = {
  slug: 'truth_or_dare',

  init(ctx, options) {
    const truths = (options.truths as string[] | undefined) ?? [];
    const dares = (options.dares as string[] | undefined) ?? [];
    if (ctx.players.length < 2) throw new GameError('INVALID_PLAYERS', 'Truth or Dare needs at least 2 players.');
    if (truths.length < 3 || dares.length < 3) throw new GameError('NOT_ENOUGH_CONTENT', 'Not enough prompts available yet.');
    const order = [...ctx.players].sort((a, b) => a.seat - b.seat).map((p) => p.user_id);
    const scores: Record<string, number> = {};
    order.forEach((u) => { scores[u] = 0; });
    const roundsPerPlayer = Math.max(1, Math.min(3, Number(options.roundsPerPlayer ?? 2)));
    const state: TodState = {
      order, turnIndex: 0, turn: 1, totalTurns: roundsPerPlayer * order.length, phase: 'choose', current: null, votes: {}, scores, history: [], left: [],
      phaseStartedAt: ctx.now, chooseSeconds: 20, performSeconds: Number(options.performSeconds ?? ctx.turnSeconds ?? 60), voteSeconds: 20,
      secret: { truths: shuffle(truths, ctx.random), dares: shuffle(dares, ctx.random) },
    };
    return step(state, ctx, [{ type: 'started' }, { type: 'turn_started', user: currentUser(state), turn: 1 }]);
  },

  move(prev, move, userId, ctx) {
    const state: TodState = JSON.parse(JSON.stringify(prev));
    if (state.phase === 'done') throw new GameError('GAME_OVER');
    if (!active(state).includes(userId)) throw new GameError('NOT_A_PLAYER');
    const events: GameEvent[] = [];
    const me = currentUser(state);

    if (move.type === 'choose') {
      if (state.phase !== 'choose' || userId !== me) throw new GameError('NOT_YOUR_TURN');
      const pool = move.pick === 'dare' ? state.secret.dares : state.secret.truths;
      const prompt = pool.shift() ?? (move.pick === 'dare' ? 'Do your best dance move for 10 seconds.' : 'Share something nobody here knows about you.');
      pool.push(prompt); // recycle at the end so long games never run dry
      state.current = { user: userId, kind: move.pick, prompt };
      state.phase = 'perform';
      state.phaseStartedAt = ctx.now;
      events.push({ type: 'chosen', user: userId, kind: move.pick });
      return step(state, ctx, events);
    }
    if (move.type === 'complete') {
      if (state.phase !== 'perform' || userId !== me) throw new GameError('NOT_YOUR_TURN');
      state.phase = 'vote';
      state.votes = {};
      state.phaseStartedAt = ctx.now;
      events.push({ type: 'vote_started', user: userId });
      if (active(state).length <= 1) return tally(state, ctx, events);
      return step(state, ctx, events);
    }
    if (move.type === 'skip') {
      if (state.phase !== 'perform' && state.phase !== 'choose') throw new GameError('INVALID_MOVE');
      if (userId !== me) throw new GameError('NOT_YOUR_TURN');
      if (state.current) state.history.push({ ...state.current, completed: false });
      events.push({ type: 'skipped', user: userId });
      return nextTurn(state, ctx, events);
    }
    if (move.type === 'vote') {
      if (state.phase !== 'vote') throw new GameError('INVALID_MOVE');
      if (userId === me) throw new GameError('CANNOT_VOTE_SELF', 'Others decide whether you delivered.');
      state.votes[userId] = move.value;
      events.push({ type: 'voted', user: userId });
      const voters = active(state).filter((u) => u !== me);
      if (voters.every((u) => state.votes[u])) return tally(state, ctx, events);
      return step(state, ctx, events);
    }
    throw new GameError('INVALID_MOVE');
  },

  timeout(prev, ctx) {
    const state: TodState = JSON.parse(JSON.stringify(prev));
    if (state.phase === 'done') return step(state, ctx, []);
    const me = currentUser(state);
    if (state.phase === 'choose') return this.move(state, { type: 'choose', pick: 'truth' }, me, ctx);
    if (state.phase === 'perform') return this.move(state, { type: 'complete' }, me, ctx);
    return tally(state, ctx, [{ type: 'timeout' }]);
  },

  leave(prev, userId, ctx) {
    const state: TodState = JSON.parse(JSON.stringify(prev));
    if (state.left.includes(userId) || !state.order.includes(userId)) return step(state, ctx, []);
    state.left.push(userId);
    const events: GameEvent[] = [{ type: 'left', user: userId }];
    if (state.phase !== 'done' && currentUser(state) === userId) {
      if (state.current) state.history.push({ ...state.current, completed: false });
      return nextTurn(state, ctx, events);
    }
    if (state.phase === 'vote') {
      const me = currentUser(state);
      const voters = active(state).filter((u) => u !== me);
      if (voters.every((u) => state.votes[u])) return tally(state, ctx, events);
    }
    if (active(state).length < 2) {
      state.phase = 'done';
      events.push({ type: 'game_over' });
    }
    return step(state, ctx, events);
  },
};
