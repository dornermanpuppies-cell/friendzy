-- ============================================================================
-- Friendzy — Phase 8: social games
-- Game catalogue, rooms with invite codes, participants & seats, authoritative
-- state (written only by the game-engine Edge Function with the service role),
-- move log, results, ratings / leaderboards, room chat, and content banks for
-- Trivia, Would You Rather and Truth or Dare. Answer keys never reach clients.
-- ============================================================================

do $do$ begin
  create type public.game_status as enum ('waiting', 'playing', 'finished', 'cancelled');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.game_participant_state as enum ('invited', 'joined', 'left');
exception when duplicate_object then null; end $do$;

create table if not exists public.games (
  slug         text primary key,
  name         text not null,
  description  text not null,
  emoji        text not null,
  min_players  integer not null,
  max_players  integer not null,
  turn_seconds integer not null default 30,
  is_active    boolean not null default true,
  sort_order   integer not null default 0
);
revoke all on public.games from anon, authenticated;
grant select on public.games to authenticated;
insert into public.games (slug, name, description, emoji, min_players, max_players, turn_seconds, sort_order) values
  ('ludo', 'Ludo', 'Race your four tokens home. Roll a six to start, capture rivals, first to bring everyone home wins.', '🎲', 2, 4, 45, 1),
  ('chess', 'Chess', 'Classic chess with full rules, 60 seconds per move.', '♟️', 2, 2, 60, 2),
  ('trivia', 'Trivia', 'Ten quick questions. Answer fast for bonus points.', '🧠', 2, 8, 15, 3),
  ('would_you_rather', 'Would You Rather', 'Pick a side, then see how your friends voted.', '🤔', 2, 8, 20, 4),
  ('truth_or_dare', 'Truth or Dare', 'Take turns choosing truth or dare. Friends decide if you delivered.', '🔥', 2, 8, 60, 5),
  ('guess_the_song', 'Guess the Song', 'Hear a clip from the Friendzy sound library and name it first.', '🎵', 2, 8, 15, 6)
on conflict (slug) do nothing;

create table if not exists public.game_rooms (
  id                   uuid primary key default gen_random_uuid(),
  game                 text not null references public.games (slug),
  host_id              uuid not null references public.profiles (id) on delete cascade,
  status               public.game_status not null default 'waiting',
  is_private           boolean not null default false,
  invite_code          text unique,
  max_players          integer not null,
  state                jsonb not null default '{}'::jsonb,
  version              integer not null default 0,
  current_turn_user_id uuid references public.profiles (id) on delete set null,
  turn_deadline        timestamptz,
  round                integer not null default 0,
  winner_id            uuid references public.profiles (id) on delete set null,
  rematch_of           uuid references public.game_rooms (id) on delete set null,
  created_at           timestamptz not null default clock_timestamp(),
  started_at           timestamptz,
  finished_at          timestamptz,
  updated_at           timestamptz not null default clock_timestamp()
);
create index if not exists game_rooms_lobby_idx on public.game_rooms (game, status, created_at desc) where not is_private;
create index if not exists game_rooms_host_idx on public.game_rooms (host_id, created_at desc);
revoke all on public.game_rooms from anon, authenticated;
grant select on public.game_rooms to authenticated;

