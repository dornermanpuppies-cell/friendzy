-- Tests for 20261125000008_games.sql
do $t$
declare
  alice uuid; bob uuid; carol uuid; dave uuid; v_room jsonb; v_room2 jsonb; v_id uuid; v_code text; v_json jsonb; v_lobby jsonb;
begin
  alice := tests.create_user('alice@games.test', '{"display_name":"Alice","username":"alice","birth_date":"1998-01-01"}');
  bob   := tests.create_user('bob@games.test',   '{"display_name":"Bob","username":"bob","birth_date":"1997-01-01"}');
  carol := tests.create_user('carol@games.test', '{"display_name":"Carol","username":"carol","birth_date":"1996-01-01"}');
  dave  := tests.create_user('dave@games.test',  '{"display_name":"Dave","username":"dave","birth_date":"1995-01-01"}');

  -- Catalogue & content banks
  perform tests.as_user(alice);
  perform tests.assert((select count(*) from public.games) = 6, 'six games in catalogue');
  perform tests.assert_raises($$select count(*) from public.trivia_questions$$, 'trivia answer keys hidden from clients', 'permission denied');
  perform tests.assert_raises($$select count(*) from public.party_prompts$$, 'party prompts hidden from clients', 'permission denied');
  perform tests.as_service();
  perform tests.assert((select count(*) from public.trivia_questions) = 40 and (select count(*) from public.party_prompts) = 40, 'content banks seeded');

  -- Create a public room
  perform tests.as_user(alice);
  v_room := public.create_game_room('trivia', false, 4);
  v_id := (v_room->>'id')::uuid; v_code := v_room->>'invite_code';
  perform tests.assert(v_room->>'status' = 'waiting' and (v_room->>'max_players')::int = 4 and (v_room->>'is_host')::boolean and length(v_code) = 6, 'room created with code');
  perform tests.assert(jsonb_array_length(v_room->'participants') = 1 and (v_room->>'my_seat')::int = 0, 'host seated');
  perform tests.assert_raises($$select public.create_game_room('chess')$$, 'one active game per player', 'ALREADY_IN_GAME');
  perform tests.assert_raises($$select public.create_game_room('poker')$$, 'unknown game rejected', 'GAME_NOT_FOUND');
  perform tests.assert_raises(format($$update public.game_rooms set status = 'finished' where id = '%s'$$, v_id), 'clients cannot write room state', 'permission denied');
  perform tests.assert_raises(format($$insert into public.game_moves (room_id, user_id, seq, move) values ('%s', auth.uid(), 1, '{}')$$, v_id), 'clients cannot write moves directly', 'permission denied');

  -- Lobby & joining
  perform tests.as_user(bob);
  v_lobby := public.list_game_rooms();
  perform tests.assert(jsonb_array_length(v_lobby->'open') = 1 and jsonb_array_length(v_lobby->'games') = 6, 'open room listed in lobby');
  perform tests.assert((v_lobby->'open'->0->>'invite_code') is null, 'invite code hidden from non-members');
  v_json := public.join_game_room(v_id);
  perform tests.assert((v_json->>'my_seat')::int = 1 and jsonb_array_length(v_json->'participants') = 2 and v_json->>'invite_code' = v_code, 'bob joined seat 1 and sees code');
  perform tests.assert((public.join_game_room(v_id)->>'my_seat')::int = 1, 'joining twice is idempotent');
  perform tests.as_user(carol);
  perform tests.assert((public.join_game_room(null, lower(v_code))->>'my_seat')::int = 2, 'join by code (case-insensitive)');
  perform tests.assert_raises($$select public.join_game_room(null, 'NOPE00')$$, 'bad code rejected', 'ROOM_NOT_FOUND');

  -- Ready state & chat
  perform tests.as_user(bob);
  v_json := public.set_game_ready(v_id, true);
  perform tests.assert((v_json->'participants'->1->>'is_ready')::boolean, 'ready flag set');
  v_json := public.send_game_message(v_id, 'gl hf');
  perform tests.assert(v_json->'user'->>'username' = 'bob', 'room chat message');
  perform tests.assert((select count(*) from public.get_game_messages(v_id)) = 1, 'room chat readable by members');
  perform tests.as_user(dave);
  perform tests.assert((select count(*) from public.get_game_messages(v_id)) = 0, 'room chat hidden from non-members');
  perform tests.assert_raises(format($$select public.send_game_message('%s', 'hi')$$, v_id), 'non-members cannot chat', 'ROOM_NOT_FOUND');

  -- Leaving: seat reuse & host handover
  perform tests.as_user(carol);
  perform public.leave_game_room(v_id);
  perform tests.as_user(dave);
  perform tests.assert((public.join_game_room(v_id)->>'my_seat')::int = 2, 'freed seat reused');
  perform tests.as_user(alice);
  perform public.leave_game_room(v_id);
  perform tests.as_user(bob);
  v_json := public.get_game_room(v_id);
  perform tests.assert(v_json->'host'->>'username' = 'bob' and (v_json->>'is_host')::boolean, 'host handed over to next player');
  perform tests.as_user(alice);
  perform tests.assert((public.join_game_room(v_id)->>'my_seat')::int = 0, 'returning player gets a free seat');

  -- Private rooms & invites
  perform tests.as_user(carol);
  v_room2 := public.create_game_room('chess', true);
  perform tests.as_user(dave);
  perform public.leave_game_room(v_id);
  perform tests.assert(public.get_game_room((v_room2->>'id')::uuid) is null, 'private room invisible to strangers');
  perform tests.assert((select count(*) from public.game_rooms where id = (v_room2->>'id')::uuid) = 0, 'private room hidden by RLS');
  perform tests.assert_raises(format($$select public.join_game_room('%s')$$, v_room2->>'id'), 'private room needs invite', 'PRIVATE_ROOM');
  perform tests.as_user(carol);
  perform public.invite_to_game((v_room2->>'id')::uuid, dave);
  perform tests.as_user(dave);
  v_lobby := public.list_game_rooms();
  perform tests.assert(jsonb_array_length(v_lobby->'invites') = 1 and jsonb_array_length(v_lobby->'open') = 1, 'invite shown; private room not in open list');
  perform tests.assert(exists (select 1 from public.notifications where user_id = auth.uid() and type = 'game_invite'), 'invite notification delivered');
  perform tests.assert((public.join_game_room((v_room2->>'id')::uuid)->>'my_state') = 'joined', 'invited player can join private room');
  perform tests.as_user(bob);
  perform tests.assert_raises(format($$select public.join_game_room(null, '%s')$$, v_room2->>'invite_code'), 'cannot join a second game while in one', 'ALREADY_IN_GAME');
  perform public.leave_game_room(v_id);
  perform tests.assert_raises(format($$select public.join_game_room(null, '%s')$$, v_room2->>'invite_code'), 'full room rejects extra players', 'ROOM_FULL');

  -- Engine: results, ratings, leaderboard, history, rematch
  perform tests.as_user(carol);
  perform tests.assert_raises(format($$select public.apply_game_results('%s', '[]'::jsonb)$$, v_room2->>'id'), 'clients cannot apply results', 'permission denied');
  perform tests.as_service();
  update public.game_rooms set status = 'playing', started_at = clock_timestamp(), state = '{"fen":"start","secret":{"hidden":true}}'::jsonb where id = (v_room2->>'id')::uuid;
  perform public.apply_game_results((v_room2->>'id')::uuid, jsonb_build_array(jsonb_build_object('user_id', dave, 'rank', 1, 'score', 1), jsonb_build_object('user_id', carol, 'rank', 2, 'score', 0)));
  perform tests.as_user(carol);
  v_json := public.get_game_room((v_room2->>'id')::uuid);
  perform tests.assert(v_json->>'status' = 'finished' and v_json->>'winner_id' = dave::text and jsonb_array_length(v_json->'results') = 2, 'results recorded');
  perform tests.assert((v_json->'state'->'secret') is null and v_json->'state'->>'fen' = 'start', 'secret state stripped from clients');
  v_json := public.get_leaderboard('chess');
  perform tests.assert(v_json->'top'->0->'user'->>'username' = 'dave' and (v_json->'top'->0->>'rating')::int = 1025 and (v_json->'me'->>'rating')::int = 985, 'ratings updated and ranked');
  perform tests.assert((select count(*) from public.get_my_game_history()) = 1, 'history lists finished games');
  v_json := public.create_rematch((v_room2->>'id')::uuid);
  perform tests.assert(v_json->>'rematch_of' = v_room2->>'id' and v_json->>'status' = 'waiting', 'rematch room created');
  perform tests.as_user(dave);
  perform tests.assert((public.create_rematch((v_room2->>'id')::uuid)->>'id') = v_json->>'id', 'second player joins the same rematch room');
  perform tests.assert((public.get_game_room((v_json->>'id')::uuid)->>'my_state') = 'joined', 'rematch invite accepted');

  raise notice 'games tests passed';
end $t$;
