-- Tests for 20261125000007_live.sql
do $t$
declare
  host uuid; viewer uuid; fan uuid; kid uuid; stranger uuid;
  v_live jsonb; v_json jsonb; v_comment jsonb; v_gift int; v_live_id uuid;
begin
  host     := tests.create_user('host@live.test',     '{"display_name":"Host","username":"host","birth_date":"1995-01-01"}');
  viewer   := tests.create_user('viewer@live.test',   '{"display_name":"Viewer","username":"viewer","birth_date":"1997-01-01"}');
  fan      := tests.create_user('fan@live.test',      '{"display_name":"Fan","username":"fan","birth_date":"1996-01-01"}');
  kid      := tests.create_user('kid@live.test',      '{"display_name":"Kid","username":"kid","birth_date":"2009-01-01"}');
  stranger := tests.create_user('stranger@live.test', '{"display_name":"Stranger","username":"stranger","birth_date":"1990-01-01"}');
  update public.profiles set onboarding_completed = true;

  -- Followers & coins
  perform tests.as_user(viewer); perform public.follow_user(host);
  perform tests.as_user(fan); perform public.follow_user(host);
  perform tests.as_service();
  perform public.credit_coins(fan, 5000, 'purchase', 'test', 'fan-1', 'fan:1');
  perform public.credit_coins(viewer, 1000, 'purchase', 'test', 'viewer-1', 'viewer:1');

  -- Creating a live
  perform tests.as_user(kid);
  perform tests.assert_raises($$select public.create_live('Kid live')$$, 'minors cannot host', 'ADULTS_ONLY');
  perform tests.as_user(host);
  perform tests.assert_raises($$select public.create_live('  ')$$, 'title required', 'TITLE_REQUIRED');
  v_json := public.create_live('Tomorrow show', 'music', null, 'public', now() + interval '1 day');
  perform tests.assert((v_json->>'status') = 'scheduled', 'future date schedules the live');
  perform tests.as_admin_db();
  perform tests.assert((select count(*) from public.notifications where type = 'live_scheduled' and user_id in (viewer, fan)) = 2, 'followers notified about the schedule');
  perform tests.as_user(host);
  perform public.end_live((v_json->>'id')::uuid); -- cancel the scheduled one
  perform tests.assert((select status from public.live_sessions where id = (v_json->>'id')::uuid) = 'cancelled', 'ending a scheduled live cancels it');

  v_live := public.create_live('Friday chill', 'chat');
  v_live_id := (v_live->>'id')::uuid;
  perform tests.assert((v_live->>'status') = 'preparing' and (v_live->>'room_name') = 'live_' || (v_live->>'id'), 'live prepared with room');
  perform tests.assert_raises($$select public.create_live('Second')$$, 'one broadcast at a time', 'ALREADY_LIVE');
  v_live := public.start_live(v_live_id);
  perform tests.assert((v_live->>'status') = 'live' and (v_live->>'started_at') is not null, 'live started');
  perform tests.as_admin_db();
  perform tests.assert((select count(*) from public.notifications where type = 'live_started' and entity_id = v_live_id::text) = 2, 'followers notified when live starts');

  -- Viewers
  perform tests.as_user(viewer);
  v_json := public.join_live(v_live_id);
  perform tests.assert((v_json->>'viewers_count')::int = 1 and (v_json->>'my_state') = 'watching', 'viewer joined');
  perform tests.as_user(fan);
  perform public.join_live(v_live_id);
  perform tests.as_user(host);
  perform tests.assert((public.live_heartbeat(v_live_id)->>'viewers_count')::int = 2, 'viewer count via heartbeat');
  perform tests.as_user(viewer);
  perform public.leave_live(v_live_id);
  perform tests.assert((select viewers_count from public.live_sessions where id = v_live_id) = 1, 'leaving decrements viewers');
  perform tests.assert((select total_views from public.live_sessions where id = v_live_id) = 2, 'total views counted');
  perform public.join_live(v_live_id);

  -- Comments: slow mode, audience, pins, mute
  v_comment := public.send_live_comment(v_live_id, 'Hello host!');
  perform tests.assert((v_comment->'user'->>'username') = 'viewer' and (v_comment->>'kind') = 'comment', 'comment sent');
  perform tests.as_user(host);
  perform public.update_live(v_live_id, null, null, null, null, null, null, 30);
  perform tests.as_user(viewer);
  perform tests.assert_raises(format($$select public.send_live_comment('%s', 'again')$$, v_live_id), 'slow mode enforced', 'SLOW_MODE');
  perform tests.as_user(host);
  perform public.update_live(v_live_id, null, null, null, null, null, 'friends', 0);
  perform tests.as_user(viewer);
  perform tests.assert_raises(format($$select public.send_live_comment('%s', 'friends only?')$$, v_live_id), 'comment audience enforced', 'COMMENTS_RESTRICTED');
  perform tests.as_user(host);
  perform public.update_live(v_live_id, null, null, null, null, null, 'everyone', 0);
  perform public.pin_live_comment((v_comment->>'id')::uuid, true);
  perform tests.assert((public.get_live(v_live_id)->'pinned_comment'->>'id') = (v_comment->>'id'), 'comment pinned');
  perform public.mute_live_user(v_live_id, viewer, 10);
  perform tests.as_user(viewer);
  perform tests.assert_raises(format($$select public.send_live_comment('%s', 'muted?')$$, v_live_id), 'muted users cannot comment', 'MUTED');
  perform tests.as_user(host);
  perform public.mute_live_user(v_live_id, viewer, 0);
  perform public.delete_live_comment((v_comment->>'id')::uuid);
  perform tests.assert((select count(*) from public.get_live_comments(v_live_id) c where (c->>'kind') = 'comment') = 0, 'deleted comments hidden');
  perform tests.as_user(viewer);
  perform tests.assert((public.like_live(v_live_id, 5)->>'likes_count')::int = 5, 'likes aggregated');

  -- Stage flow
  perform tests.as_user(kid);
  perform public.join_live(v_live_id);
  perform tests.assert_raises(format($$select public.request_live_stage('%s')$$, v_live_id), 'minors cannot go on stage', 'ADULTS_ONLY');
  perform tests.as_user(viewer);
  perform public.request_live_stage(v_live_id);
  perform tests.as_user(host);
  perform tests.assert((public.get_live(v_live_id)->>'pending_requests')::int = 1, 'host sees stage request');
  perform public.approve_live_guest(v_live_id, viewer, true);
  perform tests.assert(jsonb_array_length(public.get_live(v_live_id)->'stage') = 1, 'guest on stage');
  perform public.invite_live_guest(v_live_id, fan);
  perform tests.as_user(fan);
  perform tests.assert((select state from public.live_participants where live_id = v_live_id and user_id = fan) = 'invited', 'guest invited');
  perform public.accept_live_invite(v_live_id);
  perform tests.as_user(host);
  perform public.set_live_cohost(v_live_id, fan, true);
  perform tests.assert((select role from public.live_participants where live_id = v_live_id and user_id = fan) = 'cohost', 'co-host promoted');
  perform public.set_live_guest_media(v_live_id, viewer, false, null);
  perform tests.assert((select mic_enabled from public.live_participants where live_id = v_live_id and user_id = viewer) = false, 'host muted guest mic');

  -- Gifts: to host, to guest, battle scoring, fan club points
  perform tests.as_user(fan);
  select id into v_gift from public.gift_catalog where slug = 'diamond';
  v_json := public.send_live_gift(v_live_id, v_gift, 3);
  perform tests.assert((v_json->>'balance')::int = 5000 - 300, 'gift debited');
  perform tests.assert((select gifts_coins from public.live_sessions where id = v_live_id) = 300 and (select gifts_count from public.live_sessions where id = v_live_id) = 3, 'live gift totals');
  perform tests.assert((select count(*) from public.live_gift_events where live_id = v_live_id) = 1, 'gift event emitted');
  perform tests.assert((select count(*) from public.live_comments where live_id = v_live_id and kind = 'gift') = 1, 'gift comment in chat');
  perform tests.assert((public.get_fan_club(host)->'my_membership'->>'points')::int = 300, 'fan club points from gifts');
  perform tests.as_user(host);
  v_json := public.start_live_battle(v_live_id, viewer, 5);
  perform tests.assert((v_json->>'status') = 'active', 'battle started');
  perform tests.as_user(fan);
  perform public.send_live_gift(v_live_id, v_gift, 1);
  perform public.send_live_gift(v_live_id, v_gift, 2, viewer);
  perform tests.assert((public.get_live(v_live_id)->'battle'->>'host_score')::int = 100 and (public.get_live(v_live_id)->'battle'->>'opponent_score')::int = 200, 'battle scores from gifts');
  perform tests.as_admin_db();
  perform tests.assert((select earnings_balance from public.wallets where user_id = viewer) = 140, 'guest received net coins');
  perform tests.as_user(host);
  v_json := public.end_live_battle(v_live_id);
  perform tests.assert((v_json->>'winner_id') = viewer::text, 'battle winner decided');
  perform tests.assert((public.get_fan_club(host)->>'members_count')::int = 1 and (public.get_fan_club(host)->'top_fans'->0->>'level')::int = 1, 'fan club membership');

  -- Moderators & bans
  perform public.set_live_moderator(v_live_id, fan, true, true);
  perform tests.as_user(fan);
  perform public.ban_live_user(v_live_id, kid, true);
  perform tests.as_user(kid);
  perform tests.assert_raises(format($$select public.join_live('%s')$$, v_live_id), 'banned user cannot join', 'LIVE_NOT_FOUND');
  perform tests.assert((select count(*) from public.live_sessions where id = v_live_id) = 0, 'banned user cannot see the live (RLS)');

  -- Visibility: followers-only live hidden from strangers
  perform tests.as_user(host);
  perform public.end_live(v_live_id);
  perform tests.assert((select status from public.live_sessions where id = v_live_id) = 'ended', 'live ended');
  perform tests.assert((public.get_live_summary(v_live_id)->>'unique_viewers')::int = 3, 'summary unique viewers');
  v_live := public.create_live('Followers only', 'chat', null, 'followers');
  perform public.start_live((v_live->>'id')::uuid);
  perform tests.as_user(stranger);
  perform tests.assert(public.get_live((v_live->>'id')::uuid) is null, 'followers-only live hidden from strangers');
  perform tests.assert(jsonb_array_length(public.get_live_discovery()->'live') = 0, 'discovery respects visibility');
  perform tests.as_user(viewer);
  perform tests.assert(jsonb_array_length(public.get_live_discovery()->'live') = 1 and jsonb_array_length(public.get_live_discovery()->'following') = 1, 'followers see it in discovery');
  perform tests.assert((select count(*) from public.get_user_lives(host)) = 2, 'host live history visible');

  -- Cleanup of vanished hosts
  perform tests.as_admin_db();
  update public.live_sessions set host_last_seen_at = clock_timestamp() - interval '10 minutes' where id = (v_live->>'id')::uuid;
  perform tests.assert(public.cleanup_lives() = 1, 'stale live ended by cleanup');

  raise notice 'live tests passed';
end $t$;
