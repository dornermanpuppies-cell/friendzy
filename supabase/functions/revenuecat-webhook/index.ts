// Friendzy — RevenueCat webhook → Premium entitlement + coin purchases
//
// Configure in RevenueCat (Project → Integrations → Webhooks):
//   URL:                  https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook
//   Authorization header: the exact value of REVENUECAT_WEBHOOK_AUTH (any long random string)
// Deploy with `supabase functions deploy revenuecat-webhook --no-verify-jwt`
// (RevenueCat does not send a Supabase JWT; this function authenticates with the header).
//
// Secrets (never leave this function):
//   REVENUECAT_WEBHOOK_AUTH      required — shared secret checked on every request
//   REVENUECAT_SECRET_API_KEY    optional — lets the function re-read the subscriber from the
//                                RevenueCat REST API after each event (entitlement source of truth)
//   REVENUECAT_IGNORE_SANDBOX    optional — "true" stores sandbox events without granting anything
//
// The app logs users in to RevenueCat with their Supabase user id, so `app_user_id`
// is the profile id. Entitlements and coins are written only through SECURITY DEFINER
// RPCs restricted to the service role (sync_subscription, record_coin_purchase,
// refund_coin_purchase); every RevenueCat event id is stored once, so retries are no-ops.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { handleRevenueCatWebhook, type RcSubscriber, type RevenueCatDeps } from '../_shared/revenuecat/handler.ts';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const ENTITLEMENT_ID = Deno.env.get('REVENUECAT_ENTITLEMENT_ID') || 'friendzy_premium';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const secretApiKey = Deno.env.get('REVENUECAT_SECRET_API_KEY') || Deno.env.get('REVENUECAT_API_KEY') || '';

async function fetchSubscriber(appUserId: string): Promise<RcSubscriber | null> {
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
    headers: { Authorization: `Bearer ${secretApiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    console.warn(`[revenuecat-webhook] RevenueCat API answered HTTP ${res.status} for the subscriber read`);
    return null;
  }
  return (await res.json()) as RcSubscriber;
}

const coinSkuCache = new Map<string, boolean>();

const deps: RevenueCatDeps = {
  expectedAuth: Deno.env.get('REVENUECAT_WEBHOOK_AUTH'),
  entitlementId: ENTITLEMENT_ID,
  ignoreSandbox: (Deno.env.get('REVENUECAT_IGNORE_SANDBOX') ?? '').toLowerCase() === 'true',
  fetchSubscriber: secretApiKey ? fetchSubscriber : null,
  logger: console,
  async isCoinSku(sku) {
    const cached = coinSkuCache.get(sku);
    if (cached !== undefined) return cached;
    const { data, error } = await admin.from('coin_packages').select('sku').eq('sku', sku).maybeSingle();
    if (error) throw new Error(error.message);
    const isCoin = Boolean(data);
    coinSkuCache.set(sku, isCoin);
    return isCoin;
  },
  async syncSubscription({ userId, eventId, eventType, snapshot, originalAppUserId, payload }) {
    const { data, error } = await admin.rpc('sync_subscription', {
      p_user: userId,
      p_event_id: eventId,
      p_event_type: eventType,
      p_status: snapshot.status,
      p_product_id: snapshot.productId,
      p_store: snapshot.store,
      p_environment: snapshot.environment,
      p_period_type: snapshot.periodType,
      p_purchased_at: snapshot.purchasedAt,
      p_expires_at: snapshot.expiresAt,
      p_will_renew: snapshot.willRenew,
      p_unsubscribe_detected_at: snapshot.unsubscribeDetectedAt,
      p_billing_issue_detected_at: snapshot.billingIssueDetectedAt,
      p_grace_period_expires_at: snapshot.gracePeriodExpiresAt,
      p_original_app_user_id: originalAppUserId,
      p_management_url: snapshot.managementUrl,
      p_payload: { ...payload, _snapshot_source: snapshot.source },
      p_provider: 'revenuecat',
    });
    if (error) throw new Error(error.message);
    return (data ?? {}) as Record<string, unknown>;
  },
  async recordCoinPurchase({ userId, sku, transactionId, store, priceCents, currency, environment, payload }) {
    const { data, error } = await admin.rpc('record_coin_purchase', {
      p_user: userId,
      p_sku: sku,
      p_transaction_id: transactionId,
      p_store: store,
      p_price_cents: priceCents,
      p_currency: currency,
      p_environment: environment,
      p_payload: payload,
      p_provider: 'revenuecat',
    });
    if (error) throw new Error(error.message);
    return (data ?? {}) as Record<string, unknown>;
  },
  async refundCoinPurchase({ transactionId, payload }) {
    const { data, error } = await admin.rpc('refund_coin_purchase', { p_transaction_id: transactionId, p_payload: payload });
    if (error) throw new Error(error.message);
    return (data ?? {}) as Record<string, unknown>;
  },
  async recordEvent({ userId, eventId, eventType, productId, store, environment, payload }) {
    const { error } = await admin
      .from('subscription_events')
      .upsert({ user_id: userId, provider: 'revenuecat', event_id: eventId, event_type: eventType, product_id: productId, store, environment, payload }, { onConflict: 'event_id', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  },
};

Deno.serve(async (req) => {
  const result = await handleRevenueCatWebhook(req, deps);
  return new Response(JSON.stringify(result.body), { status: result.status, headers: JSON_HEADERS });
});
