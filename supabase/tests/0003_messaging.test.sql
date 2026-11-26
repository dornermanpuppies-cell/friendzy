-- Tests for 20261125000003_messaging.sql
do $t$
declare
  alice uuid; bob uuid; carol uuid; dave uuid;
  v_dm uuid; v_dm2 uuid; v_group uuid; v_msg jsonb; v_msg2 jsonb; v_json jsonb; v_code text; v_req uuid; v_n int;
begin
  alice := tests.create_user('alice@chat.test', '{"display_name":"Alice","username":"alice","birth_date":"1998-01-01"}');
  bob   := tests.create_user('bob@chat.test',   '{"display_name":"Bob","username":"bob","birth_date":"1997-01-01"}');
  carol := tests.create_user('carol@chat.test', '{"display_name":"Carol","username":"carol","birth_date":"1996-01-01"}');
  dave  := tests.create_user('dave@chat.test',  '{"display_name":"Dave","username":"dave","birth_date":"1990-01-01"}');

  -- -------------------------------------------------------------------------
  -- Direct conversations & message requests
  -- -------------------------------------------------------------------------
  perform tests.as_user(alice);
  v_dm := public.start_direct_conversation(bob);
  perform tests.assert(v_dm is not null, 'direct conversation created');
  perform tests.assert(public.start_direct_conversation(bob) = v_dm, 'same pair returns the same conversation');
  perform tests.assert_raises($$select public.start_direct_conversation(auth.uid())$$, 'cannot message self', 'CANNOT_MESSAGE_SELF');
  perform tests.assert_raises($$insert into public.conversations (kind) values ('direct')$$, 'conversations not directly insertable', 'permission denied');

  v_msg := tests.send_plain(v_dm, 'text', 'Hey Bob! 👋', '{}'::jsonb, '[]'::jsonb, null, 'client-1');
  perform tests.assert((v_msg->>'status') = 'sent' and (v_msg->>'is_mine')::boolean, 'message sent with sent status');
  perform tests.assert((tests.send_plain(v_dm, 'text', 'Hey Bob! 👋', '{}'::jsonb, '[]'::jsonb, null, 'client-1')->>'id') = (v_msg->>'id'), 'client_id makes sends idempotent');
  perform tests.assert_raises($$select tests.send_plain((select id from public.conversations limit 1), 'text', '   ')$$, 'empty text rejected', 'TEXT_REQUIRED');
  perform tests.assert_raises(format($$select tests.send_plain('%s', 'image', null, '{}'::jsonb, '[{"path":"%s/%s/x.jpg","kind":"image"}]'::jsonb)$$, v_dm, v_dm, bob), 'attachment path must be under sender folder', 'ATTACHMENT_NOT_OWNED');
  v_msg2 := tests.send_plain(v_dm, 'image', 'look', '{}'::jsonb, format('[{"path":"%s/%s/x.jpg","kind":"image","width":10,"height":10}]', v_dm, alice)::jsonb);
  perform tests.assert(jsonb_array_length(v_msg2->'attachments') = 1, 'attachment stored');

  perform tests.as_user(bob);
  v_json := (select j from public.get_conversations('inbox') j limit 1);
  perform tests.assert((v_json->>'unread_count')::int = 2 and (v_json->>'title') = 'Alice', 'recipient sees unread count and other user as title');
  perform tests.assert((v_json->'last_message'->>'preview') = '📷 Photo', 'last message preview');
  perform tests.assert((select count(*) from public.get_messages(v_dm)) = 2, 'recipient can read messages');
  perform public.mark_delivered(array[v_dm]);
  perform tests.as_user(alice);
  perform tests.assert(((select j from public.get_messages(v_dm) j order by j->>'created_at' desc limit 1)->>'status') = 'delivered', 'status becomes delivered');
  perform tests.as_user(bob);
  perform public.mark_conversation_read(v_dm);
  perform tests.as_user(alice);
  perform tests.assert(((select j from public.get_messages(v_dm) j order by j->>'created_at' desc limit 1)->>'status') = 'read', 'status becomes read');
  perform tests.assert(jsonb_array_length(public.get_message_info((v_msg->>'id')::uuid)) = 1 and (public.get_message_info((v_msg->>'id')::uuid)->0->>'read_at') is not null, 'message info shows read time');

  -- who_can_message = friends → request
  perform tests.as_user(carol);
  update public.user_settings set who_can_message = 'friends' where user_id = carol;
  perform tests.as_user(alice);
  v_dm2 := public.start_direct_conversation(carol);
  v_json := tests.send_plain(v_dm2, 'text', 'Hi Carol, we met at the meetup');
  perform tests.as_user(carol);
  perform tests.assert((select count(*) from public.get_conversations('inbox')) = 0, 'request not in inbox');
  perform tests.assert((select count(*) from public.get_conversations('requests')) = 1, 'request listed in requests');
  perform tests.assert_raises(format($$select tests.send_plain('%s', 'text', 'reply')$$, v_dm2), 'cannot reply before accepting', 'REQUEST_PENDING');
  perform public.respond_message_request(v_dm2, true);
  perform tests.assert((select count(*) from public.get_conversations('inbox')) = 1, 'accepted request moves to inbox');
  perform tests.send_plain(v_dm2, 'text', 'Nice to meet you!');
  update public.user_settings set who_can_message = 'nobody' where user_id = carol;
  perform tests.as_user(dave);
  perform tests.assert_raises(format($$select public.start_direct_conversation('%s')$$, carol), 'messages closed respected', 'MESSAGES_CLOSED');

  -- Blocks stop messaging
  perform tests.as_user(bob);
  perform public.block_user(alice);
  perform tests.as_user(alice);
  perform tests.assert_raises(format($$select tests.send_plain('%s', 'text', 'still there?')$$, v_dm), 'blocked users cannot message', 'BLOCKED');
  perform tests.assert((select count(*) from public.get_conversations('inbox') j where (j->>'id')::uuid = v_dm) = 0, 'blocked conversation hidden from inbox');
  perform tests.as_user(bob);
  perform public.unblock_user(alice);

  -- -------------------------------------------------------------------------
  -- Message actions: reply, edit, delete, react, star, pin, forward, search
  -- -------------------------------------------------------------------------
  perform tests.as_user(alice);
  v_json := tests.send_plain(v_dm, 'text', 'Replying to you', '{}'::jsonb, '[]'::jsonb, (v_msg->>'id')::uuid);
  perform tests.assert((v_json->'reply_to'->>'id') = (v_msg->>'id') and (v_json->'reply_to'->>'preview') = 'Hey Bob! 👋', 'reply carries preview');
  v_json := tests.edit_plain((v_json->>'id')::uuid, 'Replying to you (edited)');
  perform tests.assert((v_json->>'edited_at') is not null and (v_json->>'text') like '%(edited)', 'message edited');
  perform tests.as_user(bob);
  perform tests.assert_raises(format($$select tests.edit_plain('%s', 'hack')$$, v_json->>'id'), 'cannot edit others'' messages', 'MESSAGE_NOT_FOUND');
  perform public.react_message((v_msg->>'id')::uuid, '❤️');
  perform public.star_message((v_msg->>'id')::uuid, true);
  perform tests.assert(((public.get_message((v_msg->>'id')::uuid))->'reactions'->0->>'count')::int = 1, 'reaction counted');
  perform tests.assert((select count(*) from public.get_starred_messages()) = 1, 'starred message listed');
  perform public.pin_message((v_msg->>'id')::uuid, true);
  perform tests.assert(jsonb_array_length(public.get_conversation(v_dm)->'pins') = 1, 'message pinned');
  perform tests.assert((select count(*) from public.search_messages('Replying')) = 1, 'message search works');

  -- delete for me vs everyone
  perform public.delete_message((v_msg2->>'id')::uuid, false);
  perform tests.assert((select count(*) from public.get_messages(v_dm) j where (j->>'id') = (v_msg2->>'id')) = 0, 'delete for me hides message for me');
  perform tests.as_user(alice);
  perform tests.assert((select count(*) from public.get_messages(v_dm) j where (j->>'id') = (v_msg2->>'id')) = 1, 'delete for me keeps message for others');
  perform tests.as_user(bob);
  v_json := tests.send_plain(v_dm, 'text', 'bob says hi');
  perform tests.as_user(alice);
  perform tests.assert_raises(format($$select public.delete_message('%s', true)$$, v_json->>'id'), 'cannot delete others'' messages for everyone in DM', 'FORBIDDEN');
  perform public.delete_message((v_msg->>'id')::uuid, true);
  perform tests.as_user(bob);
  perform tests.assert(((public.get_message((v_msg->>'id')::uuid))->>'deleted')::boolean = true and (public.get_message((v_msg->>'id')::uuid))->>'text' is null, 'delete for everyone tombstones message');
  perform tests.assert(jsonb_array_length(public.get_conversation(v_dm)->'pins') = 0, 'deleting unpins');

  -- clear chat
  perform public.clear_conversation(v_dm);
  perform tests.assert((select count(*) from public.get_messages(v_dm)) = 0, 'clear chat hides history for me');
  perform tests.as_user(alice);
  perform tests.assert((select count(*) from public.get_messages(v_dm)) >= 2, 'clear chat does not affect others');

  -- settings: mute / archive / pin / mark unread
  v_json := public.set_conversation_settings(v_dm, now() + interval '8 hours', true, true, true, true, 'violet', true, null);
  perform tests.assert((v_json->>'is_muted')::boolean and (v_json->>'is_archived')::boolean and (v_json->>'is_pinned')::boolean and (v_json->>'marked_unread')::boolean and (v_json->>'wallpaper') = 'violet', 'per-member settings applied');
  perform tests.assert((select count(*) from public.get_conversations('archived')) = 1, 'archived filter');
  perform tests.assert((select count(*) from public.get_conversations('inbox') j where (j->>'id')::uuid = v_dm) = 0, 'archived hidden from inbox');
  perform tests.as_user(bob);
  perform tests.send_plain(v_dm, 'text', 'unarchive me');
  perform tests.as_user(alice);
  perform tests.assert((select count(*) from public.get_conversations('inbox') j where (j->>'id')::uuid = v_dm) = 1, 'new message un-archives');

  -- disappearing messages
  perform public.set_disappearing(v_dm, 86400);
  v_json := tests.send_plain(v_dm, 'text', 'this will vanish');
  perform tests.assert((v_json->>'expires_at') is not null, 'disappearing message gets expiry');
  perform tests.as_admin_db();
  update public.messages set expires_at = now() - interval '1 second' where id = (v_json->>'id')::uuid;
  perform tests.as_user(bob);
  perform tests.assert((select count(*) from public.get_messages(v_dm) j where (j->>'id') = (v_json->>'id')) = 0, 'expired messages are hidden');
  perform tests.as_admin_db();
  perform tests.assert(public.expire_messages() >= 1, 'expire_messages purges');

  -- -------------------------------------------------------------------------
  -- Groups
  -- -------------------------------------------------------------------------
  perform tests.as_user(alice);
  v_group := public.create_group('Weekend crew', array[bob, carol], 'Plans & memes');
  perform tests.assert((public.get_conversation(v_group)->>'members_count')::int = 3, 'group created with members');
  perform tests.assert((public.get_conversation(v_group)->>'is_admin')::boolean, 'creator is admin');
  perform tests.assert_raises($$select public.create_group('   ')$$, 'group needs a title', 'TITLE_REQUIRED');
  perform tests.as_user(bob);
  perform tests.assert_raises(format($$select public.add_members('%s', array['%s'::uuid])$$, v_group, dave), 'members cannot add members', 'FORBIDDEN');
  perform tests.assert((select count(*) from public.get_conversations('groups')) = 1, 'groups filter');
  perform tests.as_user(alice);
  perform public.set_member_role(v_group, bob, 'admin');
  perform tests.as_user(bob);
  perform tests.assert(public.add_members(v_group, array[dave]) = 1, 'admin can add members');
  perform tests.assert((public.get_conversation(v_group)->>'members_count')::int = 4, 'members counter updated');
  perform tests.send_plain(v_group, 'text', 'Welcome Dave!');
  perform tests.as_user(dave);
  perform tests.assert((select count(*) from public.get_messages(v_group) j where (j->>'kind') = 'text') = 1, 'new member sees group messages');
  perform tests.as_user(alice);
  perform public.remove_member(v_group, dave);
  perform tests.as_user(dave);
  perform tests.assert_raises(format($$select tests.send_plain('%s', 'text', 'am I still here?')$$, v_group), 'removed member cannot send', 'CONVERSATION_NOT_FOUND');
  perform tests.assert((select count(*) from public.messages where conversation_id = v_group) = 0, 'removed member cannot read group (RLS)');

  -- invite links + join approval
  perform tests.as_user(alice);
  v_code := public.get_invite_link(v_group);
  perform tests.assert(v_code is not null and char_length(v_code) = 12, 'invite code exists');
  perform tests.as_user(dave);
  v_json := public.join_via_invite(v_code);
  perform tests.assert((v_json->>'status') = 'joined', 'open group joins immediately');
  perform public.leave_conversation(v_group);
  perform tests.as_user(alice);
  perform public.update_group(v_group, null, null, null, true);
  v_code := public.rotate_invite_link(v_group);
  perform tests.as_user(dave);
  perform tests.assert_raises($$select public.join_via_invite('invalidcode1')$$, 'invalid invite rejected', 'INVITE_INVALID');
  v_json := public.join_via_invite(v_code);
  perform tests.assert((v_json->>'status') = 'requested', 'approval-required group creates join request');
  perform tests.as_user(alice);
  v_json := public.get_join_requests(v_group);
  perform tests.assert(jsonb_array_length(v_json) = 1, 'admin sees join request');
  perform public.respond_join_request((v_json->0->>'id')::uuid, true);
  perform tests.as_user(dave);
  perform tests.assert(public.is_conversation_member(v_group), 'approved request joins the group');

  -- owner leaves → ownership transfers to an admin
  perform tests.as_user(alice);
  perform public.leave_conversation(v_group);
  perform tests.as_admin_db();
  perform tests.assert((select role from public.conversation_members where conversation_id = v_group and user_id = bob) = 'owner', 'ownership transferred to admin');

  -- forward + unread total + story reply
  perform tests.as_user(bob);
  v_msg := tests.send_plain(v_group, 'text', 'forward me');
  perform tests.assert(tests.forward_plain(array[(v_msg->>'id')::uuid], array[v_dm]) = 1, 'forwarded one message');
  perform tests.assert(((select j from public.get_messages(v_dm) j order by j->>'created_at' desc limit 1)->>'forwarded')::boolean, 'forwarded flag set');
  perform tests.as_user(alice);
  perform tests.assert(public.get_unread_total() >= 1, 'unread total counts new messages');
  -- Story replies are end-to-end encrypted since 0015 and covered in 0015_e2ee.test.sql.

  -- RLS: outsiders see nothing
  perform tests.as_user(dave);
  perform tests.assert((select count(*) from public.messages where conversation_id = v_dm) = 0, 'non-member cannot read DM messages');
  perform tests.assert_raises(format($$select public.get_conversation('%s')$$, v_dm), 'non-member cannot load conversation', 'CONVERSATION_NOT_FOUND');
  perform tests.assert_raises($$insert into public.messages (conversation_id, sender_id, kind, text) values (gen_random_uuid(), auth.uid(), 'text', 'x')$$, 'messages not directly insertable', 'permission denied');

  raise notice 'messaging tests passed';
end $t$;
