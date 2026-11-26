-- ============================================================================
-- 0020 — Joining a broadcast twice at once must not fail
--
-- join_live() checked for an existing participant row and then inserted one. Two calls arriving
-- together — a reload while the first is still in flight, or two tabs — both saw no row and both
-- inserted, and the second came back as
--   duplicate key value violates unique constraint "live_participants_pkey"
-- which the viewer saw as the broadcast failing to open. The insert now yields to whoever got there
-- first, and only the call that actually created the row counts a view and announces the arrival.
-- ============================================================================

create or replace function public.join_live(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.live_sessions; v_role public.live_role := 'viewer'; v_existing public.live_participants; v_inserted boolean;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into v from public.live_sessions where id = p_id;
  if v.id is null or not public.can_view_live(p_id) then raise exception 'LIVE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.status not in ('live', 'preparing', 'scheduled') then raise exception 'LIVE_OVER' using errcode = 'P0001', hint = 'This broadcast has ended.'; end if;
  if v.host_id = auth.uid() then
    update public.live_sessions set host_last_seen_at = clock_timestamp() where id = p_id;
    return public.live_json(v, auth.uid());
  end if;
  if exists (select 1 from public.host_moderators m where m.host_id = v.host_id and m.user_id = auth.uid()) then v_role := 'moderator'; end if;

  select * into v_existing from public.live_participants where live_id = p_id and user_id = auth.uid();
  if v_existing.user_id is null then
    -- Yield to a join that landed a moment earlier instead of raising a duplicate key.
    insert into public.live_participants (live_id, user_id, role, state)
    values (p_id, auth.uid(), v_role, 'watching')
    on conflict (live_id, user_id) do nothing;
    v_inserted := found;
    if v_inserted then
      update public.live_sessions set total_views = total_views + 1 where id = p_id;
      if v.status = 'live' then perform public.insert_live_system(p_id, 'joined', 'join', '{}'::jsonb, auth.uid()); end if;
    else
      -- The row exists now; re-read it so a removed viewer is still refused below.
      select * into v_existing from public.live_participants where live_id = p_id and user_id = auth.uid();
      if v_existing.state = 'removed' then
        raise exception 'REMOVED_FROM_LIVE' using errcode = '42501', hint = 'You were removed from this broadcast.';
      end if;
      update public.live_participants set last_seen_at = clock_timestamp() where live_id = p_id and user_id = auth.uid();
    end if;
  elsif v_existing.state in ('left') then
    update public.live_participants
       set state = 'watching', joined_at = clock_timestamp(), last_seen_at = clock_timestamp(), left_at = null,
           role = (case when v_existing.role = 'moderator' then 'moderator' else 'viewer' end)::public.live_role
     where live_id = p_id and user_id = auth.uid();
    update public.live_sessions set total_views = total_views + 1 where id = p_id;
  elsif v_existing.state = 'removed' then
    raise exception 'REMOVED_FROM_LIVE' using errcode = '42501', hint = 'You were removed from this broadcast.';
  else
    update public.live_participants set last_seen_at = clock_timestamp() where live_id = p_id and user_id = auth.uid();
  end if;

  perform public.recount_live_viewers(p_id);
  return public.live_json((select l from public.live_sessions l where l.id = p_id), auth.uid());
end $$;
