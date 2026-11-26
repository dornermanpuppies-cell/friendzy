-- =============================================================================
-- Friendzy — 0017: notifications reach people when the app is closed
-- =============================================================================
-- * public.web_push_subscriptions — browser push subscriptions (website and
--   installed web app). Endpoint + the browser's public key and auth secret;
--   the push-dispatch function encrypts every notification for them (RFC 8291).
-- * Incoming calls ring on closed apps: an AFTER INSERT trigger on
--   call_participants (state = invited) posts to push-dispatch, which sends a
--   high-priority "Incoming call" push. Nothing is written to the notifications
--   list for that (missed calls still are, via finish_call).
-- * request_test_notification(): "Send me a test notification" in Settings.
-- =============================================================================

create table if not exists public.web_push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  endpoint      text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 2048),
  p256dh        text not null check (char_length(p256dh) between 80 and 120),
  auth          text not null check (char_length(auth) between 16 and 32),
  user_agent    text check (user_agent is null or char_length(user_agent) <= 200),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  failed_at     timestamptz
);
create index if not exists web_push_subscriptions_user_idx on public.web_push_subscriptions (user_id);

alter table public.web_push_subscriptions enable row level security;
revoke all on public.web_push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.web_push_subscriptions to authenticated;
drop policy if exists "web_push_subscriptions_own" on public.web_push_subscriptions;
create policy "web_push_subscriptions_own" on public.web_push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- At most 10 browsers per account (the oldest subscription gives way).
create or replace function public.web_push_subscriptions_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.web_push_subscriptions
  where user_id = new.user_id and id in (
    select id from public.web_push_subscriptions where user_id = new.user_id order by last_seen_at desc offset 10);
  return null;
end $$;
drop trigger if exists web_push_subscriptions_limit on public.web_push_subscriptions;
create trigger web_push_subscriptions_limit after insert on public.web_push_subscriptions for each row execute function public.web_push_subscriptions_limit();

-- ----------------------------------------------------------------------------
-- Incoming calls → push (the trigger function from 0014/0015 posts the row)
-- ----------------------------------------------------------------------------
drop trigger if exists push_dispatch_on_call_invite on public.call_participants;
create trigger push_dispatch_on_call_invite
  after insert on public.call_participants
  for each row when (new.state = 'invited')
  execute function public.push_dispatch_webhook();

-- ----------------------------------------------------------------------------
-- Test notification (Settings → Notifications → "Send me a test notification")
-- ----------------------------------------------------------------------------
create or replace function public.request_test_notification()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_recent integer;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select count(*) into v_recent from public.notifications where user_id = auth.uid() and type = 'test_notification' and created_at > now() - interval '1 minute';
  if v_recent >= 3 then raise exception 'RATE_LIMITED' using errcode = 'P0001', hint = 'Wait a minute before sending another test.'; end if;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, data)
  values (auth.uid(), null, 'test_notification', 'account', auth.uid()::text, jsonb_build_object('sent_at', now()))
  returning id into v_id;
  return v_id;
end $$;

-- ----------------------------------------------------------------------------
-- Privileges
-- ----------------------------------------------------------------------------
do $do$
declare f text;
begin
  foreach f in array array['public.request_test_notification()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['public.web_push_subscriptions_limit()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $do$;
