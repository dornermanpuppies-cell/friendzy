-- ============================================================================
-- Friendzy — Phase 6: virtual economy
-- Wallets, append-only ledger, coin packages, gift catalogue, gifting with
-- platform commission, creator earnings, withdrawal requests and platform
-- settings. All balance changes happen in SECURITY DEFINER functions inside
-- transactions with row locks; clients can never write balances directly.
-- ============================================================================

do $do$ begin
  create type public.wallet_tx_kind as enum ('purchase', 'gift_sent', 'gift_received', 'withdrawal_hold', 'withdrawal_paid', 'withdrawal_refund', 'adjustment', 'bonus', 'refund');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.gift_tier as enum ('basic', 'rare', 'epic', 'legendary');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.gift_target as enum ('live', 'video', 'post', 'profile', 'message');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.withdrawal_status as enum ('pending', 'approved', 'rejected', 'paid', 'cancelled');
exception when duplicate_object then null; end $do$;

-- ----------------------------------------------------------------------------
-- Platform settings (admin managed; readable by clients for public keys)
-- ----------------------------------------------------------------------------
create table if not exists public.platform_settings (
  key        text primary key,
  value      jsonb not null,
  is_public  boolean not null default true,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
revoke all on public.platform_settings from anon, authenticated;
grant select on public.platform_settings to authenticated;

insert into public.platform_settings (key, value, is_public) values
  ('commission_rate', '0.30'::jsonb, true),
  ('coin_value_cents', '0.5'::jsonb, true),
  ('min_withdrawal_coins', '10000'::jsonb, true),
  ('payouts_enabled', 'false'::jsonb, true),
  ('gifting_min_age', '18'::jsonb, true),
  ('max_gift_quantity', '99'::jsonb, true),
  ('supported_countries', '[]'::jsonb, true),
  ('community_rules', '"Be respectful. Keep it safe. Be authentic."'::jsonb, true)
on conflict (key) do nothing;

create or replace function public.setting_numeric(p_key text, p_default numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::numeric from public.platform_settings where key = p_key), p_default)
$$;

create or replace function public.setting_bool(p_key text, p_default boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::boolean from public.platform_settings where key = p_key), p_default)
$$;

