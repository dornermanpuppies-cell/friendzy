-- Tests for 20261125000004_calls.sql
do $t$
declare
  alice uuid; bob uuid; carol uuid; dave uuid;
  v_dm uuid; v_group uuid; v_call jsonb; v_call2 jsonb; v_json jsonb; v_id uuid;
begin
  alice := tests.create_user('alice@calls.test', '{"display_name":"Alice","username":"alice","birth_date":"1998-01-01"}');
  bob   := tests.create_user('bob@calls.test',   '{"display_name":"Bob","username":"bob","birth_date":"1997-01-01"}');
  carol := tests.create_user('carol@calls.test', '{"display_name":"Carol","username":"carol","birth_date":"1996-01-01"}');
  dave  := tests.create_user('dave@calls.test',  '{"display_name":"Dave","username":"dave","birth_date":"1990-01-01"}');

  perform tests.as_user(alice);
  v_dm := public.start_direct_conversation(bob);
  perform tests.send_plain(v_dm, 'text', 'calling you');
  v_group := public.create_group('Call squad', array[bob, carol]);

  -- Start a DM voice call
  v_call := public.start_call(v_dm, 'voice');
  perform tests.assert((v_call->>'status') = 'ringing' and (v_call->>'room_name') = 'call_' || (v_call->>'id'), 'call created with room name');
  perform tests.assert(jsonb_array_length(v_call->'participants') = 2 and (v_call->>'my_state') = 'joined', 'initiator joined, callee invited');
  -- The invited side calling back joins the ongoing call; the initiator calling again (lost app) re-rings — see 0016.
  perform tests.as_user(bob);
  perform tests.assert((public.start_call(v_dm, 'video')->>'id') = (v_call->>'id'), 'callee starting a call joins the ongoing call');
  perform tests.as_user(alice);
  perform tests.assert_raises($$insert into public.calls (conversation_id, kind) values (gen_random_uuid(), 'voice')$$, 'calls not directly insertable', 'permission denied');

  -- Outsider cannot see it
  perform tests.as_user(dave);
  perform tests.assert((select count(*) from public.calls) = 0, 'non-participant cannot read calls');
  perform tests.assert(public.get_call((v_call->>'id')::uuid) is null, 'get_call returns null for outsiders');
  perform tests.assert_raises(format($$select public.answer_call('%s')$$, v_call->>'id'), 'outsider cannot answer', 'CALL_NOT_FOUND');

  -- Callee sees ringing call and answers
  perform tests.as_user(bob);
  perform tests.assert((public.get_active_call(v_dm)->>'status') = 'ringing', 'callee sees active (ringing) call');
  v_json := public.answer_call((v_call->>'id')::uuid);
  perform tests.assert((v_json->>'status') = 'active' and (v_json->>'started_at') is not null, 'answer activates the call');
  perform public.leave_call((v_call->>'id')::uuid);
  perform tests.as_admin_db();
  perform tests.assert((select status from public.calls where id = (v_call->>'id')::uuid) = 'ended', 'hang-up in a DM ends the call');
  perform tests.assert(exists (select 1 from public.messages where conversation_id = v_dm and kind = 'call' and metadata->>'outcome' = 'answered'), 'answered call logged in the chat');

  -- Declined call
  perform tests.as_user(alice);
  v_call2 := public.start_call(v_dm, 'video');
  perform tests.as_user(bob);
  perform public.decline_call((v_call2->>'id')::uuid);
  perform tests.as_admin_db();
  perform tests.assert((select status from public.calls where id = (v_call2->>'id')::uuid) = 'declined', 'decline ends a DM call');
  perform tests.assert(exists (select 1 from public.messages where conversation_id = v_dm and kind = 'call' and metadata->>'outcome' = 'declined'), 'declined call logged');

  -- Cancelled before answer → missed notification for callee
  perform tests.as_user(alice);
  v_call2 := public.start_call(v_dm, 'voice');
  perform public.leave_call((v_call2->>'id')::uuid, 'cancelled');
  perform tests.as_admin_db();
  perform tests.assert((select status from public.calls where id = (v_call2->>'id')::uuid) = 'cancelled', 'caller hang-up while ringing cancels');
  perform tests.assert((select state from public.call_participants where call_id = (v_call2->>'id')::uuid and user_id = bob) = 'missed', 'callee marked missed');
  perform tests.assert(exists (select 1 from public.notifications where user_id = bob and type = 'missed_call'), 'missed call notification created');

  -- Group call: stays active while 2+ joined
  perform tests.as_user(alice);
  v_call := public.start_call(v_group, 'video');
  perform tests.as_user(bob);
  perform public.answer_call((v_call->>'id')::uuid);
  perform tests.as_user(carol);
  perform public.answer_call((v_call->>'id')::uuid);
  perform tests.as_user(alice);
  perform public.leave_call((v_call->>'id')::uuid);
  perform tests.as_admin_db();
  perform tests.assert((select status from public.calls where id = (v_call->>'id')::uuid) = 'active', 'group call continues after one leaves');
  perform tests.as_user(bob);
  perform public.leave_call((v_call->>'id')::uuid);
  perform tests.as_user(carol);
  perform public.leave_call((v_call->>'id')::uuid);
  perform tests.as_admin_db();
  perform tests.assert((select status from public.calls where id = (v_call->>'id')::uuid) = 'ended', 'group call ends when everyone left');

  -- Timeout housekeeping
  perform tests.as_user(alice);
  v_call := public.start_call(v_dm, 'voice');
  perform tests.as_admin_db();
  update public.calls set created_at = clock_timestamp() - interval '2 minutes' where id = (v_call->>'id')::uuid;
  perform tests.assert(public.expire_ringing_calls() = 1, 'ringing call expired');
  perform tests.assert((select status from public.calls where id = (v_call->>'id')::uuid) = 'missed', 'expired call marked missed');

  -- History
  perform tests.as_user(bob);
  perform tests.assert((select count(*) from public.get_call_history(20)) >= 4, 'call history lists finished calls');
  perform tests.assert(exists (select 1 from public.get_call_history(20) h where (h->>'outcome') = 'missed' and (h->>'direction') = 'incoming'), 'history shows missed incoming calls');
  perform tests.as_user(alice);
  perform tests.assert(exists (select 1 from public.get_call_history(20) h where (h->>'outcome') = 'no_answer' and (h->>'direction') = 'outgoing'), 'history shows unanswered outgoing calls');

  -- Blocked users cannot be called
  perform tests.as_user(bob);
  perform public.block_user(alice);
  perform tests.as_user(alice);
  perform tests.assert_raises(format($$select public.start_call('%s', 'voice')$$, v_dm), 'blocked contact cannot be called', 'BLOCKED');

  raise notice 'calls tests passed';
end $t$;
