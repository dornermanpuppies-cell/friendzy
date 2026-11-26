-- ============================================================================
-- Local test bootstrap: mimics the parts of a Supabase project that the
-- Friendzy migrations depend on (roles, auth/storage schemas, helpers,
-- realtime publication) so migrations + RLS can be exercised on a vanilla
-- PostgreSQL started by scripts/db-test.mjs. NOT for production use.
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then create role supabase_storage_admin nologin; end if;
end $$;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists tests;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

grant usage on schema extensions to public;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth schema
-- ---------------------------------------------------------------------------
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  instance_id        uuid,
  aud                text default 'authenticated',
  role               text default 'authenticated',
  email              text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  is_super_admin     boolean,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  phone              text,
  last_sign_in_at    timestamptz,
  banned_until       timestamptz,
  deleted_at         timestamptz
);

create table if not exists auth.sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_agent text,
  ip         inet,
  not_after  timestamptz
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant execute on function auth.uid(), auth.role(), auth.jwt() to public;
grant select on auth.users, auth.sessions to service_role;

-- ---------------------------------------------------------------------------
-- storage schema
-- ---------------------------------------------------------------------------
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null unique,
  owner              uuid,
  owner_id           text,
  public             boolean default false,
  avif_autodetection boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create table if not exists storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets (id),
  name             text,
  owner            uuid,
  owner_id         text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata         jsonb,
  user_metadata    jsonb,
  version          text,
  path_tokens      text[] generated always as (string_to_array(name, '/')) stored
);
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;

create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end $$;

create or replace function storage.filename(name text) returns text
language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end $$;

create or replace function storage.extension(name text) returns text
language plpgsql immutable as $$
declare _parts text[]; _filename text;
begin
  select string_to_array(name, '/') into _parts;
  select _parts[array_length(_parts, 1)] into _filename;
  return reverse(split_part(reverse(_filename), '.', 1));
end $$;

-- ---------------------------------------------------------------------------
-- realtime publication
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Test helpers (impersonation) — callable by every role so tests can switch
-- ---------------------------------------------------------------------------
grant usage on schema tests to public;
alter default privileges in schema tests grant execute on functions to public;
create or replace function tests.create_user(p_email text, p_meta jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
  values (v_id, p_email, p_meta, now());
  insert into auth.sessions (user_id, user_agent, ip) values (v_id, 'tests/1.0', '127.0.0.1');
  return v_id;
end $$;

-- Reads auth.sessions as the definer; SET ROLE itself must happen in invoker context.
create or replace function tests.session_for(p_user uuid)
returns uuid language sql security definer stable as $$
  select id from auth.sessions where user_id = p_user order by created_at limit 1
$$;

create or replace function tests.as_user(p_user uuid)
returns void language plpgsql as $$
declare v_session uuid := tests.session_for(p_user);
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', v_session)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function tests.as_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end $$;

create or replace function tests.as_service()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;

create or replace function tests.as_admin_db()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'none', true);
end $$;

create or replace function tests.assert(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_condition is distinct from true then
    raise exception 'ASSERTION FAILED: %', p_message;
  end if;
end $$;

create or replace function tests.assert_raises(p_sql text, p_message text, p_expected text default null)
returns void language plpgsql as $$
declare v_msg text; v_hint text; v_raised boolean := false;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    v_raised := true;
    if p_expected is not null and position(p_expected in v_msg) = 0 and position(p_expected in coalesce(v_hint, '')) = 0 then
      raise exception 'ASSERTION FAILED: % — raised "%" but expected to contain "%"', p_message, v_msg, p_expected;
    end if;
  end;
  if not v_raised then
    raise exception 'ASSERTION FAILED: % — expected an error but none was raised', p_message;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Plaintext messaging wrappers. Since migration 0015 every client message must
-- be end-to-end encrypted, so public.send_message / edit_message /
-- forward_messages are no longer executable by the authenticated role. The
-- conversation rules they share with the encrypted path are still exercised
-- through these definer wrappers (bodies resolve at call time, after migrations).
-- ---------------------------------------------------------------------------
create or replace function tests.send_plain(p_conversation uuid, p_kind text default 'text', p_text text default null, p_metadata jsonb default '{}'::jsonb, p_attachments jsonb default '[]'::jsonb, p_reply_to uuid default null, p_client_id text default null)
returns jsonb language plpgsql security definer as $$
begin
  return public.send_message(p_conversation, p_kind::public.message_kind, p_text, p_metadata, p_attachments, p_reply_to, p_client_id);
end $$;

create or replace function tests.edit_plain(p_id uuid, p_text text)
returns jsonb language plpgsql security definer as $$
begin
  return public.edit_message(p_id, p_text);
end $$;

create or replace function tests.forward_plain(p_message_ids uuid[], p_conversation_ids uuid[])
returns integer language plpgsql security definer as $$
begin
  return public.forward_messages(p_message_ids, p_conversation_ids);
end $$;