-- Premium check — replaced by the subscriptions migration; false until then.
create or replace function public.is_premium(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select false
$$;

-- ----------------------------------------------------------------------------
-- Wallets & ledger
-- ----------------------------------------------------------------------------
create table if not exists public.wallets (
  user_id            uuid primary key references public.profiles (id) on delete cascade,
  balance            bigint not null default 0,
  earnings_balance   bigint not null default 0,
  pending_earnings   bigint not null default 0,
  lifetime_purchased bigint not null default 0,
  lifetime_spent     bigint not null default 0,
  lifetime_received  bigint not null default 0,
  lifetime_withdrawn bigint not null default 0,
  updated_at         timestamptz not null default now(),
  constraint wallets_non_negative check (balance >= 0 and earnings_balance >= 0 and pending_earnings >= 0)
);
revoke all on public.wallets from anon, authenticated;
grant select on public.wallets to authenticated;

insert into public.wallets (user_id) select id from public.profiles on conflict do nothing;

create or replace function public.ensure_wallet()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.wallets (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists profiles_ensure_wallet on public.profiles;
create trigger profiles_ensure_wallet after insert on public.profiles for each row execute function public.ensure_wallet();

create table if not exists public.wallet_transactions (
  id              bigserial primary key,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  kind            public.wallet_tx_kind not null,
  coins           bigint not null,
  balance_after   bigint not null,
  earnings_after  bigint not null,
  reference_type  text,
  reference_id    text,
  idempotency_key text unique,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default clock_timestamp()
);
create index if not exists wallet_transactions_user_idx on public.wallet_transactions (user_id, created_at desc);
create index if not exists wallet_transactions_ref_idx on public.wallet_transactions (reference_type, reference_id);
revoke all on public.wallet_transactions from anon, authenticated;
grant select on public.wallet_transactions to authenticated;

-- ----------------------------------------------------------------------------
-- Coin packages & gift catalogue
-- ----------------------------------------------------------------------------
create table if not exists public.coin_packages (
  id          serial primary key,
  sku         text not null unique,
  title       text not null,
  coins       integer not null,
  bonus_coins integer not null default 0,
  price_cents integer not null,
  currency    text not null default 'USD',
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  constraint coin_packages_positive check (coins > 0 and price_cents > 0 and bonus_coins >= 0)
);
revoke all on public.coin_packages from anon, authenticated;
grant select on public.coin_packages to authenticated;
insert into public.coin_packages (sku, title, coins, bonus_coins, price_cents, sort_order) values
  ('friendzy_coins_100', 'Starter', 100, 0, 99, 1),
  ('friendzy_coins_550', 'Popular', 500, 50, 499, 2),
  ('friendzy_coins_1200', 'Creator', 1000, 200, 999, 3),
  ('friendzy_coins_3300', 'Supporter', 3000, 300, 2499, 4),
  ('friendzy_coins_7000', 'Superfan', 6000, 1000, 4999, 5),
  ('friendzy_coins_15000', 'Legend', 12000, 3000, 9999, 6)
on conflict (sku) do nothing;

create table if not exists public.gift_catalog (
  id              serial primary key,
  slug            text not null unique,
  name            text not null,
  emoji           text not null,
  coins           integer not null,
  tier            public.gift_tier not null default 'basic',
  animation       text not null default 'float',
  is_premium_only boolean not null default false,
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  constraint gift_catalog_coins check (coins > 0)
);
revoke all on public.gift_catalog from anon, authenticated;
grant select on public.gift_catalog to authenticated;
insert into public.gift_catalog (slug, name, emoji, coins, tier, animation, is_premium_only, sort_order) values
  ('heart', 'Heart', '❤️', 1, 'basic', 'float', false, 1),
  ('rose', 'Rose', '🌹', 5, 'basic', 'float', false, 2),
  ('clap', 'Applause', '👏', 10, 'basic', 'burst', false, 3),
  ('coffee', 'Coffee', '☕', 15, 'basic', 'float', false, 4),
  ('star', 'Star', '⭐', 25, 'basic', 'spin', false, 5),
  ('confetti', 'Confetti', '🎉', 50, 'rare', 'burst', false, 6),
  ('diamond', 'Diamond', '💎', 100, 'rare', 'sparkle', false, 7),
  ('microphone', 'Golden mic', '🎤', 250, 'rare', 'spin', false, 8),
  ('crown', 'Crown', '👑', 500, 'epic', 'rise', false, 9),
  ('rocket', 'Rocket', '🚀', 1000, 'epic', 'launch', false, 10),
  ('fireworks', 'Fireworks', '🎆', 2500, 'epic', 'fireworks', true, 11),
  ('sports_car', 'Sports car', '🏎️', 5000, 'legendary', 'drive', false, 12),
  ('castle', 'Castle', '🏰', 10000, 'legendary', 'rise', false, 13),
  ('dragon', 'Dragon', '🐉', 20000, 'legendary', 'fly', true, 14)
on conflict (slug) do nothing;

create table if not exists public.gifts (
  id               uuid primary key default gen_random_uuid(),
  sender_id        uuid not null references public.profiles (id) on delete cascade,
  receiver_id      uuid not null references public.profiles (id) on delete cascade,
  gift_id          integer not null references public.gift_catalog (id),
  quantity         integer not null default 1,
  coins_total      bigint not null,
  commission_coins bigint not null,
  net_coins        bigint not null,
  target_type      public.gift_target not null,
  target_id        uuid,
  message          text,
  created_at       timestamptz not null default clock_timestamp(),
  constraint gifts_quantity check (quantity between 1 and 99),
  constraint gifts_message_len check (message is null or char_length(message) <= 200)
);
create index if not exists gifts_receiver_idx on public.gifts (receiver_id, created_at desc);
create index if not exists gifts_sender_idx on public.gifts (sender_id, created_at desc);
create index if not exists gifts_target_idx on public.gifts (target_type, target_id, created_at desc);
revoke all on public.gifts from anon, authenticated;
grant select on public.gifts to authenticated;

create table if not exists public.withdrawal_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  coins        bigint not null,
  amount_cents integer not null,
  currency     text not null default 'USD',
  method       jsonb not null default '{}'::jsonb,
  status       public.withdrawal_status not null default 'pending',
  note         text,
  reviewed_by  uuid references auth.users (id) on delete set null,
  reviewed_at  timestamptz,
  paid_at      timestamptz,
  created_at   timestamptz not null default now(),
  constraint withdrawal_requests_positive check (coins > 0 and amount_cents >= 0)
);
create index if not exists withdrawal_requests_user_idx on public.withdrawal_requests (user_id, created_at desc);
create index if not exists withdrawal_requests_status_idx on public.withdrawal_requests (status, created_at);
revoke all on public.withdrawal_requests from anon, authenticated;
grant select on public.withdrawal_requests to authenticated;

-- ----------------------------------------------------------------------------
-- Core ledger primitive (never exposed to clients)
-- ----------------------------------------------------------------------------
create or replace function public.ledger_apply(
  p_user uuid, p_kind public.wallet_tx_kind, p_balance_delta bigint, p_earnings_delta bigint,
  p_reference_type text default null, p_reference_id text default null, p_idempotency_key text default null, p_metadata jsonb default '{}'::jsonb,
  p_pending_delta bigint default 0
) returns bigint language plpgsql security definer set search_path = public as $$
declare w public.wallets; v_tx bigint;
begin
  if p_idempotency_key is not null then
    select id into v_tx from public.wallet_transactions where idempotency_key = p_idempotency_key;
    if v_tx is not null then return v_tx; end if;
  end if;
  insert into public.wallets (user_id) values (p_user) on conflict do nothing;
  select * into w from public.wallets where user_id = p_user for update;
  if w.balance + p_balance_delta < 0 then raise exception 'INSUFFICIENT_COINS' using errcode = 'P0001', hint = 'You do not have enough coins.'; end if;
  if w.earnings_balance + p_earnings_delta < 0 then raise exception 'INSUFFICIENT_EARNINGS' using errcode = 'P0001', hint = 'Not enough available earnings.'; end if;
  if w.pending_earnings + p_pending_delta < 0 then raise exception 'INVALID_PENDING' using errcode = 'P0001'; end if;
  update public.wallets set
    balance = balance + p_balance_delta,
    earnings_balance = earnings_balance + p_earnings_delta,
    pending_earnings = pending_earnings + p_pending_delta,
    lifetime_purchased = lifetime_purchased + case when p_kind in ('purchase', 'bonus') and p_balance_delta > 0 then p_balance_delta else 0 end,
    lifetime_spent = lifetime_spent + case when p_kind = 'gift_sent' then -p_balance_delta else 0 end,
    lifetime_received = lifetime_received + case when p_kind = 'gift_received' then p_earnings_delta else 0 end,
    lifetime_withdrawn = lifetime_withdrawn + case when p_kind = 'withdrawal_paid' then -p_pending_delta else 0 end,
    updated_at = now()
  where user_id = p_user returning * into w;
  insert into public.wallet_transactions (user_id, kind, coins, balance_after, earnings_after, reference_type, reference_id, idempotency_key, metadata)
  values (p_user, p_kind, coalesce(nullif(p_balance_delta, 0), nullif(p_earnings_delta, 0), p_pending_delta), w.balance, w.earnings_balance, p_reference_type, p_reference_id, p_idempotency_key, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_tx;
  return v_tx;
end $$;

-- Service-role entry point used by store / payment webhooks.
create or replace function public.credit_coins(p_user uuid, p_coins bigint, p_kind public.wallet_tx_kind, p_reference_type text, p_reference_id text, p_idempotency_key text, p_metadata jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_coins = 0 then raise exception 'INVALID_AMOUNT' using errcode = '23514'; end if;
  if p_kind not in ('purchase', 'bonus', 'adjustment', 'refund') then raise exception 'INVALID_KIND' using errcode = '23514'; end if;
  return public.ledger_apply(p_user, p_kind, p_coins, 0, p_reference_type, p_reference_id, p_idempotency_key, p_metadata);
end $$;

-- Resolves who receives a gift for a target. The live migration extends it.
create or replace function public.resolve_gift_target(p_type public.gift_target, p_target uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  case p_type
    when 'profile' then select id into v from public.profiles where id = p_target and account_status = 'active';
    when 'video' then select author_id into v from public.videos where id = p_target and removed_at is null;
    when 'post' then select author_id into v from public.posts where id = p_target and removed_at is null;
    when 'message' then select m.user_id into v from public.conversation_members m join public.conversations c on c.id = m.conversation_id
                        where c.id = p_target and c.kind = 'direct' and m.user_id <> auth.uid() and public.is_conversation_member(p_target);
    when 'live' then raise exception 'LIVE_NOT_AVAILABLE' using errcode = 'P0001';
  end case;
  return v;
end $$;

create or replace function public.gift_json(g public.gifts)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', g.id, 'sender', public.profile_card_json(g.sender_id), 'receiver', public.profile_card_json(g.receiver_id),
    'gift', (select jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'emoji', c.emoji, 'coins', c.coins, 'tier', c.tier, 'animation', c.animation) from public.gift_catalog c where c.id = g.gift_id),
    'quantity', g.quantity, 'coins_total', g.coins_total, 'net_coins', g.net_coins, 'target_type', g.target_type, 'target_id', g.target_id, 'message', g.message, 'created_at', g.created_at)
$$;

create or replace function public.send_gift(p_gift_id integer, p_target_type public.gift_target, p_target_id uuid default null, p_quantity integer default 1, p_message text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid(); v_gift public.gift_catalog; v_receiver uuid; v_total bigint; v_commission bigint; v_net bigint; v_row public.gifts; v_rate numeric;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not coalesce(public.is_adult(v_me), false) then raise exception 'ADULTS_ONLY' using errcode = '42501', hint = 'Gifting is available from age 18.'; end if;
  select * into v_gift from public.gift_catalog where id = p_gift_id and is_active;
  if not found then raise exception 'GIFT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_gift.is_premium_only and not public.is_premium(v_me) then raise exception 'PREMIUM_REQUIRED' using errcode = '42501', hint = 'This gift is exclusive to Friendzy Premium.'; end if;
  if p_quantity < 1 or p_quantity > public.setting_numeric('max_gift_quantity', 99) then raise exception 'INVALID_QUANTITY' using errcode = '23514'; end if;
  v_receiver := public.resolve_gift_target(p_target_type, p_target_id);
  if v_receiver is null then raise exception 'TARGET_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_receiver = v_me then raise exception 'CANNOT_GIFT_SELF' using errcode = 'P0001'; end if;
  if public.is_blocked_either(v_me, v_receiver) then raise exception 'BLOCKED' using errcode = '42501'; end if;

  v_total := v_gift.coins::bigint * p_quantity;
  v_rate := least(0.9, greatest(0, public.setting_numeric('commission_rate', 0.30)));
  v_commission := floor(v_total * v_rate)::bigint;
  v_net := v_total - v_commission;

  insert into public.gifts (sender_id, receiver_id, gift_id, quantity, coins_total, commission_coins, net_coins, target_type, target_id, message)
  values (v_me, v_receiver, p_gift_id, p_quantity, v_total, v_commission, v_net, p_target_type, p_target_id, nullif(trim(coalesce(p_message, '')), ''))
  returning * into v_row;

  -- Debit sender (fails atomically on insufficient balance), credit creator earnings.
  perform public.ledger_apply(v_me, 'gift_sent', -v_total, 0, 'gift', v_row.id::text, 'gift_sent:' || v_row.id::text, jsonb_build_object('gift', v_gift.slug, 'quantity', p_quantity, 'receiver_id', v_receiver, 'target_type', p_target_type, 'target_id', p_target_id));
  perform public.ledger_apply(v_receiver, 'gift_received', 0, v_net, 'gift', v_row.id::text, 'gift_received:' || v_row.id::text, jsonb_build_object('gift', v_gift.slug, 'quantity', p_quantity, 'sender_id', v_me, 'gross', v_total, 'commission', v_commission, 'target_type', p_target_type, 'target_id', p_target_id));

  perform public.create_notification(v_receiver, v_me, 'gift_received', 'gift', v_row.id::text, jsonb_build_object('gift', v_gift.name, 'emoji', v_gift.emoji, 'coins', v_total, 'target_type', p_target_type, 'target_id', p_target_id));
  return jsonb_build_object('gift', public.gift_json(v_row), 'balance', (select balance from public.wallets where user_id = v_me));
end $$;

create or replace function public.get_wallet()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'balance', coalesce(w.balance, 0), 'earnings_balance', coalesce(w.earnings_balance, 0), 'pending_earnings', coalesce(w.pending_earnings, 0),
    'lifetime_purchased', coalesce(w.lifetime_purchased, 0), 'lifetime_spent', coalesce(w.lifetime_spent, 0), 'lifetime_received', coalesce(w.lifetime_received, 0), 'lifetime_withdrawn', coalesce(w.lifetime_withdrawn, 0),
    'coin_value_cents', public.setting_numeric('coin_value_cents', 0.5), 'min_withdrawal_coins', public.setting_numeric('min_withdrawal_coins', 10000),
    'payouts_enabled', public.setting_bool('payouts_enabled', false), 'commission_rate', public.setting_numeric('commission_rate', 0.30),
    'can_gift', coalesce(public.is_adult(auth.uid()), false))
  from (select 1) x left join public.wallets w on w.user_id = auth.uid()
$$;

create or replace function public.get_wallet_transactions(p_limit integer default 30, p_before bigint default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', t.id, 'kind', t.kind, 'coins', t.coins, 'balance_after', t.balance_after, 'earnings_after', t.earnings_after,
                            'reference_type', t.reference_type, 'reference_id', t.reference_id, 'metadata', t.metadata, 'created_at', t.created_at,
                            'gift', case when t.reference_type = 'gift' then (select public.gift_json(g) from public.gifts g where g.id = t.reference_id::uuid) else null end)
  from public.wallet_transactions t where t.user_id = auth.uid() and (p_before is null or t.id < p_before)
  order by t.id desc limit greatest(1, least(coalesce(p_limit, 30), 100))
$$;

create or replace function public.get_coin_packages()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'sku', p.sku, 'title', p.title, 'coins', p.coins, 'bonus_coins', p.bonus_coins, 'price_cents', p.price_cents, 'currency', p.currency) order by p.sort_order), '[]'::jsonb)
  from public.coin_packages p where p.is_active
