/**
 * RevenueCat webhook: authentication, idempotency, event → entitlement mapping
 * (API snapshot vs. event fallback), coin packs vs. subscriptions, transfers.
 * Runs the exact handler the Edge Function uses, with fake dependencies.
 */
import {
  handleRevenueCatWebhook,
  isAuthorized,
  mapStore,
  resolveUser,
  safeEqual,
  snapshotFromApi,
  snapshotFromEvent,
  type CoinPurchaseInput,
  type EventRecordInput,
  type RcEvent,
  type RcSubscriber,
  type RevenueCatDeps,
  type SyncInput,
  type WebhookRequest,
} from '../../../supabase/functions/_shared/revenuecat/handler.ts';

const SECRET = 'whsec-friendzy-test-0123456789';
const USER = '0b4c1d5e-6f70-4a81-9b92-a3b4c5d6e7f8';
const OTHER = '1c5d2e6f-7a81-4b92-8ca3-b4c5d6e7f8a9';
const NOW = Date.parse('2026-11-25T12:00:00Z');
const DAY = 86_400_000;

function request(body: unknown, headers: Record<string, string> = { authorization: SECRET }, method = 'POST'): WebhookRequest {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { method, headers: { get: (name) => map.get(name.toLowerCase()) ?? null }, text: async () => text };
}

function event(partial: Partial<RcEvent> & { type: string }): { event: RcEvent } {
  return {
    event: {
      id: partial.id ?? `evt-${partial.type.toLowerCase()}`,
      app_user_id: USER,
      environment: 'PRODUCTION',
      store: 'APP_STORE',
      product_id: 'friendzy_premium_monthly',
      period_type: 'NORMAL',
      purchased_at_ms: NOW - DAY,
      expiration_at_ms: NOW + 29 * DAY,
      ...partial,
    },
  };
}

interface Fakes {
  deps: RevenueCatDeps;
  synced: SyncInput[];
  coins: CoinPurchaseInput[];
  refunds: string[];
  recorded: EventRecordInput[];
  seenEventIds: Set<string>;
  subscriber: RcSubscriber | null;
  apiCalls: string[];
  failApi: boolean;
}

function fakes(options: { withApi?: boolean; coinSkus?: string[]; ignoreSandbox?: boolean } = {}): Fakes {
  const f: Fakes = {
    synced: [],
    coins: [],
    refunds: [],
    recorded: [],
    seenEventIds: new Set(),
    subscriber: null,
    apiCalls: [],
    failApi: false,
    deps: {} as RevenueCatDeps,
  };
  f.deps = {
    expectedAuth: SECRET,
    entitlementId: 'friendzy_premium',
    ignoreSandbox: options.ignoreSandbox,
    now: () => NOW,
    isCoinSku: async (sku) => (options.coinSkus ?? ['friendzy_coins_550']).includes(sku),
    fetchSubscriber: options.withApi
      ? async (id) => {
          f.apiCalls.push(id);
          if (f.failApi) throw new Error('Bearer sk_live_secret should be redacted');
          return f.subscriber;
        }
      : null,
    syncSubscription: async (input) => {
      if (f.seenEventIds.has(input.eventId)) return { duplicate: true };
      f.seenEventIds.add(input.eventId);
      f.synced.push(input);
      return { duplicate: false, is_premium: ['active', 'trialing', 'grace_period', 'billing_issue'].includes(input.snapshot.status) };
    },
    recordCoinPurchase: async (input) => {
      const dup = f.coins.some((c) => c.transactionId === input.transactionId);
      if (!dup) f.coins.push(input);
      return { duplicate: dup, coins: 550 };
    },
    refundCoinPurchase: async ({ transactionId }) => {
      f.refunds.push(transactionId);
      return { found: true, duplicate: false };
    },
    recordEvent: async (input) => {
      f.recorded.push(input);
    },
  };
  return f;
}