create table if not exists public.game_participants (
  room_id   uuid not null references public.game_rooms (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  seat      integer not null,
  state     public.game_participant_state not null default 'joined',
  score     integer not null default 0,
  is_ready  boolean not null default false,
  joined_at timestamptz not null default clock_timestamp(),
  left_at   timestamptz,
  primary key (room_id, user_id)
);
create unique index if not exists game_participants_seat_idx on public.game_participants (room_id, seat) where state <> 'left';
create index if not exists game_participants_user_idx on public.game_participants (user_id, joined_at desc);
revoke all on public.game_participants from anon, authenticated;
grant select on public.game_participants to authenticated;

create table if not exists public.game_moves (
  id         bigserial primary key,
  room_id    uuid not null references public.game_rooms (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete set null,
  seq        integer not null,
  move       jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (room_id, seq)
);
revoke all on public.game_moves from anon, authenticated;
grant select on public.game_moves to authenticated;

create table if not exists public.game_results (
  room_id      uuid not null references public.game_rooms (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  rank         integer not null,
  score        integer not null default 0,
  rating_delta integer not null default 0,
  created_at   timestamptz not null default clock_timestamp(),
  primary key (room_id, user_id)
);
create index if not exists game_results_user_idx on public.game_results (user_id, created_at desc);
revoke all on public.game_results from anon, authenticated;
grant select on public.game_results to authenticated;

create table if not exists public.game_ratings (
  game         text not null references public.games (slug),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  rating       integer not null default 1000,
  wins         integer not null default 0,
  losses       integer not null default 0,
  draws        integer not null default 0,
  games_played integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (game, user_id)
);
create index if not exists game_ratings_leaderboard_idx on public.game_ratings (game, rating desc);
revoke all on public.game_ratings from anon, authenticated;
grant select on public.game_ratings to authenticated;

create table if not exists public.game_messages (
  id         bigserial primary key,
  room_id    uuid not null references public.game_rooms (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete set null,
  text       text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint game_messages_text_len check (char_length(text) between 1 and 300)
);
create index if not exists game_messages_room_idx on public.game_messages (room_id, id desc);
revoke all on public.game_messages from anon, authenticated;
grant select on public.game_messages to authenticated;

-- Content banks (service-role only: answer keys must never reach clients).
create table if not exists public.trivia_questions (
  id           serial primary key,
  category     text not null,
  difficulty   text not null default 'easy',
  question     text not null,
  options      jsonb not null,
  answer_index integer not null,
  is_active    boolean not null default true,
  constraint trivia_options check (jsonb_array_length(options) = 4 and answer_index between 0 and 3)
);
revoke all on public.trivia_questions from public, anon, authenticated;
grant select on public.trivia_questions to service_role;
create unique index if not exists trivia_questions_question_key on public.trivia_questions (question);

create table if not exists public.party_prompts (
  id        serial primary key,
  game      text not null references public.games (slug),
  kind      text not null,
  text      text not null,
  spice     text not null default 'mild',
  is_active boolean not null default true,
  constraint party_prompts_kind check (kind in ('wyr', 'truth', 'dare'))
);
revoke all on public.party_prompts from public, anon, authenticated;
grant select on public.party_prompts to service_role;
create unique index if not exists party_prompts_unique_key on public.party_prompts (game, kind, text);

insert into public.trivia_questions (category, difficulty, question, options, answer_index) values
  ('Geography', 'easy', 'Which is the largest ocean on Earth?', '["Atlantic", "Indian", "Pacific", "Arctic"]', 2),
  ('Geography', 'easy', 'What is the capital city of Canada?', '["Toronto", "Vancouver", "Ottawa", "Montreal"]', 2),
  ('Geography', 'medium', 'Which river flows through Cairo?', '["Tigris", "Nile", "Niger", "Congo"]', 1),
  ('Geography', 'medium', 'Which country has the most time zones?', '["Russia", "United States", "France", "China"]', 2),
  ('Geography', 'easy', 'Mount Kilimanjaro is located in which country?', '["Kenya", "Tanzania", "Ethiopia", "Uganda"]', 1),
  ('Science', 'easy', 'What gas do plants mainly absorb from the air?', '["Oxygen", "Nitrogen", "Carbon dioxide", "Helium"]', 2),
  ('Science', 'easy', 'How many planets are in our solar system?', '["7", "8", "9", "10"]', 1),
  ('Science', 'medium', 'What is the chemical symbol for gold?', '["Ag", "Gd", "Au", "Go"]', 2),
  ('Science', 'medium', 'Which part of the cell contains genetic material?', '["Ribosome", "Nucleus", "Membrane", "Cytoplasm"]', 1),
  ('Science', 'hard', 'What is the speed of light in a vacuum, approximately?', '["300,000 km/s", "150,000 km/s", "3,000 km/s", "30,000 km/s"]', 0),
  ('Music', 'easy', 'How many strings does a standard guitar have?', '["4", "5", "6", "7"]', 2),
  ('Music', 'medium', 'Which instrument has 88 keys?', '["Organ", "Piano", "Accordion", "Harpsichord"]', 1),
  ('Music', 'medium', 'K-pop originates from which country?', '["Japan", "China", "South Korea", "Thailand"]', 2),
  ('Movies', 'easy', 'Which studio created the character Buzz Lightyear?', '["DreamWorks", "Pixar", "Illumination", "Ghibli"]', 1),
  ('Movies', 'medium', 'In which decade was the first Star Wars film released?', '["1960s", "1970s", "1980s", "1990s"]', 1),
  ('Sports', 'easy', 'How many players are on a soccer team on the field?', '["9", "10", "11", "12"]', 2),
  ('Sports', 'easy', 'In which sport would you perform a slam dunk?', '["Volleyball", "Basketball", "Tennis", "Rugby"]', 1),
  ('Sports', 'medium', 'How often are the Summer Olympic Games held?', '["Every 2 years", "Every 3 years", "Every 4 years", "Every 5 years"]', 2),
  ('History', 'easy', 'Who was the first person to walk on the Moon?', '["Buzz Aldrin", "Yuri Gagarin", "Neil Armstrong", "Michael Collins"]', 2),
  ('History', 'medium', 'The Great Wall is located in which country?', '["Japan", "India", "China", "Mongolia"]', 2),
  ('History', 'medium', 'In which year did the Berlin Wall fall?', '["1985", "1989", "1991", "1995"]', 1),
  ('Technology', 'easy', 'What does "www" stand for in a website address?', '["World Wide Web", "Web World Wide", "Wide World Web", "World Web Wide"]', 0),
  ('Technology', 'medium', 'Which company makes the Android operating system?', '["Apple", "Microsoft", "Google", "Samsung"]', 2),
  ('Technology', 'hard', 'What does CPU stand for?', '["Central Process Unit", "Central Processing Unit", "Computer Personal Unit", "Core Processing Utility"]', 1),
  ('Food', 'easy', 'Sushi originally comes from which country?', '["China", "Thailand", "Japan", "Vietnam"]', 2),
  ('Food', 'easy', 'Which fruit is known for having its seeds on the outside?', '["Kiwi", "Strawberry", "Raspberry", "Fig"]', 1),
  ('Food', 'medium', 'Paella is a traditional dish from which country?', '["Italy", "Portugal", "Spain", "Greece"]', 2),
  ('Animals', 'easy', 'What is the largest animal on Earth?', '["African elephant", "Blue whale", "Giraffe", "Great white shark"]', 1),
  ('Animals', 'easy', 'How many legs does a spider have?', '["6", "8", "10", "12"]', 1),
  ('Animals', 'medium', 'Which bird is known for mimicking human speech?', '["Owl", "Parrot", "Eagle", "Pigeon"]', 1),
  ('Language', 'easy', 'Which language has the most native speakers?', '["English", "Spanish", "Mandarin Chinese", "Hindi"]', 2),
  ('Language', 'medium', 'What does "bonjour" mean in English?', '["Goodbye", "Thank you", "Hello", "Please"]', 2),
  ('Art', 'medium', 'Who painted the Mona Lisa?', '["Michelangelo", "Leonardo da Vinci", "Raphael", "Donatello"]', 1),
  ('Art', 'medium', 'Which artist is famous for cutting off part of his own ear?', '["Pablo Picasso", "Claude Monet", "Vincent van Gogh", "Salvador Dalí"]', 2),
  ('Space', 'easy', 'Which planet is known as the Red Planet?', '["Venus", "Mars", "Jupiter", "Saturn"]', 1),
  ('Space', 'medium', 'What is the name of our galaxy?', '["Andromeda", "Milky Way", "Whirlpool", "Sombrero"]', 1),
  ('Math', 'easy', 'What is 12 multiplied by 12?', '["124", "132", "144", "156"]', 2),
  ('Math', 'medium', 'How many sides does a hexagon have?', '["5", "6", "7", "8"]', 1),
  ('Literature', 'medium', 'Who wrote "Romeo and Juliet"?', '["Charles Dickens", "William Shakespeare", "Jane Austen", "Mark Twain"]', 1),
  ('Literature', 'medium', 'In which school did Harry Potter study?', '["Beauxbatons", "Durmstrang", "Hogwarts", "Ilvermorny"]', 2)
on conflict (question) do nothing;

insert into public.party_prompts (game, kind, text, spice) values
  ('would_you_rather', 'wyr', 'Would you rather be able to fly or be invisible?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather always be 10 minutes late or always 20 minutes early?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather give up music or give up movies for a year?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather travel to the past or to the future?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather live by the beach or in the mountains?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather have unlimited coffee or unlimited pizza?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather speak every language or play every instrument?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather never use social media again or never watch TV again?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather be famous or be the best friend of someone famous?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather explore space or the deep ocean?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather have a rewind button or a pause button for your life?', 'medium'),
  ('would_you_rather', 'wyr', 'Would you rather know how you die or when you die?', 'medium'),
  ('would_you_rather', 'wyr', 'Would you rather lose all your photos or all your messages?', 'medium'),
  ('would_you_rather', 'wyr', 'Would you rather be the funniest or the smartest person in the room?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather work four long days or five short days?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather have a personal chef or a personal driver?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather read minds or see the future one day ahead?', 'medium'),
  ('would_you_rather', 'wyr', 'Would you rather sing everything you say or dance everywhere you go?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather live without a phone or without a laptop?', 'mild'),
  ('would_you_rather', 'wyr', 'Would you rather have winter all year or summer all year?', 'mild'),
  ('truth_or_dare', 'truth', 'What is the most embarrassing song on your playlist?', 'mild'),
  ('truth_or_dare', 'truth', 'What is a talent nobody here knows you have?', 'mild'),
  ('truth_or_dare', 'truth', 'What was your first impression of the host?', 'mild'),
  ('truth_or_dare', 'truth', 'What is the last thing you searched for online?', 'medium'),
  ('truth_or_dare', 'truth', 'What is your guilty pleasure TV show?', 'mild'),
  ('truth_or_dare', 'truth', 'Who in this group would you call first in an emergency?', 'mild'),
  ('truth_or_dare', 'truth', 'What is the weirdest food combination you secretly love?', 'mild'),
  ('truth_or_dare', 'truth', 'What is the longest you have gone without checking your phone?', 'mild'),
  ('truth_or_dare', 'truth', 'What is one thing on your bucket list you have told nobody?', 'medium'),
  ('truth_or_dare', 'truth', 'What is the most childish thing you still do?', 'mild'),
  ('truth_or_dare', 'dare', 'Send the group a voice note singing the chorus of your favourite song.', 'mild'),
  ('truth_or_dare', 'dare', 'Talk in an accent for the next two rounds.', 'mild'),
  ('truth_or_dare', 'dare', 'Share the last photo in your camera roll (keep it kind!).', 'medium'),
  ('truth_or_dare', 'dare', 'Do your best impression of someone in the room.', 'mild'),
  ('truth_or_dare', 'dare', 'Post a story with the caption chosen by the group.', 'medium'),
  ('truth_or_dare', 'dare', 'Speak only in questions until your next turn.', 'mild'),
  ('truth_or_dare', 'dare', 'Give everyone in the room a sincere compliment.', 'mild'),
  ('truth_or_dare', 'dare', 'Do ten jumping jacks on camera.', 'mild'),
  ('truth_or_dare', 'dare', 'Let the group pick your profile status for the next hour.', 'medium'),
  ('truth_or_dare', 'dare', 'Describe your day in three emojis only.', 'mild')
on conflict (game, kind, text) do nothing;

-- ----------------------------------------------------------------------------
-- Helpers & JSON
-- ----------------------------------------------------------------------------
create or replace function public.is_game_member(p_room uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.game_participants p where p.room_id = p_room and p.user_id = p_user and p.state <> 'left')
$$;

-- Any participation record (invited / joined / left) — used by policies, so it must not read through RLS.
create or replace function public.has_game_seat(p_room uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.game_participants p where p.room_id = p_room and p.user_id = p_user)
$$;

create or replace function public.game_room_visible(p_room uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.game_rooms r where r.id = p_room and (not r.is_private or public.has_game_seat(r.id, p_user))) or public.is_admin()
$$;

create or replace function public.game_invite_code()
returns text language sql volatile as $$
  select upper(substr(replace(replace(encode(extensions.gen_random_bytes(6), 'base64'), '/', 'A'), '+', 'B'), 1, 6))
$$;

create or replace function public.game_room_json(r public.game_rooms, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'game', r.game, 'status', r.status, 'is_private', r.is_private, 'max_players', r.max_players,
    'invite_code', case when public.is_game_member(r.id, p_viewer) then r.invite_code else null end,
    'host', public.profile_card_json(r.host_id), 'is_host', r.host_id = p_viewer,
    'state', coalesce(r.state - 'secret', '{}'::jsonb),
    'version', r.version, 'current_turn_user_id', r.current_turn_user_id, 'turn_deadline', r.turn_deadline, 'round', r.round, 'winner_id', r.winner_id, 'rematch_of', r.rematch_of,
    'created_at', r.created_at, 'started_at', r.started_at, 'finished_at', r.finished_at,
    'game_info', (select jsonb_build_object('name', g.name, 'emoji', g.emoji, 'min_players', g.min_players, 'max_players', g.max_players, 'turn_seconds', g.turn_seconds) from public.games g where g.slug = r.game),
    'participants', coalesce((select jsonb_agg(public.profile_card_json(p.user_id) || jsonb_build_object('seat', p.seat, 'state', p.state, 'score', p.score, 'is_ready', p.is_ready) order by p.seat) from public.game_participants p where p.room_id = r.id), '[]'::jsonb),
    'my_seat', (select p.seat from public.game_participants p where p.room_id = r.id and p.user_id = p_viewer),
    'my_state', (select p.state from public.game_participants p where p.room_id = r.id and p.user_id = p_viewer),
    'results', case when r.status = 'finished' then coalesce((select jsonb_agg(jsonb_build_object('user', public.profile_card_json(x.user_id), 'rank', x.rank, 'score', x.score, 'rating_delta', x.rating_delta) order by x.rank) from public.game_results x where x.room_id = r.id), '[]'::jsonb) else null end,
    'moves_count', (select count(*) from public.game_moves m where m.room_id = r.id)
  )
$$;

-- ----------------------------------------------------------------------------
-- Lobby RPCs (clients)
-- ----------------------------------------------------------------------------
create or replace function public.create_game_room(p_game text, p_is_private boolean default false, p_max_players integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); g public.games; v_id uuid; v_max integer;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into g from public.games where slug = p_game and is_active;
  if not found then raise exception 'GAME_NOT_FOUND' using errcode = 'P0002'; end if;
  if exists (select 1 from public.game_rooms r join public.game_participants p on p.room_id = r.id where p.user_id = v_me and p.state = 'joined' and r.status in ('waiting', 'playing')) then
    raise exception 'ALREADY_IN_GAME' using errcode = 'P0001', hint = 'Leave your current game before starting another.';
  end if;
  v_max := least(g.max_players, greatest(g.min_players, coalesce(p_max_players, g.max_players)));
  insert into public.game_rooms (game, host_id, is_private, invite_code, max_players) values (p_game, v_me, coalesce(p_is_private, false), public.game_invite_code(), v_max) returning id into v_id;
  insert into public.game_participants (room_id, user_id, seat, state, is_ready) values (v_id, v_me, 0, 'joined', true);
  return public.game_room_json((select r from public.game_rooms r where r.id = v_id), v_me);
end $$;

create or replace function public.join_game_room(p_room uuid default null, p_code text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); r public.game_rooms; v_seat integer; v_existing public.game_participants;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_room is not null then select * into r from public.game_rooms where id = p_room for update;
  elsif p_code is not null then select * into r from public.game_rooms where invite_code = upper(trim(p_code)) for update;
  end if;
  if r.id is null then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002', hint = 'That game room does not exist or the code is wrong.'; end if;
  if public.is_blocked_either(v_me, r.host_id) then raise exception 'BLOCKED' using errcode = '42501'; end if;
  select * into v_existing from public.game_participants where room_id = r.id and user_id = v_me;
  if v_existing.user_id is not null and v_existing.state = 'joined' then return public.game_room_json(r, v_me); end if;
  if r.status <> 'waiting' then
    if v_existing.user_id is not null and r.status = 'playing' then
      update public.game_participants set state = 'joined' where room_id = r.id and user_id = v_me; -- rejoin an ongoing game
      return public.game_room_json(r, v_me);
    end if;
    raise exception 'ROOM_CLOSED' using errcode = 'P0001', hint = 'This game has already started.';
  end if;
  if r.is_private and p_code is null and (v_existing.user_id is null or v_existing.state <> 'invited') then
    raise exception 'PRIVATE_ROOM' using errcode = '42501', hint = 'You need an invite or the room code.';
  end if;
  if exists (select 1 from public.game_rooms x join public.game_participants p on p.room_id = x.id where p.user_id = v_me and p.state = 'joined' and x.status in ('waiting', 'playing') and x.id <> r.id) then
    raise exception 'ALREADY_IN_GAME' using errcode = 'P0001', hint = 'Leave your current game first.';
  end if;
  if (select count(*) from public.game_participants where room_id = r.id and state = 'joined') >= r.max_players then
    raise exception 'ROOM_FULL' using errcode = 'P0001', hint = 'This room is full.';
  end if;
  select coalesce(min(s), 0) into v_seat from generate_series(0, r.max_players - 1) s where s not in (select seat from public.game_participants where room_id = r.id and state <> 'left');
  if v_existing.user_id is not null then
    update public.game_participants set state = 'joined', seat = coalesce(case when v_existing.state = 'left' then v_seat else v_existing.seat end, v_seat), is_ready = false, joined_at = clock_timestamp(), left_at = null where room_id = r.id and user_id = v_me;
  else
    insert into public.game_participants (room_id, user_id, seat, state) values (r.id, v_me, v_seat, 'joined');
  end if;
  update public.game_rooms set updated_at = clock_timestamp() where id = r.id;
  return public.game_room_json((select x from public.game_rooms x where x.id = r.id), v_me);
end $$;

create or replace function public.leave_game_room(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.game_rooms; v_next uuid; v_remaining integer;
begin
  select * into r from public.game_rooms where id = p_room for update;
  if r.id is null then return; end if;
  update public.game_participants set state = 'left', left_at = clock_timestamp(), is_ready = false where room_id = p_room and user_id = auth.uid() and state <> 'left';
  select count(*) into v_remaining from public.game_participants where room_id = p_room and state = 'joined';
  if r.status = 'waiting' then
    if v_remaining = 0 then
      update public.game_rooms set status = 'cancelled', finished_at = clock_timestamp(), updated_at = clock_timestamp() where id = p_room;
    elsif r.host_id = auth.uid() then
      select user_id into v_next from public.game_participants where room_id = p_room and state = 'joined' order by joined_at limit 1;
      update public.game_rooms set host_id = v_next, updated_at = clock_timestamp() where id = p_room;
    end if;
  elsif r.status = 'playing' then
    -- Engine-side forfeit handling happens in the game-engine function; mark the leave as a move request.
    insert into public.game_moves (room_id, user_id, seq, move) values (p_room, auth.uid(), (select coalesce(max(seq), 0) + 1 from public.game_moves where room_id = p_room), jsonb_build_object('type', 'leave'));
    update public.game_rooms set updated_at = clock_timestamp() where id = p_room;
  end if;
end $$;

create or replace function public.invite_to_game(p_room uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.game_rooms; v_seat integer;
begin
  select * into r from public.game_rooms where id = p_room;
  if r.id is null or not public.is_game_member(p_room) then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002'; end if;
  if r.status <> 'waiting' then raise exception 'ROOM_CLOSED' using errcode = 'P0001'; end if;
  if public.is_blocked_either(auth.uid(), p_user) then raise exception 'BLOCKED' using errcode = '42501'; end if;
  select coalesce(min(s), r.max_players - 1) into v_seat from generate_series(0, r.max_players - 1) s where s not in (select seat from public.game_participants where room_id = r.id and state <> 'left');
  insert into public.game_participants (room_id, user_id, seat, state) values (p_room, p_user, v_seat, 'invited')
  on conflict (room_id, user_id) do update set state = case when public.game_participants.state = 'left' then 'invited' else public.game_participants.state end;
  perform public.create_notification(p_user, auth.uid(), 'game_invite', 'game_room', p_room::text, jsonb_build_object('game', r.game, 'code', r.invite_code));
end $$;

create or replace function public.set_game_ready(p_room uuid, p_ready boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.game_participants set is_ready = coalesce(p_ready, true) where room_id = p_room and user_id = auth.uid() and state = 'joined';
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.game_rooms set updated_at = clock_timestamp() where id = p_room;
  return public.game_room_json((select r from public.game_rooms r where r.id = p_room), auth.uid());
end $$;

create or replace function public.get_game_room(p_room uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.game_room_json(r, auth.uid()) from public.game_rooms r
  where r.id = p_room and public.game_room_visible(r.id)
$$;

create or replace function public.list_game_rooms(p_game text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'mine', coalesce((select jsonb_agg(public.game_room_json(r, auth.uid()) order by r.updated_at desc)
             from (select distinct r.* from public.game_rooms r join public.game_participants p on p.room_id = r.id where p.user_id = auth.uid() and p.state <> 'left' and r.status in ('waiting', 'playing') order by r.updated_at desc limit 10) r), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(public.game_room_json(r, auth.uid()) order by r.created_at desc)
             from (select r.* from public.game_rooms r join public.game_participants p on p.room_id = r.id where p.user_id = auth.uid() and p.state = 'invited' and r.status = 'waiting' order by r.created_at desc limit 10) r), '[]'::jsonb),
    'open', coalesce((select jsonb_agg(public.game_room_json(r, auth.uid()) order by r.created_at desc)
             from (select r.* from public.game_rooms r where r.status = 'waiting' and not r.is_private and (p_game is null or r.game = p_game)
                   and not public.is_blocked_either(auth.uid(), r.host_id) and r.created_at > now() - interval '2 hours'
                   and (select count(*) from public.game_participants p where p.room_id = r.id and p.state = 'joined') < r.max_players
                   order by r.created_at desc limit 30) r), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(jsonb_build_object('slug', g.slug, 'name', g.name, 'description', g.description, 'emoji', g.emoji, 'min_players', g.min_players, 'max_players', g.max_players, 'turn_seconds', g.turn_seconds,
                 'playing_now', (select count(*) from public.game_rooms r where r.game = g.slug and r.status = 'playing')) order by g.sort_order) from public.games g where g.is_active), '[]'::jsonb))
$$;

create or replace function public.get_leaderboard(p_game text, p_limit integer default 20)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'top', coalesce((select jsonb_agg(jsonb_build_object('user', public.profile_card_json(x.user_id), 'rating', x.rating, 'wins', x.wins, 'losses', x.losses, 'draws', x.draws, 'games_played', x.games_played, 'rank', x.rn) order by x.rn)
            from (select r.*, row_number() over (order by r.rating desc, r.wins desc) rn from public.game_ratings r join public.profiles p on p.id = r.user_id where r.game = p_game and p.account_status = 'active') x where x.rn <= greatest(1, least(coalesce(p_limit, 20), 100))), '[]'::jsonb),
    'me', (select jsonb_build_object('rating', x.rating, 'wins', x.wins, 'losses', x.losses, 'draws', x.draws, 'games_played', x.games_played, 'rank', x.rn)
           from (select r.*, row_number() over (order by r.rating desc, r.wins desc) rn from public.game_ratings r where r.game = p_game) x where x.user_id = auth.uid()))
$$;

create or replace function public.get_my_game_history(p_limit integer default 20)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select public.game_room_json(r, auth.uid()) from public.game_rooms r join public.game_results x on x.room_id = r.id and x.user_id = auth.uid()
  where r.status = 'finished' order by r.finished_at desc limit greatest(1, least(coalesce(p_limit, 20), 100))
$$;

create or replace function public.send_game_message(p_room uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.is_game_member(p_room) then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002'; end if;
  if nullif(trim(coalesce(p_text, '')), '') is null then raise exception 'TEXT_REQUIRED' using errcode = '23514'; end if;
  insert into public.game_messages (room_id, user_id, text) values (p_room, auth.uid(), left(trim(p_text), 300)) returning id into v_id;
  return (select jsonb_build_object('id', m.id, 'user', public.profile_card_json(m.user_id), 'text', m.text, 'created_at', m.created_at) from public.game_messages m where m.id = v_id);
end $$;

create or replace function public.get_game_messages(p_room uuid, p_limit integer default 50)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', m.id, 'user', case when m.user_id is null then null else public.profile_card_json(m.user_id) end, 'text', m.text, 'created_at', m.created_at)
  from public.game_messages m where m.room_id = p_room and public.is_game_member(p_room) order by m.id desc limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

-- ----------------------------------------------------------------------------
-- Engine-side (service role): apply results & ratings atomically
-- ----------------------------------------------------------------------------
create or replace function public.apply_game_results(p_room uuid, p_results jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r public.game_rooms; item jsonb; v_user uuid; v_rank integer; v_score integer; v_delta integer; v_players integer; v_winner uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into r from public.game_rooms where id = p_room for update;
  if r.id is null or r.status = 'finished' then return; end if;
  v_players := jsonb_array_length(p_results);
  for item in select * from jsonb_array_elements(p_results) loop
    v_user := (item->>'user_id')::uuid; v_rank := (item->>'rank')::int; v_score := coalesce((item->>'score')::int, 0);
    v_delta := case when v_players <= 1 then 0 when v_rank = 1 and (item->>'draw')::boolean is distinct from true then 25 when (item->>'draw')::boolean then 0 else -15 end;
    insert into public.game_results (room_id, user_id, rank, score, rating_delta) values (p_room, v_user, v_rank, v_score, v_delta) on conflict (room_id, user_id) do update set rank = excluded.rank, score = excluded.score, rating_delta = excluded.rating_delta;
    insert into public.game_ratings (game, user_id, rating, wins, losses, draws, games_played)
    values (r.game, v_user, 1000 + v_delta, case when v_delta > 0 then 1 else 0 end, case when v_delta < 0 then 1 else 0 end, case when v_delta = 0 and v_players > 1 then 1 else 0 end, 1)
    on conflict (game, user_id) do update set rating = greatest(100, public.game_ratings.rating + v_delta), wins = public.game_ratings.wins + case when v_delta > 0 then 1 else 0 end,
      losses = public.game_ratings.losses + case when v_delta < 0 then 1 else 0 end, draws = public.game_ratings.draws + case when v_delta = 0 and v_players > 1 then 1 else 0 end,
      games_played = public.game_ratings.games_played + 1, updated_at = now();
    update public.game_participants set score = v_score where room_id = p_room and user_id = v_user;
    if v_rank = 1 and (item->>'draw')::boolean is distinct from true then v_winner := v_user; end if;
  end loop;
  update public.game_rooms set status = 'finished', finished_at = clock_timestamp(), winner_id = v_winner, current_turn_user_id = null, turn_deadline = null, updated_at = clock_timestamp() where id = p_room;
end $$;

create or replace function public.create_rematch(p_room uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.game_rooms; v_id uuid; p record; v_seat integer := 0;
begin
  select * into r from public.game_rooms where id = p_room;
  if r.id is null or r.status <> 'finished' or not exists (select 1 from public.game_participants x where x.room_id = p_room and x.user_id = auth.uid()) then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002';
  end if;
  select id into v_id from public.game_rooms where rematch_of = p_room and status in ('waiting', 'playing') limit 1;
  if v_id is not null then return public.join_game_room(v_id); end if;
  insert into public.game_rooms (game, host_id, is_private, invite_code, max_players, rematch_of) values (r.game, auth.uid(), true, public.game_invite_code(), r.max_players, p_room) returning id into v_id;
  insert into public.game_participants (room_id, user_id, seat, state, is_ready) values (v_id, auth.uid(), 0, 'joined', true);
  v_seat := 1;
  for p in select user_id from public.game_participants where room_id = p_room and user_id <> auth.uid() order by seat loop
    insert into public.game_participants (room_id, user_id, seat, state) values (v_id, p.user_id, v_seat, 'invited');
    perform public.create_notification(p.user_id, auth.uid(), 'game_invite', 'game_room', v_id::text, jsonb_build_object('game', r.game, 'rematch', true));
    v_seat := v_seat + 1;
  end loop;
  return public.game_room_json((select x from public.game_rooms x where x.id = v_id), auth.uid());
end $$;

-- ----------------------------------------------------------------------------
-- Privileges, RLS, realtime
-- ----------------------------------------------------------------------------
do $do$
declare f text;
begin
  foreach f in array array[
    'public.is_game_member(uuid, uuid)', 'public.has_game_seat(uuid, uuid)', 'public.game_room_visible(uuid, uuid)', 'public.game_room_json(public.game_rooms, uuid)', 'public.create_game_room(text, boolean, integer)', 'public.join_game_room(uuid, text)',
    'public.leave_game_room(uuid)', 'public.invite_to_game(uuid, uuid)', 'public.set_game_ready(uuid, boolean)', 'public.get_game_room(uuid)', 'public.list_game_rooms(text)',
    'public.get_leaderboard(text, integer)', 'public.get_my_game_history(integer)', 'public.send_game_message(uuid, text)', 'public.get_game_messages(uuid, integer)', 'public.create_rematch(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['public.game_invite_code()', 'public.apply_game_results(uuid, jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $do$;

alter table public.games enable row level security;
alter table public.game_rooms enable row level security;
alter table public.game_participants enable row level security;
alter table public.game_moves enable row level security;
alter table public.game_results enable row level security;
alter table public.game_ratings enable row level security;
alter table public.game_messages enable row level security;
alter table public.trivia_questions enable row level security;
alter table public.party_prompts enable row level security;

drop policy if exists "games_select" on public.games;
create policy "games_select" on public.games for select to authenticated using (is_active);
drop policy if exists "game_rooms_select" on public.game_rooms;
create policy "game_rooms_select" on public.game_rooms for select to authenticated using (not is_private or public.has_game_seat(id) or public.is_admin());
drop policy if exists "game_participants_select" on public.game_participants;
create policy "game_participants_select" on public.game_participants for select to authenticated using (user_id = auth.uid() or public.game_room_visible(room_id));
drop policy if exists "game_moves_select" on public.game_moves;
create policy "game_moves_select" on public.game_moves for select to authenticated using (public.has_game_seat(room_id));
drop policy if exists "game_results_select" on public.game_results;
create policy "game_results_select" on public.game_results for select to authenticated using (true);
drop policy if exists "game_ratings_select" on public.game_ratings;
create policy "game_ratings_select" on public.game_ratings for select to authenticated using (true);
drop policy if exists "game_messages_select" on public.game_messages;
create policy "game_messages_select" on public.game_messages for select to authenticated using (public.is_game_member(room_id));
-- Content banks: no client policies at all (service role bypasses RLS).

do $do$
declare t text;
begin
  foreach t in array array['game_rooms', 'game_participants', 'game_moves', 'game_messages'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $do$;
alter table public.game_rooms replica identity full;
alter table public.game_participants replica identity full;
