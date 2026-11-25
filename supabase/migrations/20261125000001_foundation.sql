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
