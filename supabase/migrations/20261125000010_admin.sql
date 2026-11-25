-- ============================================================================
-- Friendzy — Phase 10: Administration & moderation
-- Sanctions (warnings, feature restrictions, suspensions, bans) enforced by a
-- single BEFORE INSERT guard on every content table, report workflow, content
-- removal/restore, live moderation, finance review, platform settings, site
-- content (announcements, banners, featured creators, trending topics),
-- verification requests, role management and the audit log. Every admin action
-- is written to admin_audit_logs. Admin roles are never granted from clients.
-- ============================================================================

do $do$ begin
  create type public.sanction_kind as enum ('warning', 'feature_restriction', 'suspension', 'ban');
exception when duplicate_object then null; end $do$;
do $do$ begin
  create type public.verification_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $do$;

create table if not exists public.user_sanctions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        public.sanction_kind not null,
  feature     text,
  reason      text not null,
  report_id   uuid references public.reports (id) on delete set null,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  created_by  uuid references auth.users (id) on delete set null,
  lifted_at   timestamptz,
  lifted_by   uuid references auth.users (id) on delete set null,
  lift_reason text,
  created_at  timestamptz not null default now(),
  constraint user_sanctions_feature check (feature is null or feature in ('post', 'comment', 'message', 'live', 'gift', 'game')),
  constraint user_sanctions_reason_len check (char_length(reason) between 2 and 500)
);
create index if not exists user_sanctions_user_idx on public.user_sanctions (user_id, created_at desc);
create index if not exists user_sanctions_active_idx on public.user_sanctions (user_id, kind, feature) where lifted_at is null;
revoke all on public.user_sanctions from anon, authenticated;
grant select on public.user_sanctions to authenticated;

create table if not exists public.admin_notes (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  admin_id   uuid references auth.users (id) on delete set null,
  note       text not null,
  created_at timestamptz not null default now(),
  constraint admin_notes_len check (char_length(note) between 1 and 2000)
);
create index if not exists admin_notes_user_idx on public.admin_notes (user_id, created_at desc);
revoke all on public.admin_notes from anon, authenticated;

create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  kind       text not null default 'info',
  audience   text not null default 'all',
  link       text,
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz,
  is_active  boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_kind check (kind in ('info', 'update', 'warning', 'promo')),
  constraint announcements_audience check (audience in ('all', 'premium', 'free', 'creators')),
  constraint announcements_title_len check (char_length(title) between 1 and 120),
  constraint announcements_body_len check (char_length(body) between 1 and 2000)
);
revoke all on public.announcements from anon, authenticated;
grant select on public.announcements to authenticated;

create table if not exists public.announcement_dismissals (
  user_id         uuid not null references public.profiles (id) on delete cascade,
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  dismissed_at    timestamptz not null default now(),
  primary key (user_id, announcement_id)
);
revoke all on public.announcement_dismissals from anon, authenticated;

create table if not exists public.banners (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  subtitle   text,
  image_url  text,
  link       text,
  placement  text not null default 'home',
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint banners_placement check (placement in ('home', 'discover', 'live', 'wallet', 'games')),
  constraint banners_title_len check (char_length(title) between 1 and 80)
);
revoke all on public.banners from anon, authenticated;
grant select on public.banners to authenticated;

create table if not exists public.featured_creators (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  note           text,
  sort_order     integer not null default 0,
  featured_until timestamptz,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);
revoke all on public.featured_creators from anon, authenticated;
grant select on public.featured_creators to authenticated;

create table if not exists public.trending_topics (
  id         serial primary key,
  tag        text not null,
  label      text,
  kind       text not null default 'hashtag',
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint trending_topics_kind check (kind in ('hashtag', 'topic', 'challenge')),
  constraint trending_topics_tag check (tag ~ '^[a-z0-9_]{2,50}$')
);
create unique index if not exists trending_topics_tag_idx on public.trending_topics (tag);
revoke all on public.trending_topics from anon, authenticated;
grant select on public.trending_topics to authenticated;

create table if not exists public.verification_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  full_name     text not null,
  category      text not null,
  links         jsonb not null default '[]'::jsonb,
  document_path text,
  note          text,
  status        public.verification_status not null default 'pending',
  reviewed_by   uuid references auth.users (id) on delete set null,
  reviewed_at   timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  constraint verification_category check (category in ('creator', 'public_figure', 'business', 'community', 'other')),
  constraint verification_name_len check (char_length(full_name) between 2 and 120),
  constraint verification_note_len check (note is null or char_length(note) <= 1000)
);
create unique index if not exists verification_requests_pending_idx on public.verification_requests (user_id) where status = 'pending';
create index if not exists verification_requests_status_idx on public.verification_requests (status, created_at);
revoke all on public.verification_requests from anon, authenticated;
grant select on public.verification_requests to authenticated;

insert into public.platform_settings (key, value, is_public) values
  ('verification_min_followers', '0'::jsonb, true),
  ('maintenance_mode', 'false'::jsonb, true),
  ('signups_enabled', 'true'::jsonb, true)
on conflict (key) do nothing;

-- Storage: private verification documents, public banner images
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('verification', 'verification', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('banners', 'banners', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "verification_insert_own" on storage.objects;
create policy "verification_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'verification' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "verification_select_own_or_admin" on storage.objects;
create policy "verification_select_own_or_admin" on storage.objects for select to authenticated
  using (bucket_id = 'verification' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists "banners_public_read" on storage.objects;
create policy "banners_public_read" on storage.objects for select using (bucket_id = 'banners');
drop policy if exists "banners_admin_write" on storage.objects;
create policy "banners_admin_write" on storage.objects for insert to authenticated with check (bucket_id = 'banners' and public.is_admin());
drop policy if exists "banners_admin_update" on storage.objects;
create policy "banners_admin_update" on storage.objects for update to authenticated using (bucket_id = 'banners' and public.is_admin()) with check (bucket_id = 'banners' and public.is_admin());
drop policy if exists "banners_admin_delete" on storage.objects;
create policy "banners_admin_delete" on storage.objects for delete to authenticated using (bucket_id = 'banners' and public.is_admin());

-- ----------------------------------------------------------------------------
-- Account & feature guard (applied to every content table)
-- ----------------------------------------------------------------------------
create or replace function public.is_feature_restricted(p_user uuid, p_feature text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_sanctions s
    where s.user_id = p_user and s.lifted_at is null and s.kind = 'feature_restriction' and s.feature = p_feature
      and s.starts_at <= now() and (s.ends_at is null or s.ends_at > now())
  )
$$;

create or replace function public.guard_active_account()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_status public.account_status_type; v_feature text;
begin
  if v_me is null then return new; end if; -- service role / internal jobs
  select account_status into v_status from public.profiles where id = v_me;
  if v_status is distinct from 'active' then
    raise exception 'ACCOUNT_SUSPENDED' using errcode = '42501', hint = 'Your account is currently restricted. Check your notifications or contact support.';
  end if;
  v_feature := case tg_table_name
    when 'posts' then 'post' when 'videos' then 'post' when 'stories' then 'post'
    when 'comments' then 'comment' when 'video_comments' then 'comment' when 'live_comments' then 'comment'
    when 'messages' then 'message' when 'live_sessions' then 'live' when 'gifts' then 'gift' when 'game_rooms' then 'game'
    else null end;
  if v_feature is not null and public.is_feature_restricted(v_me, v_feature) then
    raise exception 'FEATURE_RESTRICTED' using errcode = '42501', hint = 'This feature is temporarily unavailable on your account. Check your notifications for details.';
  end if;
  return new;
end $$;

do $do$
declare t text;
begin
  foreach t in array array['posts', 'videos', 'stories', 'comments', 'video_comments', 'live_comments', 'messages', 'live_sessions', 'gifts', 'game_rooms'] loop
    execute format('drop trigger if exists guard_active_account on public.%I', t);
    execute format('create trigger guard_active_account before insert on public.%I for each row execute function public.guard_active_account()', t);
  end loop;
end $do$;

create or replace function public.get_my_sanctions()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'feature', s.feature, 'reason', s.reason, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'created_at', s.created_at) order by s.created_at desc), '[]'::jsonb)
  from public.user_sanctions s where s.user_id = auth.uid() and s.lifted_at is null and (s.ends_at is null or s.ends_at > now())
$$;

-- ----------------------------------------------------------------------------
-- Admin helpers
-- ----------------------------------------------------------------------------
create or replace function public.admin_require(p_roles public.admin_role_type[] default null)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_roles is null then
    if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501', hint = 'Admin access required.'; end if;
  elsif not public.has_admin_role(p_roles) then
    raise exception 'FORBIDDEN' using errcode = '42501', hint = 'You do not have permission for this action.';
  end if;
end $$;

create or replace function public.get_my_admin_role()
returns text language sql stable security definer set search_path = public as $$
  select ar.role::text from public.admin_roles ar where ar.user_id = auth.uid()
$$;

create or replace function public.admin_notify(p_user uuid, p_type text, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, data) values (p_user, null, p_type, 'account', p_user::text, coalesce(p_data, '{}'::jsonb));
end $$;

