import type { AuthorCard } from '@/types/social';

export type GameSlug = 'ludo' | 'chess' | 'trivia' | 'would_you_rather' | 'truth_or_dare' | 'guess_the_song';
export type GameStatus = 'waiting' | 'playing' | 'finished' | 'cancelled';

export interface GameInfo {
  slug: GameSlug;
  name: string;
  description: string;
  emoji: string;
  min_players: number;
  max_players: number;
  turn_seconds: number;
  playing_now?: number;
}

export interface GameParticipant extends AuthorCard {
  seat: number;
  state: 'invited' | 'joined' | 'left';
  score: number;
  is_ready: boolean;
}

export interface GameResultEntry {
  user: AuthorCard;
  rank: number;
  score: number;
  rating_delta: number;
}

export interface GameRoom {
  id: string;
  game: GameSlug;
  status: GameStatus;
  is_private: boolean;
  max_players: number;
  invite_code: string | null;
  host: AuthorCard;
  is_host: boolean;
  state: Record<string, unknown>;
  version: number;
  current_turn_user_id: string | null;
  turn_deadline: string | null;
  round: number;
  winner_id: string | null;
  rematch_of: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  game_info: Omit<GameInfo, 'slug' | 'description'>;
  participants: GameParticipant[];
  my_seat: number | null;
  my_state: 'invited' | 'joined' | 'left' | null;
  results: GameResultEntry[] | null;
  moves_count: number;
}

export interface GameLobby {
  mine: GameRoom[];
  invites: GameRoom[];
  open: GameRoom[];
  games: GameInfo[];
}

export interface LeaderboardEntry {
  user: AuthorCard;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  games_played: number;
  rank: number;
}

export interface Leaderboard {
  top: LeaderboardEntry[];
  me: Omit<LeaderboardEntry, 'user'> | null;
}

export interface GameMessage {
  id: number;
  user: AuthorCard | null;
  text: string;
  created_at: string;
}

export type EngineAction = 'start' | 'move' | 'tick' | 'forfeit';

export interface EngineResponse {
  room: GameRoom;
  events?: { type: string; [key: string]: unknown }[];
  changed?: boolean;
  error?: string;
  code?: string;
}
