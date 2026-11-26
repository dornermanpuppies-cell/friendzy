import { Platform } from 'react-native';

import { VAPID_PUBLIC_KEY } from '@/constants/push';
import { supabase } from '@/lib/supabase';

/**
 * Web Push for the website / installed web app.
 *
 * The browser's push subscription (endpoint + keys) is stored in
 * `web_push_subscriptions`; the push-dispatch Edge Function encrypts every
 * notification for it (RFC 8291) and the service worker (public/sw.js) shows it,
 * even when no Friendzy tab is open.
 */
export type WebPushStatus = 'unsupported' | 'insecure' | 'default' | 'denied' | 'granted' | 'subscribed';

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function supported(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

/** Current browser-side state (no network). */
export async function getWebPushStatus(): Promise<WebPushStatus> {
  if (!supported()) return 'unsupported';
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') return 'insecure';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'default') return 'default';
  try {
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : 'granted';
  } catch {
    return 'granted';
  }
}

async function saveSubscription(userId: string, sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) throw new Error('The browser returned an incomplete push subscription.');
  const { error } = await supabase.from('web_push_subscriptions').upsert(
    { user_id: userId, endpoint: json.endpoint, p256dh, auth, user_agent: navigator.userAgent.slice(0, 200), last_seen_at: new Date().toISOString() },
    { onConflict: 'endpoint' },
  );
  if (error) throw error;
}

/**
 * Asks for permission (must be called from a user gesture the first time),
 * subscribes this browser and stores the subscription for the signed-in user.
 */
export async function enableWebPush(userId: string): Promise<WebPushStatus> {
  const status = await getWebPushStatus();
  if (status === 'unsupported' || status === 'insecure' || status === 'denied') return status;
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default';
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY) as BufferSource });
  await saveSubscription(userId, sub);
  return 'subscribed';
}

/**
 * Silent refresh on app start: when permission was granted earlier, make sure the
 * current subscription is stored for this user (handles browser key rotation and
 * a different account signing in on the same browser).
 */
export async function syncWebPush(userId: string): Promise<WebPushStatus> {
  const status = await getWebPushStatus();
  if (status !== 'granted' && status !== 'subscribed') return status;
  try {
    return await enableWebPush(userId);
  } catch (error) {
    console.warn('[push] web subscription refresh failed', error);
    return status;
  }
}

/** Removes this browser's subscription (sign-out / "turn off"). */
export async function disableWebPush(userId?: string | null): Promise<void> {
  if (!supported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => undefined);
    if (userId) await supabase.from('web_push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint);
  } catch (error) {
    console.warn('[push] web unsubscribe failed', error);
  }
}

/** Listens for the browser rotating the subscription behind our back. */
export function watchWebPushChanges(userId: string): () => void {
  if (!supported()) return () => undefined;
  const handler = (event: MessageEvent) => {
    if (event.data?.type === 'friendzy:pushsubscriptionchange') void syncWebPush(userId);
  };
  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}
