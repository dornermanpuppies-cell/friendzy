// Friendzy — authoritative game engine (the only writer of game_rooms.state)
//
// POST { action: 'start' | 'move' | 'tick' | 'forfeit', room_id, move?, version? }
// with the player's Supabase JWT in the Authorization header.
//
// - start:   host starts the room (enough ready players required)
// - move:    apply a move; `version` enables optimistic concurrency (409 on stale)
// - tick:    apply the turn timeout if the deadline passed (any player may call)
// - forfeit: leave a running game
//
// Rules live in ../_shared/games (pure TypeScript, also used by the app for
// previews). Content banks (trivia questions, prompts, sounds) are read with the
// service role so answer keys never reach clients; game_room_json strips `secret`.
// Deploy: supabase functions deploy game-engine

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { Chess } from 'npm:chess.js@1.4.0';

import { GameError, getEngine, shuffle, type EngineContext, type GamePlayer, type RoundSpec, type StepResult } from '../_shared/games/index.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-friendzy-platform, x-supabase-api-version, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function secureRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

type Participant = { user_id: string; seat: number; state: 'invited' | 'joined' | 'left'; is_ready: boolean };

function parseWyr(text: string): string[] {
  const body = text.replace(/^would you rather\s+/i, '').replace(/\?\s*$/, '');
  const parts = body.split(/\s+or\s+/i);
  if (parts.length === 2) return parts.map((p) => p.trim().replace(/^./, (c) => c.toUpperCase()));
  return ['Option A', 'Option B'];
}

