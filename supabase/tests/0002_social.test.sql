-- Tests for 20261125000002_social.sql
do $t$
declare
  alice uuid; bob uuid; carol uuid; dave uuid;
  v_post jsonb; v_post2 jsonb; v_poll jsonb; v_share jsonb; v_priv jsonb; v_friends jsonb;
  v_comment jsonb; v_reply jsonb; v_story jsonb; v_story2 jsonb; v_hl jsonb; v_cand jsonb; v_json jsonb;
  v_id uuid; v_id2 uuid; v_count int; v_opt1 uuid; v_opt2 uuid; v_n int;
begin
  alice := tests.create_user('alice@social.test', '{"display_name":"Alice","username":"alice","birth_date":"1998-01-01","country_code":"PT"}');
  bob   := tests.create_user('bob@social.test',   '{"display_name":"Bob","username":"bob","birth_date":"1997-01-01","country_code":"PT"}');
  carol := tests.create_user('carol@social.test', '{"display_name":"Carol","username":"carol","birth_date":"2009-06-01","country_code":"BR"}'); -- 17
  dave  := tests.create_user('dave@social.test',  '{"display_name":"Dave","username":"dave","birth_date":"1990-01-01","country_code":"US"}');
  update public.profiles set onboarding_completed = true;
  insert into public.user_interests (user_id, interest_id) values (alice, 1), (alice, 2), (bob, 1), (bob, 3), (dave, 2);

  -- -------------------------------------------------------------------------
  -- Posting
  -- -------------------------------------------------------------------------
  perform tests.as_user(alice);
  v_post := public.create_post('text', 'Hello #Friendzy world! cc @bob and #hello', 'public');
  perform tests.assert((v_post->>'type') = 'text' and (v_post->'author'->>'username') = 'alice', 'text post created with author card');
  perform tests.assert(v_post->'hashtags' @> '["friendzy","hello"]'::jsonb, 'hashtags extracted and lower-cased');
  perform tests.assert((select posts_count from public.profiles where id = alice) = 1, 'posts counter incremented');
  perform tests.as_admin_db();
  perform tests.assert(exists (select 1 from public.notifications where user_id = bob and type = 'mention'), 'mention notified');
  perform tests.as_user(alice);
  perform tests.assert((select posts_count from public.hashtags where tag = 'friendzy') = 1, 'hashtag counter incremented');

  perform tests.assert_raises($$select public.create_post('text', '   ')$$, 'empty text rejected', 'TEXT_REQUIRED');
  perform tests.assert_raises($$select public.create_post('photo', 'pic')$$, 'photo without media rejected', 'MEDIA_REQUIRED');
  perform tests.assert_raises(
    format($$select public.create_post('photo', 'pic', 'public', true, '[{"url":"https://x/storage/v1/object/public/posts/%s/a.jpg","kind":"image"}]'::jsonb)$$, bob),
    'media from another user''s folder rejected', 'MEDIA_NOT_OWNED');
  perform tests.assert_raises($$insert into public.posts (author_id, type, text) values (auth.uid(), 'text', 'direct')$$, 'posts not directly insertable', 'permission denied');

  v_post2 := public.create_post('photo', 'A photo', 'public', true,
    format('[{"url":"https://x/storage/v1/object/public/posts/%s/a.jpg","kind":"image","width":100,"height":100}]', alice)::jsonb);
  perform tests.assert(jsonb_array_length(v_post2->'media') = 1, 'media attached');

  v_poll := public.create_post('poll', 'Tea or coffee?', 'public', true, '[]'::jsonb, '{"options":["Tea","Coffee"],"multiple":false,"duration_hours":24}'::jsonb);
  perform tests.assert(jsonb_array_length(v_poll->'poll'->'options') = 2, 'poll options created');
  perform tests.assert_raises($$select public.create_post('poll', 'Bad', 'public', true, '[]'::jsonb, '{"options":["only one"]}'::jsonb)$$, 'poll needs 2+ options', 'POLL_OPTIONS');

  v_priv := public.create_post('text', 'Followers only secret', 'followers');
  v_friends := public.create_post('text', 'Friends only secret', 'friends');

  -- -------------------------------------------------------------------------
  -- Visibility: audiences, private accounts, blocks
  -- -------------------------------------------------------------------------
  perform tests.as_user(bob);
  perform tests.assert((select count(*) from public.posts where author_id = alice) = 3, 'non-follower sees only public posts');
  perform tests.assert_raises(format($$select public.get_post('%s')$$, v_priv->>'id'), 'followers-only post hidden from strangers', 'POST_NOT_FOUND');
  perform public.follow_user(alice);
  perform tests.assert((select count(*) from public.posts where author_id = alice) = 4, 'follower sees followers-only posts');
  perform tests.assert_raises(format($$select public.get_post('%s')$$, v_friends->>'id'), 'friends-only post hidden from followers', 'POST_NOT_FOUND');
  perform public.send_friend_request(alice);
  perform tests.as_user(alice);
  perform public.respond_friend_request((select id from public.friend_requests where sender_id = bob and receiver_id = alice and status = 'pending'), true);
  perform tests.as_user(bob);
  perform tests.assert((public.get_post((v_friends->>'id')::uuid)->>'id') is not null, 'friend sees friends-only post');

  -- Private account: public posts only visible to followers
  perform tests.as_user(dave);
  v_json := public.create_post('text', 'Dave public post');
  update public.profiles set is_private = true where id = dave;
  perform tests.as_user(carol);
  perform tests.assert((select count(*) from public.posts where author_id = dave) = 0, 'private account posts hidden from non-followers');
  perform tests.as_user(dave);
  update public.profiles set is_private = false where id = dave;

  -- -------------------------------------------------------------------------
  -- Reactions, saves, reposts, feedback, impressions
  -- -------------------------------------------------------------------------
  perform tests.as_user(bob);
  v_json := public.toggle_post_reaction((v_post->>'id')::uuid, 'love');
  perform tests.assert((v_json->>'reaction') = 'love' and (v_json->>'likes_count')::int = 1, 'reaction set');
  v_json := public.toggle_post_reaction((v_post->>'id')::uuid, 'fire');
  perform tests.assert((v_json->>'reaction') = 'fire' and (v_json->>'likes_count')::int = 1, 'reaction replaced without double counting');
  v_json := public.toggle_post_reaction((v_post->>'id')::uuid, 'fire');
  perform tests.assert((v_json->>'reaction') is null and (v_json->>'likes_count')::int = 0, 'reaction removed');
  perform public.toggle_post_reaction((v_post->>'id')::uuid, 'like');
  perform tests.assert((select likes_count from public.profiles where id = alice) = 1, 'author total likes updated');
  perform tests.as_admin_db();
  perform tests.assert(exists (select 1 from public.notifications where user_id = alice and type = 'post_like' and actor_id = bob), 'like notification created');
  perform tests.as_user(bob);
  perform tests.assert_raises($$insert into public.post_likes (post_id, user_id) values (gen_random_uuid(), auth.uid())$$, 'likes not directly insertable', 'permission denied');

  v_json := public.toggle_save_post((v_post->>'id')::uuid);
  perform tests.assert((v_json->>'saved')::boolean = true, 'post saved');
  perform tests.assert((select count(*) from public.get_saved_posts(10)) = 1, 'saved posts listed');
  v_json := public.toggle_repost((v_post->>'id')::uuid);
  perform tests.assert((v_json->>'reposted')::boolean = true and (v_json->>'reposts_count')::int = 1, 'reposted');
  perform tests.assert_raises(format($$select public.toggle_repost('%s')$$, v_priv->>'id'), 'cannot repost non-public posts', 'CANNOT_SHARE_PRIVATE');
  v_share := public.create_post('share', 'Look at this', 'public', true, '[]'::jsonb, null, (v_post->>'id')::uuid);
  perform tests.assert((v_share->'shared_post'->>'id') = (v_post->>'id'), 'share embeds original post');
  perform tests.assert_raises(format($$select public.create_post('share', 'x', 'public', true, '[]'::jsonb, null, '%s')$$, v_friends->>'id'), 'cannot share friends-only post', 'CANNOT_SHARE_PRIVATE');

  -- Poll voting
  select (o->>'id')::uuid into v_opt1 from jsonb_array_elements(v_poll->'poll'->'options') o limit 1;
  select (o->>'id')::uuid into v_opt2 from jsonb_array_elements(v_poll->'poll'->'options') o offset 1 limit 1;
  v_json := public.vote_poll((v_poll->>'id')::uuid, array[v_opt1]);
  perform tests.assert((v_json->>'total_votes')::int = 1 and v_json->'my_votes' @> to_jsonb(array[v_opt1]), 'vote counted');
  v_json := public.vote_poll((v_poll->>'id')::uuid, array[v_opt2]);
  perform tests.assert((v_json->>'total_votes')::int = 1 and (select votes_count from public.poll_options where id = v_opt1) = 0, 'changing vote moves it');
  perform tests.assert_raises(format($$select public.vote_poll('%s', array['%s'::uuid,'%s'::uuid])$$, v_poll->>'id', v_opt1, v_opt2), 'single-choice poll rejects multiple', 'SINGLE_CHOICE');
  perform tests.as_admin_db();
  update public.post_polls set ends_at = now() - interval '1 minute' where post_id = (v_poll->>'id')::uuid;
  perform tests.as_user(bob);
  perform tests.assert_raises(format($$select public.vote_poll('%s', array['%s'::uuid])$$, v_poll->>'id', v_opt1), 'ended poll rejects votes', 'POLL_ENDED');

  -- -------------------------------------------------------------------------
  -- Comments
  -- -------------------------------------------------------------------------
  v_comment := public.add_comment((v_post->>'id')::uuid, 'Nice post @alice');
  perform tests.assert((v_comment->'author'->>'username') = 'bob', 'comment created');
  perform tests.assert((select comments_count from public.posts where id = (v_post->>'id')::uuid) = 1, 'comments counter');
  perform tests.as_admin_db();
  perform tests.assert(exists (select 1 from public.notifications where user_id = alice and type = 'post_comment'), 'comment notification');
  perform tests.as_user(bob);
  perform tests.as_user(alice);
  v_reply := public.add_comment((v_post->>'id')::uuid, 'Thanks!', (v_comment->>'id')::uuid);
  perform tests.assert((v_reply->>'parent_id') = (v_comment->>'id'), 'reply attached');
  perform tests.as_user(bob);
  v_json := public.add_comment((v_post->>'id')::uuid, 'Reply to a reply', (v_reply->>'id')::uuid);
  perform tests.assert((v_json->>'parent_id') = (v_comment->>'id'), 'threads stay one level deep');
  perform tests.assert((select replies_count from public.comments where id = (v_comment->>'id')::uuid) = 2, 'replies counter');
  perform tests.assert((select count(*) from public.get_comments((v_post->>'id')::uuid)) = 1, 'top-level comments listed');
  perform tests.assert((select count(*) from public.get_comments((v_post->>'id')::uuid, 20, null, (v_comment->>'id')::uuid)) = 2, 'replies listed');
  v_json := public.toggle_comment_reaction((v_comment->>'id')::uuid, 'like');
  perform tests.assert((v_json->>'likes_count')::int = 1, 'comment liked');
  perform tests.assert_raises(format($$select public.edit_comment('%s', 'hack')$$, v_reply->>'id'), 'cannot edit others'' comments', 'COMMENT_NOT_FOUND');
  perform tests.as_user(alice);
  perform public.delete_comment((v_comment->>'id')::uuid); -- post author may delete
  perform tests.assert((select comments_count from public.posts where id = (v_post->>'id')::uuid) = 0, 'cascade delete adjusts counters');

  -- who_can_comment = friends
  update public.user_settings set who_can_comment = 'friends' where user_id = alice;
  perform tests.as_user(dave);
  perform tests.assert_raises(format($$select public.add_comment('%s', 'hi')$$, v_post->>'id'), 'comment audience enforced', 'COMMENTS_RESTRICTED');
  perform tests.as_user(bob);
  perform public.add_comment((v_post->>'id')::uuid, 'friend can comment');
  perform tests.as_user(alice);
  update public.user_settings set who_can_comment = 'everyone' where user_id = alice;
  v_json := public.edit_post((v_post->>'id')::uuid, 'Edited text #newtag', null, false);
  perform tests.assert((v_json->>'edited_at') is not null and v_json->'hashtags' @> '["newtag"]'::jsonb, 'post edited, hashtags relinked');
  perform tests.assert((select posts_count from public.hashtags where tag = 'friendzy') = 0, 'removed hashtags decremented on edit');
  perform tests.as_user(dave);
  perform tests.assert_raises(format($$select public.add_comment('%s', 'hi')$$, v_post->>'id'), 'comments disabled respected', 'COMMENTS_DISABLED');

  -- -------------------------------------------------------------------------
  -- Feeds
  -- -------------------------------------------------------------------------
  perform tests.as_user(bob);
  perform tests.assert((select count(*) from public.get_feed_following(20)) >= 5, 'following feed includes alice''s visible posts + own share');
  perform tests.assert((select count(*) from public.get_feed_for_you(20)) >= 1, 'for-you feed returns candidates');
  perform tests.assert((select count(*) from public.get_feed_trending(20)) >= 1, 'trending feed returns public posts');
  perform tests.assert(not exists (select 1 from public.get_feed_for_you(50) f where (f->>'id') = (v_share->>'id')), 'own posts excluded from for-you');
  perform public.feed_feedback((v_post2->>'id')::uuid, 'hide');
  perform tests.assert(not exists (select 1 from public.get_feed_following(50) f where (f->>'id') = (v_post2->>'id')), 'hidden post removed from feeds');
  perform public.undo_feed_feedback((v_post2->>'id')::uuid);
  perform tests.assert(exists (select 1 from public.get_feed_following(50) f where (f->>'id') = (v_post2->>'id')), 'undo hide restores');
  perform public.record_impressions(array[(v_post2->>'id')::uuid]);
  perform tests.assert((select views_count from public.posts where id = (v_post2->>'id')::uuid) = 1, 'impression counted');
  perform tests.assert((select count(*) from public.get_user_posts(alice, 'photos')) = 1, 'profile photo tab filters');
  perform tests.assert((select count(*) from public.get_hashtag_posts('#NewTag')) = 1, 'hashtag page lists posts');
  perform tests.assert(jsonb_array_length(public.get_trending_hashtags(5)) >= 1, 'trending hashtags');

  -- -------------------------------------------------------------------------
  -- Stories
  -- -------------------------------------------------------------------------
  perform tests.as_user(alice);
  v_story := public.create_story('text', null, null, 'Good morning!', '{"bg":"#7000FF"}'::jsonb);
  perform tests.assert((v_story->>'kind') = 'text' and (v_story->>'audience') = 'followers', 'text story created with default audience');
  perform tests.assert_raises($$select public.create_story('image', 'https://x/stories/other/a.jpg')$$, 'story media must be owned', 'MEDIA_NOT_OWNED');
  v_story2 := public.create_story('image', format('https://x/storage/v1/object/public/stories/%s/s.jpg', alice), null, null, '{}'::jsonb, '[]'::jsonb, 'caption', null, 'friends');
  perform tests.as_user(dave);
  perform tests.assert((select count(*) from public.get_user_stories(alice)) = 0, 'stranger sees no followers-only stories');
  perform tests.assert(jsonb_array_length(public.get_story_tray()) = 0, 'tray empty for stranger');
  perform tests.as_user(bob);
  perform tests.assert((select count(*) from public.get_user_stories(alice)) = 2, 'friend+follower sees both stories');
  perform tests.assert((public.get_story_tray()->0->>'has_unseen')::boolean = true, 'tray shows unseen');
  perform public.mark_story_viewed((v_story->>'id')::uuid);
  perform public.mark_story_viewed((v_story->>'id')::uuid);
  perform tests.assert((select views_count from public.stories where id = (v_story->>'id')::uuid) = 1, 'view counted once');
  perform public.react_story((v_story->>'id')::uuid, '🔥');
  perform tests.assert(jsonb_array_length(public.get_story_viewers((v_story->>'id')::uuid)) = 0, 'non-owner cannot list viewers');
  perform tests.as_user(alice);
  perform tests.assert(jsonb_array_length(public.get_story_viewers((v_story->>'id')::uuid)) = 1 and (public.get_story_viewers((v_story->>'id')::uuid)->0->>'reaction') = '🔥', 'owner sees viewers and reactions');
  perform tests.assert(exists (select 1 from public.notifications where user_id = alice and type = 'story_reaction'), 'story reaction notification');
  v_hl := public.create_highlight('Mornings', array[(v_story->>'id')::uuid]);
  perform tests.assert((v_hl->>'count')::int = 1, 'highlight created');
  perform tests.as_admin_db();
  update public.stories set expires_at = now() - interval '1 hour' where id = (v_story->>'id')::uuid;
  perform tests.as_user(bob);
  perform tests.assert((select count(*) from public.get_user_stories(alice)) = 1, 'expired story disappears');
  perform tests.assert((select count(*) from public.get_highlight_stories((v_hl->>'id')::uuid)) = 1, 'expired story still visible in highlight');
  perform tests.assert(jsonb_array_length(public.get_highlights(alice)) = 1, 'highlights listed on profile');

  -- -------------------------------------------------------------------------
  -- Location & nearby
  -- -------------------------------------------------------------------------
  perform tests.as_user(alice);
  perform public.update_my_location(38.7223123, -9.1392987, 'Lisbon');
  perform tests.assert((select lat from public.user_locations where user_id = alice) = 38.72, 'location rounded to ~1km');
  perform tests.assert(jsonb_array_length(public.get_nearby_people()) = 0, 'nearby requires nearby_enabled');
  update public.user_settings set nearby_enabled = true where user_id = alice;
  perform tests.as_user(bob);
  update public.user_settings set nearby_enabled = true where user_id = bob;
  perform public.update_my_location(38.75, -9.15);
  perform tests.as_user(dave);
  update public.user_settings set nearby_enabled = true where user_id = dave;
  perform public.update_my_location(40.7128, -74.0060, 'New York');
  perform tests.as_user(alice);
  v_json := public.get_nearby_people();
  perform tests.assert(jsonb_array_length(v_json) = 1 and (v_json->0->'profile'->>'username') = 'bob', 'nearby finds bob, not dave');
  perform tests.assert((v_json->0->>'distance_km')::int between 1 and 10, 'distance is approximate');
  perform tests.assert((select count(*) from public.get_feed_nearby(20)) >= 1, 'nearby feed returns bob''s public posts');
  perform tests.as_user(bob);
  perform tests.assert((select count(*) from public.user_locations) = 1, 'locations visible only to owner');
  perform public.clear_my_location();
  perform tests.as_user(alice);
  perform tests.assert(jsonb_array_length(public.get_nearby_people()) = 0, 'cleared location removes from nearby');

  -- Online people respects presence + privacy
  perform tests.as_user(dave);
  perform public.touch_presence(true);
  perform tests.as_user(alice);
  perform tests.assert(jsonb_array_length(public.get_online_people()) = 1, 'online people lists dave');
  perform tests.as_user(dave);
  update public.user_settings set show_online_status = false where user_id = dave;
  perform tests.as_user(alice);
  perform tests.assert(jsonb_array_length(public.get_online_people()) = 0, 'hidden online status respected');

  -- -------------------------------------------------------------------------
  -- Random matching
  -- -------------------------------------------------------------------------
  perform tests.as_user(carol);
  perform tests.assert_raises($$select public.get_match_candidate()$$, 'minors cannot match', 'ADULTS_ONLY');
  perform tests.as_user(alice);
  v_cand := public.get_match_candidate();
  perform tests.assert(v_cand is not null and (v_cand->'profile'->>'username') = 'dave', 'candidate excludes friends (bob) and minors (carol)');
  perform public.match_action(dave, 'skip');
  perform tests.assert(public.get_match_candidate() is null, 'skipped candidate not repeated');
  perform tests.as_admin_db();
  delete from public.match_history where user_id = alice;
  perform tests.as_user(alice);
  v_json := public.match_action(dave, 'friend');
  perform tests.assert((v_json->>'friend_request_id') is not null, 'match friend action sends request');
  perform tests.as_user(dave);
  update public.user_settings set random_match_enabled = false where user_id = dave;
  perform tests.assert_raises($$select public.get_match_candidate()$$, 'opted-out users cannot match', 'MATCHING_DISABLED');

  -- -------------------------------------------------------------------------
  -- Search
  -- -------------------------------------------------------------------------
  perform tests.as_user(bob);
  v_json := public.search_all('alice');
  perform tests.assert(jsonb_array_length(v_json->'users') >= 1, 'search finds users');
  v_json := public.search_all('Edited');
  perform tests.assert(jsonb_array_length(v_json->'posts') >= 1, 'search finds posts');
  v_json := public.search_all('#newtag');
  perform tests.assert(jsonb_array_length(v_json->'hashtags') >= 1, 'search finds hashtags');
  perform public.save_search('alice');
  perform public.save_search('Alice');
  perform tests.assert(jsonb_array_length(public.get_recent_searches()) = 1, 'recent searches de-duplicated');
  perform tests.as_user(alice);
  perform public.save_search('alice');
  perform tests.assert((public.get_trending_searches()->0->>'query') = 'alice', 'trending searches aggregate across users');
  perform public.clear_search_history();
  perform tests.assert(jsonb_array_length(public.get_recent_searches()) = 0, 'history cleared');

  -- -------------------------------------------------------------------------
  -- Deletion & moderation
  -- -------------------------------------------------------------------------
  perform tests.as_user(bob);
  perform tests.assert_raises(format($$select public.delete_post('%s')$$, v_post->>'id'), 'cannot delete others'' posts', 'POST_NOT_FOUND');
  perform tests.as_user(alice);
  perform public.delete_post((v_post->>'id')::uuid);
  perform tests.assert((select posts_count from public.profiles where id = alice) = 4, 'posts counter decremented on delete');
  perform tests.assert((select posts_count from public.hashtags where tag = 'newtag') = 0, 'hashtag counter decremented on delete');
  perform tests.as_user(bob);
  perform tests.assert((public.get_post((v_share->>'id')::uuid)->'shared_post'->>'unavailable')::boolean = true, 'share shows unavailable after original deleted');

  raise notice 'social tests passed';
end $t$;
