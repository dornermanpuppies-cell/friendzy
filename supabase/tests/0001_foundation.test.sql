-- Tests for 20261125000001_foundation.sql (runs inside a transaction, rolled back by the runner)
do $t$
declare
  alice uuid; bob uuid; carol uuid; v_req uuid; v_rel jsonb; v_count int; v_text text;
begin
  -- -------------------------------------------------------------------------
  -- Sign-up trigger bootstraps all per-user rows and validates metadata
  -- -------------------------------------------------------------------------
  alice := tests.create_user('alice@example.com', '{"display_name":"Alice Example","username":"alice","birth_date":"2000-05-05","country_code":"pt","gender":"woman","accepted_terms":"true"}');
  bob   := tests.create_user('bob@example.com',   '{"display_name":"Bob","username":"Admin","birth_date":"1999-01-01","country_code":"US"}');
  carol := tests.create_user('carol@example.com', '{"display_name":"Carol","username":"alice","birth_date":"1995-07-07"}');

  perform tests.assert((select username from public.profiles where id = alice) = 'alice', 'alice keeps requested username');
  perform tests.assert((select country_code from public.profiles where id = alice) = 'PT', 'country code is upper-cased');
  perform tests.assert((select username from public.profiles where id = bob) <> 'admin', 'reserved username is replaced');
  perform tests.assert((select username from public.profiles where id = carol) <> 'alice', 'duplicate username gets a suffix');
  perform tests.assert((select gender from public.user_private where user_id = alice) = 'woman', 'gender stored privately');
  perform tests.assert((select terms_accepted_at from public.user_private where user_id = alice) is not null, 'terms acceptance recorded');
  perform tests.assert(exists (select 1 from public.user_settings where user_id = alice), 'settings row created');
  perform tests.assert(exists (select 1 from public.notification_preferences where user_id = alice), 'notification preferences created');
  perform tests.assert(exists (select 1 from public.user_presence where user_id = alice), 'presence row created');

  -- Underage sign-up must be rejected by the private-data validator.
  perform tests.assert_raises(
    $$select tests.create_user('kid@example.com', '{"display_name":"Kid","birth_date":"2020-01-01"}')$$,
    'users under 16 cannot register', 'AGE_REQUIREMENT');

  -- -------------------------------------------------------------------------
  -- Username availability (anon + authenticated)
  -- -------------------------------------------------------------------------
  perform tests.as_anon();
  perform tests.assert(public.is_username_available('new_person') = true, 'free username is available');
  perform tests.assert(public.is_username_available('alice') = false, 'taken username is unavailable');
  perform tests.assert(public.is_username_available('admin') = false, 'reserved username is unavailable');
  perform tests.assert(public.is_username_available('.bad') = false, 'invalid username is unavailable');
  perform tests.assert_raises($$select * from public.profiles$$, 'anon cannot read profiles', 'permission denied');

  -- -------------------------------------------------------------------------
  -- RLS: profiles readable, private rows owner-only, counters not writable
  -- -------------------------------------------------------------------------
  perform tests.as_user(alice);
  perform tests.assert((select count(*) from public.profiles) = 3, 'authenticated users see active profiles');
  perform tests.assert((select count(*) from public.user_private) = 1, 'only own private row visible');
  perform tests.assert((select user_id from public.user_private) = alice, 'private row belongs to caller');
  perform tests.assert_raises($$update public.profiles set followers_count = 999 where id = auth.uid()$$, 'followers_count is not client-writable', 'permission denied');
  perform tests.assert_raises($$update public.profiles set is_verified = true where id = auth.uid()$$, 'is_verified is not client-writable', 'permission denied');
  perform tests.assert_raises($$update public.profiles set account_status = 'banned' where id = auth.uid()$$, 'account_status is not client-writable', 'permission denied');
  perform tests.assert_raises($$insert into public.admin_roles (user_id, role) values (auth.uid(), 'super_admin')$$, 'cannot self-grant admin', 'permission denied');

  update public.profiles set bio = 'Hello world', display_name = 'Alice E.' where id = alice;
  perform tests.assert((select bio from public.profiles where id = alice) = 'Hello world', 'owner can edit own profile');
  update public.profiles set bio = 'hacked' where id = bob;
  perform tests.assert((select bio from public.profiles where id = bob) is null, 'cannot edit someone else''s profile (RLS filters the row)');

  update public.profiles set username = 'alice_new' where id = alice;
  perform tests.assert((select username from public.profiles where id = alice) = 'alice_new', 'username change applied');
  perform tests.assert_raises($$update public.profiles set username = 'alice_again' where id = auth.uid()$$, 'username cooldown enforced', 'USERNAME_COOLDOWN');
  perform tests.assert_raises($$update public.profiles set username = 'support' where id = auth.uid()$$, 'reserved usernames rejected on update', 'reserved');

  -- Interests: max 10
  insert into public.user_interests (user_id, interest_id) select alice, id from public.interests order by id limit 10;
  perform tests.assert_raises(
    $$insert into public.user_interests (user_id, interest_id) select auth.uid(), id from public.interests order by id offset 10 limit 1$$,
    'interest limit enforced', 'INTEREST_LIMIT');
  perform tests.assert_raises($$insert into public.user_interests (user_id, interest_id) values ('00000000-0000-0000-0000-000000000000', 1)$$, 'cannot insert interests for others', 'row-level security');

  -- -------------------------------------------------------------------------
  -- Follows, requests, friendships, notifications
  -- -------------------------------------------------------------------------
  perform tests.assert(public.follow_user(bob) = 'following', 'public account: immediate follow');
  perform tests.assert_raises($$select public.follow_user(auth.uid())$$, 'cannot follow self', 'CANNOT_FOLLOW_SELF');
  perform tests.assert_raises($$insert into public.follows (follower_id, following_id) values (auth.uid(), auth.uid())$$, 'follows table not directly insertable', 'permission denied');

  perform tests.as_user(bob);
  perform tests.assert((select followers_count from public.profiles where id = bob) = 1, 'followers counter incremented');
  perform tests.assert((select count(*) from public.notifications where user_id = bob and type = 'new_follower') = 1, 'new follower notification created');
  perform tests.assert((select count(*) from public.notifications) = 1, 'bob sees only his notifications');
  update public.profiles set is_private = true where id = bob;

  perform tests.as_user(carol);
  perform tests.assert(public.follow_user(bob) = 'requested', 'private account: follow becomes a request');
  perform tests.assert(public.follow_user(bob) = 'requested', 'repeat follow request is idempotent');
  v_rel := public.get_relationship(bob);
  perform tests.assert((v_rel->>'follow_requested')::boolean = true and (v_rel->>'is_following')::boolean = false, 'relationship shows pending follow request');

  perform tests.as_user(bob);
  select id into v_req from public.follow_requests where requester_id = carol and target_id = bob and status = 'pending';
  perform tests.assert(v_req is not null, 'target sees the follow request');
  perform public.respond_follow_request(v_req, true);
  perform tests.assert(exists (select 1 from public.follows where follower_id = carol and following_id = bob), 'approved request creates follow');

  -- Friend requests: carol → alice, alice accepts
  perform tests.as_user(carol);
  v_req := public.send_friend_request(alice, 'hey!');
  perform tests.assert_raises($$select public.send_friend_request(auth.uid())$$, 'cannot friend self', 'CANNOT_FRIEND_SELF');
  perform tests.as_user(alice);
  perform tests.assert((select count(*) from public.friend_requests where receiver_id = alice and status = 'pending') = 1, 'alice sees incoming friend request');
  perform tests.assert((select count(*) from public.notifications where user_id = alice and type = 'friend_request') = 1, 'friend request notification created');
  perform public.respond_friend_request(v_req, true);
  perform tests.assert(exists (select 1 from public.friendships where user_a = least(alice, carol) and user_b = greatest(alice, carol)), 'friendship created in canonical order');
  perform tests.assert((select friends_count from public.profiles where id = alice) = 1, 'friends counter incremented');
  perform tests.assert_raises($$select public.send_friend_request((select id from public.profiles where username <> 'alice_new' and friends_count = 1 limit 1))$$, 'cannot re-request an existing friend', 'ALREADY_FRIENDS');

  -- Reverse request auto-accepts
  perform tests.as_user(bob);
  perform public.send_friend_request(alice);
  perform tests.as_user(alice);
  perform public.send_friend_request(bob);
  perform tests.assert(exists (select 1 from public.friendships where user_a = least(alice, bob) and user_b = greatest(alice, bob)), 'mutual requests become a friendship');

  -- Sessions & presence
  perform tests.assert((select count(*) from public.get_my_sessions()) = 1, 'caller sees own sessions');
  perform tests.assert((select is_current from public.get_my_sessions() limit 1) = true, 'current session flagged');
  perform public.touch_presence(true);
  perform tests.assert((select is_online from public.get_presence(array[alice]) limit 1) = true, 'own presence visible');

  perform tests.as_user(bob);
  update public.user_settings set show_online_status = false, show_last_seen = false where user_id = bob;
  perform public.touch_presence(true);
  perform tests.as_user(alice);
  perform tests.assert((select is_online from public.get_presence(array[bob]) limit 1) is null, 'online status hidden when disabled');
  perform tests.assert((select last_seen_at from public.get_presence(array[bob]) limit 1) is null, 'last seen hidden when disabled');

  -- Blocking removes relationships and hides profiles both ways
  perform public.block_user(bob);
  perform tests.assert(not exists (select 1 from public.friendships where user_a = least(alice, bob) and user_b = greatest(alice, bob)), 'block removes friendship');
  perform tests.assert(not exists (select 1 from public.follows where follower_id = alice and following_id = bob), 'block removes follow');
  perform tests.assert((select count(*) from public.profiles where id = bob) = 0, 'blocked profile hidden from blocker');
  perform tests.assert((select count(*) from public.get_blocked_profiles()) = 1, 'blocked list served via RPC');
  perform tests.assert_raises($$select public.follow_user((select blocked_id from public.blocks limit 1))$$, 'cannot follow a blocked user', 'BLOCKED');
  perform tests.as_user(bob);
  perform tests.assert((select count(*) from public.profiles where id = alice) = 0, 'blocker hidden from blocked user');
  perform tests.assert((select count(*) from public.blocks) = 0, 'blocked user cannot see the block row');
  perform tests.as_user(alice);
  perform public.unblock_user(bob);
  perform tests.assert((select count(*) from public.profiles where id = bob) = 1, 'unblock restores visibility');

  -- Reports
  insert into public.reports (reporter_id, target_type, target_id, reason, details) values (alice, 'profile', bob::text, 'spam', 'details');
  perform tests.assert((select count(*) from public.reports) = 1, 'reporter sees own report');
  perform tests.assert_raises($$insert into public.reports (reporter_id, target_type, target_id, reason) values ('00000000-0000-0000-0000-000000000000', 'profile', 'x', 'spam')$$, 'cannot report as someone else', 'row-level security');
  perform tests.as_user(bob);
  perform tests.assert((select count(*) from public.reports) = 0, 'reported user cannot see the report');

  -- Search & suggestions
  perform tests.as_user(carol);
  perform tests.assert((select count(*) from public.search_profiles('ali')) >= 1, 'search finds alice by prefix');
  update public.profiles set onboarding_completed = true where id = carol;
  perform tests.as_admin_db();
  update public.profiles set onboarding_completed = true;
  perform tests.as_user(carol);
  perform tests.assert((select count(*) from public.get_suggested_profiles(10)) >= 1, 'suggestions exclude self and followed people');

  -- Admin helpers
  perform tests.as_admin_db();
  insert into public.admin_roles (user_id, role) values (alice, 'super_admin');
  perform tests.as_user(alice);
  perform tests.assert(public.is_admin() = true, 'admin role recognised');
  perform tests.assert((select count(*) from public.reports) = 1, 'admins see reports');
  perform public.log_admin_action('test_action', 'profile', bob::text, '{"k":1}');
  perform tests.assert((select count(*) from public.admin_audit_logs) = 1, 'admin action logged');
  perform tests.as_user(bob);
  perform tests.assert(public.is_admin() = false, 'non-admin not recognised');
  perform tests.assert_raises($$select public.log_admin_action('x')$$, 'non-admin cannot log admin actions', 'FORBIDDEN');
  perform tests.assert((select count(*) from public.admin_audit_logs) = 0, 'non-admin cannot read audit log');

  -- Account deletion cascades
  perform tests.as_user(carol);
  perform public.delete_my_account();
  perform tests.as_admin_db();
  perform tests.assert(not exists (select 1 from auth.users where id = carol), 'auth user deleted');
  perform tests.assert(not exists (select 1 from public.profiles where id = carol), 'profile cascaded');
  perform tests.assert(not exists (select 1 from public.friendships where user_a = carol or user_b = carol), 'friendships cascaded');
  perform tests.assert((select friends_count from public.profiles where id = alice) = 0, 'friend counters adjusted after cascade');

  raise notice 'foundation tests passed';
end $t$;
