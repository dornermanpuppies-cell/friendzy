-- =============================================================================
-- Friendzy — 0016: calls & games reliability
-- =============================================================================
-- Calls
--   * expire_stale_calls(): rings older than 60 s become "missed" (the callee gets
--     the missed-call notification), active calls nobody is in any more end.
--   * start_call(): a caller who is still marked "joined" in an old call (the app
--     crashed or was closed mid-call) gets a fresh call instead of being parked in
--     a dead room where the other side is never rung again.
--   * answer_call(): answering an expired ring closes it as missed and returns it.
--   * get_ringing_call(): lets the app show the incoming banner when it opens
--     (or returns to the foreground) while a call is already ringing.
-- Games
--   * game_content_status(): a game is only offered when its content bank is big
--     enough (Guess the Song needs 4 sounds, the others 3 prompts/questions).
--     list_game_rooms() reports `playable` + `reason`; create_game_room() refuses
--     unavailable games with GAME_UNAVAILABLE instead of failing at start.
--   * expire_game_rooms(): idle waiting rooms (2 h) and abandoned running games
--     (turn deadline passed 30 min ago) are cancelled so players are never stuck
--     behind ALREADY_IN_GAME; runs lazily from create/join and from pg_cron.
-- pg_cron (when the extension is installed) runs the housekeeping every minute.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Calls
-- ----------------------------------------------------------------------------
create or replace function public.expire_stale_calls(p_conversation uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_n integer := 0;
begin
  for r in select id from public.calls
           where status = 'ringing' and created_at < clock_timestamp() - interval '60 seconds'
             and (p_conversation is null or conversation_id = p_conversation) loop
    perform public.finish_call(r.id, 'missed', 'timeout');
    v_n := v_n + 1;
  end loop;
  for r in select c.id from public.calls c
           where c.status = 'active' and (p_conversation is null or c.conversation_id = p_conversation)
             and (not exists (select 1 from public.call_participants cp where cp.call_id = c.id and cp.state = 'joined')
                  or c.started_at < clock_timestamp() - interval '12 hours') loop
    perform public.finish_call(r.id, 'ended', 'abandoned');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.start_call(p_conversation uuid, p_kind public.call_kind default 'voice')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_conv public.conversations; v_call public.calls; v_other uuid; v_active public.calls; v_my_state public.call_participant_state;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into v_conv from public.conversations where id = p_conversation;
  if v_conv.id is null or not exists (select 1 from public.conversation_members m where m.conversation_id = p_conversation and m.user_id = v_me and m.state = 'active') then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_conv.kind = 'direct' then
    select user_id into v_other from public.conversation_members where conversation_id = p_conversation and user_id <> v_me;
    if public.is_blocked_either(v_me, v_other) then raise exception 'BLOCKED' using errcode = '42501', hint = 'You cannot call this person.'; end if;
    if exists (select 1 from public.conversation_members where conversation_id = p_conversation and user_id = v_other and state = 'pending') then
      raise exception 'REQUEST_PENDING' using errcode = '42501', hint = 'They need to accept your message request first.';
    end if;
  end if;

  perform public.expire_stale_calls(p_conversation);
  select * into v_active from public.calls where conversation_id = p_conversation and status in ('ringing', 'active') order by created_at desc limit 1;
  if v_active.id is not null then
    select state into v_my_state from public.call_participants where call_id = v_active.id and user_id = v_me;
    if v_my_state = 'joined' then
      -- I am supposedly already in that call: my app lost it (crash, closed tab). Start over so the others ring again.
      perform public.finish_call(v_active.id, case when v_active.status = 'ringing' then 'cancelled'::public.call_status else 'ended'::public.call_status end, 'abandoned');
    else
      -- Someone else is calling / already talking: join that call instead of starting a parallel one.
      return public.call_json(v_active);
    end if;
  end if;

  insert into public.calls (conversation_id, initiator_id, kind) values (p_conversation, v_me, p_kind) returning * into v_call;
  update public.calls set room_name = 'call_' || v_call.id::text where id = v_call.id returning * into v_call;
  insert into public.call_participants (call_id, user_id, state, joined_at) values (v_call.id, v_me, 'joined', clock_timestamp());
  insert into public.call_participants (call_id, user_id, state)
  select v_call.id, m.user_id, 'invited' from public.conversation_members m
  where m.conversation_id = p_conversation and m.user_id <> v_me and m.state = 'active' and not public.is_blocked_either(v_me, m.user_id);
  return public.call_json(v_call);
end $$;

create or replace function public.answer_call(p_call uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_call public.calls;
begin
  select * into v_call from public.calls where id = p_call for update;
  if v_call.id is null or not public.is_call_participant(p_call) then raise exception 'CALL_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_call.status = 'ringing' and v_call.created_at < clock_timestamp() - interval '60 seconds' then
    -- Too late: close it as missed and hand back the finished record (raising here would roll the expiry back).
    perform public.finish_call(p_call, 'missed', 'timeout');
    return public.call_json((select c from public.calls c where c.id = p_call));
  end if;
  if v_call.status not in ('ringing', 'active') then raise exception 'CALL_OVER' using errcode = 'P0001', hint = 'This call has already ended.'; end if;
  update public.call_participants set state = 'joined', joined_at = coalesce(joined_at, clock_timestamp()), left_at = null where call_id = p_call and user_id = auth.uid();
  if v_call.status = 'ringing' then
    update public.calls set status = 'active', started_at = clock_timestamp() where id = p_call;
  end if;
  return public.call_json((select c from public.calls c where c.id = p_call));
end $$;

-- The newest call that is ringing for me right now (shown when the app opens mid-ring).
create or replace function public.get_ringing_call()
returns jsonb language sql stable security definer set search_path = public as $$
  select public.call_json(c)
  from public.calls c
  join public.call_participants cp on cp.call_id = c.id and cp.user_id = auth.uid()
  where c.status = 'ringing' and cp.state = 'invited' and c.created_at > clock_timestamp() - interval '60 seconds'
  order by c.created_at desc
  limit 1
$$;

-- ----------------------------------------------------------------------------
-- Games: honest availability + abandoned-room cleanup
-- ----------------------------------------------------------------------------
create or replace function public.game_content_status(p_game text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_n integer; v_m integer;
begin
  if p_game = 'trivia' then
    select count(*) into v_n from public.trivia_questions where is_active;
    return case when v_n >= 3 then jsonb_build_object('playable', true, 'reason', null)
                else jsonb_build_object('playable', false, 'reason', format('Needs at least 3 trivia questions in the question bank (%s so far).', v_n)) end;
  elsif p_game = 'would_you_rather' then
    select count(*) into v_n from public.party_prompts where game = 'would_you_rather' and kind = 'wyr' and is_active;
    return case when v_n >= 3 then jsonb_build_object('playable', true, 'reason', null)
                else jsonb_build_object('playable', false, 'reason', format('Needs at least 3 prompts (%s so far).', v_n)) end;
  elsif p_game = 'truth_or_dare' then
    select count(*) filter (where kind = 'truth'), count(*) filter (where kind = 'dare') into v_n, v_m from public.party_prompts where game = 'truth_or_dare' and is_active;
    return case when v_n >= 3 and v_m >= 3 then jsonb_build_object('playable', true, 'reason', null)
                else jsonb_build_object('playable', false, 'reason', format('Needs at least 3 truths and 3 dares (%s truths, %s dares so far).', v_n, v_m)) end;
  elsif p_game = 'guess_the_song' then
    select count(*) into v_n from public.sounds where url is not null;
    return case when v_n >= 4 then jsonb_build_object('playable', true, 'reason', null)
                else jsonb_build_object('playable', false, 'reason', format('Needs at least 4 sounds in the Friendzy sound library (%s so far). Add sounds from Create → Video.', v_n)) end;
  end if;
  return jsonb_build_object('playable', true, 'reason', null);
end $$;

create index if not exists game_rooms_status_updated_idx on public.game_rooms (status, updated_at);

create or replace function public.expire_game_rooms()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer := 0; v_m integer := 0;
begin
  -- Waiting rooms nobody touched for two hours.
  with gone as (
    update public.game_rooms set status = 'cancelled', finished_at = clock_timestamp(), updated_at = clock_timestamp()
    where status = 'waiting' and updated_at < clock_timestamp() - interval '2 hours' returning id)
  select count(*) into v_n from gone;
  -- Running games where the turn clock ran out half an hour ago and nobody came back to forfeit.
  with gone as (
    update public.game_rooms set status = 'cancelled', finished_at = clock_timestamp(), updated_at = clock_timestamp()
    where status = 'playing' and turn_deadline is not null and turn_deadline < clock_timestamp() - interval '30 minutes' returning id)
  select count(*) into v_m from gone;
  return v_n + v_m;
end $$;

create or replace function public.create_game_room(p_game text, p_is_private boolean default false, p_max_players integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); g public.games; v_id uuid; v_max integer; v_status jsonb;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into g from public.games where slug = p_game and is_active;
  if not found then raise exception 'GAME_NOT_FOUND' using errcode = 'P0002'; end if;
  v_status := public.game_content_status(p_game);
  if not coalesce((v_status->>'playable')::boolean, true) then
    raise exception 'GAME_UNAVAILABLE' using errcode = 'P0001', hint = coalesce(v_status->>'reason', 'This game is not available yet.');
  end if;
  perform public.expire_game_rooms();
  if exists (select 1 from public.game_rooms r join public.game_participants p on p.room_id = r.id where p.user_id = v_me and p.state = 'joined' and r.status in ('waiting', 'playing')) then
    raise exception 'ALREADY_IN_GAME' using errcode = 'P0001', hint = 'Leave your current game before starting another.';
  end if;
  v_max := least(g.max_players, greatest(g.min_players, coalesce(p_max_players, g.max_players)));
  insert into public.game_rooms (game, host_id, is_private, invite_code, max_players) values (p_game, v_me, coalesce(p_is_private, false), public.game_invite_code(), v_max) returning id into v_id;
  insert into public.game_participants (room_id, user_id, seat, state, is_ready) values (v_id, v_me, 0, 'joined', true);
  return public.game_room_json((select r from public.game_rooms r where r.id = v_id), v_me);
end $$;

create or replace function public.join_game_room(p_room uuid default null, p_code text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); r public.game_rooms; v_seat integer; v_existing public.game_participants;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  perform public.expire_game_rooms();
  if p_room is not null then select * into r from public.game_rooms where id = p_room for update;
  elsif p_code is not null then select * into r from public.game_rooms where invite_code = upper(trim(p_code)) for update;
  end if;
  if r.id is null then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002', hint = 'That game room does not exist or the code is wrong.'; end if;
  if public.is_blocked_either(v_me, r.host_id) then raise exception 'BLOCKED' using errcode = '42501'; end if;
  select * into v_existing from public.game_participants where room_id = r.id and user_id = v_me;
  if v_existing.user_id is not null and v_existing.state = 'joined' then return public.game_room_json(r, v_me); end if;
  if r.status <> 'waiting' then
    if v_existing.user_id is not null and r.status = 'playing' then
      update public.game_participants set state = 'joined' where room_id = r.id and user_id = v_me; -- rejoin an ongoing game
      return public.game_room_json(r, v_me);
    end if;
    raise exception 'ROOM_CLOSED' using errcode = 'P0001', hint = 'This game has already started.';
  end if;
  if r.is_private and p_code is null and (v_existing.user_id is null or v_existing.state <> 'invited') then
    raise exception 'PRIVATE_ROOM' using errcode = '42501', hint = 'You need an invite or the room code.';
  end if;
  if exists (select 1 from public.game_rooms x join public.game_participants p on p.room_id = x.id where p.user_id = v_me and p.state = 'joined' and x.status in ('waiting', 'playing') and x.id <> r.id) then
    raise exception 'ALREADY_IN_GAME' using errcode = 'P0001', hint = 'Leave your current game first.';
  end if;
  if (select count(*) from public.game_participants where room_id = r.id and state = 'joined') >= r.max_players then
    raise exception 'ROOM_FULL' using errcode = 'P0001', hint = 'This room is full.';
  end if;
  select coalesce(min(s), 0) into v_seat from generate_series(0, r.max_players - 1) s where s not in (select seat from public.game_participants where room_id = r.id and state <> 'left');
  if v_existing.user_id is not null then
    update public.game_participants set state = 'joined', seat = coalesce(case when v_existing.state = 'left' then v_seat else v_existing.seat end, v_seat), is_ready = false, joined_at = clock_timestamp(), left_at = null where room_id = r.id and user_id = v_me;
  else
    insert into public.game_participants (room_id, user_id, seat, state) values (r.id, v_me, v_seat, 'joined');
  end if;
  update public.game_rooms set updated_at = clock_timestamp() where id = r.id;
  return public.game_room_json((select x from public.game_rooms x where x.id = r.id), v_me);
end $$;

create or replace function public.list_game_rooms(p_game text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'mine', coalesce((select jsonb_agg(public.game_room_json(r, auth.uid()) order by r.updated_at desc)
             from (select distinct r.* from public.game_rooms r join public.game_participants p on p.room_id = r.id where p.user_id = auth.uid() and p.state <> 'left' and r.status in ('waiting', 'playing') order by r.updated_at desc limit 10) r), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(public.game_room_json(r, auth.uid()) order by r.created_at desc)
             from (select r.* from public.game_rooms r join public.game_participants p on p.room_id = r.id where p.user_id = auth.uid() and p.state = 'invited' and r.status = 'waiting' order by r.created_at desc limit 10) r), '[]'::jsonb),
    'open', coalesce((select jsonb_agg(public.game_room_json(r, auth.uid()) order by r.created_at desc)
             from (select r.* from public.game_rooms r where r.status = 'waiting' and not r.is_private and (p_game is null or r.game = p_game)
                   and not public.is_blocked_either(auth.uid(), r.host_id) and r.created_at > now() - interval '2 hours'
                   and (select count(*) from public.game_participants p where p.room_id = r.id and p.state = 'joined') < r.max_players
                   order by r.created_at desc limit 30) r), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(jsonb_build_object('slug', g.slug, 'name', g.name, 'description', g.description, 'emoji', g.emoji, 'min_players', g.min_players, 'max_players', g.max_players, 'turn_seconds', g.turn_seconds,
                 'playing_now', (select count(*) from public.game_rooms r where r.game = g.slug and r.status = 'playing')) || public.game_content_status(g.slug) order by g.sort_order) from public.games g where g.is_active), '[]'::jsonb))
$$;

-- ----------------------------------------------------------------------------
-- Scheduled housekeeping (only when pg_cron is installed on the project)
-- ----------------------------------------------------------------------------
do $do$
declare j record;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for j in select jobid from cron.job where jobname in ('friendzy_expire_calls', 'friendzy_expire_game_rooms', 'friendzy_expire_messages') loop
      perform cron.unschedule(j.jobid);
    end loop;
    perform cron.schedule('friendzy_expire_calls', '* * * * *', 'select public.expire_stale_calls()');
    perform cron.schedule('friendzy_expire_game_rooms', '*/5 * * * *', 'select public.expire_game_rooms()');
    perform cron.schedule('friendzy_expire_messages', '*/10 * * * *', 'select public.expire_messages()');
  end if;
end $do$;

-- ----------------------------------------------------------------------------
-- Privileges
-- ----------------------------------------------------------------------------
do $do$
declare f text;
begin
  foreach f in array array[
    'public.start_call(uuid, public.call_kind)', 'public.answer_call(uuid)', 'public.get_ringing_call()',
    'public.game_content_status(text)', 'public.create_game_room(text, boolean, integer)', 'public.join_game_room(uuid, text)', 'public.list_game_rooms(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['public.expire_stale_calls(uuid)', 'public.expire_game_rooms()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $do$;
