import { concatBytes, fromBase64, toBase64, utf8Decode, utf8Encode } from '../bytes';
import { decodePayload, deviceFingerprint, encodePayload, generateDeviceKeys, openEnvelope, sealEnvelope, type Envelope } from '../crypto';
import { ciphertextLength, decryptFileBytes, encryptFileBytes, FileDecryptor, FileEncryptor, newFileKey } from '../files';

const context = { conversationId: 'conv-1', kind: 'text' };

function device(userId: string, deviceId: string) {
  const keys = generateDeviceKeys();
  return { userId, deviceId, keys, recipient: { device_id: deviceId, identity_key: toBase64(keys.identityPublic), signing_key: toBase64(keys.signingPublic) } };
}

describe('bytes', () => {
  it('round-trips base64 and utf8 (including emoji and astral characters)', () => {
    const text = 'Hey Bob! 👋 — café ñ 🇨🇲 𝄞';
    const bytes = utf8Encode(text);
    expect(utf8Decode(bytes)).toBe(text);
    expect(new TextDecoder().decode(bytes)).toBe(text);
    expect(Array.from(bytes)).toEqual(Array.from(new TextEncoder().encode(text)));
    expect(toBase64(bytes)).toBe(btoa(String.fromCharCode(...bytes)));
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
    for (const len of [0, 1, 2, 3, 4, 31, 32, 33]) {
      const sample = Uint8Array.from({ length: len }, (_, i) => (i * 37) % 256);
      expect(Array.from(fromBase64(toBase64(sample)))).toEqual(Array.from(sample));
    }
  });

  it('rejects malformed base64', () => {
    expect(() => fromBase64('abc')).toThrow();
    expect(() => fromBase64('ab$c')).toThrow();
  });
});

describe('sealed envelopes', () => {
  const alice = device('alice', 'alice-dev-1');
  const alicePhone = device('alice', 'alice-dev-2');
  const bob = device('bob', 'bob-dev-1');
  const recipients = [alice.recipient, alicePhone.recipient, bob.recipient];

  it('encrypts for every device and decrypts with signature verification', () => {
    const payload = encodePayload({ text: 'secret plan 🤫', metadata: {}, attachments: [] });
    const env = sealEnvelope({ payload, context, sender: alice, recipients });
    expect(env.v).toBe(1);
    expect(Object.keys(env.keys).sort()).toEqual(['alice-dev-1', 'alice-dev-2', 'bob-dev-1']);
    expect(env.ct).not.toContain('secret');

    for (const reader of [alice, alicePhone, bob]) {
      const opened = openEnvelope({ envelope: env, context, device: reader, senderSigningKey: alice.keys.signingPublic });
      expect(opened.ok).toBe(true);
      if (opened.ok) {
        expect(opened.verified).toBe(true);
        expect(decodePayload<{ text: string }>(opened.payload).text).toBe('secret plan 🤫');
      }
    }
  });

  it('does not reveal the content to devices without a wrapped key', () => {
    const eve = device('eve', 'eve-dev-1');
    const env = sealEnvelope({ payload: encodePayload({ text: 'x' }), context, sender: alice, recipients });
    const opened = openEnvelope({ envelope: env, context, device: eve, senderSigningKey: alice.keys.signingPublic });
    expect(opened).toEqual({ ok: false, reason: 'NO_KEY_FOR_DEVICE' });
  });

  it('detects tampering with ciphertext, keys, sender or the bound context', () => {
    const env = sealEnvelope({ payload: encodePayload({ text: 'x' }), context, sender: alice, recipients });
    const flip = (b64: string) => {
      const bytes = fromBase64(b64);
      bytes[0] ^= 1;
      return toBase64(bytes);
    };
    const cases: { label: string; envelope: Envelope; ctx?: typeof context; reason: string }[] = [
      { label: 'ciphertext', envelope: { ...env, ct: flip(env.ct) }, reason: 'BAD_SIGNATURE' },
      { label: 'wrapped key', envelope: { ...env, keys: { ...env.keys, 'bob-dev-1': flip(env.keys['bob-dev-1']) } }, reason: 'BAD_SIGNATURE' },
      { label: 'sender device', envelope: { ...env, sender: { ...env.sender, device: 'alice-dev-2' } }, reason: 'BAD_SIGNATURE' },
      { label: 'moved to another conversation', envelope: env, ctx: { conversationId: 'conv-2', kind: 'text' }, reason: 'BAD_SIGNATURE' },
      { label: 'kind changed', envelope: env, ctx: { conversationId: 'conv-1', kind: 'image' }, reason: 'BAD_SIGNATURE' },
      { label: 'signature', envelope: { ...env, sig: flip(env.sig) }, reason: 'BAD_SIGNATURE' },
    ];
    for (const c of cases) {
      const opened = openEnvelope({ envelope: c.envelope, context: c.ctx ?? context, device: bob, senderSigningKey: alice.keys.signingPublic });
      expect({ label: c.label, ...opened }).toEqual({ label: c.label, ok: false, reason: c.reason });
    }
  });

  it('a forged signature from a different key is rejected, and unsigned-unknown senders are flagged unverified', () => {
    const env = sealEnvelope({ payload: encodePayload({ text: 'x' }), context, sender: alice, recipients });
    const wrongKey = openEnvelope({ envelope: env, context, device: bob, senderSigningKey: bob.keys.signingPublic });
    expect(wrongKey).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    const unknown = openEnvelope({ envelope: env, context, device: bob, senderSigningKey: null });
    expect(unknown.ok).toBe(true);
    if (unknown.ok) expect(unknown.verified).toBe(false);
  });

  it('even with a valid signature, a tampered wrapped key or ciphertext fails authentication', () => {
    // Simulate an attacker who controls the sender's signing key but not the AEAD keys.
    const env = sealEnvelope({ payload: encodePayload({ text: 'x' }), context, sender: alice, recipients });
    const bytes = fromBase64(env.ct);
    bytes[bytes.length - 1] ^= 1;
    const tampered = { ...env, ct: toBase64(bytes) };
    const opened = openEnvelope({ envelope: tampered, context, device: bob, senderSigningKey: null });
    expect(opened).toEqual({ ok: false, reason: 'CORRUPT' });
  });

  it('refuses to seal without the sending device among the recipients', () => {
    expect(() => sealEnvelope({ payload: new Uint8Array(1), context, sender: alice, recipients: [bob.recipient] })).toThrow();
  });

  it('fingerprints are stable, 60 digits, and differ per device', () => {
    const fp = deviceFingerprint('alice', alice.recipient.identity_key, alice.recipient.signing_key);
    expect(fp).toMatch(/^(\d{5} ){11}\d{5}$/);
    expect(deviceFingerprint('alice', alice.recipient.identity_key, alice.recipient.signing_key)).toBe(fp);
    expect(deviceFingerprint('alice', alicePhone.recipient.identity_key, alicePhone.recipient.signing_key)).not.toBe(fp);
  });
});