create or replace function public.admin_user_json(p_user uuid, p_full boolean default false)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(p) || jsonb_build_object(
    'email', up.email, 'birth_date', up.birth_date, 'gender', up.gender, 'age', public.user_age(p.id),
    'is_premium', public.is_premium(p.id), 'admin_role', (select ar.role from public.admin_roles ar where ar.user_id = p.id),
    'last_seen_at', (select pr.last_seen_at from public.user_presence pr where pr.user_id = p.id),
    'open_reports', (select count(*) from public.reports r where r.target_type = 'profile' and r.target_id = p.id::text and r.status in ('open', 'in_review')),
    'active_sanctions', (select count(*) from public.user_sanctions s where s.user_id = p.id and s.lifted_at is null and (s.ends_at is null or s.ends_at > now()) and s.kind <> 'warning'),
    'wallet', (select jsonb_build_object('balance', w.balance, 'earnings_balance', w.earnings_balance, 'pending_earnings', w.pending_earnings, 'lifetime_purchased', w.lifetime_purchased, 'lifetime_received', w.lifetime_received, 'lifetime_withdrawn', w.lifetime_withdrawn) from public.wallets w where w.user_id = p.id)
  ) || case when p_full then jsonb_build_object(
    'phone', up.phone, 'terms_accepted_at', up.terms_accepted_at,
    'subscription', (select to_jsonb(s) from public.subscriptions s where s.user_id = p.id),
    'sanctions', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('created_by_user', public.profile_card_json(s.created_by)) order by s.created_at desc) from (select * from public.user_sanctions where user_id = p.id order by created_at desc limit 30) s), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'note', n.note, 'created_at', n.created_at, 'admin', public.profile_card_json(n.admin_id)) order by n.created_at desc) from (select * from public.admin_notes where user_id = p.id order by created_at desc limit 30) n), '[]'::jsonb),
    'reports_made', (select count(*) from public.reports r where r.reporter_id = p.id),
    'reports_received', (select count(*) from public.reports r where r.target_type = 'profile' and r.target_id = p.id::text),
    'devices', (select count(*) from public.user_devices d where d.user_id = p.id),
    'stats', jsonb_build_object(
      'lives', (select count(*) from public.live_sessions l where l.host_id = p.id),
      'gifts_sent_coins', (select coalesce(sum(coins_total), 0) from public.gifts g where g.sender_id = p.id),
      'gifts_received_coins', (select coalesce(sum(net_coins), 0) from public.gifts g where g.receiver_id = p.id),
      'coin_purchases_cents', (select coalesce(sum(price_cents), 0) from public.coin_purchases c where c.user_id = p.id and c.status = 'completed'),
      'games_played', (select count(*) from public.game_results gr where gr.user_id = p.id)),
    'verification', (select to_jsonb(v) from public.verification_requests v where v.user_id = p.id order by v.created_at desc limit 1)
  ) else '{}'::jsonb end
  from public.profiles p left join public.user_private up on up.user_id = p.id where p.id = p_user
$$;

-- ----------------------------------------------------------------------------
-- Overview & analytics
-- ----------------------------------------------------------------------------
create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require();
  return jsonb_build_object(
    'users', jsonb_build_object(
      'total', (select count(*) from public.profiles),
      'new_today', (select count(*) from public.profiles where created_at >= date_trunc('day', now())),
      'new_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
      'new_30d', (select count(*) from public.profiles where created_at > now() - interval '30 days'),
      'online_now', (select count(*) from public.user_presence where is_online and last_seen_at > now() - interval '5 minutes'),
      'active_24h', (select count(*) from public.user_presence where last_seen_at > now() - interval '24 hours'),
      'suspended', (select count(*) from public.profiles where account_status = 'suspended'),
      'banned', (select count(*) from public.profiles where account_status = 'banned'),
      'premium', (select count(*) from public.subscriptions s where public.is_premium(s.user_id)),
      'verified', (select count(*) from public.profiles where is_verified)),
    'content', jsonb_build_object(
      'posts_today', (select count(*) from public.posts where created_at >= date_trunc('day', now())),
      'videos_today', (select count(*) from public.videos where created_at >= date_trunc('day', now())),
      'stories_today', (select count(*) from public.stories where created_at >= date_trunc('day', now())),
      'messages_today', (select count(*) from public.messages where created_at >= date_trunc('day', now())),
      'lives_now', (select count(*) from public.live_sessions where status = 'live'),
      'lives_today', (select count(*) from public.live_sessions where created_at >= date_trunc('day', now())),
      'games_today', (select count(*) from public.game_rooms where created_at >= date_trunc('day', now())),
      'removed_posts', (select count(*) from public.posts where removed_at is not null),
      'removed_videos', (select count(*) from public.videos where removed_at is not null)),
    'moderation', jsonb_build_object(
      'open_reports', (select count(*) from public.reports where status = 'open'),
      'in_review', (select count(*) from public.reports where status = 'in_review'),
      'pending_verifications', (select count(*) from public.verification_requests where status = 'pending'),
      'active_sanctions', (select count(*) from public.user_sanctions where lifted_at is null and (ends_at is null or ends_at > now()) and kind <> 'warning')),
    'finance', jsonb_build_object(
      'coins_purchased_30d', (select coalesce(sum(coins + bonus_coins), 0) from public.coin_purchases where status = 'completed' and created_at > now() - interval '30 days'),
      'revenue_cents_30d', (select coalesce(sum(price_cents), 0) from public.coin_purchases where status = 'completed' and created_at > now() - interval '30 days'),
      'gifts_coins_30d', (select coalesce(sum(coins_total), 0) from public.gifts where created_at > now() - interval '30 days'),
      'commission_coins_30d', (select coalesce(sum(commission_coins), 0) from public.gifts where created_at > now() - interval '30 days'),
      'pending_withdrawals', (select count(*) from public.withdrawal_requests where status in ('pending', 'approved')),
      'pending_withdrawal_cents', (select coalesce(sum(amount_cents), 0) from public.withdrawal_requests where status in ('pending', 'approved')),
      'coins_in_circulation', (select coalesce(sum(balance), 0) from public.wallets),
      'creator_earnings_outstanding', (select coalesce(sum(earnings_balance + pending_earnings), 0) from public.wallets),
      'payouts_enabled', public.setting_bool('payouts_enabled', false)),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'signups', (select count(*) from public.profiles p where p.created_at >= d.day and p.created_at < d.day + interval '1 day'),
                  'posts', (select count(*) from public.posts p where p.created_at >= d.day and p.created_at < d.day + interval '1 day'),
                  'videos', (select count(*) from public.videos v where v.created_at >= d.day and v.created_at < d.day + interval '1 day')) order by d.day), '[]'::jsonb)
               from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') as d(day)),
    'generated_at', now());
end $$;

