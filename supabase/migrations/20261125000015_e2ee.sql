-- =============================================================================
-- Friendzy — 0015: end-to-end encrypted messaging
-- =============================================================================
-- * public.e2ee_devices  — one row per app installation. Holds only PUBLIC keys
--   (X25519 identity key for key agreement, Ed25519 key for signatures) that the
--   device generated locally. Private keys never leave the device.
-- * public.messages.envelope — the sealed message. The sender's device encrypts
--   text/metadata/attachment secrets with a random content key and wraps that key
--   for every device of every member. Supabase stores and relays ciphertext only.
-- * RPCs: register/revoke/list devices, recipients of a conversation,
--   send_encrypted_message, edit_encrypted_message, send_story_reply (encrypted).
-- * Plaintext client RPCs (send_message, edit_message, forward_messages) are no
--   longer executable by clients: every new user message must be end-to-end
--   encrypted. Server-generated rows (system notices, call logs) stay plaintext.
-- * Push webhook payloads never include the envelope.
--
-- What the server can still see (metadata): who talks to whom and when, the
-- message kind (text / photo / voice …), attachment sizes, reactions, read
-- receipts. This is documented honestly in docs/ARCHITECTURE.md.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Device key directory
-- ----------------------------------------------------------------------------
create table if not exists public.e2ee_devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  device_id     text not null unique check (device_id ~ '^[A-Za-z0-9_-]{16,64}$'),
  platform      text not null check (platform in ('android', 'ios', 'web')),
  name          text check (name is null or char_length(name) <= 80),
  identity_key  text not null check (identity_key ~ '^[A-Za-z0-9+/]{43}=$'),   -- base64 X25519 public key (32 bytes)
  signing_key   text not null check (signing_key ~ '^[A-Za-z0-9+/]{43}=$'),    -- base64 Ed25519 public key (32 bytes)
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz
);
create index if not exists e2ee_devices_user_idx on public.e2ee_devices (user_id) where revoked_at is null;

alter table public.e2ee_devices enable row level security;
revoke all on public.e2ee_devices from anon, authenticated;
grant select on public.e2ee_devices to authenticated;
drop policy if exists "e2ee_devices_select_own" on public.e2ee_devices;
create policy "e2ee_devices_select_own" on public.e2ee_devices for select to authenticated using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Sealed envelope on messages
-- ----------------------------------------------------------------------------
alter table public.messages add column if not exists envelope jsonb;
alter table public.messages drop constraint if exists messages_envelope_size;
alter table public.messages add constraint messages_envelope_size check (envelope is null or octet_length(envelope::text) <= 131072);

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------
create or replace function public.e2ee_device_json(d public.e2ee_devices, p_self boolean default false)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'user_id', d.user_id,
    'device_id', d.device_id,
    'platform', d.platform,
    'name', case when p_self then d.name else null end,
    'identity_key', d.identity_key,
    'signing_key', d.signing_key,
    'created_at', d.created_at,
    'last_seen_at', case when p_self then d.last_seen_at else null end,
    'revoked_at', d.revoked_at)
$$;

