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