async function buildOptions(admin: SupabaseClient, slug: string): Promise<Record<string, unknown>> {
  if (slug === 'trivia') {
    const { data } = await admin.from('trivia_questions').select('category, difficulty, question, options, answer_index').eq('is_active', true);
    const rounds: RoundSpec[] = shuffle(data ?? [], secureRandom).slice(0, 10).map((q) => ({ prompt: q.question, options: q.options as string[], answer: q.answer_index, meta: { category: q.category, difficulty: q.difficulty } }));
    return { rounds, answerSeconds: 15, revealSeconds: 5 };
  }
  if (slug === 'would_you_rather') {
    const { data } = await admin.from('party_prompts').select('text').eq('game', 'would_you_rather').eq('kind', 'wyr').eq('is_active', true);
    const rounds: RoundSpec[] = shuffle(data ?? [], secureRandom).slice(0, 8).map((p) => ({ prompt: p.text, options: parseWyr(p.text), answer: null }));
    return { rounds, answerSeconds: 20, revealSeconds: 6 };
  }
  if (slug === 'truth_or_dare') {
    const { data } = await admin.from('party_prompts').select('kind, text').eq('game', 'truth_or_dare').eq('is_active', true);
    const truths = (data ?? []).filter((p) => p.kind === 'truth').map((p) => p.text);
    const dares = (data ?? []).filter((p) => p.kind === 'dare').map((p) => p.text);
    return { truths, dares, roundsPerPlayer: 2, performSeconds: 60 };
  }
  if (slug === 'guess_the_song') {
    const { data } = await admin.from('sounds').select('id, title, artist, url, cover_url, is_original, uses_count').not('url', 'is', null).order('uses_count', { ascending: false }).limit(80);
    let pool = (data ?? []).filter((s) => !s.is_original);
    if (pool.length < 4) pool = data ?? [];
    if (pool.length < 4) throw new GameError('NOT_ENOUGH_CONTENT', 'Guess the Song needs at least 4 sounds in the Friendzy sound library. Upload a few sounds first.');
    const picks = shuffle(pool, secureRandom).slice(0, 8);
    const rounds: RoundSpec[] = picks.map((s) => {
      const decoys = shuffle(pool.filter((o) => o.id !== s.id), secureRandom).slice(0, 3).map((o) => o.title);
      const options = shuffle([s.title, ...decoys], secureRandom);
      return { prompt: 'Which song is this?', options, answer: options.indexOf(s.title), media_url: s.url, meta: { cover_url: s.cover_url, artist: s.artist } };
    });
    return { rounds, answerSeconds: 15, revealSeconds: 5 };
  }
  return {};
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing authorization' }, 401);
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Invalid session' }, 401);
  const userId = userData.user.id;

  let body: { action?: string; room_id?: string; move?: unknown; version?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const action = String(body.action ?? '');
  const roomId = String(body.room_id ?? '');
  if (!['start', 'move', 'tick', 'forfeit'].includes(action) || !/^[0-9a-f-]{36}$/.test(roomId)) return json({ error: 'Invalid request' }, 400);

  const admin = createClient(supabaseUrl, serviceKey);
  const fetchRoom = async () => (await userClient.rpc('get_game_room', { p_room: roomId })).data;

  const { data: room } = await admin.from('game_rooms').select('*').eq('id', roomId).maybeSingle();
  if (!room) return json({ error: 'Room not found' }, 404);
  const { data: participantRows } = await admin.from('game_participants').select('user_id, seat, state, is_ready').eq('room_id', roomId);
  const participants = (participantRows ?? []) as Participant[];
  const mine = participants.find((p) => p.user_id === userId);
  if (!mine || mine.state === 'invited') return json({ error: 'You are not in this room' }, 403);
  const { data: game } = await admin.from('games').select('*').eq('slug', room.game).single();
  if (!game) return json({ error: 'Unknown game' }, 400);

  const toPlayers = (rows: Participant[]): GamePlayer[] => rows.map((p) => ({ user_id: p.user_id, seat: p.seat }));
  const ctx: EngineContext = { players: toPlayers(participants.filter((p) => p.state !== 'invited')), now: Date.now(), random: secureRandom, turnSeconds: game.turn_seconds };

  const nowIso = new Date().toISOString();

  let engine: ReturnType<typeof getEngine>;
  try {
    engine = getEngine(room.game, { Chess: Chess as never });
  } catch (error) {
    if (error instanceof GameError) return json({ error: error.message, code: error.code }, 400);
    console.error('[game-engine]', error);
    return json({ error: 'Game engine error' }, 500);
  }
  // Simultaneous moves (everyone answering the same question) never fail as "stale": the engine
  // validates them itself, and a write conflict is retried on the fresh room state.
  const concurrentMove = action === 'move' && typeof body.move === 'object' && body.move !== null && engine.concurrent?.(body.move) === true;

  type Outcome = { result: StepResult<unknown> | null; moveRecord: Record<string, unknown> | null; newStatus: string };
  // Applies the requested action to the given room snapshot; returns a Response when the request is rejected.
  const compute = async (current: typeof room): Promise<Outcome | Response> => {
    const room = current;
    let result: StepResult<unknown> | null = null;
    let moveRecord: Record<string, unknown> | null = null;
    let newStatus: string = room.status;
    try {
      if (action === 'start') {
        if (room.host_id !== userId) return json({ error: 'Only the host can start the game' }, 403);
        if (room.status !== 'waiting') return json({ error: 'The game has already started' }, 409);
        const joined = participants.filter((p) => p.state === 'joined');
        if (joined.length < game.min_players) return json({ error: `${game.name} needs at least ${game.min_players} players` }, 400);
        const notReady = joined.filter((p) => !p.is_ready && p.user_id !== room.host_id);
        if (notReady.length > 0) return json({ error: 'Everyone needs to tap Ready first' }, 400);
        ctx.players = toPlayers(joined);
        result = engine.init(ctx, await buildOptions(admin, room.game));
        moveRecord = { type: 'start' };
        newStatus = 'playing';
      } else {
        if (room.status !== 'playing') return json({ error: 'This game is not running' }, 409);
        let state = room.state as { left?: string[] };
        // Apply leaves recorded by leave_game_room() that the engine has not processed yet.
        const known = new Set(state.left ?? []);
        for (const p of participants) {
          if (p.state === 'left' && !known.has(p.user_id)) {
            result = engine.leave(state, p.user_id, ctx);
            state = result.state as { left?: string[] };
          }
        }
        if (action === 'forfeit') {
          result = engine.leave(state, userId, ctx);
          await admin.from('game_participants').update({ state: 'left', left_at: nowIso, is_ready: false }).eq('room_id', roomId).eq('user_id', userId);
          moveRecord = { type: 'leave' };
        } else if (action === 'move') {
          if (!concurrentMove && typeof body.version === 'number' && body.version !== room.version) return json({ error: 'The game moved on — refreshing.', code: 'STALE', room: await fetchRoom() }, 409);
          if (!body.move || typeof body.move !== 'object') return json({ error: 'Missing move' }, 400);
          result = engine.move(state, body.move, userId, ctx);
          moveRecord = body.move as Record<string, unknown>;
        } else if (action === 'tick') {
          const deadline = room.turn_deadline ? Date.parse(room.turn_deadline) : null;
          if (deadline !== null && deadline <= Date.now()) {
            result = engine.timeout(state, ctx);
            moveRecord = { type: 'timeout' };
          } else if (!result) {
            return json({ room: await fetchRoom(), changed: false });
          }
        }
      }
    } catch (error) {
      if (error instanceof GameError) return json({ error: error.message, code: error.code }, 400);
      console.error('[game-engine]', error);
      return json({ error: 'Game engine error' }, 500);
    }
    return { result, moveRecord, newStatus };
  };

  let current = room;
  let result: StepResult<unknown> | null = null;
  let moveRecord: Record<string, unknown> | null = null;
  for (let attempt = 0; ; attempt++) {
    const outcome = await compute(current);
    if (outcome instanceof Response) return outcome;
    if (!outcome.result) return json({ room: await fetchRoom(), changed: false });
    const patch: Record<string, unknown> = {
      state: outcome.result.state,
      version: current.version + 1,
      status: outcome.newStatus,
      current_turn_user_id: outcome.result.turnUser,
      turn_deadline: outcome.result.deadline ? new Date(outcome.result.deadline).toISOString() : null,
      round: outcome.result.round,
      updated_at: nowIso,
    };
    if (action === 'start') patch.started_at = nowIso;
    const { data: updated } = await admin.from('game_rooms').update(patch).eq('id', roomId).eq('version', current.version).select('id').maybeSingle();
    if (updated) {
      result = outcome.result;
      moveRecord = outcome.moveRecord;
      break;
    }
    // Someone else changed the room between our read and our write.
    if (!concurrentMove || attempt >= 2) return json({ error: 'The game moved on — refreshing.', code: 'STALE', room: await fetchRoom() }, 409);
    const { data: fresh } = await admin.from('game_rooms').select('*').eq('id', roomId).maybeSingle();
    if (!fresh) return json({ error: 'Room not found' }, 404);
    current = fresh;
  }

  if (moveRecord) {
    const { data: last } = await admin.from('game_moves').select('seq').eq('room_id', roomId).order('seq', { ascending: false }).limit(1).maybeSingle();
    await admin.from('game_moves').insert({ room_id: roomId, user_id: userId, seq: (last?.seq ?? 0) + 1, move: { ...moveRecord, events: result.events } });
  }
  if (result.finished) {
    const { error } = await admin.rpc('apply_game_results', { p_room: roomId, p_results: result.finished });
    if (error) console.error('[game-engine] apply_game_results', error);
  }
  return json({ room: await fetchRoom(), events: result.events, changed: true });
});
