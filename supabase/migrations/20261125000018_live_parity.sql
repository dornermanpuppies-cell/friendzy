-- ============================================================================
-- 0018 — LIVE parity: goals, Q&A, in-stream supporter ranking, host word filters
--
-- Brings the broadcast surface in line with what people expect from a large live
-- platform, on top of the stage/battle/gift/moderation machinery in 0007:
--   • live_goals            a gift-coin or like target with a progress bar everyone can see
--   • live_questions        viewers ask, the host features one on screen and marks it answered
--   • live_comment_filters  per-host blocked words, enforced when a comment is sent
--   • supporter ranking     top gifters of the running broadcast, not only in the recap
--
-- Everything is written through SECURITY DEFINER functions; clients get SELECT only,
-- behind the same can_view_live()/is_live_moderator() rules as the rest of the feature.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Goals
-- ----------------------------------------------------------------------------
create table if not exists public.live_goals (
  id         uuid primary key default gen_random_uuid(),
  live_id    uuid not null references public.live_sessions (id) on delete cascade,
  kind       text not null,
  label      text,
  target     bigint not null,
  progress   bigint not null default 0,
  status     text not null default 'active',
  -- clock_timestamp(): goals replaced inside one transaction must still order correctly.
  created_at timestamptz not null default clock_timestamp(),
  reached_at timestamptz,
  constraint live_goals_kind check (kind in ('coins', 'likes')),
  constraint live_goals_status check (status in ('active', 'reached', 'cancelled')),
  constraint live_goals_target check (target between 1 and 100000000),
  constraint live_goals_progress check (progress >= 0),
  constraint live_goals_label_len check (label is null or char_length(label) <= 60)
);
-- One goal running at a time, like the host sees it on screen.
create unique index if not exists live_goals_one_active on public.live_goals (live_id) where status = 'active';
create index if not exists live_goals_live_idx on public.live_goals (live_id, created_at desc);

alter table public.live_goals enable row level security;
revoke all on public.live_goals from anon, authenticated;
grant select on public.live_goals to authenticated;
drop policy if exists "live_goals_select" on public.live_goals;
create policy "live_goals_select" on public.live_goals for select to authenticated using (public.can_view_live(live_id));