create or replace function public.admin_analytics(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_days integer := greatest(7, least(coalesce(p_days, 30), 365));
begin
  perform public.admin_require();
  return jsonb_build_object(
    'days', v_days,
    'series', (select coalesce(jsonb_agg(jsonb_build_object(
        'day', d.day,
        'signups', (select count(*) from public.profiles p where p.created_at >= d.day and p.created_at < d.day + interval '1 day'),
        'posts', (select count(*) from public.posts p where p.created_at >= d.day and p.created_at < d.day + interval '1 day'),
        'videos', (select count(*) from public.videos v where v.created_at >= d.day and v.created_at < d.day + interval '1 day'),
        'lives', (select count(*) from public.live_sessions l where l.created_at >= d.day and l.created_at < d.day + interval '1 day'),
        'messages', (select count(*) from public.messages m where m.created_at >= d.day and m.created_at < d.day + interval '1 day'),
        'games', (select count(*) from public.game_rooms g where g.created_at >= d.day and g.created_at < d.day + interval '1 day'),
        'gifts_coins', (select coalesce(sum(coins_total), 0) from public.gifts g where g.created_at >= d.day and g.created_at < d.day + interval '1 day'),
        'purchase_cents', (select coalesce(sum(price_cents), 0) from public.coin_purchases c where c.status = 'completed' and c.created_at >= d.day and c.created_at < d.day + interval '1 day'),
        'new_premium', (select count(*) from public.subscription_events e where e.event_type in ('INITIAL_PURCHASE', 'GRANT') and e.created_at >= d.day and e.created_at < d.day + interval '1 day'),
        'reports', (select count(*) from public.reports r where r.created_at >= d.day and r.created_at < d.day + interval '1 day')
      ) order by d.day), '[]'::jsonb)
      from generate_series(date_trunc('day', now()) - make_interval(days => v_days - 1), date_trunc('day', now()), interval '1 day') as d(day)),
    'top_countries', (select coalesce(jsonb_agg(jsonb_build_object('country_code', c.country_code, 'users', c.n) order by c.n desc), '[]'::jsonb)
                      from (select country_code, count(*) n from public.profiles where country_code is not null group by country_code order by n desc limit 10) c),
    'top_creators', (select coalesce(jsonb_agg(public.profile_card_json(t.receiver_id) || jsonb_build_object('coins', t.coins) order by t.coins desc), '[]'::jsonb)
                     from (select receiver_id, sum(net_coins) coins from public.gifts where created_at > now() - make_interval(days => v_days) group by receiver_id order by coins desc limit 10) t),
    'games', (select coalesce(jsonb_agg(jsonb_build_object('game', g.game, 'rooms', g.n) order by g.n desc), '[]'::jsonb)
              from (select game, count(*) n from public.game_rooms where created_at > now() - make_interval(days => v_days) group by game) g));
end $$;

-- ----------------------------------------------------------------------------
-- Users
-- ----------------------------------------------------------------------------
create or replace function public.admin_search_users(p_query text default '', p_status text default null, p_filter text default null, p_limit integer default 30, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require();
  return coalesce((
    select jsonb_agg(public.admin_user_json(x.id, false) order by x.created_at desc)
    from (
      select p.id, p.created_at from public.profiles p left join public.user_private up on up.user_id = p.id
      where (coalesce(trim(p_query), '') = '' or p.username ilike '%' || lower(trim(p_query)) || '%' or p.display_name ilike '%' || trim(p_query) || '%'
             or up.email ilike '%' || lower(trim(p_query)) || '%' or p.id::text = trim(p_query))
        and (p_status is null or p.account_status::text = p_status)
        and (p_filter is null or p_filter = 'all'
             or (p_filter = 'premium' and public.is_premium(p.id))
             or (p_filter = 'verified' and p.is_verified)
             or (p_filter = 'admins' and exists (select 1 from public.admin_roles ar where ar.user_id = p.id))
             or (p_filter = 'reported' and exists (select 1 from public.reports r where r.target_type = 'profile' and r.target_id = p.id::text and r.status in ('open', 'in_review')))
             or (p_filter = 'sanctioned' and exists (select 1 from public.user_sanctions s where s.user_id = p.id and s.lifted_at is null and (s.ends_at is null or s.ends_at > now()))))
      order by p.created_at desc
      limit greatest(1, least(coalesce(p_limit, 30), 100)) offset greatest(0, coalesce(p_offset, 0))
    ) x), '[]'::jsonb);
end $$;

create or replace function public.admin_get_user(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require();
  return public.admin_user_json(p_user, true);
end $$;

create or replace function public.admin_set_account_status(p_user uuid, p_status public.account_status_type, p_reason text, p_days integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_until timestamptz; v_kind public.sanction_kind;
begin
  if p_status = 'banned' or p_status = 'deactivated' then perform public.admin_require(array['super_admin', 'admin']::public.admin_role_type[]);
  else perform public.admin_require(array['super_admin', 'admin', 'moderator']::public.admin_role_type[]); end if;
  if p_user = auth.uid() then raise exception 'CANNOT_TARGET_SELF' using errcode = 'P0001'; end if;
  if exists (select 1 from public.admin_roles where user_id = p_user) and not public.has_admin_role(array['super_admin']::public.admin_role_type[]) then
    raise exception 'FORBIDDEN' using errcode = '42501', hint = 'Only a super admin can sanction another admin.';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'REASON_REQUIRED' using errcode = '23514'; end if;
  v_until := case when p_days is not null and p_days > 0 then now() + make_interval(days => p_days) else null end;
  update public.profiles set account_status = p_status where id = p_user;
  if not found then raise exception 'USER_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_status in ('suspended', 'banned') then
    v_kind := case when p_status = 'banned' then 'ban' else 'suspension' end;
    update public.user_sanctions set lifted_at = now(), lifted_by = auth.uid(), lift_reason = 'superseded' where user_id = p_user and kind in ('suspension', 'ban') and lifted_at is null;
    insert into public.user_sanctions (user_id, kind, reason, ends_at, created_by) values (p_user, v_kind, p_reason, v_until, auth.uid());
    update public.live_sessions set status = 'ended', ended_at = clock_timestamp(), viewers_count = 0 where host_id = p_user and status in ('preparing', 'live');
    update public.live_sessions set status = 'cancelled', ended_at = clock_timestamp() where host_id = p_user and status = 'scheduled';
    update public.user_presence set is_online = false where user_id = p_user;
    perform public.admin_notify(p_user, 'moderation', jsonb_build_object('kind', v_kind, 'reason', p_reason, 'ends_at', v_until));
  elsif p_status = 'active' then
    update public.user_sanctions set lifted_at = now(), lifted_by = auth.uid(), lift_reason = p_reason where user_id = p_user and kind in ('suspension', 'ban') and lifted_at is null;
    perform public.admin_notify(p_user, 'moderation', jsonb_build_object('kind', 'reinstated', 'reason', p_reason));
  end if;
  perform public.log_admin_action('user.status', 'profile', p_user::text, jsonb_build_object('status', p_status, 'reason', p_reason, 'until', v_until));
  return public.admin_user_json(p_user, true);
end $$;

create or replace function public.admin_warn_user(p_user uuid, p_reason text, p_report uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require(array['super_admin', 'admin', 'moderator']::public.admin_role_type[]);
  insert into public.user_sanctions (user_id, kind, reason, report_id, created_by) values (p_user, 'warning', p_reason, p_report, auth.uid());
  perform public.admin_notify(p_user, 'moderation', jsonb_build_object('kind', 'warning', 'reason', p_reason));
  perform public.log_admin_action('user.warn', 'profile', p_user::text, jsonb_build_object('reason', p_reason, 'report', p_report));
end $$;

create or replace function public.admin_restrict_feature(p_user uuid, p_feature text, p_hours integer, p_reason text, p_report uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_until timestamptz; v_id uuid;
begin
  perform public.admin_require(array['super_admin', 'admin', 'moderator']::public.admin_role_type[]);
  if p_feature not in ('post', 'comment', 'message', 'live', 'gift', 'game') then raise exception 'INVALID_FEATURE' using errcode = '23514'; end if;
  v_until := case when p_hours is not null and p_hours > 0 then now() + make_interval(hours => p_hours) else null end;
  insert into public.user_sanctions (user_id, kind, feature, reason, report_id, ends_at, created_by) values (p_user, 'feature_restriction', p_feature, p_reason, p_report, v_until, auth.uid()) returning id into v_id;
  if p_feature = 'live' then
    update public.live_sessions set status = 'ended', ended_at = clock_timestamp(), viewers_count = 0 where host_id = p_user and status in ('preparing', 'live');
  end if;
  perform public.admin_notify(p_user, 'moderation', jsonb_build_object('kind', 'feature_restriction', 'feature', p_feature, 'reason', p_reason, 'ends_at', v_until));
  perform public.log_admin_action('user.restrict', 'profile', p_user::text, jsonb_build_object('feature', p_feature, 'hours', p_hours, 'reason', p_reason, 'report', p_report));
  return jsonb_build_object('id', v_id, 'ends_at', v_until);
end $$;

create or replace function public.admin_lift_sanction(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s public.user_sanctions;
begin
  perform public.admin_require(array['super_admin', 'admin', 'moderator']::public.admin_role_type[]);
  select * into s from public.user_sanctions where id = p_id and lifted_at is null for update;
  if s.id is null then raise exception 'SANCTION_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.user_sanctions set lifted_at = now(), lifted_by = auth.uid(), lift_reason = p_reason where id = p_id;
  if s.kind in ('suspension', 'ban') and not exists (select 1 from public.user_sanctions where user_id = s.user_id and kind in ('suspension', 'ban') and lifted_at is null and id <> p_id) then
    update public.profiles set account_status = 'active' where id = s.user_id;
  end if;
  perform public.log_admin_action('user.lift_sanction', 'sanction', p_id::text, jsonb_build_object('user', s.user_id, 'kind', s.kind, 'reason', p_reason));
end $$;

create or replace function public.admin_set_verified(p_user uuid, p_verified boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require(array['super_admin', 'admin', 'support']::public.admin_role_type[]);
  update public.profiles set is_verified = coalesce(p_verified, false) where id = p_user;
  if not found then raise exception 'USER_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.admin_notify(p_user, 'verification_update', jsonb_build_object('verified', coalesce(p_verified, false), 'note', p_note));
  perform public.log_admin_action('user.verified', 'profile', p_user::text, jsonb_build_object('verified', p_verified, 'note', p_note));
end $$;

create or replace function public.admin_add_note(p_user uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform public.admin_require();
  insert into public.admin_notes (user_id, admin_id, note) values (p_user, auth.uid(), trim(p_note)) returning id into v_id;
  perform public.log_admin_action('user.note', 'profile', p_user::text, jsonb_build_object('note_id', v_id));
  return jsonb_build_object('id', v_id, 'note', trim(p_note), 'created_at', now(), 'admin', public.profile_card_json(auth.uid()));
end $$;

create or replace function public.admin_revoke_user_sessions(p_user uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public.admin_require(array['super_admin', 'admin']::public.admin_role_type[]);
  delete from auth.sessions where user_id = p_user;
  get diagnostics n = row_count;
  perform public.log_admin_action('user.revoke_sessions', 'profile', p_user::text, jsonb_build_object('sessions', n));
  return n;
end $$;

-- ----------------------------------------------------------------------------
-- Reports & content moderation
-- ----------------------------------------------------------------------------
create or replace function public.admin_target_owner(p_type text, p_id text)
returns uuid language sql stable security definer set search_path = public as $$
  select case p_type
    when 'profile' then p_id::uuid
    when 'post' then (select author_id from public.posts where id = p_id::uuid)
    when 'video' then (select author_id from public.videos where id = p_id::uuid)
    when 'story' then (select author_id from public.stories where id = p_id::uuid)
    when 'comment' then coalesce((select author_id from public.comments where id = p_id::uuid), (select author_id from public.video_comments where id = p_id::uuid), (select user_id from public.live_comments where id = p_id::uuid))
    when 'message' then (select sender_id from public.messages where id = p_id::uuid)
    when 'live' then (select host_id from public.live_sessions where id = p_id::uuid)
    when 'gift' then (select sender_id from public.gifts where id = p_id::uuid)
    else null end
$$;

create or replace function public.admin_target_preview(p_type text, p_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case p_type
    when 'profile' then (select public.profile_card_json(p.id) || jsonb_build_object('bio', p.bio, 'account_status', p.account_status, 'followers_count', p.followers_count) from public.profiles p where p.id = p_id::uuid)
    when 'post' then (select jsonb_build_object('id', p.id, 'type', p.type, 'text', p.text, 'author', public.profile_card_json(p.author_id), 'created_at', p.created_at, 'removed_at', p.removed_at,
                        'media', coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'url', m.url, 'thumbnail_url', m.thumbnail_url) order by m.position) from public.post_media m where m.post_id = p.id), '[]'::jsonb)) from public.posts p where p.id = p_id::uuid)
    when 'video' then (select jsonb_build_object('id', v.id, 'caption', v.caption, 'thumbnail_url', v.thumbnail_url, 'playback_url', coalesce(v.playback_url, v.media_url), 'author', public.profile_card_json(v.author_id), 'created_at', v.created_at, 'removed_at', v.removed_at) from public.videos v where v.id = p_id::uuid)
    when 'story' then (select jsonb_build_object('id', s.id, 'kind', s.kind, 'text', s.text, 'media_url', s.media_url, 'thumbnail_url', s.thumbnail_url, 'author', public.profile_card_json(s.author_id), 'created_at', s.created_at, 'removed_at', s.removed_at, 'expires_at', s.expires_at) from public.stories s where s.id = p_id::uuid)
    when 'comment' then coalesce(
        (select jsonb_build_object('id', c.id, 'scope', 'post', 'text', c.text, 'author', public.profile_card_json(c.author_id), 'created_at', c.created_at, 'removed_at', c.removed_at, 'parent', c.post_id) from public.comments c where c.id = p_id::uuid),
        (select jsonb_build_object('id', c.id, 'scope', 'video', 'text', c.text, 'author', public.profile_card_json(c.author_id), 'created_at', c.created_at, 'removed_at', c.removed_at, 'parent', c.video_id) from public.video_comments c where c.id = p_id::uuid),
        (select jsonb_build_object('id', c.id, 'scope', 'live', 'text', c.text, 'author', public.profile_card_json(c.user_id), 'created_at', c.created_at, 'removed_at', c.removed_at, 'parent', c.live_id) from public.live_comments c where c.id = p_id::uuid))
    when 'message' then (select jsonb_build_object('id', m.id, 'kind', m.kind, 'text', m.text, 'author', public.profile_card_json(m.sender_id), 'created_at', m.created_at, 'deleted_at', m.deleted_at, 'conversation_id', m.conversation_id) from public.messages m where m.id = p_id::uuid)
    when 'live' then (select jsonb_build_object('id', l.id, 'title', l.title, 'status', l.status, 'author', public.profile_card_json(l.host_id), 'created_at', l.created_at, 'cover_url', l.cover_url) from public.live_sessions l where l.id = p_id::uuid)
    when 'gift' then (select jsonb_build_object('id', g.id, 'message', g.message, 'coins_total', g.coins_total, 'author', public.profile_card_json(g.sender_id), 'receiver', public.profile_card_json(g.receiver_id), 'created_at', g.created_at) from public.gifts g where g.id = p_id::uuid)
    else null end
$$;

create or replace function public.admin_report_json(r public.reports)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(r) || jsonb_build_object(
    'reporter', public.profile_card_json(r.reporter_id),
    'reviewer', case when r.reviewed_by is null then null else public.profile_card_json(r.reviewed_by) end,
    'target', public.admin_target_preview(r.target_type::text, r.target_id),
    'target_owner', public.admin_target_owner(r.target_type::text, r.target_id),
    'similar_reports', (select count(*) from public.reports x where x.target_type = r.target_type and x.target_id = r.target_id and x.id <> r.id))
$$;

create or replace function public.admin_list_reports(p_status text default 'open', p_target_type text default null, p_limit integer default 30, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require();
  return coalesce((select jsonb_agg(public.admin_report_json(r) order by r.created_at desc) from (
    select * from public.reports r where (p_status is null or p_status = 'all' or r.status::text = p_status) and (p_target_type is null or r.target_type::text = p_target_type)
    order by r.created_at desc limit greatest(1, least(coalesce(p_limit, 30), 100)) offset greatest(0, coalesce(p_offset, 0)) ) r), '[]'::jsonb);
end $$;

create or replace function public.admin_get_report(p_report uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require();
  return (select public.admin_report_json(r) from public.reports r where r.id = p_report);
end $$;

create or replace function public.admin_claim_report(p_report uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require();
  update public.reports set status = 'in_review', reviewed_by = auth.uid() where id = p_report and status = 'open';
  perform public.log_admin_action('report.claim', 'report', p_report::text);
  return (select public.admin_report_json(r) from public.reports r where r.id = p_report);
end $$;

create or replace function public.admin_remove_content(p_type text, p_id uuid, p_reason text, p_notify boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_found boolean := false;
begin
  perform public.admin_require(array['super_admin', 'admin', 'moderator']::public.admin_role_type[]);
  v_owner := public.admin_target_owner(p_type, p_id::text);
  if p_type = 'post' then
    update public.posts set removed_at = coalesce(removed_at, now()), removed_by = auth.uid(), removed_reason = p_reason where id = p_id; v_found := found;
  elsif p_type = 'video' then
    update public.videos set removed_at = coalesce(removed_at, now()), removed_by = auth.uid(), removed_reason = p_reason where id = p_id; v_found := found;
  elsif p_type = 'story' then
    update public.stories set removed_at = coalesce(removed_at, now()) where id = p_id; v_found := found;
  elsif p_type = 'comment' then
    update public.comments set removed_at = coalesce(removed_at, now()) where id = p_id; v_found := found;
    if not v_found then update public.video_comments set removed_at = coalesce(removed_at, now()) where id = p_id; v_found := found; end if;
    if not v_found then update public.live_comments set removed_at = coalesce(removed_at, now()) where id = p_id; v_found := found; end if;
  elsif p_type = 'message' then
    update public.messages set deleted_at = coalesce(deleted_at, clock_timestamp()), deleted_by = auth.uid() where id = p_id; v_found := found;
  elsif p_type = 'live' then
    perform public.end_live(p_id); v_found := true;
  else
    raise exception 'INVALID_TYPE' using errcode = '23514';
  end if;
  if not v_found then raise exception 'CONTENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_notify and v_owner is not null then
    perform public.admin_notify(v_owner, 'content_removed', jsonb_build_object('type', p_type, 'id', p_id, 'reason', p_reason));
  end if;
  perform public.log_admin_action('content.remove', p_type, p_id::text, jsonb_build_object('reason', p_reason, 'owner', v_owner));
end $$;

create or replace function public.admin_restore_content(p_type text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_found boolean := false;
begin
  perform public.admin_require(array['super_admin', 'admin', 'moderator']::public.admin_role_type[]);
  if p_type = 'post' then update public.posts set removed_at = null, removed_by = null, removed_reason = null where id = p_id; v_found := found;
  elsif p_type = 'video' then update public.videos set removed_at = null, removed_by = null, removed_reason = null where id = p_id; v_found := found;
  elsif p_type = 'story' then update public.stories set removed_at = null where id = p_id; v_found := found;
  elsif p_type = 'comment' then
    update public.comments set removed_at = null where id = p_id; v_found := found;
    if not v_found then update public.video_comments set removed_at = null where id = p_id; v_found := found; end if;
    if not v_found then update public.live_comments set removed_at = null where id = p_id; v_found := found; end if;
  else raise exception 'INVALID_TYPE' using errcode = '23514'; end if;
  if not v_found then raise exception 'CONTENT_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.log_admin_action('content.restore', p_type, p_id::text);
end $$;

create or replace function public.admin_resolve_report(p_report uuid, p_status public.report_status, p_resolution text default null, p_action text default 'none', p_reason text default null, p_hours integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.reports; v_owner uuid; v_reason text;
begin
  perform public.admin_require(array['super_admin', 'admin', 'moderator']::public.admin_role_type[]);
  select * into r from public.reports where id = p_report for update;
  if r.id is null then raise exception 'REPORT_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_status not in ('resolved', 'dismissed') then raise exception 'INVALID_STATUS' using errcode = '23514'; end if;
  v_owner := public.admin_target_owner(r.target_type::text, r.target_id);
  v_reason := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Violation of community guidelines (' || r.reason || ')');
  if p_action = 'remove_content' then
    if r.target_type = 'profile' then raise exception 'INVALID_ACTION' using errcode = '23514', hint = 'Profiles cannot be removed; suspend or ban the user instead.'; end if;
    perform public.admin_remove_content(r.target_type::text, r.target_id::uuid, v_reason);
  elsif p_action = 'warn_user' then
    if v_owner is null then raise exception 'OWNER_UNKNOWN' using errcode = 'P0002'; end if;
    perform public.admin_warn_user(v_owner, v_reason, r.id);
  elsif p_action = 'restrict_user' then
    if v_owner is null then raise exception 'OWNER_UNKNOWN' using errcode = 'P0002'; end if;
    perform public.admin_restrict_feature(v_owner, case r.target_type when 'live' then 'live' when 'comment' then 'comment' when 'message' then 'message' when 'gift' then 'gift' else 'post' end, coalesce(p_hours, 72), v_reason, r.id);
  elsif p_action = 'suspend_user' then
    if v_owner is null then raise exception 'OWNER_UNKNOWN' using errcode = 'P0002'; end if;
    perform public.admin_set_account_status(v_owner, 'suspended', v_reason, coalesce(p_hours, 168) / 24);
  elsif p_action = 'ban_user' then
    if v_owner is null then raise exception 'OWNER_UNKNOWN' using errcode = 'P0002'; end if;
    perform public.admin_set_account_status(v_owner, 'banned', v_reason, null);
  elsif p_action <> 'none' then
    raise exception 'INVALID_ACTION' using errcode = '23514';
  end if;
  update public.reports set status = p_status, resolution = p_resolution, reviewed_by = auth.uid(), reviewed_at = now() where id = p_report;
  -- Close duplicate reports on the same target with the same outcome.
  update public.reports set status = p_status, resolution = coalesce(p_resolution, 'Handled with report ' || p_report::text), reviewed_by = auth.uid(), reviewed_at = now()
  where target_type = r.target_type and target_id = r.target_id and status in ('open', 'in_review') and id <> p_report;
  perform public.log_admin_action('report.resolve', 'report', p_report::text, jsonb_build_object('status', p_status, 'action', p_action, 'resolution', p_resolution, 'owner', v_owner));
  return (select public.admin_report_json(x) from public.reports x where x.id = p_report);
end $$;

create or replace function public.admin_list_content(p_type text default 'post', p_query text default '', p_removed_only boolean default false, p_user uuid default null, p_limit integer default 30, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_limit integer := greatest(1, least(coalesce(p_limit, 30), 100)); v_offset integer := greatest(0, coalesce(p_offset, 0));
begin
  perform public.admin_require();
  if p_type = 'post' then
    return coalesce((select jsonb_agg(public.admin_target_preview('post', p.id::text) || jsonb_build_object('likes_count', p.likes_count, 'comments_count', p.comments_count, 'audience', p.audience, 'removed_reason', p.removed_reason,
             'reports_count', (select count(*) from public.reports r where r.target_type = 'post' and r.target_id = p.id::text)) order by p.created_at desc)
      from (select * from public.posts p where (not coalesce(p_removed_only, false) or p.removed_at is not null) and (p_user is null or p.author_id = p_user)
            and (coalesce(trim(p_query), '') = '' or p.text ilike '%' || trim(p_query) || '%' or p.id::text = trim(p_query)) order by p.created_at desc limit v_limit offset v_offset) p), '[]'::jsonb);
  elsif p_type = 'video' then
    return coalesce((select jsonb_agg(public.admin_target_preview('video', v.id::text) || jsonb_build_object('likes_count', v.likes_count, 'views_count', v.views_count, 'audience', v.audience, 'removed_reason', v.removed_reason,
             'reports_count', (select count(*) from public.reports r where r.target_type = 'video' and r.target_id = v.id::text)) order by v.created_at desc)
      from (select * from public.videos v where (not coalesce(p_removed_only, false) or v.removed_at is not null) and (p_user is null or v.author_id = p_user)
            and (coalesce(trim(p_query), '') = '' or v.caption ilike '%' || trim(p_query) || '%' or v.id::text = trim(p_query)) order by v.created_at desc limit v_limit offset v_offset) v), '[]'::jsonb);
  elsif p_type = 'story' then
    return coalesce((select jsonb_agg(public.admin_target_preview('story', s.id::text) order by s.created_at desc)
      from (select * from public.stories s where (not coalesce(p_removed_only, false) or s.removed_at is not null) and (p_user is null or s.author_id = p_user) and s.expires_at > now() - interval '7 days'
            order by s.created_at desc limit v_limit offset v_offset) s), '[]'::jsonb);
  elsif p_type = 'comment' then
    return coalesce((select jsonb_agg(public.admin_target_preview('comment', c.id::text) order by c.created_at desc)
      from (select id, created_at from public.comments c where (not coalesce(p_removed_only, false) or c.removed_at is not null) and (p_user is null or c.author_id = p_user) and (coalesce(trim(p_query), '') = '' or c.text ilike '%' || trim(p_query) || '%')
            union all
            select id, created_at from public.video_comments c where (not coalesce(p_removed_only, false) or c.removed_at is not null) and (p_user is null or c.author_id = p_user) and (coalesce(trim(p_query), '') = '' or c.text ilike '%' || trim(p_query) || '%')
            order by created_at desc limit v_limit offset v_offset) c), '[]'::jsonb);
  else
    raise exception 'INVALID_TYPE' using errcode = '23514';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Live moderation
-- ----------------------------------------------------------------------------
create or replace function public.admin_list_lives(p_status text default 'live', p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require();
  return coalesce((select jsonb_agg(public.live_json(l, auth.uid()) || jsonb_build_object('reports_count', (select count(*) from public.reports r where r.target_type = 'live' and r.target_id = l.id::text)) order by l.viewers_count desc, l.created_at desc)
    from (select * from public.live_sessions l where (p_status is null or p_status = 'all' or l.status::text = p_status) order by l.created_at desc limit greatest(1, least(coalesce(p_limit, 50), 200))) l), '[]'::jsonb);
end $$;

create or replace function public.admin_end_live(p_id uuid, p_reason text, p_restrict_hours integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_host uuid; v_json jsonb;
begin
  perform public.admin_require(array['super_admin', 'admin', 'moderator']::public.admin_role_type[]);
  select host_id into v_host from public.live_sessions where id = p_id;
  if v_host is null then raise exception 'LIVE_NOT_FOUND' using errcode = 'P0002'; end if;
  v_json := public.end_live(p_id);
  perform public.admin_notify(v_host, 'moderation', jsonb_build_object('kind', 'live_ended', 'reason', p_reason, 'live_id', p_id));
  if p_restrict_hours is not null and p_restrict_hours > 0 then
    perform public.admin_restrict_feature(v_host, 'live', p_restrict_hours, p_reason);
  end if;
  perform public.log_admin_action('live.end', 'live', p_id::text, jsonb_build_object('reason', p_reason, 'host', v_host, 'restrict_hours', p_restrict_hours));
  return v_json;
end $$;

-- ----------------------------------------------------------------------------
-- Finance
-- ----------------------------------------------------------------------------
create or replace function public.admin_list_transactions(p_user uuid default null, p_kind text default null, p_limit integer default 50, p_before bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require(array['super_admin', 'admin', 'finance', 'support']::public.admin_role_type[]);
  return coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('user', public.profile_card_json(t.user_id)) order by t.id desc)
    from (select * from public.wallet_transactions t where (p_user is null or t.user_id = p_user) and (p_kind is null or t.kind::text = p_kind) and (p_before is null or t.id < p_before)
          order by t.id desc limit greatest(1, least(coalesce(p_limit, 50), 200))) t), '[]'::jsonb);
end $$;

create or replace function public.admin_list_withdrawals(p_status text default 'pending', p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require(array['super_admin', 'admin', 'finance']::public.admin_role_type[]);
  return coalesce((select jsonb_agg(to_jsonb(w) || jsonb_build_object('user', public.admin_user_json(w.user_id, false), 'reviewer', case when w.reviewed_by is null then null else public.profile_card_json(w.reviewed_by) end) order by w.created_at)
    from (select * from public.withdrawal_requests w where (p_status is null or p_status = 'all' or w.status::text = p_status) order by w.created_at limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0))) w), '[]'::jsonb);
end $$;

create or replace function public.admin_review_withdrawal(p_id uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.withdrawal_requests;
begin
  perform public.admin_require(array['super_admin', 'admin', 'finance']::public.admin_role_type[]);
  select * into w from public.withdrawal_requests where id = p_id for update;
  if w.id is null then raise exception 'WITHDRAWAL_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_decision = 'approved' then
    if w.status <> 'pending' then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
    update public.withdrawal_requests set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), note = p_note where id = p_id;
  elsif p_decision = 'paid' then
    if w.status not in ('pending', 'approved') then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
    update public.withdrawal_requests set status = 'paid', reviewed_by = coalesce(reviewed_by, auth.uid()), reviewed_at = coalesce(reviewed_at, now()), paid_at = now(), note = coalesce(p_note, note) where id = p_id;
    perform public.ledger_apply(w.user_id, 'withdrawal_paid', 0, 0, 'withdrawal', w.id::text, 'withdrawal_paid:' || w.id::text, jsonb_build_object('amount_cents', w.amount_cents, 'admin', auth.uid()), -w.coins);
    perform public.admin_notify(w.user_id, 'withdrawal_update', jsonb_build_object('status', 'paid', 'coins', w.coins, 'amount_cents', w.amount_cents));
  elsif p_decision = 'rejected' then
    if w.status not in ('pending', 'approved') then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
    update public.withdrawal_requests set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), note = p_note where id = p_id;
    perform public.ledger_apply(w.user_id, 'withdrawal_refund', 0, w.coins, 'withdrawal', w.id::text, 'withdrawal_refund:' || w.id::text, jsonb_build_object('reason', p_note, 'admin', auth.uid()), -w.coins);
    perform public.admin_notify(w.user_id, 'withdrawal_update', jsonb_build_object('status', 'rejected', 'coins', w.coins, 'note', p_note));
  else
    raise exception 'INVALID_DECISION' using errcode = '23514';
  end if;
  perform public.log_admin_action('withdrawal.' || p_decision, 'withdrawal', p_id::text, jsonb_build_object('user', w.user_id, 'coins', w.coins, 'amount_cents', w.amount_cents, 'note', p_note));
  return (select to_jsonb(x) from public.withdrawal_requests x where x.id = p_id);
end $$;

create or replace function public.admin_adjust_coins(p_user uuid, p_delta bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tx bigint;
begin
  perform public.admin_require(array['super_admin', 'finance']::public.admin_role_type[]);
  if coalesce(p_delta, 0) = 0 or abs(p_delta) > 1000000 then raise exception 'INVALID_AMOUNT' using errcode = '23514'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'REASON_REQUIRED' using errcode = '23514'; end if;
  v_tx := public.ledger_apply(p_user, 'adjustment', p_delta, 0, 'admin_adjustment', auth.uid()::text, 'adjust:' || gen_random_uuid()::text, jsonb_build_object('reason', p_reason, 'admin', auth.uid()));
  perform public.admin_notify(p_user, 'coins_adjusted', jsonb_build_object('coins', p_delta, 'reason', p_reason));
  perform public.log_admin_action('wallet.adjust', 'profile', p_user::text, jsonb_build_object('delta', p_delta, 'reason', p_reason, 'transaction', v_tx));
  return jsonb_build_object('transaction', v_tx, 'balance', (select balance from public.wallets where user_id = p_user));
end $$;

create or replace function public.admin_list_coin_purchases(p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require(array['super_admin', 'admin', 'finance', 'support']::public.admin_role_type[]);
  return coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('user', public.profile_card_json(c.user_id)) order by c.created_at desc)
    from (select * from public.coin_purchases c order by c.created_at desc limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0))) c), '[]'::jsonb);
end $$;

create or replace function public.admin_list_subscriptions(p_status text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require(array['super_admin', 'admin', 'finance', 'support']::public.admin_role_type[]);
  return coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('user', public.profile_card_json(s.user_id), 'is_premium', public.is_premium(s.user_id)) order by s.updated_at desc)
    from (select * from public.subscriptions s where (p_status is null or p_status = 'all' or s.status::text = p_status) order by s.updated_at desc limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0))) s), '[]'::jsonb);
end $$;

-- ----------------------------------------------------------------------------
-- Platform settings & catalogues
-- ----------------------------------------------------------------------------
create or replace function public.admin_list_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require();
  return coalesce((select jsonb_agg(jsonb_build_object('key', s.key, 'value', s.value, 'is_public', s.is_public, 'updated_at', s.updated_at, 'updated_by', case when s.updated_by is null then null else public.profile_card_json(s.updated_by) end) order by s.key) from public.platform_settings s), '[]'::jsonb);
end $$;

create or replace function public.admin_update_setting(p_key text, p_value jsonb, p_is_public boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_type text := jsonb_typeof(p_value);
begin
  perform public.admin_require(array['super_admin', 'admin']::public.admin_role_type[]);
  if p_key !~ '^[a-z0-9_]{2,60}$' then raise exception 'INVALID_KEY' using errcode = '23514'; end if;
  if p_key in ('commission_rate', 'coin_value_cents', 'min_withdrawal_coins', 'gifting_min_age', 'max_gift_quantity', 'verification_min_followers') and v_type <> 'number' then
    raise exception 'INVALID_VALUE' using errcode = '23514', hint = 'This setting must be a number.';
  end if;
  if p_key in ('payouts_enabled', 'premium_enabled', 'maintenance_mode', 'signups_enabled') and v_type <> 'boolean' then
    raise exception 'INVALID_VALUE' using errcode = '23514', hint = 'This setting must be true or false.';
  end if;
  if p_key = 'supported_countries' and v_type <> 'array' then raise exception 'INVALID_VALUE' using errcode = '23514', hint = 'Provide a list of ISO country codes.'; end if;
  if p_key = 'commission_rate' and ((p_value)::text::numeric < 0 or (p_value)::text::numeric > 0.9) then raise exception 'INVALID_VALUE' using errcode = '23514', hint = 'Commission must be between 0 and 0.9.'; end if;
  if p_key = 'payouts_enabled' and p_value = 'true'::jsonb and not public.has_admin_role(array['super_admin']::public.admin_role_type[]) then
    raise exception 'FORBIDDEN' using errcode = '42501', hint = 'Only a super admin can enable payouts.';
  end if;
  insert into public.platform_settings (key, value, is_public, updated_by, updated_at) values (p_key, p_value, coalesce(p_is_public, true), auth.uid(), now())
  on conflict (key) do update set value = excluded.value, is_public = coalesce(p_is_public, public.platform_settings.is_public), updated_by = auth.uid(), updated_at = now();
  perform public.log_admin_action('settings.update', 'setting', p_key, jsonb_build_object('value', p_value));
  return (select jsonb_build_object('key', s.key, 'value', s.value, 'is_public', s.is_public, 'updated_at', s.updated_at) from public.platform_settings s where s.key = p_key);
end $$;

create or replace function public.admin_upsert_gift(p_id integer, p_slug text, p_name text, p_emoji text, p_coins integer, p_tier public.gift_tier default 'basic', p_animation text default 'float', p_is_premium_only boolean default false, p_is_active boolean default true, p_sort_order integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id integer;
begin
  perform public.admin_require(array['super_admin', 'admin', 'finance']::public.admin_role_type[]);
  if p_id is null then
    insert into public.gift_catalog (slug, name, emoji, coins, tier, animation, is_premium_only, is_active, sort_order) values (lower(trim(p_slug)), trim(p_name), p_emoji, p_coins, coalesce(p_tier, 'basic'), coalesce(p_animation, 'float'), coalesce(p_is_premium_only, false), coalesce(p_is_active, true), coalesce(p_sort_order, 0)) returning id into v_id;
  else
    update public.gift_catalog set slug = coalesce(lower(trim(p_slug)), slug), name = coalesce(trim(p_name), name), emoji = coalesce(p_emoji, emoji), coins = coalesce(p_coins, coins), tier = coalesce(p_tier, tier), animation = coalesce(p_animation, animation),
      is_premium_only = coalesce(p_is_premium_only, is_premium_only), is_active = coalesce(p_is_active, is_active), sort_order = coalesce(p_sort_order, sort_order) where id = p_id returning id into v_id;
    if v_id is null then raise exception 'GIFT_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  perform public.log_admin_action('catalog.gift', 'gift_catalog', v_id::text, jsonb_build_object('slug', p_slug, 'coins', p_coins, 'is_active', p_is_active));
  return (select to_jsonb(g) from public.gift_catalog g where g.id = v_id);
end $$;

create or replace function public.admin_upsert_coin_package(p_id integer, p_sku text, p_title text, p_coins integer, p_bonus_coins integer default 0, p_price_cents integer default null, p_currency text default 'USD', p_is_active boolean default true, p_sort_order integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id integer;
begin
  perform public.admin_require(array['super_admin', 'finance']::public.admin_role_type[]);
  if p_id is null then
    insert into public.coin_packages (sku, title, coins, bonus_coins, price_cents, currency, is_active, sort_order) values (trim(p_sku), trim(p_title), p_coins, coalesce(p_bonus_coins, 0), p_price_cents, coalesce(p_currency, 'USD'), coalesce(p_is_active, true), coalesce(p_sort_order, 0)) returning id into v_id;
  else
    update public.coin_packages set sku = coalesce(trim(p_sku), sku), title = coalesce(trim(p_title), title), coins = coalesce(p_coins, coins), bonus_coins = coalesce(p_bonus_coins, bonus_coins), price_cents = coalesce(p_price_cents, price_cents),
      currency = coalesce(p_currency, currency), is_active = coalesce(p_is_active, is_active), sort_order = coalesce(p_sort_order, sort_order) where id = p_id returning id into v_id;
    if v_id is null then raise exception 'PACKAGE_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  perform public.log_admin_action('catalog.coin_package', 'coin_packages', v_id::text, jsonb_build_object('sku', p_sku, 'coins', p_coins, 'price_cents', p_price_cents, 'is_active', p_is_active));
  return (select to_jsonb(c) from public.coin_packages c where c.id = v_id);
end $$;

create or replace function public.admin_upsert_premium_plan(p_id text, p_title text, p_period text, p_rc_package text, p_price_cents integer, p_currency text default 'USD', p_trial_days integer default 0, p_highlight text default null, p_is_active boolean default true, p_sort_order integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require(array['super_admin', 'finance']::public.admin_role_type[]);
  insert into public.premium_plans (id, title, period, rc_package, price_cents, currency, trial_days, highlight, is_active, sort_order)
  values (trim(p_id), trim(p_title), p_period, p_rc_package, p_price_cents, coalesce(p_currency, 'USD'), coalesce(p_trial_days, 0), p_highlight, coalesce(p_is_active, true), coalesce(p_sort_order, 0))
  on conflict (id) do update set title = excluded.title, period = excluded.period, rc_package = excluded.rc_package, price_cents = excluded.price_cents, currency = excluded.currency, trial_days = excluded.trial_days, highlight = excluded.highlight, is_active = excluded.is_active, sort_order = excluded.sort_order;
  perform public.log_admin_action('catalog.premium_plan', 'premium_plans', trim(p_id), jsonb_build_object('price_cents', p_price_cents, 'is_active', p_is_active));
  return (select to_jsonb(p) from public.premium_plans p where p.id = trim(p_id));
end $$;

-- ----------------------------------------------------------------------------
-- Site content: announcements, banners, featured creators, trending topics
-- ----------------------------------------------------------------------------
create or replace function public.admin_upsert_announcement(p_id uuid, p_title text, p_body text, p_kind text default 'info', p_audience text default 'all', p_link text default null, p_starts_at timestamptz default null, p_ends_at timestamptz default null, p_is_active boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.admin_require(array['super_admin', 'admin', 'support']::public.admin_role_type[]);
  if p_id is null then
    insert into public.announcements (title, body, kind, audience, link, starts_at, ends_at, is_active, created_by) values (trim(p_title), trim(p_body), coalesce(p_kind, 'info'), coalesce(p_audience, 'all'), p_link, coalesce(p_starts_at, now()), p_ends_at, coalesce(p_is_active, true), auth.uid()) returning id into v_id;
  else
    update public.announcements set title = coalesce(trim(p_title), title), body = coalesce(trim(p_body), body), kind = coalesce(p_kind, kind), audience = coalesce(p_audience, audience), link = p_link, starts_at = coalesce(p_starts_at, starts_at), ends_at = p_ends_at, is_active = coalesce(p_is_active, is_active), updated_at = now() where id = p_id returning id into v_id;
    if v_id is null then raise exception 'ANNOUNCEMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  perform public.log_admin_action('announcement.upsert', 'announcement', v_id::text, jsonb_build_object('title', p_title, 'is_active', p_is_active));
  return (select to_jsonb(a) from public.announcements a where a.id = v_id);
end $$;

create or replace function public.admin_delete_announcement(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require(array['super_admin', 'admin', 'support']::public.admin_role_type[]);
  delete from public.announcements where id = p_id;
  perform public.log_admin_action('announcement.delete', 'announcement', p_id::text);
end $$;

create or replace function public.admin_list_announcements()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require();
  return coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object('dismissals', (select count(*) from public.announcement_dismissals d where d.announcement_id = a.id)) order by a.created_at desc) from public.announcements a), '[]'::jsonb);
end $$;

create or replace function public.get_active_announcements()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'kind', a.kind, 'link', a.link, 'starts_at', a.starts_at, 'ends_at', a.ends_at) order by a.starts_at desc), '[]'::jsonb)
  from public.announcements a
  where a.is_active and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())
    and not exists (select 1 from public.announcement_dismissals d where d.announcement_id = a.id and d.user_id = auth.uid())
    and (a.audience = 'all'
         or (a.audience = 'premium' and public.is_premium(auth.uid()))
         or (a.audience = 'free' and not public.is_premium(auth.uid()))
         or (a.audience = 'creators' and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.videos_count > 0 or exists (select 1 from public.live_sessions l where l.host_id = p.id)))))
$$;

create or replace function public.dismiss_announcement(p_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.announcement_dismissals (user_id, announcement_id) select auth.uid(), p_id where auth.uid() is not null on conflict do nothing
$$;

create or replace function public.admin_upsert_banner(p_id uuid, p_title text, p_subtitle text default null, p_image_url text default null, p_link text default null, p_placement text default 'home', p_sort_order integer default 0, p_is_active boolean default true, p_starts_at timestamptz default null, p_ends_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.admin_require(array['super_admin', 'admin', 'support']::public.admin_role_type[]);
  if p_id is null then
    insert into public.banners (title, subtitle, image_url, link, placement, sort_order, is_active, starts_at, ends_at, created_by) values (trim(p_title), p_subtitle, p_image_url, p_link, coalesce(p_placement, 'home'), coalesce(p_sort_order, 0), coalesce(p_is_active, true), coalesce(p_starts_at, now()), p_ends_at, auth.uid()) returning id into v_id;
  else
    update public.banners set title = coalesce(trim(p_title), title), subtitle = p_subtitle, image_url = coalesce(p_image_url, image_url), link = p_link, placement = coalesce(p_placement, placement), sort_order = coalesce(p_sort_order, sort_order), is_active = coalesce(p_is_active, is_active), starts_at = coalesce(p_starts_at, starts_at), ends_at = p_ends_at where id = p_id returning id into v_id;
    if v_id is null then raise exception 'BANNER_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  perform public.log_admin_action('banner.upsert', 'banner', v_id::text, jsonb_build_object('title', p_title, 'placement', p_placement, 'is_active', p_is_active));
  return (select to_jsonb(b) from public.banners b where b.id = v_id);
end $$;

create or replace function public.admin_delete_banner(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require(array['super_admin', 'admin', 'support']::public.admin_role_type[]);
  delete from public.banners where id = p_id;
  perform public.log_admin_action('banner.delete', 'banner', p_id::text);
end $$;

create or replace function public.admin_list_banners()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require();
  return coalesce((select jsonb_agg(to_jsonb(b) order by b.placement, b.sort_order) from public.banners b), '[]'::jsonb);
end $$;

create or replace function public.get_banners(p_placement text default 'home')
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'title', b.title, 'subtitle', b.subtitle, 'image_url', b.image_url, 'link', b.link, 'placement', b.placement) order by b.sort_order, b.created_at desc), '[]'::jsonb)
  from public.banners b where b.is_active and b.placement = coalesce(p_placement, 'home') and b.starts_at <= now() and (b.ends_at is null or b.ends_at > now())
$$;

create or replace function public.admin_set_featured_creator(p_user uuid, p_featured boolean default true, p_note text default null, p_until timestamptz default null, p_sort_order integer default 0)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require(array['super_admin', 'admin', 'support']::public.admin_role_type[]);
  if coalesce(p_featured, true) then
    insert into public.featured_creators (user_id, note, sort_order, featured_until, created_by) values (p_user, p_note, coalesce(p_sort_order, 0), p_until, auth.uid())
    on conflict (user_id) do update set note = excluded.note, sort_order = excluded.sort_order, featured_until = excluded.featured_until, created_by = auth.uid(), created_at = now();
  else
    delete from public.featured_creators where user_id = p_user;
  end if;
  perform public.log_admin_action('featured.set', 'profile', p_user::text, jsonb_build_object('featured', p_featured, 'note', p_note, 'until', p_until));
end $$;

create or replace function public.get_featured_creators(p_limit integer default 20)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.profile_card_json(f.user_id) || jsonb_build_object('note', f.note, 'followers_count', p.followers_count, 'bio', p.bio, 'is_live', exists (select 1 from public.live_sessions l where l.host_id = f.user_id and l.status = 'live')) order by f.sort_order, f.created_at desc), '[]'::jsonb)
  from (select * from public.featured_creators f where (f.featured_until is null or f.featured_until > now()) order by f.sort_order, f.created_at desc limit greatest(1, least(coalesce(p_limit, 20), 50))) f
  join public.profiles p on p.id = f.user_id and p.account_status = 'active'
  where auth.uid() is null or not public.is_blocked_either(auth.uid(), f.user_id)
