-- Tests for 20261125000015_e2ee.sql
-- The database only ever sees public keys and sealed envelopes; these tests use
-- random bytes shaped like real keys/ciphertext and verify every server-side rule.

create or replace function tests.b64(p_bytes integer) returns text language sql volatile as $$
  select replace(encode(extensions.gen_random_bytes(p_bytes), 'base64'), E'\n', '')
$$;

-- Builds a well-formed envelope whose wrapped keys cover every non-revoked device
-- of the given users (plus p_extra device ids, minus p_skip device ids).
create or replace function tests.envelope(p_sender uuid, p_device text, p_users uuid[], p_extra text[] default '{}', p_skip text[] default '{}')
returns jsonb language sql volatile security definer as $$
  select jsonb_build_object(
    'v', 1,
    'alg', 'x25519-hkdf-sha256/xchacha20poly1305/ed25519',
    'sender', jsonb_build_object('user', p_sender, 'device', p_device),
    'eph', tests.b64(32), 'nonce', tests.b64(24), 'ct', tests.b64(48), 'sig', tests.b64(48),
    'keys', (select coalesce(jsonb_object_agg(s.x, tests.b64(48)), '{}'::jsonb) from (
      select d.device_id as x from public.e2ee_devices d
       where d.user_id = any (p_users) and d.revoked_at is null and not (d.device_id = any (p_skip))
      union select unnest(p_extra)) s))
$$;

create or replace function tests.envelope_for(p_conversation uuid, p_sender uuid, p_device text, p_extra text[] default '{}', p_skip text[] default '{}')
returns jsonb language sql volatile security definer as $$
  select tests.envelope(p_sender, p_device,
    (select coalesce(array_agg(m.user_id), '{}'::uuid[]) from public.conversation_members m where m.conversation_id = p_conversation and m.state in ('active', 'pending')),
    p_extra, p_skip)
$$;

do $t$
declare
  alice uuid; bob uuid; carol uuid; dave uuid;
  a1 text := 'alice-device-0001-aaaa'; b1 text := 'bob-device-00001-bbbb'; b2 text := 'bob-device-00002-bbbb'; c1 text := 'carol-device-0001-cccc'; d1 text := 'dave-device-00001-dddd';
  v_dm uuid; v_dm2 uuid; v_group uuid; v_msg jsonb; v_json jsonb; v_env jsonb; v_story jsonb; v_id uuid; i int;
