// @ts-nocheck — Deno script (jsr imports, Deno globals); run with Deno, not part of the app build.
/**
 * Web Push self-test (Deno) — proves the push-dispatch encryption is correct
 * without a browser:
 *
 *   1. generates a browser-like subscription (P-256 ECDH key pair + 16-byte auth secret),
 *   2. starts a fake push service on localhost that captures the request,
 *   3. sends a message through the same library and VAPID keys push-dispatch uses,
 *   4. verifies the VAPID JWT (ES256, aud/exp/sub) with the public key,
 *   5. decrypts the aes128gcm body with an independent RFC 8291 implementation
 *      and checks it equals the original payload.
 *
 *   deno run -A scripts/qa/webpush-selftest.ts            (throwaway keys)
 *   VAPID_KEYS_FILE=keys.json deno run -A scripts/qa/webpush-selftest.ts   (a specific pair)
 */
// @ts-types="../../supabase/functions/_shared/webpush.vendored.d.ts"
import { ApplicationServer, exportVapidKeys, generateVapidKeys, importVapidKeys, Urgency } from '../../supabase/functions/_shared/webpush.vendored.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

// Keys: VAPID_KEYS_FILE (JSON with publicKey/privateKey JWKs as written by exportVapidKeys) or a throwaway pair.
const keysFile = Deno.env.get('VAPID_KEYS_FILE');
const exported = keysFile
  ? (JSON.parse(await Deno.readTextFile(keysFile)) as { publicKey: JsonWebKey; privateKey: JsonWebKey })
  : await exportVapidKeys(await generateVapidKeys({ extractable: true }));
const publicKeyBase64Url = (() => {
  const d = (v: string) => Uint8Array.from(atob(v.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (v.length % 4)) % 4)), (c) => c.charCodeAt(0));
  const raw = new Uint8Array([4, ...d(exported.publicKey.x!), ...d(exported.publicKey.y!)]);
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
})();
const vapidKeys = await importVapidKeys({ publicKey: exported.publicKey, privateKey: exported.privateKey }, { extractable: true });
const server = await ApplicationServer.new({ contactInformation: 'https://friendzychat.netlify.app', vapidKeys });

// 1. Browser-like subscription
const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
const authSecret = crypto.getRandomValues(new Uint8Array(16));

// 2. Fake push service
let captured: { headers: Headers; body: Uint8Array } | null = null;
const ac = new AbortController();
const fake = Deno.serve({ port: 0, hostname: '127.0.0.1', signal: ac.signal, onListen: () => undefined }, async (req) => {
  captured = { headers: req.headers, body: new Uint8Array(await req.arrayBuffer()) };
  return new Response(null, { status: 201 });
});
const endpoint = `http://127.0.0.1:${fake.addr.port}/push/abc123`;

// 3. Send through the library exactly like push-dispatch does
const payload = JSON.stringify({ title: 'Friendzy', body: 'Self-test message 🔔', url: '/notifications', type: 'test_notification' });
const subscriber = server.subscribe({ endpoint, keys: { p256dh: b64url(uaPublicRaw), auth: b64url(authSecret) } });
await subscriber.pushTextMessage(payload, { urgency: Urgency.High, ttl: 60, topic: 'selftest' });
ac.abort();
await fake.finished;
if (!captured) throw new Error('push service received nothing');
const { headers, body } = captured as { headers: Headers; body: Uint8Array };

// 4. VAPID headers
const authz = headers.get('authorization') ?? '';
const m = /^vapid t=([^,]+),\s*k=(.+)$/i.exec(authz);
if (!m) throw new Error(`unexpected Authorization header: ${authz}`);
const [, jwt, k] = m;
if (k !== publicKeyBase64Url) throw new Error('VAPID k parameter does not match the public key');
const [h, p, s] = jwt.split('.');
const header = JSON.parse(dec.decode(fromB64url(h)));
const claims = JSON.parse(dec.decode(fromB64url(p)));
if (header.alg !== 'ES256') throw new Error(`alg ${header.alg}`);
if (claims.aud !== `http://127.0.0.1:${fake.addr.port}`) throw new Error(`aud ${claims.aud}`);
if (claims.sub !== 'https://friendzychat.netlify.app') throw new Error(`sub ${claims.sub}`);
if (typeof claims.exp !== 'number' || claims.exp - Math.floor(Date.now() / 1000) > 24 * 3600 || claims.exp < Date.now() / 1000) throw new Error(`exp ${claims.exp}`);
const verifyKey = await crypto.subtle.importKey('jwk', exported.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
const sigOk = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, fromB64url(s), enc.encode(`${h}.${p}`));
if (!sigOk) throw new Error('VAPID JWT signature does not verify');
if (headers.get('content-encoding') !== 'aes128gcm') throw new Error(`content-encoding ${headers.get('content-encoding')}`);
if (headers.get('ttl') !== '60') throw new Error(`TTL ${headers.get('ttl')}`);
if (headers.get('urgency') !== 'high') throw new Error(`Urgency ${headers.get('urgency')}`);
if (headers.get('topic') !== 'selftest') throw new Error(`Topic ${headers.get('topic')}`);

// 5. Independent RFC 8291 / RFC 8188 decryption
const salt = body.slice(0, 16);
const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
const idlen = body[20];
const asPublicRaw = body.slice(21, 21 + idlen);
const ciphertext = body.slice(21 + idlen);
if (idlen !== 65) throw new Error(`keyid length ${idlen}`);
const asPublic = await crypto.subtle.importKey('raw', asPublicRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asPublic }, ua.privateKey, 256));
const hkdf = async (ikm: Uint8Array, saltBytes: Uint8Array, info: Uint8Array, length: number) => {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info }, key, length * 8));
};
const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublicRaw, asPublicRaw);
const ikm = await hkdf(ecdh, authSecret, keyInfo, 32);
const cek = await hkdf(ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 16);
const nonce = await hkdf(ikm, salt, enc.encode('Content-Encoding: nonce\0'), 12);
if (ciphertext.length > rs) throw new Error('multi-record payloads are not expected for push messages');
const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aesKey, ciphertext));
const delimiter = plain.lastIndexOf(2);
if (delimiter < 0) throw new Error('padding delimiter missing');
const text = dec.decode(plain.slice(0, delimiter));
if (text !== payload) throw new Error(`decrypted payload differs: ${text}`);

console.log('✔ VAPID JWT valid (ES256, aud/sub/exp), k matches public key');
console.log('✔ aes128gcm body decrypts to the original payload with an independent RFC 8291 implementation');
console.log(`✔ record size ${rs}, ciphertext ${ciphertext.length} bytes, TTL/Urgency/Topic headers present`);
