-- ============================================================================
-- 0019 — Chat wallpapers from the photo library, and archiving that behaves like
--        the messengers people already know.
--
-- Wallpapers
--   conversation_members.wallpaper already holds a per-person choice. It now also
--   accepts `img:<storage path>` pointing at the private `wallpapers` bucket, so a
--   photo from the phone can be used. user_settings.chat_wallpaper is the default
--   applied to every chat that has no choice of its own.
--
-- Archiving
--   Until now any new message pulled a chat back out of the archive. That is the one
--   behaviour people complain about. `keep_chats_archived` (on by default) keeps an
--   archived chat archived and silent; turning it off restores the old behaviour.
--   get_archived_summary() feeds the single "Archived" row at the top of the inbox.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Settings
-- ----------------------------------------------------------------------------
alter table public.user_settings
  add column if not exists keep_chats_archived boolean not null default true,
  add column if not exists chat_wallpaper text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_settings_chat_wallpaper_len') then
    alter table public.user_settings
      add constraint user_settings_chat_wallpaper_len check (chat_wallpaper is null or char_length(chat_wallpaper) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conversation_members_wallpaper_len') then
    alter table public.conversation_members
      add constraint conversation_members_wallpaper_len check (wallpaper is null or char_length(wallpaper) <= 200);
  end if;
end $$;

comment on column public.user_settings.keep_chats_archived is
  'When true (default) an archived chat stays archived and silent even when new messages arrive.';
comment on column public.user_settings.chat_wallpaper is
  'Default chat background: a preset id, or img:<path> in the private wallpapers bucket.';

-- ----------------------------------------------------------------------------
-- Archiving that sticks
-- ----------------------------------------------------------------------------

/**
 * Replaces 0003. The sender's own copy still leaves the archive — writing in a chat means you
 * want it back. For everyone else the archive now holds unless they turned "keep chats archived" off.
 */
create or replace function public.touch_conversation(p_conversation uuid, p_message public.messages)
returns void language sql security definer set search_path = public as $$
  update public.conversations set last_message_id = p_message.id, last_message_at = p_message.created_at, updated_at = now() where id = p_conversation;
  update public.conversation_members set is_archived = false, marked_unread = false, updated_at = now()
   where conversation_id = p_conversation and user_id = p_message.sender_id;
  update public.conversation_members m set is_archived = false, updated_at = now()
   where m.conversation_id = p_conversation
     and m.user_id <> p_message.sender_id
     and m.is_archived
     and not coalesce((select s.keep_chats_archived from public.user_settings s where s.user_id = m.user_id), true);
$$;

/** The one row at the top of the inbox: how many chats are archived and how many are unread. */
create or replace function public.get_archived_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  with mine as (
    select m.conversation_id, m.last_read_at, m.cleared_at, m.marked_unread, m.muted_until,
           (select count(*) from public.messages x
             where x.conversation_id = m.conversation_id
               and x.sender_id is distinct from auth.uid()
               and x.deleted_at is null
               and x.created_at > m.last_read_at
               and x.created_at > coalesce(m.cleared_at, 'epoch'::timestamptz)) as unread
    from public.conversation_members m
    where m.user_id = auth.uid() and m.state = 'active' and m.is_archived
  )
  select jsonb_build_object(
    'chats', (select count(*) from mine),
    'unread_chats', (select count(*) from mine where unread > 0 or marked_unread),
    'unread_messages', (select coalesce(sum(unread), 0) from mine),
    'names', coalesce((
      select jsonb_agg(name order by name)
      from (
        select coalesce(c.title, (select p.display_name from public.conversation_members o
                                   join public.profiles p on p.id = o.user_id
                                  where o.conversation_id = c.id and o.user_id <> auth.uid() limit 1), 'Chat') as name
        from mine join public.conversations c on c.id = mine.conversation_id
        order by coalesce(c.last_message_at, c.created_at) desc
        limit 3
      ) t
    ), '[]'::jsonb),
    'keep_archived', coalesce((select s.keep_chats_archived from public.user_settings s where s.user_id = auth.uid()), true)
  )
$$;

/** Empties the archive in one go, the way the inbox menu offers it. */
create or replace function public.unarchive_all_chats()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  update public.conversation_members set is_archived = false, updated_at = now()
   where user_id = auth.uid() and is_archived;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ----------------------------------------------------------------------------
-- Wallpaper storage: private, one folder per person
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wallpapers', 'wallpapers', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "wallpapers_select_own" on storage.objects;
create policy "wallpapers_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'wallpapers' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "wallpapers_insert_own" on storage.objects;
create policy "wallpapers_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'wallpapers' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "wallpapers_update_own" on storage.objects;
create policy "wallpapers_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'wallpapers' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'wallpapers' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "wallpapers_delete_own" on storage.objects;
create policy "wallpapers_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'wallpapers' and (storage.foldername(name))[1] = auth.uid()::text);

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public.get_archived_summary()', 'public.unarchive_all_chats()'] loop
    execute format('revoke all on function %s from anon, authenticated', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
