/**
 * RevenueCat webhook — pure request handling, shared by the Edge Function and the
 * Jest suite. Nothing in here touches Deno, Supabase or the network: every side
 * effect is injected through `RevenueCatDeps`, so the decision logic (auth,
 * idempotency, event → entitlement mapping, coins vs. subscriptions) is testable.
 *
 * Source of truth: when a RevenueCat secret API key is available the handler
 * re-reads the subscriber from the RevenueCat REST API after every subscription
 * event and derives the Premium status from the *current* entitlement instead of
 * trusting the event body alone. Without the key (or if the API is unreachable)
 * it falls back to the event, which is itself authenticated by the shared
 * webhook secret.
 */

export type PremiumStatus = 'active' | 'trialing' | 'grace_period' | 'billing_issue' | 'paused' | 'expired' | 'cancelled';
export type Environment = 'production' | 'sandbox';

export interface RcEvent {
  id: string;
  type: string;
  app_user_id: string;
  original_app_user_id?: string;
  aliases?: string[];
  product_id?: string;
  new_product_id?: string;
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
  expiration_reason?: string;
  is_trial_conversion?: boolean;
  transferred_from?: string[];
  transferred_to?: string[];
  event_timestamp_ms?: number;
  app_id?: string;
}

/** Subset of `GET https://api.revenuecat.com/v1/subscribers/{app_user_id}` that we read. */
export interface RcSubscriberEntitlement {
  expires_date: string | null;
  grace_period_expires_date?: string | null;
  product_identifier: string;
  purchase_date?: string;
}
export interface RcSubscriberSubscription {
  expires_date: string | null;
  purchase_date?: string;
  original_purchase_date?: string;
  period_type?: string;
  store?: string;
  is_sandbox?: boolean;
  unsubscribe_detected_at?: string | null;
  billing_issues_detected_at?: string | null;
  grace_period_expires_date?: string | null;
  auto_resume_date?: string | null;
  refunded_at?: string | null;
  store_transaction_id?: string;
}
export interface RcSubscriber {
  request_date_ms?: number;
  subscriber: {
    original_app_user_id?: string;
    management_url?: string | null;
    entitlements?: Record<string, RcSubscriberEntitlement>;
    subscriptions?: Record<string, RcSubscriberSubscription>;
    non_subscriptions?: Record<string, unknown[]>;
  };
}

export interface SubscriptionSnapshot {
  status: PremiumStatus;
  productId: string | null;
  store: string;
  environment: Environment;
  periodType: string | null;
  purchasedAt: string | null;
  expiresAt: string | null;
  willRenew: boolean;
  unsubscribeDetectedAt: string | null;
  billingIssueDetectedAt: string | null;
  gracePeriodExpiresAt: string | null;
  managementUrl: string | null;
  /** Where the snapshot came from — the RevenueCat API or the event body. */
  source: 'api' | 'event';
}

export interface SyncInput {
  userId: string;
  eventId: string;
  eventType: string;
  snapshot: SubscriptionSnapshot;
  originalAppUserId: string | null;
  payload: RcEvent;
}
export interface CoinPurchaseInput {
  userId: string;
  sku: string;
  transactionId: string;
  store: string;
  priceCents: number | null;
  currency: string | null;
  environment: Environment;
  payload: RcEvent;
}
export interface EventRecordInput {
  userId: string | null;
  eventId: string;
  eventType: string;
  productId: string | null;
  store: string;
  environment: Environment;
  payload: RcEvent;
}

