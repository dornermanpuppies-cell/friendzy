/**
 * Friendzy end-to-end encryption — core primitives and the sealed envelope.
 *
 * Algorithms (all from the audited `@noble` pure-JS libraries):
 *   - X25519 (ECDH) per device identity key
 *   - HKDF-SHA256 to derive key-wrapping keys
 *   - XChaCha20-Poly1305 for content and wrapped keys (AEAD)
 *   - Ed25519 per device signing key over a transcript that binds the
 *     ciphertext to the conversation, kind and sender device
 *
 * Envelope v1 (stored in `messages.envelope`, readable by the server as metadata only):
 *   {
 *     v: 1, alg, sender: { user, device }, eph, nonce, ct,
 *     keys: { [recipientDeviceId]: base64(nonce24 || wrap(contentKey)) }, sig
 *   }
 * One random content key per message; it is wrapped for every device of every
 * member (including the sender's own devices) with an ephemeral X25519 key.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { ed25519, x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';

import { concatBytes, fromBase64, toBase64, utf8Decode, utf8Encode } from './bytes';
import { randomBytes } from './random';

export const ENVELOPE_VERSION = 1 as const;
export const E2EE_ALG = 'x25519-hkdf-sha256/xchacha20poly1305/ed25519';
const WRAP_INFO = utf8Encode('friendzy/e2ee/v1/wrap');
const TRANSCRIPT_TAG = 'FZE1';

export interface DeviceKeyPair {
  identityPublic: Uint8Array;
  identityPrivate: Uint8Array;
  signingPublic: Uint8Array;
  signingPrivate: Uint8Array;
}

export interface Envelope {
  v: 1;
  alg: string;
  sender: { user: string; device: string };
  eph: string;
  nonce: string;
  ct: string;
  keys: Record<string, string>;
  sig: string;
}

/** What the ciphertext is bound to; the server cannot move an envelope elsewhere. */
export interface EnvelopeContext {
  conversationId: string;
  kind: string;
}

export interface RecipientDevice {
  device_id: string;
  identity_key: string;
}

export type OpenFailure = 'UNSUPPORTED' | 'NO_KEY_FOR_DEVICE' | 'BAD_SIGNATURE' | 'CORRUPT';

export function generateDeviceKeys(): DeviceKeyPair {
  const identityPrivate = randomBytes(32);
  const signingPrivate = randomBytes(32);
  return {
    identityPrivate,
    identityPublic: x25519.getPublicKey(identityPrivate),
    signingPrivate,
    signingPublic: ed25519.getPublicKey(signingPrivate),
  };
}

function contextAad(context: EnvelopeContext, senderUser: string, senderDevice: string): Uint8Array {
  return utf8Encode([TRANSCRIPT_TAG, context.conversationId, context.kind, senderUser, senderDevice].join('|'));
}

function transcript(envelope: Omit<Envelope, 'sig'>, context: EnvelopeContext): Uint8Array {
  const keyLines = Object.keys(envelope.keys)
    .sort()
    .map((id) => `${id}=${envelope.keys[id]}`)
    .join(',');
  return utf8Encode(
    [TRANSCRIPT_TAG, String(envelope.v), envelope.alg, context.conversationId, context.kind, envelope.sender.user, envelope.sender.device, envelope.eph, envelope.nonce, envelope.ct, keyLines].join('\n'),
  );
}

function wrappingKey(shared: Uint8Array, ephemeralPublic: Uint8Array, recipientPublic: Uint8Array): Uint8Array {
  return hkdf(sha256, shared, concatBytes(ephemeralPublic, recipientPublic), WRAP_INFO, 32);
}