-- Validates the shape of an envelope and that its wrapped keys target exactly the
-- current devices of the current members of the conversation (no more, no less).
create or replace function public.e2ee_validate_envelope(p_conversation uuid, p_sender uuid, p_envelope jsonb)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_device text; v_keys jsonb;
begin
  if p_envelope is null or jsonb_typeof(p_envelope) <> 'object' then raise exception 'ENVELOPE_INVALID' using errcode = '23514'; end if;
  if octet_length(p_envelope::text) > 131072 then raise exception 'ENVELOPE_TOO_LARGE' using errcode = '23514', hint = 'This message is too large to send.'; end if;
  if (p_envelope->>'v') is distinct from '1'
     or coalesce(p_envelope->>'alg', '') = '' or coalesce(p_envelope->>'eph', '') = '' or coalesce(p_envelope->>'nonce', '') = ''
     or coalesce(p_envelope->>'ct', '') = '' or coalesce(p_envelope->>'sig', '') = ''
     or jsonb_typeof(p_envelope->'sender') <> 'object' then
    raise exception 'ENVELOPE_INVALID' using errcode = '23514';
  end if;
  v_device := p_envelope->'sender'->>'device';
  if v_device is null or (p_envelope->'sender'->>'user') is distinct from p_sender::text then raise exception 'ENVELOPE_INVALID' using errcode = '23514'; end if;
  if not exists (select 1 from public.e2ee_devices d where d.device_id = v_device and d.user_id = p_sender and d.revoked_at is null) then
    raise exception 'DEVICE_NOT_REGISTERED' using errcode = '42501', hint = 'This device has no encryption keys yet. Reopen the chat to set it up.';
  end if;
  v_keys := p_envelope->'keys';
  if v_keys is null or jsonb_typeof(v_keys) <> 'object' or not (v_keys ? v_device) then raise exception 'ENVELOPE_INVALID' using errcode = '23514'; end if;
  if exists (select 1 from jsonb_each(v_keys) e where jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') > 256 or (e.value #>> '{}') !~ '^[A-Za-z0-9+/=]+$') then
    raise exception 'ENVELOPE_INVALID' using errcode = '23514';
  end if;
  -- Every member must have at least one device, otherwise nobody can encrypt for them.
  if exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation and m.state in ('active', 'pending')
      and not exists (select 1 from public.e2ee_devices d where d.user_id = m.user_id and d.revoked_at is null)) then
    raise exception 'RECIPIENT_WITHOUT_KEYS' using errcode = 'P0001', hint = 'Someone in this chat has not opened Friendzy on a device with encryption yet.';
  end if;
  -- No key for a device that is not (any more) part of the chat …
  if exists (
    select 1 from jsonb_object_keys(v_keys) as k
    where not exists (
      select 1 from public.e2ee_devices d
      join public.conversation_members m on m.user_id = d.user_id and m.conversation_id = p_conversation and m.state in ('active', 'pending')
      where d.device_id = k and d.revoked_at is null)) then
    raise exception 'STALE_RECIPIENTS' using errcode = 'P0001', hint = 'The devices in this chat changed. Please try again.';
  end if;
  -- … and a key for every current device of every current member.
  if exists (
    select 1 from public.e2ee_devices d
    join public.conversation_members m on m.user_id = d.user_id and m.conversation_id = p_conversation and m.state in ('active', 'pending')
    where d.revoked_at is null and not (v_keys ? d.device_id)) then
    raise exception 'STALE_RECIPIENTS' using errcode = 'P0001', hint = 'The devices in this chat changed. Please try again.';
  end if;
end $$;

-- Webhook payloads: never ship ciphertext to the push dispatcher, only a flag.
create or replace function public.webhook_record(p_row jsonb)
returns jsonb language sql immutable as $$
  select (p_row - 'envelope') || case when p_row ? 'envelope' then jsonb_build_object('encrypted', jsonb_typeof(p_row->'envelope') = 'object') else '{}'::jsonb end
$$;

