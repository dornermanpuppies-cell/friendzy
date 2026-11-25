/**
 * Request handling for the LiveKit webhook, independent of the runtime.
 * The Edge Function wires in the LiveKit SDK verifier and the Supabase RPC;
 * tests inject fakes (and the real SDK) to exercise every branch.
 *
 * Security notes
 * - Only POST is accepted. The LiveKit JWT in the Authorization header is
 *   verified (signature, issuer = API key, expiry, SHA-256 of the body) before
 *   anything is parsed or stored. Failures answer a generic 401.
 * - Bodies are capped to avoid abuse; nothing from the header is ever logged.
 * - Processing is idempotent per LiveKit event id (database side).
 */
import { summarizeEvent, type EventRecord, type LiveKitEventLike } from './events.ts';

export interface WebhookRequest {
  method: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

export interface IngestResult {
  duplicate: boolean;
  attempts?: number;
  applied?: unknown;
  error?: string;
}

export interface WebhookLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface WebhookDeps {
  /** Verifies the LiveKit signature and returns the parsed event; must throw when invalid. */
  verify: (body: string, authHeader: string) => Promise<LiveKitEventLike>;
  /** Stores + processes the event (idempotent). Must throw on transport/database failure. */
  ingest: (record: EventRecord) => Promise<IngestResult>;
  maxBodyBytes?: number;
  logger?: WebhookLogger;
}

export const DEFAULT_MAX_BODY_BYTES = 512 * 1024;

const JWT_PATTERN = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;

/** Error text that is safe to log: truncated and with anything token-shaped removed. */
export function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(JWT_PATTERN, '[redacted]').slice(0, 300);
}

const silent: WebhookLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export async function handleLiveKitWebhook(req: WebhookRequest, deps: WebhookDeps): Promise<WebhookResult> {
  const log = deps.logger ?? silent;
  const maxBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  if (req.method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };

  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    log.warn('[livekit-webhook] rejected: missing Authorization header');
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return { status: 413, body: { error: 'Payload too large' } };

  let body: string;
  try {
    body = await req.text();
  } catch {
    return { status: 400, body: { error: 'Unreadable body' } };
  }
  if (body.length > maxBytes) return { status: 413, body: { error: 'Payload too large' } };
  if (body.trim().length === 0) return { status: 400, body: { error: 'Empty body' } };

  let event: LiveKitEventLike;
  try {
    event = await deps.verify(body, authHeader);
  } catch (error) {
    log.warn(`[livekit-webhook] rejected: ${safeMessage(error)}`);
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  const record = summarizeEvent(event);
  if (!record) {
    log.warn('[livekit-webhook] rejected: event without id or type');
    return { status: 400, body: { error: 'Invalid event' } };
  }

  let result: IngestResult;
  try {
    result = await deps.ingest(record);
  } catch (error) {
    log.error(`[livekit-webhook] ${record.event} ${record.id}: storage failed: ${safeMessage(error)}`);
    return { status: 500, body: { error: 'Storage failed' } };
  }

  if (result.error) {
    // The event row is kept unprocessed; LiveKit retries non-2xx deliveries.
    log.error(`[livekit-webhook] ${record.event} ${record.id}: processing failed: ${safeMessage(result.error)}`);
    return { status: 500, body: { error: 'Processing failed' } };
  }
  if (result.duplicate) {
    log.info(`[livekit-webhook] ${record.event} ${record.id}: duplicate delivery ignored (attempt ${result.attempts ?? '?'})`);
    return { status: 200, body: { ok: true, duplicate: true } };
  }

  log.info(`[livekit-webhook] ${record.event} ${record.id} room=${record.roomName ?? '-'} scope=${record.scope} applied=${JSON.stringify(result.applied ?? [])}${record.numDropped ? ` dropped=${record.numDropped}` : ''}`);
  return { status: 200, body: { ok: true, id: record.id, event: record.event, applied: result.applied ?? [] } };
}
