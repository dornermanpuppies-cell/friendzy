-- ============================================================================
-- Friendzy — Phase 12: post-launch hardening (safe to run on the live project)
-- 1) Content banks (trivia questions, party prompts) get unique keys so a repeated
--    seed run can never double the data. Existing duplicates (from an accidental
--    second run of 0008) are removed first, keeping the oldest row.
-- 2) `premium_plans` is readable by signed-out visitors (pricing page), but its RLS
--    policy calls is_admin(), which the anon role could not execute →
--    "permission denied for function is_admin". is_admin() returns false for anon,
--    so granting execute is harmless and fixes the read.
-- ============================================================================

delete from public.trivia_questions t
 using public.trivia_questions d
 where t.question = d.question and t.id > d.id;
create unique index if not exists trivia_questions_question_key on public.trivia_questions (question);

delete from public.party_prompts t
 using public.party_prompts d
 where t.game = d.game and t.kind = d.kind and t.text = d.text and t.id > d.id;
create unique index if not exists party_prompts_unique_key on public.party_prompts (game, kind, text);

grant execute on function public.is_admin() to anon;