function apiSubscriber(overrides: { entitlementExpires?: string | null; sub?: Partial<RcSubscriber['subscriber']['subscriptions'] extends infer T ? (T extends Record<string, infer S> ? S : never) : never>; noEntitlement?: boolean; managementUrl?: string | null } = {}): RcSubscriber {
  const expires = overrides.entitlementExpires === undefined ? new Date(NOW + 20 * DAY).toISOString() : overrides.entitlementExpires;
  return {
    request_date_ms: NOW,
    subscriber: {
      original_app_user_id: USER,
      management_url: overrides.managementUrl ?? 'https://apps.apple.com/account/subscriptions',
      entitlements: overrides.noEntitlement ? {} : { friendzy_premium: { expires_date: expires, product_identifier: 'friendzy_premium_monthly', purchase_date: new Date(NOW - 10 * DAY).toISOString() } },
      subscriptions: {
        friendzy_premium_monthly: {
          expires_date: expires,
          purchase_date: new Date(NOW - 10 * DAY).toISOString(),
          period_type: 'normal',
          store: 'app_store',
          is_sandbox: false,
          unsubscribe_detected_at: null,
          billing_issues_detected_at: null,
          grace_period_expires_date: null,
          ...(overrides.sub ?? {}),
        },
      },
      non_subscriptions: {},
    },
  };
}