begin
  alice := tests.create_user('alice@e2ee.test', '{"display_name":"Alice","username":"alice","birth_date":"1998-01-01"}');
  bob   := tests.create_user('bob@e2ee.test',   '{"display_name":"Bob","username":"bob","birth_date":"1997-01-01"}');
  carol := tests.create_user('carol@e2ee.test', '{"display_name":"Carol","username":"carol","birth_date":"1996-01-01"}');
  dave  := tests.create_user('dave@e2ee.test',  '{"display_name":"Dave","username":"dave","birth_date":"1990-01-01"}');

  -- -------------------------------------------------------------------------
  -- Schema & privileges
  -- -------------------------------------------------------------------------
  perform tests.assert((select relrowsecurity from pg_class where oid = 'public.e2ee_devices'::regclass), 'e2ee_devices has RLS');
  perform tests.assert(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'messages' and column_name = 'envelope'), 'messages.envelope column exists');
  perform tests.assert(not has_function_privilege('authenticated', 'public.send_message(uuid, public.message_kind, text, jsonb, jsonb, uuid, text)', 'execute'), 'plaintext send_message is not executable by clients');
  perform tests.assert(not has_function_privilege('authenticated', 'public.edit_message(uuid, text)', 'execute'), 'plaintext edit_message is not executable by clients');
  perform tests.assert(not has_function_privilege('authenticated', 'public.forward_messages(uuid[], uuid[])', 'execute'), 'server-side forward is not executable by clients');
  perform tests.assert(not has_function_privilege('authenticated', 'public.e2ee_validate_envelope(uuid, uuid, jsonb)', 'execute'), 'envelope validator is internal');
  perform tests.assert(has_function_privilege('authenticated', 'public.send_encrypted_message(uuid, public.message_kind, jsonb, jsonb, uuid, text, boolean)', 'execute'), 'encrypted send is executable by clients');
  perform tests.assert(not has_function_privilege('anon', 'public.register_e2ee_device(text, text, text, text, text)', 'execute'), 'anon cannot register devices');
  perform tests.assert(to_regprocedure('public.send_story_reply(uuid, text)') is null, 'plaintext story reply signature removed');

  -- -------------------------------------------------------------------------
  -- Device registration
  -- -------------------------------------------------------------------------
  perform tests.as_user(alice);
  v_json := public.register_e2ee_device(a1, 'web', tests.b64(32), tests.b64(32), 'Chrome on Windows');
  perform tests.assert((v_json->>'device_id') = a1 and (v_json->>'name') = 'Chrome on Windows' and (v_json->>'platform') = 'web', 'device registered with name');
  perform tests.assert_raises(format($$select public.register_e2ee_device('%s', 'web', 'not-a-key', '%s')$$, a1, tests.b64(32)), 'malformed key rejected', 'INVALID_DEVICE');
  perform tests.assert_raises(format($$select public.register_e2ee_device('short', 'web', '%s', '%s')$$, tests.b64(32), tests.b64(32)), 'short device id rejected', 'INVALID_DEVICE');
  perform tests.assert_raises(format($$select public.register_e2ee_device('tv-device-000000001', 'tv', '%s', '%s')$$, tests.b64(32), tests.b64(32)), 'unknown platform rejected', 'INVALID_DEVICE');
  v_json := public.register_e2ee_device(a1, 'web', v_json->>'identity_key', v_json->>'signing_key', null);
  perform tests.assert((select count(*) from public.e2ee_devices where user_id = alice) = 1, 're-registration does not duplicate the device');
  perform tests.assert((v_json->>'name') = 'Chrome on Windows', 'name kept when re-registering without one');
  perform tests.assert(jsonb_array_length(public.get_e2ee_devices()) = 1, 'own device list has one entry');

  perform tests.as_user(bob);
  perform tests.assert_raises(format($$select public.register_e2ee_device('%s', 'android', '%s', '%s')$$, a1, tests.b64(32), tests.b64(32)), 'device ids are globally unique', 'DEVICE_ID_TAKEN');
  perform public.register_e2ee_device(b1, 'android', tests.b64(32), tests.b64(32), 'Pixel 8');
  perform public.register_e2ee_device(b2, 'web', tests.b64(32), tests.b64(32), 'Safari on Mac');
  perform tests.assert((select count(*) from public.e2ee_devices) = 2, 'RLS: bob sees only his own device rows');
  perform tests.assert((select count(*) from public.e2ee_devices where user_id = alice) = 0, 'RLS: other users'' device rows are hidden');
  perform tests.assert_raises($$insert into public.e2ee_devices (user_id, device_id, platform, identity_key, signing_key) values (auth.uid(), 'direct-insert-0001', 'web', 'x', 'y')$$, 'devices are not directly insertable', 'permission denied');

  -- Public keys of another user
  perform tests.as_user(alice);
  v_json := public.e2ee_user_devices(bob);
  perform tests.assert(jsonb_array_length(v_json) = 2 and (v_json->0->>'name') is null and (v_json->0->>'identity_key') ~ '^[A-Za-z0-9+/]{43}=$', 'other users'' public keys are visible without device names');
  perform tests.assert((public.e2ee_user_devices(alice)->0->>'name') = 'Chrome on Windows', 'own devices include names');

  -- Recipients for a direct chat
  v_dm := public.start_direct_conversation(bob);
  v_json := public.e2ee_recipients(v_dm);
  perform tests.assert(jsonb_array_length(v_json->'members') = 2 and jsonb_array_length(v_json->'devices') = 3, 'recipients list both members and all three devices');
  perform tests.as_user(dave);
  perform tests.assert_raises(format($$select public.e2ee_recipients('%s')$$, v_dm), 'non-members cannot list recipients', 'CONVERSATION_NOT_FOUND');

  -- -------------------------------------------------------------------------
  -- Sending sealed messages
  -- -------------------------------------------------------------------------
  perform tests.as_user(alice);
  v_env := tests.envelope_for(v_dm, alice, a1);
  v_msg := public.send_encrypted_message(v_dm, 'text', v_env, '[]'::jsonb, null, 'e2ee-client-1');
  perform tests.assert((v_msg->>'encrypted')::boolean and (v_msg->>'text') is null and (v_msg->'envelope'->>'ct') = (v_env->>'ct') and (v_msg->'metadata') = '{}'::jsonb, 'sealed message stored without plaintext, envelope returned');
  perform tests.assert((public.send_encrypted_message(v_dm, 'text', v_env, '[]'::jsonb, null, 'e2ee-client-1')->>'id') = (v_msg->>'id'), 'client_id makes sealed sends idempotent');
  perform tests.assert((select text is null and envelope->>'ct' = (v_env->>'ct') from public.messages where id = (v_msg->>'id')::uuid), 'envelope persisted, no plaintext column written');

  -- Validation
  perform tests.assert_raises(format($$select public.send_encrypted_message('%s', 'text', '%s')$$, v_dm, tests.envelope_for(v_dm, alice, a1, '{}', array[b2])::text), 'missing a device key is rejected', 'STALE_RECIPIENTS');
  perform tests.assert_raises(format($$select public.send_encrypted_message('%s', 'text', '%s')$$, v_dm, tests.envelope_for(v_dm, alice, a1, array['unknown-device-0001'])::text), 'extra unknown device key is rejected', 'STALE_RECIPIENTS');
  perform tests.assert_raises(format($$select public.send_encrypted_message('%s', 'text', '%s')$$, v_dm, tests.envelope_for(v_dm, alice, 'ghost-device-00001')::text), 'unregistered sender device is rejected', 'DEVICE_NOT_REGISTERED');
  perform tests.assert_raises(format($$select public.send_encrypted_message('%s', 'text', '%s')$$, v_dm, tests.envelope_for(v_dm, bob, b1)::text), 'sender must match the caller', 'ENVELOPE_INVALID');
  perform tests.assert_raises(format($$select public.send_encrypted_message('%s', 'text', '%s')$$, v_dm, (tests.envelope_for(v_dm, alice, a1) - 'sig')::text), 'signature is required', 'ENVELOPE_INVALID');
  perform tests.assert_raises(format($$select public.send_encrypted_message('%s', 'text', '%s')$$, v_dm, (tests.envelope_for(v_dm, alice, a1) || jsonb_build_object('ct', repeat('A', 140000)))::text), 'oversized envelopes are rejected', 'ENVELOPE_TOO_LARGE');
  perform tests.assert_raises(format($$select public.send_encrypted_message('%s', 'system', '%s')$$, v_dm, tests.envelope_for(v_dm, alice, a1)::text), 'system kind cannot be sent by clients', 'INVALID_KIND');
  perform tests.assert_raises(format($$select public.send_encrypted_message('%s', 'text', '%s')$$, v_dm, tests.envelope_for(v_dm, alice, a1, '{}', array[a1])::text), 'sender must be able to read its own message', 'ENVELOPE_INVALID');
  perform tests.assert_raises(format($$select public.send_encrypted_message('%s', 'image', '%s')$$, v_dm, tests.envelope_for(v_dm, alice, a1)::text), 'media kinds need attachments', 'ATTACHMENT_REQUIRED');

  -- Attachments: ciphertext objects under the sender's folder; names/mime/dimensions stay inside the envelope
  v_msg := public.send_encrypted_message(v_dm, 'image', tests.envelope_for(v_dm, alice, a1),
    format('[{"path":"%s/%s/img-1.bin","kind":"image","size_bytes":1234,"thumbnail_path":"%s/%s/thumb-1.bin","name":"secret.jpg","mime":"image/jpeg","width":100}]', v_dm, alice, v_dm, alice)::jsonb, null, 'e2ee-client-2');
  perform tests.assert((v_msg->'attachments'->0->>'mime') = 'application/octet-stream' and (v_msg->'attachments'->0->>'name') is null and (v_msg->'attachments'->0->>'width') is null
                       and (v_msg->'attachments'->0->>'size_bytes') = '1234' and (v_msg->'attachments'->0->>'thumbnail_path') like v_dm::text || '/%', 'attachment rows keep only kind, path, size and thumbnail path');
  perform tests.assert_raises(format($$select public.send_encrypted_message('%s', 'image', '%s', '[{"path":"%s/%s/x.bin","kind":"image"}]')$$, v_dm, tests.envelope_for(v_dm, alice, a1)::text, v_dm, bob), 'attachment path must be under sender folder', 'ATTACHMENT_NOT_OWNED');
  perform tests.assert_raises(format($$select public.send_encrypted_message('%s', 'image', '%s', '[{"path":"%s/%s/x.bin","kind":"image","thumbnail_path":"%s/%s/t.bin"}]')$$, v_dm, tests.envelope_for(v_dm, alice, a1)::text, v_dm, alice, v_dm, bob), 'thumbnail path must be under sender folder', 'ATTACHMENT_NOT_OWNED');

  -- Reading back: members get envelopes, previews only reveal the kind
  perform tests.as_user(bob);
  perform tests.assert((select count(*) from public.get_messages(v_dm) j where (j->>'encrypted')::boolean and (j->'envelope'->>'ct') is not null) = 2, 'recipient receives both envelopes');
  v_json := public.get_conversation(v_dm);
  perform tests.assert((v_json->'last_message'->>'encrypted')::boolean and (v_json->'last_message'->'envelope'->>'ct') is not null and (v_json->'last_message'->>'preview') = '📷 Photo', 'conversation last_message carries the envelope and a kind-only preview');
  v_json := public.send_encrypted_message(v_dm, 'text', tests.envelope_for(v_dm, bob, b1), '[]'::jsonb, (v_msg->>'id')::uuid, 'e2ee-client-3');
  perform tests.assert((v_json->'reply_to'->>'encrypted')::boolean and (v_json->'reply_to'->'envelope'->>'ct') is not null and (v_json->'reply_to'->>'preview') = '📷 Photo', 'reply_to includes the quoted envelope');

  -- -------------------------------------------------------------------------
  -- Editing
  -- -------------------------------------------------------------------------
  perform tests.as_user(alice);
  v_id := (select (j->>'id')::uuid from public.get_messages(v_dm) j where (j->>'kind') = 'text' and (j->>'is_mine')::boolean limit 1);
  v_env := tests.envelope_for(v_dm, alice, a1);
  v_json := public.edit_encrypted_message(v_id, v_env);
  perform tests.assert((v_json->>'edited_at') is not null and (v_json->'envelope'->>'ct') = (v_env->>'ct'), 'edit replaces the envelope and marks edited');
  perform tests.assert_raises(format($$select public.edit_encrypted_message('%s', '%s')$$, v_msg->>'id', tests.envelope_for(v_dm, alice, a1)::text), 'only text messages can be edited', 'CANNOT_EDIT');
  perform tests.assert_raises(format($$select public.edit_encrypted_message('%s', '%s')$$, v_id, tests.envelope_for(v_dm, alice, a1, '{}', array[b1])::text), 'edits are validated against current devices', 'STALE_RECIPIENTS');
  perform tests.as_user(bob);
  perform tests.assert_raises(format($$select public.edit_encrypted_message('%s', '%s')$$, v_id, tests.envelope_for(v_dm, bob, b1)::text), 'cannot edit someone else''s message', 'MESSAGE_NOT_FOUND');

  -- Server-side forwarding skips sealed messages (clients re-encrypt instead)
  v_dm2 := public.start_direct_conversation(carol);
  perform tests.assert(tests.forward_plain(array[v_id], array[v_dm2]) = 0, 'server-side forward skips sealed sources');

  -- Members without keys block sending — there is no silent plaintext fallback
  perform tests.assert_raises(format($$select public.send_encrypted_message('%s', 'text', '%s')$$, v_dm2, tests.envelope_for(v_dm2, bob, b1)::text), 'cannot seal for a member without devices', 'RECIPIENT_WITHOUT_KEYS');
  perform tests.as_user(carol);
  perform public.register_e2ee_device(c1, 'ios', tests.b64(32), tests.b64(32), 'iPhone');
  perform tests.as_user(bob);
  v_json := public.send_encrypted_message(v_dm2, 'text', tests.envelope_for(v_dm2, bob, b1), '[]'::jsonb, null, 'e2ee-client-4');
  perform tests.assert((v_json->>'encrypted')::boolean, 'sending works once every member has a device');

  -- -------------------------------------------------------------------------
  -- Revocation
  -- -------------------------------------------------------------------------
  perform public.revoke_e2ee_device(b2);
  perform tests.assert(jsonb_array_length(public.get_e2ee_devices()) = 1, 'revoked device disappears from own list');
  perform tests.assert_raises(format($$select public.revoke_e2ee_device('%s')$$, b2), 'revoking twice fails', 'DEVICE_NOT_FOUND');
  perform tests.assert_raises(format($$select public.revoke_e2ee_device('%s')$$, a1), 'cannot revoke another user''s device', 'DEVICE_NOT_FOUND');
  perform tests.assert_raises(format($$select public.register_e2ee_device('%s', 'web', '%s', '%s')$$, b2, tests.b64(32), tests.b64(32)), 'a revoked device id cannot come back', 'DEVICE_REVOKED');
  perform tests.as_user(alice);
  perform tests.assert(jsonb_array_length(public.e2ee_recipients(v_dm)->'devices') = 2, 'recipients exclude revoked devices');
  perform tests.assert((select count(*) from jsonb_array_elements(public.e2ee_user_devices(bob)) d where (d->>'revoked_at') is not null) = 1, 'revoked devices stay visible (flagged) so old signatures can be verified');
  perform tests.assert_raises(format($$select public.send_encrypted_message('%s', 'text', '%s')$$, v_dm, tests.envelope_for(v_dm, alice, a1, array[b2])::text), 'keys for revoked devices are rejected', 'STALE_RECIPIENTS');
  perform public.send_encrypted_message(v_dm, 'text', tests.envelope_for(v_dm, alice, a1), '[]'::jsonb, null, 'e2ee-client-5');

  -- -------------------------------------------------------------------------
  -- Groups: a key for every device of every member
  -- -------------------------------------------------------------------------
  v_group := public.create_group('Crypto club', array[bob, carol], null, null);
  v_json := public.e2ee_recipients(v_group);
  perform tests.assert(jsonb_array_length(v_json->'members') = 3 and jsonb_array_length(v_json->'devices') = 3, 'group recipients cover all members and devices');
  v_json := public.send_encrypted_message(v_group, 'text', tests.envelope_for(v_group, alice, a1), '[]'::jsonb, null, 'e2ee-client-6');
  perform tests.assert((v_json->>'encrypted')::boolean, 'group message sealed for everyone');
  perform tests.as_user(bob);
  perform tests.assert((select count(*) from public.get_messages(v_group) j where (j->>'encrypted')::boolean) = 1, 'group member can fetch the sealed message');

  -- Delete for everyone destroys the ciphertext
  perform tests.as_user(alice);
  perform public.delete_message((v_json->>'id')::uuid, true);
  perform tests.assert((select envelope is null and deleted_at is not null from public.messages where id = (v_json->>'id')::uuid), 'delete for everyone clears the envelope');

  -- Blocked users cannot look up each other's keys
  perform tests.as_user(dave);
  perform public.register_e2ee_device(d1, 'android', tests.b64(32), tests.b64(32), null);
  perform public.block_user(alice);
  perform tests.as_user(alice);
  perform tests.assert(public.e2ee_user_devices(dave) = '[]'::jsonb, 'blocked pair sees no devices');

  -- Device limit
  perform tests.as_user(carol);
  for i in 2..10 loop
    perform public.register_e2ee_device(format('carol-device-%s-cccc', lpad(i::text, 4, '0')), 'web', tests.b64(32), tests.b64(32), null);
  end loop;
  perform tests.assert_raises(format($$select public.register_e2ee_device('carol-device-0011-cccc', 'web', '%s', '%s')$$, tests.b64(32), tests.b64(32)), 'at most 10 active devices', 'DEVICE_LIMIT');

  -- -------------------------------------------------------------------------
  -- Story replies are sealed too
  -- -------------------------------------------------------------------------
  perform tests.as_user(bob);
  v_story := public.create_story('text', null, null, 'Story time', '{}'::jsonb, '[]'::jsonb, null, null, 'everyone');
  perform tests.as_user(alice);
  perform tests.assert_raises(format($$select public.send_story_reply('%s', '%s')$$, v_story->>'id', '{"v":1}'), 'story reply needs a valid envelope', 'ENVELOPE_INVALID');
  v_json := public.send_story_reply((v_story->>'id')::uuid, tests.envelope(alice, a1, array[alice, bob]), 'e2ee-client-7');
  perform tests.assert((v_json->>'kind') = 'story_reply' and (v_json->>'encrypted')::boolean and (v_json->>'conversation_id') = v_dm::text, 'story reply lands sealed in the existing DM');

  -- -------------------------------------------------------------------------
  -- Push webhook payloads never include ciphertext (helper is internal: run as the database role)
  -- -------------------------------------------------------------------------
  perform tests.assert(not has_function_privilege('authenticated', 'public.webhook_record(jsonb)', 'execute'), 'webhook record helper is internal');
  perform tests.as_admin_db();
  v_json := public.webhook_record('{"id":"x","text":null,"envelope":{"v":1,"ct":"secret"}}'::jsonb);
  perform tests.assert(not (v_json ? 'envelope') and (v_json->>'encrypted')::boolean, 'webhook record strips the envelope and flags encryption');
  perform tests.assert(not (public.webhook_record('{"id":"x","envelope":null}'::jsonb)->>'encrypted')::boolean, 'plaintext rows are flagged as not encrypted');
  perform tests.assert(not (public.webhook_record('{"id":"x"}'::jsonb) ? 'encrypted'), 'rows without an envelope column pass through unchanged');

  raise notice 'e2ee tests passed';
end $t$;
