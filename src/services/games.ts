import { privateChannel } from '@/lib/realtime';
import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';
import type { EngineAction, EngineResponse, GameLobby, GameMessage, GameRoom, GameSlug, Leaderboard } from '@/types/games';

function rows<T>(data: Json[] | Json | null): T[] {
  return (data ?? []) as unknown as T[];
}

export async function listGameRooms(game?: GameSlug | null): Promise<GameLobby> {
  const { data, error } = await supabase.rpc('list_game_rooms', { p_game: game ?? null });
  if (error) throw error;
  return data as unknown as GameLobby;
}

export async function createGameRoom(game: GameSlug, isPrivate = false, maxPlayers?: number | null): Promise<GameRoom> {
  const { data, error } = await supabase.rpc('create_game_room', { p_game: game, p_is_private: isPrivate, p_max_players: maxPlayers ?? null });
  if (error) throw error;
  return data as unknown as GameRoom;
}

export async function joinGameRoom(params: { roomId?: string; code?: string }): Promise<GameRoom> {
  const { data, error } = await supabase.rpc('join_game_room', { p_room: params.roomId ?? null, p_code: params.code ?? null });
  if (error) throw error;
  return data as unknown as GameRoom;
}

export async function leaveGameRoom(roomId: string): Promise<void> {
  const { error } = await supabase.rpc('leave_game_room', { p_room: roomId });
  if (error) throw error;
}

export async function inviteToGame(roomId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('invite_to_game', { p_room: roomId, p_user: userId });
  if (error) throw error;
}

export async function setGameReady(roomId: string, ready: boolean): Promise<GameRoom> {
  const { data, error } = await supabase.rpc('set_game_ready', { p_room: roomId, p_ready: ready });
  if (error) throw error;
  return data as unknown as GameRoom;
}

export async function getGameRoom(roomId: string): Promise<GameRoom | null> {
  const { data, error } = await supabase.rpc('get_game_room', { p_room: roomId });
  if (error) throw error;
  return (data as unknown as GameRoom | null) ?? null;
}

export async function getLeaderboard(game: GameSlug, limit = 20): Promise<Leaderboard> {
  const { data, error } = await supabase.rpc('get_leaderboard', { p_game: game, p_limit: limit });
  if (error) throw error;
  return data as unknown as Leaderboard;
}

export async function getMyGameHistory(limit = 20): Promise<GameRoom[]> {
  const { data, error } = await supabase.rpc('get_my_game_history', { p_limit: limit });
  if (error) throw error;
  return rows<GameRoom>(data);
}

export async function getGameMessages(roomId: string, limit = 50): Promise<GameMessage[]> {
  const { data, error } = await supabase.rpc('get_game_messages', { p_room: roomId, p_limit: limit });
  if (error) throw error;
  return rows<GameMessage>(data).reverse();
}

export async function sendGameMessage(roomId: string, text: string): Promise<GameMessage> {
  const { data, error } = await supabase.rpc('send_game_message', { p_room: roomId, p_text: text });
  if (error) throw error;
  return data as unknown as GameMessage;
}

export async function createRematch(roomId: string): Promise<GameRoom> {
  const { data, error } = await supabase.rpc('create_rematch', { p_room: roomId });
  if (error) throw error;
  return data as unknown as GameRoom;
}

export class EngineError extends Error {
  code: string | undefined;
  room: GameRoom | undefined;
  constructor(message: string, code?: string, room?: GameRoom) {
    super(message);
    this.code = code;
    this.room = room;
  }
}

/** Calls the authoritative game-engine Edge Function. */
export async function engineAction(action: EngineAction, roomId: string, payload: { move?: Record<string, unknown>; version?: number } = {}): Promise<EngineResponse> {
  const { data, error } = await supabase.functions.invoke<EngineResponse>('game-engine', { body: { action, room_id: roomId, move: payload.move, version: payload.version } });
  if (error) {
    const context = (error as { context?: Response }).context;
    let message = error.message;
    let code: string | undefined;
    let room: GameRoom | undefined;
    try {
      const body = context ? ((await context.json()) as EngineResponse) : null;
      if (body?.error) message = body.error;
      code = body?.code;
      room = body?.room;
    } catch {
      /* ignore */
    }
    throw new EngineError(message, code, room);
  }
  if (!data) throw new EngineError('No response from the game server.');
  if (data.error) throw new EngineError(data.error, data.code, data.room);
  return data;
}

export function subscribeToGameRoom(roomId: string, handlers: { onRoom?: () => void; onMessage?: (message: { id: number; user_id: string | null; text: string; created_at: string }) => void }): () => void {
  const channel = privateChannel(`game:${roomId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_rooms', filter: `id=eq.${roomId}` }, () => handlers.onRoom?.())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_participants', filter: `room_id=eq.${roomId}` }, () => handlers.onRoom?.())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_messages', filter: `room_id=eq.${roomId}` }, (payload) => handlers.onMessage?.(payload.new as { id: number; user_id: string | null; text: string; created_at: string }))
    .subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => undefined);
  };
}

export function subscribeToGameInvites(userId: string, onInvite: () => void): () => void {
  const channel = privateChannel(`game-invites:${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_participants', filter: `user_id=eq.${userId}` }, onInvite)
    .subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => undefined);
  };
}