$$;

create or replace function public.admin_upsert_trending_topic(p_id integer, p_tag text, p_label text default null, p_kind text default 'hashtag', p_sort_order integer default 0, p_is_active boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id integer;
begin
  perform public.admin_require(array['super_admin', 'admin', 'support']::public.admin_role_type[]);
  if p_id is null then
    insert into public.trending_topics (tag, label, kind, sort_order, is_active, created_by) values (lower(trim(p_tag)), p_label, coalesce(p_kind, 'hashtag'), coalesce(p_sort_order, 0), coalesce(p_is_active, true), auth.uid())
    on conflict (tag) do update set label = excluded.label, kind = excluded.kind, sort_order = excluded.sort_order, is_active = excluded.is_active returning id into v_id;
  else
    update public.trending_topics set tag = coalesce(lower(trim(p_tag)), tag), label = p_label, kind = coalesce(p_kind, kind), sort_order = coalesce(p_sort_order, sort_order), is_active = coalesce(p_is_active, is_active) where id = p_id returning id into v_id;
    if v_id is null then raise exception 'TOPIC_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  perform public.log_admin_action('trending.upsert', 'trending_topic', v_id::text, jsonb_build_object('tag', p_tag, 'is_active', p_is_active));
  return (select to_jsonb(t) from public.trending_topics t where t.id = v_id);
end $$;

create or replace function public.admin_delete_trending_topic(p_id integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require(array['super_admin', 'admin', 'support']::public.admin_role_type[]);
  delete from public.trending_topics where id = p_id;
  perform public.log_admin_action('trending.delete', 'trending_topic', p_id::text);
end $$;

create or replace function public.get_trending_topics(p_limit integer default 12)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.item order by x.ord), '[]'::jsonb) from (
    select jsonb_build_object('tag', t.tag, 'label', coalesce(t.label, '#' || t.tag), 'kind', t.kind, 'pinned', true, 'posts_count', coalesce((select h.posts_count + h.videos_count from public.hashtags h where h.tag = t.tag), 0)) as item, t.sort_order as ord
    from public.trending_topics t where t.is_active
    union all
    select jsonb_build_object('tag', h->>'tag', 'label', '#' || (h->>'tag'), 'kind', 'hashtag', 'pinned', false, 'posts_count', (h->>'posts_count')::int, 'recent_count', (h->>'recent_count')::int), 1000 + ordinality
    from jsonb_array_elements(public.get_trending_hashtags(20)) with ordinality as e(h, ordinality)
    where not exists (select 1 from public.trending_topics t where t.is_active and t.tag = h->>'tag')
  ) x
  where x.ord <= 1000 or x.ord - 1000 <= greatest(1, least(coalesce(p_limit, 12), 30))