export function sealEnvelope(params: { payload: Uint8Array; context: EnvelopeContext; sender: { userId: string; deviceId: string; keys: DeviceKeyPair }; recipients: RecipientDevice[] }): Envelope {
  const { payload, context, sender, recipients } = params;
  if (!recipients.some((r) => r.device_id === sender.deviceId)) {
    throw new Error('The sending device must be among the recipients.');
  }
  const contentKey = randomBytes(32);
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(contentKey, nonce, contextAad(context, sender.userId, sender.deviceId)).encrypt(payload);

  const ephemeralPrivate = randomBytes(32);
  const ephemeralPublic = x25519.getPublicKey(ephemeralPrivate);
  const keys: Record<string, string> = {};
  for (const recipient of recipients) {
    const recipientPublic = fromBase64(recipient.identity_key);
    if (recipientPublic.length !== 32) throw new Error('Invalid recipient key');
    const shared = x25519.getSharedSecret(ephemeralPrivate, recipientPublic);
    const wrapNonce = randomBytes(24);
    const wrapped = xchacha20poly1305(wrappingKey(shared, ephemeralPublic, recipientPublic), wrapNonce, utf8Encode(recipient.device_id)).encrypt(contentKey);
    keys[recipient.device_id] = toBase64(concatBytes(wrapNonce, wrapped));
  }
  contentKey.fill(0);
  ephemeralPrivate.fill(0);

  const unsigned: Omit<Envelope, 'sig'> = {
    v: ENVELOPE_VERSION,
    alg: E2EE_ALG,
    sender: { user: sender.userId, device: sender.deviceId },
    eph: toBase64(ephemeralPublic),
    nonce: toBase64(nonce),
    ct: toBase64(ct),
    keys,
  };
  const sig = toBase64(ed25519.sign(transcript(unsigned, context), sender.keys.signingPrivate));
  return { ...unsigned, sig };
}

/**
 * Opens an envelope on one device. `senderSigningKey` is the Ed25519 public key
 * the directory reports for the sender's device; when it is unknown the content
 * is still returned but flagged `verified: false`.
 */
export function openEnvelope(params: { envelope: Envelope; context: EnvelopeContext; device: { deviceId: string; keys: DeviceKeyPair }; senderSigningKey: Uint8Array | null }): { ok: true; payload: Uint8Array; verified: boolean } | { ok: false; reason: OpenFailure } {
  const { envelope, context, device, senderSigningKey } = params;
  if (!envelope || envelope.v !== ENVELOPE_VERSION || envelope.alg !== E2EE_ALG || !envelope.sender || typeof envelope.keys !== 'object') {
    return { ok: false, reason: 'UNSUPPORTED' };
  }
  const wrappedB64 = envelope.keys[device.deviceId];
  if (!wrappedB64) return { ok: false, reason: 'NO_KEY_FOR_DEVICE' };

  let verified = false;
  if (senderSigningKey) {
    try {
      const { sig, ...unsigned } = envelope;
      verified = ed25519.verify(fromBase64(sig), transcript(unsigned, context), senderSigningKey);
    } catch {
      verified = false;
    }
    if (!verified) return { ok: false, reason: 'BAD_SIGNATURE' };
  }

  try {
    const ephemeralPublic = fromBase64(envelope.eph);
    const wrappedAll = fromBase64(wrappedB64);
    const shared = x25519.getSharedSecret(device.keys.identityPrivate, ephemeralPublic);
    const contentKey = xchacha20poly1305(wrappingKey(shared, ephemeralPublic, device.keys.identityPublic), wrappedAll.subarray(0, 24), utf8Encode(device.deviceId)).decrypt(wrappedAll.subarray(24));
    const payload = xchacha20poly1305(contentKey, fromBase64(envelope.nonce), contextAad(context, envelope.sender.user, envelope.sender.device)).decrypt(fromBase64(envelope.ct));
    contentKey.fill(0);
    return { ok: true, payload, verified };
  } catch {
    return { ok: false, reason: 'CORRUPT' };
  }
}

export function encodePayload(value: unknown): Uint8Array {
  return utf8Encode(JSON.stringify(value));
}

export function decodePayload<T>(bytes: Uint8Array): T {
  return JSON.parse(utf8Decode(bytes)) as T;
}

/**
 * Human-comparable fingerprint of one device: 12 groups of 5 digits derived
 * from the user id and both public keys. Two people compare these in person
 * (or over a call) to detect a swapped key.
 */
export function deviceFingerprint(userId: string, identityKey: string, signingKey: string): string {
  const material = concatBytes(utf8Encode(userId), fromBase64(identityKey), fromBase64(signingKey));
  let digest = sha256(material);
  for (let i = 0; i < 1024; i += 1) digest = sha256(concatBytes(digest, material));
  const second = sha256(concatBytes(utf8Encode('fingerprint-2'), digest));
  const bytes = concatBytes(digest, second); // 64 bytes → 12 chunks of 5 bytes
  const groups: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const chunk = bytes.subarray(i * 5, i * 5 + 5);
    let n = 0;
    for (const b of chunk) n = (n * 256 + b) % 100000;
    groups.push(String(n).padStart(5, '0'));
  }
  return groups.join(' ');
}

export function publicKeyToBase64(key: Uint8Array): string {
  return toBase64(key);
}
