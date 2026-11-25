-- Tests for 20261125000014_push_webhooks.sql
do $t$
declare
  alice uuid; bob uuid; v_id uuid;
begin
  alice := tests.create_user('alice@push.test', '{"display_name":"Alice","username":"alice","birth_date":"1995-01-01"}');
  bob   := tests.create_user('bob@push.test',   '{"display_name":"Bob","username":"bob","birth_date":"1994-01-01"}');

  perform tests.assert(to_regprocedure('public.push_dispatch_webhook()') is not null, 'webhook trigger function exists');
  perform tests.assert((select count(*) from pg_trigger where tgname in ('push_dispatch_on_notification', 'push_dispatch_on_message') and not tgisinternal) = 2, 'both insert triggers installed');
  perform tests.assert(not has_function_privilege('authenticated', 'public.push_dispatch_webhook()', 'execute'), 'clients cannot call the webhook function');

  -- Without pg_net / Vault (this test database) the trigger must be a silent no-op: inserts still succeed.
  perform tests.as_admin_db();
  v_id := public.create_notification(bob, alice, 'new_follower');
  perform tests.assert(v_id is not null and exists (select 1 from public.notifications where id = v_id), 'notification insert unaffected by the push trigger');

  raise notice 'push webhook tests passed';
end $t$;
