-- ============================================================================
-- Friendzy — Phase 4: voice & video calls (LiveKit)
-- Call records, participants, ringing / answer / decline / leave lifecycle,
-- call history and call messages in the conversation timeline. Media itself
-- flows through LiveKit; tokens are minted only by the livekit-token Edge
-- Function after checking these tables.
-- ============================================================================

do $do$ begin
  create type public.call_kind as enum ('voice', 'video');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.call_status as enum ('ringing', 'active', 'ended', 'missed', 'declined', 'cancelled');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.call_participant_state as enum ('invited', 'joined', 'left', 'declined', 'missed');
exception when duplicate_object then null; end $do$;

create table if not exists public.calls (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  initiator_id    uuid references public.profiles (id) on delete set null,
  kind            public.call_kind not null default 'voice',
  status          public.call_status not null default 'ringing',
  room_name       text unique,
  started_at      timestamptz,
  ended_at        timestamptz,
  ended_reason    text,
  created_at      timestamptz not null default clock_timestamp()
);
create index if not exists calls_conversation_idx on public.calls (conversation_id, created_at desc);
create index if not exists calls_ringing_idx on public.calls (created_at) where status = 'ringing';
revoke all on public.calls from anon, authenticated;
grant select on public.calls to authenticated;

create table if not exists public.call_participants (
  call_id    uuid not null references public.calls (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  state      public.call_participant_state not null default 'invited',
  invited_at timestamptz not null default clock_timestamp(),
  joined_at  timestamptz,
  left_at    timestamptz,
  primary key (call_id, user_id)
);
create index if not exists call_participants_user_idx on public.call_participants (user_id, invited_at desc);
revoke all on public.call_participants from anon, authenticated;
grant select on public.call_participants to authenticated;

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------
create or replace function public.is_call_participant(p_call uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.call_participants cp where cp.call_id = p_call and cp.user_id = p_user)
$$;

create or replace function public.call_json(c public.calls)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id,
    'conversation_id', c.conversation_id,
    'kind', c.kind,
    'status', c.status,
    'room_name', c.room_name,
    'started_at', c.started_at,
    'ended_at', c.ended_at,
    'ended_reason', c.ended_reason,
    'created_at', c.created_at,
    'initiator', case when c.initiator_id is null then null else public.profile_card_json(c.initiator_id) end,
    'is_initiator', c.initiator_id = auth.uid(),
    'conversation', (select jsonb_build_object('id', cv.id, 'kind', cv.kind,
        'title', case when cv.kind = 'group' then cv.title else (select p.display_name from public.conversation_members m join public.profiles p on p.id = m.user_id where m.conversation_id = cv.id and m.user_id <> auth.uid() limit 1) end,
        'avatar_url', case when cv.kind = 'group' then cv.avatar_url else (select p.avatar_url from public.conversation_members m join public.profiles p on p.id = m.user_id where m.conversation_id = cv.id and m.user_id <> auth.uid() limit 1) end)
      from public.conversations cv where cv.id = c.conversation_id),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('user', public.profile_card_json(cp.user_id), 'state', cp.state, 'joined_at', cp.joined_at, 'left_at', cp.left_at) order by cp.invited_at)
                              from public.call_participants cp where cp.call_id = c.id), '[]'::jsonb),
    'my_state', (select cp.state from public.call_participants cp where cp.call_id = c.id and cp.user_id = auth.uid())
  )
$$;

create or replace function public.finish_call(p_call uuid, p_status public.call_status, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_call public.calls; v_msg public.messages; v_outcome text; v_duration integer;
begin
  select * into v_call from public.calls where id = p_call for update;
  if v_call.status in ('ended', 'missed', 'declined', 'cancelled') then return; end if;
  update public.calls set status = p_status, ended_at = clock_timestamp(), ended_reason = p_reason where id = p_call;
  update public.call_participants set state = 'missed' where call_id = p_call and state = 'invited';
  update public.call_participants set state = 'left', left_at = coalesce(left_at, clock_timestamp()) where call_id = p_call and state = 'joined';
  v_outcome := case p_status when 'ended' then 'answered' when 'declined' then 'declined' when 'cancelled' then 'missed' when 'missed' then 'missed' else 'missed' end;
  v_duration := case when v_call.started_at is not null then greatest(0, extract(epoch from (clock_timestamp() - v_call.started_at))::int) else 0 end;
  -- Timeline entry in the conversation.
  insert into public.messages (conversation_id, sender_id, kind, text, metadata)
  values (v_call.conversation_id, v_call.initiator_id, 'call', null,
          jsonb_build_object('call_id', v_call.id, 'call_kind', v_call.kind, 'outcome', v_outcome, 'duration_seconds', v_duration))
  returning * into v_msg;
  perform public.touch_conversation(v_call.conversation_id, v_msg);
  -- Missed-call notifications for everyone who never picked up.
  if v_outcome = 'missed' then
    insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, data)
    select cp.user_id, v_call.initiator_id, 'missed_call', 'call', v_call.id::text,
           jsonb_build_object('kind', v_call.kind, 'conversation_id', v_call.conversation_id)
    from public.call_participants cp
    join public.notification_preferences np on np.user_id = cp.user_id
    where cp.call_id = p_call and cp.state = 'missed' and cp.user_id <> v_call.initiator_id and np.calls
      and not public.is_blocked_either(cp.user_id, v_call.initiator_id);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- RPCs
