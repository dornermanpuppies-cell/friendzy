-- ============================================================================
-- Friendzy — Phase 11: LiveKit webhooks
-- Storage + idempotent processing for LiveKit server events delivered to the
-- `livekit-webhook` Edge Function (signature verified there with the LiveKit
-- server SDK). Every event is recorded once per LiveKit event id; side effects
-- keep lives, calls and recordings (egress) in sync with the media rooms.
-- All RPCs here are service-role only — clients never touch these tables.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------
create table if not exists public.livekit_webhook_events (
  id                   text primary key,                       -- LiveKit event id (idempotency key)
  event                text not null,                          -- room_started, participant_left, egress_ended, …
  room_name            text,
  room_sid             text,
  participant_identity text,
  participant_sid      text,
  egress_id            text,
  event_at             timestamptz,                            -- createdAt reported by LiveKit
  num_dropped          integer not null default 0,             -- events LiveKit dropped before this one
  payload              jsonb not null default '{}'::jsonb,     -- full event as JSON (no secrets inside)
  attempts             integer not null default 1,             -- deliveries received for this id
  received_at          timestamptz not null default clock_timestamp(),
  last_received_at     timestamptz not null default clock_timestamp(),
  processed_at         timestamptz,                            -- null until side effects succeeded
  applied              jsonb,                                  -- list of side effects that ran
  error                text                                    -- last processing error (retried by LiveKit)
);
create index if not exists livekit_webhook_events_room_idx on public.livekit_webhook_events (room_name, received_at desc);
create index if not exists livekit_webhook_events_event_idx on public.livekit_webhook_events (event, received_at desc);
create index if not exists livekit_webhook_events_pending_idx on public.livekit_webhook_events (received_at) where processed_at is null;
revoke all on public.livekit_webhook_events from anon, authenticated;
grant select on public.livekit_webhook_events to authenticated;   -- admins only (RLS below)

create table if not exists public.livekit_egresses (
  egress_id   text primary key,
  room_name   text,
  room_sid    text,
  live_id     uuid references public.live_sessions (id) on delete set null,
  call_id     uuid references public.calls (id) on delete set null,
  kind        text not null default 'unknown',
  status      text not null default 'starting',
  started_at  timestamptz,
  ended_at    timestamptz,
  error       text,
  error_code  integer,
  results     jsonb not null default '{}'::jsonb,              -- files / streams / segments / images reported by LiveKit
  created_at  timestamptz not null default clock_timestamp(),
  updated_at  timestamptz not null default clock_timestamp(),
  constraint livekit_egresses_kind check (kind in ('room_composite', 'web', 'participant', 'track_composite', 'track', 'unknown')),
  constraint livekit_egresses_status check (status in ('starting', 'active', 'ending', 'complete', 'failed', 'aborted', 'limit_reached', 'unknown'))
);
create index if not exists livekit_egresses_live_idx on public.livekit_egresses (live_id, created_at desc);
create index if not exists livekit_egresses_call_idx on public.livekit_egresses (call_id, created_at desc);
revoke all on public.livekit_egresses from anon, authenticated;
grant select on public.livekit_egresses to authenticated;         -- host / participants / admins (RLS below)

alter table public.live_sessions add column if not exists livekit_room_sid text;
alter table public.calls add column if not exists livekit_room_sid text;

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------
create or replace function public.livekit_parse_room(p_room_name text)
returns table (scope text, target_id uuid) language sql immutable as $$
  select case when p_room_name ~* '^live_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then 'live'
              when p_room_name ~* '^call_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then 'call'
              else 'other' end,
         case when p_room_name ~* '^(live|call)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then substr(p_room_name, 6)::uuid end
$$;