describe('authentication', () => {
  it('rejects a missing or wrong Authorization header and never touches the database', async () => {
    const f = fakes();
    expect((await handleRevenueCatWebhook(request(event({ type: 'TEST' }), {}), f.deps)).status).toBe(401);
    expect((await handleRevenueCatWebhook(request(event({ type: 'TEST' }), { authorization: 'nope' }), f.deps)).status).toBe(401);
    expect((await handleRevenueCatWebhook(request(event({ type: 'TEST' }), { authorization: `${SECRET}x` }), f.deps)).status).toBe(401);
    expect(f.synced).toHaveLength(0);
    expect(f.recorded).toHaveLength(0);
  });

  it('accepts the value verbatim or as Bearer, and compares in constant time', async () => {
    const f = fakes();
    expect((await handleRevenueCatWebhook(request(event({ type: 'TEST' })), f.deps)).body).toEqual({ ok: true, test: true });
    expect((await handleRevenueCatWebhook(request(event({ type: 'TEST' }), { Authorization: `Bearer ${SECRET}` }), f.deps)).status).toBe(200);
    expect(isAuthorized(`Bearer ${SECRET}`, `Bearer ${SECRET}`)).toBe(true);
    expect(isAuthorized(SECRET, `Bearer ${SECRET}`)).toBe(true);
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('refuses everything when the secret is not configured', async () => {
    const f = fakes();
    f.deps.expectedAuth = '';
    const res = await handleRevenueCatWebhook(request(event({ type: 'TEST' })), f.deps);
    expect(res.status).toBe(500);
  });

  it('answers 405 / 400 for the wrong method or body', async () => {
    const f = fakes();
    expect((await handleRevenueCatWebhook(request(event({ type: 'TEST' }), { authorization: SECRET }, 'GET'), f.deps)).status).toBe(405);
    expect((await handleRevenueCatWebhook(request('{not json'), f.deps)).status).toBe(400);
    expect((await handleRevenueCatWebhook(request({ event: { id: 'x' } }), f.deps)).status).toBe(400);
  });
});

describe('subscription events (event fallback, no API key)', () => {
  it('activates Premium on INITIAL_PURCHASE and marks trials', async () => {
    const f = fakes();
    const res = await handleRevenueCatWebhook(request(event({ type: 'INITIAL_PURCHASE', period_type: 'TRIAL' })), f.deps);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: 'trialing', source: 'event' });
    expect(f.synced[0]).toMatchObject({ userId: USER, eventId: 'rc:evt-initial_purchase', eventType: 'INITIAL_PURCHASE' });
    expect(f.synced[0].snapshot).toMatchObject({ store: 'app_store', environment: 'production', periodType: 'trial', willRenew: true, productId: 'friendzy_premium_monthly' });
  });

  it('is idempotent: a retried delivery with the same event id is acknowledged without a second write', async () => {
    const f = fakes();
    const body = event({ type: 'RENEWAL', id: 'evt-dup' });
    const first = await handleRevenueCatWebhook(request(body), f.deps);
    const second = await handleRevenueCatWebhook(request(body), f.deps);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ ok: true, duplicate: true });
    expect(f.synced).toHaveLength(1);
  });

  it('maps cancellation, expiration, billing issues and pauses', () => {
    const base = event({ type: 'CANCELLATION' }).event;
    expect(snapshotFromEvent(base, NOW)).toMatchObject({ status: 'active', willRenew: false });
    expect(snapshotFromEvent(base, NOW).unsubscribeDetectedAt).toBe(new Date(NOW).toISOString());
    expect(snapshotFromEvent({ ...base, cancel_reason: 'CUSTOMER_SUPPORT', expiration_at_ms: NOW - 1000 }, NOW).status).toBe('cancelled');
    expect(snapshotFromEvent({ ...base, type: 'EXPIRATION', expiration_at_ms: NOW - 1000 }, NOW)).toMatchObject({ status: 'expired', willRenew: false });
    expect(snapshotFromEvent({ ...base, type: 'BILLING_ISSUE', expiration_at_ms: NOW - 1000, grace_period_expiration_at_ms: NOW + DAY }, NOW)).toMatchObject({ status: 'billing_issue' });
    expect(snapshotFromEvent({ ...base, type: 'BILLING_ISSUE', expiration_at_ms: NOW - 1000, grace_period_expiration_at_ms: null }, NOW).status).toBe('expired');
    expect(snapshotFromEvent({ ...base, type: 'SUBSCRIPTION_PAUSED', expiration_at_ms: NOW - 1000 }, NOW).status).toBe('paused');
    expect(snapshotFromEvent({ ...base, type: 'UNCANCELLATION' }, NOW)).toMatchObject({ status: 'active', willRenew: true });
    expect(snapshotFromEvent({ ...base, type: 'TEMPORARY_ENTITLEMENT_GRANT', expiration_at_ms: NOW + DAY }, NOW).status).toBe('active');
  });

  it('stores events it cannot attribute to a Friendzy user without touching entitlements', async () => {
    const f = fakes();
    const res = await handleRevenueCatWebhook(request(event({ type: 'INITIAL_PURCHASE', app_user_id: '$RCAnonymousID:abc', aliases: ['$RCAnonymousID:abc'] })), f.deps);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, ignored: true });
    expect(f.synced).toHaveLength(0);
    expect(f.recorded[0]).toMatchObject({ userId: null, eventId: 'rc:evt-initial_purchase' });
  });

  it('finds the Friendzy user id among aliases', () => {
    expect(resolveUser({ id: 'x', type: 'RENEWAL', app_user_id: '$RCAnonymousID:abc', aliases: ['$RCAnonymousID:abc', USER.toUpperCase()] })).toBe(USER);
    expect(resolveUser({ id: 'x', type: 'RENEWAL', app_user_id: 'someone-else' })).toBeNull();
  });

  it('can be told to store sandbox events without granting anything', async () => {
    const f = fakes({ ignoreSandbox: true });
    const res = await handleRevenueCatWebhook(request(event({ type: 'INITIAL_PURCHASE', environment: 'SANDBOX' })), f.deps);
    expect(res.body).toMatchObject({ ignored: true, reason: 'sandbox' });
    expect(f.synced).toHaveLength(0);
    expect(f.recorded).toHaveLength(1);
  });

  it('only records bookkeeping events (aliases, invoices, refund reversals)', async () => {
    const f = fakes();
    for (const type of ['SUBSCRIBER_ALIAS', 'INVOICE_ISSUANCE', 'REFUND_REVERSED', 'VIRTUAL_CURRENCY_TRANSACTION']) {
      const res = await handleRevenueCatWebhook(request(event({ type, id: `evt-${type}` })), f.deps);
      expect(res.body).toEqual({ ok: true, recorded: true });
    }
    expect(f.synced).toHaveLength(0);
    expect(f.recorded).toHaveLength(4);
  });

  it('fails loudly (500) when the database write fails so RevenueCat retries', async () => {
    const f = fakes();
    f.deps.syncSubscription = async () => {
      throw new Error('connection reset');
    };
    const res = await handleRevenueCatWebhook(request(event({ type: 'RENEWAL' })), f.deps);
    expect(res.status).toBe(500);
  });
});

