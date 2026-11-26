-- Tests for 20261125000019_wallpapers_archive.sql
do $t$
declare
  alice uuid; bob uuid; v_dm uuid; v_summary jsonb; v_msg public.messages; v_count integer;
begin
  alice := tests.create_user('alice@archive.test', '{"display_name":"Alice","username":"archivealice","birth_date":"1995-02-02"}');
  bob   := tests.create_user('bob@archive.test',   '{"display_name":"Bob","username":"archivebob","birth_date":"1994-02-02"}');

  -- Settings carry the new switches with the defaults people expect.
  perform tests.as_user(alice);
  perform tests.assert((select keep_chats_archived from public.user_settings where user_id = alice) is true, 'chats stay archived by default');
  perform tests.assert((select chat_wallpaper from public.user_settings where user_id = alice) is null, 'no default wallpaper to start with');

  v_dm := public.start_direct_conversation(bob);
  perform tests.as_user(bob);
  perform public.start_direct_conversation(alice);

  -- Alice archives the chat, Bob writes: it stays archived (the default).
  perform tests.as_user(alice);
  perform public.set_conversation_settings(v_dm, null, false, true, null, null, null, false, null);
  perform tests.assert((select is_archived from public.conversation_members where conversation_id = v_dm and user_id = alice), 'the chat is archived');

  perform tests.as_admin_db();
  insert into public.messages (conversation_id, sender_id, kind, text) values (v_dm, bob, 'text', 'first ping') returning * into v_msg;
  perform public.touch_conversation(v_dm, v_msg);
  perform tests.assert((select is_archived from public.conversation_members where conversation_id = v_dm and user_id = alice), 'a new message leaves an archived chat archived');

  -- It does not show up in the inbox, and the archived row counts it.
  perform tests.as_user(alice);
  perform tests.assert((select count(*) from public.get_conversations('inbox', 30, null)) = 0, 'archived chats stay out of the inbox');
  perform tests.assert((select count(*) from public.get_conversations('archived', 30, null)) = 1, 'archived chats are in the archive');
  v_summary := public.get_archived_summary();
  perform tests.assert((v_summary->>'chats')::int = 1, 'the archived row counts the chat');
  perform tests.assert((v_summary->>'unread_messages')::int = 1, 'the archived row counts unread messages');
  perform tests.assert((v_summary->>'unread_chats')::int = 1, 'the archived row counts unread chats');
  perform tests.assert((v_summary->>'keep_archived')::boolean, 'the archived row reports the setting');
  perform tests.assert(v_summary->'names'->>0 = 'Bob', 'the archived row names the chat');
  perform tests.assert(public.get_unread_total() = 0, 'archived chats stay out of the inbox badge');

  -- Turning the switch off restores the old behaviour: the next message pulls it back.
  update public.user_settings set keep_chats_archived = false where user_id = alice;
  perform tests.as_admin_db();
  insert into public.messages (conversation_id, sender_id, kind, text) values (v_dm, bob, 'text', 'second ping') returning * into v_msg;
  perform public.touch_conversation(v_dm, v_msg);
  perform tests.assert(not (select is_archived from public.conversation_members where conversation_id = v_dm and user_id = alice), 'with the switch off a new message unarchives the chat');

  -- Writing in a chat always brings it back for the writer.
  perform tests.as_user(alice);
  update public.user_settings set keep_chats_archived = true where user_id = alice;
  perform public.set_conversation_settings(v_dm, null, false, true, null, null, null, false, null);
  perform tests.as_admin_db();
  insert into public.messages (conversation_id, sender_id, kind, text) values (v_dm, alice, 'text', 'my own reply') returning * into v_msg;
  perform public.touch_conversation(v_dm, v_msg);
  perform tests.assert(not (select is_archived from public.conversation_members where conversation_id = v_dm and user_id = alice), 'replying unarchives your own copy');

  -- Empty the archive in one go.
  perform tests.as_user(alice);
  perform public.set_conversation_settings(v_dm, null, false, true, null, null, null, false, null);
  v_count := public.unarchive_all_chats();
  perform tests.assert(v_count = 1, 'unarchive all reports how many it moved');
  perform tests.assert((select count(*) from public.get_conversations('archived', 30, null)) = 0, 'the archive is empty afterwards');

  -- Wallpapers: a photo reference is stored per chat, and a default per account.
  perform public.set_conversation_settings(v_dm, null, false, null, null, null, 'img:' || alice::text || '/wall-1.jpg', true, null);
  perform tests.assert((select wallpaper from public.conversation_members where conversation_id = v_dm and user_id = alice) = 'img:' || alice::text || '/wall-1.jpg', 'a photo wallpaper is stored for this chat');
  perform tests.assert_raises(format($$select public.set_conversation_settings('%s', null, false, null, null, null, '%s', true, null)$$, v_dm, repeat('x', 220)), 'a wallpaper reference cannot be unbounded', 'check constraint');

  update public.user_settings set chat_wallpaper = 'violet' where user_id = alice;
  perform tests.assert((select chat_wallpaper from public.user_settings where user_id = alice) = 'violet', 'an account-wide default wallpaper is stored');

  -- Bob sees none of Alice's choices.
  perform tests.as_user(bob);
  perform tests.assert((select wallpaper from public.conversation_members where conversation_id = v_dm and user_id = bob) is null, 'a wallpaper is personal, not shared with the other person');

  -- The private bucket exists and is not public.
  perform tests.assert(exists (select 1 from storage.buckets where id = 'wallpapers' and not public), 'wallpapers live in a private bucket');
end $t$;