-- ----------------------------------------------------------------------------
-- Q&A
-- ----------------------------------------------------------------------------
create table if not exists public.live_questions (
  id          uuid primary key default gen_random_uuid(),
  live_id     uuid not null references public.live_sessions (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  text        text not null,
  status      text not null default 'pending',
  upvotes     integer not null default 0,
  created_at  timestamptz not null default clock_timestamp(),
  featured_at timestamptz,
  answered_at timestamptz,
  constraint live_questions_text_len check (char_length(text) between 3 and 150),
  constraint live_questions_status check (status in ('pending', 'featured', 'answered', 'dismissed')),
  constraint live_questions_upvotes check (upvotes >= 0)
);
-- Only one question is on screen at a time.
create unique index if not exists live_questions_one_featured on public.live_questions (live_id) where status = 'featured';
create index if not exists live_questions_live_idx on public.live_questions (live_id, status, upvotes desc, created_at);

alter table public.live_questions enable row level security;
revoke all on public.live_questions from anon, authenticated;
grant select on public.live_questions to authenticated;
drop policy if exists "live_questions_select" on public.live_questions;
create policy "live_questions_select" on public.live_questions for select to authenticated using (public.can_view_live(live_id));

create table if not exists public.live_question_votes (
  question_id uuid not null references public.live_questions (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (question_id, user_id)
);
alter table public.live_question_votes enable row level security;
revoke all on public.live_question_votes from anon, authenticated;
grant select on public.live_question_votes to authenticated;
drop policy if exists "live_question_votes_own" on public.live_question_votes;
create policy "live_question_votes_own" on public.live_question_votes for select to authenticated using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Blocked words (per host, applies to every broadcast they run)
-- ----------------------------------------------------------------------------
create table if not exists public.live_comment_filters (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  word       text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, word),
  constraint live_comment_filters_word_len check (char_length(word) between 2 and 40)
);
alter table public.live_comment_filters enable row level security;
revoke all on public.live_comment_filters from anon, authenticated;
grant select on public.live_comment_filters to authenticated;
drop policy if exists "live_comment_filters_own" on public.live_comment_filters;
create policy "live_comment_filters_own" on public.live_comment_filters for select to authenticated using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Goal functions
-- ----------------------------------------------------------------------------

/** Adds progress to the running goal of a broadcast and announces it when the target is hit. */
create or replace function public.live_goal_bump(p_live uuid, p_kind text, p_amount bigint)
returns void language plpgsql security definer set search_path = public as $$
declare g public.live_goals;
begin
  if coalesce(p_amount, 0) <= 0 then return; end if;
  update public.live_goals
     set progress = progress + p_amount
   where live_id = p_live and kind = p_kind and status = 'active'
  returning * into g;
  if g.id is null then return; end if;
  if g.progress >= g.target then
    update public.live_goals set status = 'reached', reached_at = now() where id = g.id and status = 'active';
    perform public.insert_live_system(p_live,
      '🎉 Goal reached: ' || coalesce(g.label, case when g.kind = 'coins' then 'gift goal' else 'like goal' end),
      'system', jsonb_build_object('goal_id', g.id, 'kind', g.kind, 'target', g.target), null);
  end if;
end $$;

/** Host sets the goal shown on screen. Replaces whatever was running. */
create or replace function public.set_live_goal(p_live uuid, p_kind text, p_target bigint, p_label text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.live_sessions; v_id uuid; v_label text := nullif(trim(coalesce(p_label, '')), '');
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into v from public.live_sessions where id = p_live;
  if v.id is null then raise exception 'LIVE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.host_id <> auth.uid() then raise exception 'HOST_ONLY' using errcode = '42501', hint = 'Only the host sets the goal.'; end if;
  if v.status not in ('scheduled', 'preparing', 'live') then raise exception 'LIVE_OVER' using errcode = 'P0001'; end if;
  if p_kind not in ('coins', 'likes') then raise exception 'INVALID_KIND' using errcode = '22023'; end if;
  if coalesce(p_target, 0) < 1 or p_target > 100000000 then raise exception 'INVALID_TARGET' using errcode = '22023', hint = 'Pick a target between 1 and 100000000.'; end if;
  if v_label is not null and char_length(v_label) > 60 then v_label := left(v_label, 60); end if;

  update public.live_goals set status = 'cancelled' where live_id = p_live and status = 'active';
  insert into public.live_goals (live_id, kind, label, target) values (p_live, p_kind, v_label, p_target) returning id into v_id;
  if v.status = 'live' then
    perform public.insert_live_system(p_live,
      case when p_kind = 'coins' then 'New goal: ' || p_target || ' coins' else 'New goal: ' || p_target || ' likes' end || coalesce(' · ' || v_label, ''),
      'system', jsonb_build_object('goal_id', v_id, 'kind', p_kind, 'target', p_target), null);
  end if;
  return (select to_jsonb(x) from (select id, kind, label, target, progress, status, created_at, reached_at from public.live_goals where id = v_id) x);
end $$;

/** Host clears the goal. */
create or replace function public.cancel_live_goal(p_live uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_live_host(p_live, auth.uid()) then raise exception 'HOST_ONLY' using errcode = '42501'; end if;
  update public.live_goals set status = 'cancelled' where live_id = p_live and status = 'active';
end $$;

-- ----------------------------------------------------------------------------
-- Q&A functions
-- ----------------------------------------------------------------------------

/** A viewer asks a question. One open question each, so the list stays readable. */
create or replace function public.ask_live_question(p_live uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.live_sessions; v_me uuid := auth.uid(); v_id uuid; v_text text := nullif(trim(coalesce(p_text, '')), '');
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into v from public.live_sessions where id = p_live;
  if v.id is null or not public.can_view_live(p_live) then raise exception 'LIVE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.status <> 'live' then raise exception 'LIVE_OVER' using errcode = 'P0001'; end if;
  if v_text is null or char_length(v_text) < 3 then raise exception 'TEXT_REQUIRED' using errcode = '23514', hint = 'Write a question first.'; end if;
  if not v.allow_comments and v.host_id <> v_me then raise exception 'COMMENTS_DISABLED' using errcode = '42501', hint = 'The host turned off comments.'; end if;
  if exists (select 1 from public.live_mutes m where m.live_id = p_live and m.user_id = v_me and m.until > now()) then
    raise exception 'MUTED' using errcode = '42501', hint = 'You have been muted in this broadcast.';
  end if;
  if exists (select 1 from public.live_questions q where q.live_id = p_live and q.user_id = v_me and q.status in ('pending', 'featured')) then
    raise exception 'QUESTION_PENDING' using errcode = 'P0001', hint = 'Your question is already in the queue.';
  end if;
  if (select count(*) from public.live_questions q where q.user_id = v_me and q.created_at > clock_timestamp() - interval '1 minute') >= 3 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001', hint = 'Slow down a little.';
  end if;
  insert into public.live_questions (live_id, user_id, text) values (p_live, v_me, left(v_text, 150)) returning id into v_id;
  return (select jsonb_build_object('id', q.id, 'text', q.text, 'status', q.status, 'upvotes', q.upvotes, 'created_at', q.created_at,
                                    'user', public.profile_card_json(q.user_id), 'my_vote', false)
            from public.live_questions q where q.id = v_id);
end $$;

/** Viewers push the questions they want answered up the list. */
create or replace function public.vote_live_question(p_question uuid, p_on boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q public.live_questions; v_me uuid := auth.uid(); v_votes integer;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into q from public.live_questions where id = p_question;
  if q.id is null or not public.can_view_live(q.live_id) then raise exception 'QUESTION_NOT_FOUND' using errcode = 'P0002'; end if;
  if q.user_id = v_me then raise exception 'CANNOT_VOTE_OWN' using errcode = '42501', hint = 'You cannot upvote your own question.'; end if;
  if coalesce(p_on, true) then
    insert into public.live_question_votes (question_id, user_id) values (p_question, v_me) on conflict do nothing;
  else
    delete from public.live_question_votes where question_id = p_question and user_id = v_me;
  end if;
  select count(*) into v_votes from public.live_question_votes where question_id = p_question;
  update public.live_questions set upvotes = v_votes where id = p_question;
  return jsonb_build_object('id', p_question, 'upvotes', v_votes, 'my_vote', coalesce(p_on, true));
end $$;

/** Host or moderator puts a question on screen, marks it answered, or drops it. */
create or replace function public.set_live_question(p_question uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare q public.live_questions;
begin
  select * into q from public.live_questions where id = p_question;
  if q.id is null then raise exception 'QUESTION_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_live_moderator(q.live_id, auth.uid()) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_status not in ('pending', 'featured', 'answered', 'dismissed') then raise exception 'INVALID_STATUS' using errcode = '22023'; end if;
  if p_status = 'featured' then
    update public.live_questions set status = 'pending' where live_id = q.live_id and status = 'featured' and id <> p_question;
  end if;
  update public.live_questions
     set status = p_status,
         featured_at = case when p_status = 'featured' then now() else featured_at end,
         answered_at = case when p_status = 'answered' then now() else answered_at end
   where id = p_question;
end $$;

/** The question list: featured first, then the most upvoted. */
create or replace function public.get_live_questions(p_live uuid, p_status text default 'open', p_limit integer default 50)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', q.id, 'text', q.text, 'status', q.status, 'upvotes', q.upvotes, 'created_at', q.created_at,
                            'user', public.profile_card_json(q.user_id),
                            'my_vote', exists (select 1 from public.live_question_votes v where v.question_id = q.id and v.user_id = auth.uid()))
  from public.live_questions q
  where q.live_id = p_live
    and public.can_view_live(p_live)
    and (case when coalesce(p_status, 'open') = 'open' then q.status in ('pending', 'featured') else q.status = p_status end)
  order by (q.status = 'featured') desc, q.upvotes desc, q.created_at
  limit greatest(1, least(coalesce(p_limit, 50), 100))
$$;

-- ----------------------------------------------------------------------------
-- Supporter ranking for the running broadcast
-- ----------------------------------------------------------------------------
create or replace function public.get_live_top_supporters(p_live uuid, p_limit integer default 20)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('user', public.profile_card_json(s.sender_id), 'coins', s.coins, 'gifts', s.gifts,
                            'rank', row_number() over (order by s.coins desc, s.first_at))
  from (
    select g.sender_id, sum(g.coins_total)::bigint as coins, sum(g.quantity)::integer as gifts, min(g.created_at) as first_at
    from public.gifts g
    where g.target_type = 'live' and g.target_id = p_live and g.sender_id is not null
    group by g.sender_id
  ) s
  where public.can_view_live(p_live)
  order by s.coins desc, s.first_at
  limit greatest(1, least(coalesce(p_limit, 20), 100))
$$;

-- ----------------------------------------------------------------------------
-- Blocked words
-- ----------------------------------------------------------------------------
create or replace function public.set_live_comment_filter(p_word text, p_on boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_word text := lower(nullif(trim(coalesce(p_word, '')), ''));
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if v_word is null or char_length(v_word) < 2 then raise exception 'WORD_REQUIRED' using errcode = '23514', hint = 'Blocked words need at least two characters.'; end if;
  if char_length(v_word) > 40 then v_word := left(v_word, 40); end if;
  if coalesce(p_on, true) then
    if (select count(*) from public.live_comment_filters where user_id = v_me) >= 50 then
      raise exception 'TOO_MANY_WORDS' using errcode = 'P0001', hint = 'You can block up to 50 words.';
    end if;
    insert into public.live_comment_filters (user_id, word) values (v_me, v_word) on conflict do nothing;
  else
    delete from public.live_comment_filters where user_id = v_me and word = v_word;
  end if;
end $$;

create or replace function public.get_live_comment_filters()
returns setof text language sql stable security definer set search_path = public as $$
  select word from public.live_comment_filters where user_id = auth.uid() order by word
$$;

-- ----------------------------------------------------------------------------
-- Wire progress and filtering into the existing flows
-- ----------------------------------------------------------------------------

/** Replaces 0007: gift coins now also drive the goal bar. */
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
  values (g.target_id, g.sender_id, 'gift', 'sent ' || (v_json->'gift'->>'name') || case when g.quantity > 1 then ' x' || g.quantity else '' end,
          jsonb_build_object('gift', v_json->'gift', 'quantity', g.quantity, 'coins', g.coins_total, 'receiver_id', g.receiver_id));
  update public.live_battles set host_score = host_score + case when public.receiver_id_matches(g.receiver_id, host_id) then g.coins_total else 0 end,
                                 opponent_score = opponent_score + case when public.receiver_id_matches(g.receiver_id, opponent_id) then g.coins_total else 0 end
   where live_id = g.target_id and status = 'active' and ends_at > clock_timestamp();
  perform public.live_goal_bump(g.target_id, 'coins', g.coins_total);
end $$;

/** Replaces 0007: likes now also drive the goal bar. */
create or replace function public.like_live(p_id uuid, p_count integer default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n integer := least(100, greatest(1, coalesce(p_count, 1)));
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if not exists (select 1 from public.live_sessions l where l.id = p_id and l.status = 'live') or not public.can_view_live(p_id) then
    raise exception 'LIVE_NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.live_likes (live_id, user_id, count) values (p_id, auth.uid(), v_n)
  on conflict (live_id, user_id) do update set count = public.live_likes.count + v_n, updated_at = now();
  update public.live_sessions set likes_count = likes_count + v_n where id = p_id;
  perform public.live_goal_bump(p_id, 'likes', v_n);
  return jsonb_build_object('likes_count', (select likes_count from public.live_sessions where id = p_id));
end $$;

/** Replaces 0007: a comment holding one of the host's blocked words never reaches the room. */
create or replace function public.send_live_comment(p_id uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.live_sessions; v_me uuid := auth.uid(); v_last timestamptz; v_id uuid; v_clean text;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into v from public.live_sessions where id = p_id;
  if v.id is null or not public.can_view_live(p_id) then raise exception 'LIVE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.status <> 'live' then raise exception 'LIVE_OVER' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_text, '')), '') is null then raise exception 'TEXT_REQUIRED' using errcode = '23514'; end if;
  v_clean := left(trim(p_text), 300);
  if v.host_id <> v_me and not public.is_live_moderator(p_id, v_me) then
    if not v.allow_comments then raise exception 'COMMENTS_DISABLED' using errcode = '42501', hint = 'The host turned off comments.'; end if;
    if not public.can_interact(v.host_id, v_me, v.comment_audience) then raise exception 'COMMENTS_RESTRICTED' using errcode = '42501', hint = 'Only ' || v.comment_audience || ' can comment on this live.'; end if;
    if exists (select 1 from public.live_mutes m where m.live_id = p_id and m.user_id = v_me and m.until > now()) then raise exception 'MUTED' using errcode = '42501', hint = 'You have been muted in this broadcast.'; end if;
    if exists (select 1 from public.live_comment_filters f where f.user_id = v.host_id and position(f.word in lower(v_clean)) > 0) then
      raise exception 'COMMENT_FILTERED' using errcode = '42501', hint = 'That comment contains a word the host blocked.';
    end if;
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
  insert into public.live_comments (live_id, user_id, kind, text) values (p_id, v_me, 'comment', v_clean) returning id into v_id;
  update public.live_sessions set comments_count = comments_count + 1 where id = p_id;
  return public.live_comment_json((select c from public.live_comments c where c.id = v_id));
end $$;

/** Replaces 0007: the payload now carries the goal, the question on screen and the top supporters. */
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
    'fan_badge', public.fan_badge(l.host_id, p_viewer),
    'goal', (select jsonb_build_object('id', g.id, 'kind', g.kind, 'label', g.label, 'target', g.target, 'progress', least(g.progress, g.target), 'status', g.status, 'reached_at', g.reached_at)
               from public.live_goals g
              where g.live_id = l.id and (g.status = 'active' or (g.status = 'reached' and g.reached_at > now() - interval '2 minutes'))
              order by g.created_at desc limit 1),
    'featured_question', (select jsonb_build_object('id', q.id, 'text', q.text, 'upvotes', q.upvotes, 'user', public.profile_card_json(q.user_id))
                            from public.live_questions q where q.live_id = l.id and q.status = 'featured' limit 1),
    'questions_pending', (select count(*) from public.live_questions q where q.live_id = l.id and q.status = 'pending'),
    'top_supporters', coalesce((select jsonb_agg(s) from public.get_live_top_supporters(l.id, 3) s), '[]'::jsonb)
  )
$$;

-- ----------------------------------------------------------------------------
-- Realtime + grants
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['live_goals', 'live_questions'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.set_live_goal(uuid, text, bigint, text)', 'public.cancel_live_goal(uuid)',
    'public.ask_live_question(uuid, text)', 'public.vote_live_question(uuid, boolean)',
    'public.set_live_question(uuid, text)', 'public.get_live_questions(uuid, text, integer)',
    'public.get_live_top_supporters(uuid, integer)',
    'public.set_live_comment_filter(text, boolean)', 'public.get_live_comment_filters()'
  ] loop
    execute format('revoke all on function %s from anon, authenticated', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- Internal helper: never callable from a client.
revoke all on function public.live_goal_bump(uuid, text, bigint) from anon, authenticated;