-- ----------------------------------------------------------------------------
create or replace function public.start_call(p_conversation uuid, p_kind public.call_kind default 'voice')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_conv public.conversations; v_call public.calls; v_other uuid; v_active uuid;
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
  select id into v_active from public.calls where conversation_id = p_conversation and status in ('ringing', 'active') limit 1;
  if v_active is not null then
    -- Join the ongoing call instead of starting a parallel one.
    return public.call_json((select c from public.calls c where c.id = v_active));
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
  if v_call.status not in ('ringing', 'active') then raise exception 'CALL_OVER' using errcode = 'P0001', hint = 'This call has already ended.'; end if;
  update public.call_participants set state = 'joined', joined_at = coalesce(joined_at, clock_timestamp()), left_at = null where call_id = p_call and user_id = auth.uid();
  if v_call.status = 'ringing' then
    update public.calls set status = 'active', started_at = clock_timestamp() where id = p_call;
  end if;
  return public.call_json((select c from public.calls c where c.id = p_call));
end $$;

create or replace function public.decline_call(p_call uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_call public.calls; v_remaining integer;
begin
  select * into v_call from public.calls where id = p_call for update;
  if v_call.id is null or not public.is_call_participant(p_call) then raise exception 'CALL_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.call_participants set state = 'declined', left_at = clock_timestamp() where call_id = p_call and user_id = auth.uid() and state in ('invited', 'joined');
  select count(*) into v_remaining from public.call_participants where call_id = p_call and user_id <> v_call.initiator_id and state in ('invited', 'joined');
  if v_remaining = 0 and v_call.status = 'ringing' then
    perform public.finish_call(p_call, 'declined', 'declined');
  end if;
end $$;

create or replace function public.leave_call(p_call uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_call public.calls; v_joined integer; v_pending integer;
begin
  select * into v_call from public.calls where id = p_call for update;
  if v_call.id is null or not public.is_call_participant(p_call) then raise exception 'CALL_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_call.status in ('ended', 'missed', 'declined', 'cancelled') then return; end if;
  update public.call_participants set state = 'left', left_at = clock_timestamp() where call_id = p_call and user_id = auth.uid() and state = 'joined';
  select count(*) into v_joined from public.call_participants where call_id = p_call and state = 'joined';
  select count(*) into v_pending from public.call_participants where call_id = p_call and state = 'invited';
  if v_call.status = 'ringing' then
    if auth.uid() = v_call.initiator_id or v_joined = 0 then
      perform public.finish_call(p_call, 'cancelled', coalesce(p_reason, 'cancelled'));
    end if;
  elsif v_joined <= 1 and v_pending = 0 then
    -- Last person (or last pair member) hung up.
    if v_joined = 0 or (select kind from public.conversations where id = v_call.conversation_id) = 'direct' then
      perform public.finish_call(p_call, 'ended', coalesce(p_reason, 'hangup'));
    end if;
  elsif v_joined = 0 then
    perform public.finish_call(p_call, 'ended', coalesce(p_reason, 'hangup'));
  end if;
end $$;

create or replace function public.get_call(p_call uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.call_json(c) from public.calls c where c.id = p_call and public.is_call_participant(p_call)
$$;

create or replace function public.get_active_call(p_conversation uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.call_json(c) from public.calls c
  where c.conversation_id = p_conversation and c.status in ('ringing', 'active') and public.is_call_participant(c.id)
  order by c.created_at desc limit 1
$$;

create or replace function public.get_call_history(p_limit integer default 30, p_before timestamptz default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.call_json(c) || jsonb_build_object(
      'direction', case when c.initiator_id = auth.uid() then 'outgoing' else 'incoming' end,
      'outcome', case
        when c.status = 'ended' then 'answered'
        when c.status = 'declined' then 'declined'
        when c.initiator_id = auth.uid() then 'no_answer'
        else 'missed' end,
      'duration_seconds', case when c.started_at is not null and c.ended_at is not null then extract(epoch from (c.ended_at - c.started_at))::int else 0 end)
  from public.calls c
  join public.call_participants cp on cp.call_id = c.id and cp.user_id = auth.uid()
  where c.status in ('ended', 'missed', 'declined', 'cancelled')
    and (p_before is null or c.created_at < p_before)
  order by c.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100))
$$;

-- Housekeeping: calls nobody answered within 60 seconds (run from cron / admin).
create or replace function public.expire_ringing_calls()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_n integer := 0;
begin
  for r in select id from public.calls where status = 'ringing' and created_at < clock_timestamp() - interval '60 seconds' loop
    perform public.finish_call(r.id, 'missed', 'timeout');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ----------------------------------------------------------------------------
-- Privileges, RLS, realtime
-- ----------------------------------------------------------------------------
do $do$
declare f text;
begin
  foreach f in array array[
    'public.is_call_participant(uuid, uuid)', 'public.call_json(public.calls)', 'public.start_call(uuid, public.call_kind)', 'public.answer_call(uuid)',
    'public.decline_call(uuid)', 'public.leave_call(uuid, text)', 'public.get_call(uuid)', 'public.get_active_call(uuid)', 'public.get_call_history(integer, timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['public.finish_call(uuid, public.call_status, text)', 'public.expire_ringing_calls()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $do$;

alter table public.calls enable row level security;
alter table public.call_participants enable row level security;

drop policy if exists "calls_select_participant" on public.calls;
create policy "calls_select_participant" on public.calls for select to authenticated using (public.is_call_participant(id) or public.is_admin());

drop policy if exists "call_participants_select" on public.call_participants;
create policy "call_participants_select" on public.call_participants for select to authenticated using (user_id = auth.uid() or public.is_call_participant(call_id) or public.is_admin());

do $do$
declare t text;
begin
  foreach t in array array['calls', 'call_participants'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $do$;
alter table public.calls replica identity full;
alter table public.call_participants replica identity full;
