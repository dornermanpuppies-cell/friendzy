/**
 * Encrypted attachment format "FZE1" (chunked XChaCha20-Poly1305).
 *
 *   header : "FZE1" (4 bytes) || chunkSize uint32 big-endian (4 bytes)
 *   chunk i: XChaCha20-Poly1305(key, nonce_i, aad_i).encrypt(plainChunk_i)
 *            nonce_i = baseNonce (20 bytes) || i uint32 big-endian
 *            aad_i   = "FZE1|" + i + "|" + (isLast ? 1 : 0)
 *
 * Chunking keeps memory bounded on phones (1 MiB at a time) and the last-chunk
 * flag inside the AAD makes truncation or appended data detectable.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha';

import { concatBytes, readU32be, u32be, utf8Encode } from './bytes';
import { randomBytes } from './random';

export const FILE_MAGIC = Uint8Array.from([0x46, 0x5a, 0x45, 0x31]); // "FZE1"
export const FILE_HEADER_BYTES = 8;
export const FILE_TAG_BYTES = 16;
export const DEFAULT_CHUNK_BYTES = 1024 * 1024;

export interface FileKeyMaterial {
  key: Uint8Array; // 32 bytes
  nonce: Uint8Array; // 20-byte base nonce
}

export function newFileKey(): FileKeyMaterial {
  return { key: randomBytes(32), nonce: randomBytes(20) };
}

export function chunkNonce(baseNonce: Uint8Array, index: number): Uint8Array {
  if (baseNonce.length !== 20) throw new Error('Base nonce must be 20 bytes');
  return concatBytes(baseNonce, u32be(index));
}

export function chunkAad(index: number, isLast: boolean): Uint8Array {
  return utf8Encode(`FZE1|${index}|${isLast ? 1 : 0}`);
}

export function ciphertextLength(plainLength: number, chunkBytes = DEFAULT_CHUNK_BYTES): number {
  const chunks = Math.max(1, Math.ceil(plainLength / chunkBytes));
  return FILE_HEADER_BYTES + plainLength + chunks * FILE_TAG_BYTES;
}

/** Incremental encryptor: feed plaintext chunks of exactly `chunkBytes` (the last one may be shorter). */
export class FileEncryptor {
  private index = 0;
  private finished = false;

  constructor(
    private readonly material: FileKeyMaterial,
    readonly chunkBytes = DEFAULT_CHUNK_BYTES,
  ) {
    if (material.key.length !== 32) throw new Error('File key must be 32 bytes');
  }

  header(): Uint8Array {
    return concatBytes(FILE_MAGIC, u32be(this.chunkBytes));
  }

  encryptChunk(plain: Uint8Array, isLast: boolean): Uint8Array {
    if (this.finished) throw new Error('Encryptor already finished');
    if (plain.length > this.chunkBytes) throw new Error('Chunk too large');
    const out = xchacha20poly1305(this.material.key, chunkNonce(this.material.nonce, this.index), chunkAad(this.index, isLast)).encrypt(plain);
    this.index += 1;
    if (isLast) this.finished = true;
    return out;
  }
}

/** Incremental decryptor: feed ciphertext chunks of `chunkBytes + 16` (the last one may be shorter). */
export class FileDecryptor {
  private index = 0;
  private finished = false;
  chunkBytes = DEFAULT_CHUNK_BYTES;

  constructor(private readonly material: FileKeyMaterial) {
    if (material.key.length !== 32) throw new Error('File key must be 32 bytes');
  }

  /** Parses the 8-byte header and returns the ciphertext chunk length to read per step. */
  readHeader(header: Uint8Array): number {
    if (header.length < FILE_HEADER_BYTES || header[0] !== FILE_MAGIC[0] || header[1] !== FILE_MAGIC[1] || header[2] !== FILE_MAGIC[2] || header[3] !== FILE_MAGIC[3]) {
      throw new Error('Not an encrypted Friendzy file');
    }
    const size = readU32be(header, 4);
    if (size < 1024 || size > 16 * 1024 * 1024) throw new Error('Unsupported chunk size');
    this.chunkBytes = size;
    return size + FILE_TAG_BYTES;
  }

  decryptChunk(cipher: Uint8Array, isLast: boolean): Uint8Array {
    if (this.finished) throw new Error('Data after the final chunk');
    if (cipher.length < FILE_TAG_BYTES) throw new Error('Truncated chunk');
    const out = xchacha20poly1305(this.material.key, chunkNonce(this.material.nonce, this.index), chunkAad(this.index, isLast)).decrypt(cipher);
    this.index += 1;
    if (isLast) this.finished = true;
    return out;
  }

  assertFinished(): void {
    if (!this.finished) throw new Error('Truncated file');
  }
}

/** Whole-buffer helpers (web, tests and small files). */
export function encryptFileBytes(plain: Uint8Array, material: FileKeyMaterial, chunkBytes = DEFAULT_CHUNK_BYTES): Uint8Array {
  const enc = new FileEncryptor(material, chunkBytes);
  const parts: Uint8Array[] = [enc.header()];
  const chunks = Math.max(1, Math.ceil(plain.length / chunkBytes));
  for (let i = 0; i < chunks; i += 1) {
    parts.push(enc.encryptChunk(plain.subarray(i * chunkBytes, Math.min(plain.length, (i + 1) * chunkBytes)), i === chunks - 1));
  }
  return concatBytes(...parts);
}

export function decryptFileBytes(cipher: Uint8Array, material: FileKeyMaterial): Uint8Array {
  const dec = new FileDecryptor(material);
  const step = dec.readHeader(cipher.subarray(0, FILE_HEADER_BYTES));
  const parts: Uint8Array[] = [];
  let offset = FILE_HEADER_BYTES;
  if (cipher.length <= FILE_HEADER_BYTES) throw new Error('Truncated file');
  while (offset < cipher.length) {
    const end = Math.min(cipher.length, offset + step);
    parts.push(dec.decryptChunk(cipher.subarray(offset, end), end === cipher.length));
    offset = end;
  }
  dec.assertFinished();
  return concatBytes(...parts);
}