$$;

create or replace function public.get_gift_catalog()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'slug', g.slug, 'name', g.name, 'emoji', g.emoji, 'coins', g.coins, 'tier', g.tier, 'animation', g.animation, 'is_premium_only', g.is_premium_only) order by g.sort_order), '[]'::jsonb)
  from public.gift_catalog g where g.is_active
$$;

create or replace function public.get_received_gifts(p_limit integer default 30, p_before timestamptz default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.gift_json(g) from public.gifts g where g.receiver_id = auth.uid() and (p_before is null or g.created_at < p_before) order by g.created_at desc limit greatest(1, least(coalesce(p_limit, 30), 100))
$$;

create or replace function public.get_sent_gifts(p_limit integer default 30, p_before timestamptz default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.gift_json(g) from public.gifts g where g.sender_id = auth.uid() and (p_before is null or g.created_at < p_before) order by g.created_at desc limit greatest(1, least(coalesce(p_limit, 30), 100))
$$;

create or replace function public.get_top_supporters(p_creator uuid, p_limit integer default 10)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('user', public.profile_card_json(t.sender_id), 'coins', t.coins, 'gifts', t.n) order by t.coins desc), '[]'::jsonb)
  from (select g.sender_id, sum(g.coins_total) as coins, count(*) as n from public.gifts g where g.receiver_id = p_creator and public.can_view_profile(p_creator) group by g.sender_id order by coins desc limit greatest(1, least(coalesce(p_limit, 10), 50))) t