export interface WebhookRequest {
  method: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface RevenueCatDeps {
  /** Value of REVENUECAT_WEBHOOK_AUTH; `null`/empty = not configured (requests are refused). */
  expectedAuth: string | null | undefined;
  /** Entitlement identifier in RevenueCat (Friendzy: `friendzy_premium`). */
  entitlementId: string;
  /** When true, sandbox events are stored but never change entitlements or coins. */
  ignoreSandbox?: boolean;
  isCoinSku(sku: string): Promise<boolean>;
  /** Reads the subscriber through the RevenueCat REST API (secret key). `null` = no key configured. */
  fetchSubscriber?: ((appUserId: string) => Promise<RcSubscriber | null>) | null;
  syncSubscription(input: SyncInput): Promise<Record<string, unknown>>;
  recordCoinPurchase(input: CoinPurchaseInput): Promise<Record<string, unknown>>;
  refundCoinPurchase(input: { transactionId: string; payload: RcEvent }): Promise<Record<string, unknown>>;
  /** Stores an event without touching entitlements. Must ignore duplicates. */
  recordEvent(input: EventRecordInput): Promise<void>;
  logger?: Logger;
  now?: () => number;
  maxBodyBytes?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
const SECRET_PATTERN = /(sk_[A-Za-z0-9]{6,}|Bearer\s+\S+)/g;
const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** Event types that only need to be stored. */
export const RECORD_ONLY_EVENTS = new Set(['SUBSCRIBER_ALIAS', 'INVOICE_ISSUANCE', 'VIRTUAL_CURRENCY_TRANSACTION', 'REFUND_REVERSED']);
/** Coin (consumable) purchase events. */
const COIN_PURCHASE_EVENTS = new Set(['NON_RENEWING_PURCHASE', 'INITIAL_PURCHASE', 'RENEWAL']);

export function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(SECRET_PATTERN, '[redacted]').slice(0, 300);
}

/** Constant-time string comparison (UTF-8), so the shared secret cannot be guessed byte by byte. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i += 1) diff |= (x[i % Math.max(1, x.length)] ?? 0) ^ (y[i % Math.max(1, y.length)] ?? 0);
  return diff === 0 && x.length === y.length;
}

/** Accepts the configured value verbatim or as `Bearer <value>` (RevenueCat sends whatever was typed in its dashboard). */
export function isAuthorized(header: string | null, expected: string): boolean {
  if (!header) return false;
  if (safeEqual(header, expected)) return true;
  const trimmed = header.replace(/^Bearer\s+/i, '');
  if (trimmed !== header && safeEqual(trimmed, expected)) return true;
  // Also tolerate an expected value that itself starts with "Bearer ".
  const expectedBare = expected.replace(/^Bearer\s+/i, '');
  return expectedBare !== expected && safeEqual(trimmed, expectedBare);
}

export function resolveUser(event: RcEvent): string | null {
  const candidates = [event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])].filter(Boolean) as string[];
  return candidates.find((c) => UUID.test(c))?.toLowerCase() ?? null;
}

export function mapStore(store: string | undefined | null): string {
  switch ((store ?? '').toUpperCase()) {
    case 'APP_STORE':
      return 'app_store';
    case 'MAC_APP_STORE':
      return 'mac_app_store';
    case 'PLAY_STORE':
      return 'play_store';
    case 'AMAZON':
      return 'amazon';
    case 'STRIPE':
    case 'RC_BILLING':
      return 'stripe';
    case 'PADDLE':
      return 'paddle';
    case 'PROMOTIONAL':
      return 'promotional';
    case 'TEST_STORE':
      return 'test_store';
    default:
      return 'unknown';
  }
}

export function mapEnvironment(value: string | undefined | null): Environment {
  return (value ?? 'PRODUCTION').toUpperCase() === 'SANDBOX' ? 'sandbox' : 'production';
}

function isoFromMs(ms: number | null | undefined): string | null {
  return typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString() : null;
}
function isoFromDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
function inFuture(value: string | null | undefined, now: number): boolean {
  if (!value) return false;
  const t = Date.parse(value);
  return Number.isFinite(t) && t > now;
}

