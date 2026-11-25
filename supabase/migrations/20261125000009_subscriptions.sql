-- ============================================================================
-- Friendzy — Phase 9: Premium subscriptions, coin purchases & premium perks
-- Entitlement `friendzy_premium` is synced from RevenueCat webhooks (and later a
-- web billing provider) through service-role-only RPCs. Clients can only read
-- their own subscription row; they can never grant themselves Premium.
-- ============================================================================

do $do$ begin
  create type public.premium_status as enum ('active', 'trialing', 'grace_period', 'billing_issue', 'paused', 'expired', 'cancelled');
exception when duplicate_object then null; end $do$;

-- Reference catalogue of plans. Store prices are authoritative on iOS/Android
-- (RevenueCat returns them); these values power the website pricing page and
-- the admin dashboard and can be edited by admins.
create table if not exists public.premium_plans (
  id          text primary key,
  title       text not null,
  period      text not null,
  rc_package  text not null,
  price_cents integer not null,
  currency    text not null default 'USD',
  trial_days  integer not null default 0,
  highlight   text,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  constraint premium_plans_period check (period in ('monthly', 'yearly', 'lifetime')),
  constraint premium_plans_price check (price_cents >= 0)
);
revoke all on public.premium_plans from anon, authenticated;
grant select on public.premium_plans to anon, authenticated;
insert into public.premium_plans (id, title, period, rc_package, price_cents, currency, trial_days, highlight, sort_order) values
  ('friendzy_premium_monthly', 'Premium Monthly', 'monthly', '$rc_monthly', 999, 'USD', 7, null, 1),
  ('friendzy_premium_yearly', 'Premium Yearly', 'yearly', '$rc_annual', 5999, 'USD', 7, 'Best value', 2)
on conflict (id) do nothing;

create table if not exists public.subscriptions (
  user_id                   uuid primary key references public.profiles (id) on delete cascade,
  status                    public.premium_status not null default 'expired',
  entitlement               text not null default 'friendzy_premium',
  product_id                text,
  plan_id                   text references public.premium_plans (id) on delete set null,
  store                     text not null default 'unknown',
  environment               text not null default 'production',
  period_type               text,
  purchased_at              timestamptz,
  expires_at                timestamptz,
  will_renew                boolean not null default true,
  unsubscribe_detected_at   timestamptz,
  billing_issue_detected_at timestamptz,
  grace_period_expires_at   timestamptz,
  original_app_user_id      text,
  management_url            text,
  last_event_id             text,
  granted_by                uuid references auth.users (id) on delete set null,
  grant_reason              text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint subscriptions_store check (store in ('app_store', 'mac_app_store', 'play_store', 'amazon', 'test_store', 'stripe', 'paddle', 'promotional', 'manual', 'unknown')),
  constraint subscriptions_env check (environment in ('production', 'sandbox'))
);
create index if not exists subscriptions_status_idx on public.subscriptions (status, expires_at);
revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;

create table if not exists public.subscription_events (
  id          bigserial primary key,
  user_id     uuid references public.profiles (id) on delete set null,
  provider    text not null default 'revenuecat',
  event_id    text not null unique,
  event_type  text not null,
  product_id  text,
  store       text,
  environment text,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default clock_timestamp()
);
create index if not exists subscription_events_user_idx on public.subscription_events (user_id, created_at desc);
revoke all on public.subscription_events from anon, authenticated;

create table if not exists public.coin_purchases (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  sku            text not null,
  coins          integer not null,
  bonus_coins    integer not null default 0,
  price_cents    integer,
  currency       text,
  store          text not null default 'unknown',
  provider       text not null default 'revenuecat',
  environment    text not null default 'production',
  transaction_id text not null unique,
  status         text not null default 'completed',
  refunded_at    timestamptz,
  created_at     timestamptz not null default clock_timestamp(),
  constraint coin_purchases_status check (status in ('completed', 'refunded'))
);
create index if not exists coin_purchases_user_idx on public.coin_purchases (user_id, created_at desc);
revoke all on public.coin_purchases from anon, authenticated;
grant select on public.coin_purchases to authenticated;

