-- Tests for 20261125000020_join_live_idempotent.sql
do $t$
declare host uuid; viewer uuid; v_live uuid; v_views integer; v_joins integer;
begin
  host   := tests.create_user('host@joinlive.test',   '{"display_name":"Host","username":"joinlivehost","birth_date":"1993-03-03"}');
  viewer := tests.create_user('viewer@joinlive.test', '{"display_name":"Viewer","username":"joinliveviewer","birth_date":"1992-03-03"}');

  perform tests.as_user(host);
  v_live := (public.create_live('Join twice', 'chat', null, 'public', null, true, true, 'everyone')->>'id')::uuid;
  perform public.start_live(v_live);

  -- First join: counted once, announced once.
  perform tests.as_user(viewer);
  perform public.join_live(v_live);
  select total_views into v_views from public.live_sessions where id = v_live;
  perform tests.assert(v_views = 1, 'the first join counts a view');
  select count(*) into v_joins from public.live_comments where live_id = v_live and kind = 'join';
  perform tests.assert(v_joins = 1, 'the first join is announced once');

  -- Joining again (reload, second tab) must succeed quietly, not raise a duplicate key.
  perform public.join_live(v_live);
  perform public.join_live(v_live);
  select total_views into v_views from public.live_sessions where id = v_live;
  perform tests.assert(v_views = 1, 're-joining does not inflate the view count');
  select count(*) into v_joins from public.live_comments where live_id = v_live and kind = 'join';
  perform tests.assert(v_joins = 1, 're-joining does not announce the viewer again');
  perform tests.assert((select count(*) from public.live_participants where live_id = v_live and user_id = viewer) = 1, 'the viewer has exactly one participant row');

  -- The race itself: the row appears between the lookup and the insert. Simulated by inserting the
  -- row behind join_live's back, which is the state the losing call finds.
  perform tests.as_admin_db();
  delete from public.live_participants where live_id = v_live and user_id = viewer;
  insert into public.live_participants (live_id, user_id, role, state) values (v_live, viewer, 'viewer', 'watching');
  perform tests.as_user(viewer);
  perform public.join_live(v_live);
  perform tests.assert((select state::text from public.live_participants where live_id = v_live and user_id = viewer) = 'watching', 'a join that lost the race still ends up watching');

  -- Leaving and coming back counts a new view, as before.
  perform public.leave_live(v_live);
  perform public.join_live(v_live);
  select total_views into v_views from public.live_sessions where id = v_live;
  perform tests.assert(v_views = 2, 'coming back after leaving counts another view');

  -- A removed viewer is still refused, including on the path that lost the race.
  perform tests.as_admin_db();
  update public.live_participants set state = 'removed' where live_id = v_live and user_id = viewer;
  perform tests.as_user(viewer);
  perform tests.assert_raises(format($$select public.join_live('%s')$$, v_live), 'a removed viewer cannot rejoin', 'REMOVED_FROM_LIVE');
end $t$;
