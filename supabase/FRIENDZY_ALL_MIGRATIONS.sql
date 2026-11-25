-- ============================================================================
-- Friendzy — ALL database migrations in order (regenerate with: npm run db:combine)
-- Paste into Supabase SQL Editor (project gwdpsrjmfrgcloacvdlg) and run once.
-- Idempotent where practical: re-running skips objects that already exist.
-- Source files: supabase/migrations/*.sql
-- ============================================================================


-- ########## 20261125000001_foundation.sql ##########

-- ============================================================================
-- Friendzy — Phase 1 foundation schema
-- Identity, profiles, settings, interests, social graph primitives,
-- notifications, reports, devices, presence, admin roles and storage buckets.
--
-- Safe to run on a fresh Supabase project. Idempotent where practical.
-- Apply with `supabase db push` or paste into the SQL editor.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
do $do$ begin
  create type public.gender_type as enum ('woman', 'man', 'non_binary', 'other', 'prefer_not_to_say');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.account_status_type as enum ('active', 'suspended', 'banned', 'deactivated');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.admin_role_type as enum ('super_admin', 'admin', 'moderator', 'support', 'finance');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.request_status as enum ('pending', 'accepted', 'declined', 'cancelled');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.audience_type as enum ('everyone', 'followers', 'friends', 'nobody');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.theme_preference as enum ('system', 'light', 'dark');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.report_target_type as enum ('profile', 'post', 'video', 'comment', 'message', 'live', 'gift', 'other');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.report_status as enum ('open', 'in_review', 'resolved', 'dismissed');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.device_platform as enum ('ios', 'android', 'web');
exception when duplicate_object then null; end $do$;

-- ----------------------------------------------------------------------------
-- Generic helpers
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function public.username_regex()
returns text language sql immutable as $$
  select '^[a-z0-9_](?:[a-z0-9_]|\.(?=[a-z0-9_])){1,28}[a-z0-9_]$'
$$;

create or replace function public.is_reserved_username(p_username text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_username, '')) = any (array[
    'admin','administrator','friendzy','friendzyapp','friendzy_official','official','support','help',
    'root','api','www','mail','null','undefined','me','settings','login','signin','signup','register',
    'about','terms','privacy','live','discover','home','create','inbox','notifications','explore',
    'search','moderator','staff','team','system','security','billing','premium','auth','onboarding',
    'u','user','users','profile','profiles','account','accounts','wallet','games','legal','contact',
    'download','features','guidelines','press','careers','blog','status','dev','developer','developers',
    'test','tests','store','shop','app','apps','messages','calls','video','videos','stories','story'
  ])
$$;

-- ----------------------------------------------------------------------------
-- Admin roles (never writable from clients)
-- ----------------------------------------------------------------------------
create table if not exists public.admin_roles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       public.admin_role_type not null default 'moderator',
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.role(), '') = 'service_role'
      or exists (select 1 from public.admin_roles ar where ar.user_id = auth.uid())
$$;

create or replace function public.has_admin_role(p_roles public.admin_role_type[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.role(), '') = 'service_role'
      or exists (
        select 1 from public.admin_roles ar
        where ar.user_id = auth.uid() and (ar.role = any (p_roles) or ar.role = 'super_admin')
      )
$$;

create table if not exists public.admin_audit_logs (
  id          bigserial primary key,
  admin_id    uuid references auth.users (id) on delete set null,
  action      text not null,
  target_type text,
  target_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists admin_audit_logs_admin_idx on public.admin_audit_logs (admin_id, created_at desc);

-- Defence in depth: clients get read-only access (further restricted by RLS); writes are server-only.
revoke all on public.admin_roles from anon, authenticated;
revoke all on public.admin_audit_logs from anon, authenticated;
grant select on public.admin_roles to authenticated;
grant select on public.admin_audit_logs to authenticated;

-- ----------------------------------------------------------------------------
-- Profiles (public identity)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  username             text not null,
  display_name         text not null,
  bio                  text,
  avatar_url           text,
  cover_url            text,
  country_code         text,
  city                 text,
  website              text,
  is_verified          boolean not null default false,
  is_private           boolean not null default false,
  discoverable         boolean not null default true,
  account_status       public.account_status_type not null default 'active',
  onboarding_completed boolean not null default false,
  onboarding_step      smallint not null default 0,
  followers_count      integer not null default 0,
  following_count      integer not null default 0,
  friends_count        integer not null default 0,
  posts_count          integer not null default 0,
  videos_count         integer not null default 0,
  likes_count          integer not null default 0,
  popularity_score     numeric(12, 2) not null default 0,
  username_changed_at  timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint profiles_username_format  check (username ~ public.username_regex()),
  constraint profiles_username_lower   check (username = lower(username)),
  constraint profiles_display_name_len check (char_length(display_name) between 1 and 50),
  constraint profiles_bio_len          check (bio is null or char_length(bio) <= 300),
  constraint profiles_country_format   check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  constraint profiles_city_len         check (city is null or char_length(city) <= 80),
  constraint profiles_website_len      check (website is null or char_length(website) <= 200),
  constraint profiles_onboarding_step  check (onboarding_step between 0 and 20)
);

create unique index if not exists profiles_username_key      on public.profiles (username);
create index if not exists profiles_username_trgm            on public.profiles using gin (username extensions.gin_trgm_ops);
create index if not exists profiles_display_name_trgm        on public.profiles using gin (display_name extensions.gin_trgm_ops);
create index if not exists profiles_country_idx              on public.profiles (country_code);
create index if not exists profiles_created_idx              on public.profiles (created_at desc);
create index if not exists profiles_popularity_idx           on public.profiles (popularity_score desc);

-- Clients may only update their own non-sensitive columns.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username, display_name, bio, avatar_url, cover_url, country_code, city, website,
              is_private, discoverable, onboarding_completed, onboarding_step)
  on public.profiles to authenticated;

create or replace function public.profiles_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.username is distinct from old.username then
    if public.is_reserved_username(new.username) and not public.is_admin() then
      raise exception 'USERNAME_RESERVED' using errcode = '23514', hint = 'That username is reserved.';
    end if;
    if old.username_changed_at is not null
       and old.username_changed_at > now() - interval '14 days'
       and not public.is_admin() then
      raise exception 'USERNAME_COOLDOWN' using errcode = 'P0001',
        hint = 'You can change your username once every 14 days.';
    end if;
    new.username_changed_at = now();
  end if;
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_before_update on public.profiles;
create trigger profiles_before_update before update on public.profiles
  for each row execute function public.profiles_before_update();

-- ----------------------------------------------------------------------------
-- Private user data (never readable by other users)
-- ----------------------------------------------------------------------------
create table if not exists public.user_private (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  email             text,
  birth_date        date,
  gender            public.gender_type,
  phone             text,
  terms_accepted_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

revoke all on public.user_private from anon, authenticated;
grant select on public.user_private to authenticated;
grant update (gender, phone) on public.user_private to authenticated;

create or replace function public.user_private_validate()
returns trigger language plpgsql as $$
begin
  if new.birth_date is not null then
    if new.birth_date > (current_date - interval '16 years') then
      raise exception 'AGE_REQUIREMENT' using errcode = '23514',
        hint = 'You must be at least 16 years old to use Friendzy.';
    end if;
    if new.birth_date < (current_date - interval '120 years') then
      raise exception 'INVALID_BIRTH_DATE' using errcode = '23514';
    end if;
  end if;
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists user_private_validate on public.user_private;
create trigger user_private_validate before insert or update on public.user_private
  for each row execute function public.user_private_validate();

create or replace function public.user_age(p_user uuid)
returns integer language sql stable security definer set search_path = public as $$
  select extract(year from age(current_date, up.birth_date))::int
  from public.user_private up where up.user_id = p_user
$$;

-- Only reveals the caller's own (or, for admins, anyone's) adult status.
create or replace function public.is_adult(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_user = auth.uid() or public.is_admin() then coalesce(public.user_age(p_user) >= 18, false)
    else false
  end
$$;

-- ----------------------------------------------------------------------------
-- User settings & notification preferences
-- ----------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  theme                public.theme_preference not null default 'system',
  language             text not null default 'en',
  show_online_status   boolean not null default true,
  show_last_seen       boolean not null default true,
  show_gender          boolean not null default false,
  show_country         boolean not null default true,
  nearby_enabled       boolean not null default false,
  random_match_enabled boolean not null default true,
  who_can_message      public.audience_type not null default 'everyone',
  who_can_comment      public.audience_type not null default 'everyone',
  who_can_see_friends  public.audience_type not null default 'everyone',
  story_audience       public.audience_type not null default 'followers',
  read_receipts        boolean not null default true,
  looking_for          text[] not null default '{}',
  preferred_min_age    smallint,
  preferred_max_age    smallint,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint user_settings_language_len check (char_length(language) between 2 and 10),
  constraint user_settings_age_range check (
    preferred_min_age is null or preferred_max_age is null
    or (preferred_min_age >= 16 and preferred_max_age <= 120 and preferred_min_age <= preferred_max_age)
  ),
  constraint user_settings_looking_for_len check (cardinality(looking_for) <= 10)
);

revoke all on public.user_settings from anon, authenticated;
grant select, update on public.user_settings to authenticated;

drop trigger if exists user_settings_updated_at on public.user_settings;
create trigger user_settings_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();

create table if not exists public.notification_preferences (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  push_enabled    boolean not null default true,
  email_enabled   boolean not null default true,
  new_followers   boolean not null default true,
  friend_requests boolean not null default true,
  likes           boolean not null default true,
  comments        boolean not null default true,
  mentions        boolean not null default true,
  reposts         boolean not null default true,
  messages        boolean not null default true,
  calls           boolean not null default true,
  live            boolean not null default true,
  gifts           boolean not null default true,
  subscription    boolean not null default true,
  security        boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

revoke all on public.notification_preferences from anon, authenticated;
grant select, update on public.notification_preferences to authenticated;

drop trigger if exists notification_preferences_updated_at on public.notification_preferences;
create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Interests
-- ----------------------------------------------------------------------------
create table if not exists public.interests (
  id         serial primary key,
  slug       text not null unique,
  name       text not null,
  emoji      text,
  category   text not null default 'general',
  sort_order integer not null default 0,
  is_active  boolean not null default true
);

revoke all on public.interests from anon, authenticated;
grant select on public.interests to authenticated;

insert into public.interests (slug, name, emoji, category, sort_order) values
  ('music', 'Music', '🎵', 'Entertainment', 1),
  ('movies', 'Movies & Series', '🎬', 'Entertainment', 2),
  ('gaming', 'Gaming', '🎮', 'Entertainment', 3),
  ('anime', 'Anime & Manga', '🍥', 'Entertainment', 4),
  ('kpop', 'K-Pop', '💜', 'Entertainment', 5),
  ('comedy', 'Comedy & Memes', '😂', 'Entertainment', 6),
  ('live-streaming', 'Live streaming', '📡', 'Entertainment', 7),
  ('podcasts', 'Podcasts', '🎙️', 'Entertainment', 8),
  ('football', 'Football', '⚽', 'Sports', 10),
  ('basketball', 'Basketball', '🏀', 'Sports', 11),
  ('fitness', 'Fitness & Gym', '💪', 'Sports', 12),
  ('running', 'Running', '🏃', 'Sports', 13),
  ('yoga', 'Yoga & Wellness', '🧘', 'Sports', 14),
  ('esports', 'Esports', '🏆', 'Sports', 15),
  ('travel', 'Travel', '✈️', 'Lifestyle', 20),
  ('food', 'Food & Cooking', '🍜', 'Lifestyle', 21),
  ('fashion', 'Fashion', '👗', 'Lifestyle', 22),
  ('beauty', 'Beauty & Skincare', '💄', 'Lifestyle', 23),
  ('pets', 'Pets & Animals', '🐶', 'Lifestyle', 24),
  ('cars', 'Cars & Motors', '🏎️', 'Lifestyle', 25),
  ('coffee', 'Coffee & Cafés', '☕', 'Lifestyle', 26),
  ('nightlife', 'Nightlife & Parties', '🪩', 'Lifestyle', 27),
  ('photography', 'Photography', '📸', 'Creative', 30),
  ('art', 'Art & Design', '🎨', 'Creative', 31),
  ('dance', 'Dance', '💃', 'Creative', 32),
  ('singing', 'Singing', '🎤', 'Creative', 33),
  ('writing', 'Writing & Poetry', '✍️', 'Creative', 34),
  ('content-creation', 'Content creation', '🎥', 'Creative', 35),
  ('diy', 'DIY & Crafts', '🧶', 'Creative', 36),
  ('technology', 'Technology', '💻', 'Tech & Learning', 40),
  ('ai', 'AI & Future', '🤖', 'Tech & Learning', 41),
  ('crypto', 'Crypto & Finance', '📈', 'Tech & Learning', 42),
  ('science', 'Science & Space', '🚀', 'Tech & Learning', 43),
  ('books', 'Books & Reading', '📚', 'Tech & Learning', 44),
  ('languages', 'Language exchange', '🗣️', 'Tech & Learning', 45),
  ('entrepreneurship', 'Startups & Business', '💼', 'Tech & Learning', 46),
  ('history', 'History & Culture', '🏛️', 'Tech & Learning', 47),
  ('making-friends', 'Making new friends', '🤝', 'Social', 50),
  ('deep-talks', 'Deep conversations', '💭', 'Social', 51),
  ('voice-chats', 'Voice chats', '🎧', 'Social', 52),
  ('board-games', 'Board games & Trivia', '🎲', 'Social', 53),
  ('volunteering', 'Volunteering', '🌍', 'Social', 54),
  ('spirituality', 'Spirituality', '🕊️', 'Social', 55),
  ('nature', 'Nature & Outdoors', '🌿', 'Lifestyle', 28),
  ('parenting', 'Parenting', '👶', 'Lifestyle', 29),
  ('motivation', 'Motivation & Growth', '🌟', 'Social', 56),
  ('memes-gaming-clips', 'Short videos', '📱', 'Entertainment', 9),
  ('tv-reality', 'Reality TV', '📺', 'Entertainment', 10)
on conflict (slug) do nothing;

create table if not exists public.user_interests (
  user_id     uuid not null references auth.users (id) on delete cascade,
  interest_id integer not null references public.interests (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, interest_id)
);
create index if not exists user_interests_interest_idx on public.user_interests (interest_id);

revoke all on public.user_interests from anon, authenticated;
grant select, insert, delete on public.user_interests to authenticated;

create or replace function public.user_interests_limit()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.user_interests ui where ui.user_id = new.user_id) >= 10 then
    raise exception 'INTEREST_LIMIT' using errcode = 'P0001', hint = 'You can pick up to 10 interests.';
  end if;
  return new;
end $$;

drop trigger if exists user_interests_limit on public.user_interests;
create trigger user_interests_limit before insert on public.user_interests
  for each row execute function public.user_interests_limit();

-- ----------------------------------------------------------------------------
-- Blocks (declared early: referenced by visibility helpers)
-- ----------------------------------------------------------------------------
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_no_self check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

revoke all on public.blocks from anon, authenticated;
grant select on public.blocks to authenticated;

create or replace function public.is_blocked_either(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_a is not null and p_b is not null and exists (
    select 1 from public.blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b)
       or (b.blocker_id = p_b and b.blocked_id = p_a)
  )
$$;

create or replace function public.can_view_profile(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then false
    when p_profile = auth.uid() then true
    when public.is_admin() then true
    else exists (select 1 from public.profiles p where p.id = p_profile and p.account_status = 'active')
         and not public.is_blocked_either(auth.uid(), p_profile)
  end
$$;

-- ----------------------------------------------------------------------------
-- Social graph: follows, follow requests, friend requests, friendships
-- ----------------------------------------------------------------------------
-- Social tables reference public.profiles (not auth.users) so PostgREST can embed
-- profile rows (e.g. profiles!follows_follower_id_fkey). Deletes still cascade from auth.users.
create table if not exists public.follows (
  follower_id  uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self check (follower_id <> following_id)
);
create index if not exists follows_following_idx on public.follows (following_id, created_at desc);
create index if not exists follows_follower_idx  on public.follows (follower_id, created_at desc);

revoke all on public.follows from anon, authenticated;
grant select, delete on public.follows to authenticated;

create table if not exists public.follow_requests (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  target_id    uuid not null references public.profiles (id) on delete cascade,
  status       public.request_status not null default 'pending',
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  constraint follow_requests_no_self check (requester_id <> target_id)
);
create unique index if not exists follow_requests_pending_key
  on public.follow_requests (requester_id, target_id) where status = 'pending';
create index if not exists follow_requests_target_idx on public.follow_requests (target_id, status, created_at desc);

revoke all on public.follow_requests from anon, authenticated;
grant select on public.follow_requests to authenticated;

create table if not exists public.friend_requests (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.profiles (id) on delete cascade,
  receiver_id  uuid not null references public.profiles (id) on delete cascade,
  status       public.request_status not null default 'pending',
  message      text,
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_no_self check (sender_id <> receiver_id),
  constraint friend_requests_message_len check (message is null or char_length(message) <= 200)
);
create unique index if not exists friend_requests_pending_key
  on public.friend_requests (sender_id, receiver_id) where status = 'pending';
create index if not exists friend_requests_receiver_idx on public.friend_requests (receiver_id, status, created_at desc);
create index if not exists friend_requests_sender_idx   on public.friend_requests (sender_id, status, created_at desc);

revoke all on public.friend_requests from anon, authenticated;
grant select on public.friend_requests to authenticated;

create table if not exists public.friendships (
  user_a     uuid not null references public.profiles (id) on delete cascade,
  user_b     uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  constraint friendships_ordered check (user_a < user_b)
);
create index if not exists friendships_user_b_idx on public.friendships (user_b);

revoke all on public.friendships from anon, authenticated;
grant select, delete on public.friendships to authenticated;

-- ----------------------------------------------------------------------------
-- Notifications
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  actor_id    uuid references public.profiles (id) on delete cascade,
  type        text not null,
  entity_type text,
  entity_id   text,
  data        jsonb not null default '{}'::jsonb,
  is_read     boolean not null default false,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx   on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where is_read = false;

revoke all on public.notifications from anon, authenticated;
grant select, delete on public.notifications to authenticated;
grant update (is_read, read_at) on public.notifications to authenticated;

create or replace function public.create_notification(
  p_user uuid, p_actor uuid, p_type text,
  p_entity_type text default null, p_entity_id text default null, p_data jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_user is null or p_user = p_actor then return null; end if;
  if public.is_blocked_either(p_user, p_actor) then return null; end if;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, data)
  values (p_user, p_actor, p_type, p_entity_type, p_entity_id, coalesce(p_data, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

-- ----------------------------------------------------------------------------
-- Counters & side effects
-- ----------------------------------------------------------------------------
create or replace function public.on_follow_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set following_count = following_count + 1 where id = new.follower_id;
    update public.profiles set followers_count = followers_count + 1,
                               popularity_score = popularity_score + 1 where id = new.following_id;
    perform public.create_notification(new.following_id, new.follower_id, 'new_follower', 'profile', new.follower_id::text);
    return new;
  elsif tg_op = 'DELETE' then
    update public.profiles set following_count = greatest(0, following_count - 1) where id = old.follower_id;
    update public.profiles set followers_count = greatest(0, followers_count - 1),
                               popularity_score = greatest(0, popularity_score - 1) where id = old.following_id;
    return old;
  end if;
  return null;
end $$;

drop trigger if exists follows_after_change on public.follows;
create trigger follows_after_change after insert or delete on public.follows
  for each row execute function public.on_follow_change();

create or replace function public.on_friendship_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set friends_count = friends_count + 1 where id in (new.user_a, new.user_b);
    return new;
  elsif tg_op = 'DELETE' then
    update public.profiles set friends_count = greatest(0, friends_count - 1) where id in (old.user_a, old.user_b);
    return old;
  end if;
  return null;
end $$;

drop trigger if exists friendships_after_change on public.friendships;
create trigger friendships_after_change after insert or delete on public.friendships
  for each row execute function public.on_friendship_change();

create or replace function public.on_block_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.follows
   where (follower_id = new.blocker_id and following_id = new.blocked_id)
      or (follower_id = new.blocked_id and following_id = new.blocker_id);
  delete from public.friendships
   where user_a = least(new.blocker_id, new.blocked_id) and user_b = greatest(new.blocker_id, new.blocked_id);
  update public.friend_requests set status = 'cancelled', responded_at = now()
   where status = 'pending'
     and ((sender_id = new.blocker_id and receiver_id = new.blocked_id)
       or (sender_id = new.blocked_id and receiver_id = new.blocker_id));
  update public.follow_requests set status = 'cancelled', responded_at = now()
   where status = 'pending'
     and ((requester_id = new.blocker_id and target_id = new.blocked_id)
       or (requester_id = new.blocked_id and target_id = new.blocker_id));
  return new;
end $$;

drop trigger if exists blocks_after_insert on public.blocks;
create trigger blocks_after_insert after insert on public.blocks
  for each row execute function public.on_block_created();

-- ----------------------------------------------------------------------------
-- Reports
-- ----------------------------------------------------------------------------
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type public.report_target_type not null,
  target_id   text not null,
  reason      text not null,
  details     text,
  status      public.report_status not null default 'open',
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  resolution  text,
  created_at  timestamptz not null default now(),
  constraint reports_reason_len  check (char_length(reason) between 2 and 60),
  constraint reports_details_len check (details is null or char_length(details) <= 1000)
);
create index if not exists reports_status_idx   on public.reports (status, created_at desc);
create index if not exists reports_target_idx   on public.reports (target_type, target_id);
create index if not exists reports_reporter_idx on public.reports (reporter_id, created_at desc);

revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;
grant insert (reporter_id, target_type, target_id, reason, details) on public.reports to authenticated;

-- ----------------------------------------------------------------------------
-- Devices (push tokens) & presence
-- ----------------------------------------------------------------------------
create table if not exists public.user_devices (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  platform       public.device_platform not null,
  push_token     text,
  device_name    text,
  app_version    text,
  last_active_at timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create unique index if not exists user_devices_token_key on public.user_devices (user_id, push_token) where push_token is not null;
create index if not exists user_devices_user_idx on public.user_devices (user_id);

revoke all on public.user_devices from anon, authenticated;
grant select, insert, update, delete on public.user_devices to authenticated;

create table if not exists public.user_presence (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  is_online    boolean not null default false,
  last_seen_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

revoke all on public.user_presence from anon, authenticated;
grant select on public.user_presence to authenticated;

-- ----------------------------------------------------------------------------
-- New-user bootstrap (profile + private + settings + preferences + presence)
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_username text;
  v_display  text;
  v_birth    date;
  v_country  text;
  v_gender   public.gender_type;
  v_base     text;
  v_try      integer := 0;
  v_meta     jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  v_display := nullif(trim(coalesce(v_meta->>'display_name', '')), '');
  if v_display is null then
    v_display := split_part(coalesce(new.email, 'friend'), '@', 1);
  end if;
  v_display := left(v_display, 50);

  v_username := lower(nullif(trim(coalesce(v_meta->>'username', '')), ''));
  if v_username is null or v_username !~ public.username_regex() or public.is_reserved_username(v_username) then
    v_base := regexp_replace(lower(split_part(coalesce(new.email, 'friend'), '@', 1)), '[^a-z0-9_]', '', 'g');
    if length(v_base) < 3 then v_base := 'friend'; end if;
    v_username := left(v_base, 20);
    if public.is_reserved_username(v_username) then v_username := v_username || '_' || floor(random() * 900 + 100)::int::text; end if;
  end if;

  v_base := v_username;
  while exists (select 1 from public.profiles p where p.username = v_username) loop
    v_try := v_try + 1;
    v_username := left(v_base, 20) || floor(random() * 9000 + 1000)::int::text;
    if v_try > 25 then
      v_username := 'friend_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    end if;
  end loop;

  begin
    v_birth := nullif(v_meta->>'birth_date', '')::date;
  exception when others then
    v_birth := null;
  end;

  v_country := upper(nullif(trim(coalesce(v_meta->>'country_code', '')), ''));
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then v_country := null; end if;

  begin
    v_gender := nullif(v_meta->>'gender', '')::public.gender_type;
  exception when others then
    v_gender := null;
  end;

  insert into public.profiles (id, username, display_name, country_code)
  values (new.id, v_username, v_display, v_country);

  insert into public.user_private (user_id, email, birth_date, gender, terms_accepted_at)
  values (new.id, new.email, v_birth, v_gender,
          case when coalesce(v_meta->>'accepted_terms', 'false') = 'true' then now() else null end);

  insert into public.user_settings (user_id) values (new.id);
  insert into public.notification_preferences (user_id) values (new.id);
  insert into public.user_presence (user_id) values (new.id);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_updated()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.user_private set email = new.email, updated_at = now() where user_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated after update of email on auth.users
  for each row execute function public.handle_user_updated();

-- ----------------------------------------------------------------------------
-- RPC: usernames, relationships, presence, sessions, account
-- ----------------------------------------------------------------------------
create or replace function public.is_username_available(p_username text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_u text := lower(trim(coalesce(p_username, '')));
begin
  if v_u !~ public.username_regex() then return false; end if;
  if public.is_reserved_username(v_u) then return false; end if;
  return not exists (select 1 from public.profiles p where p.username = v_u and p.id is distinct from auth.uid());
end $$;

create or replace function public.follow_user(p_target uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_private boolean;
  v_status public.account_status_type;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_target = v_me then raise exception 'CANNOT_FOLLOW_SELF' using errcode = 'P0001'; end if;
  select is_private, account_status into v_private, v_status from public.profiles where id = p_target;
  if not found or v_status <> 'active' then raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002'; end if;
  if public.is_blocked_either(v_me, p_target) then raise exception 'BLOCKED' using errcode = '42501'; end if;
  if exists (select 1 from public.follows where follower_id = v_me and following_id = p_target) then
    return 'following';
  end if;
  if v_private then
    insert into public.follow_requests (requester_id, target_id) values (v_me, p_target)
    on conflict (requester_id, target_id) where status = 'pending' do nothing;
    perform public.create_notification(p_target, v_me, 'follow_request', 'profile', v_me::text);
    return 'requested';
  end if;
  insert into public.follows (follower_id, following_id) values (v_me, p_target) on conflict do nothing;
  return 'following';
end $$;

create or replace function public.unfollow_user(p_target uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  delete from public.follows where follower_id = v_me and following_id = p_target;
  update public.follow_requests set status = 'cancelled', responded_at = now()
   where requester_id = v_me and target_id = p_target and status = 'pending';
  return 'none';
end $$;

create or replace function public.remove_follower(p_follower uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  delete from public.follows where follower_id = p_follower and following_id = auth.uid();
end $$;

create or replace function public.respond_follow_request(p_request uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_req public.follow_requests%rowtype;
begin
  select * into v_req from public.follow_requests where id = p_request and target_id = auth.uid() and status = 'pending';
  if not found then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.follow_requests set status = case when p_accept then 'accepted' else 'declined' end::public.request_status,
                                   responded_at = now() where id = p_request;
  if p_accept then
    insert into public.follows (follower_id, following_id) values (v_req.requester_id, v_req.target_id) on conflict do nothing;
    perform public.create_notification(v_req.requester_id, v_req.target_id, 'follow_request_accepted', 'profile', v_req.target_id::text);
  end if;
end $$;

create or replace function public.send_friend_request(p_target uuid, p_message text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_reverse uuid;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_target = v_me then raise exception 'CANNOT_FRIEND_SELF' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.profiles where id = p_target and account_status = 'active') then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if public.is_blocked_either(v_me, p_target) then raise exception 'BLOCKED' using errcode = '42501'; end if;
  if exists (select 1 from public.friendships where user_a = least(v_me, p_target) and user_b = greatest(v_me, p_target)) then
    raise exception 'ALREADY_FRIENDS' using errcode = 'P0001';
  end if;

  -- If the other person already asked us, accept their request instead.
  select id into v_reverse from public.friend_requests
   where sender_id = p_target and receiver_id = v_me and status = 'pending';
  if v_reverse is not null then
    perform public.respond_friend_request(v_reverse, true);
    return v_reverse;
  end if;

  insert into public.friend_requests as fr (sender_id, receiver_id, message)
  values (v_me, p_target, nullif(trim(coalesce(p_message, '')), ''))
  on conflict (sender_id, receiver_id) where status = 'pending' do update set created_at = fr.created_at
  returning fr.id into v_id;

  perform public.create_notification(p_target, v_me, 'friend_request', 'friend_request', v_id::text);
  return v_id;
end $$;

create or replace function public.respond_friend_request(p_request uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_req public.friend_requests%rowtype;
begin
  select * into v_req from public.friend_requests where id = p_request and receiver_id = auth.uid() and status = 'pending';
  if not found then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.friend_requests set status = case when p_accept then 'accepted' else 'declined' end::public.request_status,
                                   responded_at = now() where id = p_request;
  if p_accept then
    insert into public.friendships (user_a, user_b)
    values (least(v_req.sender_id, v_req.receiver_id), greatest(v_req.sender_id, v_req.receiver_id))
    on conflict do nothing;
    perform public.create_notification(v_req.sender_id, v_req.receiver_id, 'friend_request_accepted', 'profile', v_req.receiver_id::text);
  end if;
end $$;

create or replace function public.cancel_friend_request(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.friend_requests set status = 'cancelled', responded_at = now()
   where id = p_request and sender_id = auth.uid() and status = 'pending';
end $$;

create or replace function public.unfriend(p_other uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  delete from public.friendships
   where user_a = least(auth.uid(), p_other) and user_b = greatest(auth.uid(), p_other);
end $$;

create or replace function public.block_user(p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_target = auth.uid() then raise exception 'CANNOT_BLOCK_SELF' using errcode = 'P0001'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), p_target) on conflict do nothing;
end $$;

create or replace function public.unblock_user(p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_target;
end $$;

create or replace function public.get_relationship(p_target uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_fr public.friend_requests%rowtype;
  v_result jsonb;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into v_fr from public.friend_requests
   where status = 'pending' and ((sender_id = v_me and receiver_id = p_target) or (sender_id = p_target and receiver_id = v_me))
   order by created_at desc limit 1;

  v_result := jsonb_build_object(
    'is_self', p_target = v_me,
    'is_following', exists (select 1 from public.follows where follower_id = v_me and following_id = p_target),
    'is_followed_by', exists (select 1 from public.follows where follower_id = p_target and following_id = v_me),
    'follow_requested', exists (select 1 from public.follow_requests where requester_id = v_me and target_id = p_target and status = 'pending'),
    'is_friend', exists (select 1 from public.friendships where user_a = least(v_me, p_target) and user_b = greatest(v_me, p_target)),
    'is_blocking', exists (select 1 from public.blocks where blocker_id = v_me and blocked_id = p_target),
    'is_blocked_by', exists (select 1 from public.blocks where blocker_id = p_target and blocked_id = v_me),
    'friend_request', case when v_fr.id is null then null else jsonb_build_object(
        'id', v_fr.id,
        'direction', case when v_fr.sender_id = v_me then 'outgoing' else 'incoming' end,
        'created_at', v_fr.created_at) end
  );
  return v_result;
end $$;

create or replace function public.touch_presence(p_online boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.user_presence (user_id, is_online, last_seen_at, updated_at)
  values (auth.uid(), coalesce(p_online, true), now(), now())
  on conflict (user_id) do update set is_online = excluded.is_online, last_seen_at = now(), updated_at = now();
end $$;

create or replace function public.get_presence(p_user_ids uuid[])
returns table (user_id uuid, is_online boolean, last_seen_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.user_id,
         case when p.user_id = auth.uid() or s.show_online_status then (p.is_online and p.last_seen_at > now() - interval '3 minutes') else null end,
         case when p.user_id = auth.uid() or s.show_last_seen then p.last_seen_at else null end
  from public.user_presence p
  join public.user_settings s on s.user_id = p.user_id
  where auth.uid() is not null
    and p.user_id = any (p_user_ids)
    and not public.is_blocked_either(auth.uid(), p.user_id)
$$;

create or replace function public.get_suggested_profiles(p_limit integer default 20)
returns table (
  id uuid, username text, display_name text, avatar_url text, country_code text, bio text,
  is_verified boolean, followers_count integer, shared_interests integer
)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name, p.avatar_url, p.country_code, p.bio, p.is_verified, p.followers_count,
         coalesce((select count(*)::int from public.user_interests a
                   join public.user_interests b on a.interest_id = b.interest_id
                   where a.user_id = auth.uid() and b.user_id = p.id), 0) as shared_interests
  from public.profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and p.account_status = 'active'
    and p.discoverable
    and p.onboarding_completed
    and not exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.following_id = p.id)
    and not public.is_blocked_either(auth.uid(), p.id)
  order by shared_interests desc, p.popularity_score desc, p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
$$;

create or replace function public.search_profiles(
  p_query text default '', p_country text default null, p_limit integer default 20, p_offset integer default 0
)
returns table (
  id uuid, username text, display_name text, avatar_url text, country_code text, bio text,
  is_verified boolean, is_private boolean, followers_count integer
)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name, p.avatar_url, p.country_code, p.bio, p.is_verified, p.is_private, p.followers_count
  from public.profiles p
  where auth.uid() is not null
    and p.account_status = 'active'
    and (p.discoverable or p.id = auth.uid())
    and not public.is_blocked_either(auth.uid(), p.id)
    and (coalesce(trim(p_query), '') = ''
         or p.username ilike '%' || lower(trim(p_query)) || '%'
         or p.display_name ilike '%' || trim(p_query) || '%')
    and (p_country is null or p.country_code = upper(p_country))
  order by
    case when p.username = lower(trim(coalesce(p_query, ''))) then 0 else 1 end,
    p.popularity_score desc, p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
  offset greatest(0, coalesce(p_offset, 0))
$$;

-- Sessions: list / revoke the caller's own auth sessions (security definer reads auth schema).
create or replace function public.get_my_sessions()
returns table (id uuid, created_at timestamptz, updated_at timestamptz, user_agent text, ip text, is_current boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.created_at, s.updated_at, s.user_agent, s.ip::text,
         s.id::text = coalesce(auth.jwt()->>'session_id', '') as is_current
  from auth.sessions s
  where s.user_id = auth.uid()
  order by s.updated_at desc nulls last
$$;

create or replace function public.revoke_my_session(p_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  delete from auth.sessions where id = p_session_id and user_id = auth.uid();
end $$;

create or replace function public.revoke_other_sessions()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  delete from auth.sessions
   where user_id = auth.uid() and id::text <> coalesce(auth.jwt()->>'session_id', '');
end $$;

-- Account deletion: cascades through every table referencing auth.users.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  delete from auth.users where id = auth.uid();
end $$;

create or replace function public.log_admin_action(
  p_action text, p_target_type text default null, p_target_id text default null, p_metadata jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, metadata)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb));
end $$;

-- Blocked profiles are hidden by RLS, so the blocker's own list is served here.
create or replace function public.get_blocked_profiles()
returns table (
  id uuid, username text, display_name text, avatar_url text, country_code text, bio text,
  is_verified boolean, followers_count integer, blocked_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name, p.avatar_url, p.country_code, p.bio, p.is_verified, p.followers_count, b.created_at
  from public.blocks b
  join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by b.created_at desc
$$;

-- ----------------------------------------------------------------------------
-- Function privileges
-- ----------------------------------------------------------------------------
do $do$
declare f text;
begin
  foreach f in array array[
    'public.is_admin()', 'public.has_admin_role(public.admin_role_type[])',
    'public.is_blocked_either(uuid, uuid)', 'public.can_view_profile(uuid)',
    'public.user_age(uuid)', 'public.is_adult(uuid)',
    'public.create_notification(uuid, uuid, text, text, text, jsonb)',
    'public.follow_user(uuid)', 'public.unfollow_user(uuid)', 'public.remove_follower(uuid)',
    'public.respond_follow_request(uuid, boolean)',
    'public.send_friend_request(uuid, text)', 'public.respond_friend_request(uuid, boolean)',
    'public.cancel_friend_request(uuid)', 'public.unfriend(uuid)',
    'public.block_user(uuid)', 'public.unblock_user(uuid)', 'public.get_relationship(uuid)',
    'public.touch_presence(boolean)', 'public.get_presence(uuid[])',
    'public.get_suggested_profiles(integer)', 'public.search_profiles(text, text, integer, integer)',
    'public.get_my_sessions()', 'public.revoke_my_session(uuid)', 'public.revoke_other_sessions()',
    'public.delete_my_account()', 'public.log_admin_action(text, text, text, jsonb)',
    'public.is_username_available(text)', 'public.get_blocked_profiles()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $do$;

-- Username availability is needed on the sign-up screen (before authentication).
grant execute on function public.is_username_available(text) to anon;
-- Internal helpers are not callable by clients at all.
revoke execute on function public.create_notification(uuid, uuid, text, text, text, jsonb) from authenticated;
revoke execute on function public.user_age(uuid) from authenticated;

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.admin_roles              enable row level security;
alter table public.admin_audit_logs         enable row level security;
alter table public.profiles                 enable row level security;
alter table public.user_private             enable row level security;
alter table public.user_settings            enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.interests                enable row level security;
alter table public.user_interests           enable row level security;
alter table public.blocks                   enable row level security;
alter table public.follows                  enable row level security;
alter table public.follow_requests          enable row level security;
alter table public.friend_requests          enable row level security;
alter table public.friendships              enable row level security;
alter table public.notifications            enable row level security;
alter table public.reports                  enable row level security;
alter table public.user_devices             enable row level security;
alter table public.user_presence            enable row level security;

-- admin_roles: users can see their own role (UI hint only); admins see all. No client writes.
drop policy if exists "admin_roles_select" on public.admin_roles;
create policy "admin_roles_select" on public.admin_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "admin_audit_logs_select" on public.admin_audit_logs;
create policy "admin_audit_logs_select" on public.admin_audit_logs for select to authenticated
  using (public.is_admin());

-- profiles
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated
  using (public.can_view_profile(id));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- user_private
drop policy if exists "user_private_select_own" on public.user_private;
create policy "user_private_select_own" on public.user_private for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_private_update_own" on public.user_private;
create policy "user_private_update_own" on public.user_private for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- user_settings
drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_own" on public.user_settings for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_own" on public.user_settings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- notification_preferences
drop policy if exists "notification_preferences_select_own" on public.notification_preferences;
create policy "notification_preferences_select_own" on public.notification_preferences for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "notification_preferences_update_own" on public.notification_preferences;
create policy "notification_preferences_update_own" on public.notification_preferences for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- interests catalog
drop policy if exists "interests_select" on public.interests;
create policy "interests_select" on public.interests for select to authenticated
  using (is_active);

-- user_interests
drop policy if exists "user_interests_select" on public.user_interests;
create policy "user_interests_select" on public.user_interests for select to authenticated
  using (user_id = auth.uid() or public.can_view_profile(user_id));

drop policy if exists "user_interests_insert_own" on public.user_interests;
create policy "user_interests_insert_own" on public.user_interests for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_interests_delete_own" on public.user_interests;
create policy "user_interests_delete_own" on public.user_interests for delete to authenticated
  using (user_id = auth.uid());

-- blocks: only the blocker sees their list; writes go through block_user/unblock_user.
drop policy if exists "blocks_select_own" on public.blocks;
create policy "blocks_select_own" on public.blocks for select to authenticated
  using (blocker_id = auth.uid());

-- follows
drop policy if exists "follows_select" on public.follows;
create policy "follows_select" on public.follows for select to authenticated
  using (follower_id = auth.uid() or following_id = auth.uid()
         or (public.can_view_profile(follower_id) and public.can_view_profile(following_id)));

drop policy if exists "follows_delete_own" on public.follows;
create policy "follows_delete_own" on public.follows for delete to authenticated
  using (follower_id = auth.uid() or following_id = auth.uid());

-- follow_requests (reads only; writes through RPC)
drop policy if exists "follow_requests_select_involved" on public.follow_requests;
create policy "follow_requests_select_involved" on public.follow_requests for select to authenticated
  using (requester_id = auth.uid() or target_id = auth.uid());

-- friend_requests (reads only; writes through RPC)
drop policy if exists "friend_requests_select_involved" on public.friend_requests;
create policy "friend_requests_select_involved" on public.friend_requests for select to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid());

-- friendships
drop policy if exists "friendships_select" on public.friendships;
create policy "friendships_select" on public.friendships for select to authenticated
  using (user_a = auth.uid() or user_b = auth.uid()
         or (public.can_view_profile(user_a) and public.can_view_profile(user_b)));

drop policy if exists "friendships_delete_own" on public.friendships;
create policy "friendships_delete_own" on public.friendships for delete to authenticated
  using (user_a = auth.uid() or user_b = auth.uid());

-- notifications
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications for delete to authenticated
  using (user_id = auth.uid());

-- reports
drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own" on public.reports for insert to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists "reports_select" on public.reports;
create policy "reports_select" on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_admin());

-- user_devices
drop policy if exists "user_devices_all_own" on public.user_devices;
create policy "user_devices_all_own" on public.user_devices for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- user_presence (others read through get_presence, which applies privacy settings)
drop policy if exists "user_presence_select_own" on public.user_presence;
create policy "user_presence_select_own" on public.user_presence for select to authenticated
  using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Realtime
-- ----------------------------------------------------------------------------
do $do$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friend_requests') then
    alter publication supabase_realtime add table public.friend_requests;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'follow_requests') then
    alter publication supabase_realtime add table public.follow_requests;
  end if;
end $do$;

-- ----------------------------------------------------------------------------
-- Storage: profile media buckets
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('covers',  'covers',  true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile_media_public_read" on storage.objects;
create policy "profile_media_public_read" on storage.objects for select
  using (bucket_id in ('avatars', 'covers'));

drop policy if exists "profile_media_insert_own" on storage.objects;
create policy "profile_media_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id in ('avatars', 'covers') and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "profile_media_update_own" on storage.objects;
create policy "profile_media_update_own" on storage.objects for update to authenticated
  using (bucket_id in ('avatars', 'covers') and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id in ('avatars', 'covers') and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "profile_media_delete_own" on storage.objects;
create policy "profile_media_delete_own" on storage.objects for delete to authenticated
  using (bucket_id in ('avatars', 'covers') and (storage.foldername(name))[1] = auth.uid()::text);


-- ########## 20261125000002_social.sql ##########

-- ============================================================================
-- Friendzy — Phase 2: social networking
-- Posts (text / photo / video / carousel / poll / question / share), reactions,
-- comments & replies, reposts, saves, hide / not-interested, impressions,
-- hashtags & mentions, stories (24h) with views / reactions / highlights,
-- approximate location + nearby discovery, random matching, global search,
-- feed & recommendation functions, storage buckets, RLS and realtime.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
do $do$ begin
  create type public.post_type as enum ('text', 'photo', 'video', 'carousel', 'poll', 'question', 'share');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.post_audience as enum ('public', 'followers', 'friends');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.media_kind as enum ('image', 'video', 'audio', 'document');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.reaction_type as enum ('like', 'love', 'haha', 'wow', 'sad', 'fire');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.story_kind as enum ('image', 'video', 'text');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.feed_feedback_kind as enum ('hide', 'not_interested');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.match_action as enum ('skip', 'friend', 'chat', 'report', 'block');
exception when duplicate_object then null; end $do$;

-- ----------------------------------------------------------------------------
-- Posts
-- ----------------------------------------------------------------------------
create table if not exists public.posts (
  id             uuid primary key default gen_random_uuid(),
  author_id      uuid not null references public.profiles (id) on delete cascade,
  type           public.post_type not null default 'text',
  text           text,
  audience       public.post_audience not null default 'public',
  allow_comments boolean not null default true,
  shared_post_id uuid references public.posts (id) on delete set null,
  location_name  text,
  likes_count    integer not null default 0,
  comments_count integer not null default 0,
  reposts_count  integer not null default 0,
  saves_count    integer not null default 0,
  views_count    integer not null default 0,
  removed_at     timestamptz,
  removed_by     uuid references auth.users (id) on delete set null,
  removed_reason text,
  edited_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint posts_text_len check (text is null or char_length(text) <= 2200),
  constraint posts_location_len check (location_name is null or char_length(location_name) <= 100),
  constraint posts_share_not_self check (shared_post_id is null or shared_post_id <> id)
);
create index if not exists posts_author_created_idx on public.posts (author_id, created_at desc);
create index if not exists posts_created_idx on public.posts (created_at desc) where removed_at is null;
create index if not exists posts_shared_idx on public.posts (shared_post_id) where shared_post_id is not null;
create index if not exists posts_text_trgm on public.posts using gin (text extensions.gin_trgm_ops);

revoke all on public.posts from anon, authenticated;
grant select on public.posts to authenticated;

create table if not exists public.post_media (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.posts (id) on delete cascade,
  position      smallint not null default 0,
  kind          public.media_kind not null,
  url           text not null,
  thumbnail_url text,
  width         integer,
  height        integer,
  duration_ms   integer,
  alt_text      text,
  created_at    timestamptz not null default now(),
  constraint post_media_alt_len check (alt_text is null or char_length(alt_text) <= 300)
);
create index if not exists post_media_post_idx on public.post_media (post_id, position);
revoke all on public.post_media from anon, authenticated;
grant select on public.post_media to authenticated;

create table if not exists public.post_polls (
  post_id      uuid primary key references public.posts (id) on delete cascade,
  multiple     boolean not null default false,
  ends_at      timestamptz,
  total_votes  integer not null default 0
);
revoke all on public.post_polls from anon, authenticated;
grant select on public.post_polls to authenticated;

create table if not exists public.poll_options (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  position    smallint not null default 0,
  text        text not null,
  votes_count integer not null default 0,
  constraint poll_options_text_len check (char_length(text) between 1 and 80)
);
create index if not exists poll_options_post_idx on public.poll_options (post_id, position);
revoke all on public.poll_options from anon, authenticated;
grant select on public.poll_options to authenticated;

create table if not exists public.poll_votes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  option_id  uuid not null references public.poll_options (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, option_id)
);
create index if not exists poll_votes_post_user_idx on public.poll_votes (post_id, user_id);
revoke all on public.poll_votes from anon, authenticated;
grant select on public.poll_votes to authenticated;

create table if not exists public.post_likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  reaction   public.reaction_type not null default 'like',
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists post_likes_user_idx on public.post_likes (user_id, created_at desc);
revoke all on public.post_likes from anon, authenticated;
grant select on public.post_likes to authenticated;

create table if not exists public.comments (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.posts (id) on delete cascade,
  author_id     uuid not null references public.profiles (id) on delete cascade,
  parent_id     uuid references public.comments (id) on delete cascade,
  text          text not null,
  media_url     text,
  likes_count   integer not null default 0,
  replies_count integer not null default 0,
  removed_at    timestamptz,
  edited_at     timestamptz,
  created_at    timestamptz not null default now(),
  constraint comments_text_len check (char_length(text) between 1 and 1000)
);
create index if not exists comments_post_idx on public.comments (post_id, created_at) where parent_id is null;
create index if not exists comments_parent_idx on public.comments (parent_id, created_at);
create index if not exists comments_author_idx on public.comments (author_id, created_at desc);
revoke all on public.comments from anon, authenticated;
grant select on public.comments to authenticated;

create table if not exists public.comment_reactions (
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  reaction   public.reaction_type not null default 'like',
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
revoke all on public.comment_reactions from anon, authenticated;
grant select on public.comment_reactions to authenticated;

create table if not exists public.reposts (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  post_id    uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists reposts_post_idx on public.reposts (post_id);
create index if not exists reposts_user_created_idx on public.reposts (user_id, created_at desc);
revoke all on public.reposts from anon, authenticated;
grant select on public.reposts to authenticated;

create table if not exists public.saved_posts (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  post_id    uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists saved_posts_user_created_idx on public.saved_posts (user_id, created_at desc);
revoke all on public.saved_posts from anon, authenticated;
grant select on public.saved_posts to authenticated;

create table if not exists public.feed_feedback (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  post_id    uuid references public.posts (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete cascade,
  kind       public.feed_feedback_kind not null,
  created_at timestamptz not null default now()
);
create unique index if not exists feed_feedback_post_key on public.feed_feedback (user_id, post_id, kind) where post_id is not null;
create index if not exists feed_feedback_author_idx on public.feed_feedback (user_id, author_id) where author_id is not null;
revoke all on public.feed_feedback from anon, authenticated;
grant select on public.feed_feedback to authenticated;

create table if not exists public.post_impressions (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  post_id  uuid not null references public.posts (id) on delete cascade,
  seen_at  timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists post_impressions_seen_idx on public.post_impressions (seen_at);
revoke all on public.post_impressions from anon, authenticated;
grant select on public.post_impressions to authenticated;

-- ----------------------------------------------------------------------------
-- Hashtags
-- ----------------------------------------------------------------------------
create table if not exists public.hashtags (
  id           bigserial primary key,
  tag          text not null unique,
  posts_count  integer not null default 0,
  videos_count integer not null default 0,
  created_at   timestamptz not null default now(),
  constraint hashtags_tag_format check (tag ~ '^[a-z0-9_]{2,50}$')
);
create index if not exists hashtags_tag_trgm on public.hashtags using gin (tag extensions.gin_trgm_ops);
revoke all on public.hashtags from anon, authenticated;
grant select on public.hashtags to authenticated;

create table if not exists public.post_hashtags (
  post_id    uuid not null references public.posts (id) on delete cascade,
  hashtag_id bigint not null references public.hashtags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, hashtag_id)
);
create index if not exists post_hashtags_tag_idx on public.post_hashtags (hashtag_id, created_at desc);
revoke all on public.post_hashtags from anon, authenticated;
grant select on public.post_hashtags to authenticated;

-- ----------------------------------------------------------------------------
-- Stories
-- ----------------------------------------------------------------------------
create table if not exists public.stories (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references public.profiles (id) on delete cascade,
  kind          public.story_kind not null,
  media_url     text,
  thumbnail_url text,
  text          text,
  style         jsonb not null default '{}'::jsonb,
  stickers      jsonb not null default '[]'::jsonb,
  caption       text,
  music_title   text,
  audience      public.audience_type not null default 'followers',
  duration_ms   integer,
  views_count   integer not null default 0,
  removed_at    timestamptz,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '24 hours'),
  constraint stories_text_len check (text is null or char_length(text) <= 500),
  constraint stories_caption_len check (caption is null or char_length(caption) <= 300),
  constraint stories_media_required check (kind = 'text' or media_url is not null),
  constraint stories_audience_valid check (audience in ('everyone', 'followers', 'friends'))
);
create index if not exists stories_author_idx on public.stories (author_id, created_at desc);
create index if not exists stories_active_idx on public.stories (expires_at) where removed_at is null;
revoke all on public.stories from anon, authenticated;
grant select on public.stories to authenticated;

create table if not exists public.story_views (
  story_id  uuid not null references public.stories (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);
create index if not exists story_views_viewer_idx on public.story_views (viewer_id);
revoke all on public.story_views from anon, authenticated;
grant select on public.story_views to authenticated;

create table if not exists public.story_reactions (
  story_id   uuid not null references public.stories (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id),
  constraint story_reactions_emoji_len check (char_length(emoji) between 1 and 8)
);
revoke all on public.story_reactions from anon, authenticated;
grant select on public.story_reactions to authenticated;

create table if not exists public.story_highlights (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  title      text not null,
  cover_url  text,
  position   smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint story_highlights_title_len check (char_length(title) between 1 and 30)
);
create index if not exists story_highlights_user_idx on public.story_highlights (user_id, position);
revoke all on public.story_highlights from anon, authenticated;
grant select on public.story_highlights to authenticated;

create table if not exists public.story_highlight_items (
  highlight_id uuid not null references public.story_highlights (id) on delete cascade,
  story_id     uuid not null references public.stories (id) on delete cascade,
  position     smallint not null default 0,
  primary key (highlight_id, story_id)
);
revoke all on public.story_highlight_items from anon, authenticated;
grant select on public.story_highlight_items to authenticated;

-- ----------------------------------------------------------------------------
-- Approximate location, matching, search history
-- ----------------------------------------------------------------------------
create table if not exists public.user_locations (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  lat        numeric(5, 2) not null,
  lng        numeric(5, 2) not null,
  city       text,
  updated_at timestamptz not null default now(),
  constraint user_locations_lat check (lat between -90 and 90),
  constraint user_locations_lng check (lng between -180 and 180)
);
create index if not exists user_locations_lat_lng_idx on public.user_locations (lat, lng);
revoke all on public.user_locations from anon, authenticated;
grant select on public.user_locations to authenticated;

create table if not exists public.match_history (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  candidate_id uuid not null references public.profiles (id) on delete cascade,
  action       public.match_action not null,
  created_at   timestamptz not null default now(),
  primary key (user_id, candidate_id)
);
revoke all on public.match_history from anon, authenticated;
grant select on public.match_history to authenticated;

create table if not exists public.search_history (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  query      text not null,
  kind       text not null default 'all',
  created_at timestamptz not null default now(),
  constraint search_history_query_len check (char_length(query) between 1 and 100)
);
create index if not exists search_history_user_idx on public.search_history (user_id, created_at desc);
create index if not exists search_history_recent_idx on public.search_history (created_at desc);
revoke all on public.search_history from anon, authenticated;
grant select, delete on public.search_history to authenticated;

-- ----------------------------------------------------------------------------
-- Visibility helpers
-- ----------------------------------------------------------------------------
create or replace function public.is_following(p_follower uuid, p_target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.follows f where f.follower_id = p_follower and f.following_id = p_target)
$$;

create or replace function public.are_friends(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friendships f where f.user_a = least(p_a, p_b) and f.user_b = greatest(p_a, p_b))
$$;

create or replace function public.can_view_post_of(p_author uuid, p_audience public.post_audience, p_viewer uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_viewer is null then false
    when p_author = p_viewer then true
    when public.is_blocked_either(p_viewer, p_author) then false
    when not exists (select 1 from public.profiles pr where pr.id = p_author and pr.account_status = 'active') then false
    when public.is_admin() then true
    when p_audience = 'friends' then public.are_friends(p_author, p_viewer)
    when p_audience = 'followers' then public.is_following(p_viewer, p_author)
    else coalesce((select not pr.is_private from public.profiles pr where pr.id = p_author), false)
         or public.is_following(p_viewer, p_author)
  end
$$;

create or replace function public.can_view_story_of(p_author uuid, p_audience public.audience_type, p_viewer uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_viewer is null then false
    when p_author = p_viewer then true
    when public.is_blocked_either(p_viewer, p_author) then false
    when not exists (select 1 from public.profiles pr where pr.id = p_author and pr.account_status = 'active') then false
    when p_audience = 'friends' then public.are_friends(p_author, p_viewer)
    when p_audience = 'followers' then public.is_following(p_viewer, p_author) or public.are_friends(p_author, p_viewer)
    when p_audience = 'everyone' then coalesce((select not pr.is_private from public.profiles pr where pr.id = p_author), false)
                                      or public.is_following(p_viewer, p_author) or public.are_friends(p_author, p_viewer)
    else false
  end
$$;

-- Returns true when p_actor may comment on p_author's content according to who_can_comment.
create or replace function public.can_interact(p_author uuid, p_actor uuid, p_setting public.audience_type)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_author = p_actor then true
    when public.is_blocked_either(p_author, p_actor) then false
    when p_setting = 'everyone' then true
    when p_setting = 'followers' then public.is_following(p_actor, p_author) or public.are_friends(p_author, p_actor)
    when p_setting = 'friends' then public.are_friends(p_author, p_actor)
    else false
  end
$$;

create or replace function public.profile_card_json(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', pr.id, 'username', pr.username, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url,
    'is_verified', pr.is_verified, 'is_private', pr.is_private, 'country_code', pr.country_code
  ) from public.profiles pr where pr.id = p_user
$$;

-- ----------------------------------------------------------------------------
-- Counters & side effects
-- ----------------------------------------------------------------------------
create or replace function public.on_post_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.removed_at is null then
      update public.profiles set posts_count = posts_count + 1 where id = new.author_id;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.removed_at is null then
      update public.profiles set posts_count = greatest(0, posts_count - 1) where id = old.author_id;
    end if;
    return old;
  elsif tg_op = 'UPDATE' then
    if old.removed_at is null and new.removed_at is not null then
      update public.profiles set posts_count = greatest(0, posts_count - 1) where id = new.author_id;
    elsif old.removed_at is not null and new.removed_at is null then
      update public.profiles set posts_count = posts_count + 1 where id = new.author_id;
    end if;
    new.updated_at = now();
    return new;
  end if;
  return null;
end $$;

-- Hashtag counters must be adjusted BEFORE the delete: FK cascades on post_hashtags
-- run before user AFTER triggers, so the links would already be gone.
create or replace function public.on_post_before_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.hashtags h set posts_count = greatest(0, h.posts_count - 1)
    where h.id in (select hashtag_id from public.post_hashtags where post_id = old.id);
  return old;
end $$;

drop trigger if exists posts_before_delete on public.posts;
create trigger posts_before_delete before delete on public.posts for each row execute function public.on_post_before_delete();

drop trigger if exists posts_before_update on public.posts;
create trigger posts_before_update before update on public.posts for each row execute function public.on_post_change();
drop trigger if exists posts_after_insert_delete on public.posts;
create trigger posts_after_insert_delete after insert or delete on public.posts for each row execute function public.on_post_change();

create or replace function public.on_post_like_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
  if tg_op = 'INSERT' then
    update public.posts set likes_count = likes_count + 1 where id = new.post_id returning author_id into v_author;
    update public.profiles set likes_count = likes_count + 1, popularity_score = popularity_score + 0.5 where id = v_author;
    perform public.create_notification(v_author, new.user_id, 'post_like', 'post', new.post_id::text, jsonb_build_object('reaction', new.reaction));
    return new;
  elsif tg_op = 'DELETE' then
    update public.posts set likes_count = greatest(0, likes_count - 1) where id = old.post_id returning author_id into v_author;
    update public.profiles set likes_count = greatest(0, likes_count - 1), popularity_score = greatest(0, popularity_score - 0.5) where id = v_author;
    return old;
  end if;
  return null;
end $$;

drop trigger if exists post_likes_after_change on public.post_likes;
create trigger post_likes_after_change after insert or delete on public.post_likes for each row execute function public.on_post_like_change();

create or replace function public.on_comment_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_post_author uuid; v_parent_author uuid;
begin
  if tg_op = 'INSERT' then
    update public.posts set comments_count = comments_count + 1 where id = new.post_id returning author_id into v_post_author;
    if new.parent_id is not null then
      update public.comments set replies_count = replies_count + 1 where id = new.parent_id returning author_id into v_parent_author;
      perform public.create_notification(v_parent_author, new.author_id, 'comment_reply', 'comment', new.id::text, jsonb_build_object('post_id', new.post_id, 'preview', left(new.text, 120)));
      if v_parent_author is distinct from v_post_author then
        perform public.create_notification(v_post_author, new.author_id, 'post_comment', 'comment', new.id::text, jsonb_build_object('post_id', new.post_id, 'preview', left(new.text, 120)));
      end if;
    else
      perform public.create_notification(v_post_author, new.author_id, 'post_comment', 'comment', new.id::text, jsonb_build_object('post_id', new.post_id, 'preview', left(new.text, 120)));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    update public.posts set comments_count = greatest(0, comments_count - 1) where id = old.post_id;
    if old.parent_id is not null then
      update public.comments set replies_count = greatest(0, replies_count - 1) where id = old.parent_id;
    end if;
    return old;
  end if;
  return null;
end $$;

drop trigger if exists comments_after_change on public.comments;
create trigger comments_after_change after insert or delete on public.comments for each row execute function public.on_comment_change();

create or replace function public.on_comment_reaction_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
  if tg_op = 'INSERT' then
    update public.comments set likes_count = likes_count + 1 where id = new.comment_id returning author_id into v_author;
    perform public.create_notification(v_author, new.user_id, 'comment_like', 'comment', new.comment_id::text);
    return new;
  elsif tg_op = 'DELETE' then
    update public.comments set likes_count = greatest(0, likes_count - 1) where id = old.comment_id;
    return old;
  end if;
  return null;
end $$;

drop trigger if exists comment_reactions_after_change on public.comment_reactions;
create trigger comment_reactions_after_change after insert or delete on public.comment_reactions for each row execute function public.on_comment_reaction_change();

create or replace function public.on_repost_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
  if tg_op = 'INSERT' then
    update public.posts set reposts_count = reposts_count + 1 where id = new.post_id returning author_id into v_author;
    perform public.create_notification(v_author, new.user_id, 'post_repost', 'post', new.post_id::text);
    return new;
  elsif tg_op = 'DELETE' then
    update public.posts set reposts_count = greatest(0, reposts_count - 1) where id = old.post_id;
    return old;
  end if;
  return null;
end $$;

drop trigger if exists reposts_after_change on public.reposts;
create trigger reposts_after_change after insert or delete on public.reposts for each row execute function public.on_repost_change();

create or replace function public.on_saved_post_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set saves_count = saves_count + 1 where id = new.post_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.posts set saves_count = greatest(0, saves_count - 1) where id = old.post_id;
    return old;
  end if;
  return null;
end $$;

drop trigger if exists saved_posts_after_change on public.saved_posts;
create trigger saved_posts_after_change after insert or delete on public.saved_posts for each row execute function public.on_saved_post_change();

create or replace function public.on_story_view()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.stories set views_count = views_count + 1 where id = new.story_id;
  return new;
end $$;

drop trigger if exists story_views_after_insert on public.story_views;
create trigger story_views_after_insert after insert on public.story_views for each row execute function public.on_story_view();

-- Notification preferences: skip in-app notifications the user turned off.
create or replace function public.create_notification(
  p_user uuid, p_actor uuid, p_type text,
  p_entity_type text default null, p_entity_id text default null, p_data jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_allowed boolean := true;
begin
  if p_user is null or p_user = p_actor then return null; end if;
  if public.is_blocked_either(p_user, p_actor) then return null; end if;
  select case
      when p_type in ('new_follower', 'follow_request', 'follow_request_accepted') then np.new_followers
      when p_type in ('friend_request', 'friend_request_accepted') then np.friend_requests
      when p_type in ('post_like', 'comment_like', 'video_like', 'story_reaction') then np.likes
      when p_type in ('post_comment', 'comment_reply', 'video_comment') then np.comments
      when p_type = 'mention' then np.mentions
      when p_type in ('post_repost', 'video_repost') then np.reposts
      when p_type in ('message', 'message_request', 'group_invite') then np.messages
      when p_type in ('missed_call', 'incoming_call') then np.calls
      when p_type in ('live_started', 'live_scheduled', 'live_guest_invite') then np.live
      when p_type in ('gift_received') then np.gifts
      when p_type in ('subscription_update') then np.subscription
      else true end
    into v_allowed
  from public.notification_preferences np where np.user_id = p_user;
  if coalesce(v_allowed, true) = false then return null; end if;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, data)
  values (p_user, p_actor, p_type, p_entity_type, p_entity_id, coalesce(p_data, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

-- ----------------------------------------------------------------------------
-- Hashtags & mentions
-- ----------------------------------------------------------------------------
create or replace function public.extract_hashtags(p_text text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct lower(m[1])), '{}'::text[])
  from regexp_matches(coalesce(p_text, ''), '(?:^|[^[:alnum:]_])#([[:alnum:]_]{2,50})', 'g') as m
$$;

create or replace function public.extract_mentions(p_text text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct lower(m[1])), '{}'::text[])
  from regexp_matches(coalesce(p_text, ''), '(?:^|[^[:alnum:]_])@([A-Za-z0-9_.]{3,30})', 'g') as m
$$;

create or replace function public.link_post_hashtags(p_post uuid, p_text text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tag text; v_id bigint;
begin
  update public.hashtags h set posts_count = greatest(0, h.posts_count - 1)
    where h.id in (select hashtag_id from public.post_hashtags where post_id = p_post);
  delete from public.post_hashtags where post_id = p_post;
  foreach v_tag in array public.extract_hashtags(p_text) loop
    if v_tag !~ '^[a-z0-9_]{2,50}$' then continue; end if;
    insert into public.hashtags (tag) values (v_tag) on conflict (tag) do nothing;
    select id into v_id from public.hashtags where tag = v_tag;
    insert into public.post_hashtags (post_id, hashtag_id) values (p_post, v_id) on conflict do nothing;
    update public.hashtags set posts_count = posts_count + 1 where id = v_id;
  end loop;
end $$;

create or replace function public.notify_mentions(p_actor uuid, p_text text, p_entity_type text, p_entity_id text, p_data jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_username text; v_user uuid;
begin
  foreach v_username in array public.extract_mentions(p_text) loop
    select id into v_user from public.profiles where username = rtrim(v_username, '.');
    if v_user is not null and v_user <> p_actor then
      perform public.create_notification(v_user, p_actor, 'mention', p_entity_type, p_entity_id, p_data);
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Post JSON (single source of truth for feed cards)
-- ----------------------------------------------------------------------------
create or replace function public.post_json(p public.posts, p_viewer uuid, p_depth integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb; v_shared public.posts; v_poll jsonb;
begin
  v := jsonb_build_object(
    'id', p.id,
    'type', p.type,
    'text', p.text,
    'audience', p.audience,
    'allow_comments', p.allow_comments,
    'location_name', p.location_name,
    'likes_count', p.likes_count,
    'comments_count', p.comments_count,
    'reposts_count', p.reposts_count,
    'saves_count', p.saves_count,
    'views_count', p.views_count,
    'created_at', p.created_at,
    'edited_at', p.edited_at,
    'removed', p.removed_at is not null,
    'author', public.profile_card_json(p.author_id),
    'media', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'url', m.url, 'thumbnail_url', m.thumbnail_url,
                                          'width', m.width, 'height', m.height, 'duration_ms', m.duration_ms, 'alt_text', m.alt_text)
                       order by m.position)
      from public.post_media m where m.post_id = p.id), '[]'::jsonb),
    'hashtags', coalesce((select jsonb_agg(h.tag order by h.tag) from public.post_hashtags ph join public.hashtags h on h.id = ph.hashtag_id where ph.post_id = p.id), '[]'::jsonb),
    'viewer', jsonb_build_object(
      'reaction', (select pl.reaction from public.post_likes pl where pl.post_id = p.id and pl.user_id = p_viewer),
      'saved', exists (select 1 from public.saved_posts sp where sp.post_id = p.id and sp.user_id = p_viewer),
      'reposted', exists (select 1 from public.reposts r where r.post_id = p.id and r.user_id = p_viewer),
      'following_author', public.is_following(p_viewer, p.author_id),
      'is_author', p.author_id = p_viewer
    )
  );

  if p.type = 'poll' then
    select jsonb_build_object(
      'multiple', pp.multiple, 'ends_at', pp.ends_at, 'total_votes', pp.total_votes,
      'ended', pp.ends_at is not null and pp.ends_at < now(),
      'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'text', o.text, 'votes_count', o.votes_count) order by o.position) from public.poll_options o where o.post_id = p.id), '[]'::jsonb),
      'my_votes', coalesce((select jsonb_agg(pv.option_id) from public.poll_votes pv where pv.post_id = p.id and pv.user_id = p_viewer), '[]'::jsonb)
    ) into v_poll from public.post_polls pp where pp.post_id = p.id;
    v := v || jsonb_build_object('poll', v_poll);
  end if;

  if (p.shared_post_id is not null or p.type = 'share') and p_depth = 0 then
    v_shared := null;
    if p.shared_post_id is not null then
      select * into v_shared from public.posts sp where sp.id = p.shared_post_id;
    end if;
    if v_shared.id is not null and v_shared.removed_at is null and public.can_view_post_of(v_shared.author_id, v_shared.audience, p_viewer) then
      v := v || jsonb_build_object('shared_post', public.post_json(v_shared, p_viewer, 1));
    else
      v := v || jsonb_build_object('shared_post', jsonb_build_object('unavailable', true));
    end if;
  end if;
  return v;
end $$;

-- ----------------------------------------------------------------------------
-- Post RPCs
-- ----------------------------------------------------------------------------
create or replace function public.create_post(
  p_type public.post_type,
  p_text text default null,
  p_audience public.post_audience default 'public',
  p_allow_comments boolean default true,
  p_media jsonb default '[]'::jsonb,
  p_poll jsonb default null,
  p_shared_post_id uuid default null,
  p_location_name text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_item jsonb;
  v_i integer := 0;
  v_shared public.posts;
  v_option text;
  v_media_count integer := coalesce(jsonb_array_length(p_media), 0);
  v_recent integer;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = v_me and account_status = 'active') then
    raise exception 'ACCOUNT_RESTRICTED' using errcode = '42501';
  end if;

  -- Rate limit: 30 posts per hour.
  select count(*) into v_recent from public.posts where author_id = v_me and created_at > now() - interval '1 hour';
  if v_recent >= 30 then raise exception 'RATE_LIMITED' using errcode = 'P0001', hint = 'You are posting too fast. Try again later.'; end if;

  if p_type in ('text', 'question') and nullif(trim(coalesce(p_text, '')), '') is null then
    raise exception 'TEXT_REQUIRED' using errcode = '23514', hint = 'Write something first.';
  end if;
  if p_type in ('photo', 'video', 'carousel') and v_media_count = 0 then
    raise exception 'MEDIA_REQUIRED' using errcode = '23514', hint = 'Add a photo or video.';
  end if;
  if v_media_count > 10 then raise exception 'TOO_MANY_MEDIA' using errcode = '23514', hint = 'You can attach up to 10 items.'; end if;
  if p_type = 'share' then
    if p_shared_post_id is null then raise exception 'SHARED_POST_REQUIRED' using errcode = '23514'; end if;
    select * into v_shared from public.posts where id = p_shared_post_id and removed_at is null;
    if not found or not public.can_view_post_of(v_shared.author_id, v_shared.audience, v_me) then
      raise exception 'POST_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_shared.audience <> 'public' then raise exception 'CANNOT_SHARE_PRIVATE' using errcode = '42501', hint = 'Only public posts can be shared.'; end if;
  end if;
  if p_type = 'poll' then
    if p_poll is null or jsonb_array_length(coalesce(p_poll->'options', '[]'::jsonb)) not between 2 and 4 then
      raise exception 'POLL_OPTIONS' using errcode = '23514', hint = 'A poll needs between 2 and 4 options.';
    end if;
    if nullif(trim(coalesce(p_text, '')), '') is null then raise exception 'TEXT_REQUIRED' using errcode = '23514', hint = 'Ask a question for your poll.'; end if;
  end if;

  insert into public.posts (author_id, type, text, audience, allow_comments, shared_post_id, location_name)
  values (v_me, p_type, nullif(trim(coalesce(p_text, '')), ''), p_audience, p_allow_comments,
          case when p_type = 'share' then p_shared_post_id else null end, nullif(trim(coalesce(p_location_name, '')), ''))
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_media, '[]'::jsonb)) loop
    if coalesce(v_item->>'url', '') = '' then raise exception 'MEDIA_URL_REQUIRED' using errcode = '23514'; end if;
    -- Media must live in the caller's own storage folder.
    if position('/' || v_me::text || '/' in v_item->>'url') = 0 then
      raise exception 'MEDIA_NOT_OWNED' using errcode = '42501', hint = 'Media must be uploaded to your own storage folder.';
    end if;
    insert into public.post_media (post_id, position, kind, url, thumbnail_url, width, height, duration_ms, alt_text)
    values (v_id, v_i, coalesce((v_item->>'kind')::public.media_kind, 'image'), v_item->>'url', v_item->>'thumbnail_url',
            (v_item->>'width')::int, (v_item->>'height')::int, (v_item->>'duration_ms')::int, left(v_item->>'alt_text', 300));
    v_i := v_i + 1;
  end loop;

  if p_type = 'poll' then
    insert into public.post_polls (post_id, multiple, ends_at)
    values (v_id, coalesce((p_poll->>'multiple')::boolean, false),
            case when (p_poll->>'duration_hours') is not null then now() + ((p_poll->>'duration_hours')::int || ' hours')::interval else null end);
    v_i := 0;
    for v_option in select value #>> '{}' from jsonb_array_elements(p_poll->'options') loop
      insert into public.poll_options (post_id, position, text) values (v_id, v_i, left(trim(v_option), 80));
      v_i := v_i + 1;
    end loop;
  end if;

  perform public.link_post_hashtags(v_id, p_text);
  perform public.notify_mentions(v_me, p_text, 'post', v_id::text);
  if p_type = 'share' then
    perform public.create_notification(v_shared.author_id, v_me, 'post_repost', 'post', v_id::text, jsonb_build_object('shared_post_id', p_shared_post_id));
  end if;

  return public.post_json((select p from public.posts p where p.id = v_id), v_me);
end $$;

create or replace function public.edit_post(p_id uuid, p_text text, p_audience public.post_audience default null, p_allow_comments boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_post public.posts;
begin
  select * into v_post from public.posts where id = p_id and author_id = v_me and removed_at is null;
  if not found then raise exception 'POST_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_post.type in ('text', 'question', 'poll') and nullif(trim(coalesce(p_text, '')), '') is null then
    raise exception 'TEXT_REQUIRED' using errcode = '23514';
  end if;
  update public.posts set text = nullif(trim(coalesce(p_text, '')), ''),
                          audience = coalesce(p_audience, audience),
                          allow_comments = coalesce(p_allow_comments, allow_comments),
                          edited_at = now()
   where id = p_id;
  perform public.link_post_hashtags(p_id, p_text);
  return public.post_json((select p from public.posts p where p.id = p_id), v_me);
end $$;

create or replace function public.delete_post(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  delete from public.posts where id = p_id and (author_id = auth.uid() or public.is_admin());
  if not found then raise exception 'POST_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

create or replace function public.get_post(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_post public.posts; v_me uuid := auth.uid();
begin
  select * into v_post from public.posts where id = p_id;
  if not found or (v_post.removed_at is not null and not (v_post.author_id = v_me or public.is_admin())) then
    raise exception 'POST_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.can_view_post_of(v_post.author_id, v_post.audience, v_me) then raise exception 'POST_NOT_FOUND' using errcode = 'P0002'; end if;
  return public.post_json(v_post, v_me);
end $$;

create or replace function public.toggle_post_reaction(p_post uuid, p_reaction public.reaction_type default 'like')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_post public.posts; v_existing public.reaction_type;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into v_post from public.posts where id = p_post and removed_at is null;
  if not found or not public.can_view_post_of(v_post.author_id, v_post.audience, v_me) then raise exception 'POST_NOT_FOUND' using errcode = 'P0002'; end if;
  select reaction into v_existing from public.post_likes where post_id = p_post and user_id = v_me;
  if v_existing is null then
    insert into public.post_likes (post_id, user_id, reaction) values (p_post, v_me, coalesce(p_reaction, 'like'));
  elsif p_reaction is null or v_existing = p_reaction then
    delete from public.post_likes where post_id = p_post and user_id = v_me;
  else
    update public.post_likes set reaction = p_reaction, created_at = now() where post_id = p_post and user_id = v_me;
  end if;
  return jsonb_build_object(
    'reaction', (select reaction from public.post_likes where post_id = p_post and user_id = v_me),
    'likes_count', (select likes_count from public.posts where id = p_post));
end $$;

create or replace function public.get_post_reactions(p_post uuid, p_limit integer default 50, p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('user', public.profile_card_json(pl.user_id), 'reaction', pl.reaction, 'created_at', pl.created_at) order by pl.created_at desc), '[]'::jsonb)
  from (select * from public.post_likes pl where pl.post_id = p_post
        and exists (select 1 from public.posts p where p.id = p_post and public.can_view_post_of(p.author_id, p.audience, auth.uid()))
        and not public.is_blocked_either(auth.uid(), pl.user_id)
        order by pl.created_at desc limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset)) pl
$$;

create or replace function public.toggle_repost(p_post uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_post public.posts;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into v_post from public.posts where id = p_post and removed_at is null;
  if not found or not public.can_view_post_of(v_post.author_id, v_post.audience, v_me) then raise exception 'POST_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_post.audience <> 'public' then raise exception 'CANNOT_SHARE_PRIVATE' using errcode = '42501', hint = 'Only public posts can be reposted.'; end if;
  if exists (select 1 from public.reposts where user_id = v_me and post_id = p_post) then
    delete from public.reposts where user_id = v_me and post_id = p_post;
  else
    insert into public.reposts (user_id, post_id) values (v_me, p_post);
  end if;
  return jsonb_build_object('reposted', exists (select 1 from public.reposts where user_id = v_me and post_id = p_post),
                            'reposts_count', (select reposts_count from public.posts where id = p_post));
end $$;

create or replace function public.toggle_save_post(p_post uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_post public.posts;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into v_post from public.posts where id = p_post and removed_at is null;
  if not found or not public.can_view_post_of(v_post.author_id, v_post.audience, v_me) then raise exception 'POST_NOT_FOUND' using errcode = 'P0002'; end if;
  if exists (select 1 from public.saved_posts where user_id = v_me and post_id = p_post) then
    delete from public.saved_posts where user_id = v_me and post_id = p_post;
  else
    insert into public.saved_posts (user_id, post_id) values (v_me, p_post);
  end if;
  return jsonb_build_object('saved', exists (select 1 from public.saved_posts where user_id = v_me and post_id = p_post));
end $$;

create or replace function public.feed_feedback(p_post uuid, p_kind public.feed_feedback_kind)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_author uuid;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select author_id into v_author from public.posts where id = p_post;
  if v_author is null then raise exception 'POST_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.feed_feedback (user_id, post_id, author_id, kind) values (v_me, p_post, v_author, p_kind)
  on conflict (user_id, post_id, kind) where post_id is not null do nothing;
end $$;

create or replace function public.undo_feed_feedback(p_post uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.feed_feedback where user_id = auth.uid() and post_id = p_post
$$;

create or replace function public.record_impressions(p_post_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_post_ids is null then return; end if;
  insert into public.post_impressions (user_id, post_id)
  select auth.uid(), unnest(p_post_ids[1:100])
  on conflict (user_id, post_id) do update set seen_at = now();
  update public.posts set views_count = views_count + 1 where id = any (p_post_ids[1:100]);
end $$;

create or replace function public.vote_poll(p_post uuid, p_option_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_post public.posts; v_poll public.post_polls; v_opt uuid; v_prev integer;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into v_post from public.posts where id = p_post and removed_at is null and type = 'poll';
  if not found or not public.can_view_post_of(v_post.author_id, v_post.audience, v_me) then raise exception 'POST_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_poll from public.post_polls where post_id = p_post;
  if v_poll.ends_at is not null and v_poll.ends_at < now() then raise exception 'POLL_ENDED' using errcode = 'P0001', hint = 'This poll has ended.'; end if;
  if coalesce(array_length(p_option_ids, 1), 0) = 0 then raise exception 'OPTION_REQUIRED' using errcode = '23514'; end if;
  if not v_poll.multiple and array_length(p_option_ids, 1) > 1 then raise exception 'SINGLE_CHOICE' using errcode = '23514', hint = 'Pick one option.'; end if;
  if exists (select 1 from unnest(p_option_ids) o where not exists (select 1 from public.poll_options po where po.id = o and po.post_id = p_post)) then
    raise exception 'INVALID_OPTION' using errcode = '23514';
  end if;

  -- Replace previous votes.
  select count(*) into v_prev from public.poll_votes where post_id = p_post and user_id = v_me;
  update public.poll_options o set votes_count = greatest(0, o.votes_count - 1)
    where o.id in (select option_id from public.poll_votes where post_id = p_post and user_id = v_me);
  delete from public.poll_votes where post_id = p_post and user_id = v_me;
  foreach v_opt in array p_option_ids loop
    insert into public.poll_votes (post_id, option_id, user_id) values (p_post, v_opt, v_me) on conflict do nothing;
    update public.poll_options set votes_count = votes_count + 1 where id = v_opt;
  end loop;
  update public.post_polls set total_votes = total_votes + case when v_prev = 0 then 1 else 0 end where post_id = p_post;
  return public.post_json((select p from public.posts p where p.id = p_post), v_me) -> 'poll';
end $$;

-- ----------------------------------------------------------------------------
-- Comments
-- ----------------------------------------------------------------------------
create or replace function public.comment_json(c public.comments, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'post_id', c.post_id, 'parent_id', c.parent_id,
    'text', case when c.removed_at is null then c.text else null end,
    'removed', c.removed_at is not null,
    'media_url', c.media_url, 'likes_count', c.likes_count, 'replies_count', c.replies_count,
    'created_at', c.created_at, 'edited_at', c.edited_at,
    'author', public.profile_card_json(c.author_id),
    'viewer', jsonb_build_object(
      'reaction', (select cr.reaction from public.comment_reactions cr where cr.comment_id = c.id and cr.user_id = p_viewer),
      'is_author', c.author_id = p_viewer)
  )
$$;

create or replace function public.add_comment(p_post uuid, p_text text, p_parent uuid default null, p_media_url text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_post public.posts; v_parent public.comments; v_id uuid; v_setting public.audience_type;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into v_post from public.posts where id = p_post and removed_at is null;
  if not found or not public.can_view_post_of(v_post.author_id, v_post.audience, v_me) then raise exception 'POST_NOT_FOUND' using errcode = 'P0002'; end if;
  if not v_post.allow_comments then raise exception 'COMMENTS_DISABLED' using errcode = '42501', hint = 'Comments are turned off for this post.'; end if;
  select who_can_comment into v_setting from public.user_settings where user_id = v_post.author_id;
  if not public.can_interact(v_post.author_id, v_me, coalesce(v_setting, 'everyone')) then
    raise exception 'COMMENTS_RESTRICTED' using errcode = '42501', hint = 'This person limits who can comment.';
  end if;
  if nullif(trim(coalesce(p_text, '')), '') is null then raise exception 'TEXT_REQUIRED' using errcode = '23514'; end if;
  if p_parent is not null then
    select * into v_parent from public.comments where id = p_parent and post_id = p_post and removed_at is null;
    if not found then raise exception 'COMMENT_NOT_FOUND' using errcode = 'P0002'; end if;
    -- Keep threads one level deep: replying to a reply attaches to the top-level comment.
    if v_parent.parent_id is not null then p_parent := v_parent.parent_id; end if;
  end if;
  if p_media_url is not null and position('/' || v_me::text || '/' in p_media_url) = 0 then
    raise exception 'MEDIA_NOT_OWNED' using errcode = '42501';
  end if;
  insert into public.comments (post_id, author_id, parent_id, text, media_url)
  values (p_post, v_me, p_parent, trim(p_text), p_media_url) returning id into v_id;
  perform public.notify_mentions(v_me, p_text, 'comment', v_id::text, jsonb_build_object('post_id', p_post));
  return public.comment_json((select c from public.comments c where c.id = v_id), v_me);
end $$;

create or replace function public.edit_comment(p_id uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if nullif(trim(coalesce(p_text, '')), '') is null then raise exception 'TEXT_REQUIRED' using errcode = '23514'; end if;
  update public.comments set text = trim(p_text), edited_at = now() where id = p_id and author_id = auth.uid() and removed_at is null;
  if not found then raise exception 'COMMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  return public.comment_json((select c from public.comments c where c.id = p_id), auth.uid());
end $$;

create or replace function public.delete_comment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_c public.comments;
begin
  select * into v_c from public.comments where id = p_id;
  if not found then raise exception 'COMMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  -- Comment author, post author or admin may delete.
  if v_c.author_id = auth.uid() or public.is_admin() or exists (select 1 from public.posts p where p.id = v_c.post_id and p.author_id = auth.uid()) then
    delete from public.comments where id = p_id;
  else
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end $$;

create or replace function public.toggle_comment_reaction(p_comment uuid, p_reaction public.reaction_type default 'like')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_existing public.reaction_type;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not exists (select 1 from public.comments c join public.posts p on p.id = c.post_id where c.id = p_comment and c.removed_at is null and public.can_view_post_of(p.author_id, p.audience, v_me)) then
    raise exception 'COMMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  select reaction into v_existing from public.comment_reactions where comment_id = p_comment and user_id = v_me;
  if v_existing is null then
    insert into public.comment_reactions (comment_id, user_id, reaction) values (p_comment, v_me, coalesce(p_reaction, 'like'));
  elsif p_reaction is null or v_existing = p_reaction then
    delete from public.comment_reactions where comment_id = p_comment and user_id = v_me;
  else
    update public.comment_reactions set reaction = p_reaction where comment_id = p_comment and user_id = v_me;
  end if;
  return jsonb_build_object('reaction', (select reaction from public.comment_reactions where comment_id = p_comment and user_id = v_me),
                            'likes_count', (select likes_count from public.comments where id = p_comment));
end $$;

create or replace function public.get_comments(p_post uuid, p_limit integer default 20, p_before timestamptz default null, p_parent uuid default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.comment_json(c, auth.uid())
  from public.comments c
  where c.post_id = p_post
    and exists (select 1 from public.posts p where p.id = p_post and p.removed_at is null and public.can_view_post_of(p.author_id, p.audience, auth.uid()))
    and (case when p_parent is null then c.parent_id is null else c.parent_id = p_parent end)
    and (p_before is null or c.created_at < p_before)
    and not public.is_blocked_either(auth.uid(), c.author_id)
  order by c.created_at asc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
$$;

-- ----------------------------------------------------------------------------
-- Feeds
-- ----------------------------------------------------------------------------
create or replace function public.get_feed_following(p_limit integer default 20, p_before timestamptz default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  with mine as (
    select p.*, p.created_at as sort_at from public.posts p
    where p.removed_at is null
      and (p.author_id = auth.uid()
           or exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.following_id = p.author_id)
           or exists (select 1 from public.friendships fr where fr.user_a = least(auth.uid(), p.author_id) and fr.user_b = greatest(auth.uid(), p.author_id)))
      and public.can_view_post_of(p.author_id, p.audience, auth.uid())
      and not exists (select 1 from public.feed_feedback ff where ff.user_id = auth.uid() and ff.post_id = p.id)
      and (p_before is null or p.created_at < p_before)
    order by p.created_at desc
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  )
  select public.post_json(m::public.posts, auth.uid()) from (select (m).* from (select row(mine.id, mine.author_id, mine.type, mine.text, mine.audience, mine.allow_comments, mine.shared_post_id, mine.location_name, mine.likes_count, mine.comments_count, mine.reposts_count, mine.saves_count, mine.views_count, mine.removed_at, mine.removed_by, mine.removed_reason, mine.edited_at, mine.created_at, mine.updated_at)::public.posts as m, mine.sort_at from mine) q order by q.sort_at desc) m
$$;

create or replace function public.get_feed_for_you(p_limit integer default 20, p_offset integer default 0)
returns setof jsonb language sql stable security definer set search_path = public as $$
  with me as (
    select auth.uid() as id,
           (select country_code from public.profiles where id = auth.uid()) as country,
           (select coalesce(array_agg(interest_id), '{}'::int[]) from public.user_interests where user_id = auth.uid()) as interests
  ),
  candidates as (
    select p.*,
           exists (select 1 from public.follows f where f.follower_id = me.id and f.following_id = p.author_id) as following,
           (select count(*) from public.user_interests ui where ui.user_id = p.author_id and ui.interest_id = any (me.interests)) as shared,
           exists (select 1 from public.post_impressions pi where pi.user_id = me.id and pi.post_id = p.id) as seen,
           (select pr.country_code = me.country from public.profiles pr where pr.id = p.author_id) as same_country
    from public.posts p, me
    where p.removed_at is null
      and p.author_id <> me.id
      and p.created_at > now() - interval '14 days'
      and public.can_view_post_of(p.author_id, p.audience, me.id)
      and exists (select 1 from public.profiles pr where pr.id = p.author_id and pr.account_status = 'active' and (pr.discoverable or exists (select 1 from public.follows f where f.follower_id = me.id and f.following_id = p.author_id)))
      and not exists (select 1 from public.feed_feedback ff where ff.user_id = me.id and (ff.post_id = p.id or (ff.author_id = p.author_id and ff.kind = 'not_interested')))
  ),
  scored as (
    select c.*,
      (exp(-extract(epoch from (now() - c.created_at)) / 3600.0 / 24.0) * 10)
      + ln(1 + c.likes_count) * 2 + ln(1 + c.comments_count) * 3 + ln(1 + c.reposts_count) * 2 + ln(1 + c.saves_count) * 1.5
      + case when c.following then 6 else 0 end
      + c.shared * 1.5
      + case when coalesce(c.same_country, false) then 1 else 0 end
      - case when c.seen then 8 else 0 end as score
    from candidates c
  )
  select public.post_json(row(s.id, s.author_id, s.type, s.text, s.audience, s.allow_comments, s.shared_post_id, s.location_name, s.likes_count, s.comments_count, s.reposts_count, s.saves_count, s.views_count, s.removed_at, s.removed_by, s.removed_reason, s.edited_at, s.created_at, s.updated_at)::public.posts, auth.uid())
  from scored s
  order by s.score desc, s.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50)) offset greatest(0, coalesce(p_offset, 0))
$$;

create or replace function public.get_feed_trending(p_limit integer default 20, p_offset integer default 0)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.post_json(p, auth.uid())
  from public.posts p
  where p.removed_at is null
    and p.audience = 'public'
    and p.created_at > now() - interval '72 hours'
    and public.can_view_post_of(p.author_id, p.audience, auth.uid())
    and not exists (select 1 from public.feed_feedback ff where ff.user_id = auth.uid() and (ff.post_id = p.id or (ff.author_id = p.author_id and ff.kind = 'not_interested')))
    and exists (select 1 from public.profiles pr where pr.id = p.author_id and pr.discoverable and pr.account_status = 'active')
  order by (p.likes_count + p.comments_count * 2 + p.reposts_count * 3 + p.saves_count * 2 + 1)::numeric
           / power(extract(epoch from (now() - p.created_at)) / 3600.0 + 2, 1.3) desc, p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50)) offset greatest(0, coalesce(p_offset, 0))
$$;

create or replace function public.haversine_km(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns numeric language sql immutable as $$
  select (6371 * acos(least(1, greatest(-1,
    cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2) - radians(lng1)) + sin(radians(lat1)) * sin(radians(lat2))))))::numeric
$$;

create or replace function public.get_feed_nearby(p_limit integer default 20, p_offset integer default 0, p_radius_km numeric default 50)
returns setof jsonb language sql stable security definer set search_path = public as $$
  with me as (
    select ul.lat, ul.lng from public.user_locations ul
    join public.user_settings us on us.user_id = ul.user_id
    where ul.user_id = auth.uid() and us.nearby_enabled
  )
  select public.post_json(p, auth.uid()) || jsonb_build_object('distance_km', round(public.haversine_km(me.lat, me.lng, ul.lat, ul.lng)))
  from public.posts p
  join public.user_locations ul on ul.user_id = p.author_id
  join public.user_settings us on us.user_id = p.author_id and us.nearby_enabled
  join me on true
  where p.removed_at is null
    and p.audience = 'public'
    and p.author_id <> auth.uid()
    and p.created_at > now() - interval '30 days'
    and abs(ul.lat - me.lat) <= p_radius_km / 111.0
    and abs(ul.lng - me.lng) <= p_radius_km / (111.0 * greatest(0.2, cos(radians(me.lat))))
    and public.haversine_km(me.lat, me.lng, ul.lat, ul.lng) <= p_radius_km
    and public.can_view_post_of(p.author_id, p.audience, auth.uid())
    and not exists (select 1 from public.feed_feedback ff where ff.user_id = auth.uid() and (ff.post_id = p.id or (ff.author_id = p.author_id and ff.kind = 'not_interested')))
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50)) offset greatest(0, coalesce(p_offset, 0))
$$;

create or replace function public.get_user_posts(p_user uuid, p_kind text default 'posts', p_limit integer default 20, p_before timestamptz default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.post_json(p, auth.uid())
  from public.posts p
  where p.author_id = p_user
    and (p.removed_at is null or p.author_id = auth.uid() or public.is_admin())
    and public.can_view_post_of(p.author_id, p.audience, auth.uid())
    and (p_before is null or p.created_at < p_before)
    and (case p_kind
           when 'photos' then p.type in ('photo', 'carousel')
           when 'videos' then p.type = 'video'
           when 'polls' then p.type = 'poll'
           else true end)
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
$$;

create or replace function public.get_user_reposts(p_user uuid, p_limit integer default 20, p_before timestamptz default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.post_json(p, auth.uid()) || jsonb_build_object('reposted_at', r.created_at, 'reposted_by', public.profile_card_json(r.user_id))
  from public.reposts r join public.posts p on p.id = r.post_id
  where r.user_id = p_user and p.removed_at is null
    and public.can_view_post_of(p.author_id, p.audience, auth.uid())
    and public.can_view_profile(p_user)
    and (p_before is null or r.created_at < p_before)
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
$$;

create or replace function public.get_saved_posts(p_limit integer default 20, p_before timestamptz default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.post_json(p, auth.uid()) || jsonb_build_object('saved_at', s.created_at)
  from public.saved_posts s join public.posts p on p.id = s.post_id
  where s.user_id = auth.uid() and p.removed_at is null
    and (p_before is null or s.created_at < p_before)
  order by s.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
$$;

create or replace function public.get_hashtag_posts(p_tag text, p_limit integer default 20, p_before timestamptz default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.post_json(p, auth.uid())
  from public.post_hashtags ph
  join public.hashtags h on h.id = ph.hashtag_id
  join public.posts p on p.id = ph.post_id
  where h.tag = lower(ltrim(p_tag, '#'))
    and p.removed_at is null and p.audience = 'public'
    and public.can_view_post_of(p.author_id, p.audience, auth.uid())
    and (p_before is null or p.created_at < p_before)
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
$$;

create or replace function public.get_trending_hashtags(p_limit integer default 10)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('tag', t.tag, 'posts_count', t.posts_count, 'recent_count', t.recent) order by t.recent desc, t.posts_count desc), '[]'::jsonb)
  from (
    select h.tag, h.posts_count, count(ph.post_id) as recent
    from public.hashtags h
    left join public.post_hashtags ph on ph.hashtag_id = h.id and ph.created_at > now() - interval '7 days'
    group by h.id
    having count(ph.post_id) > 0 or h.posts_count > 0
    order by recent desc, h.posts_count desc
    limit greatest(1, least(coalesce(p_limit, 10), 30))
  ) t
$$;

-- ----------------------------------------------------------------------------
-- Stories
-- ----------------------------------------------------------------------------
create or replace function public.story_json(s public.stories, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', s.id, 'kind', s.kind, 'media_url', s.media_url, 'thumbnail_url', s.thumbnail_url, 'text', s.text,
    'style', s.style, 'stickers', s.stickers, 'caption', s.caption, 'music_title', s.music_title,
    'audience', s.audience, 'duration_ms', s.duration_ms, 'views_count', s.views_count,
    'created_at', s.created_at, 'expires_at', s.expires_at,
    'author', public.profile_card_json(s.author_id),
    'viewer', jsonb_build_object(
      'seen', exists (select 1 from public.story_views v where v.story_id = s.id and v.viewer_id = p_viewer),
      'reaction', (select r.emoji from public.story_reactions r where r.story_id = s.id and r.user_id = p_viewer),
      'is_author', s.author_id = p_viewer)
  )
$$;

create or replace function public.create_story(
  p_kind public.story_kind, p_media_url text default null, p_thumbnail_url text default null, p_text text default null,
  p_style jsonb default '{}'::jsonb, p_stickers jsonb default '[]'::jsonb, p_caption text default null,
  p_music_title text default null, p_audience public.audience_type default null, p_duration_ms integer default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid; v_audience public.audience_type;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_kind <> 'text' and (p_media_url is null or position('/' || v_me::text || '/' in p_media_url) = 0) then
    raise exception 'MEDIA_NOT_OWNED' using errcode = '42501';
  end if;
  if p_kind = 'text' and nullif(trim(coalesce(p_text, '')), '') is null then raise exception 'TEXT_REQUIRED' using errcode = '23514'; end if;
  select coalesce(p_audience, story_audience, 'followers') into v_audience from public.user_settings where user_id = v_me;
  if v_audience = 'nobody' then v_audience := 'friends'; end if;
  insert into public.stories (author_id, kind, media_url, thumbnail_url, text, style, stickers, caption, music_title, audience, duration_ms)
  values (v_me, p_kind, p_media_url, p_thumbnail_url, nullif(trim(coalesce(p_text, '')), ''), coalesce(p_style, '{}'::jsonb), coalesce(p_stickers, '[]'::jsonb),
          nullif(trim(coalesce(p_caption, '')), ''), p_music_title, coalesce(v_audience, 'followers'), p_duration_ms)
  returning id into v_id;
  return public.story_json((select s from public.stories s where s.id = v_id), v_me);
end $$;

create or replace function public.delete_story(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.stories where id = p_id and (author_id = auth.uid() or public.is_admin());
  if not found then raise exception 'STORY_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

-- Story tray: authors with active stories visible to the viewer, self first, unseen first.
create or replace function public.get_story_tray()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'author', public.profile_card_json(t.author_id),
      'story_count', t.story_count,
      'latest_at', t.latest_at,
      'has_unseen', t.unseen > 0,
      'preview_url', t.preview_url,
      'is_self', t.author_id = auth.uid()
    ) order by (t.author_id = auth.uid()) desc, (t.unseen > 0) desc, t.latest_at desc), '[]'::jsonb)
  from (
    select s.author_id, count(*) as story_count, max(s.created_at) as latest_at,
           count(*) filter (where not exists (select 1 from public.story_views v where v.story_id = s.id and v.viewer_id = auth.uid())) as unseen,
           (array_agg(coalesce(s.thumbnail_url, s.media_url) order by s.created_at desc))[1] as preview_url
    from public.stories s
    where s.removed_at is null and s.expires_at > now()
      and (s.author_id = auth.uid()
           or public.is_following(auth.uid(), s.author_id)
           or public.are_friends(auth.uid(), s.author_id))
      and public.can_view_story_of(s.author_id, s.audience, auth.uid())
    group by s.author_id
  ) t
$$;

create or replace function public.get_user_stories(p_user uuid)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.story_json(s, auth.uid())
  from public.stories s
  where s.author_id = p_user and s.removed_at is null and s.expires_at > now()
    and public.can_view_story_of(s.author_id, s.audience, auth.uid())
  order by s.created_at asc
$$;

create or replace function public.mark_story_viewed(p_story uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_s public.stories;
begin
  if auth.uid() is null then return; end if;
  select * into v_s from public.stories where id = p_story and removed_at is null;
  if not found or v_s.author_id = auth.uid() or not public.can_view_story_of(v_s.author_id, v_s.audience, auth.uid()) then return; end if;
  insert into public.story_views (story_id, viewer_id) values (p_story, auth.uid()) on conflict do nothing;
end $$;

create or replace function public.react_story(p_story uuid, p_emoji text)
returns void language plpgsql security definer set search_path = public as $$
declare v_s public.stories;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into v_s from public.stories where id = p_story and removed_at is null and expires_at > now();
  if not found or not public.can_view_story_of(v_s.author_id, v_s.audience, auth.uid()) then raise exception 'STORY_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_emoji is null or char_length(p_emoji) = 0 then
    delete from public.story_reactions where story_id = p_story and user_id = auth.uid();
    return;
  end if;
  insert into public.story_reactions (story_id, user_id, emoji) values (p_story, auth.uid(), left(p_emoji, 8))
  on conflict (story_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  perform public.create_notification(v_s.author_id, auth.uid(), 'story_reaction', 'story', p_story::text, jsonb_build_object('emoji', left(p_emoji, 8)));
end $$;

create or replace function public.get_story_viewers(p_story uuid, p_limit integer default 100)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('user', public.profile_card_json(v.viewer_id), 'viewed_at', v.viewed_at,
                     'reaction', (select r.emoji from public.story_reactions r where r.story_id = p_story and r.user_id = v.viewer_id)) order by v.viewed_at desc), '[]'::jsonb)
  from (select * from public.story_views v where v.story_id = p_story
        and exists (select 1 from public.stories s where s.id = p_story and s.author_id = auth.uid())
        order by v.viewed_at desc limit greatest(1, least(p_limit, 500))) v
$$;

create or replace function public.create_highlight(p_title text, p_story_ids uuid[], p_cover_url text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid; v_i integer := 0; v_sid uuid;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  insert into public.story_highlights (user_id, title, cover_url, position)
  values (v_me, left(trim(p_title), 30), p_cover_url, (select coalesce(max(position), -1) + 1 from public.story_highlights where user_id = v_me))
  returning id into v_id;
  foreach v_sid in array coalesce(p_story_ids, '{}'::uuid[]) loop
    if exists (select 1 from public.stories s where s.id = v_sid and s.author_id = v_me) then
      insert into public.story_highlight_items (highlight_id, story_id, position) values (v_id, v_sid, v_i) on conflict do nothing;
      v_i := v_i + 1;
    end if;
  end loop;
  return jsonb_build_object('id', v_id, 'title', left(trim(p_title), 30), 'cover_url', p_cover_url, 'count', v_i);
end $$;

create or replace function public.update_highlight(p_id uuid, p_title text default null, p_add uuid[] default null, p_remove uuid[] default null, p_cover_url text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_sid uuid; v_pos integer;
begin
  if not exists (select 1 from public.story_highlights where id = p_id and user_id = auth.uid()) then raise exception 'HIGHLIGHT_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.story_highlights set title = coalesce(left(trim(p_title), 30), title), cover_url = coalesce(p_cover_url, cover_url) where id = p_id;
  if p_remove is not null then delete from public.story_highlight_items where highlight_id = p_id and story_id = any (p_remove); end if;
  if p_add is not null then
    select coalesce(max(position), -1) + 1 into v_pos from public.story_highlight_items where highlight_id = p_id;
    foreach v_sid in array p_add loop
      if exists (select 1 from public.stories s where s.id = v_sid and s.author_id = auth.uid()) then
        insert into public.story_highlight_items (highlight_id, story_id, position) values (p_id, v_sid, v_pos) on conflict do nothing;
        v_pos := v_pos + 1;
      end if;
    end loop;
  end if;
end $$;

create or replace function public.delete_highlight(p_id uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.story_highlights where id = p_id and user_id = auth.uid()
$$;

create or replace function public.get_highlights(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', h.id, 'title', h.title, 'position', h.position,
      'cover_url', coalesce(h.cover_url, (select coalesce(s.thumbnail_url, s.media_url) from public.story_highlight_items i join public.stories s on s.id = i.story_id where i.highlight_id = h.id order by i.position limit 1)),
      'count', (select count(*) from public.story_highlight_items i where i.highlight_id = h.id)
    ) order by h.position), '[]'::jsonb)
  from public.story_highlights h
  where h.user_id = p_user and public.can_view_profile(p_user)
$$;

create or replace function public.get_highlight_stories(p_highlight uuid)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.story_json(s, auth.uid())
  from public.story_highlight_items i
  join public.stories s on s.id = i.story_id
  join public.story_highlights h on h.id = i.highlight_id
  where i.highlight_id = p_highlight and s.removed_at is null
    and public.can_view_profile(h.user_id)
    and (h.user_id = auth.uid() or public.can_view_story_of(s.author_id, s.audience, auth.uid()))
  order by i.position
$$;

create or replace function public.get_my_archived_stories(p_limit integer default 50)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.story_json(s, auth.uid()) from public.stories s
  where s.author_id = auth.uid() and s.removed_at is null
  order by s.created_at desc limit greatest(1, least(p_limit, 200))
$$;

-- ----------------------------------------------------------------------------
-- Location, nearby, online, matching
-- ----------------------------------------------------------------------------
create or replace function public.update_my_location(p_lat double precision, p_lng double precision, p_city text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'INVALID_LOCATION' using errcode = '23514';
  end if;
  -- Stored at ~1 km precision only; exact coordinates never persist.
  insert into public.user_locations (user_id, lat, lng, city, updated_at)
  values (auth.uid(), round(p_lat::numeric, 2), round(p_lng::numeric, 2), left(p_city, 80), now())
  on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, city = coalesce(excluded.city, public.user_locations.city), updated_at = now();
end $$;

create or replace function public.clear_my_location()
returns void language sql security definer set search_path = public as $$
  delete from public.user_locations where user_id = auth.uid()
$$;

create or replace function public.get_nearby_people(p_limit integer default 30, p_radius_km numeric default 50)
returns jsonb language sql stable security definer set search_path = public as $$
  with me as (
    select ul.lat, ul.lng from public.user_locations ul
    join public.user_settings us on us.user_id = ul.user_id
    where ul.user_id = auth.uid() and us.nearby_enabled
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'profile', public.profile_card_json(t.user_id) || jsonb_build_object('bio', t.bio, 'followers_count', t.followers_count),
      'distance_km', t.distance_km,
      'city', t.city,
      'is_online', t.is_online
    ) order by t.distance_km, t.popularity_score desc), '[]'::jsonb)
  from (
    select ul.user_id, pr.bio, pr.followers_count, pr.popularity_score, ul.city,
           greatest(1, round(public.haversine_km(me.lat, me.lng, ul.lat, ul.lng))) as distance_km,
           (select (p.is_online and p.last_seen_at > now() - interval '3 minutes') and s.show_online_status from public.user_presence p where p.user_id = ul.user_id) as is_online
    from public.user_locations ul
    join me on true
    join public.profiles pr on pr.id = ul.user_id
    join public.user_settings s on s.user_id = ul.user_id
    where ul.user_id <> auth.uid()
      and s.nearby_enabled
      and pr.discoverable and pr.account_status = 'active' and pr.onboarding_completed
      and ul.updated_at > now() - interval '30 days'
      and abs(ul.lat - me.lat) <= p_radius_km / 111.0
      and abs(ul.lng - me.lng) <= p_radius_km / (111.0 * greatest(0.2, cos(radians(me.lat))))
      and public.haversine_km(me.lat, me.lng, ul.lat, ul.lng) <= p_radius_km
      and not public.is_blocked_either(auth.uid(), ul.user_id)
    order by distance_km, pr.popularity_score desc
    limit greatest(1, least(coalesce(p_limit, 30), 100))
  ) t
$$;

create or replace function public.get_online_people(p_limit integer default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.profile_card_json(t.user_id) || jsonb_build_object('bio', t.bio, 'followers_count', t.followers_count) order by t.popularity_score desc, t.last_seen_at desc), '[]'::jsonb)
  from (
    select p.user_id, p.last_seen_at, pr.bio, pr.followers_count, pr.popularity_score
    from public.user_presence p
    join public.profiles pr on pr.id = p.user_id
    join public.user_settings s on s.user_id = p.user_id
    where p.user_id <> auth.uid()
      and p.is_online and p.last_seen_at > now() - interval '3 minutes'
      and s.show_online_status
      and pr.discoverable and pr.account_status = 'active' and pr.onboarding_completed
      and not public.is_blocked_either(auth.uid(), p.user_id)
    order by pr.popularity_score desc, p.last_seen_at desc
    limit greatest(1, least(coalesce(p_limit, 30), 100))
  ) t
$$;

-- Random matching: adults only, both opted in, compatible interests, never repeated within 14 days.
create or replace function public.get_match_candidate()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_row record;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not coalesce(public.is_adult(v_me), false) then
    raise exception 'ADULTS_ONLY' using errcode = '42501', hint = 'Random matching is available from age 18.';
  end if;
  if not exists (select 1 from public.user_settings where user_id = v_me and random_match_enabled) then
    raise exception 'MATCHING_DISABLED' using errcode = '42501', hint = 'Turn on random matching in Settings → Privacy.';
  end if;
  select pr.id, pr.username, pr.display_name, pr.avatar_url, pr.is_verified, pr.country_code, pr.bio, pr.followers_count,
         (select count(*) from public.user_interests a join public.user_interests b on a.interest_id = b.interest_id where a.user_id = v_me and b.user_id = pr.id) as shared,
         (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'emoji', i.emoji)), '[]'::jsonb)
            from public.user_interests ui join public.interests i on i.id = ui.interest_id where ui.user_id = pr.id) as interests,
         coalesce((select s.looking_for from public.user_settings s where s.user_id = pr.id), '{}'::text[]) as looking_for
    into v_row
  from public.profiles pr
  join public.user_settings s on s.user_id = pr.id
  join public.user_private up on up.user_id = pr.id
  where pr.id <> v_me
    and pr.account_status = 'active' and pr.discoverable and pr.onboarding_completed
    and s.random_match_enabled
    and up.birth_date is not null and up.birth_date <= current_date - interval '18 years'
    and not public.is_blocked_either(v_me, pr.id)
    and not public.are_friends(v_me, pr.id)
    and not exists (select 1 from public.match_history mh where mh.user_id = v_me and mh.candidate_id = pr.id and mh.created_at > now() - interval '14 days')
    and not exists (select 1 from public.friend_requests fr where fr.status = 'pending' and ((fr.sender_id = v_me and fr.receiver_id = pr.id) or (fr.sender_id = pr.id and fr.receiver_id = v_me)))
  order by (select count(*) from public.user_interests a join public.user_interests b on a.interest_id = b.interest_id where a.user_id = v_me and b.user_id = pr.id) desc,
           random()
  limit 1;
  if v_row.id is null then return null; end if;
  return jsonb_build_object(
    'profile', jsonb_build_object('id', v_row.id, 'username', v_row.username, 'display_name', v_row.display_name, 'avatar_url', v_row.avatar_url,
                                  'is_verified', v_row.is_verified, 'country_code', v_row.country_code, 'bio', v_row.bio, 'followers_count', v_row.followers_count),
    'shared_interests', v_row.shared, 'interests', v_row.interests, 'looking_for', to_jsonb(v_row.looking_for));
end $$;

create or replace function public.match_action(p_candidate uuid, p_action public.match_action)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_request uuid;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  insert into public.match_history (user_id, candidate_id, action) values (v_me, p_candidate, p_action)
  on conflict (user_id, candidate_id) do update set action = excluded.action, created_at = now();
  if p_action = 'friend' then
    v_request := public.send_friend_request(p_candidate, 'We matched on Friendzy 👋');
    return jsonb_build_object('friend_request_id', v_request);
  elsif p_action = 'block' then
    perform public.block_user(p_candidate);
  end if;
  return '{}'::jsonb;
end $$;

-- ----------------------------------------------------------------------------
-- Search
-- ----------------------------------------------------------------------------
create or replace function public.search_all(p_query text, p_limit integer default 8)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_q text := trim(coalesce(p_query, '')); v_users jsonb; v_posts jsonb; v_tags jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if char_length(v_q) = 0 then return jsonb_build_object('users', '[]'::jsonb, 'posts', '[]'::jsonb, 'hashtags', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) into v_users from (select * from public.search_profiles(v_q, null, p_limit, 0)) u;
  select coalesce(jsonb_agg(public.post_json(p, auth.uid())), '[]'::jsonb) into v_posts
  from (select p.* from public.posts p
        where p.removed_at is null and p.audience = 'public'
          and p.text ilike '%' || v_q || '%'
          and public.can_view_post_of(p.author_id, p.audience, auth.uid())
        order by p.likes_count desc, p.created_at desc limit greatest(1, least(p_limit, 20))) p;
  select coalesce(jsonb_agg(jsonb_build_object('tag', h.tag, 'posts_count', h.posts_count, 'videos_count', h.videos_count) order by h.posts_count + h.videos_count desc), '[]'::jsonb) into v_tags
  from (select * from public.hashtags h where h.tag ilike '%' || lower(ltrim(v_q, '#')) || '%' order by h.posts_count + h.videos_count desc limit greatest(1, least(p_limit, 20))) h;
  return jsonb_build_object('users', v_users, 'posts', v_posts, 'hashtags', v_tags);
end $$;

create or replace function public.search_posts(p_query text, p_limit integer default 20, p_offset integer default 0)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.post_json(p, auth.uid()) from public.posts p
  where p.removed_at is null and p.audience = 'public'
    and p.text ilike '%' || trim(p_query) || '%'
    and public.can_view_post_of(p.author_id, p.audience, auth.uid())
  order by p.likes_count desc, p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50)) offset greatest(0, coalesce(p_offset, 0))
$$;

create or replace function public.save_search(p_query text, p_kind text default 'all')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or nullif(trim(coalesce(p_query, '')), '') is null then return; end if;
  delete from public.search_history where user_id = auth.uid() and lower(query) = lower(trim(p_query));
  insert into public.search_history (user_id, query, kind) values (auth.uid(), left(trim(p_query), 100), coalesce(p_kind, 'all'));
  delete from public.search_history where user_id = auth.uid() and id not in (
    select id from public.search_history where user_id = auth.uid() order by created_at desc limit 20);
end $$;

create or replace function public.get_recent_searches()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'query', s.query, 'kind', s.kind, 'created_at', s.created_at) order by s.created_at desc), '[]'::jsonb)
  from public.search_history s where s.user_id = auth.uid()
$$;

create or replace function public.clear_search_history(p_id bigint default null)
returns void language sql security definer set search_path = public as $$
  delete from public.search_history where user_id = auth.uid() and (p_id is null or id = p_id)
$$;

create or replace function public.get_trending_searches(p_limit integer default 10)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('query', t.q, 'count', t.n) order by t.n desc), '[]'::jsonb)
  from (select lower(query) as q, count(distinct user_id) as n from public.search_history
        where created_at > now() - interval '7 days' group by lower(query) having count(distinct user_id) >= 2
        order by n desc limit greatest(1, least(coalesce(p_limit, 10), 30))) t
$$;

-- Housekeeping (call from a scheduled job / admin): expire old impressions & stories.
create or replace function public.cleanup_social()
returns void language sql security definer set search_path = public as $$
  delete from public.post_impressions where seen_at < now() - interval '30 days';
  delete from public.search_history where created_at < now() - interval '90 days';
$$;

-- ----------------------------------------------------------------------------
-- Function privileges
-- ----------------------------------------------------------------------------
do $do$
declare f text;
begin
  foreach f in array array[
    'public.is_following(uuid, uuid)', 'public.are_friends(uuid, uuid)', 'public.can_view_post_of(uuid, public.post_audience, uuid)',
    'public.can_view_story_of(uuid, public.audience_type, uuid)', 'public.can_interact(uuid, uuid, public.audience_type)',
    'public.profile_card_json(uuid)', 'public.post_json(public.posts, uuid, integer)', 'public.comment_json(public.comments, uuid)', 'public.story_json(public.stories, uuid)',
    'public.create_post(public.post_type, text, public.post_audience, boolean, jsonb, jsonb, uuid, text)',
    'public.edit_post(uuid, text, public.post_audience, boolean)', 'public.delete_post(uuid)', 'public.get_post(uuid)',
    'public.toggle_post_reaction(uuid, public.reaction_type)', 'public.get_post_reactions(uuid, integer, integer)',
    'public.toggle_repost(uuid)', 'public.toggle_save_post(uuid)', 'public.feed_feedback(uuid, public.feed_feedback_kind)', 'public.undo_feed_feedback(uuid)',
    'public.record_impressions(uuid[])', 'public.vote_poll(uuid, uuid[])',
    'public.add_comment(uuid, text, uuid, text)', 'public.edit_comment(uuid, text)', 'public.delete_comment(uuid)',
    'public.toggle_comment_reaction(uuid, public.reaction_type)', 'public.get_comments(uuid, integer, timestamptz, uuid)',
    'public.get_feed_following(integer, timestamptz)', 'public.get_feed_for_you(integer, integer)', 'public.get_feed_trending(integer, integer)',
    'public.get_feed_nearby(integer, integer, numeric)', 'public.get_user_posts(uuid, text, integer, timestamptz)', 'public.get_user_reposts(uuid, integer, timestamptz)',
    'public.get_saved_posts(integer, timestamptz)', 'public.get_hashtag_posts(text, integer, timestamptz)', 'public.get_trending_hashtags(integer)',
    'public.create_story(public.story_kind, text, text, text, jsonb, jsonb, text, text, public.audience_type, integer)', 'public.delete_story(uuid)',
    'public.get_story_tray()', 'public.get_user_stories(uuid)', 'public.mark_story_viewed(uuid)', 'public.react_story(uuid, text)', 'public.get_story_viewers(uuid, integer)',
    'public.create_highlight(text, uuid[], text)', 'public.update_highlight(uuid, text, uuid[], uuid[], text)', 'public.delete_highlight(uuid)',
    'public.get_highlights(uuid)', 'public.get_highlight_stories(uuid)', 'public.get_my_archived_stories(integer)',
    'public.update_my_location(double precision, double precision, text)', 'public.clear_my_location()', 'public.get_nearby_people(integer, numeric)',
    'public.get_online_people(integer)', 'public.get_match_candidate()', 'public.match_action(uuid, public.match_action)',
    'public.search_all(text, integer)', 'public.search_posts(text, integer, integer)', 'public.save_search(text, text)', 'public.get_recent_searches()',
    'public.clear_search_history(bigint)', 'public.get_trending_searches(integer)', 'public.haversine_km(numeric, numeric, numeric, numeric)',
    'public.extract_hashtags(text)', 'public.extract_mentions(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- Internal helpers: not callable by clients.
  foreach f in array array['public.link_post_hashtags(uuid, text)', 'public.notify_mentions(uuid, text, text, text, jsonb)', 'public.cleanup_social()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $do$;

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.posts enable row level security;
alter table public.post_media enable row level security;
alter table public.post_polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
alter table public.post_likes enable row level security;
alter table public.comments enable row level security;
alter table public.comment_reactions enable row level security;
alter table public.reposts enable row level security;
alter table public.saved_posts enable row level security;
alter table public.feed_feedback enable row level security;
alter table public.post_impressions enable row level security;
alter table public.hashtags enable row level security;
alter table public.post_hashtags enable row level security;
alter table public.stories enable row level security;
alter table public.story_views enable row level security;
alter table public.story_reactions enable row level security;
alter table public.story_highlights enable row level security;
alter table public.story_highlight_items enable row level security;
alter table public.user_locations enable row level security;
alter table public.match_history enable row level security;
alter table public.search_history enable row level security;

drop policy if exists "posts_select" on public.posts;
create policy "posts_select" on public.posts for select to authenticated
  using ((removed_at is null and public.can_view_post_of(author_id, audience, auth.uid())) or author_id = auth.uid() or public.is_admin());

drop policy if exists "post_media_select" on public.post_media;
create policy "post_media_select" on public.post_media for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and (p.author_id = auth.uid() or public.is_admin() or (p.removed_at is null and public.can_view_post_of(p.author_id, p.audience, auth.uid())))));

drop policy if exists "post_polls_select" on public.post_polls;
create policy "post_polls_select" on public.post_polls for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and (p.author_id = auth.uid() or public.can_view_post_of(p.author_id, p.audience, auth.uid()))));

drop policy if exists "poll_options_select" on public.poll_options;
create policy "poll_options_select" on public.poll_options for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and (p.author_id = auth.uid() or public.can_view_post_of(p.author_id, p.audience, auth.uid()))));

drop policy if exists "poll_votes_select_own" on public.poll_votes;
create policy "poll_votes_select_own" on public.poll_votes for select to authenticated using (user_id = auth.uid());

drop policy if exists "post_likes_select" on public.post_likes;
create policy "post_likes_select" on public.post_likes for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.posts p where p.id = post_id and public.can_view_post_of(p.author_id, p.audience, auth.uid())));

drop policy if exists "comments_select" on public.comments;
create policy "comments_select" on public.comments for select to authenticated
  using (author_id = auth.uid() or public.is_admin() or exists (select 1 from public.posts p where p.id = post_id and p.removed_at is null and public.can_view_post_of(p.author_id, p.audience, auth.uid())));

drop policy if exists "comment_reactions_select" on public.comment_reactions;
create policy "comment_reactions_select" on public.comment_reactions for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.comments c join public.posts p on p.id = c.post_id where c.id = comment_id and public.can_view_post_of(p.author_id, p.audience, auth.uid())));

drop policy if exists "reposts_select" on public.reposts;
create policy "reposts_select" on public.reposts for select to authenticated using (user_id = auth.uid() or public.can_view_profile(user_id));

drop policy if exists "saved_posts_select_own" on public.saved_posts;
create policy "saved_posts_select_own" on public.saved_posts for select to authenticated using (user_id = auth.uid());

drop policy if exists "feed_feedback_select_own" on public.feed_feedback;
create policy "feed_feedback_select_own" on public.feed_feedback for select to authenticated using (user_id = auth.uid());

drop policy if exists "post_impressions_select_own" on public.post_impressions;
create policy "post_impressions_select_own" on public.post_impressions for select to authenticated using (user_id = auth.uid());

drop policy if exists "hashtags_select" on public.hashtags;
create policy "hashtags_select" on public.hashtags for select to authenticated using (true);

drop policy if exists "post_hashtags_select" on public.post_hashtags;
create policy "post_hashtags_select" on public.post_hashtags for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and (p.author_id = auth.uid() or public.can_view_post_of(p.author_id, p.audience, auth.uid()))));

drop policy if exists "stories_select" on public.stories;
create policy "stories_select" on public.stories for select to authenticated
  using (author_id = auth.uid() or public.is_admin() or (removed_at is null and expires_at > now() and public.can_view_story_of(author_id, audience, auth.uid())));

drop policy if exists "story_views_select" on public.story_views;
create policy "story_views_select" on public.story_views for select to authenticated
  using (viewer_id = auth.uid() or exists (select 1 from public.stories s where s.id = story_id and s.author_id = auth.uid()));

drop policy if exists "story_reactions_select" on public.story_reactions;
create policy "story_reactions_select" on public.story_reactions for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.stories s where s.id = story_id and s.author_id = auth.uid()));

drop policy if exists "story_highlights_select" on public.story_highlights;
create policy "story_highlights_select" on public.story_highlights for select to authenticated using (user_id = auth.uid() or public.can_view_profile(user_id));

drop policy if exists "story_highlight_items_select" on public.story_highlight_items;
create policy "story_highlight_items_select" on public.story_highlight_items for select to authenticated
  using (exists (select 1 from public.story_highlights h where h.id = highlight_id and (h.user_id = auth.uid() or public.can_view_profile(h.user_id))));

drop policy if exists "user_locations_select_own" on public.user_locations;
create policy "user_locations_select_own" on public.user_locations for select to authenticated using (user_id = auth.uid());

drop policy if exists "match_history_select_own" on public.match_history;
create policy "match_history_select_own" on public.match_history for select to authenticated using (user_id = auth.uid());

drop policy if exists "search_history_own" on public.search_history;
create policy "search_history_own" on public.search_history for select to authenticated using (user_id = auth.uid());
drop policy if exists "search_history_delete_own" on public.search_history;
create policy "search_history_delete_own" on public.search_history for delete to authenticated using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Realtime & storage
-- ----------------------------------------------------------------------------
do $do$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comments') then
    alter publication supabase_realtime add table public.comments;
  end if;
end $do$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('posts',   'posts',   true, 104857600, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm']),
  ('stories', 'stories', true, 52428800,  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "social_media_public_read" on storage.objects;
create policy "social_media_public_read" on storage.objects for select using (bucket_id in ('posts', 'stories'));
drop policy if exists "social_media_insert_own" on storage.objects;
create policy "social_media_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id in ('posts', 'stories') and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "social_media_update_own" on storage.objects;
create policy "social_media_update_own" on storage.objects for update to authenticated
  using (bucket_id in ('posts', 'stories') and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "social_media_delete_own" on storage.objects;
create policy "social_media_delete_own" on storage.objects for delete to authenticated
  using (bucket_id in ('posts', 'stories') and (storage.foldername(name))[1] = auth.uid()::text);


-- ########## 20261125000003_messaging.sql ##########

-- ============================================================================
-- Friendzy — Phase 3: messaging
-- Direct + group conversations, messages with attachments / replies / forwards /
-- reactions / stars / pins / edits / delete-for-me / delete-for-everyone,
-- read & delivery watermarks, message requests, mute / archive / pin / mark
-- unread / clear / disappearing messages / wallpapers, group administration
-- with invite links & join requests, search, private chat storage bucket.
--
-- Transport security: TLS to Supabase; media in a private bucket served via
-- short-lived signed URLs. This is NOT end-to-end encryption; the schema keeps
-- message payloads opaque (text + metadata jsonb) so client-side E2EE can be
-- layered on later without changing tables.
-- ============================================================================

do $do$ begin
  create type public.conversation_kind as enum ('direct', 'group');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.member_role as enum ('owner', 'admin', 'member');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.member_state as enum ('active', 'pending', 'left', 'removed');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.message_kind as enum (
    'text', 'image', 'video', 'audio', 'document', 'sticker', 'gif', 'location',
    'post', 'profile', 'story_reply', 'video_share', 'call', 'system'
  );
exception when duplicate_object then null; end $do$;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------
create table if not exists public.conversations (
  id                   uuid primary key default gen_random_uuid(),
  kind                 public.conversation_kind not null,
  title                text,
  avatar_url           text,
  description          text,
  created_by           uuid references public.profiles (id) on delete set null,
  direct_key           text unique,
  invite_code          text unique,
  join_approval        boolean not null default false,
  disappearing_seconds integer not null default 0,
  last_message_id      uuid,
  last_message_at      timestamptz,
  members_count        integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint conversations_title_len check (title is null or char_length(title) between 1 and 80),
  constraint conversations_description_len check (description is null or char_length(description) <= 500),
  constraint conversations_disappearing check (disappearing_seconds in (0, 86400, 604800, 7776000))
);
create index if not exists conversations_last_message_idx on public.conversations (last_message_at desc nulls last);
revoke all on public.conversations from anon, authenticated;
grant select on public.conversations to authenticated;

create table if not exists public.conversation_members (
  conversation_id    uuid not null references public.conversations (id) on delete cascade,
  user_id            uuid not null references public.profiles (id) on delete cascade,
  role               public.member_role not null default 'member',
  state              public.member_state not null default 'active',
  joined_at          timestamptz not null default clock_timestamp(),
  last_read_at       timestamptz not null default clock_timestamp(),
  last_delivered_at  timestamptz not null default clock_timestamp(),
  cleared_at         timestamptz,
  muted_until        timestamptz,
  is_archived        boolean not null default false,
  is_pinned          boolean not null default false,
  pinned_at          timestamptz,
  marked_unread      boolean not null default false,
  wallpaper          text,
  notifications      boolean not null default true,
  added_by           uuid references public.profiles (id) on delete set null,
  updated_at         timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx on public.conversation_members (user_id, state);
revoke all on public.conversation_members from anon, authenticated;
grant select on public.conversation_members to authenticated;

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid references public.profiles (id) on delete set null,
  kind            public.message_kind not null default 'text',
  text            text,
  metadata        jsonb not null default '{}'::jsonb,
  reply_to_id     uuid references public.messages (id) on delete set null,
  forwarded       boolean not null default false,
  client_id       text,
  edited_at       timestamptz,
  deleted_at      timestamptz,
  deleted_by      uuid references public.profiles (id) on delete set null,
  expires_at      timestamptz,
  created_at      timestamptz not null default clock_timestamp(),
  constraint messages_text_len check (text is null or char_length(text) <= 5000)
);
create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at desc);
create unique index if not exists messages_client_id_key on public.messages (sender_id, client_id) where client_id is not null;
create index if not exists messages_expires_idx on public.messages (expires_at) where expires_at is not null;
create index if not exists messages_text_trgm on public.messages using gin (text extensions.gin_trgm_ops);
revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;

alter table public.conversations drop constraint if exists conversations_last_message_fkey;
alter table public.conversations add constraint conversations_last_message_fkey foreign key (last_message_id) references public.messages (id) on delete set null;

create table if not exists public.message_attachments (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references public.messages (id) on delete cascade,
  position      smallint not null default 0,
  kind          public.media_kind not null,
  path          text not null,
  name          text,
  mime          text,
  size_bytes    bigint,
  width         integer,
  height        integer,
  duration_ms   integer,
  thumbnail_path text,
  waveform      jsonb,
  constraint message_attachments_name_len check (name is null or char_length(name) <= 255)
);
create index if not exists message_attachments_message_idx on public.message_attachments (message_id, position);
revoke all on public.message_attachments from anon, authenticated;
grant select on public.message_attachments to authenticated;

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id),
  constraint message_reactions_emoji_len check (char_length(emoji) between 1 and 8)
);
revoke all on public.message_reactions from anon, authenticated;
grant select on public.message_reactions to authenticated;

create table if not exists public.starred_messages (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
revoke all on public.starred_messages from anon, authenticated;
grant select on public.starred_messages to authenticated;

create table if not exists public.message_deletions (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
revoke all on public.message_deletions from anon, authenticated;
grant select on public.message_deletions to authenticated;

create table if not exists public.conversation_pins (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  message_id      uuid not null references public.messages (id) on delete cascade,
  pinned_by       uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (conversation_id, message_id)
);
revoke all on public.conversation_pins from anon, authenticated;
grant select on public.conversation_pins to authenticated;

create table if not exists public.group_join_requests (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  status          public.request_status not null default 'pending',
  created_at      timestamptz not null default now(),
  responded_at    timestamptz,
  responded_by    uuid references public.profiles (id) on delete set null
);
create unique index if not exists group_join_requests_pending_key on public.group_join_requests (conversation_id, user_id) where status = 'pending';
revoke all on public.group_join_requests from anon, authenticated;
grant select on public.group_join_requests to authenticated;

-- Sticker catalogue (admin managed). Seeded with emoji-style stickers rendered client-side.
create table if not exists public.stickers (
  id         serial primary key,
  pack       text not null,
  emoji      text,
  url        text,
  label      text,
  sort_order integer not null default 0,
  is_active  boolean not null default true
);
revoke all on public.stickers from anon, authenticated;
grant select on public.stickers to authenticated;
insert into public.stickers (pack, emoji, label, sort_order) values
  ('reactions', '😂', 'LOL', 1), ('reactions', '😍', 'Love it', 2), ('reactions', '🔥', 'Fire', 3), ('reactions', '👏', 'Bravo', 4),
  ('reactions', '🥳', 'Party', 5), ('reactions', '😭', 'Crying', 6), ('reactions', '🤔', 'Hmm', 7), ('reactions', '🙏', 'Thanks', 8),
  ('vibes', '✨', 'Sparkle', 10), ('vibes', '💜', 'Purple heart', 11), ('vibes', '🌈', 'Rainbow', 12), ('vibes', '⚡', 'Zap', 13),
  ('vibes', '🎉', 'Celebrate', 14), ('vibes', '🫶', 'Heart hands', 15), ('vibes', '👋', 'Wave', 16), ('vibes', '🫡', 'Salute', 17),
  ('daily', '☕', 'Coffee', 20), ('daily', '🍕', 'Pizza', 21), ('daily', '🎮', 'Gaming', 22), ('daily', '🎧', 'Music', 23),
  ('daily', '😴', 'Sleepy', 24), ('daily', '🏃', 'On my way', 25), ('daily', '📚', 'Studying', 26), ('daily', '🌙', 'Good night', 27)
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------
create or replace function public.is_conversation_member(p_conversation uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members m where m.conversation_id = p_conversation and m.user_id = p_user and m.state in ('active', 'pending'))
$$;

create or replace function public.is_conversation_admin(p_conversation uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members m where m.conversation_id = p_conversation and m.user_id = p_user and m.state = 'active' and m.role in ('owner', 'admin'))
$$;

create or replace function public.direct_key(p_a uuid, p_b uuid)
returns text language sql immutable as $$
  select least(p_a, p_b)::text || ':' || greatest(p_a, p_b)::text
$$;

create or replace function public.generate_invite_code()
returns text language sql volatile as $$
  select substr(replace(replace(encode(extensions.gen_random_bytes(9), 'base64'), '/', 'x'), '+', 'y'), 1, 12)
$$;

create or replace function public.message_preview(p_kind public.message_kind, p_text text, p_deleted boolean)
returns text language sql immutable as $$
  select case
    when p_deleted then 'Message deleted'
    when p_kind = 'text' then left(coalesce(p_text, ''), 140)
    when p_kind = 'image' then '📷 Photo'
    when p_kind = 'video' then '🎥 Video'
    when p_kind = 'audio' then '🎤 Voice message'
    when p_kind = 'document' then '📎 ' || coalesce(nullif(p_text, ''), 'Document')
    when p_kind = 'sticker' then coalesce(nullif(p_text, ''), 'Sticker')
    when p_kind = 'gif' then 'GIF'
    when p_kind = 'location' then '📍 Location'
    when p_kind = 'post' then 'Shared a post'
    when p_kind = 'profile' then 'Shared a profile'
    when p_kind = 'story_reply' then 'Replied to a story' || case when coalesce(p_text, '') <> '' then ': ' || left(p_text, 100) else '' end
    when p_kind = 'video_share' then 'Shared a video'
    when p_kind = 'call' then '📞 Call'
    else coalesce(p_text, '')
  end
$$;

-- Status of one of MY messages from the other members' watermarks.
create or replace function public.message_status(p_message public.messages)
returns text language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from public.conversation_members m where m.conversation_id = p_message.conversation_id and m.user_id <> p_message.sender_id and m.state = 'active') then 'sent'
    when not exists (select 1 from public.conversation_members m where m.conversation_id = p_message.conversation_id and m.user_id <> p_message.sender_id and m.state = 'active' and m.last_read_at < p_message.created_at) then 'read'
    when not exists (select 1 from public.conversation_members m where m.conversation_id = p_message.conversation_id and m.user_id <> p_message.sender_id and m.state = 'active' and m.last_delivered_at < p_message.created_at) then 'delivered'
    else 'sent'
  end
$$;

create or replace function public.message_json(m public.messages, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id,
    'conversation_id', m.conversation_id,
    'sender', case when m.sender_id is null then null else public.profile_card_json(m.sender_id) end,
    'kind', m.kind,
    'text', case when m.deleted_at is null then m.text else null end,
    'metadata', case when m.deleted_at is null then m.metadata else '{}'::jsonb end,
    'attachments', case when m.deleted_at is not null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'path', a.path, 'name', a.name, 'mime', a.mime, 'size_bytes', a.size_bytes,
                                          'width', a.width, 'height', a.height, 'duration_ms', a.duration_ms, 'thumbnail_path', a.thumbnail_path, 'waveform', a.waveform)
                       order by a.position)
      from public.message_attachments a where a.message_id = m.id), '[]'::jsonb) end,
    'reply_to', case when m.reply_to_id is null then null else (
      select jsonb_build_object('id', r.id, 'sender', case when r.sender_id is null then null else public.profile_card_json(r.sender_id) end,
                                'kind', r.kind, 'preview', public.message_preview(r.kind, r.text, r.deleted_at is not null), 'deleted', r.deleted_at is not null)
      from public.messages r where r.id = m.reply_to_id) end,
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('emoji', g.emoji, 'count', g.n, 'users', g.users))
      from (select r.emoji, count(*) as n, jsonb_agg(public.profile_card_json(r.user_id)) as users
            from public.message_reactions r where r.message_id = m.id group by r.emoji) g), '[]'::jsonb),
    'my_reaction', (select r.emoji from public.message_reactions r where r.message_id = m.id and r.user_id = p_viewer),
    'starred', exists (select 1 from public.starred_messages s where s.message_id = m.id and s.user_id = p_viewer),
    'pinned', exists (select 1 from public.conversation_pins p where p.message_id = m.id),
    'forwarded', m.forwarded,
    'edited_at', m.edited_at,
    'deleted', m.deleted_at is not null,
    'expires_at', m.expires_at,
    'created_at', m.created_at,
    'client_id', m.client_id,
    'is_mine', m.sender_id = p_viewer,
    'status', case when m.sender_id = p_viewer then public.message_status(m) else null end
  )
$$;

create or replace function public.conversation_json(c public.conversations, p_viewer uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me public.conversation_members;
  v_other uuid;
  v_last public.messages;
  v_unread integer;
begin
  select * into v_me from public.conversation_members where conversation_id = c.id and user_id = p_viewer;
  if c.kind = 'direct' then
    select user_id into v_other from public.conversation_members where conversation_id = c.id and user_id <> p_viewer limit 1;
  end if;
  if c.last_message_id is not null then
    select * into v_last from public.messages where id = c.last_message_id;
  end if;
  select count(*) into v_unread from public.messages msg
   where msg.conversation_id = c.id and msg.sender_id is distinct from p_viewer and msg.deleted_at is null
     and msg.created_at > coalesce(v_me.last_read_at, 'epoch'::timestamptz)
     and msg.created_at > coalesce(v_me.cleared_at, 'epoch'::timestamptz)
     and not exists (select 1 from public.message_deletions d where d.message_id = msg.id and d.user_id = p_viewer);
  return jsonb_build_object(
    'id', c.id,
    'kind', c.kind,
    'title', case when c.kind = 'group' then c.title else (select display_name from public.profiles where id = v_other) end,
    'avatar_url', case when c.kind = 'group' then c.avatar_url else (select avatar_url from public.profiles where id = v_other) end,
    'description', c.description,
    'other_user', case when v_other is null then null else public.profile_card_json(v_other) end,
    'members_count', c.members_count,
    'last_message', case when v_last.id is null or v_last.created_at <= coalesce(v_me.cleared_at, 'epoch'::timestamptz) then null else jsonb_build_object(
        'id', v_last.id, 'kind', v_last.kind, 'preview', public.message_preview(v_last.kind, v_last.text, v_last.deleted_at is not null),
        'sender_id', v_last.sender_id, 'sender_name', (select display_name from public.profiles where id = v_last.sender_id),
        'created_at', v_last.created_at, 'is_mine', v_last.sender_id = p_viewer,
        'status', case when v_last.sender_id = p_viewer then public.message_status(v_last) else null end) end,
    'last_message_at', c.last_message_at,
    'unread_count', v_unread,
    'is_request', v_me.state = 'pending',
    'my_role', v_me.role,
    'muted_until', v_me.muted_until,
    'is_muted', v_me.muted_until is not null and v_me.muted_until > now(),
    'is_archived', v_me.is_archived,
    'is_pinned', v_me.is_pinned,
    'marked_unread', v_me.marked_unread,
    'wallpaper', v_me.wallpaper,
    'notifications', v_me.notifications,
    'disappearing_seconds', c.disappearing_seconds,
    'join_approval', c.join_approval,
    'created_at', c.created_at
  );
end $$;

create or replace function public.touch_conversation(p_conversation uuid, p_message public.messages)
returns void language sql security definer set search_path = public as $$
  update public.conversations set last_message_id = p_message.id, last_message_at = p_message.created_at, updated_at = now() where id = p_conversation;
  update public.conversation_members set is_archived = false, marked_unread = false, updated_at = now()
   where conversation_id = p_conversation and user_id = p_message.sender_id;
  update public.conversation_members set is_archived = false, updated_at = now()
   where conversation_id = p_conversation and user_id <> p_message.sender_id and is_archived;
$$;

create or replace function public.insert_system_message(p_conversation uuid, p_text text, p_metadata jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_msg public.messages;
begin
  insert into public.messages (conversation_id, sender_id, kind, text, metadata)
  values (p_conversation, auth.uid(), 'system', left(p_text, 500), coalesce(p_metadata, '{}'::jsonb)) returning * into v_msg;
  perform public.touch_conversation(p_conversation, v_msg);
  return v_msg.id;
end $$;

-- ----------------------------------------------------------------------------
-- Conversation creation
-- ----------------------------------------------------------------------------
create or replace function public.start_direct_conversation(p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_key text;
  v_id uuid;
  v_setting public.audience_type;
  v_state public.member_state := 'active';
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_user = v_me then raise exception 'CANNOT_MESSAGE_SELF' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.profiles where id = p_user and account_status = 'active') then raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002'; end if;
  if public.is_blocked_either(v_me, p_user) then raise exception 'BLOCKED' using errcode = '42501', hint = 'You cannot message this person.'; end if;

  v_key := public.direct_key(v_me, p_user);
  select id into v_id from public.conversations where direct_key = v_key;
  if v_id is not null then
    -- Re-activate my membership if I previously left/cleared.
    update public.conversation_members set state = 'active', updated_at = now() where conversation_id = v_id and user_id = v_me and state in ('left', 'removed');
    return v_id;
  end if;

  select coalesce(who_can_message, 'everyone') into v_setting from public.user_settings where user_id = p_user;
  if v_setting = 'nobody' then
    raise exception 'MESSAGES_CLOSED' using errcode = '42501', hint = 'This person does not accept new messages.';
  end if;
  if not public.can_interact(p_user, v_me, coalesce(v_setting, 'everyone')) then
    v_state := 'pending'; -- lands in the recipient's message requests
  end if;

  insert into public.conversations (kind, created_by, direct_key, members_count) values ('direct', v_me, v_key, 2) returning id into v_id;
  insert into public.conversation_members (conversation_id, user_id, role, state) values (v_id, v_me, 'member', 'active');
  insert into public.conversation_members (conversation_id, user_id, role, state) values (v_id, p_user, 'member', v_state);
  return v_id;
end $$;

create or replace function public.create_group(p_title text, p_member_ids uuid[] default '{}', p_description text default null, p_avatar_url text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid; v_uid uuid; v_count integer := 1;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'TITLE_REQUIRED' using errcode = '23514', hint = 'Give your group a name.'; end if;
  if coalesce(array_length(p_member_ids, 1), 0) > 255 then raise exception 'GROUP_TOO_LARGE' using errcode = '23514', hint = 'Groups can have up to 256 members.'; end if;
  insert into public.conversations (kind, title, description, avatar_url, created_by, invite_code)
  values ('group', left(trim(p_title), 80), nullif(trim(coalesce(p_description, '')), ''), p_avatar_url, v_me, public.generate_invite_code())
  returning id into v_id;
  insert into public.conversation_members (conversation_id, user_id, role, state) values (v_id, v_me, 'owner', 'active');
  foreach v_uid in array coalesce(p_member_ids, '{}'::uuid[]) loop
    if v_uid = v_me or public.is_blocked_either(v_me, v_uid) then continue; end if;
    if not exists (select 1 from public.profiles where id = v_uid and account_status = 'active') then continue; end if;
    insert into public.conversation_members (conversation_id, user_id, role, state, added_by) values (v_id, v_uid, 'member', 'active', v_me) on conflict do nothing;
    v_count := v_count + 1;
    perform public.create_notification(v_uid, v_me, 'group_invite', 'conversation', v_id::text, jsonb_build_object('title', left(trim(p_title), 80)));
  end loop;
  update public.conversations set members_count = v_count where id = v_id;
  perform public.insert_system_message(v_id, 'created the group', jsonb_build_object('event', 'created'));
  return v_id;
end $$;

-- ----------------------------------------------------------------------------
-- Sending & editing
-- ----------------------------------------------------------------------------
create or replace function public.send_message(
  p_conversation uuid,
  p_kind public.message_kind default 'text',
  p_text text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_attachments jsonb default '[]'::jsonb,
  p_reply_to uuid default null,
  p_client_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_conv public.conversations;
  v_member public.conversation_members;
  v_msg public.messages;
  v_item jsonb;
  v_i integer := 0;
  v_other uuid;
  v_recent integer;
  v_existing uuid;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_kind in ('system', 'call') then raise exception 'INVALID_KIND' using errcode = '23514'; end if;

  -- Idempotent retries.
  if p_client_id is not null then
    select id into v_existing from public.messages where sender_id = v_me and client_id = p_client_id;
    if v_existing is not null then return public.message_json((select m from public.messages m where m.id = v_existing), v_me); end if;
  end if;

  select * into v_conv from public.conversations where id = p_conversation;
  select * into v_member from public.conversation_members where conversation_id = p_conversation and user_id = v_me;
  if v_conv.id is null or v_member.user_id is null or v_member.state not in ('active', 'pending') then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_member.state = 'pending' then
    raise exception 'REQUEST_PENDING' using errcode = '42501', hint = 'Accept the message request to reply.';
  end if;
  if v_conv.kind = 'direct' then
    select user_id into v_other from public.conversation_members where conversation_id = p_conversation and user_id <> v_me;
    if public.is_blocked_either(v_me, v_other) then raise exception 'BLOCKED' using errcode = '42501', hint = 'You cannot message this person.'; end if;
  end if;

  select count(*) into v_recent from public.messages where sender_id = v_me and created_at > now() - interval '1 minute';
  if v_recent >= 60 then raise exception 'RATE_LIMITED' using errcode = 'P0001', hint = 'You are sending messages too quickly.'; end if;

  if p_kind = 'text' and nullif(trim(coalesce(p_text, '')), '') is null then raise exception 'TEXT_REQUIRED' using errcode = '23514'; end if;
  if p_kind in ('image', 'video', 'audio', 'document') and coalesce(jsonb_array_length(p_attachments), 0) = 0 then
    raise exception 'ATTACHMENT_REQUIRED' using errcode = '23514';
  end if;
  if coalesce(jsonb_array_length(p_attachments), 0) > 10 then raise exception 'TOO_MANY_ATTACHMENTS' using errcode = '23514'; end if;
  if p_reply_to is not null and not exists (select 1 from public.messages r where r.id = p_reply_to and r.conversation_id = p_conversation) then
    raise exception 'REPLY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_kind = 'location' and (p_metadata->>'lat') is null then raise exception 'LOCATION_REQUIRED' using errcode = '23514'; end if;

  insert into public.messages (conversation_id, sender_id, kind, text, metadata, reply_to_id, client_id, expires_at)
  values (p_conversation, v_me, p_kind, nullif(trim(coalesce(p_text, '')), ''), coalesce(p_metadata, '{}'::jsonb), p_reply_to, p_client_id,
          case when v_conv.disappearing_seconds > 0 then now() + make_interval(secs => v_conv.disappearing_seconds) else null end)
  returning * into v_msg;

  for v_item in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    -- Attachments must be stored under <conversation>/<sender>/ in the private chat bucket.
    if coalesce(v_item->>'path', '') not like p_conversation::text || '/' || v_me::text || '/%' then
      raise exception 'ATTACHMENT_NOT_OWNED' using errcode = '42501';
    end if;
    insert into public.message_attachments (message_id, position, kind, path, name, mime, size_bytes, width, height, duration_ms, thumbnail_path, waveform)
    values (v_msg.id, v_i, coalesce((v_item->>'kind')::public.media_kind, 'document'), v_item->>'path', left(v_item->>'name', 255), v_item->>'mime',
            (v_item->>'size_bytes')::bigint, (v_item->>'width')::int, (v_item->>'height')::int, (v_item->>'duration_ms')::int, v_item->>'thumbnail_path', v_item->'waveform');
    v_i := v_i + 1;
  end loop;

  perform public.touch_conversation(p_conversation, v_msg);
  return public.message_json(v_msg, v_me);
end $$;

create or replace function public.edit_message(p_id uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_msg public.messages;
begin
  select * into v_msg from public.messages where id = p_id and sender_id = auth.uid() and deleted_at is null;
  if not found then raise exception 'MESSAGE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_msg.kind <> 'text' then raise exception 'CANNOT_EDIT' using errcode = 'P0001', hint = 'Only text messages can be edited.'; end if;
  if v_msg.created_at < now() - interval '24 hours' then raise exception 'EDIT_WINDOW' using errcode = 'P0001', hint = 'Messages can be edited for 24 hours.'; end if;
  if nullif(trim(coalesce(p_text, '')), '') is null then raise exception 'TEXT_REQUIRED' using errcode = '23514'; end if;
  update public.messages set text = trim(p_text), edited_at = now() where id = p_id;
  return public.message_json((select m from public.messages m where m.id = p_id), auth.uid());
end $$;

create or replace function public.delete_message(p_id uuid, p_for_everyone boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_msg public.messages;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into v_msg from public.messages where id = p_id;
  if not found or not public.is_conversation_member(v_msg.conversation_id) then raise exception 'MESSAGE_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_for_everyone then
    if v_msg.sender_id <> auth.uid() and not public.is_conversation_admin(v_msg.conversation_id) and not public.is_admin() then
      raise exception 'FORBIDDEN' using errcode = '42501', hint = 'Only the sender or a group admin can delete for everyone.';
    end if;
    if v_msg.sender_id = auth.uid() and v_msg.created_at < now() - interval '48 hours' and not public.is_conversation_admin(v_msg.conversation_id) then
      raise exception 'DELETE_WINDOW' using errcode = 'P0001', hint = 'Messages can be deleted for everyone for 48 hours.';
    end if;
    update public.messages set deleted_at = now(), deleted_by = auth.uid(), text = null, metadata = '{}'::jsonb where id = p_id;
    delete from public.message_attachments where message_id = p_id;
    delete from public.conversation_pins where message_id = p_id;
  else
    insert into public.message_deletions (user_id, message_id) values (auth.uid(), p_id) on conflict do nothing;
  end if;
end $$;

create or replace function public.forward_messages(p_message_ids uuid[], p_conversation_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_mid uuid; v_cid uuid; v_src public.messages; v_new public.messages; v_count integer := 0;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if coalesce(array_length(p_message_ids, 1), 0) = 0 or coalesce(array_length(p_conversation_ids, 1), 0) = 0 then return 0; end if;
  if array_length(p_conversation_ids, 1) > 5 then raise exception 'TOO_MANY_TARGETS' using errcode = '23514', hint = 'Forward to up to 5 chats at a time.'; end if;
  foreach v_cid in array p_conversation_ids loop
    if not exists (select 1 from public.conversation_members m where m.conversation_id = v_cid and m.user_id = v_me and m.state = 'active') then continue; end if;
    foreach v_mid in array p_message_ids[1:30] loop
      select * into v_src from public.messages where id = v_mid and deleted_at is null;
      if not found or not public.is_conversation_member(v_src.conversation_id) or v_src.kind in ('system', 'call') then continue; end if;
      insert into public.messages (conversation_id, sender_id, kind, text, metadata, forwarded, expires_at)
      select v_cid, v_me, v_src.kind, v_src.text, v_src.metadata, true,
             case when c.disappearing_seconds > 0 then now() + make_interval(secs => c.disappearing_seconds) else null end
      from public.conversations c where c.id = v_cid
      returning * into v_new;
      insert into public.message_attachments (message_id, position, kind, path, name, mime, size_bytes, width, height, duration_ms, thumbnail_path, waveform)
      select v_new.id, a.position, a.kind, a.path, a.name, a.mime, a.size_bytes, a.width, a.height, a.duration_ms, a.thumbnail_path, a.waveform
      from public.message_attachments a where a.message_id = v_src.id;
      perform public.touch_conversation(v_cid, v_new);
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end $$;

create or replace function public.react_message(p_id uuid, p_emoji text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_msg public.messages;
begin
  select * into v_msg from public.messages where id = p_id and deleted_at is null;
  if not found or not public.is_conversation_member(v_msg.conversation_id) then raise exception 'MESSAGE_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_emoji is null or char_length(p_emoji) = 0 then
    delete from public.message_reactions where message_id = p_id and user_id = auth.uid();
  else
    insert into public.message_reactions (message_id, user_id, emoji) values (p_id, auth.uid(), left(p_emoji, 8))
    on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  end if;
end $$;

create or replace function public.star_message(p_id uuid, p_star boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare v_msg public.messages;
begin
  select * into v_msg from public.messages where id = p_id;
  if not found or not public.is_conversation_member(v_msg.conversation_id) then raise exception 'MESSAGE_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_star then insert into public.starred_messages (user_id, message_id) values (auth.uid(), p_id) on conflict do nothing;
  else delete from public.starred_messages where user_id = auth.uid() and message_id = p_id; end if;
end $$;

create or replace function public.pin_message(p_id uuid, p_pin boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare v_msg public.messages; v_conv public.conversations;
begin
  select * into v_msg from public.messages where id = p_id and deleted_at is null;
  if not found or not public.is_conversation_member(v_msg.conversation_id) then raise exception 'MESSAGE_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_conv from public.conversations where id = v_msg.conversation_id;
  if v_conv.kind = 'group' and not public.is_conversation_admin(v_conv.id) then raise exception 'FORBIDDEN' using errcode = '42501', hint = 'Only admins can pin messages in groups.'; end if;
  if p_pin then
    if (select count(*) from public.conversation_pins where conversation_id = v_conv.id) >= 3 then
      raise exception 'PIN_LIMIT' using errcode = 'P0001', hint = 'You can pin up to 3 messages.';
    end if;
    insert into public.conversation_pins (conversation_id, message_id, pinned_by) values (v_conv.id, p_id, auth.uid()) on conflict do nothing;
  else
    delete from public.conversation_pins where conversation_id = v_conv.id and message_id = p_id;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Read state & per-member settings
-- ----------------------------------------------------------------------------
create or replace function public.mark_conversation_read(p_conversation uuid)
returns void language sql security definer set search_path = public as $$
  update public.conversation_members
     set last_read_at = greatest(last_read_at, clock_timestamp()), last_delivered_at = greatest(last_delivered_at, clock_timestamp()), marked_unread = false, updated_at = now()
   where conversation_id = p_conversation and user_id = auth.uid() and state = 'active'
$$;

create or replace function public.mark_delivered(p_conversation_ids uuid[] default null)
returns void language sql security definer set search_path = public as $$
  update public.conversation_members
     set last_delivered_at = greatest(last_delivered_at, clock_timestamp()), updated_at = now()
   where user_id = auth.uid() and state = 'active' and (p_conversation_ids is null or conversation_id = any (p_conversation_ids))
$$;

create or replace function public.set_conversation_settings(
  p_conversation uuid,
  p_muted_until timestamptz default null, p_set_mute boolean default false,
  p_is_archived boolean default null, p_is_pinned boolean default null, p_marked_unread boolean default null,
  p_wallpaper text default null, p_set_wallpaper boolean default false, p_notifications boolean default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_conversation_member(p_conversation) then raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.conversation_members set
    muted_until = case when p_set_mute then p_muted_until else muted_until end,
    is_archived = coalesce(p_is_archived, is_archived),
    is_pinned = coalesce(p_is_pinned, is_pinned),
    pinned_at = case when p_is_pinned is true then now() when p_is_pinned is false then null else pinned_at end,
    marked_unread = coalesce(p_marked_unread, marked_unread),
    wallpaper = case when p_set_wallpaper then p_wallpaper else wallpaper end,
    notifications = coalesce(p_notifications, notifications),
    updated_at = now()
  where conversation_id = p_conversation and user_id = auth.uid();
  return public.conversation_json((select c from public.conversations c where c.id = p_conversation), auth.uid());
end $$;

create or replace function public.clear_conversation(p_conversation uuid)
returns void language sql security definer set search_path = public as $$
  update public.conversation_members set cleared_at = clock_timestamp(), updated_at = now() where conversation_id = p_conversation and user_id = auth.uid()
$$;

create or replace function public.set_disappearing(p_conversation uuid, p_seconds integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_conv public.conversations;
begin
  select * into v_conv from public.conversations where id = p_conversation;
  if v_conv.id is null or not public.is_conversation_member(p_conversation) then raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_conv.kind = 'group' and not public.is_conversation_admin(p_conversation) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_seconds not in (0, 86400, 604800, 7776000) then raise exception 'INVALID_DURATION' using errcode = '23514'; end if;
  update public.conversations set disappearing_seconds = p_seconds, updated_at = now() where id = p_conversation;
  perform public.insert_system_message(p_conversation,
    case when p_seconds = 0 then 'turned off disappearing messages' else 'turned on disappearing messages (' || case p_seconds when 86400 then '24 hours' when 604800 then '7 days' else '90 days' end || ')' end,
    jsonb_build_object('event', 'disappearing', 'seconds', p_seconds));
end $$;

-- ----------------------------------------------------------------------------
-- Message requests
-- ----------------------------------------------------------------------------
create or replace function public.respond_message_request(p_conversation uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_member public.conversation_members; v_other uuid;
begin
  select * into v_member from public.conversation_members where conversation_id = p_conversation and user_id = auth.uid() and state = 'pending';
  if not found then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_accept then
    update public.conversation_members set state = 'active', updated_at = now() where conversation_id = p_conversation and user_id = auth.uid();
  else
    select user_id into v_other from public.conversation_members where conversation_id = p_conversation and user_id <> auth.uid();
    delete from public.conversations where id = p_conversation; -- direct request declined: drop the thread entirely
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Group administration
-- ----------------------------------------------------------------------------
create or replace function public.add_members(p_conversation uuid, p_user_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_uid uuid; v_added integer := 0; v_conv public.conversations; v_names text := '';
begin
  select * into v_conv from public.conversations where id = p_conversation and kind = 'group';
  if v_conv.id is null or not public.is_conversation_admin(p_conversation) then raise exception 'FORBIDDEN' using errcode = '42501', hint = 'Only admins can add members.'; end if;
  foreach v_uid in array coalesce(p_user_ids, '{}'::uuid[]) loop
    if public.is_blocked_either(v_me, v_uid) then continue; end if;
    if not exists (select 1 from public.profiles where id = v_uid and account_status = 'active') then continue; end if;
    if (select count(*) from public.conversation_members where conversation_id = p_conversation and state = 'active') >= 256 then
      raise exception 'GROUP_TOO_LARGE' using errcode = '23514', hint = 'Groups can have up to 256 members.';
    end if;
    insert into public.conversation_members (conversation_id, user_id, role, state, added_by, joined_at, last_read_at, last_delivered_at)
    values (p_conversation, v_uid, 'member', 'active', v_me, clock_timestamp(), clock_timestamp(), clock_timestamp())
    on conflict (conversation_id, user_id) do update set state = 'active', role = 'member', joined_at = clock_timestamp(), last_read_at = clock_timestamp(), last_delivered_at = clock_timestamp(), added_by = v_me, updated_at = now()
    where public.conversation_members.state in ('left', 'removed');
    if found then
      v_added := v_added + 1;
      v_names := v_names || case when v_names = '' then '' else ', ' end || (select display_name from public.profiles where id = v_uid);
      perform public.create_notification(v_uid, v_me, 'group_invite', 'conversation', p_conversation::text, jsonb_build_object('title', v_conv.title));
    end if;
  end loop;
  if v_added > 0 then
    update public.conversations set members_count = (select count(*) from public.conversation_members where conversation_id = p_conversation and state = 'active') where id = p_conversation;
    perform public.insert_system_message(p_conversation, 'added ' || v_names, jsonb_build_object('event', 'members_added'));
  end if;
  return v_added;
end $$;

create or replace function public.remove_member(p_conversation uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_target public.conversation_members;
begin
  if not public.is_conversation_admin(p_conversation) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v_target from public.conversation_members where conversation_id = p_conversation and user_id = p_user and state = 'active';
  if not found then raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_target.role = 'owner' then raise exception 'CANNOT_REMOVE_OWNER' using errcode = '42501'; end if;
  update public.conversation_members set state = 'removed', updated_at = now() where conversation_id = p_conversation and user_id = p_user;
  update public.conversations set members_count = greatest(0, members_count - 1) where id = p_conversation;
  perform public.insert_system_message(p_conversation, 'removed ' || (select display_name from public.profiles where id = p_user), jsonb_build_object('event', 'member_removed', 'user_id', p_user));
end $$;

create or replace function public.leave_conversation(p_conversation uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_me public.conversation_members; v_conv public.conversations; v_next uuid;
begin
  select * into v_conv from public.conversations where id = p_conversation;
  select * into v_me from public.conversation_members where conversation_id = p_conversation and user_id = auth.uid() and state in ('active', 'pending');
  if v_me.user_id is null then raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_conv.kind = 'direct' then
    -- Leaving a DM hides it for me; the thread is re-opened if either side messages again.
    update public.conversation_members set state = 'left', cleared_at = clock_timestamp(), updated_at = now() where conversation_id = p_conversation and user_id = auth.uid();
    return;
  end if;
  update public.conversation_members set state = 'left', updated_at = now() where conversation_id = p_conversation and user_id = auth.uid();
  update public.conversations set members_count = greatest(0, members_count - 1) where id = p_conversation;
  if v_me.role = 'owner' then
    select user_id into v_next from public.conversation_members where conversation_id = p_conversation and state = 'active'
      order by (role = 'admin') desc, joined_at asc limit 1;
    if v_next is not null then update public.conversation_members set role = 'owner' where conversation_id = p_conversation and user_id = v_next; end if;
  end if;
  perform public.insert_system_message(p_conversation, 'left the group', jsonb_build_object('event', 'member_left'));
end $$;

create or replace function public.set_member_role(p_conversation uuid, p_user uuid, p_role public.member_role)
returns void language plpgsql security definer set search_path = public as $$
declare v_me public.conversation_members;
begin
  select * into v_me from public.conversation_members where conversation_id = p_conversation and user_id = auth.uid() and state = 'active';
  if v_me.user_id is null or v_me.role not in ('owner', 'admin') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_role = 'owner' then
    if v_me.role <> 'owner' then raise exception 'FORBIDDEN' using errcode = '42501', hint = 'Only the owner can transfer ownership.'; end if;
    update public.conversation_members set role = 'admin' where conversation_id = p_conversation and user_id = auth.uid();
  end if;
  update public.conversation_members set role = p_role, updated_at = now() where conversation_id = p_conversation and user_id = p_user and state = 'active' and role <> 'owner';
  if not found then raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

create or replace function public.update_group(p_conversation uuid, p_title text default null, p_description text default null, p_avatar_url text default null, p_join_approval boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_conversation_admin(p_conversation) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.conversations set
    title = coalesce(left(nullif(trim(coalesce(p_title, '')), ''), 80), title),
    description = case when p_description is null then description else nullif(trim(p_description), '') end,
    avatar_url = coalesce(p_avatar_url, avatar_url),
    join_approval = coalesce(p_join_approval, join_approval),
    updated_at = now()
  where id = p_conversation and kind = 'group';
  if p_title is not null then perform public.insert_system_message(p_conversation, 'changed the group name to "' || left(trim(p_title), 80) || '"', jsonb_build_object('event', 'renamed')); end if;
  return public.conversation_json((select c from public.conversations c where c.id = p_conversation), auth.uid());
end $$;

create or replace function public.rotate_invite_link(p_conversation uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not public.is_conversation_admin(p_conversation) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  v_code := public.generate_invite_code();
  update public.conversations set invite_code = v_code where id = p_conversation and kind = 'group';
  return v_code;
end $$;

create or replace function public.get_invite_link(p_conversation uuid)
returns text language sql stable security definer set search_path = public as $$
  select c.invite_code from public.conversations c where c.id = p_conversation and public.is_conversation_member(p_conversation)
$$;

create or replace function public.preview_invite(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'title', c.title, 'avatar_url', c.avatar_url, 'description', c.description, 'members_count', c.members_count,
                            'join_approval', c.join_approval, 'already_member', public.is_conversation_member(c.id))
  from public.conversations c where c.invite_code = p_code and c.kind = 'group'
$$;

create or replace function public.join_via_invite(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_conv public.conversations;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into v_conv from public.conversations where invite_code = p_code and kind = 'group';
  if not found then raise exception 'INVITE_INVALID' using errcode = 'P0002', hint = 'This invite link is invalid or has been reset.'; end if;
  if public.is_conversation_member(v_conv.id) then return jsonb_build_object('status', 'member', 'conversation_id', v_conv.id); end if;
  if (select count(*) from public.conversation_members where conversation_id = v_conv.id and state = 'active') >= 256 then
    raise exception 'GROUP_TOO_LARGE' using errcode = '23514', hint = 'This group is full.';
  end if;
  if v_conv.join_approval then
    insert into public.group_join_requests (conversation_id, user_id) values (v_conv.id, v_me) on conflict (conversation_id, user_id) where status = 'pending' do nothing;
    return jsonb_build_object('status', 'requested', 'conversation_id', v_conv.id);
  end if;
  insert into public.conversation_members (conversation_id, user_id, role, state) values (v_conv.id, v_me, 'member', 'active')
  on conflict (conversation_id, user_id) do update set state = 'active', joined_at = clock_timestamp(), last_read_at = clock_timestamp(), last_delivered_at = clock_timestamp(), updated_at = now();
  update public.conversations set members_count = (select count(*) from public.conversation_members where conversation_id = v_conv.id and state = 'active') where id = v_conv.id;
  perform public.insert_system_message(v_conv.id, 'joined via invite link', jsonb_build_object('event', 'member_joined'));
  return jsonb_build_object('status', 'joined', 'conversation_id', v_conv.id);
end $$;

create or replace function public.respond_join_request(p_request uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_req public.group_join_requests;
begin
  select * into v_req from public.group_join_requests where id = p_request and status = 'pending';
  if not found or not public.is_conversation_admin(v_req.conversation_id) then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.group_join_requests set status = case when p_accept then 'accepted' else 'declined' end::public.request_status, responded_at = now(), responded_by = auth.uid() where id = p_request;
  if p_accept then
    insert into public.conversation_members (conversation_id, user_id, role, state, added_by) values (v_req.conversation_id, v_req.user_id, 'member', 'active', auth.uid())
    on conflict (conversation_id, user_id) do update set state = 'active', joined_at = clock_timestamp(), last_read_at = clock_timestamp(), last_delivered_at = clock_timestamp(), updated_at = now();
    update public.conversations set members_count = (select count(*) from public.conversation_members where conversation_id = v_req.conversation_id and state = 'active') where id = v_req.conversation_id;
    perform public.insert_system_message(v_req.conversation_id, 'approved ' || (select display_name from public.profiles where id = v_req.user_id) || ' to join', jsonb_build_object('event', 'member_joined', 'user_id', v_req.user_id));
  end if;
end $$;

create or replace function public.get_join_requests(p_conversation uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'user', public.profile_card_json(r.user_id), 'created_at', r.created_at) order by r.created_at), '[]'::jsonb)
  from public.group_join_requests r
  where r.conversation_id = p_conversation and r.status = 'pending' and public.is_conversation_admin(p_conversation)
$$;

-- ----------------------------------------------------------------------------
-- Reads
-- ----------------------------------------------------------------------------
create or replace function public.get_conversations(p_filter text default 'inbox', p_limit integer default 30, p_before timestamptz default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.conversation_json(c, auth.uid())
  from public.conversations c
  join public.conversation_members m on m.conversation_id = c.id and m.user_id = auth.uid()
  where m.state in ('active', 'pending')
    and (case p_filter
           when 'requests' then m.state = 'pending'
           when 'archived' then m.state = 'active' and m.is_archived
           when 'unread' then m.state = 'active' and not m.is_archived and (m.marked_unread or exists (
             select 1 from public.messages x where x.conversation_id = c.id and x.sender_id is distinct from auth.uid() and x.deleted_at is null and x.created_at > m.last_read_at))
           when 'groups' then m.state = 'active' and not m.is_archived and c.kind = 'group'
           else m.state = 'active' and not m.is_archived end)
    and (p_before is null or coalesce(c.last_message_at, c.created_at) < p_before)
    and (c.kind = 'group' or not exists (
      select 1 from public.conversation_members o where o.conversation_id = c.id and o.user_id <> auth.uid() and public.is_blocked_either(auth.uid(), o.user_id)))
  order by m.is_pinned desc, coalesce(c.last_message_at, c.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 30), 100))
$$;

create or replace function public.get_conversation(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_conv public.conversations; v jsonb;
begin
  select * into v_conv from public.conversations where id = p_id;
  if not found or not public.is_conversation_member(p_id) then raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002'; end if;
  v := public.conversation_json(v_conv, auth.uid());
  v := v || jsonb_build_object(
    'members', coalesce((select jsonb_agg(public.profile_card_json(m.user_id) || jsonb_build_object('role', m.role, 'joined_at', m.joined_at) order by (m.role = 'owner') desc, (m.role = 'admin') desc, m.joined_at)
                         from public.conversation_members m where m.conversation_id = p_id and m.state = 'active'), '[]'::jsonb),
    'pins', coalesce((select jsonb_agg(public.message_json(msg, auth.uid()) order by p.created_at desc) from public.conversation_pins p join public.messages msg on msg.id = p.message_id where p.conversation_id = p_id), '[]'::jsonb),
    'invite_code', case when v_conv.kind = 'group' then v_conv.invite_code else null end,
    'is_admin', public.is_conversation_admin(p_id),
    'pending_requests', case when public.is_conversation_admin(p_id) then (select count(*) from public.group_join_requests r where r.conversation_id = p_id and r.status = 'pending') else 0 end
  );
  return v;
end $$;

create or replace function public.get_messages(p_conversation uuid, p_limit integer default 40, p_before timestamptz default null, p_after timestamptz default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.message_json(m, auth.uid())
  from public.messages m
  join public.conversation_members me on me.conversation_id = m.conversation_id and me.user_id = auth.uid() and me.state in ('active', 'pending')
  where m.conversation_id = p_conversation
    and m.created_at > coalesce(me.cleared_at, 'epoch'::timestamptz)
    and (m.expires_at is null or m.expires_at > now())
    and not exists (select 1 from public.message_deletions d where d.message_id = m.id and d.user_id = auth.uid())
    and (p_before is null or m.created_at < p_before)
    and (p_after is null or m.created_at > p_after)
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 40), 100))
$$;

create or replace function public.get_message(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.message_json(m, auth.uid()) from public.messages m
  where m.id = p_id and public.is_conversation_member(m.conversation_id)
    and not exists (select 1 from public.message_deletions d where d.message_id = m.id and d.user_id = auth.uid())
$$;

create or replace function public.get_message_info(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'user', public.profile_card_json(mem.user_id),
      'delivered_at', case when mem.last_delivered_at >= msg.created_at then mem.last_delivered_at else null end,
      'read_at', case when mem.last_read_at >= msg.created_at then mem.last_read_at else null end)), '[]'::jsonb)
  from public.messages msg
  join public.conversation_members mem on mem.conversation_id = msg.conversation_id and mem.user_id <> msg.sender_id and mem.state = 'active'
  where msg.id = p_id and msg.sender_id = auth.uid()
$$;

create or replace function public.search_messages(p_query text, p_conversation uuid default null, p_limit integer default 30)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.message_json(m, auth.uid()) || jsonb_build_object('conversation', public.conversation_json(c, auth.uid()) - 'last_message')
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  join public.conversation_members me on me.conversation_id = m.conversation_id and me.user_id = auth.uid() and me.state = 'active'
  where (p_conversation is null or m.conversation_id = p_conversation)
    and m.deleted_at is null and m.text ilike '%' || trim(p_query) || '%'
    and m.created_at > coalesce(me.cleared_at, 'epoch'::timestamptz)
    and (m.expires_at is null or m.expires_at > now())
    and not exists (select 1 from public.message_deletions d where d.message_id = m.id and d.user_id = auth.uid())
    and char_length(trim(coalesce(p_query, ''))) >= 2
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100))
$$;

create or replace function public.get_starred_messages(p_limit integer default 50)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.message_json(m, auth.uid()) || jsonb_build_object('conversation', public.conversation_json(c, auth.uid()) - 'last_message')
  from public.starred_messages s
  join public.messages m on m.id = s.message_id
  join public.conversations c on c.id = m.conversation_id
  where s.user_id = auth.uid() and public.is_conversation_member(m.conversation_id)
  order by s.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

create or replace function public.get_shared_media(p_conversation uuid, p_kind text default 'media', p_limit integer default 60, p_before timestamptz default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.message_json(m, auth.uid())
  from public.messages m
  join public.conversation_members me on me.conversation_id = m.conversation_id and me.user_id = auth.uid() and me.state = 'active'
  where m.conversation_id = p_conversation and m.deleted_at is null
    and m.created_at > coalesce(me.cleared_at, 'epoch'::timestamptz)
    and (case p_kind when 'media' then m.kind in ('image', 'video') when 'docs' then m.kind = 'document' when 'audio' then m.kind = 'audio'
                     when 'links' then m.kind = 'text' and m.text ~* 'https?://' else true end)
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 60), 200))
$$;

create or replace function public.get_unread_total()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when m.marked_unread then 1 else (
    select count(*) from public.messages x
    where x.conversation_id = m.conversation_id and x.sender_id is distinct from auth.uid() and x.deleted_at is null
      and x.created_at > m.last_read_at and x.created_at > coalesce(m.cleared_at, 'epoch'::timestamptz)) end), 0)::int
  from public.conversation_members m
  where m.user_id = auth.uid() and m.state = 'active' and not m.is_archived and (m.muted_until is null or m.muted_until < now())
$$;

create or replace function public.send_story_reply(p_story uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_story public.stories; v_conv uuid;
begin
  select * into v_story from public.stories where id = p_story and removed_at is null;
  if not found or not public.can_view_story_of(v_story.author_id, v_story.audience, auth.uid()) then raise exception 'STORY_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_story.author_id = auth.uid() then raise exception 'CANNOT_MESSAGE_SELF' using errcode = 'P0001'; end if;
  v_conv := public.start_direct_conversation(v_story.author_id);
  return public.send_message(v_conv, 'story_reply', p_text,
    jsonb_build_object('story_id', v_story.id, 'thumbnail_url', coalesce(v_story.thumbnail_url, v_story.media_url), 'story_kind', v_story.kind, 'story_text', left(coalesce(v_story.text, ''), 120)));
end $$;

-- Housekeeping: hard-delete expired disappearing messages (run from cron / admin).
create or replace function public.expire_messages()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  with gone as (delete from public.messages where expires_at is not null and expires_at < now() returning id)
  select count(*) into v_n from gone;
  return v_n;
end $$;

-- ----------------------------------------------------------------------------
-- Function privileges
-- ----------------------------------------------------------------------------
do $do$
declare f text;
begin
  foreach f in array array[
    'public.is_conversation_member(uuid, uuid)', 'public.is_conversation_admin(uuid, uuid)', 'public.direct_key(uuid, uuid)',
    'public.message_preview(public.message_kind, text, boolean)', 'public.message_status(public.messages)', 'public.message_json(public.messages, uuid)',
    'public.conversation_json(public.conversations, uuid)',
    'public.start_direct_conversation(uuid)', 'public.create_group(text, uuid[], text, text)',
    'public.send_message(uuid, public.message_kind, text, jsonb, jsonb, uuid, text)', 'public.edit_message(uuid, text)', 'public.delete_message(uuid, boolean)',
    'public.forward_messages(uuid[], uuid[])', 'public.react_message(uuid, text)', 'public.star_message(uuid, boolean)', 'public.pin_message(uuid, boolean)',
    'public.mark_conversation_read(uuid)', 'public.mark_delivered(uuid[])',
    'public.set_conversation_settings(uuid, timestamptz, boolean, boolean, boolean, boolean, text, boolean, boolean)',
    'public.clear_conversation(uuid)', 'public.set_disappearing(uuid, integer)', 'public.respond_message_request(uuid, boolean)',
    'public.add_members(uuid, uuid[])', 'public.remove_member(uuid, uuid)', 'public.leave_conversation(uuid)', 'public.set_member_role(uuid, uuid, public.member_role)',
    'public.update_group(uuid, text, text, text, boolean)', 'public.rotate_invite_link(uuid)', 'public.get_invite_link(uuid)', 'public.preview_invite(text)',
    'public.join_via_invite(text)', 'public.respond_join_request(uuid, boolean)', 'public.get_join_requests(uuid)',
    'public.get_conversations(text, integer, timestamptz)', 'public.get_conversation(uuid)', 'public.get_messages(uuid, integer, timestamptz, timestamptz)',
    'public.get_message(uuid)', 'public.get_message_info(uuid)', 'public.search_messages(text, uuid, integer)', 'public.get_starred_messages(integer)',
    'public.get_shared_media(uuid, text, integer, timestamptz)', 'public.get_unread_total()', 'public.send_story_reply(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['public.generate_invite_code()', 'public.touch_conversation(uuid, public.messages)', 'public.insert_system_message(uuid, text, jsonb)', 'public.expire_messages()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $do$;

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;
alter table public.message_reactions enable row level security;
alter table public.starred_messages enable row level security;
alter table public.message_deletions enable row level security;
alter table public.conversation_pins enable row level security;
alter table public.group_join_requests enable row level security;
alter table public.stickers enable row level security;

drop policy if exists "conversations_select_member" on public.conversations;
create policy "conversations_select_member" on public.conversations for select to authenticated
  using (public.is_conversation_member(id) or public.is_admin());

drop policy if exists "conversation_members_select" on public.conversation_members;
create policy "conversation_members_select" on public.conversation_members for select to authenticated
  using (user_id = auth.uid() or public.is_conversation_member(conversation_id) or public.is_admin());

drop policy if exists "messages_select_member" on public.messages;
create policy "messages_select_member" on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id) or public.is_admin());

drop policy if exists "message_attachments_select" on public.message_attachments;
create policy "message_attachments_select" on public.message_attachments for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id and public.is_conversation_member(m.conversation_id)));

drop policy if exists "message_reactions_select" on public.message_reactions;
create policy "message_reactions_select" on public.message_reactions for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id and public.is_conversation_member(m.conversation_id)));

drop policy if exists "starred_messages_own" on public.starred_messages;
create policy "starred_messages_own" on public.starred_messages for select to authenticated using (user_id = auth.uid());

drop policy if exists "message_deletions_own" on public.message_deletions;
create policy "message_deletions_own" on public.message_deletions for select to authenticated using (user_id = auth.uid());

drop policy if exists "conversation_pins_select" on public.conversation_pins;
create policy "conversation_pins_select" on public.conversation_pins for select to authenticated using (public.is_conversation_member(conversation_id));

drop policy if exists "group_join_requests_select" on public.group_join_requests;
create policy "group_join_requests_select" on public.group_join_requests for select to authenticated
  using (user_id = auth.uid() or public.is_conversation_admin(conversation_id));

drop policy if exists "stickers_select" on public.stickers;
create policy "stickers_select" on public.stickers for select to authenticated using (is_active);

-- ----------------------------------------------------------------------------
-- Realtime & private storage
-- ----------------------------------------------------------------------------
do $do$
declare t text;
begin
  foreach t in array array['messages', 'message_reactions', 'conversation_members', 'conversations'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $do$;

-- Realtime sends full rows on UPDATE only when the replica identity is FULL.
alter table public.messages replica identity full;
alter table public.conversation_members replica identity full;

insert into storage.buckets (id, name, public, file_size_limit)
values ('chat', 'chat', false, 104857600)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Objects live under <conversation_id>/<user_id>/<file>. Members read, uploader writes.
drop policy if exists "chat_media_select_members" on storage.objects;
create policy "chat_media_select_members" on storage.objects for select to authenticated
  using (bucket_id = 'chat' and public.is_conversation_member(((storage.foldername(name))[1])::uuid));

drop policy if exists "chat_media_insert_own" on storage.objects;
create policy "chat_media_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat' and (storage.foldername(name))[2] = auth.uid()::text and public.is_conversation_member(((storage.foldername(name))[1])::uuid));

drop policy if exists "chat_media_delete_own" on storage.objects;
create policy "chat_media_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'chat' and (storage.foldername(name))[2] = auth.uid()::text);


-- ########## 20261125000004_calls.sql ##########

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


-- ########## 20261125000005_videos.sql ##########

-- ============================================================================
-- Friendzy — Phase 5: short video & creator tools
-- Videos with provider abstraction (Supabase Storage now, Cloudflare Stream
-- later), likes / comments / replies / saves / reposts / shares, views &
-- analytics, sounds, playlists, challenges, drafts, duets & stitches,
-- recommendation feeds, storage bucket, RLS and realtime.
-- ============================================================================

do $do$ begin
  create type public.video_status as enum ('processing', 'ready', 'failed');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.media_provider as enum ('supabase', 'cloudflare');
exception when duplicate_object then null; end $do$;

-- ----------------------------------------------------------------------------
-- Sounds (original audio or licensed tracks uploaded by users / admins)
-- ----------------------------------------------------------------------------
create table if not exists public.sounds (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid references public.profiles (id) on delete set null,
  title             text not null,
  artist            text,
  url               text,
  cover_url         text,
  duration_ms       integer,
  origin_video_id   uuid,
  is_original       boolean not null default true,
  license_note      text,
  uses_count        integer not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  constraint sounds_title_len check (char_length(title) between 1 and 100),
  constraint sounds_artist_len check (artist is null or char_length(artist) <= 100)
);
create index if not exists sounds_uses_idx on public.sounds (uses_count desc) where is_active;
create index if not exists sounds_title_trgm on public.sounds using gin (title extensions.gin_trgm_ops);
revoke all on public.sounds from anon, authenticated;
grant select on public.sounds to authenticated;

-- ----------------------------------------------------------------------------
-- Videos
-- ----------------------------------------------------------------------------
create table if not exists public.videos (
  id                  uuid primary key default gen_random_uuid(),
  author_id           uuid not null references public.profiles (id) on delete cascade,
  caption             text,
  status              public.video_status not null default 'ready',
  provider            public.media_provider not null default 'supabase',
  provider_id         text,
  media_url           text,
  playback_url        text,
  thumbnail_url       text,
  width               integer,
  height              integer,
  duration_ms         integer,
  audience            public.post_audience not null default 'public',
  allow_comments      boolean not null default true,
  allow_duet          boolean not null default true,
  allow_stitch        boolean not null default true,
  allow_download      boolean not null default false,
  sound_id            uuid references public.sounds (id) on delete set null,
  sound_volume        numeric(3, 2) not null default 1,
  original_volume     numeric(3, 2) not null default 1,
  trim_start_ms       integer not null default 0,
  trim_end_ms         integer,
  playback_rate       numeric(3, 2) not null default 1,
  overlays            jsonb not null default '[]'::jsonb,
  filter              text not null default 'none',
  duet_of             uuid references public.videos (id) on delete set null,
  stitch_of           uuid references public.videos (id) on delete set null,
  stitch_start_ms     integer,
  stitch_end_ms       integer,
  reply_to_comment_id uuid,
  likes_count         integer not null default 0,
  comments_count      integer not null default 0,
  shares_count        integer not null default 0,
  saves_count         integer not null default 0,
  reposts_count       integer not null default 0,
  views_count         integer not null default 0,
  removed_at          timestamptz,
  removed_by          uuid references auth.users (id) on delete set null,
  removed_reason      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint videos_caption_len check (caption is null or char_length(caption) <= 2200),
  constraint videos_rate check (playback_rate between 0.3 and 3),
  constraint videos_volume check (sound_volume between 0 and 1 and original_volume between 0 and 1),
  constraint videos_filter_len check (char_length(filter) <= 30)
);
create index if not exists videos_author_idx on public.videos (author_id, created_at desc);
create index if not exists videos_created_idx on public.videos (created_at desc) where removed_at is null and status = 'ready';
create index if not exists videos_sound_idx on public.videos (sound_id) where sound_id is not null;
create index if not exists videos_duet_idx on public.videos (duet_of) where duet_of is not null;
create index if not exists videos_caption_trgm on public.videos using gin (caption extensions.gin_trgm_ops);
revoke all on public.videos from anon, authenticated;
grant select on public.videos to authenticated;

alter table public.sounds drop constraint if exists sounds_origin_video_fkey;
alter table public.sounds add constraint sounds_origin_video_fkey foreign key (origin_video_id) references public.videos (id) on delete set null;

create table if not exists public.video_likes (
  video_id   uuid not null references public.videos (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (video_id, user_id)
);
create index if not exists video_likes_user_idx on public.video_likes (user_id, created_at desc);
revoke all on public.video_likes from anon, authenticated;
grant select on public.video_likes to authenticated;

create table if not exists public.video_comments (
  id             uuid primary key default gen_random_uuid(),
  video_id       uuid not null references public.videos (id) on delete cascade,
  author_id      uuid not null references public.profiles (id) on delete cascade,
  parent_id      uuid references public.video_comments (id) on delete cascade,
  text           text not null,
  reply_video_id uuid references public.videos (id) on delete set null,
  likes_count    integer not null default 0,
  replies_count  integer not null default 0,
  edited_at      timestamptz,
  removed_at     timestamptz,
  created_at     timestamptz not null default now(),
  constraint video_comments_text_len check (char_length(text) between 1 and 500)
);
create index if not exists video_comments_video_idx on public.video_comments (video_id, created_at) where parent_id is null;
create index if not exists video_comments_parent_idx on public.video_comments (parent_id, created_at);
revoke all on public.video_comments from anon, authenticated;
grant select on public.video_comments to authenticated;

alter table public.videos drop constraint if exists videos_reply_comment_fkey;
alter table public.videos add constraint videos_reply_comment_fkey foreign key (reply_to_comment_id) references public.video_comments (id) on delete set null;

create table if not exists public.video_comment_reactions (
  comment_id uuid not null references public.video_comments (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
revoke all on public.video_comment_reactions from anon, authenticated;
grant select on public.video_comment_reactions to authenticated;

create table if not exists public.video_saves (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  video_id   uuid not null references public.videos (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);
revoke all on public.video_saves from anon, authenticated;
grant select on public.video_saves to authenticated;

create table if not exists public.video_reposts (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  video_id   uuid not null references public.videos (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);
create index if not exists video_reposts_video_idx on public.video_reposts (video_id);
revoke all on public.video_reposts from anon, authenticated;
grant select on public.video_reposts to authenticated;

create table if not exists public.video_views (
  id          bigserial primary key,
  video_id    uuid not null references public.videos (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete cascade,
  watched_ms  integer not null default 0,
  completed   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists video_views_video_idx on public.video_views (video_id, created_at desc);
create index if not exists video_views_user_recent_idx on public.video_views (user_id, created_at desc);
revoke all on public.video_views from anon, authenticated;
grant select on public.video_views to authenticated;

create table if not exists public.video_hashtags (
  video_id   uuid not null references public.videos (id) on delete cascade,
  hashtag_id bigint not null references public.hashtags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (video_id, hashtag_id)
);
create index if not exists video_hashtags_tag_idx on public.video_hashtags (hashtag_id, created_at desc);
revoke all on public.video_hashtags from anon, authenticated;
grant select on public.video_hashtags to authenticated;

create table if not exists public.video_feedback (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  video_id   uuid references public.videos (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete cascade,
  kind       public.feed_feedback_kind not null,
  created_at timestamptz not null default now()
);
create unique index if not exists video_feedback_key on public.video_feedback (user_id, video_id, kind) where video_id is not null;
revoke all on public.video_feedback from anon, authenticated;
grant select on public.video_feedback to authenticated;

create table if not exists public.playlists (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  title        text not null,
  description  text,
  is_public    boolean not null default true,
  videos_count integer not null default 0,
  created_at   timestamptz not null default now(),
  constraint playlists_title_len check (char_length(title) between 1 and 60)
);
create index if not exists playlists_owner_idx on public.playlists (owner_id, created_at desc);
revoke all on public.playlists from anon, authenticated;
grant select on public.playlists to authenticated;

create table if not exists public.playlist_items (
  playlist_id uuid not null references public.playlists (id) on delete cascade,
  video_id    uuid not null references public.videos (id) on delete cascade,
  position    integer not null default 0,
  added_at    timestamptz not null default now(),
  primary key (playlist_id, video_id)
);
revoke all on public.playlist_items from anon, authenticated;
grant select on public.playlist_items to authenticated;

create table if not exists public.challenges (
  id           uuid primary key default gen_random_uuid(),
  hashtag_id   bigint not null references public.hashtags (id) on delete cascade,
  title        text not null,
  description  text,
  cover_url    text,
  created_by   uuid references public.profiles (id) on delete set null,
  starts_at    timestamptz not null default now(),
  ends_at      timestamptz,
  is_featured  boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint challenges_title_len check (char_length(title) between 2 and 80)
);
create unique index if not exists challenges_hashtag_key on public.challenges (hashtag_id);
revoke all on public.challenges from anon, authenticated;
grant select on public.challenges to authenticated;

create table if not exists public.video_drafts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists video_drafts_user_idx on public.video_drafts (user_id, updated_at desc);
revoke all on public.video_drafts from anon, authenticated;
grant select, insert, update, delete on public.video_drafts to authenticated;

-- ----------------------------------------------------------------------------
-- Counters & notifications
-- ----------------------------------------------------------------------------
create or replace function public.on_video_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.removed_at is null then update public.profiles set videos_count = videos_count + 1 where id = new.author_id; end if;
    if new.sound_id is not null then update public.sounds set uses_count = uses_count + 1 where id = new.sound_id; end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.removed_at is null then update public.profiles set videos_count = greatest(0, videos_count - 1) where id = old.author_id; end if;
    if old.sound_id is not null then update public.sounds set uses_count = greatest(0, uses_count - 1) where id = old.sound_id; end if;
    return old;
  elsif tg_op = 'UPDATE' then
    if old.removed_at is null and new.removed_at is not null then
      update public.profiles set videos_count = greatest(0, videos_count - 1) where id = new.author_id;
    elsif old.removed_at is not null and new.removed_at is null then
      update public.profiles set videos_count = videos_count + 1 where id = new.author_id;
    end if;
    if old.sound_id is distinct from new.sound_id then
      if old.sound_id is not null then update public.sounds set uses_count = greatest(0, uses_count - 1) where id = old.sound_id; end if;
      if new.sound_id is not null then update public.sounds set uses_count = uses_count + 1 where id = new.sound_id; end if;
    end if;
    new.updated_at = now();
    return new;
  end if;
  return null;
end $$;

create or replace function public.on_video_before_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.hashtags h set videos_count = greatest(0, h.videos_count - 1)
    where h.id in (select hashtag_id from public.video_hashtags where video_id = old.id);
  return old;
end $$;

drop trigger if exists videos_before_delete on public.videos;
create trigger videos_before_delete before delete on public.videos for each row execute function public.on_video_before_delete();
drop trigger if exists videos_before_update on public.videos;
create trigger videos_before_update before update on public.videos for each row execute function public.on_video_change();
drop trigger if exists videos_after_insert_delete on public.videos;
create trigger videos_after_insert_delete after insert or delete on public.videos for each row execute function public.on_video_change();

create or replace function public.on_video_like_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
  if tg_op = 'INSERT' then
    update public.videos set likes_count = likes_count + 1 where id = new.video_id returning author_id into v_author;
    update public.profiles set likes_count = likes_count + 1, popularity_score = popularity_score + 0.5 where id = v_author;
    perform public.create_notification(v_author, new.user_id, 'video_like', 'video', new.video_id::text);
    return new;
  else
    update public.videos set likes_count = greatest(0, likes_count - 1) where id = old.video_id returning author_id into v_author;
    update public.profiles set likes_count = greatest(0, likes_count - 1), popularity_score = greatest(0, popularity_score - 0.5) where id = v_author;
    return old;
  end if;
end $$;
drop trigger if exists video_likes_after_change on public.video_likes;
create trigger video_likes_after_change after insert or delete on public.video_likes for each row execute function public.on_video_like_change();

create or replace function public.on_video_comment_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_author uuid; v_parent_author uuid;
begin
  if tg_op = 'INSERT' then
    update public.videos set comments_count = comments_count + 1 where id = new.video_id returning author_id into v_author;
    if new.parent_id is not null then
      update public.video_comments set replies_count = replies_count + 1 where id = new.parent_id returning author_id into v_parent_author;
      perform public.create_notification(v_parent_author, new.author_id, 'comment_reply', 'video_comment', new.id::text, jsonb_build_object('video_id', new.video_id, 'preview', left(new.text, 120)));
      if v_parent_author is distinct from v_author then
        perform public.create_notification(v_author, new.author_id, 'video_comment', 'video', new.video_id::text, jsonb_build_object('preview', left(new.text, 120)));
      end if;
    else
      perform public.create_notification(v_author, new.author_id, 'video_comment', 'video', new.video_id::text, jsonb_build_object('preview', left(new.text, 120)));
    end if;
    return new;
  else
    update public.videos set comments_count = greatest(0, comments_count - 1) where id = old.video_id;
    if old.parent_id is not null then update public.video_comments set replies_count = greatest(0, replies_count - 1) where id = old.parent_id; end if;
    return old;
  end if;
end $$;
drop trigger if exists video_comments_after_change on public.video_comments;
create trigger video_comments_after_change after insert or delete on public.video_comments for each row execute function public.on_video_comment_change();

create or replace function public.on_video_comment_reaction_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update public.video_comments set likes_count = likes_count + 1 where id = new.comment_id; return new;
  else update public.video_comments set likes_count = greatest(0, likes_count - 1) where id = old.comment_id; return old; end if;
end $$;
drop trigger if exists video_comment_reactions_after_change on public.video_comment_reactions;
create trigger video_comment_reactions_after_change after insert or delete on public.video_comment_reactions for each row execute function public.on_video_comment_reaction_change();

create or replace function public.on_video_save_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update public.videos set saves_count = saves_count + 1 where id = new.video_id; return new;
  else update public.videos set saves_count = greatest(0, saves_count - 1) where id = old.video_id; return old; end if;
end $$;
drop trigger if exists video_saves_after_change on public.video_saves;
create trigger video_saves_after_change after insert or delete on public.video_saves for each row execute function public.on_video_save_change();

create or replace function public.on_video_repost_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
  if tg_op = 'INSERT' then
    update public.videos set reposts_count = reposts_count + 1 where id = new.video_id returning author_id into v_author;
    perform public.create_notification(v_author, new.user_id, 'video_repost', 'video', new.video_id::text);
    return new;
  else
    update public.videos set reposts_count = greatest(0, reposts_count - 1) where id = old.video_id; return old;
  end if;
end $$;
drop trigger if exists video_reposts_after_change on public.video_reposts;
create trigger video_reposts_after_change after insert or delete on public.video_reposts for each row execute function public.on_video_repost_change();

create or replace function public.on_playlist_item_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update public.playlists set videos_count = videos_count + 1 where id = new.playlist_id; return new;
  else update public.playlists set videos_count = greatest(0, videos_count - 1) where id = old.playlist_id; return old; end if;
end $$;
drop trigger if exists playlist_items_after_change on public.playlist_items;
create trigger playlist_items_after_change after insert or delete on public.playlist_items for each row execute function public.on_playlist_item_change();

create or replace function public.link_video_hashtags(p_video uuid, p_text text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tag text; v_id bigint;
begin
  update public.hashtags h set videos_count = greatest(0, h.videos_count - 1) where h.id in (select hashtag_id from public.video_hashtags where video_id = p_video);
  delete from public.video_hashtags where video_id = p_video;
  foreach v_tag in array public.extract_hashtags(p_text) loop
    if v_tag !~ '^[a-z0-9_]{2,50}$' then continue; end if;
    insert into public.hashtags (tag) values (v_tag) on conflict (tag) do nothing;
    select id into v_id from public.hashtags where tag = v_tag;
    insert into public.video_hashtags (video_id, hashtag_id) values (p_video, v_id) on conflict do nothing;
    update public.hashtags set videos_count = videos_count + 1 where id = v_id;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- JSON
-- ----------------------------------------------------------------------------
create or replace function public.sound_json(s public.sounds)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'title', s.title, 'artist', s.artist, 'url', s.url, 'cover_url', s.cover_url, 'duration_ms', s.duration_ms,
                            'is_original', s.is_original, 'uses_count', s.uses_count, 'origin_video_id', s.origin_video_id,
                            'owner', case when s.owner_id is null then null else public.profile_card_json(s.owner_id) end)
$$;

create or replace function public.video_json(v public.videos, p_viewer uuid, p_depth integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare j jsonb; v_ref public.videos;
begin
  j := jsonb_build_object(
    'id', v.id, 'caption', v.caption, 'status', v.status, 'provider', v.provider,
    'media_url', coalesce(v.playback_url, v.media_url), 'thumbnail_url', v.thumbnail_url,
    'width', v.width, 'height', v.height, 'duration_ms', v.duration_ms,
    'audience', v.audience, 'allow_comments', v.allow_comments, 'allow_duet', v.allow_duet, 'allow_stitch', v.allow_stitch, 'allow_download', v.allow_download,
    'sound', (select public.sound_json(s) from public.sounds s where s.id = v.sound_id),
    'sound_volume', v.sound_volume, 'original_volume', v.original_volume,
    'trim_start_ms', v.trim_start_ms, 'trim_end_ms', v.trim_end_ms, 'playback_rate', v.playback_rate,
    'overlays', v.overlays, 'filter', v.filter,
    'likes_count', v.likes_count, 'comments_count', v.comments_count, 'shares_count', v.shares_count, 'saves_count', v.saves_count,
    'reposts_count', v.reposts_count, 'views_count', v.views_count,
    'created_at', v.created_at, 'removed', v.removed_at is not null,
    'author', public.profile_card_json(v.author_id),
    'hashtags', coalesce((select jsonb_agg(h.tag order by h.tag) from public.video_hashtags vh join public.hashtags h on h.id = vh.hashtag_id where vh.video_id = v.id), '[]'::jsonb),
    'viewer', jsonb_build_object(
      'liked', exists (select 1 from public.video_likes l where l.video_id = v.id and l.user_id = p_viewer),
      'saved', exists (select 1 from public.video_saves s where s.video_id = v.id and s.user_id = p_viewer),
      'reposted', exists (select 1 from public.video_reposts r where r.video_id = v.id and r.user_id = p_viewer),
      'following_author', public.is_following(p_viewer, v.author_id),
      'is_author', v.author_id = p_viewer)
  );
  if p_depth = 0 then
    if v.duet_of is not null then
      select * into v_ref from public.videos where id = v.duet_of;
      if found and v_ref.removed_at is null and public.can_view_post_of(v_ref.author_id, v_ref.audience, p_viewer) then
        j := j || jsonb_build_object('duet_of', public.video_json(v_ref, p_viewer, 1));
      else
        j := j || jsonb_build_object('duet_of', jsonb_build_object('unavailable', true));
      end if;
    end if;
    if v.stitch_of is not null then
      select * into v_ref from public.videos where id = v.stitch_of;
      if found and v_ref.removed_at is null and public.can_view_post_of(v_ref.author_id, v_ref.audience, p_viewer) then
        j := j || jsonb_build_object('stitch_of', public.video_json(v_ref, p_viewer, 1) || jsonb_build_object('stitch_start_ms', v.stitch_start_ms, 'stitch_end_ms', v.stitch_end_ms));
      else
        j := j || jsonb_build_object('stitch_of', jsonb_build_object('unavailable', true));
      end if;
    end if;
    if v.reply_to_comment_id is not null then
      j := j || jsonb_build_object('reply_to_comment', (select jsonb_build_object('id', c.id, 'video_id', c.video_id, 'text', c.text, 'author', public.profile_card_json(c.author_id)) from public.video_comments c where c.id = v.reply_to_comment_id));
    end if;
  end if;
  return j;
end $$;

create or replace function public.video_comment_json(c public.video_comments, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'video_id', c.video_id, 'parent_id', c.parent_id,
    'text', case when c.removed_at is null then c.text else null end, 'removed', c.removed_at is not null,
    'likes_count', c.likes_count, 'replies_count', c.replies_count, 'created_at', c.created_at, 'edited_at', c.edited_at,
    'author', public.profile_card_json(c.author_id),
    'reply_video', case when c.reply_video_id is null then null else (select jsonb_build_object('id', rv.id, 'thumbnail_url', rv.thumbnail_url) from public.videos rv where rv.id = c.reply_video_id and rv.removed_at is null) end,
    'viewer', jsonb_build_object('liked', exists (select 1 from public.video_comment_reactions r where r.comment_id = c.id and r.user_id = p_viewer), 'is_author', c.author_id = p_viewer))
$$;

-- ----------------------------------------------------------------------------
-- Video RPCs
-- ----------------------------------------------------------------------------
create or replace function public.create_video(
  p_media_url text, p_thumbnail_url text default null, p_caption text default null,
  p_width integer default null, p_height integer default null, p_duration_ms integer default null,
  p_audience public.post_audience default 'public', p_allow_comments boolean default true, p_allow_duet boolean default true,
  p_allow_stitch boolean default true, p_allow_download boolean default false,
  p_sound_id uuid default null, p_sound_volume numeric default 1, p_original_volume numeric default 1,
  p_trim_start_ms integer default 0, p_trim_end_ms integer default null, p_playback_rate numeric default 1,
  p_overlays jsonb default '[]'::jsonb, p_filter text default 'none',
  p_duet_of uuid default null, p_stitch_of uuid default null, p_stitch_start_ms integer default null, p_stitch_end_ms integer default null,
  p_reply_to_comment_id uuid default null, p_create_original_sound boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid; v_ref public.videos; v_recent integer; v_sound uuid;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = v_me and account_status = 'active') then raise exception 'ACCOUNT_RESTRICTED' using errcode = '42501'; end if;
  if coalesce(p_media_url, '') = '' or position('/' || v_me::text || '/' in p_media_url) = 0 then raise exception 'MEDIA_NOT_OWNED' using errcode = '42501'; end if;
  if p_duration_ms is not null and p_duration_ms > 10 * 60 * 1000 then raise exception 'VIDEO_TOO_LONG' using errcode = '23514', hint = 'Videos can be up to 10 minutes.'; end if;
  select count(*) into v_recent from public.videos where author_id = v_me and created_at > now() - interval '1 hour';
  if v_recent >= 20 then raise exception 'RATE_LIMITED' using errcode = 'P0001', hint = 'You are uploading too fast. Try again later.'; end if;
  if p_duet_of is not null then
    select * into v_ref from public.videos where id = p_duet_of and removed_at is null;
    if not found or not v_ref.allow_duet or not public.can_view_post_of(v_ref.author_id, v_ref.audience, v_me) then raise exception 'DUET_NOT_ALLOWED' using errcode = '42501', hint = 'This creator does not allow duets.'; end if;
  end if;
  if p_stitch_of is not null then
    select * into v_ref from public.videos where id = p_stitch_of and removed_at is null;
    if not found or not v_ref.allow_stitch or not public.can_view_post_of(v_ref.author_id, v_ref.audience, v_me) then raise exception 'STITCH_NOT_ALLOWED' using errcode = '42501', hint = 'This creator does not allow stitches.'; end if;
  end if;
  if p_sound_id is not null and not exists (select 1 from public.sounds where id = p_sound_id and is_active) then raise exception 'SOUND_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_reply_to_comment_id is not null and not exists (select 1 from public.video_comments c join public.videos v on v.id = c.video_id where c.id = p_reply_to_comment_id and v.author_id = v_me) then
    raise exception 'REPLY_NOT_ALLOWED' using errcode = '42501', hint = 'You can only reply with video to comments on your own videos.';
  end if;

  insert into public.videos (author_id, caption, media_url, thumbnail_url, width, height, duration_ms, audience, allow_comments, allow_duet, allow_stitch, allow_download,
                             sound_id, sound_volume, original_volume, trim_start_ms, trim_end_ms, playback_rate, overlays, filter, duet_of, stitch_of, stitch_start_ms, stitch_end_ms, reply_to_comment_id)
  values (v_me, nullif(trim(coalesce(p_caption, '')), ''), p_media_url, p_thumbnail_url, p_width, p_height, p_duration_ms, p_audience, p_allow_comments, p_allow_duet, p_allow_stitch, p_allow_download,
          p_sound_id, least(1, greatest(0, coalesce(p_sound_volume, 1))), least(1, greatest(0, coalesce(p_original_volume, 1))), greatest(0, coalesce(p_trim_start_ms, 0)), p_trim_end_ms,
          least(3, greatest(0.3, coalesce(p_playback_rate, 1))), coalesce(p_overlays, '[]'::jsonb), coalesce(left(p_filter, 30), 'none'), p_duet_of, p_stitch_of, p_stitch_start_ms, p_stitch_end_ms, p_reply_to_comment_id)
  returning id into v_id;

  -- Every video with its own audio becomes a reusable "original sound".
  if p_sound_id is null and p_create_original_sound and p_media_url is not null then
    insert into public.sounds (owner_id, title, artist, url, duration_ms, origin_video_id, is_original)
    values (v_me, 'Original sound - ' || (select username from public.profiles where id = v_me), (select display_name from public.profiles where id = v_me), p_media_url, p_duration_ms, v_id, true)
    returning id into v_sound;
    update public.videos set sound_id = v_sound where id = v_id;
  end if;

  perform public.link_video_hashtags(v_id, p_caption);
  perform public.notify_mentions(v_me, p_caption, 'video', v_id::text);
  if p_reply_to_comment_id is not null then
    update public.video_comments set reply_video_id = v_id where id = p_reply_to_comment_id;
  end if;
  return public.video_json((select v from public.videos v where v.id = v_id), v_me);
end $$;

create or replace function public.update_video(p_id uuid, p_caption text default null, p_audience public.post_audience default null, p_allow_comments boolean default null, p_allow_duet boolean default null, p_allow_stitch boolean default null, p_allow_download boolean default null, p_thumbnail_url text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.videos set
    caption = case when p_caption is null then caption else nullif(trim(p_caption), '') end,
    audience = coalesce(p_audience, audience), allow_comments = coalesce(p_allow_comments, allow_comments),
    allow_duet = coalesce(p_allow_duet, allow_duet), allow_stitch = coalesce(p_allow_stitch, allow_stitch), allow_download = coalesce(p_allow_download, allow_download),
    thumbnail_url = coalesce(p_thumbnail_url, thumbnail_url)
  where id = p_id and author_id = auth.uid() and removed_at is null;
  if not found then raise exception 'VIDEO_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_caption is not null then perform public.link_video_hashtags(p_id, p_caption); end if;
  return public.video_json((select v from public.videos v where v.id = p_id), auth.uid());
end $$;

create or replace function public.delete_video(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.videos where id = p_id and (author_id = auth.uid() or public.is_admin());
  if not found then raise exception 'VIDEO_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

create or replace function public.get_video(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.videos;
begin
  select * into v from public.videos where id = p_id;
  if not found or (v.removed_at is not null and not (v.author_id = auth.uid() or public.is_admin())) or not public.can_view_post_of(v.author_id, v.audience, auth.uid()) then
    raise exception 'VIDEO_NOT_FOUND' using errcode = 'P0002';
  end if;
  return public.video_json(v, auth.uid());
end $$;

create or replace function public.toggle_video_like(p_video uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.videos;
begin
  select * into v from public.videos where id = p_video and removed_at is null;
  if not found or not public.can_view_post_of(v.author_id, v.audience, auth.uid()) then raise exception 'VIDEO_NOT_FOUND' using errcode = 'P0002'; end if;
  if exists (select 1 from public.video_likes where video_id = p_video and user_id = auth.uid()) then delete from public.video_likes where video_id = p_video and user_id = auth.uid();
  else insert into public.video_likes (video_id, user_id) values (p_video, auth.uid()); end if;
  return jsonb_build_object('liked', exists (select 1 from public.video_likes where video_id = p_video and user_id = auth.uid()), 'likes_count', (select likes_count from public.videos where id = p_video));
end $$;

create or replace function public.toggle_video_save(p_video uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.videos;
begin
  select * into v from public.videos where id = p_video and removed_at is null;
  if not found or not public.can_view_post_of(v.author_id, v.audience, auth.uid()) then raise exception 'VIDEO_NOT_FOUND' using errcode = 'P0002'; end if;
  if exists (select 1 from public.video_saves where video_id = p_video and user_id = auth.uid()) then delete from public.video_saves where video_id = p_video and user_id = auth.uid();
  else insert into public.video_saves (user_id, video_id) values (auth.uid(), p_video); end if;
  return jsonb_build_object('saved', exists (select 1 from public.video_saves where video_id = p_video and user_id = auth.uid()));
end $$;

create or replace function public.toggle_video_repost(p_video uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.videos;
begin
  select * into v from public.videos where id = p_video and removed_at is null;
  if not found or not public.can_view_post_of(v.author_id, v.audience, auth.uid()) then raise exception 'VIDEO_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.audience <> 'public' then raise exception 'CANNOT_SHARE_PRIVATE' using errcode = '42501', hint = 'Only public videos can be reposted.'; end if;
  if exists (select 1 from public.video_reposts where video_id = p_video and user_id = auth.uid()) then delete from public.video_reposts where video_id = p_video and user_id = auth.uid();
  else insert into public.video_reposts (user_id, video_id) values (auth.uid(), p_video); end if;
  return jsonb_build_object('reposted', exists (select 1 from public.video_reposts where video_id = p_video and user_id = auth.uid()), 'reposts_count', (select reposts_count from public.videos where id = p_video));
end $$;

create or replace function public.record_video_share(p_video uuid)
returns void language sql security definer set search_path = public as $$
  update public.videos set shares_count = shares_count + 1 where id = p_video and removed_at is null and auth.uid() is not null
$$;

create or replace function public.record_video_view(p_video uuid, p_watched_ms integer default 0, p_completed boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.video_views (video_id, user_id, watched_ms, completed) values (p_video, auth.uid(), greatest(0, coalesce(p_watched_ms, 0)), coalesce(p_completed, false));
  update public.videos set views_count = views_count + 1 where id = p_video;
end $$;

create or replace function public.video_feedback(p_video uuid, p_kind public.feed_feedback_kind)
returns void language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select author_id into v_author from public.videos where id = p_video;
  if v_author is null then raise exception 'VIDEO_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.video_feedback (user_id, video_id, author_id, kind) values (auth.uid(), p_video, v_author, p_kind) on conflict (user_id, video_id, kind) where video_id is not null do nothing;
end $$;

create or replace function public.add_video_comment(p_video uuid, p_text text, p_parent uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.videos; v_parent public.video_comments; v_id uuid; v_setting public.audience_type;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into v from public.videos where id = p_video and removed_at is null;
  if not found or not public.can_view_post_of(v.author_id, v.audience, auth.uid()) then raise exception 'VIDEO_NOT_FOUND' using errcode = 'P0002'; end if;
  if not v.allow_comments then raise exception 'COMMENTS_DISABLED' using errcode = '42501'; end if;
  select who_can_comment into v_setting from public.user_settings where user_id = v.author_id;
  if not public.can_interact(v.author_id, auth.uid(), coalesce(v_setting, 'everyone')) then raise exception 'COMMENTS_RESTRICTED' using errcode = '42501'; end if;
  if nullif(trim(coalesce(p_text, '')), '') is null then raise exception 'TEXT_REQUIRED' using errcode = '23514'; end if;
  if p_parent is not null then
    select * into v_parent from public.video_comments where id = p_parent and video_id = p_video and removed_at is null;
    if not found then raise exception 'COMMENT_NOT_FOUND' using errcode = 'P0002'; end if;
    if v_parent.parent_id is not null then p_parent := v_parent.parent_id; end if;
  end if;
  insert into public.video_comments (video_id, author_id, parent_id, text) values (p_video, auth.uid(), p_parent, trim(p_text)) returning id into v_id;
  perform public.notify_mentions(auth.uid(), p_text, 'video_comment', v_id::text, jsonb_build_object('video_id', p_video));
  return public.video_comment_json((select c from public.video_comments c where c.id = v_id), auth.uid());
end $$;

create or replace function public.edit_video_comment(p_id uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if nullif(trim(coalesce(p_text, '')), '') is null then raise exception 'TEXT_REQUIRED' using errcode = '23514'; end if;
  update public.video_comments set text = trim(p_text), edited_at = now() where id = p_id and author_id = auth.uid() and removed_at is null;
  if not found then raise exception 'COMMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  return public.video_comment_json((select c from public.video_comments c where c.id = p_id), auth.uid());
end $$;

create or replace function public.delete_video_comment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.video_comments;
begin
  select * into c from public.video_comments where id = p_id;
  if not found then raise exception 'COMMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if c.author_id = auth.uid() or public.is_admin() or exists (select 1 from public.videos v where v.id = c.video_id and v.author_id = auth.uid()) then
    delete from public.video_comments where id = p_id;
  else raise exception 'FORBIDDEN' using errcode = '42501'; end if;
end $$;

create or replace function public.toggle_video_comment_like(p_comment uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.video_comments c join public.videos v on v.id = c.video_id where c.id = p_comment and c.removed_at is null and public.can_view_post_of(v.author_id, v.audience, auth.uid())) then
    raise exception 'COMMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.video_comment_reactions where comment_id = p_comment and user_id = auth.uid()) then delete from public.video_comment_reactions where comment_id = p_comment and user_id = auth.uid();
  else insert into public.video_comment_reactions (comment_id, user_id) values (p_comment, auth.uid()); end if;
  return jsonb_build_object('liked', exists (select 1 from public.video_comment_reactions where comment_id = p_comment and user_id = auth.uid()), 'likes_count', (select likes_count from public.video_comments where id = p_comment));
end $$;

create or replace function public.get_video_comments(p_video uuid, p_limit integer default 20, p_before timestamptz default null, p_parent uuid default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.video_comment_json(c, auth.uid())
  from public.video_comments c
  where c.video_id = p_video
    and exists (select 1 from public.videos v where v.id = p_video and v.removed_at is null and public.can_view_post_of(v.author_id, v.audience, auth.uid()))
    and (case when p_parent is null then c.parent_id is null else c.parent_id = p_parent end)
    and (p_before is null or c.created_at < p_before)
    and not public.is_blocked_either(auth.uid(), c.author_id)
  order by c.created_at asc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
$$;

-- ----------------------------------------------------------------------------
-- Feeds & discovery
-- ----------------------------------------------------------------------------
create or replace function public.get_video_feed_for_you(p_limit integer default 10, p_offset integer default 0)
returns setof jsonb language sql stable security definer set search_path = public as $$
  with me as (
    select auth.uid() as id,
           (select coalesce(array_agg(interest_id), '{}'::int[]) from public.user_interests where user_id = auth.uid()) as interests
  ),
  candidates as (
    select v.*,
           exists (select 1 from public.follows f where f.follower_id = me.id and f.following_id = v.author_id) as following,
           (select count(*) from public.user_interests ui where ui.user_id = v.author_id and ui.interest_id = any (me.interests)) as shared,
           exists (select 1 from public.video_views vv where vv.user_id = me.id and vv.video_id = v.id and vv.created_at > now() - interval '3 days') as seen
    from public.videos v, me
    where v.removed_at is null and v.status = 'ready' and v.author_id <> me.id
      and v.created_at > now() - interval '30 days'
      and public.can_view_post_of(v.author_id, v.audience, me.id)
      and exists (select 1 from public.profiles pr where pr.id = v.author_id and pr.account_status = 'active' and (pr.discoverable or exists (select 1 from public.follows f where f.follower_id = me.id and f.following_id = v.author_id)))
      and not exists (select 1 from public.video_feedback vf where vf.user_id = me.id and (vf.video_id = v.id or (vf.author_id = v.author_id and vf.kind = 'not_interested')))
  ),
  scored as (
    select c.*, (exp(-extract(epoch from (now() - c.created_at)) / 3600.0 / 48.0) * 8)
      + ln(1 + c.likes_count) * 2 + ln(1 + c.comments_count) * 2.5 + ln(1 + c.shares_count) * 2 + ln(1 + c.views_count) * 0.8
      + case when c.following then 5 else 0 end + c.shared * 1.2 - case when c.seen then 10 else 0 end as score
    from candidates c
  )
  select public.video_json(row(s.id, s.author_id, s.caption, s.status, s.provider, s.provider_id, s.media_url, s.playback_url, s.thumbnail_url, s.width, s.height, s.duration_ms, s.audience, s.allow_comments, s.allow_duet, s.allow_stitch, s.allow_download, s.sound_id, s.sound_volume, s.original_volume, s.trim_start_ms, s.trim_end_ms, s.playback_rate, s.overlays, s.filter, s.duet_of, s.stitch_of, s.stitch_start_ms, s.stitch_end_ms, s.reply_to_comment_id, s.likes_count, s.comments_count, s.shares_count, s.saves_count, s.reposts_count, s.views_count, s.removed_at, s.removed_by, s.removed_reason, s.created_at, s.updated_at)::public.videos, auth.uid())
  from scored s order by s.score desc, s.created_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 30)) offset greatest(0, coalesce(p_offset, 0))
$$;

create or replace function public.get_video_feed_following(p_limit integer default 10, p_before timestamptz default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.video_json(v, auth.uid())
  from public.videos v
  where v.removed_at is null and v.status = 'ready'
    and (exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.following_id = v.author_id)
         or public.are_friends(auth.uid(), v.author_id) or v.author_id = auth.uid())
    and public.can_view_post_of(v.author_id, v.audience, auth.uid())
    and not exists (select 1 from public.video_feedback vf where vf.user_id = auth.uid() and vf.video_id = v.id)
    and (p_before is null or v.created_at < p_before)
  order by v.created_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 30))
$$;

create or replace function public.get_video_feed_trending(p_limit integer default 10, p_offset integer default 0)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.video_json(v, auth.uid())
  from public.videos v
  where v.removed_at is null and v.status = 'ready' and v.audience = 'public'
    and v.created_at > now() - interval '7 days'
    and public.can_view_post_of(v.author_id, v.audience, auth.uid())
    and exists (select 1 from public.profiles pr where pr.id = v.author_id and pr.discoverable and pr.account_status = 'active')
    and not exists (select 1 from public.video_feedback vf where vf.user_id = auth.uid() and (vf.video_id = v.id or (vf.author_id = v.author_id and vf.kind = 'not_interested')))
  order by (v.likes_count * 2 + v.comments_count * 3 + v.shares_count * 4 + v.views_count * 0.2 + 1) / power(extract(epoch from (now() - v.created_at)) / 3600.0 + 2, 1.2) desc, v.created_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 30)) offset greatest(0, coalesce(p_offset, 0))
$$;

create or replace function public.get_user_videos(p_user uuid, p_limit integer default 18, p_before timestamptz default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.video_json(v, auth.uid()) from public.videos v
  where v.author_id = p_user and (v.removed_at is null or v.author_id = auth.uid() or public.is_admin())
    and public.can_view_post_of(v.author_id, v.audience, auth.uid())
    and (p_before is null or v.created_at < p_before)
  order by v.created_at desc limit greatest(1, least(coalesce(p_limit, 18), 60))
$$;

create or replace function public.get_saved_videos(p_limit integer default 18, p_before timestamptz default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.video_json(v, auth.uid()) || jsonb_build_object('saved_at', s.created_at) from public.video_saves s join public.videos v on v.id = s.video_id
  where s.user_id = auth.uid() and v.removed_at is null and (p_before is null or s.created_at < p_before)
  order by s.created_at desc limit greatest(1, least(coalesce(p_limit, 18), 60))
$$;

create or replace function public.get_hashtag_videos(p_tag text, p_limit integer default 18, p_offset integer default 0)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.video_json(v, auth.uid()) from public.video_hashtags vh join public.hashtags h on h.id = vh.hashtag_id join public.videos v on v.id = vh.video_id
  where h.tag = lower(ltrim(p_tag, '#')) and v.removed_at is null and v.audience = 'public' and public.can_view_post_of(v.author_id, v.audience, auth.uid())
  order by v.likes_count desc, v.created_at desc limit greatest(1, least(coalesce(p_limit, 18), 60)) offset greatest(0, coalesce(p_offset, 0))
$$;

create or replace function public.get_sound_videos(p_sound uuid, p_limit integer default 18, p_offset integer default 0)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.video_json(v, auth.uid()) from public.videos v
  where v.sound_id = p_sound and v.removed_at is null and v.audience = 'public' and public.can_view_post_of(v.author_id, v.audience, auth.uid())
  order by v.likes_count desc, v.created_at desc limit greatest(1, least(coalesce(p_limit, 18), 60)) offset greatest(0, coalesce(p_offset, 0))
$$;

create or replace function public.get_video_duets(p_video uuid, p_limit integer default 18)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.video_json(v, auth.uid()) from public.videos v
  where (v.duet_of = p_video or v.stitch_of = p_video) and v.removed_at is null and v.audience = 'public' and public.can_view_post_of(v.author_id, v.audience, auth.uid())
  order by v.created_at desc limit greatest(1, least(coalesce(p_limit, 18), 60))
$$;

create or replace function public.search_videos(p_query text, p_limit integer default 20, p_offset integer default 0)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.video_json(v, auth.uid()) from public.videos v
  where v.removed_at is null and v.audience = 'public' and v.caption ilike '%' || trim(p_query) || '%' and public.can_view_post_of(v.author_id, v.audience, auth.uid())
  order by v.likes_count desc, v.created_at desc limit greatest(1, least(coalesce(p_limit, 20), 50)) offset greatest(0, coalesce(p_offset, 0))
$$;

-- ----------------------------------------------------------------------------
-- Sounds, playlists, challenges, drafts, analytics
-- ----------------------------------------------------------------------------
create or replace function public.create_sound(p_title text, p_url text, p_artist text default null, p_duration_ms integer default null, p_cover_url text default null, p_license_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if coalesce(p_url, '') = '' or position('/' || auth.uid()::text || '/' in p_url) = 0 then raise exception 'MEDIA_NOT_OWNED' using errcode = '42501'; end if;
  insert into public.sounds (owner_id, title, artist, url, duration_ms, cover_url, is_original, license_note)
  values (auth.uid(), left(trim(p_title), 100), left(p_artist, 100), p_url, p_duration_ms, p_cover_url, false, left(p_license_note, 300)) returning id into v_id;
  return public.sound_json((select s from public.sounds s where s.id = v_id));
end $$;

create or replace function public.get_sound(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.sound_json(s) from public.sounds s where s.id = p_id and s.is_active
$$;

create or replace function public.get_trending_sounds(p_limit integer default 20, p_query text default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.sound_json(s) from public.sounds s
  where s.is_active and (p_query is null or s.title ilike '%' || trim(p_query) || '%' or s.artist ilike '%' || trim(p_query) || '%')
  order by s.uses_count desc, s.created_at desc limit greatest(1, least(coalesce(p_limit, 20), 60))
$$;

create or replace function public.create_playlist(p_title text, p_description text default null, p_is_public boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  insert into public.playlists (owner_id, title, description, is_public) values (auth.uid(), left(trim(p_title), 60), nullif(trim(coalesce(p_description, '')), ''), coalesce(p_is_public, true)) returning id into v_id;
  return (select jsonb_build_object('id', p.id, 'title', p.title, 'description', p.description, 'is_public', p.is_public, 'videos_count', p.videos_count) from public.playlists p where p.id = v_id);
end $$;

create or replace function public.update_playlist(p_id uuid, p_title text default null, p_description text default null, p_is_public boolean default null, p_add uuid[] default null, p_remove uuid[] default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_vid uuid; v_pos integer;
begin
  if not exists (select 1 from public.playlists where id = p_id and owner_id = auth.uid()) then raise exception 'PLAYLIST_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.playlists set title = coalesce(left(nullif(trim(coalesce(p_title, '')), ''), 60), title), description = case when p_description is null then description else nullif(trim(p_description), '') end, is_public = coalesce(p_is_public, is_public) where id = p_id;
  if p_remove is not null then delete from public.playlist_items where playlist_id = p_id and video_id = any (p_remove); end if;
  if p_add is not null then
    select coalesce(max(position), -1) + 1 into v_pos from public.playlist_items where playlist_id = p_id;
    foreach v_vid in array p_add loop
      if exists (select 1 from public.videos v where v.id = v_vid and v.author_id = auth.uid() and v.removed_at is null) then
        insert into public.playlist_items (playlist_id, video_id, position) values (p_id, v_vid, v_pos) on conflict do nothing;
        v_pos := v_pos + 1;
      end if;
    end loop;
  end if;
end $$;

create or replace function public.delete_playlist(p_id uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.playlists where id = p_id and owner_id = auth.uid()
$$;

create or replace function public.get_playlists(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'description', p.description, 'is_public', p.is_public, 'videos_count', p.videos_count,
           'cover_url', (select v.thumbnail_url from public.playlist_items i join public.videos v on v.id = i.video_id where i.playlist_id = p.id and v.removed_at is null order by i.position limit 1)) order by p.created_at desc), '[]'::jsonb)
  from public.playlists p where p.owner_id = p_user and (p.is_public or p.owner_id = auth.uid()) and public.can_view_profile(p_user)
$$;

create or replace function public.get_playlist_videos(p_playlist uuid)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.video_json(v, auth.uid()) from public.playlist_items i join public.videos v on v.id = i.video_id join public.playlists p on p.id = i.playlist_id
  where i.playlist_id = p_playlist and v.removed_at is null and (p.is_public or p.owner_id = auth.uid()) and public.can_view_post_of(v.author_id, v.audience, auth.uid())
  order by i.position
$$;

create or replace function public.create_challenge(p_tag text, p_title text, p_description text default null, p_cover_url text default null, p_ends_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tag text := lower(ltrim(trim(p_tag), '#')); v_hid bigint; v_id uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if v_tag !~ '^[a-z0-9_]{2,50}$' then raise exception 'INVALID_HASHTAG' using errcode = '23514'; end if;
  insert into public.hashtags (tag) values (v_tag) on conflict (tag) do nothing;
  select id into v_hid from public.hashtags where tag = v_tag;
  insert into public.challenges (hashtag_id, title, description, cover_url, created_by, ends_at, is_featured)
  values (v_hid, left(trim(p_title), 80), nullif(trim(coalesce(p_description, '')), ''), p_cover_url, auth.uid(), p_ends_at, public.is_admin())
  on conflict (hashtag_id) do update set title = excluded.title where public.challenges.created_by = auth.uid() or public.is_admin()
  returning id into v_id;
  return public.get_challenge(v_tag);
end $$;

create or replace function public.get_challenge(p_tag text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'tag', h.tag, 'title', c.title, 'description', c.description, 'cover_url', c.cover_url, 'starts_at', c.starts_at, 'ends_at', c.ends_at,
                            'is_featured', c.is_featured, 'videos_count', h.videos_count, 'ended', c.ends_at is not null and c.ends_at < now(),
                            'creator', case when c.created_by is null then null else public.profile_card_json(c.created_by) end)
  from public.challenges c join public.hashtags h on h.id = c.hashtag_id where h.tag = lower(ltrim(p_tag, '#'))
$$;

create or replace function public.get_challenges(p_limit integer default 20)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.get_challenge(h.tag) order by c.is_featured desc, h.videos_count desc, c.created_at desc), '[]'::jsonb)
  from (select * from public.challenges c where c.ends_at is null or c.ends_at > now() - interval '7 days' order by c.is_featured desc, c.created_at desc limit greatest(1, least(coalesce(p_limit, 20), 50))) c
  join public.hashtags h on h.id = c.hashtag_id
$$;

create or replace function public.get_creator_analytics(p_days integer default 28)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_from timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 28), 90)));
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  return jsonb_build_object(
    'range_days', greatest(1, least(coalesce(p_days, 28), 90)),
    'totals', jsonb_build_object(
      'videos', (select count(*) from public.videos where author_id = v_me and removed_at is null),
      'views', (select count(*) from public.video_views vv join public.videos v on v.id = vv.video_id where v.author_id = v_me and vv.created_at >= v_from),
      'likes', (select count(*) from public.video_likes l join public.videos v on v.id = l.video_id where v.author_id = v_me and l.created_at >= v_from),
      'comments', (select count(*) from public.video_comments c join public.videos v on v.id = c.video_id where v.author_id = v_me and c.created_at >= v_from),
      'shares', (select coalesce(sum(shares_count), 0) from public.videos where author_id = v_me),
      'new_followers', (select count(*) from public.follows where following_id = v_me and created_at >= v_from),
      'followers', (select followers_count from public.profiles where id = v_me),
      'avg_watch_ms', (select coalesce(avg(vv.watched_ms), 0)::int from public.video_views vv join public.videos v on v.id = vv.video_id where v.author_id = v_me and vv.created_at >= v_from),
      'completion_rate', (select coalesce(avg(case when vv.completed then 1 else 0 end), 0) from public.video_views vv join public.videos v on v.id = vv.video_id where v.author_id = v_me and vv.created_at >= v_from)),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'views', coalesce(x.views, 0), 'likes', coalesce(x.likes, 0), 'followers', coalesce(f.n, 0)) order by d.day)
      from generate_series(date_trunc('day', v_from), date_trunc('day', now()), interval '1 day') as d(day)
      left join (select date_trunc('day', vv.created_at) as day, count(*) as views, 0 as likes from public.video_views vv join public.videos v on v.id = vv.video_id where v.author_id = v_me and vv.created_at >= v_from group by 1) x on x.day = d.day
      left join (select date_trunc('day', created_at) as day, count(*) as n from public.follows where following_id = v_me and created_at >= v_from group by 1) f on f.day = d.day), '[]'::jsonb),
    'top_videos', coalesce((select jsonb_agg(public.video_json(v, v_me) order by v.views_count desc) from (select * from public.videos where author_id = v_me and removed_at is null order by views_count desc limit 5) v), '[]'::jsonb)
  );
end $$;

create or replace function public.get_video_analytics(p_video uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'video', public.video_json(v, auth.uid()),
    'unique_viewers', (select count(distinct user_id) from public.video_views where video_id = v.id),
    'avg_watch_ms', (select coalesce(avg(watched_ms), 0)::int from public.video_views where video_id = v.id),
    'completion_rate', (select coalesce(avg(case when completed then 1 else 0 end), 0) from public.video_views where video_id = v.id),
    'views_by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'views', n) order by d) from (select date_trunc('day', created_at) d, count(*) n from public.video_views where video_id = v.id group by 1) t), '[]'::jsonb))
  from public.videos v where v.id = p_video and v.author_id = auth.uid()
$$;

-- ----------------------------------------------------------------------------
-- Privileges & RLS
-- ----------------------------------------------------------------------------
do $do$
declare f text;
begin
  foreach f in array array[
    'public.sound_json(public.sounds)', 'public.video_json(public.videos, uuid, integer)', 'public.video_comment_json(public.video_comments, uuid)',
    'public.create_video(text, text, text, integer, integer, integer, public.post_audience, boolean, boolean, boolean, boolean, uuid, numeric, numeric, integer, integer, numeric, jsonb, text, uuid, uuid, integer, integer, uuid, boolean)',
    'public.update_video(uuid, text, public.post_audience, boolean, boolean, boolean, boolean, text)', 'public.delete_video(uuid)', 'public.get_video(uuid)',
    'public.toggle_video_like(uuid)', 'public.toggle_video_save(uuid)', 'public.toggle_video_repost(uuid)', 'public.record_video_share(uuid)', 'public.record_video_view(uuid, integer, boolean)',
    'public.video_feedback(uuid, public.feed_feedback_kind)', 'public.add_video_comment(uuid, text, uuid)', 'public.edit_video_comment(uuid, text)', 'public.delete_video_comment(uuid)',
    'public.toggle_video_comment_like(uuid)', 'public.get_video_comments(uuid, integer, timestamptz, uuid)',
    'public.get_video_feed_for_you(integer, integer)', 'public.get_video_feed_following(integer, timestamptz)', 'public.get_video_feed_trending(integer, integer)',
    'public.get_user_videos(uuid, integer, timestamptz)', 'public.get_saved_videos(integer, timestamptz)', 'public.get_hashtag_videos(text, integer, integer)', 'public.get_sound_videos(uuid, integer, integer)',
    'public.get_video_duets(uuid, integer)', 'public.search_videos(text, integer, integer)', 'public.create_sound(text, text, text, integer, text, text)', 'public.get_sound(uuid)', 'public.get_trending_sounds(integer, text)',
    'public.create_playlist(text, text, boolean)', 'public.update_playlist(uuid, text, text, boolean, uuid[], uuid[])', 'public.delete_playlist(uuid)', 'public.get_playlists(uuid)', 'public.get_playlist_videos(uuid)',
    'public.create_challenge(text, text, text, text, timestamptz)', 'public.get_challenge(text)', 'public.get_challenges(integer)', 'public.get_creator_analytics(integer)', 'public.get_video_analytics(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  execute 'revoke all on function public.link_video_hashtags(uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.link_video_hashtags(uuid, text) to service_role';
end $do$;

alter table public.sounds enable row level security;
alter table public.videos enable row level security;
alter table public.video_likes enable row level security;
alter table public.video_comments enable row level security;
alter table public.video_comment_reactions enable row level security;
alter table public.video_saves enable row level security;
alter table public.video_reposts enable row level security;
alter table public.video_views enable row level security;
alter table public.video_hashtags enable row level security;
alter table public.video_feedback enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_items enable row level security;
alter table public.challenges enable row level security;
alter table public.video_drafts enable row level security;

drop policy if exists "sounds_select" on public.sounds;
create policy "sounds_select" on public.sounds for select to authenticated using (is_active or owner_id = auth.uid() or public.is_admin());
drop policy if exists "videos_select" on public.videos;
create policy "videos_select" on public.videos for select to authenticated
  using ((removed_at is null and status = 'ready' and public.can_view_post_of(author_id, audience, auth.uid())) or author_id = auth.uid() or public.is_admin());
drop policy if exists "video_likes_select" on public.video_likes;
create policy "video_likes_select" on public.video_likes for select to authenticated using (user_id = auth.uid() or exists (select 1 from public.videos v where v.id = video_id and public.can_view_post_of(v.author_id, v.audience, auth.uid())));
drop policy if exists "video_comments_select" on public.video_comments;
create policy "video_comments_select" on public.video_comments for select to authenticated using (author_id = auth.uid() or public.is_admin() or exists (select 1 from public.videos v where v.id = video_id and v.removed_at is null and public.can_view_post_of(v.author_id, v.audience, auth.uid())));
drop policy if exists "video_comment_reactions_select" on public.video_comment_reactions;
create policy "video_comment_reactions_select" on public.video_comment_reactions for select to authenticated using (user_id = auth.uid() or exists (select 1 from public.video_comments c join public.videos v on v.id = c.video_id where c.id = comment_id and public.can_view_post_of(v.author_id, v.audience, auth.uid())));
drop policy if exists "video_saves_own" on public.video_saves;
create policy "video_saves_own" on public.video_saves for select to authenticated using (user_id = auth.uid());
drop policy if exists "video_reposts_select" on public.video_reposts;
create policy "video_reposts_select" on public.video_reposts for select to authenticated using (user_id = auth.uid() or public.can_view_profile(user_id));
drop policy if exists "video_views_select" on public.video_views;
create policy "video_views_select" on public.video_views for select to authenticated using (user_id = auth.uid() or exists (select 1 from public.videos v where v.id = video_id and v.author_id = auth.uid()) or public.is_admin());
drop policy if exists "video_hashtags_select" on public.video_hashtags;
create policy "video_hashtags_select" on public.video_hashtags for select to authenticated using (exists (select 1 from public.videos v where v.id = video_id and (v.author_id = auth.uid() or public.can_view_post_of(v.author_id, v.audience, auth.uid()))));
drop policy if exists "video_feedback_own" on public.video_feedback;
create policy "video_feedback_own" on public.video_feedback for select to authenticated using (user_id = auth.uid());
drop policy if exists "playlists_select" on public.playlists;
create policy "playlists_select" on public.playlists for select to authenticated using (owner_id = auth.uid() or (is_public and public.can_view_profile(owner_id)));
drop policy if exists "playlist_items_select" on public.playlist_items;
create policy "playlist_items_select" on public.playlist_items for select to authenticated using (exists (select 1 from public.playlists p where p.id = playlist_id and (p.owner_id = auth.uid() or (p.is_public and public.can_view_profile(p.owner_id)))));
drop policy if exists "challenges_select" on public.challenges;
create policy "challenges_select" on public.challenges for select to authenticated using (true);
drop policy if exists "video_drafts_own" on public.video_drafts;
create policy "video_drafts_own" on public.video_drafts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

do $do$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'video_comments') then
    alter publication supabase_realtime add table public.video_comments;
  end if;
end $do$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', true, 262144000, array['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/aac', 'audio/wav', 'audio/webm'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "videos_public_read" on storage.objects;
create policy "videos_public_read" on storage.objects for select using (bucket_id = 'videos');
drop policy if exists "videos_insert_own" on storage.objects;
create policy "videos_insert_own" on storage.objects for insert to authenticated with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "videos_update_own" on storage.objects;
create policy "videos_update_own" on storage.objects for update to authenticated using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "videos_delete_own" on storage.objects;
create policy "videos_delete_own" on storage.objects for delete to authenticated using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);


-- ########## 20261125000006_economy.sql ##########

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


-- ########## 20261125000007_live.sql ##########

-- ============================================================================
-- Friendzy — Phase 7: livestreaming
-- Live sessions (scheduled → preparing → live → ended), viewers with
-- heartbeats, comments with filters / slow mode / pins, likes, gifts wired
-- into the economy ledger, multi-guest stage (requests, invites, approval,
-- media controls), co-hosts, moderators & bans, battles, fan clubs,
-- reminders, discovery and host analytics. Media transport is LiveKit
-- (room `live_<id>`, tokens from the livekit-token Edge Function).
-- ============================================================================

do $do$ begin
  create type public.live_status as enum ('scheduled', 'preparing', 'live', 'ended', 'cancelled');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.live_role as enum ('viewer', 'guest', 'cohost', 'moderator');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.live_participant_state as enum ('watching', 'requested', 'invited', 'on_stage', 'left', 'removed');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.live_comment_kind as enum ('comment', 'gift', 'join', 'system');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.battle_status as enum ('active', 'finished', 'cancelled');
exception when duplicate_object then null; end $do$;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------
create table if not exists public.live_sessions (
  id                 uuid primary key default gen_random_uuid(),
  host_id            uuid not null references public.profiles (id) on delete cascade,
  title              text not null,
  category           text not null default 'chat',
  cover_url          text,
  status             public.live_status not null default 'preparing',
  visibility         public.post_audience not null default 'public',
  room_name          text unique,
  scheduled_at       timestamptz,
  started_at         timestamptz,
  ended_at           timestamptz,
  viewers_count      integer not null default 0,
  peak_viewers       integer not null default 0,
  total_views        integer not null default 0,
  likes_count        bigint not null default 0,
  comments_count     integer not null default 0,
  gifts_count        integer not null default 0,
  gifts_coins        bigint not null default 0,
  allow_guests       boolean not null default true,
  allow_comments     boolean not null default true,
  comment_audience   public.audience_type not null default 'everyone',
  slow_mode_seconds  integer not null default 0,
  host_last_seen_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint live_title_len check (char_length(title) between 1 and 80),
  constraint live_category check (category in ('chat', 'music', 'gaming', 'talent', 'travel', 'learning', 'fitness', 'cooking', 'battles', 'other')),
  constraint live_slow_mode check (slow_mode_seconds between 0 and 60),
  constraint live_comment_audience check (comment_audience in ('everyone', 'followers', 'friends'))
);
create index if not exists live_sessions_status_idx on public.live_sessions (status, viewers_count desc);
create index if not exists live_sessions_host_idx on public.live_sessions (host_id, created_at desc);
create index if not exists live_sessions_scheduled_idx on public.live_sessions (scheduled_at) where status = 'scheduled';
revoke all on public.live_sessions from anon, authenticated;
grant select on public.live_sessions to authenticated;

create table if not exists public.live_participants (
  live_id      uuid not null references public.live_sessions (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         public.live_role not null default 'viewer',
  state        public.live_participant_state not null default 'watching',
  mic_enabled  boolean not null default true,
  cam_enabled  boolean not null default true,
  joined_at    timestamptz not null default clock_timestamp(),
  left_at      timestamptz,
  last_seen_at timestamptz not null default clock_timestamp(),
  primary key (live_id, user_id)
);
create index if not exists live_participants_user_idx on public.live_participants (user_id, joined_at desc);
revoke all on public.live_participants from anon, authenticated;
grant select on public.live_participants to authenticated;

create table if not exists public.live_comments (
  id         uuid primary key default gen_random_uuid(),
  live_id    uuid not null references public.live_sessions (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete set null,
  kind       public.live_comment_kind not null default 'comment',
  text       text,
  metadata   jsonb not null default '{}'::jsonb,
  pinned     boolean not null default false,
  removed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint live_comments_text_len check (text is null or char_length(text) <= 300)
);
create index if not exists live_comments_live_idx on public.live_comments (live_id, created_at desc);
revoke all on public.live_comments from anon, authenticated;
grant select on public.live_comments to authenticated;

create table if not exists public.live_likes (
  live_id    uuid not null references public.live_sessions (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  count      integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (live_id, user_id)
);
revoke all on public.live_likes from anon, authenticated;
grant select on public.live_likes to authenticated;

create table if not exists public.live_mutes (
  live_id  uuid not null references public.live_sessions (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  muted_by uuid references public.profiles (id) on delete set null,
  until    timestamptz not null,
  primary key (live_id, user_id)
);
revoke all on public.live_mutes from anon, authenticated;
grant select on public.live_mutes to authenticated;

create table if not exists public.live_bans (
  live_id    uuid not null references public.live_sessions (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  banned_by  uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (live_id, user_id)
);
revoke all on public.live_bans from anon, authenticated;
grant select on public.live_bans to authenticated;

create table if not exists public.host_moderators (
  host_id    uuid not null references public.profiles (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (host_id, user_id)
);
revoke all on public.host_moderators from anon, authenticated;
grant select on public.host_moderators to authenticated;

create table if not exists public.live_gift_events (
  id         bigserial primary key,
  live_id    uuid not null references public.live_sessions (id) on delete cascade,
  gift       jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists live_gift_events_live_idx on public.live_gift_events (live_id, id desc);
revoke all on public.live_gift_events from anon, authenticated;
grant select on public.live_gift_events to authenticated;

create table if not exists public.live_battles (
  id             uuid primary key default gen_random_uuid(),
  live_id        uuid not null references public.live_sessions (id) on delete cascade,
  host_id        uuid not null references public.profiles (id) on delete cascade,
  opponent_id    uuid not null references public.profiles (id) on delete cascade,
  status         public.battle_status not null default 'active',
  started_at     timestamptz not null default clock_timestamp(),
  ends_at        timestamptz not null,
  host_score     bigint not null default 0,
  opponent_score bigint not null default 0,
  winner_id      uuid references public.profiles (id) on delete set null,
  finished_at    timestamptz
);
create index if not exists live_battles_live_idx on public.live_battles (live_id, started_at desc);
revoke all on public.live_battles from anon, authenticated;
grant select on public.live_battles to authenticated;

create table if not exists public.fan_club_members (
  creator_id uuid not null references public.profiles (id) on delete cascade,
  fan_id     uuid not null references public.profiles (id) on delete cascade,
  points     bigint not null default 0,
  level      integer not null default 1,
  joined_at  timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (creator_id, fan_id),
  constraint fan_club_no_self check (creator_id <> fan_id)
);
create index if not exists fan_club_members_fan_idx on public.fan_club_members (fan_id);
revoke all on public.fan_club_members from anon, authenticated;
grant select on public.fan_club_members to authenticated;

create table if not exists public.live_reminders (
  live_id    uuid not null references public.live_sessions (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (live_id, user_id)
);
revoke all on public.live_reminders from anon, authenticated;
grant select on public.live_reminders to authenticated;

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------
create or replace function public.can_view_live(p_live uuid, p_viewer uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.live_sessions l
    where l.id = p_live
      and (l.host_id = p_viewer or public.is_admin()
           or (public.can_view_post_of(l.host_id, l.visibility, p_viewer)
               and not exists (select 1 from public.live_bans b where b.live_id = l.id and b.user_id = p_viewer))))
$$;

create or replace function public.is_live_host(p_live uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.live_sessions l where l.id = p_live and l.host_id = p_user)
$$;

create or replace function public.is_live_moderator(p_live uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_live_host(p_live, p_user) or public.is_admin()
      or exists (select 1 from public.live_participants p where p.live_id = p_live and p.user_id = p_user and p.role = 'moderator' and p.state <> 'removed')
      or exists (select 1 from public.host_moderators m join public.live_sessions l on l.host_id = m.host_id where l.id = p_live and m.user_id = p_user)
$$;

create or replace function public.fan_level_for(p_points bigint)
returns integer language sql immutable as $$
  select case when p_points >= 50000 then 5 when p_points >= 10000 then 4 when p_points >= 2000 then 3 when p_points >= 500 then 2 else 1 end
$$;

create or replace function public.fan_badge(p_creator uuid, p_fan uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when f.fan_id is null then null else jsonb_build_object('level', f.level, 'points', f.points) end
  from (select 1) x left join public.fan_club_members f on f.creator_id = p_creator and f.fan_id = p_fan
$$;

create or replace function public.live_json(l public.live_sessions, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', l.id, 'title', l.title, 'category', l.category, 'cover_url', l.cover_url, 'status', l.status, 'visibility', l.visibility,
    'room_name', l.room_name, 'scheduled_at', l.scheduled_at, 'started_at', l.started_at, 'ended_at', l.ended_at,
    'viewers_count', l.viewers_count, 'peak_viewers', l.peak_viewers, 'total_views', l.total_views, 'likes_count', l.likes_count,
    'comments_count', l.comments_count, 'gifts_count', l.gifts_count, 'gifts_coins', l.gifts_coins,
    'allow_guests', l.allow_guests, 'allow_comments', l.allow_comments, 'comment_audience', l.comment_audience, 'slow_mode_seconds', l.slow_mode_seconds,
    'created_at', l.created_at,
    'host', public.profile_card_json(l.host_id) || jsonb_build_object('followers_count', (select followers_count from public.profiles where id = l.host_id)),
    'is_host', l.host_id = p_viewer,
    'is_moderator', public.is_live_moderator(l.id, p_viewer),
    'following_host', public.is_following(p_viewer, l.host_id),
    'my_state', (select p.state from public.live_participants p where p.live_id = l.id and p.user_id = p_viewer),
    'my_role', (select p.role from public.live_participants p where p.live_id = l.id and p.user_id = p_viewer),
    'reminder_set', exists (select 1 from public.live_reminders r where r.live_id = l.id and r.user_id = p_viewer),
    'stage', coalesce((select jsonb_agg(public.profile_card_json(p.user_id) || jsonb_build_object('role', p.role, 'mic_enabled', p.mic_enabled, 'cam_enabled', p.cam_enabled) order by p.joined_at)
                       from public.live_participants p where p.live_id = l.id and p.state = 'on_stage'), '[]'::jsonb),
    'pending_requests', case when public.is_live_moderator(l.id, p_viewer) then (select count(*) from public.live_participants p where p.live_id = l.id and p.state = 'requested') else 0 end,
    'pinned_comment', (select jsonb_build_object('id', c.id, 'text', c.text, 'user', public.profile_card_json(c.user_id)) from public.live_comments c where c.live_id = l.id and c.pinned and c.removed_at is null order by c.created_at desc limit 1),
    'battle', (select jsonb_build_object('id', b.id, 'host', public.profile_card_json(b.host_id), 'opponent', public.profile_card_json(b.opponent_id), 'host_score', b.host_score, 'opponent_score', b.opponent_score,
                                         'started_at', b.started_at, 'ends_at', b.ends_at, 'status', b.status, 'winner_id', b.winner_id)
               from public.live_battles b where b.live_id = l.id and (b.status = 'active' or b.finished_at > now() - interval '2 minutes') order by b.started_at desc limit 1),
    'fan_badge', public.fan_badge(l.host_id, p_viewer)
  )
$$;

create or replace function public.live_comment_json(c public.live_comments)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'live_id', c.live_id, 'kind', c.kind, 'text', case when c.removed_at is null then c.text else null end, 'metadata', c.metadata,
                            'pinned', c.pinned, 'removed', c.removed_at is not null, 'created_at', c.created_at,
                            'user', case when c.user_id is null then null else public.profile_card_json(c.user_id) end,
                            'fan_badge', (select public.fan_badge(l.host_id, c.user_id) from public.live_sessions l where l.id = c.live_id),
                            'is_moderator', public.is_live_moderator(c.live_id, c.user_id))
$$;

create or replace function public.recount_live_viewers(p_live uuid)
returns void language sql security definer set search_path = public as $$
  update public.live_sessions l set
    viewers_count = (select count(*) from public.live_participants p where p.live_id = p_live and p.state in ('watching', 'requested', 'invited', 'on_stage') and p.last_seen_at > clock_timestamp() - interval '90 seconds'),
    peak_viewers = greatest(l.peak_viewers, (select count(*) from public.live_participants p where p.live_id = p_live and p.state in ('watching', 'requested', 'invited', 'on_stage') and p.last_seen_at > clock_timestamp() - interval '90 seconds')),
    updated_at = now()
  where l.id = p_live
$$;

create or replace function public.insert_live_system(p_live uuid, p_text text, p_kind public.live_comment_kind default 'system', p_metadata jsonb default '{}'::jsonb, p_user uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into public.live_comments (live_id, user_id, kind, text, metadata) values (p_live, p_user, p_kind, left(p_text, 300), coalesce(p_metadata, '{}'::jsonb))
$$;

-- ----------------------------------------------------------------------------
-- Session lifecycle
-- ----------------------------------------------------------------------------
create or replace function public.create_live(
  p_title text, p_category text default 'chat', p_cover_url text default null, p_visibility public.post_audience default 'public',
  p_scheduled_at timestamptz default null, p_allow_guests boolean default true, p_allow_comments boolean default true, p_comment_audience public.audience_type default 'everyone'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid; v_status public.live_status;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not coalesce(public.is_adult(v_me), false) then raise exception 'ADULTS_ONLY' using errcode = '42501', hint = 'Hosting live broadcasts is available from age 18.'; end if;
  if not exists (select 1 from public.profiles where id = v_me and account_status = 'active') then raise exception 'ACCOUNT_RESTRICTED' using errcode = '42501'; end if;
  if exists (select 1 from public.live_sessions where host_id = v_me and status in ('preparing', 'live')) then
    raise exception 'ALREADY_LIVE' using errcode = 'P0001', hint = 'End your current broadcast before starting another.';
  end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'TITLE_REQUIRED' using errcode = '23514', hint = 'Give your live a title.'; end if;
  v_status := case when p_scheduled_at is not null and p_scheduled_at > now() + interval '2 minutes' then 'scheduled' else 'preparing' end;
  insert into public.live_sessions (host_id, title, category, cover_url, status, visibility, scheduled_at, allow_guests, allow_comments, comment_audience, host_last_seen_at)
  values (v_me, left(trim(p_title), 80), coalesce(p_category, 'chat'), p_cover_url, v_status, coalesce(p_visibility, 'public'), p_scheduled_at, coalesce(p_allow_guests, true), coalesce(p_allow_comments, true), coalesce(p_comment_audience, 'everyone'), clock_timestamp())
  returning id into v_id;
  update public.live_sessions set room_name = 'live_' || v_id::text where id = v_id;
  if v_status = 'scheduled' then
    insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, data)
    select f.follower_id, v_me, 'live_scheduled', 'live', v_id::text, jsonb_build_object('title', left(trim(p_title), 80), 'scheduled_at', p_scheduled_at)
    from public.follows f join public.notification_preferences np on np.user_id = f.follower_id and np.live
    where f.following_id = v_me and not public.is_blocked_either(f.follower_id, v_me);
  end if;
  return public.live_json((select l from public.live_sessions l where l.id = v_id), v_me);
end $$;

create or replace function public.update_live(p_id uuid, p_title text default null, p_category text default null, p_cover_url text default null, p_allow_guests boolean default null, p_allow_comments boolean default null, p_comment_audience public.audience_type default null, p_slow_mode_seconds integer default null, p_scheduled_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_live_host(p_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.live_sessions set
    title = coalesce(left(nullif(trim(coalesce(p_title, '')), ''), 80), title), category = coalesce(p_category, category), cover_url = coalesce(p_cover_url, cover_url),
    allow_guests = coalesce(p_allow_guests, allow_guests), allow_comments = coalesce(p_allow_comments, allow_comments), comment_audience = coalesce(p_comment_audience, comment_audience),
    slow_mode_seconds = coalesce(p_slow_mode_seconds, slow_mode_seconds), scheduled_at = coalesce(p_scheduled_at, scheduled_at), updated_at = now()
  where id = p_id and status in ('scheduled', 'preparing', 'live');
  return public.live_json((select l from public.live_sessions l where l.id = p_id), auth.uid());
end $$;

create or replace function public.start_live(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.live_sessions;
begin
  select * into v from public.live_sessions where id = p_id for update;
  if v.id is null or v.host_id <> auth.uid() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v.status = 'live' then return public.live_json(v, auth.uid()); end if;
  if v.status not in ('scheduled', 'preparing') then raise exception 'LIVE_OVER' using errcode = 'P0001', hint = 'This broadcast has already ended.'; end if;
  update public.live_sessions set status = 'live', started_at = clock_timestamp(), host_last_seen_at = clock_timestamp(), updated_at = now() where id = p_id;
  -- Persistent moderators join automatically.
  insert into public.live_participants (live_id, user_id, role, state)
  select p_id, m.user_id, 'moderator', 'left' from public.host_moderators m where m.host_id = v.host_id on conflict do nothing;
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

create or replace function public.end_live(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.live_sessions;
begin
  select * into v from public.live_sessions where id = p_id for update;
  if v.id is null or (v.host_id <> auth.uid() and not public.is_admin()) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v.status in ('ended', 'cancelled') then return public.live_json(v, auth.uid()); end if;
  update public.live_sessions set status = case when v.status = 'scheduled' then 'cancelled' else 'ended' end::public.live_status, ended_at = clock_timestamp(), viewers_count = 0, updated_at = now() where id = p_id;
  update public.live_participants set state = 'left', left_at = clock_timestamp() where live_id = p_id and state <> 'removed';
  update public.live_battles set status = 'finished', finished_at = clock_timestamp(), winner_id = case when host_score > opponent_score then host_id when opponent_score > host_score then opponent_id else null end where live_id = p_id and status = 'active';
  return public.live_json((select l from public.live_sessions l where l.id = p_id), auth.uid());
end $$;

-- ----------------------------------------------------------------------------
-- Viewers
-- ----------------------------------------------------------------------------
create or replace function public.join_live(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.live_sessions; v_role public.live_role := 'viewer'; v_existing public.live_participants;
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
    insert into public.live_participants (live_id, user_id, role, state) values (p_id, auth.uid(), v_role, 'watching');
    update public.live_sessions set total_views = total_views + 1 where id = p_id;
    if v.status = 'live' then perform public.insert_live_system(p_id, 'joined', 'join', '{}'::jsonb, auth.uid()); end if;
  elsif v_existing.state in ('left') then
    update public.live_participants set state = 'watching', joined_at = clock_timestamp(), last_seen_at = clock_timestamp(), left_at = null, role = (case when v_existing.role = 'moderator' then 'moderator' else 'viewer' end)::public.live_role where live_id = p_id and user_id = auth.uid();
    update public.live_sessions set total_views = total_views + 1 where id = p_id;
  elsif v_existing.state = 'removed' then
    raise exception 'REMOVED_FROM_LIVE' using errcode = '42501', hint = 'You were removed from this broadcast.';
  else
    update public.live_participants set last_seen_at = clock_timestamp() where live_id = p_id and user_id = auth.uid();
  end if;
  perform public.recount_live_viewers(p_id);
  return public.live_json((select l from public.live_sessions l where l.id = p_id), auth.uid());
end $$;

create or replace function public.leave_live(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.live_participants set state = 'left', left_at = clock_timestamp(), role = (case when role = 'moderator' then 'moderator' else 'viewer' end)::public.live_role where live_id = p_id and user_id = auth.uid() and state <> 'removed';
  perform public.recount_live_viewers(p_id);
end $$;

create or replace function public.live_heartbeat(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if public.is_live_host(p_id) then
    update public.live_sessions set host_last_seen_at = clock_timestamp() where id = p_id;
  else
    update public.live_participants set last_seen_at = clock_timestamp() where live_id = p_id and user_id = auth.uid() and state in ('watching', 'requested', 'invited', 'on_stage');
  end if;
  perform public.recount_live_viewers(p_id);
  return jsonb_build_object('viewers_count', (select viewers_count from public.live_sessions where id = p_id), 'status', (select status from public.live_sessions where id = p_id));
end $$;

-- ----------------------------------------------------------------------------
-- Comments, likes
-- ----------------------------------------------------------------------------
create or replace function public.send_live_comment(p_id uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.live_sessions; v_me uuid := auth.uid(); v_last timestamptz; v_id uuid;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into v from public.live_sessions where id = p_id;
  if v.id is null or not public.can_view_live(p_id) then raise exception 'LIVE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.status <> 'live' then raise exception 'LIVE_OVER' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_text, '')), '') is null then raise exception 'TEXT_REQUIRED' using errcode = '23514'; end if;
  if v.host_id <> v_me and not public.is_live_moderator(p_id, v_me) then
    if not v.allow_comments then raise exception 'COMMENTS_DISABLED' using errcode = '42501', hint = 'The host turned off comments.'; end if;
    if not public.can_interact(v.host_id, v_me, v.comment_audience) then raise exception 'COMMENTS_RESTRICTED' using errcode = '42501', hint = 'Only ' || v.comment_audience || ' can comment on this live.'; end if;
    if exists (select 1 from public.live_mutes m where m.live_id = p_id and m.user_id = v_me and m.until > now()) then raise exception 'MUTED' using errcode = '42501', hint = 'You have been muted in this broadcast.'; end if;
    if v.slow_mode_seconds > 0 then
      select max(created_at) into v_last from public.live_comments where live_id = p_id and user_id = v_me and kind = 'comment';
      if v_last is not null and v_last > clock_timestamp() - make_interval(secs => v.slow_mode_seconds) then
        raise exception 'SLOW_MODE' using errcode = 'P0001', hint = format('Slow mode: one comment every %s seconds.', v.slow_mode_seconds);
      end if;
    end if;
  end if;
  if (select count(*) from public.live_comments where user_id = v_me and created_at > clock_timestamp() - interval '10 seconds') >= 8 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001', hint = 'Slow down a little.';
  end if;
  insert into public.live_comments (live_id, user_id, kind, text) values (p_id, v_me, 'comment', left(trim(p_text), 300)) returning id into v_id;
  update public.live_sessions set comments_count = comments_count + 1 where id = p_id;
  return public.live_comment_json((select c from public.live_comments c where c.id = v_id));
end $$;

create or replace function public.pin_live_comment(p_comment uuid, p_pin boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare v_live uuid;
begin
  select live_id into v_live from public.live_comments where id = p_comment;
  if v_live is null or not public.is_live_moderator(v_live) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_pin then update public.live_comments set pinned = false where live_id = v_live and pinned; end if;
  update public.live_comments set pinned = p_pin where id = p_comment;
end $$;

create or replace function public.delete_live_comment(p_comment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.live_comments;
begin
  select * into c from public.live_comments where id = p_comment;
  if c.id is null then raise exception 'COMMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if c.user_id <> auth.uid() and not public.is_live_moderator(c.live_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.live_comments set removed_at = clock_timestamp(), pinned = false where id = p_comment;
end $$;

create or replace function public.like_live(p_id uuid, p_count integer default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n integer := least(100, greatest(1, coalesce(p_count, 1)));
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not exists (select 1 from public.live_sessions l where l.id = p_id and l.status = 'live') or not public.can_view_live(p_id) then raise exception 'LIVE_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.live_likes (live_id, user_id, count) values (p_id, auth.uid(), v_n)
  on conflict (live_id, user_id) do update set count = public.live_likes.count + v_n, updated_at = now();
  update public.live_sessions set likes_count = likes_count + v_n where id = p_id;
  return jsonb_build_object('likes_count', (select likes_count from public.live_sessions where id = p_id));
end $$;

-- ----------------------------------------------------------------------------
-- Stage: requests, invites, approval, media, removal, roles
-- ----------------------------------------------------------------------------
create or replace function public.request_live_stage(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v public.live_sessions;
begin
  select * into v from public.live_sessions where id = p_id;
  if v.id is null or not public.can_view_live(p_id) or v.status <> 'live' then raise exception 'LIVE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not v.allow_guests then raise exception 'GUESTS_DISABLED' using errcode = '42501', hint = 'The host is not accepting guests.'; end if;
  if not coalesce(public.is_adult(auth.uid()), false) then raise exception 'ADULTS_ONLY' using errcode = '42501', hint = 'Joining a live on camera is available from age 18.'; end if;
  update public.live_participants set state = 'requested', last_seen_at = clock_timestamp() where live_id = p_id and user_id = auth.uid() and state = 'watching';
  if not found then raise exception 'JOIN_FIRST' using errcode = 'P0001', hint = 'Join the live before requesting to go on stage.'; end if;
end $$;

create or replace function public.cancel_live_stage_request(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.live_participants set state = 'watching' where live_id = p_id and user_id = auth.uid() and state in ('requested', 'invited')
$$;

create or replace function public.invite_live_guest(p_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v public.live_sessions;
begin
  select * into v from public.live_sessions where id = p_id;
  if v.id is null or not public.is_live_moderator(p_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v.status <> 'live' then raise exception 'LIVE_OVER' using errcode = 'P0001'; end if;
  insert into public.live_participants (live_id, user_id, role, state) values (p_id, p_user, 'viewer', 'invited')
  on conflict (live_id, user_id) do update set state = case when public.live_participants.state in ('watching', 'requested', 'left') then 'invited' else public.live_participants.state end;
  perform public.create_notification(p_user, v.host_id, 'live_guest_invite', 'live', p_id::text, jsonb_build_object('title', v.title));
end $$;

create or replace function public.approve_live_guest(p_id uuid, p_user uuid, p_approve boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare v_on_stage integer;
begin
  if not public.is_live_moderator(p_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_approve then
    select count(*) into v_on_stage from public.live_participants where live_id = p_id and state = 'on_stage';
    if v_on_stage >= 4 then raise exception 'STAGE_FULL' using errcode = 'P0001', hint = 'Up to 4 guests can be on stage.'; end if;
    update public.live_participants set state = 'on_stage', role = (case when role = 'moderator' then 'moderator' else 'guest' end)::public.live_role, last_seen_at = clock_timestamp() where live_id = p_id and user_id = p_user and state in ('requested', 'invited');
    if not found then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002'; end if;
    perform public.insert_live_system(p_id, 'joined the stage', 'system', '{}'::jsonb, p_user);
  else
    update public.live_participants set state = 'watching' where live_id = p_id and user_id = p_user and state in ('requested', 'invited');
  end if;
end $$;

create or replace function public.accept_live_invite(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_on_stage integer;
begin
  if not coalesce(public.is_adult(auth.uid()), false) then raise exception 'ADULTS_ONLY' using errcode = '42501'; end if;
  select count(*) into v_on_stage from public.live_participants where live_id = p_id and state = 'on_stage';
  if v_on_stage >= 4 then raise exception 'STAGE_FULL' using errcode = 'P0001'; end if;
  update public.live_participants set state = 'on_stage', role = (case when role = 'moderator' then 'moderator' else 'guest' end)::public.live_role, last_seen_at = clock_timestamp() where live_id = p_id and user_id = auth.uid() and state = 'invited';
  if not found then raise exception 'INVITE_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.insert_live_system(p_id, 'joined the stage', 'system', '{}'::jsonb, auth.uid());
end $$;

create or replace function public.set_live_guest_media(p_id uuid, p_user uuid, p_mic boolean default null, p_cam boolean default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user <> auth.uid() and not public.is_live_moderator(p_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.live_participants set mic_enabled = coalesce(p_mic, mic_enabled), cam_enabled = coalesce(p_cam, cam_enabled) where live_id = p_id and user_id = p_user and state = 'on_stage';
end $$;

create or replace function public.remove_live_guest(p_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user <> auth.uid() and not public.is_live_moderator(p_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.live_participants set state = 'watching', role = (case when role = 'moderator' then 'moderator' else 'viewer' end)::public.live_role where live_id = p_id and user_id = p_user and state = 'on_stage';
  update public.live_battles set status = 'cancelled', finished_at = clock_timestamp() where live_id = p_id and status = 'active' and opponent_id = p_user;
end $$;

create or replace function public.set_live_cohost(p_id uuid, p_user uuid, p_cohost boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_live_host(p_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.live_participants set role = (case when p_cohost then 'cohost' else 'guest' end)::public.live_role where live_id = p_id and user_id = p_user and state = 'on_stage';
  if not found then raise exception 'GUEST_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

-- ----------------------------------------------------------------------------
-- Moderation
-- ----------------------------------------------------------------------------
create or replace function public.set_live_moderator(p_id uuid, p_user uuid, p_moderator boolean default true, p_persistent boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v public.live_sessions;
begin
  select * into v from public.live_sessions where id = p_id;
  if v.id is null or v.host_id <> auth.uid() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_user = v.host_id then return; end if;
  if p_moderator then
    insert into public.live_participants (live_id, user_id, role, state) values (p_id, p_user, 'moderator', 'left')
    on conflict (live_id, user_id) do update set role = 'moderator';
    if p_persistent then insert into public.host_moderators (host_id, user_id) values (v.host_id, p_user) on conflict do nothing; end if;
  else
    update public.live_participants set role = (case when state = 'on_stage' then 'guest' else 'viewer' end)::public.live_role where live_id = p_id and user_id = p_user;
    delete from public.host_moderators where host_id = v.host_id and user_id = p_user;
  end if;
end $$;

create or replace function public.mute_live_user(p_id uuid, p_user uuid, p_minutes integer default 10)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_live_moderator(p_id) or public.is_live_host(p_id, p_user) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_minutes <= 0 then delete from public.live_mutes where live_id = p_id and user_id = p_user; return; end if;
  insert into public.live_mutes (live_id, user_id, muted_by, until) values (p_id, p_user, auth.uid(), now() + make_interval(mins => least(p_minutes, 1440)))
  on conflict (live_id, user_id) do update set until = excluded.until, muted_by = excluded.muted_by;
end $$;

create or replace function public.ban_live_user(p_id uuid, p_user uuid, p_ban boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_live_moderator(p_id) or public.is_live_host(p_id, p_user) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_ban then
    insert into public.live_bans (live_id, user_id, banned_by) values (p_id, p_user, auth.uid()) on conflict do nothing;
    update public.live_participants set state = 'removed', left_at = clock_timestamp() where live_id = p_id and user_id = p_user;
    update public.live_battles set status = 'cancelled', finished_at = clock_timestamp() where live_id = p_id and status = 'active' and opponent_id = p_user;
    perform public.recount_live_viewers(p_id);
  else
    delete from public.live_bans where live_id = p_id and user_id = p_user;
    update public.live_participants set state = 'left' where live_id = p_id and user_id = p_user and state = 'removed';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Battles & fan clubs & gifts integration
-- ----------------------------------------------------------------------------
create or replace function public.start_live_battle(p_id uuid, p_opponent uuid, p_minutes integer default 5)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_live_host(p_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not exists (select 1 from public.live_participants where live_id = p_id and user_id = p_opponent and state = 'on_stage') then raise exception 'OPPONENT_NOT_ON_STAGE' using errcode = 'P0001', hint = 'Invite them on stage first.'; end if;
  if exists (select 1 from public.live_battles where live_id = p_id and status = 'active') then raise exception 'BATTLE_ACTIVE' using errcode = 'P0001'; end if;
  insert into public.live_battles (live_id, host_id, opponent_id, ends_at) values (p_id, auth.uid(), p_opponent, clock_timestamp() + make_interval(mins => least(30, greatest(1, coalesce(p_minutes, 5))))) returning id into v_id;
  perform public.insert_live_system(p_id, 'started a battle', 'system', jsonb_build_object('battle_id', v_id), auth.uid());
  return (public.live_json((select l from public.live_sessions l where l.id = p_id), auth.uid()))->'battle';
end $$;

create or replace function public.end_live_battle(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.live_battles;
begin
  select * into b from public.live_battles where live_id = p_id and status = 'active' for update;
  if b.id is null then raise exception 'NO_ACTIVE_BATTLE' using errcode = 'P0002'; end if;
  if not public.is_live_host(p_id) and b.ends_at > clock_timestamp() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.live_battles set status = 'finished', finished_at = clock_timestamp(),
    winner_id = case when host_score > opponent_score then host_id when opponent_score > host_score then opponent_id else null end where id = b.id;
  perform public.insert_live_system(p_id, 'battle finished', 'system', jsonb_build_object('battle_id', b.id), b.host_id);
  return (public.live_json((select l from public.live_sessions l where l.id = p_id), auth.uid()))->'battle';
end $$;

create or replace function public.join_fan_club(p_creator uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_creator = auth.uid() then raise exception 'CANNOT_JOIN_OWN' using errcode = 'P0001'; end if;
  if not public.can_view_profile(p_creator) then raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.fan_club_members (creator_id, fan_id) values (p_creator, auth.uid()) on conflict do nothing;
  return public.get_fan_club(p_creator);
end $$;

create or replace function public.leave_fan_club(p_creator uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.fan_club_members where creator_id = p_creator and fan_id = auth.uid()
$$;

create or replace function public.get_fan_club(p_creator uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'creator', public.profile_card_json(p_creator),
    'members_count', (select count(*) from public.fan_club_members where creator_id = p_creator),
    'my_membership', public.fan_badge(p_creator, auth.uid()),
    'top_fans', coalesce((select jsonb_agg(jsonb_build_object('user', public.profile_card_json(f.fan_id), 'points', f.points, 'level', f.level) order by f.points desc)
                          from (select * from public.fan_club_members where creator_id = p_creator order by points desc limit 10) f), '[]'::jsonb),
    'levels', '[{"level":1,"points":0},{"level":2,"points":500},{"level":3,"points":2000},{"level":4,"points":10000},{"level":5,"points":50000}]'::jsonb)
$$;

-- Live gifts: the receiver is the host (or an on-stage guest / co-host when p_recipient is given).
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
    when 'live' then select l.host_id into v from public.live_sessions l where l.id = p_target and l.status = 'live' and public.can_view_live(p_target);
  end case;
  return v;
end $$;

create or replace function public.send_live_gift(p_live uuid, p_gift_id integer, p_quantity integer default 1, p_recipient uuid default null, p_message text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_live public.live_sessions; v_result jsonb; v_gift uuid;
begin
  select * into v_live from public.live_sessions where id = p_live and status = 'live';
  if v_live.id is null or not public.can_view_live(p_live) then raise exception 'LIVE_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_recipient is not null and p_recipient <> v_live.host_id then
    if not exists (select 1 from public.live_participants p where p.live_id = p_live and p.user_id = p_recipient and p.state = 'on_stage') then
      raise exception 'RECIPIENT_NOT_ON_STAGE' using errcode = 'P0001';
    end if;
    v_result := public.send_gift(p_gift_id, 'profile', p_recipient, p_quantity, p_message);
    v_gift := (v_result->'gift'->>'id')::uuid;
    update public.gifts set target_type = 'live', target_id = p_live where id = v_gift;
    perform public.on_live_gift_apply(v_gift);
  else
    v_result := public.send_gift(p_gift_id, 'live', p_live, p_quantity, p_message);
  end if;
  return v_result;
end $$;

create or replace function public.on_live_gift_apply(p_gift uuid)
returns void language plpgsql security definer set search_path = public as $$
declare g public.gifts; v_json jsonb;
begin
  select * into g from public.gifts where id = p_gift and target_type = 'live';
  if g.id is null then return; end if;
  v_json := public.gift_json(g);
  update public.live_sessions set gifts_count = gifts_count + g.quantity, gifts_coins = gifts_coins + g.coins_total where id = g.target_id;
  insert into public.live_gift_events (live_id, gift) values (g.target_id, v_json);
  insert into public.live_comments (live_id, user_id, kind, text, metadata)
  values (g.target_id, g.sender_id, 'gift', 'sent ' || (v_json->'gift'->>'name') || case when g.quantity > 1 then ' x' || g.quantity else '' end, jsonb_build_object('gift', v_json->'gift', 'quantity', g.quantity, 'coins', g.coins_total, 'receiver_id', g.receiver_id));
  update public.live_battles set host_score = host_score + case when receiver_id_matches(g.receiver_id, host_id) then g.coins_total else 0 end,
                                 opponent_score = opponent_score + case when receiver_id_matches(g.receiver_id, opponent_id) then g.coins_total else 0 end
   where live_id = g.target_id and status = 'active' and ends_at > clock_timestamp();
end $$;

create or replace function public.receiver_id_matches(a uuid, b uuid) returns boolean language sql immutable as $$ select a = b $$;

-- Fan-club points accrue from any gift, in any context.
create or replace function public.on_gift_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.fan_club_members (creator_id, fan_id, points, level) values (new.receiver_id, new.sender_id, new.coins_total, public.fan_level_for(new.coins_total))
  on conflict (creator_id, fan_id) do update set points = public.fan_club_members.points + new.coins_total, level = public.fan_level_for(public.fan_club_members.points + new.coins_total), updated_at = now();
  if new.target_type = 'live' then perform public.on_live_gift_apply(new.id); end if;
  return new;
end $$;
drop trigger if exists gifts_after_insert on public.gifts;
create trigger gifts_after_insert after insert on public.gifts for each row execute function public.on_gift_insert();

-- ----------------------------------------------------------------------------
-- Reads
-- ----------------------------------------------------------------------------
create or replace function public.get_live(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.live_json(l, auth.uid()) from public.live_sessions l where l.id = p_id and public.can_view_live(p_id)
$$;

create or replace function public.get_live_comments(p_id uuid, p_limit integer default 50, p_before timestamptz default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.live_comment_json(c) from public.live_comments c
  where c.live_id = p_id and public.can_view_live(p_id) and c.removed_at is null and (p_before is null or c.created_at < p_before)
  order by c.created_at desc limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

create or replace function public.get_live_participants(p_id uuid, p_state text default 'requested')
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.profile_card_json(p.user_id) || jsonb_build_object('role', p.role, 'state', p.state, 'joined_at', p.joined_at, 'mic_enabled', p.mic_enabled, 'cam_enabled', p.cam_enabled) order by p.joined_at), '[]'::jsonb)
  from public.live_participants p
  where p.live_id = p_id and public.can_view_live(p_id)
    and (case p_state when 'requested' then p.state in ('requested', 'invited') and public.is_live_moderator(p_id)
                      when 'on_stage' then p.state = 'on_stage'
                      when 'watching' then p.state in ('watching', 'requested', 'invited', 'on_stage') and p.last_seen_at > clock_timestamp() - interval '90 seconds'
                      else false end)
$$;

create or replace function public.get_live_discovery(p_category text default null, p_limit integer default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'live', coalesce((select jsonb_agg(public.live_json(l, auth.uid()) order by l.viewers_count desc, l.started_at desc)
                      from (select * from public.live_sessions l where l.status = 'live' and public.can_view_live(l.id) and (p_category is null or l.category = p_category)
                            and not public.is_blocked_either(auth.uid(), l.host_id) order by l.viewers_count desc, l.started_at desc limit greatest(1, least(coalesce(p_limit, 30), 60))) l), '[]'::jsonb),
    'following', coalesce((select jsonb_agg(public.live_json(l, auth.uid()) order by l.started_at desc)
                      from (select * from public.live_sessions l where l.status = 'live' and public.is_following(auth.uid(), l.host_id) and public.can_view_live(l.id) order by l.started_at desc limit 20) l), '[]'::jsonb),
    'scheduled', coalesce((select jsonb_agg(public.live_json(l, auth.uid()) order by l.scheduled_at)
                      from (select * from public.live_sessions l where l.status = 'scheduled' and l.scheduled_at > now() - interval '1 hour' and public.can_view_live(l.id) and (p_category is null or l.category = p_category) order by l.scheduled_at limit 20) l), '[]'::jsonb),
    'trending_hosts', coalesce((select jsonb_agg(public.profile_card_json(t.host_id) || jsonb_build_object('total_views', t.views) order by t.views desc)
                      from (select host_id, sum(total_views) views from public.live_sessions where created_at > now() - interval '7 days' and status in ('live', 'ended') group by host_id order by views desc limit 10) t), '[]'::jsonb),
    'categories', '["chat","music","gaming","talent","travel","learning","fitness","cooking","battles","other"]'::jsonb)
$$;

create or replace function public.get_my_lives(p_limit integer default 20)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.live_json(l, auth.uid()) from public.live_sessions l where l.host_id = auth.uid() order by l.created_at desc limit greatest(1, least(coalesce(p_limit, 20), 100))
$$;

create or replace function public.get_user_lives(p_user uuid, p_limit integer default 20)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.live_json(l, auth.uid()) from public.live_sessions l where l.host_id = p_user and l.status in ('live', 'ended', 'scheduled') and public.can_view_live(l.id) order by l.created_at desc limit greatest(1, least(coalesce(p_limit, 20), 100))
$$;

create or replace function public.get_live_summary(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.live_json(l, auth.uid()) || jsonb_build_object(
    'duration_seconds', case when l.started_at is null then 0 else extract(epoch from (coalesce(l.ended_at, now()) - l.started_at))::int end,
    'unique_viewers', (select count(*) from public.live_participants p where p.live_id = l.id),
    'new_followers', (select count(*) from public.follows f where f.following_id = l.host_id and f.created_at between coalesce(l.started_at, l.created_at) and coalesce(l.ended_at, now())),
    'top_gifters', coalesce((select jsonb_agg(jsonb_build_object('user', public.profile_card_json(g.sender_id), 'coins', g.coins) order by g.coins desc)
                    from (select sender_id, sum(coins_total) coins from public.gifts where target_type = 'live' and target_id = l.id group by sender_id order by coins desc limit 5) g), '[]'::jsonb))
  from public.live_sessions l where l.id = p_id and (l.host_id = auth.uid() or public.is_admin())
$$;

create or replace function public.set_live_reminder(p_id uuid, p_on boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_on then insert into public.live_reminders (live_id, user_id) values (p_id, auth.uid()) on conflict do nothing;
  else delete from public.live_reminders where live_id = p_id and user_id = auth.uid(); end if;
end $$;

-- Housekeeping: hosts that vanished (no heartbeat for 5 minutes) → ended; stale viewers → left.
create or replace function public.cleanup_lives()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_n integer := 0;
begin
  for r in select id from public.live_sessions where status = 'live' and coalesce(host_last_seen_at, started_at) < clock_timestamp() - interval '5 minutes' loop
    update public.live_sessions set status = 'ended', ended_at = clock_timestamp(), viewers_count = 0 where id = r.id;
    update public.live_participants set state = 'left', left_at = clock_timestamp() where live_id = r.id and state <> 'removed';
    v_n := v_n + 1;
  end loop;
  update public.live_participants set state = 'left', left_at = clock_timestamp() where state in ('watching', 'requested', 'invited') and last_seen_at < clock_timestamp() - interval '3 minutes';
  update public.live_battles set status = 'finished', finished_at = clock_timestamp(), winner_id = case when host_score > opponent_score then host_id when opponent_score > host_score then opponent_id else null end where status = 'active' and ends_at < clock_timestamp();
  return v_n;
end $$;

-- ----------------------------------------------------------------------------
-- Privileges, RLS, realtime
-- ----------------------------------------------------------------------------
do $do$
declare f text;
begin
  foreach f in array array[
    'public.can_view_live(uuid, uuid)', 'public.is_live_host(uuid, uuid)', 'public.is_live_moderator(uuid, uuid)', 'public.fan_level_for(bigint)', 'public.fan_badge(uuid, uuid)',
    'public.live_json(public.live_sessions, uuid)', 'public.live_comment_json(public.live_comments)',
    'public.create_live(text, text, text, public.post_audience, timestamptz, boolean, boolean, public.audience_type)',
    'public.update_live(uuid, text, text, text, boolean, boolean, public.audience_type, integer, timestamptz)', 'public.start_live(uuid)', 'public.end_live(uuid)',
    'public.join_live(uuid)', 'public.leave_live(uuid)', 'public.live_heartbeat(uuid)', 'public.send_live_comment(uuid, text)', 'public.pin_live_comment(uuid, boolean)', 'public.delete_live_comment(uuid)',
    'public.like_live(uuid, integer)', 'public.request_live_stage(uuid)', 'public.cancel_live_stage_request(uuid)', 'public.invite_live_guest(uuid, uuid)', 'public.approve_live_guest(uuid, uuid, boolean)',
    'public.accept_live_invite(uuid)', 'public.set_live_guest_media(uuid, uuid, boolean, boolean)', 'public.remove_live_guest(uuid, uuid)', 'public.set_live_cohost(uuid, uuid, boolean)',
    'public.set_live_moderator(uuid, uuid, boolean, boolean)', 'public.mute_live_user(uuid, uuid, integer)', 'public.ban_live_user(uuid, uuid, boolean)',
    'public.start_live_battle(uuid, uuid, integer)', 'public.end_live_battle(uuid)', 'public.join_fan_club(uuid)', 'public.leave_fan_club(uuid)', 'public.get_fan_club(uuid)',
    'public.send_live_gift(uuid, integer, integer, uuid, text)', 'public.get_live(uuid)', 'public.get_live_comments(uuid, integer, timestamptz)', 'public.get_live_participants(uuid, text)',
    'public.get_live_discovery(text, integer)', 'public.get_my_lives(integer)', 'public.get_user_lives(uuid, integer)', 'public.get_live_summary(uuid)', 'public.set_live_reminder(uuid, boolean)',
    'public.resolve_gift_target(public.gift_target, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['public.recount_live_viewers(uuid)', 'public.insert_live_system(uuid, text, public.live_comment_kind, jsonb, uuid)', 'public.on_live_gift_apply(uuid)', 'public.receiver_id_matches(uuid, uuid)', 'public.cleanup_lives()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $do$;

alter table public.live_sessions enable row level security;
alter table public.live_participants enable row level security;
alter table public.live_comments enable row level security;
alter table public.live_likes enable row level security;
alter table public.live_mutes enable row level security;
alter table public.live_bans enable row level security;
alter table public.host_moderators enable row level security;
alter table public.live_gift_events enable row level security;
alter table public.live_battles enable row level security;
alter table public.fan_club_members enable row level security;
alter table public.live_reminders enable row level security;

drop policy if exists "live_sessions_select" on public.live_sessions;
create policy "live_sessions_select" on public.live_sessions for select to authenticated using (public.can_view_live(id));
drop policy if exists "live_participants_select" on public.live_participants;
create policy "live_participants_select" on public.live_participants for select to authenticated using (user_id = auth.uid() or public.can_view_live(live_id));
drop policy if exists "live_comments_select" on public.live_comments;
create policy "live_comments_select" on public.live_comments for select to authenticated using (public.can_view_live(live_id));
drop policy if exists "live_likes_select" on public.live_likes;
create policy "live_likes_select" on public.live_likes for select to authenticated using (user_id = auth.uid() or public.is_live_host(live_id));
drop policy if exists "live_mutes_select" on public.live_mutes;
create policy "live_mutes_select" on public.live_mutes for select to authenticated using (user_id = auth.uid() or public.is_live_moderator(live_id));
drop policy if exists "live_bans_select" on public.live_bans;
create policy "live_bans_select" on public.live_bans for select to authenticated using (user_id = auth.uid() or public.is_live_moderator(live_id));
drop policy if exists "host_moderators_select" on public.host_moderators;
create policy "host_moderators_select" on public.host_moderators for select to authenticated using (host_id = auth.uid() or user_id = auth.uid());
drop policy if exists "live_gift_events_select" on public.live_gift_events;
create policy "live_gift_events_select" on public.live_gift_events for select to authenticated using (public.can_view_live(live_id));
drop policy if exists "live_battles_select" on public.live_battles;
create policy "live_battles_select" on public.live_battles for select to authenticated using (public.can_view_live(live_id));
drop policy if exists "fan_club_members_select" on public.fan_club_members;
create policy "fan_club_members_select" on public.fan_club_members for select to authenticated using (fan_id = auth.uid() or creator_id = auth.uid() or public.can_view_profile(creator_id));
drop policy if exists "live_reminders_own" on public.live_reminders;
create policy "live_reminders_own" on public.live_reminders for select to authenticated using (user_id = auth.uid());

do $do$
declare t text;
begin
  foreach t in array array['live_sessions', 'live_participants', 'live_comments', 'live_gift_events', 'live_battles'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $do$;
alter table public.live_sessions replica identity full;
alter table public.live_participants replica identity full;
alter table public.live_battles replica identity full;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('live', 'live', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "live_covers_public_read" on storage.objects;
create policy "live_covers_public_read" on storage.objects for select using (bucket_id = 'live');
drop policy if exists "live_covers_insert_own" on storage.objects;
create policy "live_covers_insert_own" on storage.objects for insert to authenticated with check (bucket_id = 'live' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "live_covers_delete_own" on storage.objects;
create policy "live_covers_delete_own" on storage.objects for delete to authenticated using (bucket_id = 'live' and (storage.foldername(name))[1] = auth.uid()::text);


-- ########## 20261125000008_games.sql ##########

-- ============================================================================
-- Friendzy — Phase 8: social games
-- Game catalogue, rooms with invite codes, participants & seats, authoritative
-- state (written only by the game-engine Edge Function with the service role),
-- move log, results, ratings / leaderboards, room chat, and content banks for
-- Trivia, Would You Rather and Truth or Dare. Answer keys never reach clients.
-- ============================================================================

do $do$ begin
  create type public.game_status as enum ('waiting', 'playing', 'finished', 'cancelled');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.game_participant_state as enum ('invited', 'joined', 'left');
exception when duplicate_object then null; end $do$;

create table if not exists public.games (
  slug         text primary key,
  name         text not null,
  description  text not null,
  emoji        text not null,
  min_players  integer not null,
  max_players  integer not null,
  turn_seconds integer not null default 30,
  is_active    boolean not null default true,
  sort_order   integer not null default 0
);
revoke all on public.games from anon, authenticated;
grant select on public.games to authenticated;
insert into public.games (slug, name, description, emoji, min_players, max_players, turn_seconds, sort_order) values
  ('ludo', 'Ludo', 'Race your four tokens home. Roll a six to start, capture rivals, first to bring everyone home wins.', '🎲', 2, 4, 45, 1),
  ('chess', 'Chess', 'Classic chess with full rules, 60 seconds per move.', '♟️', 2, 2, 60, 2),
  ('trivia', 'Trivia', 'Ten quick questions. Answer fast for bonus points.', '🧠', 2, 8, 15, 3),
  ('would_you_rather', 'Would You Rather', 'Pick a side, then see how your friends voted.', '🤔', 2, 8, 20, 4),
  ('truth_or_dare', 'Truth or Dare', 'Take turns choosing truth or dare. Friends decide if you delivered.', '🔥', 2, 8, 60, 5),
  ('guess_the_song', 'Guess the Song', 'Hear a clip from the Friendzy sound library and name it first.', '🎵', 2, 8, 15, 6)
on conflict (slug) do nothing;

create table if not exists public.game_rooms (
  id                   uuid primary key default gen_random_uuid(),
  game                 text not null references public.games (slug),
  host_id              uuid not null references public.profiles (id) on delete cascade,
  status               public.game_status not null default 'waiting',
  is_private           boolean not null default false,
  invite_code          text unique,
  max_players          integer not null,
  state                jsonb not null default '{}'::jsonb,
  version              integer not null default 0,
  current_turn_user_id uuid references public.profiles (id) on delete set null,
  turn_deadline        timestamptz,
  round                integer not null default 0,
  winner_id            uuid references public.profiles (id) on delete set null,
  rematch_of           uuid references public.game_rooms (id) on delete set null,
  created_at           timestamptz not null default clock_timestamp(),
  started_at           timestamptz,
  finished_at          timestamptz,
  updated_at           timestamptz not null default clock_timestamp()
);
create index if not exists game_rooms_lobby_idx on public.game_rooms (game, status, created_at desc) where not is_private;
create index if not exists game_rooms_host_idx on public.game_rooms (host_id, created_at desc);
revoke all on public.game_rooms from anon, authenticated;
grant select on public.game_rooms to authenticated;

create table if not exists public.game_participants (
  room_id   uuid not null references public.game_rooms (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  seat      integer not null,
  state     public.game_participant_state not null default 'joined',
  score     integer not null default 0,
  is_ready  boolean not null default false,
  joined_at timestamptz not null default clock_timestamp(),
  left_at   timestamptz,
  primary key (room_id, user_id)
);
create unique index if not exists game_participants_seat_idx on public.game_participants (room_id, seat) where state <> 'left';
create index if not exists game_participants_user_idx on public.game_participants (user_id, joined_at desc);
revoke all on public.game_participants from anon, authenticated;
grant select on public.game_participants to authenticated;

create table if not exists public.game_moves (
  id         bigserial primary key,
  room_id    uuid not null references public.game_rooms (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete set null,
  seq        integer not null,
  move       jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (room_id, seq)
);
revoke all on public.game_moves from anon, authenticated;
grant select on public.game_moves to authenticated;

create table if not exists public.game_results (
  room_id      uuid not null references public.game_rooms (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  rank         integer not null,
  score        integer not null default 0,
  rating_delta integer not null default 0,
  created_at   timestamptz not null default clock_timestamp(),
  primary key (room_id, user_id)
);
create index if not exists game_results_user_idx on public.game_results (user_id, created_at desc);
revoke all on public.game_results from anon, authenticated;
grant select on public.game_results to authenticated;

create table if not exists public.game_ratings (
  game         text not null references public.games (slug),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  rating       integer not null default 1000,
  wins         integer not null default 0,
  losses       integer not null default 0,
  draws        integer not null default 0,
  games_played integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (game, user_id)
);
create index if not exists game_ratings_leaderboard_idx on public.game_ratings (game, rating desc);
revoke all on public.game_ratings from anon, authenticated;
grant select on public.game_ratings to authenticated;

create table if not exists public.game_messages (
  id         bigserial primary key,
  room_id    uuid not null references public.game_rooms (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete set null,
  text       text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint game_messages_text_len check (char_length(text) between 1 and 300)
);
create index if not exists game_messages_room_idx on public.game_messages (room_id, id desc);
revoke all on public.game_messages from anon, authenticated;
grant select on public.game_messages to authenticated;

-- Content banks (service-role only: answer keys must never reach clients).
create table if not exists public.trivia_questions (
  id           serial primary key,
  category     text not null,
  difficulty   text not null default 'easy',
  question     text not null,
  options      jsonb not null,
  answer_index integer not null,
  is_active    boolean not null default true,
  constraint trivia_options check (jsonb_array_length(options) = 4 and answer_index between 0 and 3)
);
revoke all on public.trivia_questions from public, anon, authenticated;
grant select on public.trivia_questions to service_role;
create unique index if not exists trivia_questions_question_key on public.trivia_questions (question);

create table if not exists public.party_prompts (
  id        serial primary key,
  game      text not null references public.games (slug),
  kind      text not null,
  text      text not null,
  spice     text not null default 'mild',
  is_active boolean not null default true,
  constraint party_prompts_kind check (kind in ('wyr', 'truth', 'dare'))
);
revoke all on public.party_prompts from public, anon, authenticated;
grant select on public.party_prompts to service_role;
create unique index if not exists party_prompts_unique_key on public.party_prompts (game, kind, text);

insert into public.trivia_questions (category, difficulty, question, options, answer_index) values
  ('Geography', 'easy', 'Which is the largest ocean on Earth?', '["Atlantic", "Indian", "Pacific", "Arctic"]', 2),
  ('Geography', 'easy', 'What is the capital city of Canada?', '["Toronto", "Vancouver", "Ottawa", "Montreal"]', 2),
  ('Geography', 'medium', 'Which river flows through Cairo?', '["Tigris", "Nile", "Niger", "Congo"]', 1),
  ('Geography', 'medium', 'Which country has the most time zones?', '["Russia", "United States", "France", "China"]', 2),
  ('Geography', 'easy', 'Mount Kilimanjaro is located in which country?', '["Kenya", "Tanzania", "Ethiopia", "Uganda"]', 1),
  ('Science', 'easy', 'What gas do plants mainly absorb from the air?', '["Oxygen", "Nitrogen", "Carbon dioxide", "Helium"]', 2),
  ('Science', 'easy', 'How many planets are in our solar system?', '["7", "8", "9", "10"]', 1),
  ('Science', 'medium', 'What is the chemical symbol for gold?', '["Ag", "Gd", "Au", "Go"]', 2),
  ('Science', 'medium', 'Which part of the cell contains genetic material?', '["Ribosome", "Nucleus", "Membrane", "Cytoplasm"]', 1),
  ('Science', 'hard', 'What is the speed of light in a vacuum, approximately?', '["300,000 km/s", "150,000 km/s", "3,000 km/s", "30,000 km/s"]', 0),
  ('Music', 'easy', 'How many strings does a standard guitar have?', '["4", "5", "6", "7"]', 2),
  ('Music', 'medium', 'Which instrument has 88 keys?', '["Organ", "Piano", "Accordion", "Harpsichord"]', 1),
  ('Music', 'medium', 'K-pop originates from which country?', '["Japan", "China", "South Korea", "Thailand"]', 2),
  ('Movies', 'easy', 'Which studio created the character Buzz Lightyear?', '["DreamWorks", "Pixar", "Illumination", "Ghibli"]', 1),
  ('Movies', 'medium', 'In which decade was the first Star Wars film released?', '["1960s", "1970s", "1980s", "1990s"]', 1),
  ('Sports', 'easy', 'How many players are on a soccer team on the field?', '["9", "10", "11", "12"]', 2),
  ('Sports', 'easy', 'In which sport would you perform a slam dunk?', '["Volleyball", "Basketball", "Tennis", "Rugby"]', 1),
  ('Sports', 'medium', 'How often are the Summer Olympic Games held?', '["Every 2 years", "Every 3 years", "Every 4 years", "Every 5 years"]', 2),
  ('History', 'easy', 'Who was the first person to walk on the Moon?', '["Buzz Aldrin", "Yuri Gagarin", "Neil Armstrong", "Michael Collins"]', 2),
  ('History', 'medium', 'The Great Wall is located in which country?', '["Japan", "India", "China", "Mongolia"]', 2),
  ('History', 'medium', 'In which year did the Berlin Wall fall?', '["1985", "1989", "1991", "1995"]', 1),
  ('Technology', 'easy', 'What does "www" stand for in a website address?', '["World Wide Web", "Web World Wide", "Wide World Web", "World Web Wide"]', 0),
  ('Technology', 'medium', 'Which company makes the Android operating system?', '["Apple", "Microsoft", "Google", "Samsung"]', 2),
  ('Technology', 'hard', 'What does CPU stand for?', '["Central Process Unit", "Central Processing Unit", "Computer Personal Unit", "Core Processing Utility"]', 1),
  ('Food', 'easy', 'Sushi originally comes from which country?', '["China", "Thailand", "Japan", "Vietnam"]', 2),
  ('Food', 'easy', 'Which fruit is known for having its seeds on the outside?', '["Kiwi", "Strawberry", "Raspberry", "Fig"]', 1),
  ('Food', 'medium', 'Paella is a traditional dish from which country?', '["Italy", "Portugal", "Spain", "Greece"]', 2),
  ('Animals', 'easy', 'What is the largest animal on Earth?', '["African elephant", "Blue whale", "Giraffe", "Great white shark"]', 1),
  ('Animals', 'easy', 'How many legs does a spider have?', '["6", "8", "10", "12"]', 1),
  ('Animals', 'medium', 'Which bird is known for mimicking human speech?', '["Owl", "Parrot", "Eagle", "Pigeon"]', 1),
  ('Language', 'easy', 'Which language has the most native speakers?', '["English", "Spanish", "Mandarin Chinese", "Hindi"]', 2),
  ('Language', 'medium', 'What does "bonjour" mean in English?', '["Goodbye", "Thank you", "Hello", "Please"]', 2),
  ('Art', 'medium', 'Who painted the Mona Lisa?', '["Michelangelo", "Leonardo da Vinci", "Raphael", "Donatello"]', 1),
  ('Art', 'medium', 'Which artist is famous for cutting off part of his own ear?', '["Pablo Picasso", "Claude Monet", "Vincent van Gogh", "Salvador Dalí"]', 2),
  ('Space', 'easy', 'Which planet is known as the Red Planet?', '["Venus", "Mars", "Jupiter", "Saturn"]', 1),
  ('Space', 'medium', 'What is the name of our galaxy?', '["Andromeda", "Milky Way", "Whirlpool", "Sombrero"]', 1),
  ('Math', 'easy', 'What is 12 multiplied by 12?', '["124", "132", "144", "156"]', 2),
  ('Math', 'medium', 'How many sides does a hexagon have?', '["5", "6", "7", "8"]', 1),
  ('Literature', 'medium', 'Who wrote "Romeo and Juliet"?', '["Charles Dickens", "William Shakespeare", "Jane Austen", "Mark Twain"]', 1),
  ('Literature', 'medium', 'In which school did Harry Potter study?', '["Beauxbatons", "Durmstrang", "Hogwarts", "Ilvermorny"]', 2)
on conflict (question) do nothing;

insert into public.party_prompts (game, kind, text, spice) values
  ('would_you_rather', 'wyr', 'Would you rather be able to fly or be invisible?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather always be 10 minutes late or always 20 minutes early?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather give up music or give up movies for a year?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather travel to the past or to the future?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather live by the beach or in the mountains?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather have unlimited coffee or unlimited pizza?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather speak every language or play every instrument?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather never use social media again or never watch TV again?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather be famous or be the best friend of someone famous?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather explore space or the deep ocean?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather have a rewind button or a pause button for your life?', 'medium'),
  ('would_you_rather', 'wyr', 'Would you rather know how you die or when you die?', 'medium'),
  ('would_you_rather', 'wyr', 'Would you rather lose all your photos or all your messages?', 'medium'),
  ('would_you_rather', 'wyr', 'Would you rather be the funniest or the smartest person in the room?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather work four long days or five short days?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather have a personal chef or a personal driver?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather read minds or see the future one day ahead?', 'medium'),
  ('would_you_rather', 'wyr', 'Would you rather sing everything you say or dance everywhere you go?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather live without a phone or without a laptop?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather have winter all year or summer all year?', 'mild'),
  ('truth_or_dare', 'truth', 'What is the most embarrassing song on your playlist?', 'mild'),
  ('truth_or_dare', 'truth', 'What is a talent nobody here knows you have?', 'mild'),
  ('truth_or_dare', 'truth', 'What was your first impression of the host?', 'mild'),
  ('truth_or_dare', 'truth', 'What is the last thing you searched for online?', 'medium'),
  ('truth_or_dare', 'truth', 'What is your guilty pleasure TV show?', 'mild'),
  ('truth_or_dare', 'truth', 'Who in this group would you call first in an emergency?', 'mild'),
  ('truth_or_dare', 'truth', 'What is the weirdest food combination you secretly love?', 'mild'),
  ('truth_or_dare', 'truth', 'What is the longest you have gone without checking your phone?', 'mild'),
  ('truth_or_dare', 'truth', 'What is one thing on your bucket list you have told nobody?', 'medium'),
  ('truth_or_dare', 'truth', 'What is the most childish thing you still do?', 'mild'),
  ('truth_or_dare', 'dare', 'Send the group a voice note singing the chorus of your favourite song.', 'mild'),
  ('truth_or_dare', 'dare', 'Talk in an accent for the next two rounds.', 'mild'),
  ('truth_or_dare', 'dare', 'Share the last photo in your camera roll (keep it kind!).', 'medium'),
  ('truth_or_dare', 'dare', 'Do your best impression of someone in the room.', 'mild'),
  ('truth_or_dare', 'dare', 'Post a story with the caption chosen by the group.', 'medium'),
  ('truth_or_dare', 'dare', 'Speak only in questions until your next turn.', 'mild'),
  ('truth_or_dare', 'dare', 'Give everyone in the room a sincere compliment.', 'mild'),
  ('truth_or_dare', 'dare', 'Do ten jumping jacks on camera.', 'mild'),
  ('truth_or_dare', 'dare', 'Let the group pick your profile status for the next hour.', 'medium'),
  ('truth_or_dare', 'dare', 'Describe your day in three emojis only.', 'mild')
on conflict (game, kind, text) do nothing;

-- ----------------------------------------------------------------------------
-- Helpers & JSON
-- ----------------------------------------------------------------------------
create or replace function public.is_game_member(p_room uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.game_participants p where p.room_id = p_room and p.user_id = p_user and p.state <> 'left')
$$;

-- Any participation record (invited / joined / left) — used by policies, so it must not read through RLS.
create or replace function public.has_game_seat(p_room uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.game_participants p where p.room_id = p_room and p.user_id = p_user)
$$;

create or replace function public.game_room_visible(p_room uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.game_rooms r where r.id = p_room and (not r.is_private or public.has_game_seat(r.id, p_user))) or public.is_admin()
$$;

create or replace function public.game_invite_code()
returns text language sql volatile as $$
  select upper(substr(replace(replace(encode(extensions.gen_random_bytes(6), 'base64'), '/', 'A'), '+', 'B'), 1, 6))
$$;

create or replace function public.game_room_json(r public.game_rooms, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'game', r.game, 'status', r.status, 'is_private', r.is_private, 'max_players', r.max_players,
    'invite_code', case when public.is_game_member(r.id, p_viewer) then r.invite_code else null end,
    'host', public.profile_card_json(r.host_id), 'is_host', r.host_id = p_viewer,
    'state', coalesce(r.state - 'secret', '{}'::jsonb),
    'version', r.version, 'current_turn_user_id', r.current_turn_user_id, 'turn_deadline', r.turn_deadline, 'round', r.round, 'winner_id', r.winner_id, 'rematch_of', r.rematch_of,
    'created_at', r.created_at, 'started_at', r.started_at, 'finished_at', r.finished_at,
    'game_info', (select jsonb_build_object('name', g.name, 'emoji', g.emoji, 'min_players', g.min_players, 'max_players', g.max_players, 'turn_seconds', g.turn_seconds) from public.games g where g.slug = r.game),
    'participants', coalesce((select jsonb_agg(public.profile_card_json(p.user_id) || jsonb_build_object('seat', p.seat, 'state', p.state, 'score', p.score, 'is_ready', p.is_ready) order by p.seat) from public.game_participants p where p.room_id = r.id), '[]'::jsonb),
    'my_seat', (select p.seat from public.game_participants p where p.room_id = r.id and p.user_id = p_viewer),
    'my_state', (select p.state from public.game_participants p where p.room_id = r.id and p.user_id = p_viewer),
    'results', case when r.status = 'finished' then coalesce((select jsonb_agg(jsonb_build_object('user', public.profile_card_json(x.user_id), 'rank', x.rank, 'score', x.score, 'rating_delta', x.rating_delta) order by x.rank) from public.game_results x where x.room_id = r.id), '[]'::jsonb) else null end,
    'moves_count', (select count(*) from public.game_moves m where m.room_id = r.id)
  )
$$;

-- ----------------------------------------------------------------------------
-- Lobby RPCs (clients)
-- ----------------------------------------------------------------------------
create or replace function public.create_game_room(p_game text, p_is_private boolean default false, p_max_players integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); g public.games; v_id uuid; v_max integer;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into g from public.games where slug = p_game and is_active;
  if not found then raise exception 'GAME_NOT_FOUND' using errcode = 'P0002'; end if;
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

create or replace function public.leave_game_room(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.game_rooms; v_next uuid; v_remaining integer;
begin
  select * into r from public.game_rooms where id = p_room for update;
  if r.id is null then return; end if;
  update public.game_participants set state = 'left', left_at = clock_timestamp(), is_ready = false where room_id = p_room and user_id = auth.uid() and state <> 'left';
  select count(*) into v_remaining from public.game_participants where room_id = p_room and state = 'joined';
  if r.status = 'waiting' then
    if v_remaining = 0 then
      update public.game_rooms set status = 'cancelled', finished_at = clock_timestamp(), updated_at = clock_timestamp() where id = p_room;
    elsif r.host_id = auth.uid() then
      select user_id into v_next from public.game_participants where room_id = p_room and state = 'joined' order by joined_at limit 1;
      update public.game_rooms set host_id = v_next, updated_at = clock_timestamp() where id = p_room;
    end if;
  elsif r.status = 'playing' then
    -- Engine-side forfeit handling happens in the game-engine function; mark the leave as a move request.
    insert into public.game_moves (room_id, user_id, seq, move) values (p_room, auth.uid(), (select coalesce(max(seq), 0) + 1 from public.game_moves where room_id = p_room), jsonb_build_object('type', 'leave'));
    update public.game_rooms set updated_at = clock_timestamp() where id = p_room;
  end if;
end $$;

create or replace function public.invite_to_game(p_room uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.game_rooms; v_seat integer;
begin
  select * into r from public.game_rooms where id = p_room;
  if r.id is null or not public.is_game_member(p_room) then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002'; end if;
  if r.status <> 'waiting' then raise exception 'ROOM_CLOSED' using errcode = 'P0001'; end if;
  if public.is_blocked_either(auth.uid(), p_user) then raise exception 'BLOCKED' using errcode = '42501'; end if;
  select coalesce(min(s), r.max_players - 1) into v_seat from generate_series(0, r.max_players - 1) s where s not in (select seat from public.game_participants where room_id = r.id and state <> 'left');
  insert into public.game_participants (room_id, user_id, seat, state) values (p_room, p_user, v_seat, 'invited')
  on conflict (room_id, user_id) do update set state = case when public.game_participants.state = 'left' then 'invited' else public.game_participants.state end;
  perform public.create_notification(p_user, auth.uid(), 'game_invite', 'game_room', p_room::text, jsonb_build_object('game', r.game, 'code', r.invite_code));
end $$;

create or replace function public.set_game_ready(p_room uuid, p_ready boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.game_participants set is_ready = coalesce(p_ready, true) where room_id = p_room and user_id = auth.uid() and state = 'joined';
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.game_rooms set updated_at = clock_timestamp() where id = p_room;
  return public.game_room_json((select r from public.game_rooms r where r.id = p_room), auth.uid());
end $$;

create or replace function public.get_game_room(p_room uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.game_room_json(r, auth.uid()) from public.game_rooms r
  where r.id = p_room and public.game_room_visible(r.id)
$$;

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
                 'playing_now', (select count(*) from public.game_rooms r where r.game = g.slug and r.status = 'playing')) order by g.sort_order) from public.games g where g.is_active), '[]'::jsonb))
$$;

create or replace function public.get_leaderboard(p_game text, p_limit integer default 20)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'top', coalesce((select jsonb_agg(jsonb_build_object('user', public.profile_card_json(x.user_id), 'rating', x.rating, 'wins', x.wins, 'losses', x.losses, 'draws', x.draws, 'games_played', x.games_played, 'rank', x.rn) order by x.rn)
            from (select r.*, row_number() over (order by r.rating desc, r.wins desc) rn from public.game_ratings r join public.profiles p on p.id = r.user_id where r.game = p_game and p.account_status = 'active') x where x.rn <= greatest(1, least(coalesce(p_limit, 20), 100))), '[]'::jsonb),
    'me', (select jsonb_build_object('rating', x.rating, 'wins', x.wins, 'losses', x.losses, 'draws', x.draws, 'games_played', x.games_played, 'rank', x.rn)
           from (select r.*, row_number() over (order by r.rating desc, r.wins desc) rn from public.game_ratings r where r.game = p_game) x where x.user_id = auth.uid()))
$$;

create or replace function public.get_my_game_history(p_limit integer default 20)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.game_room_json(r, auth.uid()) from public.game_rooms r join public.game_results x on x.room_id = r.id and x.user_id = auth.uid()
  where r.status = 'finished' order by r.finished_at desc limit greatest(1, least(coalesce(p_limit, 20), 100))
$$;

create or replace function public.send_game_message(p_room uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.is_game_member(p_room) then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002'; end if;
  if nullif(trim(coalesce(p_text, '')), '') is null then raise exception 'TEXT_REQUIRED' using errcode = '23514'; end if;
  insert into public.game_messages (room_id, user_id, text) values (p_room, auth.uid(), left(trim(p_text), 300)) returning id into v_id;
  return (select jsonb_build_object('id', m.id, 'user', public.profile_card_json(m.user_id), 'text', m.text, 'created_at', m.created_at) from public.game_messages m where m.id = v_id);
end $$;

create or replace function public.get_game_messages(p_room uuid, p_limit integer default 50)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', m.id, 'user', case when m.user_id is null then null else public.profile_card_json(m.user_id) end, 'text', m.text, 'created_at', m.created_at)
  from public.game_messages m where m.room_id = p_room and public.is_game_member(p_room) order by m.id desc limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

-- ----------------------------------------------------------------------------
-- Engine-side (service role): apply results & ratings atomically
-- ----------------------------------------------------------------------------
create or replace function public.apply_game_results(p_room uuid, p_results jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r public.game_rooms; item jsonb; v_user uuid; v_rank integer; v_score integer; v_delta integer; v_players integer; v_winner uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into r from public.game_rooms where id = p_room for update;
  if r.id is null or r.status = 'finished' then return; end if;
  v_players := jsonb_array_length(p_results);
  for item in select * from jsonb_array_elements(p_results) loop
    v_user := (item->>'user_id')::uuid; v_rank := (item->>'rank')::int; v_score := coalesce((item->>'score')::int, 0);
    v_delta := case when v_players <= 1 then 0 when v_rank = 1 and (item->>'draw')::boolean is distinct from true then 25 when (item->>'draw')::boolean then 0 else -15 end;
    insert into public.game_results (room_id, user_id, rank, score, rating_delta) values (p_room, v_user, v_rank, v_score, v_delta) on conflict (room_id, user_id) do update set rank = excluded.rank, score = excluded.score, rating_delta = excluded.rating_delta;
    insert into public.game_ratings (game, user_id, rating, wins, losses, draws, games_played)
    values (r.game, v_user, 1000 + v_delta, case when v_delta > 0 then 1 else 0 end, case when v_delta < 0 then 1 else 0 end, case when v_delta = 0 and v_players > 1 then 1 else 0 end, 1)
    on conflict (game, user_id) do update set rating = greatest(100, public.game_ratings.rating + v_delta), wins = public.game_ratings.wins + case when v_delta > 0 then 1 else 0 end,
      losses = public.game_ratings.losses + case when v_delta < 0 then 1 else 0 end, draws = public.game_ratings.draws + case when v_delta = 0 and v_players > 1 then 1 else 0 end,
      games_played = public.game_ratings.games_played + 1, updated_at = now();
    update public.game_participants set score = v_score where room_id = p_room and user_id = v_user;
    if v_rank = 1 and (item->>'draw')::boolean is distinct from true then v_winner := v_user; end if;
  end loop;
  update public.game_rooms set status = 'finished', finished_at = clock_timestamp(), winner_id = v_winner, current_turn_user_id = null, turn_deadline = null, updated_at = clock_timestamp() where id = p_room;
end $$;

create or replace function public.create_rematch(p_room uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.game_rooms; v_id uuid; p record; v_seat integer := 0;
begin
  select * into r from public.game_rooms where id = p_room;
  if r.id is null or r.status <> 'finished' or not exists (select 1 from public.game_participants x where x.room_id = p_room and x.user_id = auth.uid()) then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002';
  end if;
  select id into v_id from public.game_rooms where rematch_of = p_room and status in ('waiting', 'playing') limit 1;
  if v_id is not null then return public.join_game_room(v_id); end if;
  insert into public.game_rooms (game, host_id, is_private, invite_code, max_players, rematch_of) values (r.game, auth.uid(), true, public.game_invite_code(), r.max_players, p_room) returning id into v_id;
  insert into public.game_participants (room_id, user_id, seat, state, is_ready) values (v_id, auth.uid(), 0, 'joined', true);
  v_seat := 1;
  for p in select user_id from public.game_participants where room_id = p_room and user_id <> auth.uid() order by seat loop
    insert into public.game_participants (room_id, user_id, seat, state) values (v_id, p.user_id, v_seat, 'invited');
    perform public.create_notification(p.user_id, auth.uid(), 'game_invite', 'game_room', v_id::text, jsonb_build_object('game', r.game, 'rematch', true));
    v_seat := v_seat + 1;
  end loop;
  return public.game_room_json((select x from public.game_rooms x where x.id = v_id), auth.uid());
end $$;

-- ----------------------------------------------------------------------------
-- Privileges, RLS, realtime
-- ----------------------------------------------------------------------------
do $do$
declare f text;
begin
  foreach f in array array[
    'public.is_game_member(uuid, uuid)', 'public.has_game_seat(uuid, uuid)', 'public.game_room_visible(uuid, uuid)', 'public.game_room_json(public.game_rooms, uuid)', 'public.create_game_room(text, boolean, integer)', 'public.join_game_room(uuid, text)',
    'public.leave_game_room(uuid)', 'public.invite_to_game(uuid, uuid)', 'public.set_game_ready(uuid, boolean)', 'public.get_game_room(uuid)', 'public.list_game_rooms(text)',
    'public.get_leaderboard(text, integer)', 'public.get_my_game_history(integer)', 'public.send_game_message(uuid, text)', 'public.get_game_messages(uuid, integer)', 'public.create_rematch(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['public.game_invite_code()', 'public.apply_game_results(uuid, jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $do$;

alter table public.games enable row level security;
alter table public.game_rooms enable row level security;
alter table public.game_participants enable row level security;
alter table public.game_moves enable row level security;
alter table public.game_results enable row level security;
alter table public.game_ratings enable row level security;
alter table public.game_messages enable row level security;
alter table public.trivia_questions enable row level security;
alter table public.party_prompts enable row level security;

drop policy if exists "games_select" on public.games;
create policy "games_select" on public.games for select to authenticated using (is_active);
drop policy if exists "game_rooms_select" on public.game_rooms;
create policy "game_rooms_select" on public.game_rooms for select to authenticated using (not is_private or public.has_game_seat(id) or public.is_admin());
drop policy if exists "game_participants_select" on public.game_participants;
create policy "game_participants_select" on public.game_participants for select to authenticated using (user_id = auth.uid() or public.game_room_visible(room_id));
drop policy if exists "game_moves_select" on public.game_moves;
create policy "game_moves_select" on public.game_moves for select to authenticated using (public.has_game_seat(room_id));
drop policy if exists "game_results_select" on public.game_results;
create policy "game_results_select" on public.game_results for select to authenticated using (true);
drop policy if exists "game_ratings_select" on public.game_ratings;
create policy "game_ratings_select" on public.game_ratings for select to authenticated using (true);
drop policy if exists "game_messages_select" on public.game_messages;
create policy "game_messages_select" on public.game_messages for select to authenticated using (public.is_game_member(room_id));
-- Content banks: no client policies at all (service role bypasses RLS).

do $do$
declare t text;
begin
  foreach t in array array['game_rooms', 'game_participants', 'game_moves', 'game_messages'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $do$;
alter table public.game_rooms replica identity full;
alter table public.game_participants replica identity full;


-- ########## 20261125000009_subscriptions.sql ##########

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


-- ########## 20261125000010_admin.sql ##########

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


-- ########## 20261125000011_livekit_webhooks.sql ##########

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


-- ########## 20261125000012_hardening.sql ##########

-- ============================================================================
-- Friendzy — Phase 12: post-launch hardening (safe to run on the live project)
-- 1) Content banks (trivia questions, party prompts) get unique keys so a repeated
--    seed run can never double the data. Existing duplicates (from an accidental
--    second run of 0008) are removed first, keeping the oldest row.
-- 2) `premium_plans` is readable by signed-out visitors (pricing page), but its RLS
--    policy calls is_admin(), which the anon role could not execute →
--    "permission denied for function is_admin". is_admin() returns false for anon,
--    so granting execute is harmless and fixes the read.
-- ============================================================================

delete from public.trivia_questions t
 using public.trivia_questions d
 where t.question = d.question and t.id > d.id;
create unique index if not exists trivia_questions_question_key on public.trivia_questions (question);

delete from public.party_prompts t
 using public.party_prompts d
 where t.game = d.game and t.kind = d.kind and t.text = d.text and t.id > d.id;
create unique index if not exists party_prompts_unique_key on public.party_prompts (game, kind, text);

grant execute on function public.is_admin() to anon;


-- ########## 20261125000013_discovery.sql ##########

-- ============================================================================
-- Friendzy — Phase 13: worldwide friend discovery & social matching
--
-- Builds on the existing tables (profiles, user_settings, user_private, follows,
-- friend_requests, friendships, blocks, user_interests, user_presence,
-- user_locations, match_history, reports, notifications). Adds:
--   • user_languages (spoken languages) + privacy flags (age, city, languages, activity)
--   • rich discovery cards (discover_card_json) that apply every privacy setting
--   • discover_people(section, …) with 8 sections, paginated
--   • search_people(…) — worldwide search by username / name / country / city /
--     gender / interests / language / online status, with sorting
--   • mutual friends, friends list with search
--   • MEET SOMEONE: two-sided live matching through match_queue (+ fallback
--     suggestions), preferences on user_settings, safeguards, notifications
--   • presence activity ("chatting") behind an opt-in flag
--   • admin_discovery_abuse() for moderation
-- Safety: minors (16–17) and adults never see each other in stranger discovery
-- or search; matching stays adults-only. No precise location is ever exposed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Schema changes
-- ----------------------------------------------------------------------------
create table if not exists public.user_languages (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  code       text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, code),
  constraint user_languages_code check (code ~ '^[a-z]{2,3}$')
);
create index if not exists user_languages_code_idx on public.user_languages (code);
revoke all on public.user_languages from anon, authenticated;
grant select, insert, delete on public.user_languages to authenticated;

create or replace function public.user_languages_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.user_languages where user_id = new.user_id) >= 6 then
    raise exception 'LANGUAGE_LIMIT' using errcode = 'P0001', hint = 'You can add up to 6 languages.';
  end if;
  return new;
end $$;
drop trigger if exists user_languages_before_insert on public.user_languages;
create trigger user_languages_before_insert before insert on public.user_languages for each row execute function public.user_languages_limit();

alter table public.user_settings add column if not exists show_age boolean not null default false;
alter table public.user_settings add column if not exists show_city boolean not null default true;
alter table public.user_settings add column if not exists show_languages boolean not null default true;
alter table public.user_settings add column if not exists show_activity boolean not null default false;
alter table public.user_settings add column if not exists match_countries text[] not null default '{}';
alter table public.user_settings add column if not exists match_languages text[] not null default '{}';
alter table public.user_settings add column if not exists match_genders text[] not null default '{}';
alter table public.user_settings add column if not exists match_shared_interests boolean not null default false;
alter table public.user_settings drop constraint if exists user_settings_match_lists;
alter table public.user_settings add constraint user_settings_match_lists check (
  cardinality(match_countries) <= 30 and cardinality(match_languages) <= 10 and cardinality(match_genders) <= 5
);

alter table public.user_presence add column if not exists activity text;
alter table public.user_presence add column if not exists activity_until timestamptz;
alter table public.user_presence drop constraint if exists user_presence_activity;
alter table public.user_presence add constraint user_presence_activity check (activity is null or activity in ('chatting', 'live', 'gaming'));
create index if not exists user_presence_last_seen_idx on public.user_presence (last_seen_at desc);

alter table public.notification_preferences add column if not exists matches boolean not null default true;

create table if not exists public.match_queue (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  status       text not null default 'searching',
  partner_id   uuid references public.profiles (id) on delete set null,
  match_id     uuid,
  suggested_id uuid references public.profiles (id) on delete set null,
  joined_at    timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  matched_at   timestamptz,
  constraint match_queue_status check (status in ('searching', 'matched'))
);
create index if not exists match_queue_searching_idx on public.match_queue (status, last_seen_at desc);
revoke all on public.match_queue from anon, authenticated;
grant select on public.match_queue to authenticated;

create table if not exists public.matches (
  id         uuid primary key default gen_random_uuid(),
  user_a     uuid not null references public.profiles (id) on delete cascade,
  user_b     uuid not null references public.profiles (id) on delete cascade,
  kind       text not null default 'live',
  created_at timestamptz not null default clock_timestamp(),
  constraint matches_kind check (kind in ('live', 'suggested')),
  constraint matches_distinct check (user_a <> user_b)
);
create index if not exists matches_user_a_idx on public.matches (user_a, created_at desc);
create index if not exists matches_user_b_idx on public.matches (user_b, created_at desc);
revoke all on public.matches from anon, authenticated;
grant select on public.matches to authenticated;

create index if not exists friend_requests_sender_created_idx on public.friend_requests (sender_id, created_at desc);
create index if not exists match_history_candidate_idx on public.match_history (candidate_id, action, created_at desc);

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------
create or replace function public.friend_ids_of(p_user uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select case when f.user_a = p_user then f.user_b else f.user_a end from public.friendships f where f.user_a = p_user or f.user_b = p_user
$$;

create or replace function public.can_see_friends_of(p_owner uuid, p_viewer uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_owner = p_viewer or public.is_admin() then true
    else public.can_interact(p_owner, p_viewer, coalesce((select s.who_can_see_friends from public.user_settings s where s.user_id = p_owner), 'everyone'))
  end
$$;

create or replace function public.mutual_friends_count(p_a uuid, p_b uuid)
returns integer language sql stable security definer set search_path = public as $$
  select case when p_a is null or p_b is null or p_a = p_b or not public.can_see_friends_of(p_b, p_a) then 0
         else (select count(*)::int from (select public.friend_ids_of(p_a) intersect select public.friend_ids_of(p_b)) m) end
$$;

-- Internal adult check (is_adult() only answers for the caller; this one is never granted to clients).
create or replace function public.adult_internal(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.user_age(p_user) >= 18, false)
$$;
revoke all on function public.adult_internal(uuid) from public, anon, authenticated;

-- Stranger discovery never mixes minors (16–17) with adults.
create or replace function public.discovery_same_bracket(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.user_age(p_a) >= 18, true) = coalesce(public.user_age(p_b) >= 18, true)
$$;

create or replace function public.discovery_eligible(p_viewer uuid, p_target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_viewer is not null and p_target is not null and p_viewer <> p_target
     and exists (select 1 from public.profiles p where p.id = p_target and p.account_status = 'active' and p.discoverable and p.onboarding_completed)
     and not public.is_blocked_either(p_viewer, p_target)
     and public.discovery_same_bracket(p_viewer, p_target)
$$;

create or replace function public.shared_interest_count(p_a uuid, p_b uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.user_interests a join public.user_interests b on a.interest_id = b.interest_id where a.user_id = p_a and b.user_id = p_b
$$;

create or replace function public.shared_language_count(p_a uuid, p_b uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.user_languages a join public.user_languages b on a.code = b.code where a.user_id = p_a and b.user_id = p_b
$$;

create or replace function public.presence_json(p_user uuid, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'is_online', case when p_user = p_viewer or s.show_online_status then (pr.is_online and pr.last_seen_at > now() - interval '3 minutes') else null end,
    'last_seen_at', case when p_user = p_viewer or s.show_last_seen then pr.last_seen_at else null end,
    'activity', case when (p_user = p_viewer or (s.show_online_status and s.show_activity)) and pr.is_online and pr.activity_until > now() then pr.activity else null end)
  from public.user_settings s left join public.user_presence pr on pr.user_id = s.user_id
  where s.user_id = p_user
$$;

create or replace function public.relationship_json(p_viewer uuid, p_target uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'is_following', public.is_following(p_viewer, p_target),
    'is_followed_by', public.is_following(p_target, p_viewer),
    'follow_requested', exists (select 1 from public.follow_requests r where r.requester_id = p_viewer and r.target_id = p_target and r.status = 'pending'),
    'is_friend', public.are_friends(p_viewer, p_target),
    'is_blocking', exists (select 1 from public.blocks b where b.blocker_id = p_viewer and b.blocked_id = p_target),
    'friend_request', (select jsonb_build_object('id', fr.id, 'direction', case when fr.sender_id = p_viewer then 'outgoing' else 'incoming' end, 'created_at', fr.created_at)
                       from public.friend_requests fr where fr.status = 'pending' and ((fr.sender_id = p_viewer and fr.receiver_id = p_target) or (fr.sender_id = p_target and fr.receiver_id = p_viewer))
                       order by fr.created_at desc limit 1))
$$;

-- The discovery card: everything a profile tile shows, filtered by the owner's privacy settings.
create or replace function public.discover_card_json(p_user uuid, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.profile_card_json(p.id) || jsonb_build_object(
    'bio', p.bio,
    'country_code', case when s.show_country then p.country_code end,
    'city', case when s.show_country and s.show_city then p.city end,
    'age', case when s.show_age and public.adult_internal(p.id) then public.user_age(p.id) end,
    'gender', case when s.show_gender then up.gender::text end,
    'followers_count', p.followers_count,
    'friends_count', p.friends_count,
    'joined_at', p.created_at,
    'interests', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'emoji', i.emoji, 'shared', m.user_id is not null) order by (m.user_id is not null) desc, i.sort_order)
                           from (select ui.interest_id from public.user_interests ui where ui.user_id = p.id) x
                           join public.interests i on i.id = x.interest_id
                           left join public.user_interests m on m.user_id = p_viewer and m.interest_id = i.id), '[]'::jsonb),
    'shared_interests', public.shared_interest_count(p_viewer, p.id),
    'languages', case when s.show_languages then coalesce((select jsonb_agg(l.code order by l.created_at) from public.user_languages l where l.user_id = p.id), '[]'::jsonb) else '[]'::jsonb end,
    'shared_languages', case when s.show_languages then public.shared_language_count(p_viewer, p.id) else 0 end,
    'presence', public.presence_json(p.id, p_viewer),
    'mutual_friends', public.mutual_friends_count(p_viewer, p.id),
    'looking_for', coalesce(to_jsonb(s.looking_for), '[]'::jsonb),
    'relationship', public.relationship_json(p_viewer, p.id))
  from public.profiles p
  join public.user_settings s on s.user_id = p.id
  left join public.user_private up on up.user_id = p.id
  where p.id = p_user
$$;

-- One card for a profile page (languages, age, mutual friends, presence, relationship).
create or replace function public.get_discover_card(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.can_view_profile(p_user) then public.discover_card_json(p_user, auth.uid()) end
$$;

-- ----------------------------------------------------------------------------
-- Discover sections (paginated). Sections: recommended · online · nearby · new ·
-- popular · interests · countries · active
-- ----------------------------------------------------------------------------
create or replace function public.discover_people(p_section text default 'recommended', p_limit integer default 20, p_offset integer default 0, p_radius_km numeric default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := auth.uid(); v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50)); v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_country text; v_lat numeric; v_lng numeric; v_nearby boolean := false; v_result jsonb;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_section not in ('recommended', 'online', 'nearby', 'new', 'popular', 'interests', 'countries', 'active') then
    raise exception 'INVALID_SECTION' using errcode = '23514';
  end if;
  select country_code into v_country from public.profiles where id = v_me;
  select ul.lat, ul.lng, us.nearby_enabled into v_lat, v_lng, v_nearby
    from public.user_settings us left join public.user_locations ul on ul.user_id = us.user_id where us.user_id = v_me;
  if p_section = 'nearby' and (not coalesce(v_nearby, false) or v_lat is null) then return '[]'::jsonb; end if;

  with candidates as (
    select p.id, p.country_code, p.created_at, p.popularity_score,
           public.shared_interest_count(v_me, p.id) as shared,
           public.shared_language_count(v_me, p.id) as shared_lang,
           public.mutual_friends_count(v_me, p.id) as mutual,
           (s.show_online_status and coalesce(pr.is_online, false) and pr.last_seen_at > now() - interval '3 minutes') as online,
           case when s.show_online_status or s.show_last_seen then pr.last_seen_at end as seen,
           case when p_section = 'nearby' and s.nearby_enabled and ul.user_id is not null and ul.updated_at > now() - interval '30 days'
                 then greatest(1, round(public.haversine_km(v_lat, v_lng, ul.lat, ul.lng))) end as distance_km,
           public.is_following(v_me, p.id) as following,
           public.are_friends(v_me, p.id) as friend
    from public.profiles p
    join public.user_settings s on s.user_id = p.id
    left join public.user_presence pr on pr.user_id = p.id
    left join public.user_locations ul on ul.user_id = p.id
    where public.discovery_eligible(v_me, p.id)
  ), scored as (
    select c.*,
           (c.shared * 3 + c.shared_lang * 2 + least(c.mutual, 5) * 2 + case when c.country_code is not null and c.country_code = v_country then 2 else 0 end
            + case when c.online then 1 else 0 end + least(c.popularity_score / 50, 2)) as score,
           row_number() over (partition by c.country_code order by c.popularity_score desc, c.created_at desc) as country_rank
    from candidates c
  ), filtered as (
    select * from scored x
    where case p_section
      when 'recommended' then not x.friend and not x.following
      when 'online' then x.online
      when 'nearby' then x.distance_km is not null and x.distance_km <= greatest(1, least(coalesce(p_radius_km, 50), 500))
      when 'new' then x.created_at > now() - interval '30 days'
      when 'popular' then true
      when 'interests' then x.shared > 0 and not x.friend
      when 'countries' then x.country_code is not null and (v_country is null or x.country_code <> v_country)
      when 'active' then x.seen is not null and x.seen > now() - interval '24 hours'
      else false end
    order by
      case when p_section = 'countries' then x.country_rank when p_section = 'interests' then -x.shared else 0 end,
      case p_section
        when 'new' then extract(epoch from x.created_at)
        when 'active' then extract(epoch from x.seen)
        when 'popular' then x.popularity_score
        when 'online' then x.shared * 10 + x.popularity_score
        when 'interests' then x.shared_lang * 10 + x.popularity_score
        when 'nearby' then -x.distance_km
        else x.score end desc,
      x.popularity_score desc, x.created_at desc, x.id
    limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(public.discover_card_json(f.id, v_me) || jsonb_build_object('score', f.score, 'distance_km', f.distance_km) order by f.ord), '[]'::jsonb)
    into v_result
  from (select *, row_number() over () as ord from filtered) f;
  return v_result;
end $$;

-- ----------------------------------------------------------------------------
-- Worldwide people search (filters available to everyone; age range is a Premium perk)
-- ----------------------------------------------------------------------------
create or replace function public.search_people(
  p_query text default '', p_country text default null, p_city text default null, p_gender text default null,
  p_interest_ids integer[] default null, p_languages text[] default null, p_online_only boolean default false,
  p_min_age integer default null, p_max_age integer default null, p_sort text default 'relevance',
  p_limit integer default 20, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_q text := lower(trim(coalesce(p_query, ''))); v_result jsonb;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if (p_min_age is not null or p_max_age is not null) and not public.is_premium(v_me) then
    raise exception 'PREMIUM_REQUIRED' using errcode = '42501', hint = 'Filtering by age range is a Premium perk.';
  end if;
  if p_min_age is not null and p_min_age < 16 then p_min_age := 16; end if;
  if p_sort not in ('relevance', 'newest', 'popular', 'active', 'name') then p_sort := 'relevance'; end if;

  with base as (
    select p.id, p.created_at, p.popularity_score, p.display_name,
           case when v_q = '' then 0 when p.username = v_q then 0 when p.username like v_q || '%' then 1 when lower(p.display_name) like v_q || '%' then 2 else 3 end as rank,
           public.shared_interest_count(v_me, p.id) as shared,
           case when s.show_online_status or s.show_last_seen then pr.last_seen_at end as seen
    from public.profiles p
    join public.user_settings s on s.user_id = p.id
    left join public.user_private up on up.user_id = p.id
    left join public.user_presence pr on pr.user_id = p.id
    where public.discovery_eligible(v_me, p.id)
      and (v_q = '' or p.username ilike '%' || v_q || '%' or p.display_name ilike '%' || v_q || '%')
      and (p_country is null or (s.show_country and p.country_code = upper(p_country)))
      and (nullif(trim(coalesce(p_city, '')), '') is null or (s.show_country and s.show_city and p.city ilike '%' || trim(p_city) || '%'))
      and (p_gender is null or (s.show_gender and up.gender::text = p_gender))
      and (p_interest_ids is null or cardinality(p_interest_ids) = 0 or exists (select 1 from public.user_interests ui where ui.user_id = p.id and ui.interest_id = any (p_interest_ids)))
      and (p_languages is null or cardinality(p_languages) = 0 or (s.show_languages and exists (select 1 from public.user_languages l where l.user_id = p.id and l.code = any (p_languages))))
      and (not coalesce(p_online_only, false) or (s.show_online_status and coalesce(pr.is_online, false) and pr.last_seen_at > now() - interval '3 minutes'))
      and (p_min_age is null or (up.birth_date is not null and public.user_age(p.id) >= p_min_age))
      and (p_max_age is null or (up.birth_date is not null and public.user_age(p.id) <= p_max_age))
  ), hits as (
    select b.* from base b
    order by
      case when p_sort = 'relevance' then b.rank else 0 end,
      case p_sort
        when 'relevance' then b.shared * 10 + b.popularity_score
        when 'newest' then extract(epoch from b.created_at)
        when 'popular' then b.popularity_score
        when 'active' then coalesce(extract(epoch from b.seen), 0)
        else 0 end desc,
      case when p_sort = 'name' then lower(b.display_name) end asc,
      b.popularity_score desc, b.created_at desc, b.id
    limit greatest(1, least(coalesce(p_limit, 20), 50)) offset greatest(0, coalesce(p_offset, 0))
  )
  select coalesce(jsonb_agg(public.discover_card_json(h.id, v_me) order by h.ord), '[]'::jsonb) into v_result
  from (select *, row_number() over () as ord from hits) h;
  return v_result;
end $$;

-- Thin wrapper so earlier clients keep working with the new gating (only age is Premium).
create or replace function public.search_profiles_advanced(
  p_query text default '', p_country text default null, p_min_age integer default null, p_max_age integer default null, p_gender text default null,
  p_online_only boolean default false, p_verified_only boolean default false, p_interest_ids integer[] default null, p_limit integer default 20, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  v := public.search_people(p_query, p_country, null, p_gender, p_interest_ids, null, p_online_only, p_min_age, p_max_age, 'relevance', p_limit, p_offset);
  if coalesce(p_verified_only, false) then
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v from jsonb_array_elements(v) e where (e->>'is_verified')::boolean;
  end if;
  return v;
end $$;

create or replace function public.premium_features()
returns jsonb language sql immutable as $$
  select '[
    {"id": "badge", "icon": "diamond-outline", "title": "Premium badge", "description": "A Premium badge next to your name across Friendzy."},
    {"id": "gifts", "icon": "gift-outline", "title": "Exclusive gifts", "description": "Send premium-only animated gifts in lives, videos and chats."},
    {"id": "viewers", "icon": "eye-outline", "title": "See who viewed your profile", "description": "Full list of recent profile visitors."},
    {"id": "admirers", "icon": "heart-outline", "title": "See who liked you", "description": "Reveal the people who chose you in Meet Someone."},
    {"id": "filters", "icon": "options-outline", "title": "Age-range search", "description": "Filter people by age range in Discover search."},
    {"id": "themes", "icon": "color-palette-outline", "title": "Exclusive themes", "description": "Aurora, Sunset, Ocean, Gold and Midnight accents."},
    {"id": "support", "icon": "sparkles-outline", "title": "Priority support", "description": "Your tickets go to the front of the queue."}
  ]'::jsonb
$$;

-- ----------------------------------------------------------------------------
-- Friends: mutual friends, friends list with search, request lists with cards
-- ----------------------------------------------------------------------------
create or replace function public.get_mutual_friends(p_user uuid, p_limit integer default 20)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.can_see_friends_of(p_user, auth.uid()) then '[]'::jsonb
         else coalesce((select jsonb_agg(public.discover_card_json(m.id, auth.uid()) order by pr.display_name)
                        from (select public.friend_ids_of(auth.uid()) intersect select public.friend_ids_of(p_user)) m(id)
                        join public.profiles pr on pr.id = m.id
                        where pr.account_status = 'active' and not public.is_blocked_either(auth.uid(), m.id)
                        limit greatest(1, least(coalesce(p_limit, 20), 100))), '[]'::jsonb) end
$$;

create or replace function public.get_friends_list(p_user uuid default null, p_query text default '', p_limit integer default 30, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_target uuid := coalesce(p_user, auth.uid()); v_q text := lower(trim(coalesce(p_query, ''))); v_result jsonb;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not public.can_see_friends_of(v_target, v_me) then return '[]'::jsonb; end if;
  with friends as (
    select f.id, pr.display_name, pr.username, pr.popularity_score,
           (s.show_online_status and coalesce(ps.is_online, false) and ps.last_seen_at > now() - interval '3 minutes') as online
    from (select public.friend_ids_of(v_target)) f(id)
    join public.profiles pr on pr.id = f.id
    join public.user_settings s on s.user_id = f.id
    left join public.user_presence ps on ps.user_id = f.id
    where pr.account_status = 'active' and not public.is_blocked_either(v_me, f.id)
      and (v_q = '' or pr.username ilike '%' || v_q || '%' or pr.display_name ilike '%' || v_q || '%')
    order by online desc, lower(pr.display_name)
    limit greatest(1, least(coalesce(p_limit, 30), 100)) offset greatest(0, coalesce(p_offset, 0))
  )
  select coalesce(jsonb_agg(public.discover_card_json(f.id, v_me) order by f.ord), '[]'::jsonb) into v_result
  from (select *, row_number() over () as ord from friends) f;
  return v_result;
end $$;

create or replace function public.get_friend_requests(p_direction text default 'incoming', p_limit integer default 50)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', fr.id, 'message', fr.message, 'created_at', fr.created_at,
           'user', public.discover_card_json(case when p_direction = 'outgoing' then fr.receiver_id else fr.sender_id end, auth.uid())) order by fr.created_at desc), '[]'::jsonb)
  from (select * from public.friend_requests r
        where r.status = 'pending'
          and ((p_direction = 'outgoing' and r.sender_id = auth.uid()) or (coalesce(p_direction, 'incoming') <> 'outgoing' and r.receiver_id = auth.uid()))
        order by r.created_at desc limit greatest(1, least(coalesce(p_limit, 50), 200))) fr
$$;

-- ----------------------------------------------------------------------------
-- Presence with activity ("chatting") — visible only when the owner opts in
-- ----------------------------------------------------------------------------
drop function if exists public.touch_presence(boolean);
create or replace function public.touch_presence(p_online boolean default true, p_activity text default null, p_set_activity boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if p_activity is not null and p_activity not in ('chatting', 'live', 'gaming') then p_activity := null; end if;
  insert into public.user_presence (user_id, is_online, last_seen_at, updated_at, activity, activity_until)
  values (auth.uid(), coalesce(p_online, true), now(), now(), case when p_set_activity then p_activity end, case when p_set_activity and p_activity is not null then now() + interval '3 minutes' end)
  on conflict (user_id) do update set
    is_online = excluded.is_online, last_seen_at = now(), updated_at = now(),
    activity = case when p_set_activity then p_activity when coalesce(p_online, true) then public.user_presence.activity else null end,
    activity_until = case when p_set_activity then (case when p_activity is null then null else now() + interval '3 minutes' end) when coalesce(p_online, true) then public.user_presence.activity_until else null end;
end $$;

drop function if exists public.get_presence(uuid[]);
create or replace function public.get_presence(p_user_ids uuid[])
returns table (user_id uuid, is_online boolean, last_seen_at timestamptz, activity text)
language sql stable security definer set search_path = public as $$
  select p.user_id,
         case when p.user_id = auth.uid() or s.show_online_status then (p.is_online and p.last_seen_at > now() - interval '3 minutes') else null end,
         case when p.user_id = auth.uid() or s.show_last_seen then p.last_seen_at else null end,
         case when (p.user_id = auth.uid() or (s.show_online_status and s.show_activity)) and p.is_online and p.activity_until > now() then p.activity else null end
  from public.user_presence p
  join public.user_settings s on s.user_id = p.user_id
  where auth.uid() is not null
    and p.user_id = any (p_user_ids)
    and not public.is_blocked_either(auth.uid(), p.user_id)
$$;

-- ----------------------------------------------------------------------------
-- Notifications: matches honour the new "matches" preference
-- ----------------------------------------------------------------------------
create or replace function public.create_notification(
  p_user uuid, p_actor uuid, p_type text,
  p_entity_type text default null, p_entity_id text default null, p_data jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_allowed boolean := true;
begin
  if p_user is null or p_user = p_actor then return null; end if;
  if public.is_blocked_either(p_user, p_actor) then return null; end if;
  select case
      when p_type in ('new_follower', 'follow_request', 'follow_request_accepted') then np.new_followers
      when p_type in ('friend_request', 'friend_request_accepted') then np.friend_requests
      when p_type in ('post_like', 'comment_like', 'video_like', 'story_reaction') then np.likes
      when p_type in ('post_comment', 'comment_reply', 'video_comment') then np.comments
      when p_type = 'mention' then np.mentions
      when p_type in ('post_repost', 'video_repost') then np.reposts
      when p_type in ('message', 'message_request', 'group_invite') then np.messages
      when p_type in ('missed_call', 'incoming_call') then np.calls
      when p_type in ('live_started', 'live_scheduled', 'live_guest_invite') then np.live
      when p_type in ('gift_received') then np.gifts
      when p_type in ('subscription_update') then np.subscription
      when p_type in ('match_found') then np.matches
      else true end
    into v_allowed
  from public.notification_preferences np where np.user_id = p_user;
  if coalesce(v_allowed, true) = false then return null; end if;
  insert into public.notifications (user_id, actor_id, type, entity_type, entity_id, data)
  values (p_user, p_actor, p_type, p_entity_type, p_entity_id, coalesce(p_data, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

-- ----------------------------------------------------------------------------
-- MEET SOMEONE — two-sided live matching with fallback suggestions
-- ----------------------------------------------------------------------------
create or replace function public.match_gate(p_user uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_user is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not coalesce(public.is_adult(p_user), false) then
    raise exception 'ADULTS_ONLY' using errcode = '42501', hint = 'Meet Someone is available from age 18.';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and account_status = 'active') then
    raise exception 'ACCOUNT_RESTRICTED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.user_settings where user_id = p_user and random_match_enabled) then
    raise exception 'MATCHING_DISABLED' using errcode = '42501', hint = 'Turn on Meet Someone in Settings → Privacy.';
  end if;
  if public.is_feature_restricted(p_user, 'message') then
    raise exception 'FEATURE_RESTRICTED' using errcode = '42501', hint = 'Matching is paused while your messaging is restricted.';
  end if;
end $$;

-- Does p_viewer's preference set accept p_other? (one direction)
create or replace function public.match_prefs_accept(p_viewer uuid, p_other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    (cardinality(vs.match_countries) = 0 or (os.show_country and op.country_code = any (vs.match_countries)))
    and (cardinality(vs.match_languages) = 0 or (os.show_languages and exists (select 1 from public.user_languages l where l.user_id = p_other and l.code = any (vs.match_languages))))
    and (cardinality(vs.match_genders) = 0 or (os.show_gender and opr.gender::text = any (vs.match_genders)))
    and (vs.preferred_min_age is null or public.user_age(p_other) >= vs.preferred_min_age)
    and (vs.preferred_max_age is null or public.user_age(p_other) <= vs.preferred_max_age)
    and (not vs.match_shared_interests or public.shared_interest_count(p_viewer, p_other) > 0)
  from public.user_settings vs
  join public.profiles op on op.id = p_other
  join public.user_settings os on os.user_id = p_other
  left join public.user_private opr on opr.user_id = p_other
  where vs.user_id = p_viewer
$$;

-- Full two-sided compatibility + safeguards.
create or replace function public.match_compatible(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_a <> p_b
     and public.discovery_eligible(p_a, p_b)
     and public.adult_internal(p_a) and public.adult_internal(p_b)
     and exists (select 1 from public.user_settings s where s.user_id = p_b and s.random_match_enabled)
     and not public.are_friends(p_a, p_b)
     and not exists (select 1 from public.friend_requests fr where fr.status = 'pending' and ((fr.sender_id = p_a and fr.receiver_id = p_b) or (fr.sender_id = p_b and fr.receiver_id = p_a)))
     -- skipped recently (7 days), engaged recently (30 days), or ever reported / blocked through matching — in either direction
     and not exists (select 1 from public.match_history mh
                     where ((mh.user_id = p_a and mh.candidate_id = p_b) or (mh.user_id = p_b and mh.candidate_id = p_a))
                       and (mh.action in ('report', 'block')
                            or (mh.action = 'skip' and mh.created_at > now() - interval '7 days')
                            or (mh.action in ('friend', 'chat') and mh.created_at > now() - interval '30 days')))
     -- accounts under review: 3+ open reports in the last 30 days, or a messaging restriction
     and not exists (select 1 from public.reports r where r.target_type = 'profile' and r.target_id = p_b::text and r.status in ('open', 'in_review') and r.created_at > now() - interval '30 days' having count(*) >= 3)
     and not public.is_feature_restricted(p_b, 'message')
     and public.match_prefs_accept(p_a, p_b)
     and public.match_prefs_accept(p_b, p_a)
$$;

create or replace function public.match_find()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid(); v_row public.match_queue; v_partner public.match_queue; v_partner_row public.match_queue;
  v_match uuid; v_waited integer; v_suggest uuid;
begin
  perform public.match_gate(v_me);

  -- Housekeeping: stale searchers and old matches disappear.
  delete from public.match_queue where (status = 'searching' and last_seen_at < clock_timestamp() - interval '2 minutes')
                                   or (status = 'matched' and matched_at < clock_timestamp() - interval '15 minutes');

  insert into public.match_queue (user_id) values (v_me)
  on conflict (user_id) do update set last_seen_at = clock_timestamp()
  returning * into v_row;

  -- Already matched during an earlier poll: hand the partner back while they are still around.
  if v_row.status = 'matched' and v_row.partner_id is not null then
    select * into v_partner_row from public.match_queue where user_id = v_row.partner_id;
    if v_partner_row.user_id is not null and v_partner_row.status = 'matched' and v_partner_row.partner_id = v_me then
      return jsonb_build_object('status', 'matched', 'live', true, 'match_id', v_row.match_id, 'candidate', public.discover_card_json(v_row.partner_id, v_me));
    end if;
    -- Partner left before we acted: keep searching.
    update public.match_queue set status = 'searching', partner_id = null, match_id = null, matched_at = null, joined_at = clock_timestamp() where user_id = v_me returning * into v_row;
  end if;

  -- Someone else who is searching right now and compatible both ways (locked so two searchers cannot both grab them).
  select q.* into v_partner
  from public.match_queue q
  where q.user_id <> v_me and q.status = 'searching' and q.last_seen_at > clock_timestamp() - interval '45 seconds'
    and public.match_compatible(v_me, q.user_id)
  order by public.shared_interest_count(v_me, q.user_id) desc, q.joined_at asc
  limit 1
  for update of q skip locked;

  if v_partner.user_id is not null then
    insert into public.matches (user_a, user_b, kind) values (least(v_me, v_partner.user_id), greatest(v_me, v_partner.user_id), 'live') returning id into v_match;
    update public.match_queue set status = 'matched', partner_id = v_partner.user_id, match_id = v_match, matched_at = clock_timestamp(), suggested_id = null where user_id = v_me;
    update public.match_queue set status = 'matched', partner_id = v_me, match_id = v_match, matched_at = clock_timestamp(), suggested_id = null where user_id = v_partner.user_id;
    perform public.create_notification(v_partner.user_id, v_me, 'match_found', 'match', v_match::text, jsonb_build_object('live', true));
    return jsonb_build_object('status', 'matched', 'live', true, 'match_id', v_match, 'candidate', public.discover_card_json(v_partner.user_id, v_me));
  end if;

  v_waited := greatest(0, extract(epoch from (clock_timestamp() - v_row.joined_at))::int);

  -- Nobody live after ~10 s: suggest a compatible member who was recently active (kept stable until the user acts).
  if v_waited >= 10 then
    v_suggest := v_row.suggested_id;
    if v_suggest is not null and not public.match_compatible(v_me, v_suggest) then v_suggest := null; end if;
    if v_suggest is null then
      select p.id into v_suggest
      from public.profiles p
      join public.user_settings s on s.user_id = p.id
      left join public.user_presence pr on pr.user_id = p.id
      where p.id <> v_me and s.random_match_enabled and p.account_status = 'active' and p.discoverable
        and not exists (select 1 from public.match_queue q where q.user_id = p.id and q.status = 'matched')
        and public.match_compatible(v_me, p.id)
      order by (coalesce(pr.is_online, false) and pr.last_seen_at > now() - interval '3 minutes') desc,
               public.shared_interest_count(v_me, p.id) desc,
               coalesce(pr.last_seen_at, p.created_at) desc,
               random()
      limit 1;
      if v_suggest is not null then update public.match_queue set suggested_id = v_suggest where user_id = v_me; end if;
    end if;
    if v_suggest is not null then
      return jsonb_build_object('status', 'suggested', 'live', false, 'match_id', null, 'candidate', public.discover_card_json(v_suggest, v_me), 'waited_seconds', v_waited);
    end if;
    return jsonb_build_object('status', 'empty', 'live', false, 'waited_seconds', v_waited);
  end if;

  return jsonb_build_object('status', 'searching', 'waited_seconds', v_waited, 'searching_now', (select count(*) from public.match_queue q where q.status = 'searching' and q.user_id <> v_me and q.last_seen_at > clock_timestamp() - interval '45 seconds'));
end $$;

create or replace function public.match_leave()
returns void language sql security definer set search_path = public as $$
  delete from public.match_queue where user_id = auth.uid()
$$;

-- Skip / friend / chat / report / block on the shown person. Clears the queue so the next search starts fresh.
create or replace function public.match_action(p_candidate uuid, p_action public.match_action)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_request uuid; v_conversation uuid; v_match uuid;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_candidate = v_me then raise exception 'INVALID_CANDIDATE' using errcode = '23514'; end if;
  select match_id into v_match from public.match_queue where user_id = v_me and partner_id = p_candidate;
  insert into public.match_history (user_id, candidate_id, action) values (v_me, p_candidate, p_action)
  on conflict (user_id, candidate_id) do update set action = excluded.action, created_at = now();
  delete from public.match_queue where user_id = v_me;
  if p_action = 'friend' then
    v_request := public.send_friend_request(p_candidate, 'We matched on Friendzy 👋');
    return jsonb_build_object('friend_request_id', v_request, 'match_id', v_match);
  elsif p_action = 'chat' then
    v_conversation := public.start_direct_conversation(p_candidate);
    return jsonb_build_object('conversation_id', v_conversation, 'match_id', v_match);
  elsif p_action = 'block' then
    perform public.block_user(p_candidate);
  end if;
  return jsonb_build_object('match_id', v_match);
end $$;

-- Backwards compatibility: the old one-shot candidate picker now honours the same rules.
create or replace function public.get_match_candidate()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid;
begin
  perform public.match_gate(v_me);
  select p.id into v_id from public.profiles p join public.user_settings s on s.user_id = p.id
  where p.id <> v_me and s.random_match_enabled and public.match_compatible(v_me, p.id)
  order by public.shared_interest_count(v_me, p.id) desc, random() limit 1;
  if v_id is null then return null; end if;
  return jsonb_build_object('profile', public.discover_card_json(v_id, v_me), 'shared_interests', public.shared_interest_count(v_me, v_id),
                            'interests', (public.discover_card_json(v_id, v_me))->'interests', 'looking_for', (public.discover_card_json(v_id, v_me))->'looking_for');
end $$;

-- ----------------------------------------------------------------------------
-- Admin: friend-request & matching abuse signals
-- ----------------------------------------------------------------------------
create or replace function public.admin_discovery_abuse(p_hours integer default 24)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_since timestamptz := now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 720)));
begin
  perform public.admin_require();
  return jsonb_build_object(
    'since', v_since,
    'stats', jsonb_build_object(
      'searching_now', (select count(*) from public.match_queue where status = 'searching' and last_seen_at > now() - interval '45 seconds'),
      'live_matches', (select count(*) from public.matches where created_at > v_since),
      'match_actions', (select coalesce(jsonb_object_agg(action, n), '{}'::jsonb) from (select action::text, count(*) n from public.match_history where created_at > v_since group by action) a),
      'friend_requests', (select count(*) from public.friend_requests where created_at > v_since),
      'friend_requests_declined', (select count(*) from public.friend_requests where responded_at > v_since and status = 'declined'),
      'blocks', (select count(*) from public.blocks where created_at > v_since)),
    'top_requesters', coalesce((select jsonb_agg(public.profile_card_json(t.sender_id) || jsonb_build_object('sent', t.n, 'declined', t.declined) order by t.n desc)
                                from (select sender_id, count(*) n, count(*) filter (where status = 'declined') declined from public.friend_requests where created_at > v_since group by sender_id having count(*) >= 5 order by n desc limit 20) t), '[]'::jsonb),
    'most_blocked', coalesce((select jsonb_agg(public.profile_card_json(t.blocked_id) || jsonb_build_object('blocks', t.n) order by t.n desc)
                              from (select blocked_id, count(*) n from public.blocks where created_at > v_since group by blocked_id having count(*) >= 2 order by n desc limit 20) t), '[]'::jsonb),
    'match_reported', coalesce((select jsonb_agg(public.profile_card_json(t.candidate_id) || jsonb_build_object('reports', t.n) order by t.n desc)
                                from (select candidate_id, count(*) n from public.match_history where action in ('report', 'block') and created_at > v_since group by candidate_id order by n desc limit 20) t), '[]'::jsonb),
    'heavy_skippers', coalesce((select jsonb_agg(public.profile_card_json(t.user_id) || jsonb_build_object('actions', t.n) order by t.n desc)
                                from (select user_id, count(*) n from public.match_history where created_at > v_since group by user_id having count(*) >= 40 order by n desc limit 20) t), '[]'::jsonb));
end $$;

-- ----------------------------------------------------------------------------
-- Privileges, RLS, realtime
-- ----------------------------------------------------------------------------
do $do$
declare f text;
begin
  foreach f in array array[
    'public.friend_ids_of(uuid)', 'public.can_see_friends_of(uuid, uuid)', 'public.mutual_friends_count(uuid, uuid)', 'public.discovery_same_bracket(uuid, uuid)',
    'public.discovery_eligible(uuid, uuid)', 'public.shared_interest_count(uuid, uuid)', 'public.shared_language_count(uuid, uuid)', 'public.presence_json(uuid, uuid)',
    'public.relationship_json(uuid, uuid)', 'public.discover_card_json(uuid, uuid)', 'public.get_discover_card(uuid)', 'public.discover_people(text, integer, integer, numeric)',
    'public.search_people(text, text, text, text, integer[], text[], boolean, integer, integer, text, integer, integer)',
    'public.search_profiles_advanced(text, text, integer, integer, text, boolean, boolean, integer[], integer, integer)', 'public.premium_features()',
    'public.get_mutual_friends(uuid, integer)', 'public.get_friends_list(uuid, text, integer, integer)', 'public.get_friend_requests(text, integer)',
    'public.touch_presence(boolean, text, boolean)', 'public.get_presence(uuid[])',
    'public.match_gate(uuid)', 'public.match_prefs_accept(uuid, uuid)', 'public.match_compatible(uuid, uuid)', 'public.match_find()', 'public.match_leave()',
    'public.match_action(uuid, public.match_action)', 'public.get_match_candidate()', 'public.admin_discovery_abuse(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $do$;

alter table public.user_languages enable row level security;
alter table public.match_queue enable row level security;
alter table public.matches enable row level security;

drop policy if exists "user_languages_select" on public.user_languages;
create policy "user_languages_select" on public.user_languages for select to authenticated
  using (user_id = auth.uid() or (public.can_view_profile(user_id) and exists (select 1 from public.user_settings s where s.user_id = user_languages.user_id and s.show_languages)));
drop policy if exists "user_languages_insert_own" on public.user_languages;
create policy "user_languages_insert_own" on public.user_languages for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "user_languages_delete_own" on public.user_languages;
create policy "user_languages_delete_own" on public.user_languages for delete to authenticated using (user_id = auth.uid());

drop policy if exists "match_queue_select_own" on public.match_queue;
create policy "match_queue_select_own" on public.match_queue for select to authenticated using (user_id = auth.uid());
drop policy if exists "matches_select_participant" on public.matches;
create policy "matches_select_participant" on public.matches for select to authenticated using (user_a = auth.uid() or user_b = auth.uid());

do $do$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_queue') then
    alter publication supabase_realtime add table public.match_queue;
  end if;
end $do$;
alter table public.match_queue replica identity full;


-- ########## 20261125000014_push_webhooks.sql ##########

-- ============================================================================
-- Friendzy — Phase 14: push-notification webhooks (database → push-dispatch)
--
-- Replaces dashboard-created "Database Webhooks": an AFTER INSERT trigger on
-- public.notifications and public.messages posts the new row to the push-dispatch
-- Edge Function through pg_net. The x-webhook-secret header value is read from
-- Supabase Vault (secret name: push_webhook_secret) at call time — it is never
-- stored in a trigger definition and never appears in this repository.
--
-- One-time setup on the live project (SQL editor, done 2026-11-25):
--   create extension if not exists pg_net with schema extensions;
--   select vault.create_secret('<same value as the PUSH_WEBHOOK_SECRET function secret>', 'push_webhook_secret');
-- Without pg_net or the Vault secret (e.g. the local test database) the trigger is
-- a no-op, so inserting notifications and messages can never fail because of push.
-- ============================================================================
create or replace function public.push_dispatch_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_secret text;
  v_url text := 'https://gwdpsrjmfrgcloacvdlg.supabase.co/functions/v1/push-dispatch';
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null or to_regclass('vault.decrypted_secrets') is null then
    return new;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_webhook_secret' order by created_at desc limit 1;
  if v_secret is null then return new; end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('type', tg_op, 'table', tg_table_name, 'schema', tg_table_schema, 'record', to_jsonb(new), 'old_record', null),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    timeout_milliseconds := 5000);
  return new;
exception when others then
  raise warning 'push_dispatch_webhook: %', sqlerrm;
  return new;
end $$;
revoke all on function public.push_dispatch_webhook() from public, anon, authenticated;

drop trigger if exists push_dispatch_on_notification on public.notifications;
create trigger push_dispatch_on_notification after insert on public.notifications for each row execute function public.push_dispatch_webhook();
drop trigger if exists push_dispatch_on_message on public.messages;
create trigger push_dispatch_on_message after insert on public.messages for each row execute function public.push_dispatch_webhook();

