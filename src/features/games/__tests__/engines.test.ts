import { Chess } from 'chess.js';

import { createChessEngine } from '../../../../supabase/functions/_shared/games/chess.ts';
import { getEngine, rankByScore } from '../../../../supabase/functions/_shared/games/index.ts';
import { HOME, ludoEngine, type LudoState } from '../../../../supabase/functions/_shared/games/ludo.ts';
import { createRoundsEngine, type RoundsState } from '../../../../supabase/functions/_shared/games/rounds.ts';
import { truthOrDareEngine, type TodState } from '../../../../supabase/functions/_shared/games/truth_or_dare.ts';
import type { EngineContext } from '../../../../supabase/functions/_shared/games/types.ts';

/** Engine errors carry a stable `code`; the message is the human-readable hint. */
function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code} to be thrown`);
}

/** Deterministic "random": returns the queued values in order (defaults to 0). */
function scripted(values: number[]): () => number {
  const queue = [...values];
  return () => queue.shift() ?? 0;
}

function ctx(overrides: Partial<EngineContext> = {}): EngineContext {
  return { players: [{ user_id: 'a', seat: 0 }, { user_id: 'b', seat: 1 }], now: 1_700_000_000_000, random: () => 0, turnSeconds: 30, ...overrides };
}

/** A die value d is produced by random() = (d - 1) / 6. */
const die = (d: number) => (d - 1) / 6;

describe('rankByScore', () => {
  it('ranks by score, ties share a rank and are flagged as draws, leavers come last', () => {
    const rows = rankByScore(['a', 'b', 'c', 'd'], { a: 10, b: 10, c: 5, d: 99 }, ['d']);
    expect(rows.map((r) => [r.user_id, r.rank, r.draw ?? false])).toEqual([
      ['a', 1, true],
      ['b', 1, true],
      ['c', 3, false],
      ['d', 4, false],
    ]);
  });
});

describe('ludo engine', () => {
  it('needs a six to leave the base and passes the turn when nothing can move', () => {
    const start = ludoEngine.init(ctx(), {});
    expect(start.turnUser).toBe('a');
    const rolled = ludoEngine.move(start.state, { type: 'roll' }, 'a', ctx({ random: scripted([die(3)]) }));
    expect(rolled.state.lastRoll).toEqual({ user: 'a', dice: 3 });
    expect(rolled.state.phase).toBe('roll');
    expect(rolled.turnUser).toBe('b');
    expect(rolled.events.map((e) => e.type)).toEqual(['rolled', 'no_moves']);
  });

  it('a six opens a token, auto-moves when only one option exists and grants an extra turn', () => {
    const start = ludoEngine.init(ctx(), {});
    // All four tokens are in the base, so a six makes all four legal → the player must choose.
    const six = ludoEngine.move(start.state, { type: 'roll' }, 'a', ctx({ random: scripted([die(6)]) }));
    expect(six.state.phase).toBe('move');
    expect(six.state.legal).toEqual([0, 1, 2, 3]);
    const moved = ludoEngine.move(six.state, { type: 'move', token: 2 }, 'a', ctx());
    expect(moved.state.tokens.a[2]).toBe(0);
    expect(moved.turnUser).toBe('a'); // extra turn after a six
    expect(moved.state.sixes).toBe(1);
    // Now a two: only token 2 can move, so the engine moves it without asking.
    const two = ludoEngine.move(moved.state, { type: 'roll' }, 'a', ctx({ random: scripted([die(2)]) }));
    expect(two.state.tokens.a[2]).toBe(2);
    expect(two.state.phase).toBe('roll');
    expect(two.turnUser).toBe('b');
  });

  it('rejects out-of-turn and illegal moves', () => {
    const start = ludoEngine.init(ctx(), {});
    expectCode(() => ludoEngine.move(start.state, { type: 'roll' }, 'b', ctx()), 'NOT_YOUR_TURN');
    expectCode(() => ludoEngine.move(start.state, { type: 'move', token: 0 }, 'a', ctx()), 'ROLL_FIRST');
  });

  it('three sixes in a row forfeit the turn', () => {
    let state = ludoEngine.init(ctx(), {}).state;
    state = ludoEngine.move(state, { type: 'roll' }, 'a', ctx({ random: scripted([die(6)]) })).state;
    state = ludoEngine.move(state, { type: 'move', token: 0 }, 'a', ctx()).state;
    state = ludoEngine.move(state, { type: 'roll' }, 'a', ctx({ random: scripted([die(6)]) })).state;
    state = ludoEngine.move(state, { type: 'move', token: 1 }, 'a', ctx()).state;
    const third = ludoEngine.move(state, { type: 'roll' }, 'a', ctx({ random: scripted([die(6)]) }));
    expect(third.events.map((e) => e.type)).toContain('three_sixes');
    expect(third.turnUser).toBe('b');
    expect(third.state.sixes).toBe(0);
  });

  it('captures an opponent token on a non-safe cell and sends it back to base', () => {
    const base = ludoEngine.init(ctx(), {}).state;
    // Seat 1 token sits on absolute cell 14 (its relative 1); seat 0 token on relative 13 (absolute 13 is a start cell → safe), so use 14.
    const state: LudoState = { ...base, tokens: { a: [10, -1, -1, -1], b: [1, -1, -1, -1] }, phase: 'roll' };
    const rolled = ludoEngine.move(state, { type: 'roll' }, 'a', ctx({ random: scripted([die(4)]) }));
    // token a[0] 10 → 14 = seat1's relative 1 → capture
    expect(rolled.state.tokens.a[0]).toBe(14);
    expect(rolled.state.tokens.b[0]).toBe(-1);
    expect(rolled.state.lastMove?.captured).toEqual([{ user: 'b', token: 0 }]);
    expect(rolled.turnUser).toBe('a'); // capture grants an extra turn
  });

  it('does not capture on safe cells', () => {
    const base = ludoEngine.init(ctx(), {}).state;
    const state: LudoState = { ...base, tokens: { a: [5, -1, -1, -1], b: [-1, -1, -1, -1] }, phase: 'roll' };
    // absolute 8 is a star cell: put b's token there (seat 1 relative = (8 - 13 + 52) % 52 = 47)
    state.tokens.b[0] = 47;
    const rolled = ludoEngine.move(state, { type: 'roll' }, 'a', ctx({ random: scripted([die(3)]) }));
    expect(rolled.state.tokens.a[0]).toBe(8);
    expect(rolled.state.tokens.b[0]).toBe(47);
    expect(rolled.state.lastMove?.captured).toEqual([]);
  });

  it('finishes the game when a player brings every token home and ranks the rest by progress', () => {
    const base = ludoEngine.init(ctx(), {}).state;
    const state: LudoState = { ...base, tokens: { a: [HOME, HOME, HOME, 54], b: [20, 3, -1, -1] }, phase: 'roll' };
    const done = ludoEngine.move(state, { type: 'roll' }, 'a', ctx({ random: scripted([die(2)]) }));
    expect(done.state.phase).toBe('done');
    expect(done.state.winner).toBe('a');
    expect(done.finished?.map((r) => [r.user_id, r.rank])).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('timeouts roll and move for the absent player; leaving ends a two-player game', () => {
    const start = ludoEngine.init(ctx(), {});
    const timed = ludoEngine.timeout(start.state, ctx({ random: scripted([die(6)]) }));
    expect(timed.state.tokens.a).toContain(0);
    expect(timed.events.map((e) => e.type)).toContain('timeout');
    const left = ludoEngine.leave(timed.state, 'a', ctx());
    expect(left.state.phase).toBe('done');
    expect(left.state.winner).toBe('b');
    expect(left.finished?.find((r) => r.user_id === 'a')?.rank).toBe(2);
  });
});

describe('rounds engine (trivia / would you rather / guess the song)', () => {
  const rounds = [
    { prompt: 'Q1', options: ['x', 'y', 'z', 'w'], answer: 1 },
    { prompt: 'Q2', options: ['x', 'y', 'z', 'w'], answer: 0 },
    { prompt: 'Q3', options: ['x', 'y', 'z', 'w'], answer: 2 },
  ];
  const trivia = createRoundsEngine('trivia', 'trivia');

  it('refuses to start with too little content or too few players', () => {
    expectCode(() => trivia.init(ctx(), { rounds: rounds.slice(0, 2) }), 'NOT_ENOUGH_CONTENT');
    expectCode(() => trivia.init(ctx({ players: [{ user_id: 'a', seat: 0 }] }), { rounds }), 'INVALID_PLAYERS');
  });

  it('scores correct answers with a speed bonus, reveals once everyone answered and advances', () => {
    const c = ctx();
    const start = trivia.init(c, { rounds, answerSeconds: 10, revealSeconds: 5 });
    expect(start.state.phase).toBe('answer');
    const first = rounds.find((r) => r.prompt === start.state.current?.prompt)!;
    expect(first).toBeDefined();
    expect(start.state.current?.options).toEqual(first.options);
    expect(start.turnUser).toBeNull();
    expect(start.deadline).toBe(c.now + 10_000);
    const right = first.answer as number;
    const wrong = (right + 1) % 4;
    // Fast correct answer from a, wrong answer from b 6 seconds in.
    const a = trivia.move(start.state, { type: 'answer', index: right }, 'a', { ...c, now: c.now + 1_000 });
    expect(a.state.phase).toBe('answer');
    expectCode(() => trivia.move(a.state, { type: 'answer', index: right }, 'a', c), 'ALREADY_ANSWERED');
    const b = trivia.move(a.state, { type: 'answer', index: wrong }, 'b', { ...c, now: c.now + 6_000 });
    expect(b.state.phase).toBe('reveal');
    expect(b.state.scores.a).toBe(100 + Math.round(0.9 * 50));
    expect(b.state.scores.b).toBe(0);
    const expectedCounts = [0, 0, 0, 0];
    expectedCounts[right] += 1;
    expectedCounts[wrong] += 1;
    expect(b.state.lastReveal?.counts).toEqual(expectedCounts);
    expectCode(() => trivia.move(b.state, { type: 'next' }, 'a', { ...c, now: c.now + 6_500 }), 'TOO_SOON');
    const next = trivia.move(b.state, { type: 'next' }, 'a', { ...c, now: c.now + 9_000 });
    expect(next.state.current?.prompt).not.toBe(first.prompt);
    expect(next.round).toBe(2);
  });

  it('times out an answer phase into a reveal and finishes after the last round', () => {
    const c = ctx();
    let state: RoundsState = trivia.init(c, { rounds }).state;
    for (let i = 0; i < 3; i += 1) {
      const revealed = trivia.timeout(state, c);
      expect(revealed.state.phase).toBe('reveal');
      state = trivia.timeout(revealed.state, c).state; // reveal timeout → next round
    }
    expect(state.phase).toBe('done');
    const final = trivia.timeout(state, c);
    expect(final.finished?.length).toBe(2);
    expect(final.finished?.every((r) => r.draw)).toBe(true);
  });

  it('would-you-rather awards the majority and ends when a player leaves', () => {
    const wyr = createRoundsEngine('wyr', 'would_you_rather');
    const c = ctx({ players: [{ user_id: 'a', seat: 0 }, { user_id: 'b', seat: 1 }, { user_id: 'c', seat: 2 }] });
    const opinion = [1, 2, 3].map((n) => ({ prompt: `P${n}`, options: ['L', 'R'], answer: null }));
    let step = wyr.init(c, { rounds: opinion });
    step = wyr.move(step.state, { type: 'answer', index: 0 }, 'a', c);
    step = wyr.move(step.state, { type: 'answer', index: 0 }, 'b', c);
    step = wyr.move(step.state, { type: 'answer', index: 1 }, 'c', c);
    expect(step.state.phase).toBe('reveal');
    expect(step.state.scores).toEqual({ a: 10, b: 10, c: 0 });
    const left = wyr.leave(step.state, 'c', c);
    expect(left.state.left).toEqual(['c']);
    const left2 = wyr.leave(left.state, 'b', c);
    expect(left2.state.phase).toBe('done');
    expect(left2.finished?.[0]).toMatchObject({ user_id: 'a', rank: 1 });
  });
});

describe('truth or dare engine', () => {
  const content = { truths: ['t1', 't2', 't3'], dares: ['d1', 'd2', 'd3'], roundsPerPlayer: 1 };

  it('runs choose → perform → vote → score for each player and finishes', () => {
    const c = ctx();
    let step = truthOrDareEngine.init(c, content);
    expect(step.turnUser).toBe('a');
    expectCode(() => truthOrDareEngine.move(step.state, { type: 'choose', pick: 'truth' }, 'b', c), 'NOT_YOUR_TURN');
    step = truthOrDareEngine.move(step.state, { type: 'choose', pick: 'dare' }, 'a', c);
    expect(step.state.current).toMatchObject({ user: 'a', kind: 'dare' });
    step = truthOrDareEngine.move(step.state, { type: 'complete' }, 'a', c);
    expect(step.state.phase).toBe('vote');
    expect(step.turnUser).toBeNull();
    expectCode(() => truthOrDareEngine.move(step.state, { type: 'vote', value: 'done' }, 'a', c), 'CANNOT_VOTE_SELF');
    step = truthOrDareEngine.move(step.state, { type: 'vote', value: 'done' }, 'b', c);
    expect(step.state.scores.a).toBe(10);
    expect(step.turnUser).toBe('b');
    expect(step.state.turn).toBe(2);
    step = truthOrDareEngine.move(step.state, { type: 'skip' }, 'b', c);
    expect(step.state.phase).toBe('done');
    expect(step.finished?.[0]).toMatchObject({ user_id: 'a', rank: 1, score: 10 });
  });

  it('timeouts pick truth, complete and tally; leaving mid-turn moves on', () => {
    const c = ctx({ players: [{ user_id: 'a', seat: 0 }, { user_id: 'b', seat: 1 }, { user_id: 'c', seat: 2 }] });
    let step = truthOrDareEngine.init(c, content);
    step = truthOrDareEngine.timeout(step.state, c); // choose → truth
    expect(step.state.phase).toBe('perform');
    step = truthOrDareEngine.timeout(step.state, c); // perform → vote
    expect(step.state.phase).toBe('vote');
    step = truthOrDareEngine.timeout(step.state, c); // vote → tallied (0 done >= 0 skip → completed)
    expect(step.state.scores.a).toBe(10);
    const state: TodState = step.state;
    const left = truthOrDareEngine.leave(state, state.order[state.turnIndex], c);
    expect(left.state.turn).toBe(3);
  });
});

describe('chess engine', () => {
  const chess = createChessEngine(Chess as never);

  it('plays legal moves, rejects illegal ones and records checkmate', () => {
    const c = ctx({ random: () => 0 }); // a is white
    let step = chess.init(c, {});
    expect(step.state.white).toBe('a');
    expectCode(() => chess.move(step.state, { type: 'move', from: 'e2', to: 'e5' }, 'a', c), 'ILLEGAL_MOVE');
    expectCode(() => chess.move(step.state, { type: 'move', from: 'e7', to: 'e5' }, 'b', c), 'NOT_YOUR_TURN');
    const line: [string, string, string][] = [
      ['a', 'f2', 'f3'],
      ['b', 'e7', 'e5'],
      ['a', 'g2', 'g4'],
      ['b', 'd8', 'h4'],
    ];
    for (const [who, from, to] of line) step = chess.move(step.state, { type: 'move', from, to }, who, c);
    expect(step.state.moves).toEqual(['f3', 'e5', 'g4', 'Qh4#']);
    expect(step.state.result).toEqual({ reason: 'checkmate', winner: 'b' });
    expect(step.finished?.map((r) => [r.user_id, r.rank])).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });

  it('handles draw offers, resignation and timeouts', () => {
    const c = ctx({ random: () => 0 });
    let step = chess.init(c, {});
    step = chess.move(step.state, { type: 'offer_draw' }, 'a', c);
    expectCode(() => chess.move(step.state, { type: 'accept_draw' }, 'a', c), 'NO_DRAW_OFFER');
    const declined = chess.move(step.state, { type: 'decline_draw' }, 'b', c);
    expect(declined.state.drawOffer).toBeNull();
    const agreed = chess.move(chess.move(declined.state, { type: 'offer_draw' }, 'b', c).state, { type: 'accept_draw' }, 'a', c);
    expect(agreed.state.result).toEqual({ reason: 'agreement', winner: null });
    expect(agreed.finished?.every((r) => r.draw)).toBe(true);
    const resigned = chess.move(chess.init(c, {}).state, { type: 'resign' }, 'a', c);
    expect(resigned.state.result).toEqual({ reason: 'resignation', winner: 'b' });
    const timed = chess.timeout(chess.init(c, {}).state, c);
    expect(timed.state.result).toEqual({ reason: 'timeout', winner: 'b' });
  });

  it('getEngine wires every catalogue slug', () => {
    for (const slug of ['ludo', 'trivia', 'would_you_rather', 'guess_the_song', 'truth_or_dare']) expect(getEngine(slug).slug).toBe(slug);
    expect(getEngine('chess', { Chess: Chess as never }).slug).toBe('chess');
    expectCode(() => getEngine('chess'), 'ENGINE_UNAVAILABLE');
    expectCode(() => getEngine('poker'), 'UNKNOWN_GAME');
  });
});

describe('rounds engine concurrency', () => {
  it('flags answers (and only answers) as concurrent moves so simultaneous answers are never stale', () => {
    const engine = createRoundsEngine('wyr', 'would_you_rather');
    expect(engine.concurrent?.({ type: 'answer', index: 0 })).toBe(true);
    expect(engine.concurrent?.({ type: 'next' })).toBe(false);
  });
});