/** Status derived from the event alone (fallback, and what older deployments used). */
export function snapshotFromEvent(event: RcEvent, now: number): SubscriptionSnapshot {
  const expiresAt = isoFromMs(event.expiration_at_ms);
  const future = expiresAt ? Date.parse(expiresAt) > now : true;
  const trial = (event.period_type ?? '').toUpperCase() === 'TRIAL';
  const graceAt = isoFromMs(event.grace_period_expiration_at_ms);
  let status: PremiumStatus;
  let willRenew: boolean;
  switch (event.type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION':
    case 'PRODUCT_CHANGE':
    case 'SUBSCRIPTION_EXTENDED':
    case 'TEMPORARY_ENTITLEMENT_GRANT':
      status = trial ? 'trialing' : 'active';
      willRenew = true;
      break;
    case 'CANCELLATION':
      // Refunds (cancel_reason CUSTOMER_SUPPORT) arrive with the expiration moved to "now".
      status = future ? 'active' : 'cancelled';
      willRenew = false;
      break;
    case 'EXPIRATION':
      status = 'expired';
      willRenew = false;
      break;
    case 'BILLING_ISSUE':
      status = future || inFuture(graceAt, now) ? 'billing_issue' : 'expired';
      willRenew = true;
      break;
    case 'SUBSCRIPTION_PAUSED':
      status = future ? 'active' : 'paused';
      willRenew = false;
      break;
    default:
      status = future ? 'active' : 'expired';
      willRenew = future;
  }
  const nowIso = new Date(now).toISOString();
  return {
    status,
    productId: event.product_id ?? null,
    store: mapStore(event.store),
    environment: mapEnvironment(event.environment),
    periodType: (event.period_type ?? '').toLowerCase() || null,
    purchasedAt: isoFromMs(event.purchased_at_ms),
    expiresAt,
    willRenew,
    unsubscribeDetectedAt: event.type === 'CANCELLATION' ? nowIso : null,
    billingIssueDetectedAt: event.type === 'BILLING_ISSUE' ? nowIso : null,
    gracePeriodExpiresAt: graceAt,
    managementUrl: null,
    source: 'event',
  };
}

/** Status derived from the subscriber's current entitlement in the RevenueCat API. */
export function snapshotFromApi(subscriber: RcSubscriber | null | undefined, entitlementId: string, event: RcEvent, now: number): SubscriptionSnapshot | null {
  const s = subscriber?.subscriber;
  if (!s || typeof s !== 'object') return null;
  const entitlement = s.entitlements?.[entitlementId] ?? null;
  const productId = entitlement?.product_identifier ?? event.product_id ?? null;
  const sub = productId ? (s.subscriptions?.[productId] ?? null) : null;
  const expiresAt = isoFromDate(entitlement?.expires_date ?? sub?.expires_date ?? null);
  const graceAt = isoFromDate(sub?.grace_period_expires_date ?? entitlement?.grace_period_expires_date ?? null);
  const unsubscribeAt = isoFromDate(sub?.unsubscribe_detected_at);
  const billingIssueAt = isoFromDate(sub?.billing_issues_detected_at);
  const autoResumeAt = isoFromDate(sub?.auto_resume_date);
  const entitled = Boolean(entitlement) && (expiresAt === null || Date.parse(expiresAt) > now);

  let status: PremiumStatus;
  if (entitled) {
    if (billingIssueAt) status = 'billing_issue';
    else if ((sub?.period_type ?? '').toLowerCase() === 'trial') status = 'trialing';
    else status = 'active';
  } else if (inFuture(graceAt, now)) {
    status = 'grace_period';
  } else if (autoResumeAt && inFuture(autoResumeAt, now)) {
    status = 'paused';
  } else if (unsubscribeAt || sub?.refunded_at) {
    status = 'cancelled';
  } else {
    status = 'expired';
  }

  return {
    status,
    productId,
    store: mapStore(sub?.store ?? event.store),
    environment: sub ? (sub.is_sandbox ? 'sandbox' : 'production') : mapEnvironment(event.environment),
    periodType: (sub?.period_type ?? event.period_type ?? '').toLowerCase() || null,
    purchasedAt: isoFromDate(sub?.purchase_date ?? entitlement?.purchase_date ?? null) ?? isoFromMs(event.purchased_at_ms),
    expiresAt,
    willRenew: entitled && !unsubscribeAt && !autoResumeAt,
    unsubscribeDetectedAt: unsubscribeAt,
    billingIssueDetectedAt: billingIssueAt,
    gracePeriodExpiresAt: graceAt,
    managementUrl: s.management_url ?? null,
    source: 'api',
  };
}

function grantsAccess(status: PremiumStatus): boolean {
  return status === 'active' || status === 'trialing' || status === 'grace_period' || status === 'billing_issue';
}

