// Friendzy QA — checks the Web Push implementation in supabase/functions/_shared/webpush.ts against
// an independent reading of RFC 8291 (payload encryption) and RFC 8292 (VAPID).
//
// It stands up a fake push service, sends one message through the real sender, then verifies the
// VAPID token signature and decrypts the body with code written separately from the sender.
//
//   node scripts/qa/webpush-selftest.mjs
import { createServer } from 'node:http';
import { webcrypto as crypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const b64urlDecode = (v) => Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const b64urlEncode = (b) => Buffer.from(b).toString('base64url');
const concat = (...parts) => Buffer.concat(parts.map((p) => Buffer.from(p)));

// Build the module under test the same way the Edge Function bundle does.
const out = path.join(mkdtempSync(path.join(tmpdir(), 'webpush-')), 'webpush.mjs');
execFileSync('npx', ['-y', 'esbuild@0.24.2', 'supabase/functions/_shared/webpush.ts', '--bundle', '--format=esm', '--platform=neutral', '--target=esnext', `--outfile=${out}`], { stdio: ['ignore', 'ignore', 'inherit'] });
const { createPushSender, PushError } = await import(out);

// A subscription, as a browser would create one.
const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const vapidPublic = Buffer.from(await crypto.subtle.exportKey('raw', vapid.publicKey));
const vapidPrivate = await crypto.subtle.exportKey('jwk', vapid.privateKey);
const client = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const clientPublic = Buffer.from(await crypto.subtle.exportKey('raw', client.publicKey));
const authSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(16)));

let received = null;
const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    received = { headers: req.headers, body: Buffer.concat(chunks) };
    res.writeHead(201).end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const endpoint = `http://127.0.0.1:${server.address().port}/push/abc`;

const message = JSON.stringify({ title: 'Friendzy', body: 'self-test', url: '/notifications' });
const sender = await createPushSender({ publicKey: b64urlEncode(vapidPublic), privateKey: vapidPrivate, subject: 'https://friendzychat.netlify.app' });
await sender.send({ endpoint, keys: { p256dh: b64urlEncode(clientPublic), auth: b64urlEncode(authSecret) } }, message, { ttl: 60, urgency: 'high', topic: 'chat' });

const checks = [];
const check = (ok, label) => { checks.push({ ok, label }); console.log(`${ok ? '✔' : '✖'} ${label}`); };

// 1. VAPID token: ES256 over header.claims, signed by the key named in k=
const auth = received.headers.authorization ?? '';
const token = auth.match(/t=([^,]+)/)?.[1] ?? '';
const kParam = auth.match(/k=([^,\s]+)/)?.[1] ?? '';
const [h, c, sig] = token.split('.');
const claims = JSON.parse(b64urlDecode(c).toString());
const verifyKey = await crypto.subtle.importKey('raw', b64urlDecode(kParam), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
const signatureValid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, b64urlDecode(sig), Buffer.from(`${h}.${c}`));
check(signatureValid, 'VAPID token carries a valid ES256 signature');
check(kParam === b64urlEncode(vapidPublic), 'the token names the application server key the browser subscribed with');
check(claims.aud === `http://127.0.0.1:${server.address().port}`, 'the audience is the push service origin');
check(claims.sub === 'https://friendzychat.netlify.app' && claims.exp > Date.now() / 1000, 'subject and expiry are set');

// 2. Headers the push service needs
check(received.headers['content-encoding'] === 'aes128gcm', 'body is marked aes128gcm');
check(received.headers.ttl === '60' && received.headers.urgency === 'high' && received.headers.topic === 'chat', 'TTL, urgency and topic are passed through');

// 3. Decrypt the body independently (RFC 8291 §3.4)
const body = received.body;
const salt = body.subarray(0, 16);
const idlen = body.readUInt8(20);
const serverPublic = body.subarray(21, 21 + idlen);
const ciphertext = body.subarray(21 + idlen);
const hmacSha256 = async (key, data, bytes) => {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Buffer.from(await crypto.subtle.sign('HMAC', k, data)).subarray(0, bytes);
};
const hkdf = async (saltBytes, ikm, info, length) => hmacSha256(await hmacSha256(saltBytes, ikm, 32), concat(info, Buffer.of(1)), length);
const serverKey = await crypto.subtle.importKey('raw', serverPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
const shared = Buffer.from(await crypto.subtle.deriveBits({ name: 'ECDH', public: serverKey }, client.privateKey, 256));
const ikm = await hkdf(authSecret, shared, concat(Buffer.from('WebPush: info\0'), clientPublic, serverPublic), 32);
const cek = await hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
const nonce = await hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
const aes = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
const plain = Buffer.from(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aes, ciphertext));
const unpadded = plain.subarray(0, plain.length - 1).toString();
check(plain[plain.length - 1] === 2, 'the record carries the last-record delimiter');
check(unpadded === message, 'the payload decrypts to exactly what was sent');

// 4. A rejecting push service surfaces as a PushError the dispatcher can act on
server.close();
const gone = createServer((_req, res) => res.writeHead(410).end('gone'));
await new Promise((r) => gone.listen(0, '127.0.0.1', r));
let error = null;
await sender
  .send({ endpoint: `http://127.0.0.1:${gone.address().port}/x`, keys: { p256dh: b64urlEncode(clientPublic), auth: b64urlEncode(authSecret) } }, message)
  .catch((e) => { error = e; });
gone.close();
check(error instanceof PushError && error.isGone, 'a 410 from the push service is reported as a gone subscription');

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
