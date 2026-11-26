/**
 * Platform I/O for encrypted attachments.
 *
 * - Android / iOS: files are streamed through expo-file-system handles one
 *   chunk (1 MiB) at a time, so even large videos never sit in JS memory.
 *   Decrypted copies live in the app's private cache directory.
 * - Web: files are processed as ArrayBuffers and exposed as blob: URLs.
 *
 * Ciphertext objects in Supabase Storage are opaque `application/octet-stream`
 * blobs; the keys to open them travel inside the message envelope.
 */
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Linking, Platform } from 'react-native';

import { AppError } from '@/utils/errors';

import { fromBase64, toArrayBuffer, toBase64 } from './bytes';
import { decryptFileBytes, encryptFileBytes, FILE_HEADER_BYTES, FileDecryptor, FileEncryptor, type FileKeyMaterial } from './files';
import { randomId } from './random';

const isWeb = Platform.OS === 'web';
const CHUNK = 1024 * 1024;

export interface SealedFile {
  /** Uploadable URI of the ciphertext (blob: on web, file:// natively). */
  uri: string;
  bytes: number;
  plainBytes: number;
  cleanup: () => Promise<void>;
}

export function materialFromSecret(secret: { key: string; nonce: string }): FileKeyMaterial {
  return { key: fromBase64(secret.key), nonce: fromBase64(secret.nonce) };
}

export function secretFromMaterial(material: FileKeyMaterial): { key: string; nonce: string } {
  return { key: toBase64(material.key), nonce: toBase64(material.nonce) };
}

function tooLarge(maxBytes: number): AppError {
  return new AppError(`This file is too large. Maximum size is ${Math.round(maxBytes / 1024 / 1024)} MB.`, 'file_too_large');
}