/** API first; event as fallback. A purchase event always wins over an API read that lags behind it. */
export async function resolveSnapshot(event: RcEvent, userId: string, deps: RevenueCatDeps, now: number, log: Logger): Promise<SubscriptionSnapshot> {
  const fromEvent = snapshotFromEvent(event, now);
  if (!deps.fetchSubscriber) return fromEvent;
  try {
    const subscriber = await deps.fetchSubscriber(userId);
    const fromApi = snapshotFromApi(subscriber, deps.entitlementId, event, now);
    if (!fromApi) {
      log.warn(`[revenuecat-webhook] ${event.type} ${event.id}: API returned no subscriber, using the event`);
      return fromEvent;
    }
    if (grantsAccess(fromEvent.status) && !grantsAccess(fromApi.status) && fromEvent.expiresAt && Date.parse(fromEvent.expiresAt) > now) {
      log.warn(`[revenuecat-webhook] ${event.type} ${event.id}: API lags behind the event (api=${fromApi.status}, event=${fromEvent.status}); using the event`);
      return { ...fromEvent, managementUrl: fromApi.managementUrl ?? null };
    }
    return fromApi;
  } catch (error) {
    log.warn(`[revenuecat-webhook] ${event.type} ${event.id}: API read failed (${safeMessage(error)}), using the event`);
    return fromEvent;
  }
}

function priceCents(event: RcEvent): number | null {
  const price = event.price_in_purchased_currency ?? event.price ?? null;
  return typeof price === 'number' && Number.isFinite(price) ? Math.round(price * 100) : null;
}