$$;

-- ----------------------------------------------------------------------------
-- Verification requests
-- ----------------------------------------------------------------------------
create or replace function public.request_verification(p_full_name text, p_category text, p_links jsonb default '[]'::jsonb, p_document_path text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid; v_min integer;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles where id = v_me and is_verified) then raise exception 'ALREADY_VERIFIED' using errcode = 'P0001'; end if;
  if exists (select 1 from public.verification_requests where user_id = v_me and status = 'pending') then raise exception 'REQUEST_PENDING' using errcode = 'P0001', hint = 'Your previous request is still being reviewed.'; end if;
  if exists (select 1 from public.verification_requests where user_id = v_me and status = 'rejected' and reviewed_at > now() - interval '30 days') then
    raise exception 'COOLDOWN' using errcode = 'P0001', hint = 'You can apply again 30 days after a decision.';
  end if;
  v_min := public.setting_numeric('verification_min_followers', 0)::integer;
  if v_min > 0 and (select followers_count from public.profiles where id = v_me) < v_min then
    raise exception 'NOT_ELIGIBLE' using errcode = 'P0001', hint = format('Verification requires at least %s followers.', v_min);
  end if;
  if p_document_path is not null and p_document_path not like v_me::text || '/%' then raise exception 'INVALID_DOCUMENT' using errcode = '23514'; end if;
  insert into public.verification_requests (user_id, full_name, category, links, document_path, note) values (v_me, trim(p_full_name), p_category, coalesce(p_links, '[]'::jsonb), p_document_path, p_note) returning id into v_id;
  return (select to_jsonb(v) from public.verification_requests v where v.id = v_id);
