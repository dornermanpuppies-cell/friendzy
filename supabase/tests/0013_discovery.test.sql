-- Tests for 20261125000013_discovery.sql
do $t$
declare
  alice uuid; bob uuid; carol uuid; dave uuid; erin uuid; kid1 uuid; kid2 uuid;
  v jsonb; v2 jsonb; v_music int; v_gaming int; v_travel int; v_card jsonb; v_req uuid; v_match uuid; v_conv uuid;
begin
  alice := tests.create_user('alice@disc.test', '{"display_name":"Alice Lane","username":"alice","birth_date":"1995-01-01","country_code":"US","gender":"woman"}');
  bob   := tests.create_user('bob@disc.test',   '{"display_name":"Bob Stone","username":"bob","birth_date":"1992-06-15","country_code":"GB","gender":"man"}');
  carol := tests.create_user('carol@disc.test', '{"display_name":"Carol Diaz","username":"carol","birth_date":"1990-03-03","country_code":"ES","gender":"woman"}');
  dave  := tests.create_user('dave@disc.test',  '{"display_name":"Dave Kim","username":"dave","birth_date":"1988-12-12","country_code":"US","gender":"man"}');
  erin  := tests.create_user('erin@disc.test',  '{"display_name":"Erin Blocked","username":"erin","birth_date":"1991-01-01","country_code":"FR"}');
  kid1  := tests.create_user('kid1@disc.test',  '{"display_name":"Kid One","username":"kidone","birth_date":"2009-05-05","country_code":"US"}');
  kid2  := tests.create_user('kid2@disc.test',  '{"display_name":"Kid Two","username":"kidtwo","birth_date":"2009-08-08","country_code":"US"}');

  select id into v_music from public.interests where slug = 'music';
  select id into v_gaming from public.interests where slug = 'gaming';
  select id into v_travel from public.interests where slug = 'travel';
  perform tests.assert(v_music is not null and v_gaming is not null, 'interest catalogue seeded');

  -- Profiles complete + interests + languages (rows written as each user)
  perform tests.as_admin_db();
  update public.profiles set onboarding_completed = true, city = case id when alice then 'Austin' when dave then 'Austin' when carol then 'Madrid' when bob then 'London' else null end
   where id in (alice, bob, carol, dave, erin, kid1, kid2);
  update public.profiles set popularity_score = 120 where id = carol;
  update public.profiles set created_at = now() - interval '90 days' where id in (dave, carol);
  insert into public.user_interests (user_id, interest_id) values (alice, v_music), (alice, v_gaming), (bob, v_music), (bob, v_gaming), (carol, v_music), (dave, v_travel), (kid1, v_music), (kid2, v_music);
  perform tests.as_user(alice);
  insert into public.user_languages (user_id, code) values (alice, 'en'), (alice, 'es');
  perform tests.assert_raises(format($$insert into public.user_languages (user_id, code) values ('%s', 'de')$$, bob), 'cannot add languages for someone else', 'row-level security');
  perform tests.assert_raises($$insert into public.user_languages (user_id, code) values (auth.uid(), 'english')$$, 'language code validated', 'user_languages_code');
  perform tests.as_user(bob);
  insert into public.user_languages (user_id, code) values (bob, 'en');
  perform tests.as_user(carol);
  insert into public.user_languages (user_id, code) values (carol, 'es');
  update public.user_settings set show_languages = false, show_age = true where user_id = carol;
  perform tests.as_user(dave);
  update public.user_settings set show_city = false, show_online_status = false, show_last_seen = false where user_id = dave;
  perform tests.as_user(bob);
  update public.user_settings set show_age = true where user_id = bob;

  -- Blocks: erin blocked alice
  perform tests.as_user(erin);
  perform public.block_user(alice);

  -- Presence: bob online, carol seen 2h ago, dave online but hidden
  perform tests.as_user(bob); perform public.touch_presence(true);
  perform tests.as_user(dave); perform public.touch_presence(true);
  perform tests.as_admin_db();
  insert into public.user_presence (user_id, is_online, last_seen_at) values (carol, false, now() - interval '2 hours') on conflict (user_id) do update set is_online = false, last_seen_at = now() - interval '2 hours';

  -- ---------------------------------------------------------------- cards & privacy
  perform tests.as_user(alice);
  v_card := public.discover_card_json(bob, alice);
  perform tests.assert(v_card->>'username' = 'bob' and (v_card->>'shared_interests')::int = 2 and (v_card->>'age')::int between 30 and 40 and v_card->>'country_code' = 'GB' and v_card->>'city' = 'London', 'card shows shared interests, age (opted in), country, city: ' || v_card::text);
  perform tests.assert((v_card->'presence'->>'is_online')::boolean, 'card shows online status when allowed');
  perform tests.assert((v_card->'interests'->0->>'shared')::boolean, 'shared interests listed first');
  perform tests.assert(v_card->'languages' = '["en"]'::jsonb and (v_card->>'shared_languages')::int = 1, 'languages + shared languages');
  v_card := public.discover_card_json(carol, alice);
  perform tests.assert(v_card->'languages' = '[]'::jsonb and (v_card->>'shared_languages')::int = 0, 'hidden languages are not exposed');
  v_card := public.discover_card_json(dave, alice);
  perform tests.assert(v_card->>'city' is null and v_card->>'country_code' = 'US' and v_card->'presence'->>'is_online' is null and v_card->'presence'->>'last_seen_at' is null and v_card->>'age' is null, 'hidden city / presence / age are not exposed');
  perform tests.assert(v_card->'relationship'->>'is_friend' = 'false' and v_card->'relationship'->'friend_request' = 'null'::jsonb, 'relationship embedded');
  perform tests.assert((public.get_discover_card(bob)->>'username') = 'bob' and public.get_discover_card(erin) is null and (public.get_discover_card(alice)->>'username') = 'alice', 'single card respects blocks and works for self');

  -- ---------------------------------------------------------------- discover sections
  v := public.discover_people('recommended', 20, 0);
  perform tests.assert(jsonb_array_length(v) = 3, 'recommended: bob, carol, dave (erin blocked, minors hidden from adults): ' || jsonb_array_length(v)::text);
  perform tests.assert(v->0->>'username' = 'bob', 'recommended ranks the best match first (2 shared interests + shared language)');
  perform tests.assert(not exists (select 1 from jsonb_array_elements(v) e where e->>'username' in ('erin', 'kidone', 'kidtwo', 'alice')), 'recommended excludes blocked, minors and self');
  v := public.discover_people('online', 20, 0);
  perform tests.assert(jsonb_array_length(v) = 1 and v->0->>'username' = 'bob', 'online: only bob (dave hides his status)');
  v := public.discover_people('interests', 20, 0);
  perform tests.assert(jsonb_array_length(v) = 2 and v->0->>'username' = 'bob' and v->1->>'username' = 'carol', 'shared interests section ordered by overlap');
  v := public.discover_people('countries', 20, 0);
  perform tests.assert(jsonb_array_length(v) = 2 and not exists (select 1 from jsonb_array_elements(v) e where e->>'country_code' = 'US'), 'other countries excludes my own country');
  v := public.discover_people('new', 20, 0);
  perform tests.assert(jsonb_array_length(v) = 1 and v->0->>'username' = 'bob', 'new members: joined in the last 30 days');
  v := public.discover_people('popular', 20, 0);
  perform tests.assert(v->0->>'username' = 'carol', 'popular sorts by popularity');
  v := public.discover_people('active', 20, 0);
  perform tests.assert(jsonb_array_length(v) = 2 and v->0->>'username' = 'bob' and v->1->>'username' = 'carol', 'recently active: visible presence within 24h, newest first');
  perform tests.assert(public.discover_people('nearby', 20, 0) = '[]'::jsonb, 'nearby is empty until location sharing is on');
  perform tests.assert_raises($$select public.discover_people('bogus')$$, 'unknown section rejected', 'INVALID_SECTION');
  -- pagination
  perform tests.assert(jsonb_array_length(public.discover_people('recommended', 2, 0)) = 2 and jsonb_array_length(public.discover_people('recommended', 2, 2)) = 1, 'pagination with limit/offset');
  -- nearby with approximate locations
  perform public.update_my_location(30.27, -97.74, 'Austin');
  update public.user_settings set nearby_enabled = true where user_id = alice;
  perform tests.as_user(dave);
  perform public.update_my_location(30.30, -97.70, 'Austin');
  update public.user_settings set nearby_enabled = true where user_id = dave;
  perform tests.as_user(alice);
  v := public.discover_people('nearby', 20, 0);
  perform tests.assert(jsonb_array_length(v) = 1 and v->0->>'username' = 'dave' and (v->0->>'distance_km')::numeric between 1 and 10, 'nearby shows people within radius with rounded distance');

  -- minors only see minors
  perform tests.as_user(kid1);
  v := public.discover_people('recommended', 20, 0);
  perform tests.assert(jsonb_array_length(v) = 1 and v->0->>'username' = 'kidtwo', 'minors are only shown other minors');
  perform tests.assert(jsonb_array_length(public.search_people('')) = 1, 'minor search is bracketed too');

  -- ---------------------------------------------------------------- search
  perform tests.as_user(alice);
  perform tests.assert(jsonb_array_length(public.search_people('')) = 3, 'empty search lists everyone eligible');
  perform tests.assert((public.search_people('bo')->0->>'username') = 'bob', 'search by username prefix');
  perform tests.assert((public.search_people('Diaz')->0->>'username') = 'carol', 'search by full name');
  perform tests.assert(jsonb_array_length(public.search_people('', 'ES')) = 1, 'country filter');
  perform tests.assert(jsonb_array_length(public.search_people('', null, 'austin')) = 0, 'city filter respects hidden city (dave hides it)');
  perform tests.assert(jsonb_array_length(public.search_people('', null, 'lond')) = 1, 'city filter (case-insensitive)');
  perform tests.assert(jsonb_array_length(public.search_people('', null, null, 'man')) = 0, 'gender filter only matches people who show their gender');
  perform tests.as_user(bob);
  update public.user_settings set show_gender = true where user_id = bob;
  perform tests.as_user(alice);
  perform tests.assert(jsonb_array_length(public.search_people('', null, null, 'man')) = 1, 'gender filter matches opted-in people');
  perform tests.assert(jsonb_array_length(public.search_people('', null, null, null, array[v_travel])) = 1, 'interest filter');
  perform tests.assert(jsonb_array_length(public.search_people('', null, null, null, null, array['es'])) = 0, 'language filter respects hidden languages');
  perform tests.assert(jsonb_array_length(public.search_people('', null, null, null, null, array['en'])) = 1, 'language filter');
  perform tests.assert(jsonb_array_length(public.search_people('', null, null, null, null, null, true)) = 1, 'online-only filter');
  perform tests.assert((public.search_people('', null, null, null, null, null, false, null, null, 'newest')->0->>'username') = 'bob', 'sort newest');
  perform tests.assert((public.search_people('', null, null, null, null, null, false, null, null, 'popular')->0->>'username') = 'carol', 'sort popular');
  perform tests.assert((public.search_people('', null, null, null, null, null, false, null, null, 'name')->0->>'username') = 'bob', 'sort by name');
  perform tests.assert_raises($$select public.search_people('', null, null, null, null, null, false, 25, 40)$$, 'age range is a Premium filter', 'PREMIUM_REQUIRED');
  perform tests.as_service();
  perform public.sync_subscription(alice, 'evt-disc-1', 'INITIAL_PURCHASE', 'active', 'friendzy_premium_monthly', 'app_store', 'sandbox', 'normal', now(), now() + interval '30 days');
  perform tests.as_user(alice);
  perform tests.assert(jsonb_array_length(public.search_people('', null, null, null, null, null, false, 33, 35)) = 1, 'premium age filter works');

  -- ---------------------------------------------------------------- friends & mutuals
  perform tests.as_user(alice);
  v_req := public.send_friend_request(bob, 'hi');
  perform tests.assert((public.discover_card_json(bob, alice)->'relationship'->'friend_request'->>'direction') = 'outgoing', 'outgoing request visible in card');
  perform tests.assert(jsonb_array_length(public.get_friend_requests('outgoing')) = 1, 'sent requests listed with cards');
  perform tests.as_user(bob);
  perform tests.assert((public.get_friend_requests('incoming')->0->'user'->>'username') = 'alice', 'incoming requests listed with cards');
  perform public.respond_friend_request(v_req, true);
  perform public.send_friend_request(carol);
  perform tests.as_user(carol);
  perform public.respond_friend_request((select id from public.friend_requests where sender_id = bob and receiver_id = carol), true);
  perform public.send_friend_request(alice);
  perform tests.as_user(alice);
  perform public.respond_friend_request((select id from public.friend_requests where sender_id = carol and receiver_id = alice), true);
  -- alice ↔ bob, bob ↔ carol, carol ↔ alice : alice & bob share carol; alice & carol share bob
  perform tests.assert(public.mutual_friends_count(alice, bob) = 1 and (public.get_mutual_friends(bob)->0->>'username') = 'carol', 'mutual friends computed');
  perform tests.assert((public.discover_card_json(dave, alice)->>'mutual_friends')::int = 0, 'no mutuals with strangers');
  perform tests.assert(jsonb_array_length(public.get_friends_list()) = 2 and jsonb_array_length(public.get_friends_list(null, 'car')) = 1, 'friends list with search');
  perform tests.as_user(carol);
  update public.user_settings set who_can_see_friends = 'nobody' where user_id = carol;
  perform tests.as_user(alice);
  perform tests.assert(public.get_friends_list(carol) = '[]'::jsonb and public.mutual_friends_count(alice, carol) = 0, 'friend list privacy respected (also hides mutual count)');
  perform tests.assert(not exists (select 1 from jsonb_array_elements(public.discover_people('recommended')) e where e->>'username' = 'bob'), 'friends drop out of recommendations');

  -- ---------------------------------------------------------------- presence activity
  perform tests.as_user(bob);
  perform public.touch_presence(true, 'chatting', true);
  perform tests.as_user(alice);
  perform tests.assert((select activity from public.get_presence(array[bob])) is null, 'activity hidden until the owner opts in');
  perform tests.as_user(bob);
  update public.user_settings set show_activity = true where user_id = bob;
  perform tests.as_user(alice);
  perform tests.assert((select activity from public.get_presence(array[bob])) = 'chatting', 'activity visible after opt-in');
  perform tests.as_user(bob);
  perform public.touch_presence(true);
  perform tests.as_user(alice);
  perform tests.assert((select activity from public.get_presence(array[bob])) = 'chatting', 'plain heartbeat keeps the activity');
  perform tests.as_user(bob);
  perform public.touch_presence(true, null, true);
  perform tests.as_user(alice);
  perform tests.assert((select activity from public.get_presence(array[bob])) is null, 'activity cleared explicitly');

  -- ---------------------------------------------------------------- MEET SOMEONE
  perform tests.as_user(kid1);
  perform tests.assert_raises($$select public.match_find()$$, 'minors cannot use matching', 'ADULTS_ONLY');
  perform tests.as_user(alice);
  perform tests.assert_raises($$insert into public.match_queue (user_id) values (auth.uid())$$, 'queue is not client-writable', 'permission denied');
  -- alice searches alone: nobody live yet
  v := public.match_find();
  perform tests.assert(v->>'status' = 'searching' and (v->>'searching_now')::int = 0, 'first poll: searching');
  perform tests.assert((select count(*) from public.match_queue) = 1, 'own queue row visible');
  -- dave searches: compatible with alice (both adults, no prefs) → live match formed on dave''s side
  perform tests.as_user(dave);
  v := public.match_find();
  perform tests.assert(v->>'status' = 'matched' and (v->>'live')::boolean and v->'candidate'->>'username' = 'alice', 'two searchers get matched live');
  v_match := (v->>'match_id')::uuid;
  perform tests.as_user(alice);
  v2 := public.match_find();
  perform tests.assert(v2->>'status' = 'matched' and v2->'candidate'->>'username' = 'dave' and (v2->>'match_id')::uuid = v_match, 'the other side sees the same match');
  perform tests.assert(exists (select 1 from public.notifications where user_id = alice and type = 'match_found' and actor_id = dave), 'partner notified of the live match');
  perform tests.assert((select count(*) from public.matches) = 1, 'match recorded');
  -- alice starts chatting → conversation + queue cleared; dave then continues searching
  v := public.match_action(dave, 'chat');
  v_conv := (v->>'conversation_id')::uuid;
  perform tests.assert(v_conv is not null and (v->>'match_id')::uuid = v_match, 'start chatting opens a conversation');
  perform tests.assert((select count(*) from public.match_queue) = 0, 'acting clears my queue row');
  perform tests.as_user(dave);
  v := public.match_find();
  perform tests.assert(v->>'status' = 'searching', 'partner left → back to searching');
  perform tests.assert(not public.match_compatible(dave, alice), 'recently engaged pair is not re-matched');
  -- skip exclusion & preferences
  perform public.match_action(carol, 'skip');
  perform tests.assert(not public.match_compatible(dave, carol) and not public.match_compatible(carol, dave), 'skipped users are excluded both ways for a while');
  perform tests.assert((select count(*) from public.match_queue where user_id = dave) = 0, 'skip clears the queue');
  perform tests.as_user(bob);
  update public.user_settings set match_countries = array['ES'], match_genders = array['woman'] where user_id = bob;
  perform tests.assert(public.match_compatible(bob, carol) = false, 'carol skipped? no — carol hides gender so gender preference cannot be verified');
  perform tests.as_user(carol);
  update public.user_settings set show_gender = true where user_id = carol;
  perform tests.as_user(bob);
  perform tests.assert(public.match_compatible(bob, carol) = false, 'bob and carol are friends → not matched');
  update public.user_settings set match_countries = array['US'], match_genders = '{}' where user_id = bob;
  perform tests.assert(public.match_compatible(bob, dave), 'country preference satisfied');
  update public.user_settings set match_countries = array['JP'] where user_id = bob;
  perform tests.assert(not public.match_compatible(bob, dave), 'country preference enforced');
  update public.user_settings set match_countries = '{}', preferred_min_age = 40, preferred_max_age = 50 where user_id = bob;
  perform tests.assert(not public.match_compatible(bob, dave), 'age preference enforced (dave is 37)');
  update public.user_settings set preferred_min_age = null, preferred_max_age = null, match_shared_interests = true where user_id = bob;
  perform tests.assert(not public.match_compatible(bob, dave), 'shared-interests requirement enforced');
  update public.user_settings set match_shared_interests = false where user_id = bob;
  -- fallback suggestion after waiting
  perform tests.as_user(dave);
  perform public.match_find();
  perform tests.as_admin_db();
  update public.match_queue set joined_at = clock_timestamp() - interval '20 seconds' where user_id = dave;
  perform tests.as_user(dave);
  v := public.match_find();
  perform tests.assert(v->>'status' = 'suggested' and (v->>'live')::boolean = false and v->'candidate'->>'username' = 'bob', 'after waiting, a compatible recently-active member is suggested');
  v2 := public.match_find();
  perform tests.assert(v2->'candidate'->>'username' = 'bob', 'suggestion is stable across polls');
  v := public.match_action(bob, 'friend');
  perform tests.assert(v->>'friend_request_id' is not null, 'friend request from a match');
  perform tests.as_user(bob);
  perform tests.assert(exists (select 1 from public.notifications where user_id = bob and type = 'friend_request' and actor_id = dave), 'friend request notification');
  -- blocked through matching never comes back
  perform tests.as_user(dave);
  perform public.match_find();
  perform public.match_action(erin, 'block');
  perform tests.assert(not public.match_compatible(dave, erin), 'blocked via match is excluded');
  -- matches preference can silence match notifications
  perform tests.as_user(carol);
  update public.notification_preferences set matches = false where user_id = carol;
  perform tests.assert_raises($$select public.create_notification(auth.uid(), auth.uid(), 'match_found')$$, 'clients cannot create notifications directly', 'permission denied');
  perform tests.as_admin_db();
  perform tests.assert(public.create_notification(carol, bob, 'match_found', 'match', gen_random_uuid()::text) is null, 'match notifications respect the preference');
  perform tests.assert(public.create_notification(alice, bob, 'match_found', 'match', gen_random_uuid()::text) is not null, 'match notifications delivered by default');
  perform tests.as_user(carol);
  perform public.match_leave();
  perform tests.assert((select count(*) from public.match_queue where user_id = carol) = 0, 'match_leave is idempotent');

  -- ---------------------------------------------------------------- admin signals
  perform tests.as_user(dave);
  perform tests.assert_raises($$select public.admin_discovery_abuse()$$, 'non-admins blocked', 'FORBIDDEN');
  perform tests.as_admin_db();
  insert into public.admin_roles (user_id, role) values (dave, 'moderator');
  perform tests.as_user(dave);
  v := public.admin_discovery_abuse(24);
  perform tests.assert((v->'stats'->>'live_matches')::int = 1 and (v->'stats'->>'friend_requests')::int >= 3 and v ? 'top_requesters', 'admin discovery signals');

  raise notice 'discovery tests passed';
end $t$;
