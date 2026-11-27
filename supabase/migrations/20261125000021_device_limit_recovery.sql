-- ============================================================================
-- 0021 — A long-unused device must not lock you out of your own chats
--
-- Encrypted chat allows 10 devices per account. A new device id is minted every time someone
-- installs the app again, uses another browser, or clears site data — so the tenth slot fills up
-- long before anyone owns ten phones. Once full, register_e2ee_device() refused outright and the
-- chat screen had no composer at all: no way to type, and no way out from inside the conversation.
--
-- Registration now retires devices that have not been seen for 45 days to make room, and tells the
-- owner it happened. If every slot belongs to a device in current use, the refusal stands, which is
-- the case where asking the person to choose is the right answer.
-- ============================================================================

/** Retires the caller's devices that have gone unused for the given number of days. Returns how many. */
create or replace function public.prune_stale_e2ee_devices(p_user uuid, p_days integer default 45)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update public.e2ee_devices
     set revoked_at = now()
   where user_id = p_user
     and revoked_at is null
     and last_seen_at < now() - make_interval(days => greatest(7, coalesce(p_days, 45)));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

/**
 * Replaces 0015. Same validation and the same 10-device ceiling; the only change is that a full
 * account first drops the devices nobody has used in 45 days instead of failing immediately.
 */
create or replace function public.register_e2ee_device(p_device_id text, p_platform text, p_identity_key text, p_signing_key text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_row public.e2ee_devices; v_existing public.e2ee_devices; v_active integer; v_pruned integer := 0;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_device_id !~ '^[A-Za-z0-9_-]{16,64}$' or p_platform not in ('android', 'ios', 'web')
     or coalesce(p_identity_key, '') !~ '^[A-Za-z0-9+/]{43}=$' or coalesce(p_signing_key, '') !~ '^[A-Za-z0-9+/]{43}=$' then
    raise exception 'INVALID_DEVICE' using errcode = '23514';
  end if;
  select * into v_existing from public.e2ee_devices where device_id = p_device_id;
  if v_existing.id is not null and v_existing.user_id <> v_me then raise exception 'DEVICE_ID_TAKEN' using errcode = '23505'; end if;
  if v_existing.id is not null and v_existing.revoked_at is not null then
    raise exception 'DEVICE_REVOKED' using errcode = '42501', hint = 'This device was removed from your account. A new encryption identity will be created.';
  end if;

  if v_existing.id is null then
    select count(*) into v_active from public.e2ee_devices where user_id = v_me and revoked_at is null;
    if v_active >= 10 then
      -- Make room by retiring what has not been used in a long time, then look again.
      v_pruned := public.prune_stale_e2ee_devices(v_me, 45);
      select count(*) into v_active from public.e2ee_devices where user_id = v_me and revoked_at is null;
      if v_active >= 10 then
        raise exception 'DEVICE_LIMIT' using errcode = 'P0001',
          hint = 'Encrypted chat works on up to 10 devices and all of yours are in use. Open Settings → End-to-end encryption and remove one.';
      end if;
      -- Removing a device is a security-relevant change, so say so.
      insert into public.notifications (user_id, type, data)
      values (v_me, 'security_alert', jsonb_build_object(
        'message', case when v_pruned = 1 then 'An unused device was removed from encrypted chat to make room for this one.'
                        else v_pruned || ' unused devices were removed from encrypted chat to make room for this one.' end,
        'pruned', v_pruned));
    end if;
    insert into public.e2ee_devices (user_id, device_id, platform, name, identity_key, signing_key)
    values (v_me, p_device_id, p_platform, nullif(left(p_name, 80), ''), p_identity_key, p_signing_key)
    returning * into v_row;
  else
    update public.e2ee_devices
       set platform = p_platform,
           name = coalesce(nullif(left(p_name, 80), ''), name),
           -- New key material under a known id counts as a new identity (peers see a key change).
           created_at = case when identity_key = p_identity_key and signing_key = p_signing_key then created_at else now() end,
           identity_key = p_identity_key,
           signing_key = p_signing_key,
           last_seen_at = now()
     where id = v_existing.id
    returning * into v_row;
  end if;
  return public.e2ee_device_json(v_row, true);
end $$;

-- Internal helper: only the registration path and the server may call it. PostgreSQL grants EXECUTE
-- to PUBLIC on a new function, so that has to go first or every signed-in client could call it.
revoke all on function public.prune_stale_e2ee_devices(uuid, integer) from public;
revoke all on function public.prune_stale_e2ee_devices(uuid, integer) from anon, authenticated;
grant execute on function public.prune_stale_e2ee_devices(uuid, integer) to service_role;