end $$;

create or replace function public.get_my_verification_request()
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(v) from public.verification_requests v where v.user_id = auth.uid() order by v.created_at desc limit 1
$$;

create or replace function public.admin_list_verification_requests(p_status text default 'pending', p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require(array['super_admin', 'admin', 'support', 'moderator']::public.admin_role_type[]);
  return coalesce((select jsonb_agg(to_jsonb(v) || jsonb_build_object('user', public.admin_user_json(v.user_id, false), 'reviewer', case when v.reviewed_by is null then null else public.profile_card_json(v.reviewed_by) end) order by v.created_at)
    from (select * from public.verification_requests v where (p_status is null or p_status = 'all' or v.status::text = p_status) order by v.created_at limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0))) v), '[]'::jsonb);
end $$;

create or replace function public.admin_review_verification(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.verification_requests;
begin
  perform public.admin_require(array['super_admin', 'admin', 'support']::public.admin_role_type[]);
  select * into v from public.verification_requests where id = p_id for update;
  if v.id is null or v.status <> 'pending' then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.verification_requests set status = case when p_approve then 'approved' else 'rejected' end::public.verification_status, reviewed_by = auth.uid(), reviewed_at = now(), decision_note = p_note where id = p_id;
  if p_approve then update public.profiles set is_verified = true where id = v.user_id; end if;
  perform public.admin_notify(v.user_id, 'verification_update', jsonb_build_object('verified', p_approve, 'note', p_note));
  perform public.log_admin_action('verification.review', 'verification_request', p_id::text, jsonb_build_object('user', v.user_id, 'approved', p_approve, 'note', p_note));
  return (select to_jsonb(x) from public.verification_requests x where x.id = p_id);
end $$;

-- ----------------------------------------------------------------------------
-- Audit log & roles
-- ----------------------------------------------------------------------------
create or replace function public.admin_list_audit_logs(p_limit integer default 50, p_before timestamptz default null, p_admin uuid default null, p_action text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require(array['super_admin', 'admin']::public.admin_role_type[]);
  return coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object('admin', case when l.admin_id is null then null else public.profile_card_json(l.admin_id) end) order by l.created_at desc)
    from (select * from public.admin_audit_logs l where (p_before is null or l.created_at < p_before) and (p_admin is null or l.admin_id = p_admin) and (p_action is null or l.action ilike p_action || '%')
          order by l.created_at desc limit greatest(1, least(coalesce(p_limit, 50), 200))) l), '[]'::jsonb);
