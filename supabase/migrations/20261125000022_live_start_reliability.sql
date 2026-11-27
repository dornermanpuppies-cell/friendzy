-- ============================================================================
-- 0022 — Going live must not lose a race with its own heartbeat
--
-- Symptom seen in the browser harness: tapping "Start LIVE" returned
--   57014 canceling statement due to statement timeout
-- and the broadcast sat in `preparing` for ever.
--
-- Cause: start_live() opened with `select … for update` on the live_sessions row, and that row is
-- written constantly by live_heartbeat() (host_last_seen_at, and viewers_count through
-- recount_live_viewers). While a beat held the row, the start waited, and with beats arriving from
-- the host and every viewer the queue outlived the statement timeout.
--
-- Fixes here:
--   • start_live / end_live use one guarded UPDATE … RETURNING instead of taking a lock first.
--     Same rules, same errors, no waiting.
--   • live_heartbeat gives up rather than queueing: a missed beat costs nothing, a stuck one
--     blocks the broadcast.
--   • cleanup_lives also clears broadcasts abandoned in `preparing`. Without that, a failed start
--     left the host unable to open another one at all, because create_live() refuses while a
--     session is still open.
-- ============================================================================

/** Replaces 0007: no row lock, so a heartbeat in flight cannot delay going live. */
create or replace function public.start_live(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.live_sessions;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;

  update public.live_sessions
     set status = 'live', started_at = clock_timestamp(), host_last_seen_at = clock_timestamp(), updated_at = now()
   where id = p_id and host_id = auth.uid() and status in ('scheduled', 'preparing')
  returning * into v;

  if v.id is null then
    -- Nothing changed: say why, keeping the answers 0007 gave.
    select * into v from public.live_sessions where id = p_id;
    if v.id is null or v.host_id <> auth.uid() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
    if v.status = 'live' then return public.live_json(v, auth.uid()); end if;
    raise exception 'LIVE_OVER' using errcode = 'P0001', hint = 'This broadcast has already ended.';
  end if;

  -- Persistent moderators join automatically.
  insert into public.live_participants (live_id, user_id, role, state)
  select p_id, m.user_id, 'moderator', 'left' from public.host_moderators m where m.host_id = v.host_id
  on conflict do nothing;

  -- Notify followers and anyone who set a reminder.
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, data)
  select u.user_id, v.host_id, 'live_started', 'live', p_id::text, jsonb_build_object('title', v.title)
  from (select f.follower_id as user_id from public.follows f where f.following_id = v.host_id
        union select r.user_id from public.live_reminders r where r.live_id = p_id) u
  join public.notification_preferences np on np.user_id = u.user_id and np.live
  where not public.is_blocked_either(u.user_id, v.host_id) and public.can_view_post_of(v.host_id, v.visibility, u.user_id);

  perform public.insert_live_system(p_id, 'went live', 'system', '{}'::jsonb, v.host_id);
  return public.live_json((select l from public.live_sessions l where l.id = p_id), auth.uid());
end $$;

/** Replaces 0007: same guarded-update treatment, so ending cannot queue behind a beat either. */
create or replace function public.end_live(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.live_sessions;
begin
  update public.live_sessions
     set status = case when status = 'scheduled' then 'cancelled' else 'ended' end::public.live_status,
         ended_at = clock_timestamp(), viewers_count = 0, updated_at = now()
   where id = p_id and status not in ('ended', 'cancelled') and (host_id = auth.uid() or public.is_admin())
  returning * into v;

  if v.id is null then
    select * into v from public.live_sessions where id = p_id;
    if v.id is null or (v.host_id <> auth.uid() and not public.is_admin()) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
    return public.live_json(v, auth.uid());
  end if;

  update public.live_participants set state = 'left', left_at = clock_timestamp() where live_id = p_id and state <> 'removed';
  update public.live_battles
     set status = 'finished', finished_at = clock_timestamp(),
         winner_id = case when host_score > opponent_score then host_id when opponent_score > host_score then opponent_id else null end
   where live_id = p_id and status = 'active';
  return public.live_json((select l from public.live_sessions l where l.id = p_id), auth.uid());
end $$;

/**
 * Replaces 0007: a beat that cannot get the row immediately is dropped. Heartbeats exist to say
 * "still here" and the next one is seconds away, so waiting for a lock only spreads the delay.
 */
create or replace function public.live_heartbeat(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  begin
    set local lock_timeout = '800ms';
    if public.is_live_host(p_id) then
      update public.live_sessions set host_last_seen_at = clock_timestamp() where id = p_id;
    else
      update public.live_participants set last_seen_at = clock_timestamp()
       where live_id = p_id and user_id = auth.uid() and state in ('watching', 'requested', 'invited', 'on_stage');
    end if;
    perform public.recount_live_viewers(p_id);
  exception when lock_not_available then
    -- Someone else is writing the broadcast right now; skip this beat.
    null;
  end;
  return jsonb_build_object(
    'viewers_count', (select viewers_count from public.live_sessions where id = p_id),
    'status', (select status from public.live_sessions where id = p_id));
end $$;

/**
 * Replaces 0007: also clears broadcasts left in `preparing`. create_live() refuses to open a second
 * session while one is still active, so a start that failed used to lock the host out permanently.
 */
create or replace function public.cleanup_lives()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_n integer := 0;
begin
  -- Running broadcasts whose host stopped checking in.
  for r in select id from public.live_sessions
            where status = 'live' and coalesce(host_last_seen_at, started_at) < clock_timestamp() - interval '5 minutes' loop
    update public.live_sessions set status = 'ended', ended_at = clock_timestamp(), viewers_count = 0 where id = r.id;
    update public.live_participants set state = 'left', left_at = clock_timestamp() where live_id = r.id and state <> 'removed';
    v_n := v_n + 1;
  end loop;

  -- Never-started previews: the host closed the app, or the start failed.
  for r in select id from public.live_sessions
            where status = 'preparing' and coalesce(host_last_seen_at, created_at) < clock_timestamp() - interval '15 minutes' loop
    update public.live_sessions set status = 'cancelled', ended_at = clock_timestamp(), viewers_count = 0 where id = r.id;
    update public.live_participants set state = 'left', left_at = clock_timestamp() where live_id = r.id and state <> 'removed';
    v_n := v_n + 1;
  end loop;

  update public.live_participants set state = 'left', left_at = clock_timestamp()
   where state in ('watching', 'requested', 'invited') and last_seen_at < clock_timestamp() - interval '3 minutes';
  update public.live_battles
     set status = 'finished', finished_at = clock_timestamp(),
         winner_id = case when host_score > opponent_score then host_id when opponent_score > host_score then opponent_id else null end
   where status = 'active' and ends_at < clock_timestamp();
  return v_n;
end $$;
