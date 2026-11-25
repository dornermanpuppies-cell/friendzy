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
