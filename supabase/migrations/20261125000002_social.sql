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