export async function handleRevenueCatWebhook(req: WebhookRequest, deps: RevenueCatDeps): Promise<HandlerResult> {
  const log = deps.logger ?? silent;
  const now = deps.now ? deps.now() : Date.now();
  const maxBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  if (req.method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };

  const expected = (deps.expectedAuth ?? '').trim();
  if (!expected) {
    log.error('[revenuecat-webhook] REVENUECAT_WEBHOOK_AUTH is not configured');
    return { status: 500, body: { error: 'REVENUECAT_WEBHOOK_AUTH is not configured' } };
  }
  if (!isAuthorized(req.headers.get('authorization'), expected)) {
    log.warn('[revenuecat-webhook] rejected: bad or missing Authorization header');
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return { status: 413, body: { error: 'Payload too large' } };
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { status: 400, body: { error: 'Unreadable body' } };
  }
  if (raw.length > maxBytes) return { status: 413, body: { error: 'Payload too large' } };

  let payload: { event?: RcEvent; api_version?: string };
  try {
    payload = JSON.parse(raw);
  } catch {
    return { status: 400, body: { error: 'Invalid JSON' } };
  }
  const event = payload?.event;
  if (!event || typeof event !== 'object' || !event.id || !event.type) return { status: 400, body: { error: 'Missing event' } };
  if (event.type === 'TEST') {
    log.info('[revenuecat-webhook] test event received');
    return { status: 200, body: { ok: true, test: true } };
  }

  const eventId = `rc:${event.id}`;
  const environment = mapEnvironment(event.environment);
  const store = mapStore(event.store);
  const userId = resolveUser(event);
  const sku = event.product_id ?? '';
  const record = (reason: string, extra: Record<string, unknown> = {}) =>
    deps.recordEvent({ userId, eventId, eventType: event.type, productId: event.product_id ?? null, store, environment, payload: event }).then(() => {
      log.info(`[revenuecat-webhook] ${event.type} ${event.id}: ${reason}`);
      return { status: 200, body: { ok: true, ...extra } } as HandlerResult;
    });

  try {
    if (!userId) return await record('ignored — app_user_id is not a Friendzy user id', { ignored: true, reason: 'app_user_id is not a Friendzy user id' });
    if (deps.ignoreSandbox && environment === 'sandbox') return await record('sandbox event stored only', { ignored: true, reason: 'sandbox' });
    if (RECORD_ONLY_EVENTS.has(event.type)) {
      if (event.type === 'REFUND_REVERSED') log.warn(`[revenuecat-webhook] REFUND_REVERSED ${event.id} for ${sku || '?'}: stored for manual review (coins are not re-credited automatically)`);
      return await record('recorded', { recorded: true });
    }

    if (event.type === 'TRANSFER') {
      await deps.recordEvent({ userId, eventId, eventType: event.type, productId: event.product_id ?? null, store, environment, payload: event });
      const ids = Array.from(new Set([userId, ...(event.transferred_from ?? []), ...(event.transferred_to ?? [])].filter((id) => UUID.test(id)).map((id) => id.toLowerCase())));
      const resynced: Record<string, string> = {};
      for (const id of ids) {
        const lostIt = (event.transferred_from ?? []).some((f) => f.toLowerCase() === id) && !(event.transferred_to ?? []).some((t) => t.toLowerCase() === id);
        let snapshot: SubscriptionSnapshot;
        if (deps.fetchSubscriber) snapshot = await resolveSnapshot({ ...event, type: 'TRANSFER' }, id, deps, now, log);
        else {
          const base = snapshotFromEvent(event, now);
          snapshot = lostIt ? { ...base, status: 'expired', willRenew: false, expiresAt: new Date(now).toISOString() } : base;
        }
        if (!deps.fetchSubscriber && lostIt) snapshot = { ...snapshot, status: 'expired', willRenew: false };
        await deps.syncSubscription({ userId: id, eventId: `${eventId}:user:${id}`, eventType: lostIt ? 'TRANSFER_OUT' : 'TRANSFER_IN', snapshot, originalAppUserId: event.original_app_user_id ?? null, payload: event });
        resynced[id] = snapshot.status;
      }
      log.info(`[revenuecat-webhook] TRANSFER ${event.id}: resynced ${JSON.stringify(resynced)}`);
      return { status: 200, body: { ok: true, transfer: true, resynced } };
    }

    // ---- Coin packs (consumables): product identifier equals coin_packages.sku
    if (sku && (await deps.isCoinSku(sku))) {
      const transactionId = event.transaction_id ?? event.original_transaction_id ?? event.id;
      if (COIN_PURCHASE_EVENTS.has(event.type)) {
        const result = await deps.recordCoinPurchase({ userId, sku, transactionId, store, priceCents: priceCents(event), currency: event.currency ?? null, environment, payload: event });
        log.info(`[revenuecat-webhook] ${event.type} ${event.id}: coins ${sku} tx=${transactionId} ${result.duplicate ? '(duplicate)' : `+${String(result.coins ?? '?')}`}`);
        return { status: 200, body: { ok: true, coins: result } };
      }
      if (event.type === 'CANCELLATION' || event.type === 'EXPIRATION') {
        const result = await deps.refundCoinPurchase({ transactionId, payload: event });
        log.info(`[revenuecat-webhook] ${event.type} ${event.id}: coin refund ${sku} tx=${transactionId} reason=${event.cancel_reason ?? '-'} ${JSON.stringify(result)}`);
        return { status: 200, body: { ok: true, refund: result } };
      }
      return await record(`coin event ${event.type} needs no action`, { ignored: true, reason: `coin event ${event.type} needs no action` });
    }

    // ---- Premium subscription
    const snapshot = await resolveSnapshot(event, userId, deps, now, log);
    const result = await deps.syncSubscription({ userId, eventId, eventType: event.type, snapshot, originalAppUserId: event.original_app_user_id ?? null, payload: event });
    if (result.duplicate) {
      log.info(`[revenuecat-webhook] ${event.type} ${event.id}: duplicate delivery ignored`);
      return { status: 200, body: { ok: true, duplicate: true } };
    }
    log.info(`[revenuecat-webhook] ${event.type} ${event.id}: user=${userId} status=${snapshot.status} product=${snapshot.productId ?? '-'} source=${snapshot.source} env=${snapshot.environment}`);
    return { status: 200, body: { ok: true, status: snapshot.status, source: snapshot.source, result } };
  } catch (error) {
    log.error(`[revenuecat-webhook] ${event.type} ${event.id}: processing failed: ${safeMessage(error)}`);
    return { status: 500, body: { error: 'Processing failed' } };
  }
}
