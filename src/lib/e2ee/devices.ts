/**
 * Device identity, the public-key directory and trust-on-first-use pins.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { useE2eeStore } from '@/store/e2eeStore';
import { AppError } from '@/utils/errors';

import { fromBase64, toBase64 } from './bytes';
import { deviceFingerprint, generateDeviceKeys, type DeviceKeyPair } from './crypto';
import { deleteStoredDevice, keyStorageKind, loadStoredDevice, saveStoredDevice, type KeyStorageKind, type StoredDevice } from './keystore';
import { randomId } from './random';

export interface E2eeDeviceInfo {
  user_id: string;
  device_id: string;
  platform: 'android' | 'ios' | 'web';
  name: string | null;
  identity_key: string;
  signing_key: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

export interface LocalDevice {
  userId: string;
  deviceId: string;
  keys: DeviceKeyPair;
  identityKey: string;
  signingKey: string;
  createdAt: string;
  storage: KeyStorageKind;
}

export interface RecipientSet {
  members: string[];
  devices: E2eeDeviceInfo[];
  /** Members without a single registered device: nobody can encrypt for them yet. */
  missing: string[];
}

export interface PinRecord {
  identity_key: string;
  signing_key: string;
  first_seen: string;
  verified: boolean;
}

const RECIPIENTS_TTL_MS = 45_000;
const DIRECTORY_TTL_MS = 5 * 60_000;

let local: LocalDevice | null = null;
let setup: { userId: string; promise: Promise<LocalDevice> } | null = null;
const recipientsCache = new Map<string, { at: number; value: RecipientSet }>();
const directoryCache = new Map<string, { at: number; devices: E2eeDeviceInfo[] }>();
let pins: { ownerId: string; map: Record<string, Record<string, PinRecord>> } | null = null;

