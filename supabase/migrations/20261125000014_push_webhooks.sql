-- ============================================================================
-- Friendzy — Phase 14: push-notification webhooks (database → push-dispatch)
--
-- Replaces dashboard-created "Database Webhooks": an AFTER INSERT trigger on
-- public.notifications and public.messages posts the new row to the push-dispatch
-- Edge Function through pg_net. The x-webhook-secret header value is read from
-- Supabase Vault (secret name: push_webhook_secret) at call time — it is never
-- stored in a trigger definition and never appears in this repository.
--
-- One-time setup on the live project (SQL editor, done 2026-11-25):
--   create extension if not exists pg_net with schema extensions;
--   select vault.create_secret('<same value as the PUSH_WEBHOOK_SECRET function secret>', 'push_webhook_secret');
-- Without pg_net or the Vault secret (e.g. the local test database) the trigger is
-- a no-op, so inserting notifications and messages can never fail because of push.
-- ============================================================================
create or replace function public.push_dispatch_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_secret text;
  v_url text := 'https://gwdpsrjmfrgcloacvdlg.supabase.co/functions/v1/push-dispatch';
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null or to_regclass('vault.decrypted_secrets') is null then
    return new;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_webhook_secret' order by created_at desc limit 1;
  if v_secret is null then return new; end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('type', tg_op, 'table', tg_table_name, 'schema', tg_table_schema, 'record', to_jsonb(new), 'old_record', null),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    timeout_milliseconds := 5000);
  return new;
exception when others then
  raise warning 'push_dispatch_webhook: %', sqlerrm;
  return new;
end $$;
revoke all on function public.push_dispatch_webhook() from public, anon, authenticated;

drop trigger if exists push_dispatch_on_notification on public.notifications;
create trigger push_dispatch_on_notification after insert on public.notifications for each row execute function public.push_dispatch_webhook();
drop trigger if exists push_dispatch_on_message on public.messages;
create trigger push_dispatch_on_message after insert on public.messages for each row execute function public.push_dispatch_webhook();