describe('encrypted files (FZE1)', () => {
  const material = newFileKey();

  it('round-trips empty, small, exact-multiple and multi-chunk files', () => {
    for (const len of [0, 1, 1000, 4096, 4097, 3 * 4096, 3 * 4096 + 5]) {
      const plain = Uint8Array.from({ length: len }, (_, i) => (i * 131 + 7) % 256);
      const cipher = encryptFileBytes(plain, material, 4096);
      expect(cipher.length).toBe(ciphertextLength(len, 4096));
      expect(Array.from(decryptFileBytes(cipher, material))).toEqual(Array.from(plain));
    }
  });

  it('detects truncation, appended data, bit flips and a wrong key', () => {
    const plain = Uint8Array.from({ length: 3 * 4096 }, (_, i) => i % 256);
    const cipher = encryptFileBytes(plain, material, 4096);
    expect(() => decryptFileBytes(cipher.subarray(0, cipher.length - 4096 - 16), material)).toThrow(); // one whole chunk cut
    expect(() => decryptFileBytes(cipher.subarray(0, cipher.length - 3), material)).toThrow(); // partial cut
    expect(() => decryptFileBytes(concatBytes(cipher, new Uint8Array(40)), material)).toThrow(); // appended
    const flipped = cipher.slice();
    flipped[100] ^= 1;
    expect(() => decryptFileBytes(flipped, material)).toThrow();
    expect(() => decryptFileBytes(cipher, newFileKey())).toThrow();
    expect(() => decryptFileBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), material)).toThrow('Not an encrypted Friendzy file');
  });

  it('streams chunk by chunk with the same result as the whole-buffer helper', () => {
    const plain = Uint8Array.from({ length: 10000 }, (_, i) => (i * 7) % 256);
    const enc = new FileEncryptor(material, 4096);
    const parts = [enc.header()];
    for (let i = 0; i < 3; i += 1) parts.push(enc.encryptChunk(plain.subarray(i * 4096, Math.min(10000, (i + 1) * 4096)), i === 2));
    const cipher = concatBytes(...parts);
    expect(Array.from(cipher)).toEqual(Array.from(encryptFileBytes(plain, material, 4096)));

    const dec = new FileDecryptor(material);
    const step = dec.readHeader(cipher.subarray(0, 8));
    const out: Uint8Array[] = [];
    let offset = 8;
    while (offset < cipher.length) {
      const end = Math.min(cipher.length, offset + step);
      out.push(dec.decryptChunk(cipher.subarray(offset, end), end === cipher.length));
      offset = end;
    }
    dec.assertFinished();
    expect(Array.from(concatBytes(...out))).toEqual(Array.from(plain));
  });
});