-- "Who viewed my profile" (Premium perk). One row per viewer/profile pair.
create table if not exists public.profile_views (
  viewer_id  uuid not null references public.profiles (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  viewed_at  timestamptz not null default clock_timestamp(),
  views      integer not null default 1,
  primary key (viewer_id, profile_id)
);
create index if not exists profile_views_profile_idx on public.profile_views (profile_id, viewed_at desc);
revoke all on public.profile_views from anon, authenticated;

-- Premium accent themes
alter table public.user_settings add column if not exists accent text not null default 'default';
alter table public.user_settings drop constraint if exists user_settings_accent_check;
alter table public.user_settings add constraint user_settings_accent_check check (accent in ('default', 'aurora', 'sunset', 'ocean', 'gold', 'midnight'));
grant update (accent) on public.user_settings to authenticated;

insert into public.platform_settings (key, value, is_public) values
  ('premium_enabled', 'true'::jsonb, true),
  ('web_billing_provider', '"none"'::jsonb, true)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- Entitlement
-- ----------------------------------------------------------------------------
create or replace function public.is_premium(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user
      and s.status in ('active', 'trialing', 'grace_period', 'billing_issue')
      and (s.expires_at is null or s.expires_at > now() or coalesce(s.grace_period_expires_at, '-infinity'::timestamptz) > now())
  )
$$;

create or replace function public.profile_card_json(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', pr.id, 'username', pr.username, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url,
    'is_verified', pr.is_verified, 'is_private', pr.is_private, 'country_code', pr.country_code,
    'is_premium', public.is_premium(pr.id)
  ) from public.profiles pr where pr.id = p_user
$$;

create or replace function public.premium_features()
returns jsonb language sql immutable as $$
  select '[
    {"id": "badge", "icon": "diamond-outline", "title": "Premium badge", "description": "A Premium badge next to your name across Friendzy."},
    {"id": "gifts", "icon": "gift-outline", "title": "Exclusive gifts", "description": "Send premium-only animated gifts in lives, videos and chats."},
    {"id": "viewers", "icon": "eye-outline", "title": "See who viewed your profile", "description": "Full list of recent profile visitors."},
    {"id": "admirers", "icon": "heart-outline", "title": "See who liked you", "description": "Reveal the people who chose you in Match."},
    {"id": "filters", "icon": "options-outline", "title": "Advanced search", "description": "Filter people by age, gender, interests and who is online."},
    {"id": "themes", "icon": "color-palette-outline", "title": "Exclusive themes", "description": "Aurora, Sunset, Ocean, Gold and Midnight accents."},
    {"id": "support", "icon": "sparkles-outline", "title": "Priority support", "description": "Your tickets go to the front of the queue."}
  ]'::jsonb
$$;

create or replace function public.get_premium_plans()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(p) order by p.sort_order), '[]'::jsonb) from public.premium_plans p where p.is_active
$$;

