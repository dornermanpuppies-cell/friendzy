import { createChessEngine, type ChessCtor } from './chess.ts';
import { ludoEngine } from './ludo.ts';
import { createRoundsEngine } from './rounds.ts';
import { truthOrDareEngine } from './truth_or_dare.ts';
import { GameError, type GameEngine } from './types.ts';

export * from './types.ts';
export * from './ludo.ts';
export * from './chess.ts';
export * from './rounds.ts';
export * from './truth_or_dare.ts';

export const GAME_SLUGS = ['ludo', 'chess', 'trivia', 'would_you_rather', 'truth_or_dare', 'guess_the_song'] as const;
export type GameSlug = (typeof GAME_SLUGS)[number];

/** Returns the engine for a game. `deps.Chess` is required for chess. */
export function getEngine(slug: string, deps: { Chess?: ChessCtor } = {}): GameEngine {
  switch (slug) {
    case 'ludo':
      return ludoEngine as GameEngine;
    case 'chess':
      if (!deps.Chess) throw new GameError('ENGINE_UNAVAILABLE', 'Chess rules library not provided.');
      return createChessEngine(deps.Chess) as GameEngine;
    case 'trivia':
      return createRoundsEngine('trivia', 'trivia') as GameEngine;
    case 'would_you_rather':
      return createRoundsEngine('wyr', 'would_you_rather') as GameEngine;
    case 'guess_the_song':
      return createRoundsEngine('song', 'guess_the_song') as GameEngine;
    case 'truth_or_dare':
      return truthOrDareEngine as GameEngine;
    default:
      throw new GameError('UNKNOWN_GAME', `Unknown game "${slug}".`);
  }
}
