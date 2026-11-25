// Friendzy — RevenueCat webhook → Premium entitlement + coin purchases
//
// Configure in RevenueCat (Project → Integrations → Webhooks):
//   URL:                  https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook
//   Authorization header: the exact value of REVENUECAT_WEBHOOK_AUTH (any long random string)
// Deploy with `supabase functions deploy revenuecat-webhook --no-verify-jwt`
// (RevenueCat does not send a Supabase JWT; this function authenticates with the header).
//
// The app logs users in to RevenueCat with their Supabase user id, so
// `app_user_id` is the profile id. Events are idempotent by RevenueCat event id.

import { createClient } from 'npm:@supabase/supabase-js@2';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RcEvent {
  id: string;
  type: string;
  app_user_id: string;
  original_app_user_id?: string;
  aliases?: string[];
  product_id?: string;
  entitlement_ids?: string[] | null;
  period_type?: string;
  purchased_at_ms?: number;
  expiration_at_ms?: number | null;
  grace_period_expiration_at_ms?: number | null;
  store?: string;
  environment?: string;
  transaction_id?: string;
  original_transaction_id?: string;
  price?: number | null;
  price_in_purchased_currency?: number | null;
  currency?: string | null;
  cancel_reason?: string;
  is_trial_conversion?: boolean;
  transferred_from?: string[];
  transferred_to?: string[];
}

function resolveUser(event: RcEvent): string | null {
  const candidates = [event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])].filter(Boolean) as string[];
  return candidates.find((c) => UUID.test(c))?.toLowerCase() ?? null;
}

function mapStore(store: string | undefined): string {
  switch ((store ?? '').toUpperCase()) {
    case 'APP_STORE': return 'app_store';
    case 'MAC_APP_STORE': return 'mac_app_store';
    case 'PLAY_STORE': return 'play_store';
    case 'AMAZON': return 'amazon';
    case 'STRIPE':
    case 'RC_BILLING': return 'stripe';
    case 'PADDLE': return 'paddle';
    case 'PROMOTIONAL': return 'promotional';
    case 'TEST_STORE': return 'test_store';
    default: return 'unknown';
  }
}

function iso(ms: number | null | undefined): string | null {
  return typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString() : null;
}

function mapStatus(event: RcEvent): { status: string; willRenew: boolean } {
  const future = typeof event.expiration_at_ms === 'number' ? event.expiration_at_ms > Date.now() : true;
  const trial = (event.period_type ?? '').toUpperCase() === 'TRIAL';
  switch (event.type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION':
    case 'PRODUCT_CHANGE':
    case 'SUBSCRIPTION_EXTENDED':
    case 'TEMPORARY_ENTITLEMENT_GRANT':
      return { status: trial ? 'trialing' : 'active', willRenew: true };
    case 'CANCELLATION':
      return { status: future ? 'active' : 'expired', willRenew: false };
    case 'EXPIRATION':
      return { status: 'expired', willRenew: false };
    case 'BILLING_ISSUE':
      return { status: 'billing_issue', willRenew: true };
    case 'SUBSCRIPTION_PAUSED':
      return { status: 'paused', willRenew: false };
    default:
      return { status: future ? 'active' : 'expired', willRenew: future };
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const expected = Deno.env.get('REVENUECAT_WEBHOOK_AUTH');
  if (!expected) return json({ error: 'REVENUECAT_WEBHOOK_AUTH is not configured' }, 500);
  const header = req.headers.get('Authorization') ?? '';
  if (header !== expected && header !== `Bearer ${expected}`) return json({ error: 'Unauthorized' }, 401);

  let payload: { event?: RcEvent; api_version?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const event = payload.event;
  if (!event || !event.id || !event.type) return json({ error: 'Missing event' }, 400);
  if (event.type === 'TEST') return json({ ok: true, test: true });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const eventId = `rc:${event.id}`;
  const environment = (event.environment ?? 'PRODUCTION').toUpperCase() === 'SANDBOX' ? 'sandbox' : 'production';
  const store = mapStore(event.store);
  const userId = resolveUser(event);

  if (!userId) {
    await admin.from('subscription_events').insert({ user_id: null, provider: 'revenuecat', event_id: eventId, event_type: event.type, product_id: event.product_id ?? null, store, environment, payload: event }).select().maybeSingle();
    return json({ ok: true, ignored: true, reason: 'app_user_id is not a Friendzy user id' });
  }

  if (event.type === 'TRANSFER') {
    // Entitlement moved between RevenueCat app user ids. We only record it; the
    // next purchase/renewal event for the receiving user syncs their status.
    await admin.from('subscription_events').insert({ user_id: userId, provider: 'revenuecat', event_id: eventId, event_type: event.type, store, environment, payload: event }).select().maybeSingle();
    for (const from of event.transferred_from ?? []) {
      if (UUID.test(from)) {
        await admin.rpc('sync_subscription', { p_user: from.toLowerCase(), p_event_id: `${eventId}:from:${from}`, p_event_type: 'TRANSFER_OUT', p_status: 'expired', p_store: store, p_environment: environment, p_expires_at: new Date().toISOString(), p_will_renew: false, p_payload: event });
      }
    }
    return json({ ok: true, transfer: true });
  }

  // Consumable coin packs vs. the Premium subscription
  const sku = event.product_id ?? '';
  const { data: coinPackage } = sku ? await admin.from('coin_packages').select('sku').eq('sku', sku).maybeSingle() : { data: null };
  if (coinPackage) {
    const transactionId = event.transaction_id ?? event.original_transaction_id ?? event.id;
    if (['NON_RENEWING_PURCHASE', 'INITIAL_PURCHASE', 'RENEWAL'].includes(event.type)) {
      const price = event.price_in_purchased_currency ?? event.price ?? null;
      const { data, error } = await admin.rpc('record_coin_purchase', {
        p_user: userId, p_sku: sku, p_transaction_id: transactionId, p_store: store,
        p_price_cents: typeof price === 'number' ? Math.round(price * 100) : null, p_currency: event.currency ?? null,
        p_environment: environment, p_payload: event, p_provider: 'revenuecat',
      });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, coins: data });
    }
    if (event.type === 'CANCELLATION' || event.type === 'REFUND') {
      const { data, error } = await admin.rpc('refund_coin_purchase', { p_transaction_id: transactionId, p_payload: event });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, refund: data });
    }
    return json({ ok: true, ignored: true, reason: `coin event ${event.type} needs no action` });
  }

  const { status, willRenew } = mapStatus(event);
  const { data, error } = await admin.rpc('sync_subscription', {
    p_user: userId,
    p_event_id: eventId,
    p_event_type: event.type,
    p_status: status,
    p_product_id: event.product_id ?? null,
    p_store: store,
    p_environment: environment,
    p_period_type: (event.period_type ?? '').toLowerCase() || null,
    p_purchased_at: iso(event.purchased_at_ms),
    p_expires_at: iso(event.expiration_at_ms),
    p_will_renew: willRenew,
    p_unsubscribe_detected_at: event.type === 'CANCELLATION' ? new Date().toISOString() : null,
    p_billing_issue_detected_at: event.type === 'BILLING_ISSUE' ? new Date().toISOString() : null,
    p_grace_period_expires_at: iso(event.grace_period_expiration_at_ms),
    p_original_app_user_id: event.original_app_user_id ?? null,
    p_management_url: null,
    p_payload: event,
    p_provider: 'revenuecat',
  });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, result: data });
});