end $$;

create or replace function public.admin_list_admins()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require();
  return coalesce((select jsonb_agg(public.profile_card_json(ar.user_id) || jsonb_build_object('role', ar.role, 'granted_by', case when ar.granted_by is null then null else public.profile_card_json(ar.granted_by) end, 'created_at', ar.created_at) order by ar.created_at) from public.admin_roles ar), '[]'::jsonb);
end $$;

create or replace function public.admin_grant_role(p_user uuid, p_role public.admin_role_type)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require(array['super_admin']::public.admin_role_type[]);
  if not exists (select 1 from public.profiles where id = p_user and account_status = 'active') then raise exception 'USER_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.admin_roles (user_id, role, granted_by) values (p_user, p_role, auth.uid()) on conflict (user_id) do update set role = excluded.role, granted_by = auth.uid(), created_at = now();
  perform public.log_admin_action('admin.grant_role', 'profile', p_user::text, jsonb_build_object('role', p_role));
end $$;

create or replace function public.admin_revoke_role(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require(array['super_admin']::public.admin_role_type[]);
  if exists (select 1 from public.admin_roles where user_id = p_user and role = 'super_admin') and (select count(*) from public.admin_roles where role = 'super_admin') <= 1 then
    raise exception 'LAST_SUPER_ADMIN' using errcode = 'P0001', hint = 'Grant super admin to someone else first.';
  end if;
  delete from public.admin_roles where user_id = p_user;
  perform public.log_admin_action('admin.revoke_role', 'profile', p_user::text);
end $$;

-- One-time bootstrap from the SQL editor / service role (never from clients):
--   select public.bootstrap_first_admin('owner@example.com');
create or replace function public.bootstrap_first_admin(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if exists (select 1 from public.admin_roles) then raise exception 'ADMINS_EXIST' using errcode = 'P0001', hint = 'Use admin_grant_role from an existing super admin.'; end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then raise exception 'USER_NOT_FOUND' using errcode = 'P0002', hint = 'Sign up in the app with this email first, then run the bootstrap again.'; end if;
  insert into public.admin_roles (user_id, role) values (v_user, 'super_admin');
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, metadata) values (v_user, 'admin.bootstrap', 'profile', v_user::text, '{}'::jsonb);
  return jsonb_build_object('user_id', v_user, 'role', 'super_admin');
end $$;

-- ----------------------------------------------------------------------------
-- Privileges & RLS
-- ----------------------------------------------------------------------------
do $do$
declare f text;
begin
  foreach f in array array[
    'public.is_feature_restricted(uuid, text)', 'public.get_my_sanctions()', 'public.get_my_admin_role()', 'public.admin_overview()', 'public.admin_analytics(integer)',
    'public.admin_search_users(text, text, text, integer, integer)', 'public.admin_get_user(uuid)', 'public.admin_set_account_status(uuid, public.account_status_type, text, integer)',
    'public.admin_warn_user(uuid, text, uuid)', 'public.admin_restrict_feature(uuid, text, integer, text, uuid)', 'public.admin_lift_sanction(uuid, text)', 'public.admin_set_verified(uuid, boolean, text)',
    'public.admin_add_note(uuid, text)', 'public.admin_revoke_user_sessions(uuid)', 'public.admin_list_reports(text, text, integer, integer)', 'public.admin_get_report(uuid)', 'public.admin_claim_report(uuid)',
    'public.admin_remove_content(text, uuid, text, boolean)', 'public.admin_restore_content(text, uuid)', 'public.admin_resolve_report(uuid, public.report_status, text, text, text, integer)',
    'public.admin_list_content(text, text, boolean, uuid, integer, integer)', 'public.admin_list_lives(text, integer)', 'public.admin_end_live(uuid, text, integer)',
    'public.admin_list_transactions(uuid, text, integer, bigint)', 'public.admin_list_withdrawals(text, integer, integer)', 'public.admin_review_withdrawal(uuid, text, text)', 'public.admin_adjust_coins(uuid, bigint, text)',
    'public.admin_list_coin_purchases(integer, integer)', 'public.admin_list_subscriptions(text, integer, integer)', 'public.admin_list_settings()', 'public.admin_update_setting(text, jsonb, boolean)',
    'public.admin_upsert_gift(integer, text, text, text, integer, public.gift_tier, text, boolean, boolean, integer)', 'public.admin_upsert_coin_package(integer, text, text, integer, integer, integer, text, boolean, integer)',
    'public.admin_upsert_premium_plan(text, text, text, text, integer, text, integer, text, boolean, integer)',
    'public.admin_upsert_announcement(uuid, text, text, text, text, text, timestamptz, timestamptz, boolean)', 'public.admin_delete_announcement(uuid)', 'public.admin_list_announcements()', 'public.get_active_announcements()', 'public.dismiss_announcement(uuid)',
    'public.admin_upsert_banner(uuid, text, text, text, text, text, integer, boolean, timestamptz, timestamptz)', 'public.admin_delete_banner(uuid)', 'public.admin_list_banners()', 'public.get_banners(text)',
    'public.admin_set_featured_creator(uuid, boolean, text, timestamptz, integer)', 'public.get_featured_creators(integer)', 'public.admin_upsert_trending_topic(integer, text, text, text, integer, boolean)', 'public.admin_delete_trending_topic(integer)', 'public.get_trending_topics(integer)',
    'public.request_verification(text, text, jsonb, text, text)', 'public.get_my_verification_request()', 'public.admin_list_verification_requests(text, integer, integer)', 'public.admin_review_verification(uuid, boolean, text)',
    'public.admin_list_audit_logs(integer, timestamptz, uuid, text)', 'public.admin_list_admins()', 'public.admin_grant_role(uuid, public.admin_role_type)', 'public.admin_revoke_role(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['public.guard_active_account()', 'public.admin_require(public.admin_role_type[])', 'public.admin_notify(uuid, text, jsonb)', 'public.admin_user_json(uuid, boolean)', 'public.admin_target_owner(text, text)', 'public.admin_target_preview(text, text)', 'public.admin_report_json(public.reports)', 'public.bootstrap_first_admin(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $do$;

alter table public.user_sanctions enable row level security;
alter table public.admin_notes enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_dismissals enable row level security;
alter table public.banners enable row level security;
alter table public.featured_creators enable row level security;
alter table public.trending_topics enable row level security;
alter table public.verification_requests enable row level security;

drop policy if exists "user_sanctions_select_own" on public.user_sanctions;
create policy "user_sanctions_select_own" on public.user_sanctions for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "announcements_select_active" on public.announcements;
create policy "announcements_select_active" on public.announcements for select to authenticated using (is_active or public.is_admin());
drop policy if exists "banners_select_active" on public.banners;
create policy "banners_select_active" on public.banners for select to authenticated using (is_active or public.is_admin());
drop policy if exists "featured_creators_select" on public.featured_creators;
create policy "featured_creators_select" on public.featured_creators for select to authenticated using (true);
drop policy if exists "trending_topics_select" on public.trending_topics;
create policy "trending_topics_select" on public.trending_topics for select to authenticated using (is_active or public.is_admin());
drop policy if exists "verification_requests_select_own" on public.verification_requests;
create policy "verification_requests_select_own" on public.verification_requests for select to authenticated using (user_id = auth.uid() or public.is_admin());
-- admin_notes / announcement_dismissals: RPC only.
