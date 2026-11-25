-- Tests for 20261125000005_videos.sql
do $t$
declare
  alice uuid; bob uuid; carol uuid;
  v_video jsonb; v_video2 jsonb; v_duet jsonb; v_comment jsonb; v_json jsonb; v_sound jsonb; v_pl jsonb;
begin
  alice := tests.create_user('alice@video.test', '{"display_name":"Alice","username":"alice","birth_date":"1998-01-01"}');
  bob   := tests.create_user('bob@video.test',   '{"display_name":"Bob","username":"bob","birth_date":"1997-01-01"}');
  carol := tests.create_user('carol@video.test', '{"display_name":"Carol","username":"carol","birth_date":"1996-01-01"}');
  update public.profiles set onboarding_completed = true;

  perform tests.as_user(alice);
  perform tests.assert_raises($$select public.create_video('https://x/videos/other/v.mp4')$$, 'video media must be owned', 'MEDIA_NOT_OWNED');
  v_video := public.create_video(format('https://x/storage/v1/object/public/videos/%s/v.mp4', alice), null, 'My first #dance video @bob', 720, 1280, 12000);
  perform tests.assert((v_video->>'status') = 'ready' and (v_video->'author'->>'username') = 'alice', 'video created');
  perform tests.assert((v_video->'sound'->>'is_original')::boolean = true and (v_video->'sound'->>'origin_video_id') = (v_video->>'id'), 'original sound created for the video');
  perform tests.assert(v_video->'hashtags' @> '["dance"]'::jsonb, 'video hashtags linked');
  perform tests.assert((select videos_count from public.hashtags where tag = 'dance') = 1, 'hashtag video counter');
  perform tests.assert((select videos_count from public.profiles where id = alice) = 1, 'profile videos counter');
  perform tests.as_admin_db();
  perform tests.assert(exists (select 1 from public.notifications where user_id = bob and type = 'mention' and entity_type = 'video'), 'video mention notified');

  -- Using someone else's sound
  perform tests.as_user(bob);
  v_video2 := public.create_video(format('https://x/storage/v1/object/public/videos/%s/b.mp4', bob), null, 'Using the sound', 720, 1280, 9000, 'public', true, true, true, false, (v_video->'sound'->>'id')::uuid);
  perform tests.assert((v_video2->'sound'->>'id') = (v_video->'sound'->>'id'), 'video reuses an existing sound');
  perform tests.assert((select uses_count from public.sounds where id = (v_video->'sound'->>'id')::uuid) = 2, 'sound uses counted');
  perform tests.assert((select count(*) from public.get_sound_videos((v_video->'sound'->>'id')::uuid)) = 2, 'sound page lists both videos');

  -- Interactions
  v_json := public.toggle_video_like((v_video->>'id')::uuid);
  perform tests.assert((v_json->>'liked')::boolean and (v_json->>'likes_count')::int = 1, 'video liked');
  perform tests.assert((select likes_count from public.profiles where id = alice) = 1, 'creator total likes updated');
  v_json := public.toggle_video_save((v_video->>'id')::uuid);
  perform tests.assert((v_json->>'saved')::boolean, 'video saved');
  v_json := public.toggle_video_repost((v_video->>'id')::uuid);
  perform tests.assert((v_json->>'reposted')::boolean, 'video reposted');
  perform public.record_video_share((v_video->>'id')::uuid);
  perform public.record_video_view((v_video->>'id')::uuid, 9000, true);
  perform tests.assert((select views_count from public.videos where id = (v_video->>'id')::uuid) = 1 and (select shares_count from public.videos where id = (v_video->>'id')::uuid) = 1, 'views and shares counted');
  perform tests.assert_raises($$insert into public.video_likes (video_id, user_id) values (gen_random_uuid(), auth.uid())$$, 'likes not directly insertable', 'permission denied');

  -- Comments & video replies
  v_comment := public.add_video_comment((v_video->>'id')::uuid, 'Amazing!');
  perform tests.assert((v_comment->'author'->>'username') = 'bob', 'video comment created');
  v_json := public.add_video_comment((v_video->>'id')::uuid, 'Thanks', (v_comment->>'id')::uuid);
  perform tests.assert((v_json->>'parent_id') = (v_comment->>'id'), 'reply attached');
  perform tests.assert((select count(*) from public.get_video_comments((v_video->>'id')::uuid)) = 1, 'top-level comments listed');
  perform tests.assert_raises(format($$select public.create_video('https://x/storage/v1/object/public/videos/%s/r.mp4', null, 'reply', 720, 1280, 3000, 'public', true, true, true, false, null, 1, 1, 0, null, 1, '[]'::jsonb, 'none', null, null, null, null, '%s')$$, bob, v_comment->>'id'), 'only video owner can video-reply', 'REPLY_NOT_ALLOWED');
  perform tests.as_user(alice);
  v_json := public.create_video(format('https://x/storage/v1/object/public/videos/%s/r.mp4', alice), null, 'reply video', 720, 1280, 3000, 'public', true, true, true, false, null, 1, 1, 0, null, 1, '[]'::jsonb, 'none', null, null, null, null, (v_comment->>'id')::uuid);
  perform tests.assert((v_json->'reply_to_comment'->>'id') = (v_comment->>'id'), 'video reply links to the comment');
  perform tests.assert((select reply_video_id from public.video_comments where id = (v_comment->>'id')::uuid) = (v_json->>'id')::uuid, 'comment points to its video reply');

  -- Duet / stitch permissions
  perform tests.as_user(carol);
  v_duet := public.create_video(format('https://x/storage/v1/object/public/videos/%s/d.mp4', carol), null, 'duet!', 720, 1280, 12000, 'public', true, true, true, false, null, 1, 1, 0, null, 1, '[]'::jsonb, 'none', (v_video->>'id')::uuid);
  perform tests.assert((v_duet->'duet_of'->>'id') = (v_video->>'id'), 'duet references original');
  perform tests.assert((select count(*) from public.get_video_duets((v_video->>'id')::uuid)) = 1, 'duets listed');
  perform tests.as_user(alice);
  perform public.update_video((v_video->>'id')::uuid, null, null, null, false, false);
  perform tests.as_user(carol);
  perform tests.assert_raises(format($$select public.create_video('https://x/storage/v1/object/public/videos/%s/d2.mp4', null, 'duet 2', 720, 1280, 1000, 'public', true, true, true, false, null, 1, 1, 0, null, 1, '[]'::jsonb, 'none', '%s')$$, carol, v_video->>'id'), 'duet blocked when disabled', 'DUET_NOT_ALLOWED');

  -- Feeds
  perform tests.as_user(carol);
  perform tests.assert((select count(*) from public.get_video_feed_for_you(10)) >= 2, 'for-you video feed has candidates');
  perform tests.assert((select count(*) from public.get_video_feed_trending(10)) >= 2, 'trending video feed');
  perform public.follow_user(alice);
  perform tests.assert((select count(*) from public.get_video_feed_following(10)) >= 2, 'following video feed');
  perform tests.assert((select count(*) from public.get_hashtag_videos('dance')) = 1, 'hashtag videos');
  perform tests.assert((select count(*) from public.get_user_videos(alice)) = 2, 'user videos listed');
  perform public.video_feedback((v_video->>'id')::uuid, 'not_interested');
  perform tests.assert(not exists (select 1 from public.get_video_feed_for_you(20) f where (f->'author'->>'id') = alice::text), 'not interested hides author videos');

  -- Audience: followers-only video hidden from strangers
  perform tests.as_user(bob);
  v_json := public.create_video(format('https://x/storage/v1/object/public/videos/%s/p.mp4', bob), null, 'private-ish', 720, 1280, 5000, 'followers');
  perform tests.as_user(carol);
  perform tests.assert_raises(format($$select public.get_video('%s')$$, v_json->>'id'), 'followers-only video hidden', 'VIDEO_NOT_FOUND');
  perform tests.assert((select count(*) from public.videos where id = (v_json->>'id')::uuid) = 0, 'RLS hides followers-only video');

  -- Playlists, challenges, sounds, drafts, analytics
  perform tests.as_user(alice);
  v_pl := public.create_playlist('Dance moves', 'all my dances');
  perform public.update_playlist((v_pl->>'id')::uuid, null, null, null, array[(v_video->>'id')::uuid]);
  perform tests.assert((select count(*) from public.get_playlist_videos((v_pl->>'id')::uuid)) = 1, 'playlist contains video');
  perform tests.assert(jsonb_array_length(public.get_playlists(alice)) = 1 and (public.get_playlists(alice)->0->>'videos_count')::int = 1, 'playlists listed with counts');
  v_json := public.create_challenge('#DanceOff', 'Dance off', 'Show your moves');
  perform tests.assert((v_json->>'tag') = 'danceoff', 'challenge created with normalised tag');
  perform tests.assert(jsonb_array_length(public.get_challenges()) >= 1, 'challenges listed');
  v_sound := public.create_sound('My beat', format('https://x/storage/v1/object/public/videos/%s/beat.mp3', alice), 'Alice', 30000, null, 'Original composition');
  perform tests.assert((v_sound->>'is_original')::boolean = false and (select count(*) from public.get_trending_sounds(10, 'beat')) = 1, 'sound uploaded and searchable');
  insert into public.video_drafts (user_id, data) values (alice, '{"caption":"wip"}'::jsonb);
  perform tests.assert((select count(*) from public.video_drafts) = 1, 'drafts readable by owner');
  perform tests.as_user(bob);
  perform tests.assert((select count(*) from public.video_drafts) = 0, 'drafts hidden from others');
  perform tests.as_user(alice);
  v_json := public.get_creator_analytics(28);
  perform tests.assert((v_json->'totals'->>'videos')::int = 2 and (v_json->'totals'->>'views')::int = 1 and (v_json->'totals'->>'new_followers')::int = 1, 'creator analytics totals');
  perform tests.assert(jsonb_array_length(v_json->'daily') >= 28, 'daily series returned');
  perform tests.assert((public.get_video_analytics((v_video->>'id')::uuid)->>'unique_viewers')::int = 1, 'video analytics');
  perform tests.as_user(bob);
  perform tests.assert(public.get_video_analytics((v_video->>'id')::uuid) is null, 'analytics only for owner');

  -- Delete cascades counters
  perform tests.as_user(alice);
  perform public.delete_video((v_video->>'id')::uuid);
  perform tests.assert((select videos_count from public.hashtags where tag = 'dance') = 0, 'hashtag counter decremented on delete');
  perform tests.assert((select videos_count from public.profiles where id = alice) = 1, 'profile video counter decremented');

  raise notice 'video tests passed';
end $t$;
