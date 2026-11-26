/**
 * Friendzy game engines — shared between the `game-engine` Edge Function (the
 * only writer of authoritative state) and the app (for local previews such as
 * legal-move highlighting). Pure TypeScript: no Deno, Node or React imports.
 */

export interface GamePlayer {
  user_id: string;
  seat: number;
}

export interface EngineContext {
  /** Players who were seated when the game started, ordered by seat. */
  players: GamePlayer[];
  /** Milliseconds since epoch. */
  now: number;
  /** Cryptographically secure uniform random in [0, 1). */
  random: () => number;
  /** Default seconds per turn from the games catalogue. */
  turnSeconds: number;
}

export interface GameResultRow {
  user_id: string;
  rank: number;
  score: number;
  draw?: boolean;
}

export interface GameEvent {
  type: string;
  [key: string]: unknown;
}

export interface StepResult<S> {
  state: S;
  /** User whose input is awaited (null for simultaneous phases). */
  turnUser: string | null;
  /** Epoch ms when the current phase times out (null = no timer). */
  deadline: number | null;
  round: number;
  /** Present when the game just finished. */
  finished?: GameResultRow[];
  events: GameEvent[];
}

export interface GameEngine<S = unknown, M = unknown> {
  slug: string;
  init(ctx: EngineContext, options: Record<string, unknown>): StepResult<S>;
  move(state: S, move: M, userId: string, ctx: EngineContext): StepResult<S>;
  timeout(state: S, ctx: EngineContext): StepResult<S>;
  leave(state: S, userId: string, ctx: EngineContext): StepResult<S>;
  /**
   * Moves that do not depend on the exact state version — e.g. everyone answering the same
   * question at once. The server skips the optimistic-concurrency check for them (the engine still
   * validates phase and duplicates), so two players answering within the same second never lose a tap.
   */
  concurrent?(move: M): boolean;
}

export class GameError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'GameError';
  }
}

/** Ranks players by score (desc). Players who left are always ranked last. */
export function rankByScore(order: string[], scores: Record<string, number>, left: string[] = []): GameResultRow[] {
  const active = order.filter((u) => !left.includes(u));
  const sorted = [...active].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  const rows: GameResultRow[] = [];
  let rank = 0;
  let previous: number | null = null;
  sorted.forEach((u, i) => {
    const score = scores[u] ?? 0;
    if (previous === null || score < previous) rank = i + 1;
    previous = score;
    rows.push({ user_id: u, rank, score });
  });
  const topScore = sorted.length ? (scores[sorted[0]] ?? 0) : 0;
  const topCount = sorted.filter((u) => (scores[u] ?? 0) === topScore).length;
  if (sorted.length > 1 && topCount > 1) rows.forEach((r) => { if (r.rank === 1) r.draw = true; });
  const leftSorted = order.filter((u) => left.includes(u));
  leftSorted.forEach((u) => rows.push({ user_id: u, rank: sorted.length + 1, score: scores[u] ?? 0 }));
  return rows;
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
