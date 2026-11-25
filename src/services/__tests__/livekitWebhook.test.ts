/**
 * LiveKit webhook: request handling (fakes) + real signature verification with
 * the LiveKit server SDK using throw-away test credentials.
 */
import { nanosToIso, parseRoomName, secondsToIso, summarizeEvent, type EventRecord } from '../../../supabase/functions/_shared/livekit/events.ts';
import { handleLiveKitWebhook, safeMessage, type IngestResult, type WebhookRequest } from '../../../supabase/functions/_shared/livekit/handler.ts';

if (!globalThis.crypto?.subtle) {
  // Jest's Node environment may not expose WebCrypto; Node's implementation is identical.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { webcrypto } = require('crypto') as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

/** Base64 SHA-256 of the body — what LiveKit puts in the token's `sha256` claim. */
async function bodyHash(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

const TEST_API_KEY = 'APItestkey0000';
const TEST_API_SECRET = 'friendzy-test-secret-not-a-real-credential-0123456789';
const LIVE_ID = '0b4c1d5e-6f70-4a81-9b92-a3b4c5d6e7f8';

function request(options: { method?: string; headers?: Record<string, string>; body?: string }): WebhookRequest {
  const headers = new Map(Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    method: options.method ?? 'POST',
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    text: async () => options.body ?? '',
  };
}

const okIngest = async (): Promise<IngestResult> => ({ duplicate: false, attempts: 1, applied: ['live.room_started'] });

describe('events helpers', () => {
  it('parses Friendzy room names', () => {
    expect(parseRoomName(`live_${LIVE_ID}`)).toEqual({ scope: 'live', id: LIVE_ID });
    expect(parseRoomName(`call_${LIVE_ID.toUpperCase()}`)).toEqual({ scope: 'call', id: LIVE_ID });
    expect(parseRoomName('live_not-a-uuid')).toEqual({ scope: 'other', id: null });
    expect(parseRoomName('someone-elses-room')).toEqual({ scope: 'other', id: null });
    expect(parseRoomName(null)).toEqual({ scope: 'other', id: null });
  });

  it('converts LiveKit timestamps', () => {
    expect(secondsToIso(1_764_000_000)).toBe('2025-11-24T16:00:00.000Z');
    expect(secondsToIso(BigInt(1_764_000_000))).toBe('2025-11-24T16:00:00.000Z');
    expect(secondsToIso(0)).toBeNull();
    expect(nanosToIso('1764000000000000000')).toBe('2025-11-24T16:00:00.000Z');
    expect(nanosToIso(undefined)).toBeNull();
  });

  it('summarises an event into the database record', () => {
    const record = summarizeEvent({
      id: 'EV_1',
      event: 'participant_joined',
      createdAt: BigInt(1_764_000_000),
      numDropped: 2,
      room: { sid: 'RM_1', name: `live_${LIVE_ID}` },
      participant: { sid: 'PA_1', identity: 'f1e2d3c4-b5a6-4789-8abc-def012345678' },
      toJson: () => ({ event: 'participant_joined', id: 'EV_1' }),
    });
    expect(record).toMatchObject({ id: 'EV_1', event: 'participant_joined', roomName: `live_${LIVE_ID}`, roomSid: 'RM_1', participantIdentity: 'f1e2d3c4-b5a6-4789-8abc-def012345678', participantSid: 'PA_1', egressId: null, eventAt: '2025-11-24T16:00:00.000Z', numDropped: 2, scope: 'live', targetId: LIVE_ID });
    expect(record?.payload).toEqual({ event: 'participant_joined', id: 'EV_1' });
  });

  it('takes the room from egressInfo for egress events and rejects events without id/type', () => {
    const record = summarizeEvent({ id: 'EV_2', event: 'egress_ended', egressInfo: { egressId: 'EG_1', roomName: `live_${LIVE_ID}`, roomId: 'RM_9' }, createdAt: '1764000000' });
    expect(record).toMatchObject({ roomName: `live_${LIVE_ID}`, roomSid: 'RM_9', egressId: 'EG_1', scope: 'live' });
    expect(summarizeEvent({ event: 'room_started' })).toBeNull();
    expect(summarizeEvent({ id: 'EV_3' })).toBeNull();
  });

  it('never leaks token-shaped strings into logs', () => {
    expect(safeMessage(new Error('bad token eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl here'))).toBe('bad token [redacted] here');
  });
});

describe('handleLiveKitWebhook (request handling)', () => {
  const verifyOk = async () => ({ id: 'EV_1', event: 'room_started', room: { name: `live_${LIVE_ID}`, sid: 'RM_1' }, createdAt: 1_764_000_000 });

  it('rejects non-POST requests', async () => {
    const res = await handleLiveKitWebhook(request({ method: 'GET' }), { verify: verifyOk, ingest: okIngest });
    expect(res.status).toBe(405);
  });

  it('rejects requests without an Authorization header before reading the body', async () => {
    const verify = jest.fn(verifyOk);
    const res = await handleLiveKitWebhook(request({ body: '{}' }), { verify, ingest: okIngest });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects oversized payloads', async () => {
    const res = await handleLiveKitWebhook(request({ headers: { authorization: 't' }, body: 'x'.repeat(100) }), { verify: verifyOk, ingest: okIngest, maxBodyBytes: 50 });
    expect(res.status).toBe(413);
    const declared = await handleLiveKitWebhook(request({ headers: { authorization: 't', 'content-length': '999999999' }, body: '{}' }), { verify: verifyOk, ingest: okIngest });
    expect(declared.status).toBe(413);
  });

  it('answers 401 when signature verification fails and does not store anything', async () => {
    const ingest = jest.fn(okIngest);
    const warn = jest.fn();
    const res = await handleLiveKitWebhook(request({ headers: { authorization: 'eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl' }, body: '{"event":"room_started"}' }), {
      verify: async () => {
        throw new Error('signature verification failed for eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl');
      },
      ingest,
      logger: { info: jest.fn(), warn, error: jest.fn() },
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(ingest).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[redacted]'));
    expect(warn.mock.calls[0][0]).not.toContain('eyJhbGciOi');
  });

  it('answers 400 for verified events without an id', async () => {
    const res = await handleLiveKitWebhook(request({ headers: { authorization: 't' }, body: '{}' }), { verify: async () => ({ event: 'room_started' }), ingest: okIngest });
    expect(res.status).toBe(400);
  });

  it('stores and reports the applied side effects', async () => {
    const seen: EventRecord[] = [];
    const res = await handleLiveKitWebhook(request({ headers: { authorization: 't' }, body: '{"event":"room_started"}' }), {
      verify: verifyOk,
      ingest: async (record) => {
        seen.push(record);
        return { duplicate: false, attempts: 1, applied: ['live.room_started'] };
      },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, id: 'EV_1', event: 'room_started', applied: ['live.room_started'] });
    expect(seen[0]).toMatchObject({ id: 'EV_1', scope: 'live', targetId: LIVE_ID, roomSid: 'RM_1' });
  });

  it('acknowledges duplicate deliveries with 200 without reprocessing', async () => {
    const res = await handleLiveKitWebhook(request({ headers: { authorization: 't' }, body: '{}' }), { verify: verifyOk, ingest: async () => ({ duplicate: true, attempts: 2 }) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, duplicate: true });
  });

  it('answers 500 (so LiveKit retries) when storage or processing fails, without leaking details', async () => {
    const stored = await handleLiveKitWebhook(request({ headers: { authorization: 't' }, body: '{}' }), {
      verify: verifyOk,
      ingest: async () => {
        throw new Error('connection refused to db-host:5432');
      },
    });
    expect(stored.status).toBe(500);
    expect(stored.body).toEqual({ error: 'Storage failed' });
    const processed = await handleLiveKitWebhook(request({ headers: { authorization: 't' }, body: '{}' }), { verify: verifyOk, ingest: async () => ({ duplicate: false, error: 'INVALID_EVENT' }) });
    expect(processed.status).toBe(500);
    expect(processed.body).toEqual({ error: 'Processing failed' });
  });
});

describe('signature verification with the LiveKit server SDK', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sdk = require('livekit-server-sdk') as typeof import('livekit-server-sdk');
  const body = JSON.stringify({ event: 'participant_left', id: 'EV_signed', createdAt: 1_764_000_000, room: { sid: 'RM_42', name: `live_${LIVE_ID}` }, participant: { sid: 'PA_7', identity: 'f1e2d3c4-b5a6-4789-8abc-def012345678' } });

  async function sign(payload: string, apiKey = TEST_API_KEY, apiSecret = TEST_API_SECRET): Promise<string> {
    // Mirrors what the LiveKit server does: a short-lived JWT with the body hash in the `sha256` claim.
    const token = new sdk.AccessToken(apiKey, apiSecret, { ttl: '10m' });
    token.sha256 = await bodyHash(payload);
    return token.toJwt();
  }

  it('accepts a correctly signed event and passes the parsed fields on', async () => {
    const receiver = new sdk.WebhookReceiver(TEST_API_KEY, TEST_API_SECRET);
    const authorization = await sign(body);
    const seen: EventRecord[] = [];
    const res = await handleLiveKitWebhook(request({ headers: { authorization }, body }), {
      verify: (b, auth) => receiver.receive(b, auth),
      ingest: async (record) => {
        seen.push(record);
        return { duplicate: false, applied: ['live.participant_left'] };
      },
    });
    expect(res.status).toBe(200);
    expect(seen[0]).toMatchObject({ id: 'EV_signed', event: 'participant_left', roomName: `live_${LIVE_ID}`, roomSid: 'RM_42', participantIdentity: 'f1e2d3c4-b5a6-4789-8abc-def012345678', participantSid: 'PA_7', eventAt: '2025-11-24T16:00:00.000Z', scope: 'live', targetId: LIVE_ID });
    expect((seen[0].payload as { event: string }).event).toBe('participant_left');
  });

  it('rejects a tampered body, a token signed with another secret, and a token without the body hash', async () => {
    const receiver = new sdk.WebhookReceiver(TEST_API_KEY, TEST_API_SECRET);
    const deps = { verify: (b: string, auth: string) => receiver.receive(b, auth), ingest: jest.fn(okIngest) };
    const authorization = await sign(body);

    const tampered = await handleLiveKitWebhook(request({ headers: { authorization }, body: body.replace('participant_left', 'room_finished') }), deps);
    expect(tampered.status).toBe(401);

    const wrongSecret = await handleLiveKitWebhook(request({ headers: { authorization: await sign(body, TEST_API_KEY, 'another-secret-that-is-long-enough-to-sign-with-0000') }, body }), deps);
    expect(wrongSecret.status).toBe(401);

    const wrongKey = await handleLiveKitWebhook(request({ headers: { authorization: await sign(body, 'APIotherkey00', TEST_API_SECRET) }, body }), deps);
    expect(wrongKey.status).toBe(401);

    const noHash = new sdk.AccessToken(TEST_API_KEY, TEST_API_SECRET, { ttl: '10m' });
    const noHashRes = await handleLiveKitWebhook(request({ headers: { authorization: await noHash.toJwt() }, body }), deps);
    expect(noHashRes.status).toBe(401);

    expect(deps.ingest).not.toHaveBeenCalled();
  });
});
