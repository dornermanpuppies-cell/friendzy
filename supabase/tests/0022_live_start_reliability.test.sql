-- Tests for 20261125000022_live_start_reliability.sql
do $t$
declare host uuid; other uuid; v_live uuid; v_json jsonb; v_cleaned integer;
begin
  host  := tests.create_user('host@livestart.test',  '{"display_name":"Host","username":"livestarthost","birth_date":"1991-04-04"}');
  other := tests.create_user('other@livestart.test', '{"display_name":"Other","username":"livestartother","birth_date":"1990-04-04"}');

  -- Going live, and going live again, both answer with a running broadcast.
  perform tests.as_user(host);
  v_live := (public.create_live('Start reliability', 'chat', null, 'public', null, true, true, 'everyone')->>'id')::uuid;
  v_json := public.start_live(v_live);
  perform tests.assert(v_json->>'status' = 'live', 'the host can go live');
  perform tests.assert((select started_at is not null from public.live_sessions where id = v_live), 'the start time is recorded');
  v_json := public.start_live(v_live);
  perform tests.assert(v_json->>'status' = 'live', 'starting an already running broadcast is harmless');
  perform tests.assert((select count(*) from public.live_comments where live_id = v_live and kind = 'system' and text = 'went live') = 1, 'the room is told once, not twice');

  -- Nobody else can start or end someone"s broadcast.
  perform tests.as_user(other);
  perform tests.assert_raises(format($$select public.start_live('%s')$$, v_live), 'only the host starts the broadcast', 'FORBIDDEN');
  perform tests.assert_raises(format($$select public.end_live('%s')$$, v_live), 'only the host ends the broadcast', 'FORBIDDEN');

  -- A heartbeat still reports the state.
  perform public.join_live(v_live);
  v_json := public.live_heartbeat(v_live);
  perform tests.assert(v_json->>'status' = 'live', 'a heartbeat reports the broadcast state');

  -- Ending, and ending again.
  perform tests.as_user(host);
  v_json := public.end_live(v_live);
  perform tests.assert(v_json->>'status' = 'ended', 'the host can end the broadcast');
  v_json := public.end_live(v_live);
  perform tests.assert(v_json->>'status' = 'ended', 'ending an ended broadcast is harmless');
  perform tests.assert_raises(format($$select public.start_live('%s')$$, v_live), 'an ended broadcast cannot be restarted', 'LIVE_OVER');

  -- A preview the host abandoned is cleared, so they are not locked out of opening another one.
  v_live := (public.create_live('Abandoned preview', 'chat', null, 'public', null, true, true, 'everyone')->>'id')::uuid;
  perform tests.assert((select status::text from public.live_sessions where id = v_live) = 'preparing', 'a new broadcast starts as a preview');
  perform tests.assert_raises($$select public.create_live('Second one', 'chat', null, 'public', null, true, true, 'everyone')$$, 'only one broadcast at a time', 'ALREADY_LIVE');

  perform tests.as_admin_db();
  update public.live_sessions set created_at = clock_timestamp() - interval '30 minutes', host_last_seen_at = clock_timestamp() - interval '30 minutes' where id = v_live;
  v_cleaned := public.cleanup_lives();
  perform tests.assert(v_cleaned >= 1, 'cleanup reports what it closed');
  perform tests.assert((select status::text from public.live_sessions where id = v_live) = 'cancelled', 'an abandoned preview is cancelled');

  perform tests.as_user(host);
  v_live := (public.create_live('Back in business', 'chat', null, 'public', null, true, true, 'everyone')->>'id')::uuid;
  perform tests.assert(v_live is not null, 'the host can open a new broadcast once the stale one is cleared');

  -- A fresh preview is left alone by cleanup.
  perform tests.as_admin_db();
  perform public.cleanup_lives();
  perform tests.assert((select status::text from public.live_sessions where id = v_live) = 'preparing', 'cleanup leaves a fresh preview alone');
end $t$;
