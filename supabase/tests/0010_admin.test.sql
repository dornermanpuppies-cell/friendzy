-- Tests for 20261125000010_admin.sql
do $t$
declare
  owner_id uuid; mod uuid; fin uuid; alice uuid; bob uuid; v_json jsonb; v_post jsonb; v_report uuid; v_video jsonb; v_wd jsonb; v_sanction uuid; v_live jsonb; v_ann uuid; v_ver uuid; v_topic int;
begin
  owner_id := tests.create_user('owner@admin.test', '{"display_name":"Owner","username":"owner","birth_date":"1990-01-01"}');
  mod      := tests.create_user('mod@admin.test',   '{"display_name":"Mod","username":"mod","birth_date":"1991-01-01"}');
  fin      := tests.create_user('fin@admin.test',   '{"display_name":"Fin","username":"fin","birth_date":"1992-01-01"}');
  alice    := tests.create_user('alice@admin.test', '{"display_name":"Alice","username":"alice","birth_date":"1998-01-01"}');
  bob      := tests.create_user('bob@admin.test',   '{"display_name":"Bob","username":"bob","birth_date":"1997-01-01"}');

  -- Bootstrap: only from a non-client context, only once
  perform tests.as_service();
  v_json := public.bootstrap_first_admin('OWNER@admin.test');
  perform tests.assert(v_json->>'role' = 'super_admin', 'first super admin bootstrapped by email');
  perform tests.assert_raises($$select public.bootstrap_first_admin('mod@admin.test')$$, 'bootstrap refuses once admins exist', 'ADMINS_EXIST');
  perform tests.as_user(alice);
  perform tests.assert_raises($$select public.bootstrap_first_admin('alice@admin.test')$$, 'clients cannot bootstrap', 'permission denied');
  perform tests.assert_raises($$select public.admin_overview()$$, 'non-admins blocked from dashboard', 'FORBIDDEN');
  perform tests.assert_raises($$insert into public.admin_roles (user_id, role) values (auth.uid(), 'super_admin')$$, 'clients cannot self-grant roles', 'permission denied');
  perform tests.assert(public.get_my_admin_role() is null, 'no role for regular user');

  -- Roles
  perform tests.as_user(owner_id);
  perform tests.assert(public.get_my_admin_role() = 'super_admin', 'role visible to holder');
  perform public.admin_grant_role(mod, 'moderator');
  perform public.admin_grant_role(fin, 'finance');
  perform tests.assert(jsonb_array_length(public.admin_list_admins()) = 3, 'three admins listed');
  perform tests.assert_raises(format($$select public.admin_revoke_role('%s')$$, owner_id), 'last super admin protected', 'LAST_SUPER_ADMIN');
  perform tests.as_user(mod);
  perform tests.assert_raises(format($$select public.admin_grant_role('%s', 'admin')$$, alice), 'moderators cannot grant roles', 'FORBIDDEN');

  -- Overview & analytics
  perform tests.as_user(owner_id);
  v_json := public.admin_overview();
  perform tests.assert((v_json->'users'->>'total')::int = 5 and jsonb_array_length(v_json->'series') = 14, 'overview stats');
  perform tests.assert(jsonb_array_length(public.admin_analytics(7)->'series') = 7, 'analytics series');
  perform tests.assert(jsonb_array_length(public.admin_search_users('alice')) = 1 and (public.admin_search_users('alice')->0->>'email') = 'alice@admin.test', 'user search includes email for admins');
  perform tests.assert((public.admin_get_user(alice)->>'username') = 'alice' and (public.admin_get_user(alice)->'sanctions') = '[]'::jsonb, 'user detail');
  v_json := public.admin_add_note(alice, 'Checked ID manually');
  perform tests.assert(jsonb_array_length(public.admin_get_user(alice)->'notes') = 1, 'admin note stored');

  -- Content for moderation
  perform tests.as_user(bob);
  v_post := public.create_post('text', 'spammy spam');
  v_video := public.create_video(format('https://x/storage/v1/object/public/videos/%s/v.mp4', bob), null, 'clip', 720, 1280, 5000);
  perform tests.as_user(alice);
  insert into public.reports (reporter_id, target_type, target_id, reason, details) values (alice, 'post', v_post->>'id', 'spam', 'Looks like spam') returning id into v_report;
  perform tests.as_user(owner_id);
  insert into public.reports (reporter_id, target_type, target_id, reason) values (owner_id, 'post', v_post->>'id', 'spam');

  -- Reports queue
  perform tests.as_user(mod);
  v_json := public.admin_list_reports('open');
  perform tests.assert(jsonb_array_length(v_json) = 2 and (v_json->0->'target'->>'text') = 'spammy spam' and (v_json->0->>'similar_reports')::int = 1, 'reports listed with target preview');
  perform public.admin_claim_report(v_report);
  perform tests.assert((public.admin_get_report(v_report)->>'status') = 'in_review', 'report claimed');
  v_json := public.admin_resolve_report(v_report, 'resolved', 'Removed as spam', 'remove_content');
  perform tests.assert(v_json->>'status' = 'resolved' and (v_json->'target'->>'removed_at') is not null, 'content removed via report');
  perform tests.assert((select count(*) from public.reports where status = 'open') = 0, 'duplicate reports closed together');
  perform tests.as_admin_db();
  perform tests.assert(exists (select 1 from public.notifications where user_id = bob and type = 'content_removed'), 'author notified');
  perform tests.assert((select removed_by from public.posts where id = (v_post->>'id')::uuid) = mod, 'removed_by recorded');
  perform tests.as_user(alice);
  perform tests.assert_raises(format($$select public.get_post('%s')$$, v_post->>'id'), 'removed post hidden from viewers', 'POST_NOT_FOUND');
  perform tests.as_user(bob);
  perform tests.assert((public.get_post((v_post->>'id')::uuid)->>'removed')::boolean, 'author sees removed flag');
  perform tests.as_user(mod);
  perform public.admin_restore_content('post', (v_post->>'id')::uuid);
  perform tests.assert((public.admin_list_content('post', 'spammy')->0->>'removed_at') is null, 'content restored');
  perform tests.assert(jsonb_array_length(public.admin_list_content('video')) = 1, 'video listing');

  -- Sanctions: feature restriction + suspension enforced by the guard trigger
  v_json := public.admin_restrict_feature(bob, 'comment', 24, 'Spam comments');
  perform tests.as_user(bob);
  perform tests.assert_raises(format($$select public.add_comment('%s', 'hi')$$, v_post->>'id'), 'restricted feature blocked', 'FEATURE_RESTRICTED');
  perform tests.assert(public.create_post('text', 'still allowed')->>'id' is not null, 'other features unaffected');
  perform tests.assert(jsonb_array_length(public.get_my_sanctions()) = 1, 'user sees their active sanction');
  perform tests.as_user(mod);
  perform public.admin_lift_sanction((v_json->>'id')::uuid, 'appeal accepted');
  perform tests.as_user(bob);
  perform tests.assert(public.add_comment((v_post->>'id')::uuid, 'hi')->>'id' is not null, 'lifted restriction');
  perform tests.as_user(mod);
  perform tests.assert_raises(format($$select public.admin_set_account_status('%s', 'banned', 'bad')$$, bob), 'moderators cannot ban', 'FORBIDDEN');
  v_json := public.admin_set_account_status(bob, 'suspended', 'Repeated spam', 7);
  perform tests.assert(v_json->>'account_status' = 'suspended' and (v_json->>'active_sanctions')::int = 1, 'suspended with sanction');
  perform tests.as_user(bob);
  perform tests.assert_raises($$select public.create_post('text', 'nope')$$, 'suspended users cannot post', 'ACCOUNT_');
  perform tests.assert_raises(format($$select public.send_message((select public.start_direct_conversation('%s')), 'text', 'hey')$$, alice), 'suspended users cannot message', 'ACCOUNT_');
  perform tests.as_user(owner_id);
  perform public.admin_set_account_status(bob, 'active', 'Appeal accepted');
  perform tests.as_user(bob);
  perform tests.assert(public.create_post('text', 'back')->>'id' is not null, 'reinstated');
  perform tests.as_user(owner_id);
  perform public.admin_warn_user(bob, 'Final warning');
  perform tests.assert((select count(*) from public.user_sanctions where user_id = bob) = 3, 'sanction history kept');
  perform public.admin_set_verified(alice, true, 'Known creator');
  perform tests.assert((select is_verified from public.profiles where id = alice), 'verified flag set');

  -- Live moderation
  perform tests.as_user(alice);
  v_live := public.create_live('Chill stream');
  perform public.start_live((v_live->>'id')::uuid);
  perform tests.as_user(mod);
  perform tests.assert(jsonb_array_length(public.admin_list_lives('live')) = 1, 'live sessions listed');
  v_json := public.admin_end_live((v_live->>'id')::uuid, 'Guideline violation', 2);
  perform tests.assert(v_json->>'status' = 'ended' and public.is_feature_restricted(alice, 'live'), 'live ended and host restricted');
  perform tests.as_user(alice);
  perform tests.assert_raises($$select public.create_live('again')$$, 'live restriction enforced', 'FEATURE_RESTRICTED');

  -- Finance: withdrawals, adjustments
  perform tests.as_service();
  perform public.credit_coins(alice, 10000, 'purchase', 'test', 'seed', 'seed:alice');
  perform tests.as_user(alice);
  perform public.send_gift((select id from public.gift_catalog where slug = 'diamond'), 'video', (v_video->>'id')::uuid, 10);
  perform tests.as_user(owner_id);
  perform public.admin_update_setting('payouts_enabled', 'true'::jsonb);
  perform public.admin_update_setting('min_withdrawal_coins', '100'::jsonb);
  perform tests.assert_raises($$select public.admin_update_setting('commission_rate', '"high"'::jsonb)$$, 'setting types validated', 'INVALID_VALUE');
  perform tests.as_user(bob);
  v_wd := public.request_withdrawal(500, '{"type":"bank","iban_last4":"0001"}'::jsonb);
  perform tests.as_user(mod);
  perform tests.assert_raises($$select public.admin_list_withdrawals()$$, 'moderators cannot see finance', 'FORBIDDEN');
  perform tests.as_user(fin);
  perform tests.assert(jsonb_array_length(public.admin_list_withdrawals('pending')) = 1, 'finance sees pending withdrawals');
  perform public.admin_review_withdrawal((v_wd->>'id')::uuid, 'approved', 'KYC ok');
  v_json := public.admin_review_withdrawal((v_wd->>'id')::uuid, 'paid', 'Paid via bank transfer');
  perform tests.assert(v_json->>'status' = 'paid', 'withdrawal paid');
  perform tests.as_admin_db();
  perform tests.assert((select pending_earnings from public.wallets where user_id = bob) = 0 and (select lifetime_withdrawn from public.wallets where user_id = bob) = 500, 'ledger reflects payout');
  perform tests.assert(exists (select 1 from public.notifications where user_id = bob and type = 'withdrawal_update'), 'payout notification');
  perform tests.as_user(fin);
  v_json := public.admin_adjust_coins(alice, -100, 'Chargeback');
  perform tests.assert((v_json->>'balance')::int = (10000 - 1000 - 100), 'coins adjusted through ledger');
  perform tests.assert(jsonb_array_length(public.admin_list_transactions(alice)) >= 3, 'transactions listed');
  perform tests.as_user(mod);
  perform tests.assert_raises(format($$select public.admin_adjust_coins('%s', 100, 'x')$$, alice), 'moderators cannot adjust coins', 'FORBIDDEN');

  -- Catalogue management
  perform tests.as_user(fin);
  v_json := public.admin_upsert_gift(null, 'unicorn', 'Unicorn', '🦄', 777, 'epic', 'burst', true, true, 99);
  perform tests.assert((v_json->>'coins')::int = 777, 'gift created');
  v_json := public.admin_upsert_coin_package(null, 'friendzy_coins_test', 'Test pack', 10, 0, 99, 'USD', false, 99);
  perform tests.assert(v_json->>'sku' = 'friendzy_coins_test', 'coin package created');
  v_json := public.admin_upsert_premium_plan('friendzy_premium_yearly', 'Premium Yearly', 'yearly', '$rc_annual', 4999, 'USD', 7, 'Save 58%', true, 2);
  perform tests.assert((v_json->>'price_cents')::int = 4999, 'plan updated');

  -- Site content
  perform tests.as_user(owner_id);
  v_json := public.admin_upsert_announcement(null, 'Welcome to Friendzy', 'Thanks for joining the beta!', 'info', 'all');
  v_ann := (v_json->>'id')::uuid;
  perform public.admin_upsert_announcement(null, 'Premium perks', 'New themes are live.', 'promo', 'premium');
  perform public.admin_upsert_banner(null, 'Creator fund', 'Apply now', 'https://x/banner.png', '/creators', 'home', 1, true);
  perform public.admin_set_featured_creator(alice, true, 'Rising star');
  v_topic := (public.admin_upsert_trending_topic(null, 'friendzylaunch', '#FriendzyLaunch', 'topic', 1, true)->>'id')::int;
  perform tests.as_user(bob);
  perform tests.assert(jsonb_array_length(public.get_active_announcements()) = 1, 'audience filtering (free user sees 1 of 2)');
  perform public.dismiss_announcement(v_ann);
  perform tests.assert(jsonb_array_length(public.get_active_announcements()) = 0, 'dismissed announcement hidden');
  perform tests.assert(jsonb_array_length(public.get_banners('home')) = 1 and jsonb_array_length(public.get_banners('live')) = 0, 'banners by placement');
  perform tests.assert((public.get_featured_creators()->0->>'username') = 'alice', 'featured creators');
  perform tests.assert((public.get_trending_topics()->0->>'tag') = 'friendzylaunch' and (public.get_trending_topics()->0->>'pinned')::boolean, 'pinned topic first');
  perform tests.assert_raises($$select public.admin_upsert_banner(null, 'x')$$, 'users cannot manage banners', 'FORBIDDEN');

  -- Verification flow
  perform tests.as_user(bob);
  v_json := public.request_verification('Bob Example', 'creator', '["https://youtube.com/@bob"]'::jsonb, bob::text || '/id.jpg', 'Creator with 50k subs');
  v_ver := (v_json->>'id')::uuid;
  perform tests.assert_raises($$select public.request_verification('Bob', 'creator')$$, 'one pending request at a time', 'REQUEST_PENDING');
  perform tests.assert_raises($$select public.request_verification('Bob', 'creator', '[]'::jsonb, 'someone-else/id.jpg')$$, 'document must be in own folder', 'REQUEST_PENDING');
  perform tests.assert((public.get_my_verification_request()->>'status') = 'pending', 'own request visible');
  perform tests.as_user(mod);
  perform tests.assert(jsonb_array_length(public.admin_list_verification_requests('pending')) = 1, 'queue lists pending requests');
  perform tests.assert_raises(format($$select public.admin_review_verification('%s', true)$$, v_ver), 'moderators cannot approve verification', 'FORBIDDEN');
  perform tests.as_user(owner_id);
  v_json := public.admin_review_verification(v_ver, true, 'Looks legit');
  perform tests.assert(v_json->>'status' = 'approved' and (select is_verified from public.profiles where id = bob), 'verification approved');

  -- Audit log
  v_json := public.admin_list_audit_logs(100);
  perform tests.assert(jsonb_array_length(v_json) >= 20 and (v_json->0->'admin'->>'username') is not null, 'audit log populated');
  perform tests.assert(jsonb_array_length(public.admin_list_audit_logs(10, null, null, 'withdrawal')) = 2, 'audit filter by action');
  perform tests.as_user(mod);
  perform tests.assert_raises($$select public.admin_list_audit_logs()$$, 'moderators cannot read audit log', 'FORBIDDEN');

  raise notice 'admin tests passed';
end $t$;