-- ----------------------------------------------------------------------------
-- Device registration
-- ----------------------------------------------------------------------------
create or replace function public.register_e2ee_device(p_device_id text, p_platform text, p_identity_key text, p_signing_key text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_row public.e2ee_devices; v_existing public.e2ee_devices; v_active integer;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_device_id !~ '^[A-Za-z0-9_-]{16,64}$' or p_platform not in ('android', 'ios', 'web')
     or coalesce(p_identity_key, '') !~ '^[A-Za-z0-9+/]{43}=$' or coalesce(p_signing_key, '') !~ '^[A-Za-z0-9+/]{43}=$' then
    raise exception 'INVALID_DEVICE' using errcode = '23514';
  end if;
  select * into v_existing from public.e2ee_devices where device_id = p_device_id;
  if v_existing.id is not null and v_existing.user_id <> v_me then raise exception 'DEVICE_ID_TAKEN' using errcode = '23505'; end if;
  if v_existing.id is not null and v_existing.revoked_at is not null then
    raise exception 'DEVICE_REVOKED' using errcode = '42501', hint = 'This device was removed from your account. A new encryption identity will be created.';
  end if;
  if v_existing.id is null then
    select count(*) into v_active from public.e2ee_devices where user_id = v_me and revoked_at is null;
    if v_active >= 10 then
      raise exception 'DEVICE_LIMIT' using errcode = 'P0001', hint = 'You can use encrypted chat on up to 10 devices. Remove one in Settings → Encryption.';
    end if;
    insert into public.e2ee_devices (user_id, device_id, platform, name, identity_key, signing_key)
    values (v_me, p_device_id, p_platform, nullif(left(p_name, 80), ''), p_identity_key, p_signing_key)
    returning * into v_row;
  else
    update public.e2ee_devices
       set platform = p_platform,
           name = coalesce(nullif(left(p_name, 80), ''), name),
           -- New key material under a known id counts as a new identity (peers see a key change).
           created_at = case when identity_key = p_identity_key and signing_key = p_signing_key then created_at else now() end,
           identity_key = p_identity_key,
           signing_key = p_signing_key,
           last_seen_at = now()
     where id = v_existing.id
    returning * into v_row;
  end if;
  return public.e2ee_device_json(v_row, true);
end $$;

create or replace function public.revoke_e2ee_device(p_device_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  update public.e2ee_devices set revoked_at = now() where user_id = auth.uid() and device_id = p_device_id and revoked_at is null;
  if not found then raise exception 'DEVICE_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

create or replace function public.get_e2ee_devices()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_agg(public.e2ee_device_json(d, true) order by d.created_at) from public.e2ee_devices d where d.user_id = auth.uid() and d.revoked_at is null), '[]'::jsonb)
$$;

-- Public keys of one user's devices (revoked ones included and flagged so old
-- signatures can still be verified). Hidden between blocked users.
create or replace function public.e2ee_user_devices(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_user <> auth.uid() and (public.is_blocked_either(auth.uid(), p_user)
      or not exists (select 1 from public.profiles p where p.id = p_user and p.account_status = 'active')) then
    return '[]'::jsonb;
  end if;
  return coalesce((select jsonb_agg(public.e2ee_device_json(d, p_user = auth.uid()) order by d.created_at)
                   from public.e2ee_devices d where d.user_id = p_user), '[]'::jsonb);
end $$;

-- Everything a sender needs to seal a message for a conversation.
create or replace function public.e2ee_recipients(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_conversation_member(p_conversation) then raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(m.user_id) from public.conversation_members m where m.conversation_id = p_conversation and m.state in ('active', 'pending')), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(public.e2ee_device_json(d, d.user_id = auth.uid()) order by d.user_id, d.created_at)
      from public.e2ee_devices d
      join public.conversation_members m on m.user_id = d.user_id and m.conversation_id = p_conversation and m.state in ('active', 'pending')
      where d.revoked_at is null), '[]'::jsonb));
end $$;

