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
