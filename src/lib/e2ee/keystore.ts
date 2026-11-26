/**
 * Where this device's private keys live.
 *
 * - Android / iOS: encrypted with a random AES key held in the platform
 *   keychain / keystore (see lib/secureStorage.ts) — same mechanism as the
 *   Supabase session.
 * - Web: IndexedDB, encrypted with a non-extractable WebCrypto AES-GCM key that
 *   is itself stored in IndexedDB. Scripts can use the key but cannot export it.
 * - Web without IndexedDB/WebCrypto (very old or locked-down browsers): plain
 *   localStorage, reported to the user as such in Settings → Encryption.
 *
 * Keys never leave the device. Signing out keeps them (so signing back in on
 * the same device keeps the same identity); deleting the app/site data removes them.
 */
import { Platform } from 'react-native';

import { largeSecureStore } from '@/lib/secureStorage';

import { toArrayBuffer, utf8Decode, utf8Encode } from './bytes';
import { randomBytes } from './random';

export interface StoredDevice {
  v: 1;
  userId: string;
  deviceId: string;
  identityPublic: string;
  identityPrivate: string;
  signingPublic: string;
  signingPrivate: string;
  createdAt: string;
}

export type KeyStorageKind = 'keychain' | 'indexeddb' | 'localstorage';

const DB_NAME = 'friendzy-e2ee';
const STORE = 'devices';
const storageKey = (userId: string) => `friendzy.e2ee.device.v1.${userId}`;

type WebRecord = { wrapKey: CryptoKey; iv: Uint8Array; data: ArrayBuffer };

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && Boolean(crypto.subtle);
}

export function keyStorageKind(): KeyStorageKind {
  if (Platform.OS !== 'web') return 'keychain';
  return hasIndexedDb() ? 'indexeddb' : 'localstorage';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

async function idbGet(key: string): Promise<WebRecord | undefined> {
  const db = await openDb();
  try {
    return await idbRequest(db.transaction(STORE, 'readonly').objectStore(STORE).get(key) as IDBRequest<WebRecord | undefined>);
  } finally {
    db.close();
  }
}

async function idbPut(key: string, value: WebRecord): Promise<void> {
  const db = await openDb();
  try {
    await idbRequest(db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key));
  } finally {
    db.close();
  }
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  try {
    await idbRequest(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key));
  } finally {
    db.close();
  }
}

function localStorageSafe(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export async function loadStoredDevice(userId: string): Promise<StoredDevice | null> {
  const key = storageKey(userId);
  try {
    if (Platform.OS !== 'web') {
      const raw = await largeSecureStore.getItem(key);
      return raw ? (JSON.parse(raw) as StoredDevice) : null;
    }
    if (hasIndexedDb()) {
      const record = await idbGet(key);
      if (!record) return null;
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(record.iv) }, record.wrapKey, record.data);
      return JSON.parse(utf8Decode(new Uint8Array(plain))) as StoredDevice;
    }
    const raw = localStorageSafe()?.getItem(key);
    return raw ? (JSON.parse(raw) as StoredDevice) : null;
  } catch (error) {
    console.warn('[e2ee] could not load device keys; a new identity will be created', error);
    return null;
  }
}

export async function saveStoredDevice(device: StoredDevice): Promise<void> {
  const key = storageKey(device.userId);
  const json = JSON.stringify(device);
  if (Platform.OS !== 'web') {
    await largeSecureStore.setItem(key, json);
    return;
  }
  if (hasIndexedDb()) {
    const existing = await idbGet(key);
    const wrapKey = existing?.wrapKey ?? (await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
    const iv = randomBytes(12);
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, wrapKey, toArrayBuffer(utf8Encode(json)));
    await idbPut(key, { wrapKey, iv, data });
    return;
  }
  const storage = localStorageSafe();
  if (!storage) throw new Error('E2EE_UNAVAILABLE');
  storage.setItem(key, json);
}

export async function deleteStoredDevice(userId: string): Promise<void> {
  const key = storageKey(userId);
  if (Platform.OS !== 'web') {
    await largeSecureStore.removeItem(key);
    return;
  }
  if (hasIndexedDb()) {
    await idbDelete(key).catch(() => undefined);
  }
  localStorageSafe()?.removeItem(key);
}