-- ----------------------------------------------------------------------------
-- Message JSON now carries the envelope (clients decrypt locally)
-- ----------------------------------------------------------------------------
create or replace function public.message_json(m public.messages, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id,
    'conversation_id', m.conversation_id,
    'sender', case when m.sender_id is null then null else public.profile_card_json(m.sender_id) end,
    'kind', m.kind,
    'text', case when m.deleted_at is null then m.text else null end,
    'metadata', case when m.deleted_at is null then m.metadata else '{}'::jsonb end,
    'encrypted', m.envelope is not null,
    'envelope', case when m.deleted_at is null then m.envelope else null end,
    'attachments', case when m.deleted_at is not null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'path', a.path, 'name', a.name, 'mime', a.mime, 'size_bytes', a.size_bytes,
                                          'width', a.width, 'height', a.height, 'duration_ms', a.duration_ms, 'thumbnail_path', a.thumbnail_path, 'waveform', a.waveform)
                       order by a.position)
      from public.message_attachments a where a.message_id = m.id), '[]'::jsonb) end,
    'reply_to', case when m.reply_to_id is null then null else (
      select jsonb_build_object('id', r.id, 'sender', case when r.sender_id is null then null else public.profile_card_json(r.sender_id) end,
                                'kind', r.kind, 'preview', public.message_preview(r.kind, r.text, r.deleted_at is not null), 'deleted', r.deleted_at is not null,
                                'encrypted', r.envelope is not null, 'envelope', case when r.deleted_at is null then r.envelope else null end)
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
        'encrypted', v_last.envelope is not null, 'envelope', case when v_last.deleted_at is null then v_last.envelope else null end,
        'deleted', v_last.deleted_at is not null,
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

-- ----------------------------------------------------------------------------
-- Sending
-- ----------------------------------------------------------------------------
create or replace function public.send_encrypted_message(
  p_conversation uuid,
  p_kind public.message_kind,
  p_envelope jsonb,
  p_attachments jsonb default '[]'::jsonb,
  p_reply_to uuid default null,
  p_client_id text default null,
  p_forwarded boolean default false
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
  v_prefix text;
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

  if p_kind in ('image', 'video', 'audio', 'document') and coalesce(jsonb_array_length(p_attachments), 0) = 0 then
    raise exception 'ATTACHMENT_REQUIRED' using errcode = '23514';
  end if;
  if coalesce(jsonb_array_length(p_attachments), 0) > 10 then raise exception 'TOO_MANY_ATTACHMENTS' using errcode = '23514'; end if;
  if p_reply_to is not null and not exists (select 1 from public.messages r where r.id = p_reply_to and r.conversation_id = p_conversation) then
    raise exception 'REPLY_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform public.e2ee_validate_envelope(p_conversation, v_me, p_envelope);

  insert into public.messages (conversation_id, sender_id, kind, text, metadata, envelope, reply_to_id, client_id, forwarded, expires_at)
  values (p_conversation, v_me, p_kind, null, '{}'::jsonb, p_envelope, p_reply_to, p_client_id, coalesce(p_forwarded, false),
          case when v_conv.disappearing_seconds > 0 then now() + make_interval(secs => v_conv.disappearing_seconds) else null end)
  returning * into v_msg;

  v_prefix := p_conversation::text || '/' || v_me::text || '/%';
  for v_item in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    -- Attachments (ciphertext) must be stored under <conversation>/<sender>/ in the private chat bucket.
    if coalesce(v_item->>'path', '') not like v_prefix or (v_item->>'thumbnail_path' is not null and (v_item->>'thumbnail_path') not like v_prefix) then
      raise exception 'ATTACHMENT_NOT_OWNED' using errcode = '42501';
    end if;
    -- Names, dimensions, durations, waveforms and real MIME types live inside the envelope.
    insert into public.message_attachments (message_id, position, kind, path, name, mime, size_bytes, width, height, duration_ms, thumbnail_path, waveform)
    values (v_msg.id, v_i, coalesce((v_item->>'kind')::public.media_kind, 'document'), v_item->>'path', null, 'application/octet-stream',
            (v_item->>'size_bytes')::bigint, null, null, null, v_item->>'thumbnail_path', null);
    v_i := v_i + 1;
  end loop;

  perform public.touch_conversation(p_conversation, v_msg);
  return public.message_json(v_msg, v_me);
end $$;

create or replace function public.edit_encrypted_message(p_id uuid, p_envelope jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_msg public.messages;
begin
  select * into v_msg from public.messages where id = p_id and sender_id = auth.uid() and deleted_at is null;
  if not found then raise exception 'MESSAGE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_msg.envelope is null or v_msg.kind <> 'text' then raise exception 'CANNOT_EDIT' using errcode = 'P0001', hint = 'Only text messages can be edited.'; end if;
  if v_msg.created_at < now() - interval '24 hours' then raise exception 'EDIT_WINDOW' using errcode = 'P0001', hint = 'Messages can be edited for 24 hours.'; end if;
  perform public.e2ee_validate_envelope(v_msg.conversation_id, auth.uid(), p_envelope);
  update public.messages set envelope = p_envelope, edited_at = now() where id = p_id;
  return public.message_json((select m from public.messages m where m.id = p_id), auth.uid());
end $$;

-- Deleting for everyone also destroys the ciphertext.
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
    update public.messages set deleted_at = now(), deleted_by = auth.uid(), text = null, metadata = '{}'::jsonb, envelope = null where id = p_id;
    delete from public.message_attachments where message_id = p_id;
    delete from public.conversation_pins where message_id = p_id;
  else
    insert into public.message_deletions (user_id, message_id) values (auth.uid(), p_id) on conflict do nothing;
  end if;
end $$;

-- Server-side forwarding cannot re-seal ciphertext for another chat: encrypted
-- sources are skipped (clients decrypt and send a fresh encrypted message instead).
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
      if not found or not public.is_conversation_member(v_src.conversation_id) or v_src.kind in ('system', 'call') or v_src.envelope is not null then continue; end if;
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

-- Story replies are sealed on the device too (story reference lives inside the envelope).
drop function if exists public.send_story_reply(uuid, text);
create or replace function public.send_story_reply(p_story uuid, p_envelope jsonb, p_client_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_story public.stories; v_conv uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into v_story from public.stories where id = p_story and removed_at is null;
  if not found or not public.can_view_story_of(v_story.author_id, v_story.audience, auth.uid()) then raise exception 'STORY_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_story.author_id = auth.uid() then raise exception 'CANNOT_MESSAGE_SELF' using errcode = 'P0001'; end if;
  v_conv := public.start_direct_conversation(v_story.author_id);
  return public.send_encrypted_message(v_conv, 'story_reply', p_envelope, '[]'::jsonb, null, p_client_id, false);
end $$;

-- ----------------------------------------------------------------------------
-- Push webhook: strip the envelope, keep a flag
-- ----------------------------------------------------------------------------
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
    body := jsonb_build_object('type', tg_op, 'table', tg_table_name, 'schema', tg_table_schema, 'record', public.webhook_record(to_jsonb(new)), 'old_record', null),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    timeout_milliseconds := 5000);
  return new;
exception when others then
  raise warning 'push_dispatch_webhook: %', sqlerrm;
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- Privileges
-- ----------------------------------------------------------------------------
do $do$
declare f text;
begin
  foreach f in array array[
    'public.register_e2ee_device(text, text, text, text, text)',
    'public.revoke_e2ee_device(text)',
    'public.get_e2ee_devices()',
    'public.e2ee_user_devices(uuid)',
    'public.e2ee_recipients(uuid)',
    'public.send_encrypted_message(uuid, public.message_kind, jsonb, jsonb, uuid, text, boolean)',
    'public.edit_encrypted_message(uuid, jsonb)',
    'public.send_story_reply(uuid, jsonb, text)',
    'public.delete_message(uuid, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- Internal helpers and the plaintext paths are not for clients any more.
  foreach f in array array[
    'public.e2ee_device_json(public.e2ee_devices, boolean)',
    'public.e2ee_validate_envelope(uuid, uuid, jsonb)',
    'public.webhook_record(jsonb)',
    'public.send_message(uuid, public.message_kind, text, jsonb, jsonb, uuid, text)',
    'public.edit_message(uuid, text)',
    'public.forward_messages(uuid[], uuid[])'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $do$;
