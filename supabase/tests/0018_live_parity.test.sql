-- Tests for 20261125000018_live_parity.sql
do $t$
declare
  host uuid; fan uuid; other uuid; v_live uuid; v_json jsonb; v_goal jsonb; v_q jsonb; v_q2 jsonb; v_gift_id integer; v_coins integer;
begin
  host  := tests.create_user('host@liveparity.test',  '{"display_name":"Host","username":"liveparityhost","birth_date":"1995-01-01"}');
  fan   := tests.create_user('fan@liveparity.test',   '{"display_name":"Fan","username":"liveparityfan","birth_date":"1996-01-01"}');
  other := tests.create_user('other@liveparity.test', '{"display_name":"Other","username":"liveparityother","birth_date":"1994-01-01"}');

  perform tests.assert((select relrowsecurity from pg_class where oid = 'public.live_goals'::regclass), 'live goals table has RLS');
  perform tests.assert((select relrowsecurity from pg_class where oid = 'public.live_questions'::regclass), 'live questions table has RLS');
  perform tests.assert((select relrowsecurity from pg_class where oid = 'public.live_comment_filters'::regclass), 'blocked words table has RLS');

  -- A running broadcast
  perform tests.as_user(host);
  v_live := (public.create_live('Parity test', 'chat', null, 'public', null, true, true, 'everyone')->>'id')::uuid;
  perform public.start_live(v_live);

  -- ---------------------------------------------------------------- goals
  v_goal := public.set_live_goal(v_live, 'coins', 100, 'New microphone');
  perform tests.assert(v_goal->>'status' = 'active' and (v_goal->>'target')::bigint = 100, 'host can set a coin goal');
  perform tests.assert((v_goal->>'progress')::bigint = 0, 'a fresh goal starts at zero');

  -- replacing a goal keeps only one running
  perform public.set_live_goal(v_live, 'likes', 50, null);
  perform tests.assert((select count(*) from public.live_goals where live_id = v_live and status = 'active') = 1, 'only one goal runs at a time');
  perform tests.assert((select kind from public.live_goals where live_id = v_live and status = 'active') = 'likes', 'the newest goal replaces the previous one');

  -- likes move a like goal and the goal completes
  perform tests.as_user(fan);
  perform public.like_live(v_live, 30);
  perform tests.assert((select progress from public.live_goals where live_id = v_live and status = 'active') = 30, 'likes count towards a like goal');
  perform public.like_live(v_live, 25);
  perform tests.assert((select status from public.live_goals where live_id = v_live and kind = 'likes') = 'reached', 'passing the target completes the goal');
  perform tests.assert(exists (select 1 from public.live_comments where live_id = v_live and kind = 'system' and text like '%Goal reached%'), 'the room is told when a goal is reached');

  -- viewers cannot set or cancel the goal
  perform tests.assert_raises(format($$select public.set_live_goal('%s', 'coins', 10, null)$$, v_live), 'only the host sets the goal', 'HOST_ONLY');
  perform tests.assert_raises(format($$select public.cancel_live_goal('%s')$$, v_live), 'only the host cancels the goal', 'HOST_ONLY');
  perform tests.as_user(host);
  perform tests.assert_raises(format($$select public.set_live_goal('%s', 'followers', 10, null)$$, v_live), 'unknown goal kinds are refused', 'INVALID_KIND');
  perform tests.assert_raises(format($$select public.set_live_goal('%s', 'coins', 0, null)$$, v_live), 'a goal needs a positive target', 'INVALID_TARGET');

  -- coin goals move when a gift lands
  perform public.set_live_goal(v_live, 'coins', 1000, 'Tour fund');
  select id, coins into v_gift_id, v_coins from public.gift_catalog where is_active order by coins limit 1;
  perform tests.as_service();
  perform public.credit_coins(fan, v_coins * 4, 'purchase', 'test', 'liveparity-1', 'liveparity:1');
  perform tests.as_user(fan);
  perform public.send_live_gift(v_live, v_gift_id, 2, null, null);
  perform tests.assert((select progress from public.live_goals where live_id = v_live and status = 'active') = v_coins * 2, 'gift coins count towards a coin goal');

  -- the broadcast payload carries the goal and the supporter ranking
  v_json := public.get_live(v_live);
  perform tests.assert(v_json->'goal'->>'label' = 'Tour fund', 'the goal travels with the broadcast');
  perform tests.assert((v_json->'goal'->>'progress')::bigint = v_coins * 2, 'goal progress travels with the broadcast');
  perform tests.assert(jsonb_array_length(v_json->'top_supporters') = 1, 'top supporters travel with the broadcast');
  perform tests.assert((v_json->'top_supporters'->0->>'coins')::bigint = v_coins * 2, 'the supporter total is the coins they gave');
  perform tests.assert((v_json->'top_supporters'->0->'user'->>'id') = fan::text, 'the supporter is the person who sent the gift');

  -- ------------------------------------------------------------------ Q&A
  v_q := public.ask_live_question(v_live, 'Which microphone do you use?');
  perform tests.assert(v_q->>'status' = 'pending', 'a viewer can ask a question');
  perform tests.assert_raises(format($$select public.ask_live_question('%s', 'And the camera?')$$, v_live), 'one open question per viewer', 'QUESTION_PENDING');
  perform tests.assert_raises(format($$select public.ask_live_question('%s', 'hi')$$, v_live), 'questions need some text', 'TEXT_REQUIRED');
  perform tests.assert_raises(format($$select public.vote_live_question('%s', true)$$, (v_q->>'id')), 'nobody upvotes their own question', 'CANNOT_VOTE_OWN');

  perform tests.as_user(other);
  v_q2 := public.vote_live_question((v_q->>'id')::uuid, true);
  perform tests.assert((v_q2->>'upvotes')::integer = 1, 'another viewer can upvote a question');
  perform tests.assert((select upvotes from public.live_questions where id = (v_q->>'id')::uuid) = 1, 'the upvote is stored on the question');
  perform tests.assert_raises(format($$select public.set_live_question('%s', 'featured')$$, (v_q->>'id')), 'viewers cannot put a question on screen', 'NOT_ALLOWED');

  perform tests.as_user(host);
  perform public.set_live_question((v_q->>'id')::uuid, 'featured');
  v_json := public.get_live(v_live);
  perform tests.assert(v_json->'featured_question'->>'id' = (v_q->>'id'), 'the featured question travels with the broadcast');
  perform tests.assert((select count(*) from public.get_live_questions(v_live, 'open', 50)) = 1, 'the open question list shows it');
  perform public.set_live_question((v_q->>'id')::uuid, 'answered');
  perform tests.assert((select status from public.live_questions where id = (v_q->>'id')::uuid) = 'answered', 'the host can mark a question answered');
  v_json := public.get_live(v_live);
  perform tests.assert(v_json->'featured_question' is null or v_json->'featured_question' = 'null'::jsonb, 'an answered question leaves the screen');

  -- -------------------------------------------------------- blocked words
  perform tests.as_user(host);
  perform public.set_live_comment_filter('Badword', true);
  perform tests.assert((select count(*) from public.get_live_comment_filters()) = 1, 'the host can block a word');
  perform tests.assert((select word from public.live_comment_filters where user_id = host) = 'badword', 'blocked words are stored lowercase');
  perform tests.as_user(fan);
  perform tests.assert_raises(format($$select public.send_live_comment('%s', 'this is a BADWORD here')$$, v_live), 'a blocked word stops the comment', 'COMMENT_FILTERED');
  perform public.send_live_comment(v_live, 'lovely stream');
  perform tests.assert(exists (select 1 from public.live_comments where live_id = v_live and text = 'lovely stream'), 'ordinary comments still go through');
  perform tests.as_user(host);
  perform tests.assert((select count(*) from public.live_comments where live_id = v_live and text like '%BADWORD%') = 0, 'the blocked comment was never stored');
  -- the host is not filtered by their own list
  perform public.send_live_comment(v_live, 'badword is fine from me');
  perform tests.assert(exists (select 1 from public.live_comments where live_id = v_live and text = 'badword is fine from me'), 'the host is not caught by their own filter');
  perform public.set_live_comment_filter('Badword', false);
  perform tests.assert((select count(*) from public.get_live_comment_filters()) = 0, 'the host can unblock a word');
  perform tests.assert_raises($$select public.set_live_comment_filter('x', true)$$, 'blocked words need two characters', 'WORD_REQUIRED');

  -- a viewer who cannot see the broadcast sees none of it
  perform tests.as_user(other);
  perform tests.assert((select count(*) from public.live_goals) >= 1, 'a viewer of a public broadcast sees its goals');
end $t$;