create or replace function public.get_premium_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'is_premium', public.is_premium(auth.uid()),
    'enabled', public.setting_bool('premium_enabled', true),
    'status', s.status, 'expires_at', s.expires_at, 'will_renew', s.will_renew, 'store', s.store, 'product_id', s.product_id,
    'period_type', s.period_type, 'purchased_at', s.purchased_at, 'management_url', s.management_url,
    'billing_issue', s.billing_issue_detected_at is not null and s.status = 'billing_issue',
    'plan', (select to_jsonb(pp) from public.premium_plans pp where pp.id = s.plan_id),
    'plans', public.get_premium_plans(),
    'features', public.premium_features(),
    'web_billing_provider', coalesce((select value #>> '{}' from public.platform_settings where key = 'web_billing_provider'), 'none')
  )
  from (select 1) x left join public.subscriptions s on s.user_id = auth.uid()
$$;

-- Webhook sync (service role only). Idempotent per provider event id.
create or replace function public.sync_subscription(
  p_user uuid, p_event_id text, p_event_type text, p_status public.premium_status,
  p_product_id text default null, p_store text default 'unknown', p_environment text default 'production', p_period_type text default null,
  p_purchased_at timestamptz default null, p_expires_at timestamptz default null, p_will_renew boolean default true,
  p_unsubscribe_detected_at timestamptz default null, p_billing_issue_detected_at timestamptz default null, p_grace_period_expires_at timestamptz default null,
  p_original_app_user_id text default null, p_management_url text default null, p_payload jsonb default '{}'::jsonb, p_provider text default 'revenuecat'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_was boolean; v_now boolean; v_plan text; v_store text := coalesce(p_store, 'unknown');
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if exists (select 1 from public.subscription_events where event_id = p_event_id) then return jsonb_build_object('duplicate', true); end if;
  if v_store not in ('app_store', 'mac_app_store', 'play_store', 'amazon', 'test_store', 'stripe', 'paddle', 'promotional', 'manual', 'unknown') then v_store := 'unknown'; end if;
  insert into public.subscription_events (user_id, provider, event_id, event_type, product_id, store, environment, payload)
  values (p_user, coalesce(p_provider, 'revenuecat'), p_event_id, p_event_type, p_product_id, v_store, p_environment, coalesce(p_payload, '{}'::jsonb));
  v_was := public.is_premium(p_user);
  select id into v_plan from public.premium_plans where id = p_product_id or p_product_id like id || ':%' limit 1;
  insert into public.subscriptions (user_id, status, product_id, plan_id, store, environment, period_type, purchased_at, expires_at, will_renew,
                                    unsubscribe_detected_at, billing_issue_detected_at, grace_period_expires_at, original_app_user_id, management_url, last_event_id)
  values (p_user, p_status, p_product_id, v_plan, v_store, coalesce(p_environment, 'production'), p_period_type, p_purchased_at, p_expires_at, coalesce(p_will_renew, true),
          p_unsubscribe_detected_at, p_billing_issue_detected_at, p_grace_period_expires_at, p_original_app_user_id, p_management_url, p_event_id)
  on conflict (user_id) do update set
    status = excluded.status, product_id = coalesce(excluded.product_id, public.subscriptions.product_id), plan_id = coalesce(excluded.plan_id, public.subscriptions.plan_id),
    store = excluded.store, environment = excluded.environment, period_type = coalesce(excluded.period_type, public.subscriptions.period_type),
    purchased_at = coalesce(excluded.purchased_at, public.subscriptions.purchased_at), expires_at = excluded.expires_at, will_renew = excluded.will_renew,
    unsubscribe_detected_at = excluded.unsubscribe_detected_at, billing_issue_detected_at = excluded.billing_issue_detected_at, grace_period_expires_at = excluded.grace_period_expires_at,
    original_app_user_id = coalesce(excluded.original_app_user_id, public.subscriptions.original_app_user_id), management_url = coalesce(excluded.management_url, public.subscriptions.management_url),
    last_event_id = excluded.last_event_id, granted_by = null, grant_reason = null, updated_at = now();
  v_now := public.is_premium(p_user);
  if v_now and not v_was then
    perform public.create_notification(p_user, null, 'subscription_update', 'subscription', p_user::text, jsonb_build_object('status', 'active', 'expires_at', p_expires_at));
  elsif v_was and not v_now then
    perform public.create_notification(p_user, null, 'subscription_update', 'subscription', p_user::text, jsonb_build_object('status', p_status::text));
  elsif p_status = 'billing_issue' then
    perform public.create_notification(p_user, null, 'subscription_update', 'subscription', p_user::text, jsonb_build_object('status', 'billing_issue'));
  end if;
  return jsonb_build_object('duplicate', false, 'is_premium', v_now, 'status', p_status);
end $$;

-- Consumable coin purchases (service role only; idempotent per store transaction).
create or replace function public.record_coin_purchase(
  p_user uuid, p_sku text, p_transaction_id text, p_store text default 'unknown', p_price_cents integer default null, p_currency text default null,
  p_environment text default 'production', p_payload jsonb default '{}'::jsonb, p_provider text default 'revenuecat'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare pkg public.coin_packages; v_id uuid; v_total bigint; v_tx bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into pkg from public.coin_packages where sku = p_sku;
  if pkg.id is null then raise exception 'UNKNOWN_SKU' using errcode = 'P0002', hint = format('No coin package with sku %s', p_sku); end if;
  insert into public.coin_purchases (user_id, sku, coins, bonus_coins, price_cents, currency, store, provider, environment, transaction_id)
  values (p_user, p_sku, pkg.coins, pkg.bonus_coins, coalesce(p_price_cents, pkg.price_cents), coalesce(p_currency, pkg.currency), coalesce(p_store, 'unknown'), coalesce(p_provider, 'revenuecat'), coalesce(p_environment, 'production'), p_transaction_id)
  on conflict (transaction_id) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.coin_purchases where transaction_id = p_transaction_id;
    return jsonb_build_object('duplicate', true, 'id', v_id);
  end if;
  v_total := pkg.coins + pkg.bonus_coins;
  v_tx := public.credit_coins(p_user, v_total, 'purchase', 'coin_purchase', v_id::text, 'coin_purchase:' || p_transaction_id,
                              jsonb_build_object('sku', p_sku, 'store', p_store, 'price_cents', coalesce(p_price_cents, pkg.price_cents), 'currency', coalesce(p_currency, pkg.currency)));
  perform public.create_notification(p_user, null, 'coins_credited', 'wallet', v_id::text, jsonb_build_object('coins', v_total, 'sku', p_sku));
  return jsonb_build_object('duplicate', false, 'id', v_id, 'coins', v_total, 'transaction', v_tx);
end $$;

create or replace function public.refund_coin_purchase(p_transaction_id text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cp public.coin_purchases; v_total bigint; v_balance bigint; v_debit bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into cp from public.coin_purchases where transaction_id = p_transaction_id for update;
  if cp.id is null then return jsonb_build_object('found', false); end if;
  if cp.status = 'refunded' then return jsonb_build_object('found', true, 'duplicate', true); end if;
  update public.coin_purchases set status = 'refunded', refunded_at = clock_timestamp() where id = cp.id;
  v_total := cp.coins + cp.bonus_coins;
  select balance into v_balance from public.wallets where user_id = cp.user_id;
  v_debit := least(v_total, coalesce(v_balance, 0));
  if v_debit > 0 then
    perform public.ledger_apply(cp.user_id, 'refund', -v_debit, 0, 'coin_purchase', cp.id::text, 'coin_refund:' || p_transaction_id,
                                jsonb_build_object('sku', cp.sku, 'refunded_coins', v_total, 'shortfall', v_total - v_debit, 'payload', coalesce(p_payload, '{}'::jsonb)));
  end if;
  return jsonb_build_object('found', true, 'duplicate', false, 'debited', v_debit, 'shortfall', v_total - v_debit);
end $$;

-- Manual grants (admins) — audited.
create or replace function public.grant_premium(p_user uuid, p_days integer, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_until timestamptz;
begin
  if not public.has_admin_role(array['super_admin', 'admin', 'finance']::public.admin_role_type[]) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if coalesce(p_days, 0) <= 0 or p_days > 3650 then raise exception 'INVALID_DURATION' using errcode = '23514'; end if;
  select greatest(coalesce(s.expires_at, now()), now()) + make_interval(days => p_days) into v_until from (select 1) x left join public.subscriptions s on s.user_id = p_user and public.is_premium(p_user);
  insert into public.subscriptions (user_id, status, product_id, store, environment, period_type, purchased_at, expires_at, will_renew, granted_by, grant_reason)
  values (p_user, 'active', 'manual_grant', 'manual', 'production', 'promotional', now(), v_until, false, auth.uid(), p_reason)
  on conflict (user_id) do update set status = 'active', product_id = 'manual_grant', store = 'manual', period_type = 'promotional', expires_at = v_until, will_renew = false,
    billing_issue_detected_at = null, grace_period_expires_at = null, granted_by = auth.uid(), grant_reason = p_reason, updated_at = now();
  insert into public.subscription_events (user_id, provider, event_id, event_type, product_id, store, environment, payload)
  values (p_user, 'manual', 'manual:' || gen_random_uuid()::text, 'GRANT', 'manual_grant', 'manual', 'production', jsonb_build_object('days', p_days, 'reason', p_reason, 'admin', auth.uid()));
  perform public.log_admin_action('premium.grant', 'profile', p_user::text, jsonb_build_object('days', p_days, 'reason', p_reason, 'until', v_until));
  perform public.create_notification(p_user, null, 'subscription_update', 'subscription', p_user::text, jsonb_build_object('status', 'active', 'expires_at', v_until, 'granted', true));
  return jsonb_build_object('user_id', p_user, 'expires_at', v_until);
end $$;

create or replace function public.revoke_premium(p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_admin_role(array['super_admin', 'admin', 'finance']::public.admin_role_type[]) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.subscriptions set status = 'cancelled', expires_at = now(), will_renew = false, grace_period_expires_at = null, updated_at = now() where user_id = p_user;
  insert into public.subscription_events (user_id, provider, event_id, event_type, payload)
  values (p_user, 'manual', 'manual:' || gen_random_uuid()::text, 'REVOKE', jsonb_build_object('reason', p_reason, 'admin', auth.uid()));
  perform public.log_admin_action('premium.revoke', 'profile', p_user::text, jsonb_build_object('reason', p_reason));
end $$;

-- ----------------------------------------------------------------------------
-- Premium perks
-- ----------------------------------------------------------------------------
create or replace function public.record_profile_view(p_profile uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_profile is null or p_profile = auth.uid() or public.is_blocked_either(auth.uid(), p_profile) then return; end if;
  insert into public.profile_views (viewer_id, profile_id) values (auth.uid(), p_profile)
  on conflict (viewer_id, profile_id) do update set viewed_at = clock_timestamp(), views = public.profile_views.views + 1;
end $$;

create or replace function public.get_profile_viewers(p_limit integer default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  with v as (
    select pv.viewer_id, pv.viewed_at, pv.views from public.profile_views pv
    join public.profiles p on p.id = pv.viewer_id and p.account_status = 'active'
    where pv.profile_id = auth.uid() and pv.viewed_at > now() - interval '30 days' and not public.is_blocked_either(auth.uid(), pv.viewer_id)
  )
  select jsonb_build_object(
    'locked', not public.is_premium(auth.uid()),
    'count', (select count(*) from v),
    'viewers', case when public.is_premium(auth.uid())
      then coalesce((select jsonb_agg(public.profile_card_json(x.viewer_id) || jsonb_build_object('viewed_at', x.viewed_at, 'views', x.views) order by x.viewed_at desc)
                     from (select * from v order by viewed_at desc limit greatest(1, least(coalesce(p_limit, 30), 100))) x), '[]'::jsonb)
      else '[]'::jsonb end)
$$;

create or replace function public.get_match_admirers(p_limit integer default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  with a as (
    select mh.user_id, mh.created_at from public.match_history mh
    join public.profiles p on p.id = mh.user_id and p.account_status = 'active'
    where mh.candidate_id = auth.uid() and mh.action in ('friend', 'chat')
      and not exists (select 1 from public.match_history x where x.user_id = auth.uid() and x.candidate_id = mh.user_id)
      and not public.is_blocked_either(auth.uid(), mh.user_id)
  )
  select jsonb_build_object(
    'locked', not public.is_premium(auth.uid()),
    'count', (select count(*) from a),
    'people', case when public.is_premium(auth.uid())
      then coalesce((select jsonb_agg(public.profile_card_json(x.user_id) || jsonb_build_object('liked_at', x.created_at) order by x.created_at desc)
                     from (select * from a order by created_at desc limit greatest(1, least(coalesce(p_limit, 30), 100))) x), '[]'::jsonb)
      else '[]'::jsonb end)
$$;

create or replace function public.search_profiles_advanced(
  p_query text default '', p_country text default null, p_min_age integer default null, p_max_age integer default null, p_gender text default null,
  p_online_only boolean default false, p_verified_only boolean default false, p_interest_ids integer[] default null, p_limit integer default 20, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_premium_filter boolean;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  v_premium_filter := p_min_age is not null or p_max_age is not null or p_gender is not null or coalesce(p_online_only, false) or (p_interest_ids is not null and cardinality(p_interest_ids) > 0);
  if v_premium_filter and not public.is_premium(v_me) then
    raise exception 'PREMIUM_REQUIRED' using errcode = '42501', hint = 'Advanced filters are a Premium perk.';
  end if;
  return coalesce((
    select jsonb_agg(public.profile_card_json(x.id) || jsonb_build_object('bio', x.bio, 'followers_count', x.followers_count, 'is_online', x.is_online, 'shared_interests', x.shared) order by x.rank, x.popularity_score desc, x.created_at desc)
    from (
      select p.id, p.bio, p.followers_count, p.popularity_score, p.created_at,
             case when p.username = lower(trim(coalesce(p_query, ''))) then 0 else 1 end as rank,
             (coalesce(us.show_online_status, true) and coalesce(pr.is_online, false) and pr.last_seen_at > now() - interval '5 minutes') as is_online,
             (select count(*) from public.user_interests ui where ui.user_id = p.id and ui.interest_id in (select interest_id from public.user_interests where user_id = v_me)) as shared
      from public.profiles p
      left join public.user_private up on up.user_id = p.id
      left join public.user_settings us on us.user_id = p.id
      left join public.user_presence pr on pr.user_id = p.id
      where p.account_status = 'active' and p.id <> v_me and p.discoverable
        and not public.is_blocked_either(v_me, p.id)
        and (coalesce(trim(p_query), '') = '' or p.username ilike '%' || lower(trim(p_query)) || '%' or p.display_name ilike '%' || trim(p_query) || '%')
        and (p_country is null or p.country_code = upper(p_country))
        and (p_min_age is null or (up.birth_date is not null and date_part('year', age(up.birth_date)) >= p_min_age))
        and (p_max_age is null or (up.birth_date is not null and date_part('year', age(up.birth_date)) <= p_max_age))
        and (p_gender is null or (coalesce(us.show_gender, false) and up.gender::text = p_gender))
        and (not coalesce(p_online_only, false) or (coalesce(us.show_online_status, true) and coalesce(pr.is_online, false) and pr.last_seen_at > now() - interval '5 minutes'))
        and (not coalesce(p_verified_only, false) or p.is_verified)
        and (p_interest_ids is null or cardinality(p_interest_ids) = 0 or exists (select 1 from public.user_interests ui where ui.user_id = p.id and ui.interest_id = any (p_interest_ids)))
      limit greatest(1, least(coalesce(p_limit, 20), 50)) offset greatest(0, coalesce(p_offset, 0))
    ) x), '[]'::jsonb);
end $$;

create or replace function public.user_settings_premium_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.accent <> 'default' and new.accent is distinct from old.accent and not public.is_premium(new.user_id) then
    raise exception 'PREMIUM_REQUIRED' using errcode = '42501', hint = 'Accent themes are a Premium perk.';
  end if;
  return new;
end $$;
drop trigger if exists user_settings_premium_guard on public.user_settings;
create trigger user_settings_premium_guard before update on public.user_settings for each row execute function public.user_settings_premium_guard();

-- ----------------------------------------------------------------------------
-- Privileges & RLS
-- ----------------------------------------------------------------------------
do $do$
declare f text;
begin
  foreach f in array array[
    'public.is_premium(uuid)', 'public.premium_features()', 'public.get_premium_status()', 'public.record_profile_view(uuid)', 'public.get_profile_viewers(integer)',
    'public.get_match_admirers(integer)', 'public.search_profiles_advanced(text, text, integer, integer, text, boolean, boolean, integer[], integer, integer)',
    'public.grant_premium(uuid, integer, text)', 'public.revoke_premium(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  execute 'revoke all on function public.get_premium_plans() from public';
  execute 'grant execute on function public.get_premium_plans() to anon, authenticated, service_role';
  foreach f in array array[
    'public.sync_subscription(uuid, text, text, public.premium_status, text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, timestamptz, text, text, jsonb, text)',
    'public.record_coin_purchase(uuid, text, text, text, integer, text, text, jsonb, text)', 'public.refund_coin_purchase(text, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $do$;

alter table public.premium_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_events enable row level security;
alter table public.coin_purchases enable row level security;
alter table public.profile_views enable row level security;

drop policy if exists "premium_plans_select" on public.premium_plans;
create policy "premium_plans_select" on public.premium_plans for select using (is_active or public.is_admin());
drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own" on public.subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists "coin_purchases_select_own" on public.coin_purchases;
create policy "coin_purchases_select_own" on public.coin_purchases for select to authenticated using (user_id = auth.uid());
-- subscription_events / profile_views: no client policies (RPC only).