$$;

create or replace function public.get_earnings_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'wallet', public.get_wallet(),
    'gifts_30d', (select count(*) from public.gifts where receiver_id = auth.uid() and created_at > now() - interval '30 days'),
    'coins_30d', (select coalesce(sum(net_coins), 0) from public.gifts where receiver_id = auth.uid() and created_at > now() - interval '30 days'),
    'gross_30d', (select coalesce(sum(coins_total), 0) from public.gifts where receiver_id = auth.uid() and created_at > now() - interval '30 days'),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'coins', coalesce(x.coins, 0)) order by d.day)
              from generate_series(date_trunc('day', now() - interval '29 days'), date_trunc('day', now()), interval '1 day') as d(day)
              left join (select date_trunc('day', created_at) as day, sum(net_coins) as coins from public.gifts where receiver_id = auth.uid() and created_at > now() - interval '30 days' group by 1) x on x.day = d.day), '[]'::jsonb),
    'top_gifts', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'emoji', c.emoji, 'count', t.n, 'coins', t.coins) order by t.coins desc)
                 from (select gift_id, count(*) n, sum(coins_total) coins from public.gifts where receiver_id = auth.uid() group by gift_id order by coins desc limit 5) t join public.gift_catalog c on c.id = t.gift_id), '[]'::jsonb),
    'top_supporters', public.get_top_supporters(auth.uid(), 5),
    'withdrawals', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'coins', w.coins, 'amount_cents', w.amount_cents, 'currency', w.currency, 'status', w.status, 'note', w.note, 'created_at', w.created_at, 'paid_at', w.paid_at) order by w.created_at desc)
                     from (select * from public.withdrawal_requests where user_id = auth.uid() order by created_at desc limit 20) w), '[]'::jsonb))