describe('subscription events with the RevenueCat API as source of truth', () => {
  it('uses the current entitlement from the API (status, expiry, management URL)', async () => {
    const f = fakes({ withApi: true });
    f.subscriber = apiSubscriber();
    const res = await handleRevenueCatWebhook(request(event({ type: 'RENEWAL' })), f.deps);
    expect(res.body).toMatchObject({ status: 'active', source: 'api' });
    expect(f.apiCalls).toEqual([USER]);
    expect(f.synced[0].snapshot).toMatchObject({ expiresAt: new Date(NOW + 20 * DAY).toISOString(), managementUrl: 'https://apps.apple.com/account/subscriptions', willRenew: true, store: 'app_store' });
  });

  it('derives grace period, billing issue, pause, cancellation and expiry from the subscriber record', () => {
    const ev = event({ type: 'RENEWAL' }).event;
    const past = new Date(NOW - DAY).toISOString();
    expect(snapshotFromApi(apiSubscriber({ entitlementExpires: past, sub: { expires_date: past, grace_period_expires_date: new Date(NOW + 3 * DAY).toISOString() } }), 'friendzy_premium', ev, NOW)).toMatchObject({ status: 'grace_period', willRenew: false });
    expect(snapshotFromApi(apiSubscriber({ sub: { billing_issues_detected_at: past } }), 'friendzy_premium', ev, NOW)).toMatchObject({ status: 'billing_issue' });
    expect(snapshotFromApi(apiSubscriber({ sub: { period_type: 'trial' } }), 'friendzy_premium', ev, NOW)!.status).toBe('trialing');
    expect(snapshotFromApi(apiSubscriber({ entitlementExpires: past, sub: { expires_date: past, auto_resume_date: new Date(NOW + 10 * DAY).toISOString() } }), 'friendzy_premium', ev, NOW)!.status).toBe('paused');
    expect(snapshotFromApi(apiSubscriber({ entitlementExpires: past, sub: { expires_date: past, unsubscribe_detected_at: past } }), 'friendzy_premium', ev, NOW)).toMatchObject({ status: 'cancelled', willRenew: false });
    expect(snapshotFromApi(apiSubscriber({ entitlementExpires: past, sub: { expires_date: past } }), 'friendzy_premium', ev, NOW)!.status).toBe('expired');
    expect(snapshotFromApi(apiSubscriber({ sub: { unsubscribe_detected_at: past } }), 'friendzy_premium', ev, NOW)).toMatchObject({ status: 'active', willRenew: false });
    // No entitlement at all (never subscribed, or revoked) → expired, never active.
    expect(snapshotFromApi(apiSubscriber({ noEntitlement: true, entitlementExpires: null }), 'friendzy_premium', { ...ev, product_id: undefined }, NOW)).toMatchObject({ status: 'expired', willRenew: false });
    expect(snapshotFromApi(apiSubscriber({ entitlementExpires: null }), 'friendzy_premium', ev, NOW)).toMatchObject({ status: 'active', expiresAt: null });
    expect(snapshotFromApi(null, 'friendzy_premium', ev, NOW)).toBeNull();
  });

  it('falls back to the event when the API fails, without leaking the key in logs', async () => {
    const f = fakes({ withApi: true });
    f.failApi = true;
    const logs: string[] = [];
    f.deps.logger = { info: () => undefined, warn: (m) => logs.push(m), error: (m) => logs.push(m) };
    const res = await handleRevenueCatWebhook(request(event({ type: 'INITIAL_PURCHASE' })), f.deps);
    expect(res.body).toMatchObject({ status: 'active', source: 'event' });
    expect(logs.join('\n')).toContain('[redacted]');
    expect(logs.join('\n')).not.toContain('sk_live_secret');
  });

  it('prefers a fresh purchase event over an API read that still shows no entitlement', async () => {
    const f = fakes({ withApi: true });
    f.subscriber = apiSubscriber({ noEntitlement: true, entitlementExpires: new Date(NOW - DAY).toISOString() });
    const res = await handleRevenueCatWebhook(request(event({ type: 'INITIAL_PURCHASE' })), f.deps);
    expect(res.body).toMatchObject({ status: 'active', source: 'event' });
  });

  it('expires the previous owner and re-syncs the new one on TRANSFER', async () => {
    const f = fakes();
    const res = await handleRevenueCatWebhook(request(event({ type: 'TRANSFER', app_user_id: USER, transferred_from: [OTHER], transferred_to: [USER], product_id: undefined })), f.deps);
    expect(res.status).toBe(200);
    const byUser = Object.fromEntries(f.synced.map((s) => [s.userId, s]));
    expect(byUser[OTHER]).toMatchObject({ eventType: 'TRANSFER_OUT' });
    expect(byUser[OTHER].snapshot.status).toBe('expired');
    expect(byUser[USER]).toMatchObject({ eventType: 'TRANSFER_IN' });
    expect(byUser[USER].snapshot.status).toBe('active');
    expect(f.recorded).toHaveLength(1);
  });
});

