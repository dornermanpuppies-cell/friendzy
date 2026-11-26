import * as ExpoCrypto from 'expo-crypto';

/**
 * Cryptographically secure random bytes on every platform:
 * - browsers / Node: WebCrypto `getRandomValues`
 * - Android / iOS (Hermes has no WebCrypto global): expo-crypto's native RNG
 */
export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  const webCrypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    // Browsers cap a single call at 65536 bytes.
    for (let offset = 0; offset < length; offset += 65536) {
      webCrypto.getRandomValues(out.subarray(offset, Math.min(length, offset + 65536)));
    }
    return out;
  }
  if (typeof ExpoCrypto.getRandomValues === 'function') {
    ExpoCrypto.getRandomValues(out);
    return out;
  }
  if (typeof ExpoCrypto.getRandomBytes === 'function') {
    out.set(ExpoCrypto.getRandomBytes(length));
    return out;
  }
  throw new Error('No secure random number generator is available on this device.');
}

export function randomId(bytes = 16): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const raw = randomBytes(bytes);
  let out = '';
  for (let i = 0; i < raw.length; i += 1) out += alphabet[raw[i] % alphabet.length];
  return out;
}
