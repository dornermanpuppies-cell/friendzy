-- Tests for 20261125000006_economy.sql
do $t$
declare
  alice uuid; bob uuid; kid uuid; v_video jsonb; v_json jsonb; v_gift_id int; v_tx bigint; v_wd jsonb;
begin
  alice := tests.create_user('alice@coins.test', '{"display_name":"Alice","username":"alice","birth_date":"1998-01-01"}');
  bob   := tests.create_user('bob@coins.test',   '{"display_name":"Bob","username":"bob","birth_date":"1997-01-01"}');
  kid   := tests.create_user('kid@coins.test',   '{"display_name":"Kid","username":"kid","birth_date":"2009-01-01"}');

  -- Wallets exist automatically and are read-only for clients
  perform tests.as_user(alice);
  perform tests.assert((public.get_wallet()->>'balance')::int = 0, 'wallet auto-created with zero balance');
  perform tests.assert_raises($$update public.wallets set balance = 1000000 where user_id = auth.uid()$$, 'clients cannot edit balances', 'permission denied');
  perform tests.assert_raises($$insert into public.wallet_transactions (user_id, kind, coins, balance_after, earnings_after) values (auth.uid(), 'bonus', 10, 10, 0)$$, 'clients cannot write the ledger', 'permission denied');
  perform tests.assert_raises($$select public.credit_coins(auth.uid(), 1000, 'purchase', 'test', '1', 'k1')$$, 'clients cannot call credit_coins', 'permission denied');
  perform tests.assert(jsonb_array_length(public.get_coin_packages()) = 6 and jsonb_array_length(public.get_gift_catalog()) = 14, 'catalogues readable');

  -- Server credits coins (idempotent)
  perform tests.as_service();
  v_tx := public.credit_coins(alice, 1000, 'purchase', 'revenuecat', 'txn-1', 'rc:txn-1', '{"sku":"friendzy_coins_1200"}'::jsonb);
  perform tests.assert(public.credit_coins(alice, 1000, 'purchase', 'revenuecat', 'txn-1', 'rc:txn-1') = v_tx, 'duplicate webhook delivery does not double credit');
  perform tests.assert((select balance from public.wallets where user_id = alice) = 1000, 'balance credited once');
  perform tests.assert((select lifetime_purchased from public.wallets where user_id = alice) = 1000, 'lifetime purchased tracked');

  -- Gifting
  perform tests.as_user(bob);
  v_video := public.create_video(format('https://x/storage/v1/object/public/videos/%s/v.mp4', bob), null, 'gift me', 720, 1280, 5000);
  perform tests.as_user(alice);
  select id into v_gift_id from public.gift_catalog where slug = 'diamond';
  v_json := public.send_gift(v_gift_id, 'video', (v_video->>'id')::uuid, 2, 'love it');
  perform tests.assert((v_json->>'balance')::int = 800, 'sender debited 2x100');
  perform tests.assert((v_json->'gift'->>'net_coins')::int = 140 and (v_json->'gift'->'receiver'->>'username') = 'bob', '30% commission applied');
  perform tests.as_admin_db();
  perform tests.assert((select earnings_balance from public.wallets where user_id = bob) = 140, 'creator earnings credited net');
  perform tests.assert((select count(*) from public.wallet_transactions where reference_type = 'gift') = 2, 'ledger rows for both sides');
  perform tests.assert(exists (select 1 from public.notifications where user_id = bob and type = 'gift_received'), 'gift notification');
  perform tests.as_user(alice);
  perform tests.assert_raises(format($$select public.send_gift(%s, 'video', '%s', 99)$$, v_gift_id, v_video->>'id'), 'insufficient coins rejected', 'INSUFFICIENT_COINS');
  perform tests.assert((public.get_wallet()->>'balance')::int = 800, 'failed gift leaves balance untouched');
  perform tests.assert_raises(format($$select public.send_gift((select id from public.gift_catalog where slug = 'fireworks'), 'video', '%s')$$, v_video->>'id'), 'premium-only gift blocked without premium', 'PREMIUM_REQUIRED');
  perform tests.assert_raises(format($$select public.send_gift(%s, 'profile', auth.uid())$$, v_gift_id), 'cannot gift yourself', 'CANNOT_GIFT_SELF');
  perform tests.assert((select count(*) from public.get_wallet_transactions(10)) = 2, 'transaction history visible to owner');
  perform tests.assert((select count(*) from public.get_sent_gifts()) = 1, 'sent gifts listed');
  perform tests.assert(jsonb_array_length(public.get_top_supporters(bob)) = 1, 'top supporters');

  perform tests.as_user(kid);
  perform tests.assert_raises(format($$select public.send_gift(%s, 'video', '%s')$$, v_gift_id, v_video->>'id'), 'minors cannot gift', 'ADULTS_ONLY');

  -- Earnings & withdrawals
  perform tests.as_user(bob);
  v_json := public.get_earnings_summary();
  perform tests.assert((v_json->>'coins_30d')::int = 140 and jsonb_array_length(v_json->'daily') = 30, 'earnings summary');
  perform tests.assert_raises($$select public.request_withdrawal(140, '{"type":"bank"}'::jsonb)$$, 'withdrawals disabled until payouts are enabled', 'WITHDRAWALS_DISABLED');
  perform tests.as_admin_db();
  update public.platform_settings set value = 'true'::jsonb where key = 'payouts_enabled';
  update public.platform_settings set value = '100'::jsonb where key = 'min_withdrawal_coins';
  perform tests.as_user(bob);
  perform tests.assert_raises($$select public.request_withdrawal(50, '{"type":"bank"}'::jsonb)$$, 'minimum enforced', 'BELOW_MINIMUM');
  perform tests.assert_raises($$select public.request_withdrawal(1000, '{"type":"bank"}'::jsonb)$$, 'cannot withdraw more than earnings', 'INSUFFICIENT_EARNINGS');
  v_wd := public.request_withdrawal(140, '{"type":"bank","iban_last4":"1234"}'::jsonb);
  perform tests.assert((v_wd->>'amount_cents')::int = 70, 'coins converted at 0.5 cents');
  perform tests.assert((public.get_wallet()->>'earnings_balance')::int = 0 and (public.get_wallet()->>'pending_earnings')::int = 140, 'earnings moved to pending');
  perform tests.assert_raises($$select public.request_withdrawal(100, '{"type":"bank"}'::jsonb)$$, 'one withdrawal at a time', 'WITHDRAWAL_PENDING');
  perform public.cancel_withdrawal((v_wd->>'id')::uuid);
  perform tests.assert((public.get_wallet()->>'earnings_balance')::int = 140 and (public.get_wallet()->>'pending_earnings')::int = 0, 'cancel refunds hold');

  -- Isolation
  perform tests.as_user(alice);
  perform tests.assert((select count(*) from public.wallets) = 1, 'only own wallet visible');
  perform tests.assert((select count(*) from public.withdrawal_requests) = 0, 'other users'' withdrawals hidden');

  raise notice 'economy tests passed';
end $t$;
