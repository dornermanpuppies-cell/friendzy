import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

export type PushRegistrationResult = 'registered' | 'denied' | 'unsupported' | 'no_project_id' | 'simulator' | 'no_firebase' | 'error';

/** Last outcome of registerForPush on this device (shown in Settings → Notifications). */
export let lastPushRegistration: { result: PushRegistrationResult; detail?: string } | null = null;

export const PUSH_RESULT_LABEL: Record<PushRegistrationResult, string> = {
  registered: 'This device receives push notifications.',
  denied: 'Notifications are blocked for Friendzy in the system settings. Allow them there to receive pushes.',
  unsupported: 'Push notifications are not supported here.',
  no_project_id: 'This build has no Expo project id, so it cannot register for push.',
  simulator: 'Push notifications only work on a real phone, not in an emulator.',
  no_firebase: 'This build was made without the Firebase configuration (google-services.json), so Android cannot receive pushes yet.',
  error: 'Push registration failed. Pull to retry; if it keeps failing, reinstall the app.',
};

let handlerInstalled = false;

/** Show notifications while the app is in the foreground. */
export function installNotificationHandler(): void {
  if (handlerInstalled || Platform.OS === 'web') return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

function projectId(): string | undefined {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  const fromEas = (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  return fromExtra || fromEas || undefined;
}

/**
 * Requests permission, obtains the Expo push token and stores it in
 * public.user_devices for the signed-in user. Honest about why it could not
 * register (web, simulator, missing EAS project id, permission denied).
 */
export async function registerForPush(userId: string): Promise<PushRegistrationResult> {
  if (Platform.OS === 'web') return 'unsupported';
  if (!Device.isDevice) {
    lastPushRegistration = { result: 'simulator' };
    return 'simulator';
  }
  const id = projectId();
  if (!id) {
    lastPushRegistration = { result: 'no_project_id' };
    return 'no_project_id';
  }
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Friendzy', importance: AndroidImportance.MAX, vibrationPattern: [0, 250, 250, 250], lightColor: '#7000FF' });
      await Notifications.setNotificationChannelAsync('messages', { name: 'Messages', importance: AndroidImportance.MAX, vibrationPattern: [0, 200, 100, 200], lightColor: '#7000FF' });
      await Notifications.setNotificationChannelAsync('calls', { name: 'Calls', importance: AndroidImportance.MAX, vibrationPattern: [0, 400, 200, 400, 200, 400], lightColor: '#FF28B9' });
    }
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') {
      lastPushRegistration = { result: 'denied' };
      return 'denied';
    }
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
    const deviceName = [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || null;
    const appVersion = Constants.expoConfig?.version ?? null;
    const { data: existingRow } = await supabase.from('user_devices').select('id').eq('user_id', userId).eq('push_token', token).maybeSingle();
    if (existingRow) {
      await supabase.from('user_devices').update({ last_active_at: new Date().toISOString(), device_name: deviceName, app_version: appVersion }).eq('id', existingRow.id);
    } else {
      await supabase.from('user_devices').insert({ user_id: userId, platform: Platform.OS === 'ios' ? 'ios' : 'android', push_token: token, device_name: deviceName, app_version: appVersion });
    }
    lastPushRegistration = { result: 'registered' };
    return 'registered';
  } catch (error) {
    console.warn('[push] registration failed', error);
    const message = error instanceof Error ? error.message : String(error);
    // Android without google-services.json: Firebase is not initialised, so there is no device token to exchange.
    const noFirebase = /FirebaseApp|google-services|FCM|Firebase/i.test(message);
    lastPushRegistration = { result: noFirebase ? 'no_firebase' : 'error', detail: message };
    return noFirebase ? 'no_firebase' : 'error';
  }
}

/** Removes this device's push token (sign-out). */
export async function unregisterPush(userId: string): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  try {
    const id = projectId();
    if (!id) return;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
    await supabase.from('user_devices').delete().eq('user_id', userId).eq('push_token', token);
  } catch {
    /* ignore */
  }
}

/** URL inside a notification payload (set by the push-dispatch function). */
export function urlFromNotification(response: Notifications.NotificationResponse): string | null {
  const data = response.notification.request.content.data as { url?: unknown } | undefined;
  return typeof data?.url === 'string' ? data.url : null;
}
