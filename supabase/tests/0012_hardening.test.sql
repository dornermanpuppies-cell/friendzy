-- Tests for 20261125000012_hardening.sql
do $t$
begin
  -- Signed-out visitors can read active plans directly (pricing page); RLS calls is_admin().
  perform tests.as_anon();
  perform tests.assert((select count(*) from public.premium_plans) = 2, 'anon can read active premium plans through RLS');

  -- Seeds exist exactly once and re-seeding is a no-op.
  perform tests.as_service();
  perform tests.assert((select count(*) from public.trivia_questions) = 40 and (select count(*) from public.party_prompts) = 40, 'content banks seeded once');
  insert into public.trivia_questions (category, difficulty, question, options, answer_index)
    select category, difficulty, question, options, answer_index from public.trivia_questions
    on conflict (question) do nothing;
  insert into public.party_prompts (game, kind, text, spice)
    select game, kind, text, spice from public.party_prompts
    on conflict (game, kind, text) do nothing;
  perform tests.assert((select count(*) from public.trivia_questions) = 40 and (select count(*) from public.party_prompts) = 40, 're-running the seed statements changes nothing');
  perform tests.assert_raises(
    $$insert into public.trivia_questions (category, difficulty, question, options, answer_index) values ('Geography', 'easy', 'Which is the largest ocean on Earth?', '["a","b","c","d"]', 0)$$,
    'duplicate trivia question rejected', 'duplicate key');
  perform tests.assert_raises(
    $$insert into public.party_prompts (game, kind, text, spice) values ('truth_or_dare', 'dare', 'Describe your day in three emojis only.', 'medium')$$,
    'duplicate party prompt rejected', 'duplicate key');

  raise notice 'hardening tests passed';
end $t$;
