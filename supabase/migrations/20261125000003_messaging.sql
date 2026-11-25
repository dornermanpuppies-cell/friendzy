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