$$;

create or replace function public.request_withdrawal(p_coins bigint, p_method jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_min bigint; v_cents integer; v_id uuid;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not public.setting_bool('payouts_enabled', false) then
    raise exception 'WITHDRAWALS_DISABLED' using errcode = 'P0001', hint = 'Withdrawals open once payout provider and identity verification are live. Your earnings are safe in your balance.';
  end if;
  if not coalesce(public.is_adult(v_me), false) then raise exception 'ADULTS_ONLY' using errcode = '42501'; end if;
  v_min := public.setting_numeric('min_withdrawal_coins', 10000)::bigint;
  if p_coins < v_min then raise exception 'BELOW_MINIMUM' using errcode = 'P0001', hint = format('Minimum withdrawal is %s coins.', v_min); end if;
  if exists (select 1 from public.withdrawal_requests where user_id = v_me and status in ('pending', 'approved')) then
    raise exception 'WITHDRAWAL_PENDING' using errcode = 'P0001', hint = 'You already have a withdrawal in progress.';
  end if;
  if p_method is null or coalesce(p_method->>'type', '') = '' then raise exception 'METHOD_REQUIRED' using errcode = '23514', hint = 'Choose a payout method.'; end if;
  v_cents := floor(p_coins * public.setting_numeric('coin_value_cents', 0.5))::integer;
  insert into public.withdrawal_requests (user_id, coins, amount_cents, method) values (v_me, p_coins, v_cents, p_method) returning id into v_id;
  perform public.ledger_apply(v_me, 'withdrawal_hold', 0, -p_coins, 'withdrawal', v_id::text, 'withdrawal_hold:' || v_id::text, jsonb_build_object('amount_cents', v_cents), p_coins);
  return jsonb_build_object('id', v_id, 'coins', p_coins, 'amount_cents', v_cents, 'status', 'pending');
end $$;

create or replace function public.cancel_withdrawal(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare w public.withdrawal_requests;
begin
  select * into w from public.withdrawal_requests where id = p_id and user_id = auth.uid() for update;
  if not found or w.status <> 'pending' then raise exception 'WITHDRAWAL_NOT_CANCELLABLE' using errcode = 'P0001'; end if;
  update public.withdrawal_requests set status = 'cancelled', reviewed_at = now() where id = p_id;
  perform public.ledger_apply(w.user_id, 'withdrawal_refund', 0, w.coins, 'withdrawal', w.id::text, 'withdrawal_refund:' || w.id::text, '{}'::jsonb, -w.coins);
end $$;

create or replace function public.get_public_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.platform_settings where is_public
$$;

-- ----------------------------------------------------------------------------
-- Privileges & RLS
-- ----------------------------------------------------------------------------
do $do$
declare f text;
begin
  foreach f in array array[
    'public.setting_numeric(text, numeric)', 'public.setting_bool(text, boolean)', 'public.is_premium(uuid)', 'public.gift_json(public.gifts)',
    'public.send_gift(integer, public.gift_target, uuid, integer, text)', 'public.get_wallet()', 'public.get_wallet_transactions(integer, bigint)',
    'public.get_coin_packages()', 'public.get_gift_catalog()', 'public.get_received_gifts(integer, timestamptz)', 'public.get_sent_gifts(integer, timestamptz)',
    'public.get_top_supporters(uuid, integer)', 'public.get_earnings_summary()', 'public.request_withdrawal(bigint, jsonb)', 'public.cancel_withdrawal(uuid)', 'public.get_public_settings()',
    'public.resolve_gift_target(public.gift_target, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['public.ledger_apply(uuid, public.wallet_tx_kind, bigint, bigint, text, text, text, jsonb, bigint)', 'public.credit_coins(uuid, bigint, public.wallet_tx_kind, text, text, text, jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- Admins call credit_coins through the admin RPCs (0010) which run as definer; direct execute stays service-only.
end $do$;

alter table public.platform_settings enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.coin_packages enable row level security;
alter table public.gift_catalog enable row level security;
alter table public.gifts enable row level security;
alter table public.withdrawal_requests enable row level security;

drop policy if exists "platform_settings_select" on public.platform_settings;
create policy "platform_settings_select" on public.platform_settings for select to authenticated using (is_public or public.is_admin());
drop policy if exists "wallets_own" on public.wallets;
create policy "wallets_own" on public.wallets for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "wallet_transactions_own" on public.wallet_transactions;
create policy "wallet_transactions_own" on public.wallet_transactions for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "coin_packages_select" on public.coin_packages;
create policy "coin_packages_select" on public.coin_packages for select to authenticated using (is_active or public.is_admin());
drop policy if exists "gift_catalog_select" on public.gift_catalog;
create policy "gift_catalog_select" on public.gift_catalog for select to authenticated using (is_active or public.is_admin());
drop policy if exists "gifts_select" on public.gifts;
create policy "gifts_select" on public.gifts for select to authenticated using (sender_id = auth.uid() or receiver_id = auth.uid() or public.is_admin());
drop policy if exists "withdrawal_requests_own" on public.withdrawal_requests;
create policy "withdrawal_requests_own" on public.withdrawal_requests for select to authenticated using (user_id = auth.uid() or public.is_admin());

do $do$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wallets') then
    alter publication supabase_realtime add table public.wallets;
  end if;
end $do$;
alter table public.wallets replica identity full;
