-- Tests for 20261125000011_livekit_webhooks.sql
do $t$
declare
  alice uuid; bob uuid; carol uuid; v_live jsonb; v_live_id uuid; v_room text; v_json jsonb; v_conv uuid; v_call jsonb; v_call_id uuid; v_call2 jsonb;
begin
  alice := tests.create_user('alice@lk.test', '{"display_name":"Alice","username":"alice","birth_date":"1990-01-01"}');
  bob   := tests.create_user('bob@lk.test',   '{"display_name":"Bob","username":"bob","birth_date":"1991-01-01"}');
  carol := tests.create_user('carol@lk.test', '{"display_name":"Carol","username":"carol","birth_date":"1992-01-01"}');

  -- A running live with one viewer
  perform tests.as_user(alice);
  v_live := public.create_live('Webhook test');
  v_live_id := (v_live->>'id')::uuid;
  perform public.start_live(v_live_id);
  v_room := 'live_' || v_live_id::text;
  perform tests.as_user(bob);
  perform public.join_live(v_live_id);

  -- Clients can neither ingest nor read webhook events
  perform tests.assert_raises(format($$select public.livekit_ingest_event('EV_x', 'room_started', '%s')$$, v_room), 'clients cannot ingest webhook events', 'permission denied');
  perform tests.assert((select count(*) from public.livekit_webhook_events) = 0, 'webhook events hidden from clients');
  perform tests.assert_raises($$insert into public.livekit_webhook_events (id, event) values ('EV_y', 'room_started')$$, 'clients cannot write webhook events', 'permission denied');

  -- room_started → room sid stored; duplicate deliveries are counted, not reprocessed
  perform tests.as_service();
  v_json := public.livekit_ingest_event('EV_1', 'room_started', v_room, 'RM_abc', null, null, null, now(), '{"event":"room_started"}'::jsonb, 0);
  perform tests.assert((v_json->>'duplicate')::boolean = false and v_json->'applied' ? 'live.room_started', 'room_started applied: ' || v_json::text);
  perform tests.assert((select livekit_room_sid from public.live_sessions where id = v_live_id) = 'RM_abc', 'room sid stored on the live');
  v_json := public.livekit_ingest_event('EV_1', 'room_started', v_room, 'RM_abc');
  perform tests.assert((v_json->>'duplicate')::boolean and (v_json->>'attempts')::int = 2, 'duplicate delivery ignored and counted');
  perform tests.assert((select count(*) from public.livekit_webhook_events) = 1, 'one row per LiveKit event id');
  perform tests.assert((select processed_at is not null and applied ? 'live.room_started' from public.livekit_webhook_events where id = 'EV_1'), 'event marked processed with its effects');

  -- Host presence
  update public.live_sessions set host_last_seen_at = clock_timestamp() - interval '4 minutes' where id = v_live_id;
  v_json := public.livekit_ingest_event('EV_2', 'participant_joined', v_room, 'RM_abc', alice::text, 'PA_1');
  perform tests.assert(v_json->'applied' ? 'live.host_joined' and (select host_last_seen_at from public.live_sessions where id = v_live_id) > clock_timestamp() - interval '1 minute', 'host presence refreshed on join');

  -- Viewer disconnects and reconnects
  v_json := public.livekit_ingest_event('EV_3', 'participant_left', v_room, 'RM_abc', bob::text, 'PA_2');
  perform tests.assert(v_json->'applied' ? 'live.participant_left', 'viewer left applied');
  perform tests.assert((select state from public.live_participants where live_id = v_live_id and user_id = bob) = 'left', 'viewer marked left');
  perform tests.assert((select viewers_count from public.live_sessions where id = v_live_id) = 0, 'viewer count recounted after disconnect');
  v_json := public.livekit_ingest_event('EV_4', 'participant_joined', v_room, 'RM_abc', bob::text, 'PA_3');
  perform tests.assert(v_json->'applied' ? 'live.participant_seen', 'viewer rejoin applied');
  perform tests.assert((select state from public.live_participants where live_id = v_live_id and user_id = bob) = 'watching' and (select viewers_count from public.live_sessions where id = v_live_id) = 1, 'viewer counted again after reconnect');
  v_json := public.livekit_ingest_event('EV_5', 'participant_joined', v_room, 'RM_abc', 'not-a-user-id', 'PA_4');
  perform tests.assert(v_json->'applied' ? 'stored', 'unknown identities are stored without side effects');

  -- Egress: a malformed event fails safely and is retried with the same id
  v_json := public.livekit_ingest_event('EV_6', 'egress_started', v_room, 'RM_abc', null, null, null, now(), '{"event":"egress_started"}'::jsonb);
  perform tests.assert((v_json->>'error') like '%INVALID_EVENT%', 'malformed egress event reports an error');
  perform tests.assert((select processed_at is null and error is not null from public.livekit_webhook_events where id = 'EV_6'), 'failed event stays unprocessed for the retry');
  v_json := public.livekit_ingest_event('EV_6', 'egress_started', v_room, 'RM_abc', null, null, 'EG_1', now(),
    jsonb_build_object('event', 'egress_started', 'egressInfo', jsonb_build_object('egressId', 'EG_1', 'roomName', v_room, 'roomId', 'RM_abc', 'status', 'EGRESS_ACTIVE', 'startedAt', '1764000000000000000', 'roomComposite', jsonb_build_object('roomName', v_room))));
  perform tests.assert((v_json->>'duplicate')::boolean = false and v_json->'applied' ? 'egress.upsert' and (v_json->>'attempts')::int = 2, 'retry of a failed event is processed');
  perform tests.assert((select status = 'active' and kind = 'room_composite' and live_id = v_live_id and started_at is not null from public.livekit_egresses where egress_id = 'EG_1'), 'egress tracked for the live');
  perform tests.assert((select processed_at is not null and error is null from public.livekit_webhook_events where id = 'EV_6'), 'event marked processed after the retry');
  v_json := public.livekit_ingest_event('EV_7', 'egress_ended', v_room, 'RM_abc', null, null, 'EG_1', now(),
    jsonb_build_object('event', 'egress_ended', 'egressInfo', jsonb_build_object('egressId', 'EG_1', 'roomName', v_room, 'status', 'EGRESS_COMPLETE', 'startedAt', '1764000000000000000', 'endedAt', '1764000600000000000',
      'fileResults', jsonb_build_array(jsonb_build_object('filename', 'live.mp4', 'location', 'https://storage.example/live.mp4', 'size', '123456', 'duration', '600000000000')))));
  perform tests.assert((select status = 'complete' and ended_at > started_at and results->'files'->0->>'filename' = 'live.mp4' from public.livekit_egresses where egress_id = 'EG_1'), 'recording result stored');
  perform tests.as_user(alice);
  perform tests.assert((select count(*) from public.livekit_egresses) = 1, 'host can read their own recordings');
  perform tests.as_user(carol);
  perform tests.assert((select count(*) from public.livekit_egresses) = 0, 'others cannot read recordings');

  -- Empty media room ends the live
  perform tests.as_service();
  v_json := public.livekit_ingest_event('EV_8', 'room_finished', v_room, 'RM_abc');
  perform tests.assert(v_json->'applied' ? 'live.ended' and (select status from public.live_sessions where id = v_live_id) = 'ended', 'room_finished ends a running live');
  v_json := public.livekit_ingest_event('EV_9', 'room_finished', v_room, 'RM_abc');
  perform tests.assert(v_json->'applied' ? 'live.already_closed', 'late room_finished is harmless');

  -- A preview room that finishes cancels the draft live
  perform tests.as_user(alice);
  v_live := public.create_live('Preview only');
  perform tests.as_service();
  v_json := public.livekit_ingest_event('EV_10', 'room_finished', 'live_' || (v_live->>'id'), 'RM_def');
  perform tests.assert(v_json->'applied' ? 'live.cancelled' and (select status from public.live_sessions where id = (v_live->>'id')::uuid) = 'cancelled', 'preview room finishing cancels the draft live');

  -- Calls: disconnects seen by LiveKit close the call
  perform tests.as_user(alice);
  v_conv := public.start_direct_conversation(bob);
  perform tests.send_plain(v_conv, 'text', 'calling you');
  v_call := public.start_call(v_conv, 'voice');
  v_call_id := (v_call->>'id')::uuid;
  perform tests.as_user(bob);
  perform public.answer_call(v_call_id);
  perform tests.as_service();
  v_json := public.livekit_ingest_event('EV_11', 'room_started', 'call_' || v_call_id::text, 'RM_call');
  perform tests.assert(v_json->'applied' ? 'call.room_started' and (select livekit_room_sid from public.calls where id = v_call_id) = 'RM_call', 'call room sid stored');
  v_json := public.livekit_ingest_event('EV_12', 'participant_left', 'call_' || v_call_id::text, 'RM_call', bob::text, 'PA_9');
  perform tests.assert(v_json->'applied' ? 'call.participant_left', 'call participant left applied');
  perform tests.assert((select state from public.call_participants where call_id = v_call_id and user_id = bob) = 'left', 'callee marked left');
  perform tests.assert((select status = 'ended' and ended_reason = 'disconnected' from public.calls where id = v_call_id), 'direct call ends when the other side disconnects');
  perform tests.as_user(alice);
  v_call2 := public.start_call(v_conv, 'video');
  perform tests.as_service();
  v_json := public.livekit_ingest_event('EV_13', 'room_finished', 'call_' || (v_call2->>'id'), 'RM_call2');
  perform tests.assert(v_json->'applied' ? 'call.finished' and (select status from public.calls where id = (v_call2->>'id')::uuid) = 'cancelled', 'room_finished cancels a ringing call');

  -- Unhandled events and foreign rooms are stored only
  v_json := public.livekit_ingest_event('EV_14', 'track_published', v_room, 'RM_abc', bob::text);
  perform tests.assert(v_json->'applied' ? 'stored', 'unhandled events are stored only');
  v_json := public.livekit_ingest_event('EV_15', 'room_started', 'someone-elses-room', 'RM_zzz');
  perform tests.assert(v_json->'applied' ? 'ignored', 'rooms that are not Friendzy rooms are ignored');
  perform tests.assert_raises($$select public.livekit_ingest_event('', 'room_started')$$, 'empty event id rejected', 'INVALID_EVENT');

  -- Admins can audit; housekeeping removes processed events
  perform tests.assert((select count(*) from public.livekit_webhook_events where processed_at is not null) = 15, 'all events processed');
  perform tests.assert(public.cleanup_livekit_events(0) = 15, 'housekeeping removes old processed events');

  raise notice 'livekit webhook tests passed';
end $t$;