function cacheDir(): Directory {
  const dir = new Directory(Paths.cache, 'e2ee');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function safeDelete(file: File | null | undefined): void {
  try {
    if (file?.exists) file.delete();
  } catch {
    /* ignore */
  }
}

/** Makes sure we have a real file:// path for the input (copies content:// and friends into the cache). */
async function localInputFile(uri: string): Promise<{ file: File; temporary: boolean }> {
  try {
    const direct = new File(uri);
    if (direct.exists) return { file: direct, temporary: false };
  } catch {
    /* not a plain file path */
  }
  const response = await fetch(uri);
  if (!response.ok) throw new AppError('Could not read the selected file.');
  const copy = new File(cacheDir(), `in-${randomId(10)}`);
  await copy.write(new Uint8Array(await response.arrayBuffer()));
  return { file: copy, temporary: true };
}

/** Reads exactly `length` bytes (the native handle may return fewer per call). */
async function readExactly(handle: { readBytes: (length: number) => Promise<Uint8Array> }, length: number): Promise<Uint8Array> {
  const out = new Uint8Array(length);
  let filled = 0;
  while (filled < length) {
    const part = await handle.readBytes(length - filled);
    if (!part || part.length === 0) throw new Error('Unexpected end of file');
    out.set(part, filled);
    filled += part.length;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Encrypt a local file for upload
// ----------------------------------------------------------------------------
export async function encryptLocalFile(uri: string, material: FileKeyMaterial, maxBytes: number): Promise<SealedFile> {
  if (isWeb) {
    const response = await fetch(uri);
    if (!response.ok) throw new AppError('Could not read the selected file.');
    const blob = await response.blob();
    if (blob.size > maxBytes) throw tooLarge(maxBytes);
    const plain = new Uint8Array(await blob.arrayBuffer());
    const cipher = encryptFileBytes(plain, material);
    const url = URL.createObjectURL(new Blob([toArrayBuffer(cipher)], { type: 'application/octet-stream' }));
    return { uri: url, bytes: cipher.length, plainBytes: plain.length, cleanup: async () => URL.revokeObjectURL(url) };
  }

  const input = await localInputFile(uri);
  const plainBytes = input.file.size ?? 0;
  if (plainBytes > maxBytes) {
    if (input.temporary) safeDelete(input.file);
    throw tooLarge(maxBytes);
  }

  const out = new File(cacheDir(), `up-${randomId(10)}.bin`);
  out.create({ overwrite: true, intermediates: true });
  const encryptor = new FileEncryptor(material, CHUNK);
  try {
    const reader = input.file.open(FileMode.ReadOnly);
    const writer = out.open(FileMode.ReadWrite);
    try {
      await writer.writeBytes(encryptor.header());
      if (plainBytes === 0) {
        await writer.writeBytes(encryptor.encryptChunk(new Uint8Array(0), true));
      } else {
        for (let offset = 0; offset < plainBytes; ) {
          const length = Math.min(CHUNK, plainBytes - offset);
          const chunk = await readExactly(reader, length);
          offset += length;
          await writer.writeBytes(encryptor.encryptChunk(chunk, offset >= plainBytes));
        }
      }
    } finally {
      reader.close();
      writer.close();
    }
  } catch (error) {
    safeDelete(out);
    throw error;
  } finally {
    if (input.temporary) safeDelete(input.file);
  }
  return {
    uri: out.uri,
    bytes: out.size ?? 0,
    plainBytes,
    cleanup: async () => safeDelete(out),
  };
}

// ----------------------------------------------------------------------------
// Download + decrypt into a local URI (cached per object)
// ----------------------------------------------------------------------------
const decrypted = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

export async function decryptRemoteFile(url: string, material: FileKeyMaterial, options: { cacheName: string; mime: string; ext: string }): Promise<string> {
  const { cacheName, mime, ext } = options;
  const hit = decrypted.get(cacheName);
  if (hit) {
    if (isWeb) return hit;
    if (new File(hit).exists) return hit;
    decrypted.delete(cacheName);
  }
  const pending = inFlight.get(cacheName);
  if (pending) return pending;

  const task = (async () => {
    if (isWeb) {
      const response = await fetch(url);
      if (!response.ok) throw new AppError('Could not download the file.');
      const plain = decryptFileBytes(new Uint8Array(await response.arrayBuffer()), material);
      const blobUrl = URL.createObjectURL(new Blob([toArrayBuffer(plain)], { type: mime }));
      decrypted.set(cacheName, blobUrl);
      return blobUrl;
    }

    const dest = new File(cacheDir(), `${cacheName}.${ext}`);
    if (dest.exists && (dest.size ?? 0) > 0) {
      decrypted.set(cacheName, dest.uri);
      return dest.uri;
    }
    const temp = new File(cacheDir(), `${cacheName}.enc`);
    safeDelete(temp);
    const downloaded = await File.downloadFileAsync(url, temp, { idempotent: true });
    try {
      const total = downloaded.size ?? 0;
      if (total <= FILE_HEADER_BYTES) throw new Error('Truncated file');
      const decryptor = new FileDecryptor(material);
      dest.create({ overwrite: true, intermediates: true });
      const reader = downloaded.open(FileMode.ReadOnly);
      const writer = dest.open(FileMode.ReadWrite);
      try {
        const step = decryptor.readHeader(await readExactly(reader, FILE_HEADER_BYTES));
        for (let offset = FILE_HEADER_BYTES; offset < total; ) {
          const length = Math.min(step, total - offset);
          const chunk = await readExactly(reader, length);
          offset += length;
          await writer.writeBytes(decryptor.decryptChunk(chunk, offset >= total));
        }
        decryptor.assertFinished();
      } finally {
        reader.close();
        writer.close();
      }
    } catch (error) {
      safeDelete(dest);
      throw error;
    } finally {
      safeDelete(downloaded);
    }
    decrypted.set(cacheName, dest.uri);
    return dest.uri;
  })();
  inFlight.set(cacheName, task);
  try {
    return await task;
  } finally {
    inFlight.delete(cacheName);
  }
}

/** Opens / shares / downloads a decrypted local file with the platform's tools. */
export async function openLocalFile(uri: string, options: { mime: string; name: string | null }): Promise<void> {
  if (isWeb) {
    if (typeof document !== 'undefined') {
      const anchor = document.createElement('a');
      anchor.href = uri;
      anchor.download = options.name ?? 'file';
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return;
    }
    await Linking.openURL(uri);
    return;
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: options.mime, dialogTitle: options.name ?? undefined });
    return;
  }
  await Linking.openURL(uri);
}

/** Removes decrypted copies from the cache directory (used on sign-out). */
export async function clearDecryptedCache(): Promise<void> {
  decrypted.clear();
  if (isWeb) return;
  try {
    const dir = new Directory(Paths.cache, 'e2ee');
    if (dir.exists) dir.delete();
  } catch {
    /* ignore */
  }
}
