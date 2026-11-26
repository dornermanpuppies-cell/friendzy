// Web Push (RFC 8291 payload encryption + RFC 8292 VAPID), written against WebCrypto only.
//
// Replaces the vendored copy of a third-party library: this is the whole of what push-dispatch
// needs, it has no imports, and it keeps the deployed function small enough to read in one sitting.
// scripts/qa/webpush-selftest.mjs checks it against an independent implementation of the same RFCs.

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type Urgency = 'very-low' | 'low' | 'normal' | 'high';

export interface SendOptions {
  ttl?: number;
  urgency?: Urgency;
  topic?: string;
}

/** Thrown when the push service rejects the message; `status` 404/410 means the subscription is gone. */
export class PushError extends Error {
  constructor(readonly status: number, readonly statusText: string, readonly body: string) {
    super(`push failed: ${status} ${statusText}`);
    this.name = 'PushError';
  }

  get isGone(): boolean {
    return this.status === 404 || this.status === 410;
  }
}

const encoder = new TextEncoder();

function b64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function b64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

async function hmac(key: ArrayBuffer | Uint8Array, data: Uint8Array, bytes: number): Promise<Uint8Array> {
  const material = key instanceof Uint8Array ? (key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer) : key;
  const imported = await crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', imported, data));
  return signature.slice(0, bytes);
}

/** HKDF (RFC 5869) with the single-block expand step these payloads always use. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm, 32);
  return hmac(prk, concat(info, Uint8Array.of(1)), length);
}

/** Signs the VAPID token that tells the push service who is sending (RFC 8292). */
async function vapidHeader(privateKey: CryptoKey, publicKeyRaw: Uint8Array, subject: string, audience: string): Promise<string> {
  const header = b64urlEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(encoder.encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, encoder.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${b64urlEncode(publicKeyRaw)}`;
}

export interface PushSender {
  send(subscription: PushSubscription, payload: string, options?: SendOptions): Promise<void>;
}

/**
 * Builds a sender from a VAPID key pair.
 *   publicKey  — base64url of the uncompressed P-256 point (the key the browser subscribes with)
 *   privateKey — base64url of the private scalar `d`, or a private JWK
 */
export async function createPushSender(options: { publicKey: string; privateKey: string | JsonWebKey; subject: string }): Promise<PushSender> {
  const publicRaw = b64urlDecode(options.publicKey);
  if (publicRaw.length !== 65 || publicRaw[0] !== 4) throw new Error('VAPID public key must be an uncompressed P-256 point');
  const jwk: JsonWebKey =
    typeof options.privateKey === 'string'
      ? { kty: 'EC', crv: 'P-256', d: options.privateKey, x: b64urlEncode(publicRaw.slice(1, 33)), y: b64urlEncode(publicRaw.slice(33, 65)), ext: true, key_ops: ['sign'] }
      : options.privateKey;
  const signingKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  return {
    async send(subscription, payload, sendOptions = {}) {
      const clientPublic = b64urlDecode(subscription.keys.p256dh);
      const authSecret = b64urlDecode(subscription.keys.auth);

      // Ephemeral key for this message; its public half travels in the header block.
      const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      const ephemeralPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
      const clientKey = await crypto.subtle.importKey('raw', clientPublic as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, ephemeral.privateKey, 256));

      // RFC 8291 §3.4: mix the shared secret with the subscription's auth secret, then derive key and nonce.
      const ikm = await hkdf(authSecret, shared, concat(encoder.encode('WebPush: info\0'), clientPublic, ephemeralPublic), 32);
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const contentKey = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
      const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

      const plaintext = concat(encoder.encode(payload), Uint8Array.of(2)); // 0x02 = last record
      const aesKey = await crypto.subtle.importKey('raw', contentKey as BufferSource, { name: 'AES-GCM' }, false, ['encrypt']);
      const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plaintext));

      // aes128gcm header: salt | record size | key id length | key id
      const recordSize = new Uint8Array(4);
      new DataView(recordSize.buffer).setUint32(0, 4096);
      const body = concat(salt, recordSize, Uint8Array.of(ephemeralPublic.length), ephemeralPublic, ciphertext);

      const audience = new URL(subscription.endpoint).origin;
      const headers: Record<string, string> = {
        Authorization: await vapidHeader(signingKey, publicRaw, options.subject, audience),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(sendOptions.ttl ?? 86400),
        Urgency: sendOptions.urgency ?? 'normal',
      };
      if (sendOptions.topic) headers.Topic = sendOptions.topic;

      const response = await fetch(subscription.endpoint, { method: 'POST', headers, body: body as BodyInit });
      if (!response.ok) throw new PushError(response.status, response.statusText, (await response.text().catch(() => '')).slice(0, 200));
    },
  };
}
