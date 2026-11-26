-- Tests for 20261125000016_calls_games_reliability.sql
do $t$
declare
  alice uuid; bob uuid; carol uuid;
  v_dm uuid; v_call jsonb; v_call2 jsonb; v_room jsonb; v_room2 jsonb; v_lobby jsonb; v_json jsonb; v_n integer;
begin
  alice := tests.create_user('alice@reliability.test', '{"display_name":"Alice","username":"alice","birth_date":"1998-01-01"}');
  bob   := tests.create_user('bob@reliability.test',   '{"display_name":"Bob","username":"bob","birth_date":"1997-01-01"}');
  carol := tests.create_user('carol@reliability.test', '{"display_name":"Carol","username":"carol","birth_date":"1996-01-01"}');

  perform tests.assert(not has_function_privilege('authenticated', 'public.expire_stale_calls(uuid)', 'execute'), 'call expiry is internal');
  perform tests.assert(not has_function_privilege('authenticated', 'public.expire_game_rooms()', 'execute'), 'room expiry is internal');
  perform tests.assert(has_function_privilege('authenticated', 'public.get_ringing_call()', 'execute'), 'clients can read their ringing call');

  -- -------------------------------------------------------------------------
  -- Calls: unanswered rings expire into missed calls and a new call rings again
  -- -------------------------------------------------------------------------
  perform tests.as_user(alice);
  v_dm := public.start_direct_conversation(bob);
  perform tests.as_user(bob);
  perform tests.send_plain(v_dm, 'text', 'hey');  -- bob is an active member either way; keeps the DM out of "requests"
  perform tests.as_user(alice);
  v_call := public.start_call(v_dm, 'voice');
  perform tests.assert((v_call->>'status') = 'ringing' and (v_call->>'is_initiator')::boolean, 'call rings');

  perform tests.as_user(bob);
  v_json := public.get_ringing_call();
  perform tests.assert((v_json->>'id') = (v_call->>'id') and (v_json->>'my_state') = 'invited', 'callee sees the ringing call on open');

  -- Nobody answered for two minutes.
  perform tests.as_admin_db();
  update public.calls set created_at = clock_timestamp() - interval '2 minutes' where id = (v_call->>'id')::uuid;

  perform tests.as_user(bob);
  perform tests.assert(public.get_ringing_call() is null, 'expired rings are not offered any more');
  v_json := public.answer_call((v_call->>'id')::uuid);
  perform tests.assert((v_json->>'status') = 'missed', 'answering an expired ring returns it as missed');
  perform tests.assert((select status from public.calls where id = (v_call->>'id')::uuid) = 'missed', 'answering an expired ring marks it missed');
  perform tests.assert_raises(format($$select public.answer_call('%s')$$, v_call->>'id'), 'a finished call cannot be answered', 'CALL_OVER');
  perform tests.assert(exists (select 1 from public.notifications where user_id = bob and type = 'missed_call' and entity_id = (v_call->>'id')), 'callee got a missed-call notification');

  perform tests.as_user(alice);
  v_call2 := public.start_call(v_dm, 'voice');
  perform tests.assert((v_call2->>'id') <> (v_call->>'id') and (v_call2->>'status') = 'ringing', 'a new call starts after the expired one');

  -- Both apps crash mid-call: the caller is still "joined" in an active call → calling again re-rings instead of parking in the dead room.
  perform tests.as_user(bob);
  perform public.answer_call((v_call2->>'id')::uuid);
  perform tests.assert((select status from public.calls where id = (v_call2->>'id')::uuid) = 'active', 'second call is active');
  perform tests.as_user(alice);
  v_json := public.start_call(v_dm, 'video');
  perform tests.assert((v_json->>'id') <> (v_call2->>'id') and (v_json->>'status') = 'ringing' and (v_json->>'kind') = 'video', 'calling again from a dead call starts a fresh ring');
  perform tests.assert((select status::text || ':' || coalesce(ended_reason, '') from public.calls where id = (v_call2->>'id')::uuid) = 'ended:abandoned', 'the dead call is closed as abandoned');
  perform tests.assert((select count(*) from public.messages where conversation_id = v_dm and kind = 'call') = 2, 'timeline shows the missed and the abandoned call');

  -- The invited side joins the ongoing call instead of starting a parallel one.
  perform tests.as_user(bob);
  v_call := public.start_call(v_dm, 'voice');
  perform tests.assert((v_call->>'id') = (v_json->>'id'), 'callee calling back joins the ringing call');

  -- Expiry helper sweeps everything that is stale.
  perform tests.as_admin_db();
  update public.calls set created_at = clock_timestamp() - interval '5 minutes' where id = (v_json->>'id')::uuid;
  v_n := public.expire_stale_calls();
  perform tests.assert(v_n = 1 and (select status from public.calls where id = (v_json->>'id')::uuid) = 'missed', 'sweep expires the stale ring');
  perform tests.assert(public.expire_stale_calls() = 0, 'sweep is idempotent');

  -- -------------------------------------------------------------------------
  -- Games: honest availability
  -- -------------------------------------------------------------------------
  perform tests.as_user(alice);
  v_lobby := public.list_game_rooms();
  perform tests.assert((select bool_and(g ? 'playable') from jsonb_array_elements(v_lobby->'games') g), 'every game reports playable');
  perform tests.assert((select (g->>'playable')::boolean from jsonb_array_elements(v_lobby->'games') g where g->>'slug' = 'trivia'), 'trivia is playable with the seeded questions');
  perform tests.assert(not (select (g->>'playable')::boolean from jsonb_array_elements(v_lobby->'games') g where g->>'slug' = 'guess_the_song')
                       and (select g->>'reason' from jsonb_array_elements(v_lobby->'games') g where g->>'slug' = 'guess_the_song') like 'Needs at least 4 sounds%', 'guess the song is unavailable without sounds and says why');
  perform tests.assert_raises($$select public.create_game_room('guess_the_song')$$, 'unavailable games cannot be created', 'GAME_UNAVAILABLE');

  -- -------------------------------------------------------------------------
  -- Games: abandoned rooms never block players
  -- -------------------------------------------------------------------------
  v_room := public.create_game_room('trivia', false, 4);
  perform tests.assert_raises($$select public.create_game_room('chess')$$, 'cannot host two rooms at once', 'ALREADY_IN_GAME');
  perform tests.as_admin_db();
  update public.game_rooms set updated_at = clock_timestamp() - interval '3 hours' where id = (v_room->>'id')::uuid;
  perform tests.as_user(alice);
  v_room2 := public.create_game_room('chess');
  perform tests.assert((v_room2->>'game') = 'chess', 'an idle room is cancelled automatically so a new one can be created');
  perform tests.assert((select status from public.game_rooms where id = (v_room->>'id')::uuid) = 'cancelled', 'idle room cancelled');

  -- A running game whose clock ran out long ago is treated as abandoned.
  perform tests.as_admin_db();
  update public.game_rooms set status = 'playing', turn_deadline = clock_timestamp() - interval '1 hour', updated_at = clock_timestamp() - interval '1 hour' where id = (v_room2->>'id')::uuid;
  perform tests.as_user(bob);
  v_json := public.create_game_room('ludo');
  perform tests.as_user(alice);
  v_json := public.join_game_room((v_json->>'id')::uuid);
  perform tests.assert((v_json->>'my_state') = 'joined', 'player can join a new room once the abandoned game was swept');
  perform tests.assert((select status from public.game_rooms where id = (v_room2->>'id')::uuid) = 'cancelled', 'abandoned running game cancelled');

  raise notice 'calls & games reliability tests passed';
end $t$;