// ----------------------------------------------------------------------------
// This device
// ----------------------------------------------------------------------------
function browserLabel(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export function describeThisDevice(): string {
  if (Platform.OS === 'web') return browserLabel();
  return [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || (Platform.OS === 'ios' ? 'iPhone' : 'Android phone');
}

function toLocal(stored: StoredDevice): LocalDevice {
  return {
    userId: stored.userId,
    deviceId: stored.deviceId,
    keys: {
      identityPublic: fromBase64(stored.identityPublic),
      identityPrivate: fromBase64(stored.identityPrivate),
      signingPublic: fromBase64(stored.signingPublic),
      signingPrivate: fromBase64(stored.signingPrivate),
    },
    identityKey: stored.identityPublic,
    signingKey: stored.signingPublic,
    createdAt: stored.createdAt,
    storage: keyStorageKind(),
  };
}

function freshStoredDevice(userId: string): StoredDevice {
  const keys = generateDeviceKeys();
  return {
    v: 1,
    userId,
    deviceId: `${Platform.OS === 'web' ? 'web' : Platform.OS}-${randomId(20)}`,
    identityPublic: toBase64(keys.identityPublic),
    identityPrivate: toBase64(keys.identityPrivate),
    signingPublic: toBase64(keys.signingPublic),
    signingPrivate: toBase64(keys.signingPrivate),
    createdAt: new Date().toISOString(),
  };
}

async function registerWithServer(stored: StoredDevice): Promise<void> {
  const { error } = await supabase.rpc('register_e2ee_device', {
    p_device_id: stored.deviceId,
    p_platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
    p_identity_key: stored.identityPublic,
    p_signing_key: stored.signingPublic,
    p_name: `${describeThisDevice()}${Constants.expoConfig?.version ? ` · Friendzy ${Constants.expoConfig.version}` : ''}`.slice(0, 80),
  });
  if (error) throw error;
}

function errorCode(error: unknown): string {
  const e = error as { message?: string; hint?: string } | null;
  return `${e?.message ?? ''} ${e?.hint ?? ''}`;
}

/**
 * Loads (or creates) this device's key pair for the signed-in user and makes
 * sure the server directory knows its public keys. Safe to call repeatedly.
 */
export function ensureLocalDevice(userId: string): Promise<LocalDevice> {
  if (local && local.userId === userId) return Promise.resolve(local);
  if (setup && setup.userId === userId) return setup.promise;
  const promise = (async () => {
    useE2eeStore.getState().setStatus('setting_up');
    try {
      let stored = await loadStoredDevice(userId);
      if (!stored) {
        stored = freshStoredDevice(userId);
        await saveStoredDevice(stored);
      }
      try {
        await registerWithServer(stored);
      } catch (error) {
        const code = errorCode(error);
        if (/DEVICE_REVOKED|DEVICE_ID_TAKEN/.test(code)) {
          // Someone removed this device (or the id collided): start a fresh identity.
          await deleteStoredDevice(userId);
          stored = freshStoredDevice(userId);
          await saveStoredDevice(stored);
          await registerWithServer(stored);
        } else {
          throw error;
        }
      }
      local = toLocal(stored);
      useE2eeStore.getState().setStatus('ready', { deviceId: local.deviceId, error: null });
      return local;
    } catch (error) {
      useE2eeStore.getState().setStatus('error', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      setup = null;
    }
  })();
  setup = { userId, promise };
  return promise;
}

export function getLocalDevice(): LocalDevice | null {
  return local;
}

/** Forget the in-memory identity (keys stay in secure storage for the next sign-in). */
export function resetLocalDevice(): void {
  local = null;
  setup = null;
  recipientsCache.clear();
  directoryCache.clear();
  pins = null;
  useE2eeStore.getState().reset();
}

export function myFingerprint(): string | null {
  return local ? deviceFingerprint(local.userId, local.identityKey, local.signingKey) : null;
}

export function fingerprintOf(device: Pick<E2eeDeviceInfo, 'user_id' | 'identity_key' | 'signing_key'>): string {
  return deviceFingerprint(device.user_id, device.identity_key, device.signing_key);
}

// ----------------------------------------------------------------------------
// Directory
// ----------------------------------------------------------------------------
function asDevices(data: unknown): E2eeDeviceInfo[] {
  return Array.isArray(data) ? (data as E2eeDeviceInfo[]) : [];
}

export async function getUserDevices(userId: string, options: { force?: boolean } = {}): Promise<E2eeDeviceInfo[]> {
  const cached = directoryCache.get(userId);
  if (!options.force && cached && Date.now() - cached.at < DIRECTORY_TTL_MS) return cached.devices;
  const { data, error } = await supabase.rpc('e2ee_user_devices', { p_user: userId });
  if (error) throw error;
  const devices = asDevices(data);
  directoryCache.set(userId, { at: Date.now(), devices });
  await recordPins(userId, devices);
  return devices;
}

/** Signing key for the device that sealed a message (refreshes the directory once on a miss). */
export async function findSenderDevice(userId: string, deviceId: string): Promise<E2eeDeviceInfo | null> {
  const hit = (list: E2eeDeviceInfo[]) => list.find((d) => d.device_id === deviceId) ?? null;
  const cached = directoryCache.get(userId);
  if (cached) {
    const found = hit(cached.devices);
    if (found) return found;
  }
  try {
    return hit(await getUserDevices(userId, { force: !cached || Date.now() - cached.at > 10_000 }));
  } catch {
    return cached ? hit(cached.devices) : null;
  }
}

export async function getRecipients(conversationId: string, options: { force?: boolean } = {}): Promise<RecipientSet> {
  const cached = recipientsCache.get(conversationId);
  if (!options.force && cached && Date.now() - cached.at < RECIPIENTS_TTL_MS) return cached.value;
  const { data, error } = await supabase.rpc('e2ee_recipients', { p_conversation: conversationId });
  if (error) throw error;
  const raw = (data ?? {}) as { members?: string[]; devices?: E2eeDeviceInfo[] };
  const members = Array.isArray(raw.members) ? raw.members : [];
  const devices = asDevices(raw.devices);
  const withKeys = new Set(devices.map((d) => d.user_id));
  const value: RecipientSet = { members, devices, missing: members.filter((id) => !withKeys.has(id)) };
  recipientsCache.set(conversationId, { at: Date.now(), value });
  const byUser = new Map<string, E2eeDeviceInfo[]>();
  for (const d of devices) byUser.set(d.user_id, [...(byUser.get(d.user_id) ?? []), d]);
  for (const [userId, list] of byUser) {
    directoryCache.set(userId, { at: Date.now(), devices: mergeDirectory(directoryCache.get(userId)?.devices ?? [], list) });
    await recordPins(userId, list);
  }
  return value;
}

function mergeDirectory(existing: E2eeDeviceInfo[], fresh: E2eeDeviceInfo[]): E2eeDeviceInfo[] {
  const map = new Map(existing.map((d) => [d.device_id, d]));
  for (const d of fresh) map.set(d.device_id, d);
  return [...map.values()];
}

export function invalidateRecipients(conversationId?: string): void {
  if (conversationId) recipientsCache.delete(conversationId);
  else recipientsCache.clear();
}

export async function listMyDevices(): Promise<E2eeDeviceInfo[]> {
  const { data, error } = await supabase.rpc('get_e2ee_devices');
  if (error) throw error;
  return asDevices(data);
}

export async function revokeDevice(deviceId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_e2ee_device', { p_device_id: deviceId });
  if (error) throw error;
  recipientsCache.clear();
  if (local) directoryCache.delete(local.userId);
}

// ----------------------------------------------------------------------------
// Trust pins (trust on first use; changes are surfaced to the user)
// ----------------------------------------------------------------------------
const pinsKey = (ownerId: string) => `friendzy.e2ee.pins.v1.${ownerId}`;

async function loadPins(ownerId: string): Promise<Record<string, Record<string, PinRecord>>> {
  if (pins && pins.ownerId === ownerId) return pins.map;
  let map: Record<string, Record<string, PinRecord>> = {};
  try {
    const raw = await AsyncStorage.getItem(pinsKey(ownerId));
    if (raw) map = JSON.parse(raw) as Record<string, Record<string, PinRecord>>;
  } catch {
    map = {};
  }
  pins = { ownerId, map };
  return map;
}

async function persistPins(): Promise<void> {
  if (!pins) return;
  try {
    await AsyncStorage.setItem(pinsKey(pins.ownerId), JSON.stringify(pins.map));
  } catch (error) {
    console.warn('[e2ee] could not persist trust pins', error);
  }
}

export async function recordPins(userId: string, devices: E2eeDeviceInfo[]): Promise<void> {
  const owner = local?.userId;
  if (!owner || userId === owner) return;
  const map = await loadPins(owner);
  const known = map[userId] ?? {};
  const hadPins = Object.keys(known).length > 0;
  let changed = false;
  let notice: 'new_device' | 'key_changed' | null = null;
  for (const d of devices) {
    if (d.revoked_at) continue;
    const pin = known[d.device_id];
    if (!pin) {
      known[d.device_id] = { identity_key: d.identity_key, signing_key: d.signing_key, first_seen: new Date().toISOString(), verified: false };
      changed = true;
      if (hadPins) notice = notice ?? 'new_device';
    } else if (pin.identity_key !== d.identity_key || pin.signing_key !== d.signing_key) {
      known[d.device_id] = { identity_key: d.identity_key, signing_key: d.signing_key, first_seen: new Date().toISOString(), verified: false };
      changed = true;
      notice = 'key_changed';
    }
  }
  if (changed) {
    map[userId] = known;
    await persistPins();
  }
  if (notice) useE2eeStore.getState().setNotice(userId, { kind: notice, at: Date.now() });
}

export async function getPins(userId: string): Promise<Record<string, PinRecord>> {
  const owner = local?.userId;
  if (!owner) return {};
  return (await loadPins(owner))[userId] ?? {};
}

export async function setDeviceVerified(userId: string, deviceId: string, verified: boolean): Promise<void> {
  const owner = local?.userId;
  if (!owner) throw new AppError('Encryption is not ready yet.', 'E2EE_NOT_READY');
  const map = await loadPins(owner);
  const pin = map[userId]?.[deviceId];
  if (!pin) return;
  pin.verified = verified;
  await persistPins();
}