describe('coin packs (consumables)', () => {
  it('credits coins once per store transaction and converts the price to cents', async () => {
    const f = fakes();
    const body = event({ type: 'NON_RENEWING_PURCHASE', id: 'evt-coins', product_id: 'friendzy_coins_550', transaction_id: 'GPA.1234-5678', store: 'PLAY_STORE', price_in_purchased_currency: 4.99, currency: 'USD', expiration_at_ms: null });
    const first = await handleRevenueCatWebhook(request(body), f.deps);
    expect(first.body).toMatchObject({ ok: true, coins: { duplicate: false, coins: 550 } });
    expect(f.coins[0]).toMatchObject({ userId: USER, sku: 'friendzy_coins_550', transactionId: 'GPA.1234-5678', store: 'play_store', priceCents: 499, currency: 'USD', environment: 'production' });
    const again = await handleRevenueCatWebhook(request(body), f.deps);
    expect(again.body).toMatchObject({ coins: { duplicate: true } });
    expect(f.coins).toHaveLength(1);
    expect(f.synced).toHaveLength(0);
  });

  it('refunds a coin pack when RevenueCat reports its cancellation', async () => {
    const f = fakes();
    const res = await handleRevenueCatWebhook(request(event({ type: 'CANCELLATION', product_id: 'friendzy_coins_550', transaction_id: 'GPA.1234-5678', cancel_reason: 'CUSTOMER_SUPPORT' })), f.deps);
    expect(res.body).toMatchObject({ ok: true, refund: { found: true } });
    expect(f.refunds).toEqual(['GPA.1234-5678']);
  });

  it('maps every RevenueCat store name', () => {
    expect(mapStore('APP_STORE')).toBe('app_store');
    expect(mapStore('play_store')).toBe('play_store');
    expect(mapStore('RC_BILLING')).toBe('stripe');
    expect(mapStore('PROMOTIONAL')).toBe('promotional');
    expect(mapStore('TEST_STORE')).toBe('test_store');
    expect(mapStore(undefined)).toBe('unknown');
  });
});
