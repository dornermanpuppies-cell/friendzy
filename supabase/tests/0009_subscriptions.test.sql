-- Tests for 20261125000009_subscriptions.sql
do $t$
declare
  alice uuid; bob uuid; carol uuid; v_json jsonb; v_video jsonb;
begin
  alice := tests.create_user('alice@premium.test', '{"display_name":"Alice","username":"alice","birth_date":"1998-01-01"}');
  bob   := tests.create_user('bob@premium.test',   '{"display_name":"Bob","username":"bob","birth_date":"1997-01-01"}');
  carol := tests.create_user('carol@premium.test', '{"display_name":"Carol","username":"carol","birth_date":"1996-01-01"}');

  -- Plans are public; status reads for the current user
  perform tests.as_anon();
  perform tests.assert(jsonb_array_length(public.get_premium_plans()) = 2, 'plans readable before sign-in (pricing page)');
  perform tests.as_user(alice);
  v_json := public.get_premium_status();
  perform tests.assert((v_json->>'is_premium')::boolean = false and v_json->>'status' is null and jsonb_array_length(v_json->'features') = 7 and v_json->>'web_billing_provider' = 'none', 'free status');
  perform tests.assert_raises($$insert into public.subscriptions (user_id, status) values (auth.uid(), 'active')$$, 'clients cannot create subscriptions', 'permission denied');
  perform tests.assert_raises($$select public.sync_subscription(auth.uid(), 'e1', 'INITIAL_PURCHASE', 'active')$$, 'clients cannot call sync_subscription', 'permission denied');
  perform tests.assert_raises($$select public.record_coin_purchase(auth.uid(), 'friendzy_coins_1200', 'tx')$$, 'clients cannot record purchases', 'permission denied');

  -- Perks locked for free users
  perform tests.as_user(bob);
  perform public.record_profile_view(alice);
  perform public.record_profile_view(alice);
  perform public.match_action(alice, 'chat');
  perform tests.as_user(alice);
  v_json := public.get_profile_viewers();
  perform tests.assert((v_json->>'locked')::boolean and (v_json->>'count')::int = 1 and jsonb_array_length(v_json->'viewers') = 0, 'viewers locked for free users (count only)');
  v_json := public.get_match_admirers();
  perform tests.assert((v_json->>'locked')::boolean and (v_json->>'count')::int = 1 and jsonb_array_length(v_json->'people') = 0, 'admirers locked for free users');
  perform tests.assert_raises($$select public.search_profiles_advanced('', null, 18, 30)$$, 'advanced filters need premium', 'PREMIUM_REQUIRED');
  perform tests.assert(jsonb_array_length(public.search_profiles_advanced('bo')) = 1, 'basic search works for everyone');
  perform tests.assert_raises($$update public.user_settings set accent = 'aurora' where user_id = auth.uid()$$, 'accent themes need premium', 'PREMIUM_REQUIRED');

  -- Webhook sync (service role) — idempotent
  perform tests.as_service();
  v_json := public.sync_subscription(alice, 'evt-1', 'INITIAL_PURCHASE', 'active', 'friendzy_premium_monthly', 'app_store', 'sandbox', 'normal', now(), now() + interval '30 days', true, null, null, null, alice::text, 'https://apps.apple.com/account/subscriptions', '{"id":"evt-1"}'::jsonb);
  perform tests.assert((v_json->>'is_premium')::boolean and (v_json->>'duplicate')::boolean = false, 'premium activated');
  v_json := public.sync_subscription(alice, 'evt-1', 'INITIAL_PURCHASE', 'active', 'friendzy_premium_monthly', 'app_store', 'sandbox');
  perform tests.assert((v_json->>'duplicate')::boolean, 'duplicate webhook ignored');
  perform tests.assert((select count(*) from public.subscription_events) = 1, 'one event stored');
  perform tests.assert(public.is_premium(alice) and not public.is_premium(bob), 'entitlement scoped to user');

  perform tests.as_user(alice);
  v_json := public.get_premium_status();
  perform tests.assert((v_json->>'is_premium')::boolean and v_json->>'status' = 'active' and v_json->'plan'->>'id' = 'friendzy_premium_monthly' and v_json->>'store' = 'app_store', 'status reflects subscription');
  perform tests.assert((select count(*) from public.subscriptions) = 1, 'own subscription row visible');
  perform tests.assert(exists (select 1 from public.notifications where user_id = alice and type = 'subscription_update'), 'activation notification');
  perform tests.assert((public.get_profile_viewers()->'viewers'->0->>'username') = 'bob' and (public.get_profile_viewers()->'viewers'->0->>'views')::int = 2, 'viewers unlocked');
  perform tests.assert((public.get_match_admirers()->'people'->0->>'username') = 'bob', 'admirers unlocked');
  perform tests.assert(jsonb_array_length(public.search_profiles_advanced('', null, 18, 40, null, false, false, null)) = 2, 'advanced age filter works');
  update public.user_settings set accent = 'aurora' where user_id = auth.uid();
  perform tests.assert((select accent from public.user_settings where user_id = alice) = 'aurora', 'premium accent saved');
  perform tests.assert((public.profile_card_json(alice)->>'is_premium')::boolean, 'premium badge in profile cards');

  -- Premium-only gifts now allowed
  perform tests.as_service();
  perform public.credit_coins(alice, 5000, 'purchase', 'test', 'seed', 'seed:alice');
  perform tests.as_user(bob);
  v_video := public.create_video(format('https://x/storage/v1/object/public/videos/%s/v.mp4', bob), null, 'premium gift me', 720, 1280, 5000);
  perform tests.as_user(alice);
  v_json := public.send_gift((select id from public.gift_catalog where slug = 'fireworks'), 'video', (v_video->>'id')::uuid);
  perform tests.assert(v_json->'gift'->>'id' is not null, 'premium gift sent');

  -- Expiry & billing issue
  perform tests.as_service();
  v_json := public.sync_subscription(alice, 'evt-2', 'BILLING_ISSUE', 'billing_issue', 'friendzy_premium_monthly', 'app_store', 'sandbox', 'normal', null, now() + interval '3 days', true, null, now(), now() + interval '16 days');
  perform tests.assert(public.is_premium(alice), 'grace period keeps access');
  v_json := public.sync_subscription(alice, 'evt-3', 'EXPIRATION', 'expired', 'friendzy_premium_monthly', 'app_store', 'sandbox', 'normal', null, now() - interval '1 minute', false);
  perform tests.assert(not public.is_premium(alice), 'expired removes access');
  perform tests.as_user(alice);
  perform tests.assert((public.get_profile_viewers()->>'locked')::boolean, 'perks re-locked after expiry');
  perform tests.assert((select count(*) from public.notifications where user_id = alice and type = 'subscription_update') >= 2, 'expiry notification');

  -- Coin purchases via webhook (idempotent) and refunds
  perform tests.as_service();
  v_json := public.record_coin_purchase(bob, 'friendzy_coins_1200', 'GPA.1234-5678', 'play_store', 999, 'USD', 'production', '{}'::jsonb);
  perform tests.assert((v_json->>'duplicate')::boolean = false and (v_json->>'coins')::int = (select coins + bonus_coins from public.coin_packages where sku = 'friendzy_coins_1200'), 'coins credited for sku');
  perform tests.assert((public.record_coin_purchase(bob, 'friendzy_coins_1200', 'GPA.1234-5678', 'play_store')->>'duplicate')::boolean, 'duplicate purchase ignored');
  perform tests.assert((select balance from public.wallets where user_id = bob) = (select coins + bonus_coins from public.coin_packages where sku = 'friendzy_coins_1200'), 'balance matches one purchase');
  perform tests.assert_raises($$select public.record_coin_purchase('00000000-0000-0000-0000-000000000000', 'nope', 'tx-x')$$, 'unknown sku rejected', 'UNKNOWN_SKU');
  v_json := public.refund_coin_purchase('GPA.1234-5678');
  perform tests.assert((v_json->>'debited')::int > 0 and (v_json->>'shortfall')::int = 0, 'refund debited coins');
  perform tests.assert((select balance from public.wallets where user_id = bob) = 0, 'balance back to zero after refund');
  perform tests.assert((public.refund_coin_purchase('GPA.1234-5678')->>'duplicate')::boolean, 'duplicate refund ignored');
  perform tests.as_user(bob);
  perform tests.assert((select count(*) from public.coin_purchases) = 1 and (select status from public.coin_purchases limit 1) = 'refunded', 'own purchases visible with status');

  -- Manual grants require admin
  perform tests.as_user(carol);
  perform tests.assert_raises(format($$select public.grant_premium('%s', 30, 'friend')$$, carol), 'users cannot grant themselves premium', 'FORBIDDEN');
  perform tests.as_admin_db();
  insert into public.admin_roles (user_id, role) values (carol, 'admin');
  perform tests.as_user(carol);
  v_json := public.grant_premium(bob, 30, 'Creator programme');
  perform tests.assert(public.is_premium(bob), 'admin grant works');
  perform tests.assert(exists (select 1 from public.admin_audit_logs where action = 'premium.grant'), 'grant audited');
  perform public.revoke_premium(bob, 'test');
  perform tests.assert(not public.is_premium(bob), 'revoke works');

  raise notice 'subscription tests passed';
end $t$;