-- A participant dropped out of a call (hang-up from the app or disconnect seen by LiveKit).
create or replace function public.call_mark_left(p_call uuid, p_user uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_call public.calls; v_joined integer; v_pending integer;
begin
  select * into v_call from public.calls where id = p_call for update;
  if v_call.id is null or v_call.status in ('ended', 'missed', 'declined', 'cancelled') then return; end if;
  update public.call_participants set state = 'left', left_at = clock_timestamp() where call_id = p_call and user_id = p_user and state = 'joined';
  select count(*) into v_joined from public.call_participants where call_id = p_call and state = 'joined';
  select count(*) into v_pending from public.call_participants where call_id = p_call and state = 'invited';
  if v_call.status = 'ringing' then
    if p_user = v_call.initiator_id or v_joined = 0 then
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

-- leave_call keeps its permission checks and delegates the state machine.
create or replace function public.leave_call(p_call uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_call public.calls;
begin
  select * into v_call from public.calls where id = p_call;
  if v_call.id is null or not public.is_call_participant(p_call) then raise exception 'CALL_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.call_mark_left(p_call, auth.uid(), p_reason);
end $$;

-- ----------------------------------------------------------------------------
-- Side effects for one stored event (internal; called by livekit_ingest_event)
-- ----------------------------------------------------------------------------
create or replace function public.livekit_apply_event(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e public.livekit_webhook_events; v_scope text; v_target uuid; v_user uuid; v_applied text[] := '{}';
  v_live public.live_sessions; v_call public.calls; v_eg jsonb; v_status text; v_kind text; v_egress_room text;
  v_eg_scope text; v_eg_target uuid; v_started timestamptz; v_ended timestamptz;
begin
  select * into e from public.livekit_webhook_events where id = p_id for update;
  if e.id is null then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002'; end if;

  -- Egress (recording / streaming) events carry their own room reference.
  if e.event in ('egress_started', 'egress_updated', 'egress_ended') then
    v_eg := e.payload->'egressInfo';
    if coalesce(v_eg->>'egressId', e.egress_id) is null then
      raise exception 'INVALID_EVENT' using errcode = '23514', hint = 'egress event without egressInfo';
    end if;
    v_egress_room := coalesce(v_eg->>'roomName', e.room_name);
    select scope, target_id into v_eg_scope, v_eg_target from public.livekit_parse_room(v_egress_room);
    v_status := lower(regexp_replace(coalesce(v_eg->>'status', 'EGRESS_STARTING'), '^EGRESS_', ''));
    if v_status not in ('starting', 'active', 'ending', 'complete', 'failed', 'aborted', 'limit_reached') then v_status := 'unknown'; end if;
    v_kind := case when v_eg ? 'roomComposite' then 'room_composite' when v_eg ? 'web' then 'web' when v_eg ? 'participant' then 'participant'
                   when v_eg ? 'trackComposite' then 'track_composite' when v_eg ? 'track' then 'track' else 'unknown' end;
    v_started := case when (v_eg->>'startedAt') ~ '^[0-9]+$' and (v_eg->>'startedAt')::numeric > 0 then to_timestamp((v_eg->>'startedAt')::numeric / 1e9) end;
    v_ended := case when (v_eg->>'endedAt') ~ '^[0-9]+$' and (v_eg->>'endedAt')::numeric > 0 then to_timestamp((v_eg->>'endedAt')::numeric / 1e9) end;
    insert into public.livekit_egresses as le (egress_id, room_name, room_sid, live_id, call_id, kind, status, started_at, ended_at, error, error_code, results)
    values (coalesce(v_eg->>'egressId', e.egress_id), v_egress_room, coalesce(v_eg->>'roomId', e.room_sid),
            case when v_eg_scope = 'live' then v_eg_target end, case when v_eg_scope = 'call' then v_eg_target end,
            v_kind, v_status, v_started, v_ended, nullif(v_eg->>'error', ''), nullif(v_eg->>'errorCode', '')::integer,
            jsonb_build_object('files', coalesce(v_eg->'fileResults', '[]'::jsonb), 'streams', coalesce(v_eg->'streamResults', '[]'::jsonb),
                               'segments', coalesce(v_eg->'segmentResults', '[]'::jsonb), 'images', coalesce(v_eg->'imageResults', '[]'::jsonb)))
    on conflict (egress_id) do update set
      status = excluded.status, kind = case when excluded.kind = 'unknown' then le.kind else excluded.kind end,
      started_at = coalesce(excluded.started_at, le.started_at), ended_at = coalesce(excluded.ended_at, le.ended_at),
      error = coalesce(excluded.error, le.error), error_code = coalesce(excluded.error_code, le.error_code),
      results = excluded.results, room_sid = coalesce(excluded.room_sid, le.room_sid), updated_at = clock_timestamp();
    v_applied := array_append(v_applied, 'egress.upsert');
    return to_jsonb(v_applied);
  end if;

  select scope, target_id into v_scope, v_target from public.livekit_parse_room(e.room_name);
  v_user := case when e.participant_identity ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then e.participant_identity::uuid end;

  if v_scope = 'live' then
    select * into v_live from public.live_sessions where id = v_target for update;
    if v_live.id is null then
      v_applied := array_append(v_applied, 'live.unknown');
    else
      case e.event
        when 'room_started' then
          update public.live_sessions set livekit_room_sid = coalesce(e.room_sid, livekit_room_sid), updated_at = now() where id = v_live.id;
          v_applied := array_append(v_applied, 'live.room_started');
        when 'participant_joined' then
          if v_user = v_live.host_id then
            update public.live_sessions set host_last_seen_at = clock_timestamp(), livekit_room_sid = coalesce(e.room_sid, livekit_room_sid) where id = v_live.id;
            v_applied := array_append(v_applied, 'live.host_joined');
          elsif v_user is not null then
            update public.live_participants
               set last_seen_at = clock_timestamp(),
                   state = case when state = 'left' then 'watching'::public.live_participant_state else state end,
                   left_at = case when state = 'left' then null else left_at end
             where live_id = v_live.id and user_id = v_user and state <> 'removed';
            if found then
              v_applied := array_append(v_applied, 'live.participant_seen');
              perform public.recount_live_viewers(v_live.id);
            end if;
          end if;
        when 'participant_left' then
          if v_user = v_live.host_id then
            -- The host gets the usual grace period (cleanup_lives) to reconnect; room_finished ends it sooner.
            update public.live_sessions set host_last_seen_at = clock_timestamp() where id = v_live.id;
            v_applied := array_append(v_applied, 'live.host_left');
          elsif v_user is not null then
            update public.live_participants set state = 'left', left_at = clock_timestamp()
             where live_id = v_live.id and user_id = v_user and state in ('watching', 'requested');
            if found then v_applied := array_append(v_applied, 'live.participant_left'); end if;
            perform public.recount_live_viewers(v_live.id);
          end if;
        when 'room_finished' then
          if v_live.status = 'live' then
            perform public.end_live(v_live.id);
            v_applied := array_append(v_applied, 'live.ended');
          elsif v_live.status = 'preparing' then
            update public.live_sessions set status = 'cancelled', ended_at = clock_timestamp(), viewers_count = 0, updated_at = now() where id = v_live.id;
            update public.live_participants set state = 'left', left_at = clock_timestamp() where live_id = v_live.id and state <> 'removed';
            v_applied := array_append(v_applied, 'live.cancelled');
          else
            v_applied := array_append(v_applied, 'live.already_closed');
          end if;
        else
          null;
      end case;
    end if;
  elsif v_scope = 'call' then
    select * into v_call from public.calls where id = v_target for update;
    if v_call.id is null then
      v_applied := array_append(v_applied, 'call.unknown');
    else
      case e.event
        when 'room_started' then
          update public.calls set livekit_room_sid = coalesce(e.room_sid, livekit_room_sid) where id = v_call.id;
          v_applied := array_append(v_applied, 'call.room_started');
        when 'participant_joined' then
          if v_user is not null then
            update public.calls set livekit_room_sid = coalesce(e.room_sid, livekit_room_sid) where id = v_call.id and livekit_room_sid is null;
            v_applied := array_append(v_applied, 'call.participant_joined');
          end if;
        when 'participant_left' then
          if v_user is not null and v_call.status in ('ringing', 'active') then
            perform public.call_mark_left(v_call.id, v_user, 'disconnected');
            v_applied := array_append(v_applied, 'call.participant_left');
          end if;
        when 'room_finished' then
          if v_call.status in ('ringing', 'active') then
            perform public.finish_call(v_call.id, case when v_call.status = 'ringing' then 'cancelled'::public.call_status else 'ended'::public.call_status end, 'room_finished');
            v_applied := array_append(v_applied, 'call.finished');
          else
            v_applied := array_append(v_applied, 'call.already_closed');
          end if;
        else
          null;
      end case;
    end if;
  else
    v_applied := array_append(v_applied, 'ignored');
  end if;

  if cardinality(v_applied) = 0 then v_applied := array['stored']; end if;
  return to_jsonb(v_applied);
end $$;

-- ----------------------------------------------------------------------------
-- Entry point used by the Edge Function: record once, process, remember outcome
-- ----------------------------------------------------------------------------
create or replace function public.livekit_ingest_event(
  p_id text, p_event text, p_room_name text default null, p_room_sid text default null,
  p_participant_identity text default null, p_participant_sid text default null, p_egress_id text default null,
  p_event_at timestamptz default null, p_payload jsonb default '{}'::jsonb, p_num_dropped integer default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_processed timestamptz; v_attempts integer; v_applied jsonb; v_err text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if nullif(trim(coalesce(p_id, '')), '') is null or nullif(trim(coalesce(p_event, '')), '') is null then
    raise exception 'INVALID_EVENT' using errcode = '23514', hint = 'event id and type are required';
  end if;
  insert into public.livekit_webhook_events as w (id, event, room_name, room_sid, participant_identity, participant_sid, egress_id, event_at, payload, num_dropped)
  values (left(p_id, 200), left(p_event, 60), left(p_room_name, 200), left(p_room_sid, 100), left(p_participant_identity, 200), left(p_participant_sid, 100),
          left(p_egress_id, 100), coalesce(p_event_at, clock_timestamp()), coalesce(p_payload, '{}'::jsonb), greatest(0, coalesce(p_num_dropped, 0)))
  on conflict (id) do update set
    attempts = w.attempts + 1,
    last_received_at = clock_timestamp(),
    -- A delivery for an event that has not been processed yet refreshes the stored data
    -- (LiveKit resends the identical payload on retry); processed events are left untouched.
    event = case when w.processed_at is null then excluded.event else w.event end,
    room_name = case when w.processed_at is null then excluded.room_name else w.room_name end,
    room_sid = case when w.processed_at is null then excluded.room_sid else w.room_sid end,
    participant_identity = case when w.processed_at is null then excluded.participant_identity else w.participant_identity end,
    participant_sid = case when w.processed_at is null then excluded.participant_sid else w.participant_sid end,
    egress_id = case when w.processed_at is null then excluded.egress_id else w.egress_id end,
    event_at = case when w.processed_at is null then excluded.event_at else w.event_at end,
    payload = case when w.processed_at is null then excluded.payload else w.payload end,
    num_dropped = case when w.processed_at is null then excluded.num_dropped else w.num_dropped end
  returning w.processed_at, w.attempts into v_processed, v_attempts;
  if v_processed is not null then
    return jsonb_build_object('duplicate', true, 'attempts', v_attempts);
  end if;
  begin
    v_applied := public.livekit_apply_event(left(p_id, 200));
    update public.livekit_webhook_events set processed_at = clock_timestamp(), applied = v_applied, error = null where id = left(p_id, 200);
    return jsonb_build_object('duplicate', false, 'attempts', v_attempts, 'applied', v_applied);
  exception when others then
    -- Side effects rolled back; the row stays unprocessed so LiveKit's retry can try again.
    v_err := left(sqlerrm, 500);
    update public.livekit_webhook_events set error = v_err where id = left(p_id, 200);
    return jsonb_build_object('duplicate', false, 'attempts', v_attempts, 'error', v_err);
  end;
end $$;

-- Housekeeping: drop old processed events (run from cron / admin).
create or replace function public.cleanup_livekit_events(p_keep_days integer default 30)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.livekit_webhook_events
   where processed_at is not null and received_at < clock_timestamp() - make_interval(days => greatest(0, coalesce(p_keep_days, 30)));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ----------------------------------------------------------------------------
-- Privileges & RLS
-- ----------------------------------------------------------------------------
do $do$
declare f text;
begin
  foreach f in array array[
    'public.livekit_parse_room(text)', 'public.call_mark_left(uuid, uuid, text)', 'public.livekit_apply_event(text)',
    'public.livekit_ingest_event(text, text, text, text, text, text, text, timestamptz, jsonb, integer)', 'public.cleanup_livekit_events(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  execute 'revoke all on function public.leave_call(uuid, text) from public, anon';
  execute 'grant execute on function public.leave_call(uuid, text) to authenticated, service_role';
end $do$;

alter table public.livekit_webhook_events enable row level security;
alter table public.livekit_egresses enable row level security;

drop policy if exists "livekit_events_admin_read" on public.livekit_webhook_events;
create policy "livekit_events_admin_read" on public.livekit_webhook_events for select to authenticated using (public.is_admin());

drop policy if exists "livekit_egresses_read" on public.livekit_egresses;
create policy "livekit_egresses_read" on public.livekit_egresses for select to authenticated
  using (public.is_admin()
         or (live_id is not null and exists (select 1 from public.live_sessions l where l.id = live_id and l.host_id = auth.uid()))
         or (call_id is not null and public.is_call_participant(call_id)));
