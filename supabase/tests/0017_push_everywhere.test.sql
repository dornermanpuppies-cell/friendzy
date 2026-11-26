-- Tests for 20261125000017_push_everywhere.sql
do $t$
declare
  alice uuid; bob uuid; v_dm uuid; v_call jsonb; v_id uuid; i integer;
begin
  alice := tests.create_user('alice@push2.test', '{"display_name":"Alice","username":"alice","birth_date":"1998-01-01"}');
  bob   := tests.create_user('bob@push2.test',   '{"display_name":"Bob","username":"bob","birth_date":"1997-01-01"}');

  perform tests.assert((select relrowsecurity from pg_class where oid = 'public.web_push_subscriptions'::regclass), 'web push subscriptions table has RLS');
  perform tests.assert((select count(*) from pg_trigger where tgname = 'push_dispatch_on_call_invite' and not tgisinternal) = 1, 'incoming-call push trigger installed');

  -- Browser subscriptions: own rows only, validated shape, upsert by endpoint
  perform tests.as_user(alice);
  insert into public.web_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (alice, 'https://fcm.googleapis.com/fcm/send/abc', repeat('A', 87), repeat('B', 22), 'Chrome');
  perform tests.assert((select count(*) from public.web_push_subscriptions) = 1, 'alice sees her subscription');
  perform tests.assert_raises(format($$insert into public.web_push_subscriptions (user_id, endpoint, p256dh, auth) values ('%s', 'https://push.example/x', repeat('A', 87), repeat('B', 22))$$, bob), 'cannot subscribe on behalf of someone else', 'row-level security');
  perform tests.assert_raises($$insert into public.web_push_subscriptions (user_id, endpoint, p256dh, auth) values (auth.uid(), 'http://insecure.example/x', repeat('A', 87), repeat('B', 22))$$, 'endpoint must be https', 'check constraint');
  insert into public.web_push_subscriptions (user_id, endpoint, p256dh, auth)
  values (alice, 'https://fcm.googleapis.com/fcm/send/abc', repeat('C', 87), repeat('D', 22))
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, last_seen_at = now();
  perform tests.assert((select p256dh from public.web_push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/abc') = repeat('C', 87), 'subscription refresh updates keys in place');
  perform tests.as_user(bob);
  perform tests.assert((select count(*) from public.web_push_subscriptions) = 0, 'bob cannot see alice''s subscriptions');

  -- Limit: 10 browsers per account, oldest evicted
  perform tests.as_user(alice);
  for i in 1..12 loop
    insert into public.web_push_subscriptions (user_id, endpoint, p256dh, auth, last_seen_at)
    values (alice, 'https://push.example/' || i, repeat('A', 87), repeat('B', 22), now() + make_interval(secs => i));
  end loop;
  perform tests.assert((select count(*) from public.web_push_subscriptions where user_id = alice) = 10, 'at most 10 subscriptions per account');
  perform tests.assert(not exists (select 1 from public.web_push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/abc'), 'the oldest subscription was evicted');

  -- Incoming call: the invited row is inserted (trigger is a no-op without pg_net here) and the call still rings
  v_dm := public.start_direct_conversation(bob);
  perform tests.as_user(bob);
  perform tests.send_plain(v_dm, 'text', 'hi');
  perform tests.as_user(alice);
  v_call := public.start_call(v_dm, 'voice');
  perform tests.assert((v_call->>'status') = 'ringing' and (select state from public.call_participants where call_id = (v_call->>'id')::uuid and user_id = bob) = 'invited', 'invite row created with the trigger installed');
  perform tests.as_admin_db();
  perform tests.assert(public.webhook_record(to_jsonb((select cp from public.call_participants cp where cp.call_id = (v_call->>'id')::uuid and cp.user_id = bob))) ? 'call_id', 'webhook payload for the invite carries the call id');
  perform tests.as_user(alice);
  perform public.leave_call((v_call->>'id')::uuid, 'test');

  -- Test notification RPC
  v_id := public.request_test_notification();
  perform tests.assert(exists (select 1 from public.notifications where id = v_id and user_id = alice and type = 'test_notification'), 'test notification created for the caller');
  perform public.request_test_notification();
  perform public.request_test_notification();
  perform tests.assert_raises($$select public.request_test_notification()$$, 'test notifications are rate limited', 'RATE_LIMITED');
  perform tests.assert(not has_function_privilege('anon', 'public.request_test_notification()', 'execute'), 'anon cannot request test notifications');

  raise notice 'push everywhere tests passed';
end $t$;
