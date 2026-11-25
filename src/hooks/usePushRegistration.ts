import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { installNotificationHandler, registerForPush, urlFromNotification } from '@/services/push';

/**
 * Registers the device for push notifications once the user is signed in and
 * navigates to the deep link carried by tapped notifications.
 */
export function usePushRegistration(userId: string | undefined): void {
  useEffect(() => {
    if (!userId || Platform.OS === 'web') return;
    installNotificationHandler();
    void registerForPush(userId).then((result) => {
      if (result !== 'registered' && __DEV__) console.info(`[push] not registered: ${result}`);
    });
    const open = (url: string | null) => {
      if (url) router.push(url as never);
    };
    const sub = Notifications.addNotificationResponseReceivedListener((response) => open(urlFromNotification(response)));
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) open(urlFromNotification(response));
    });
    return () => sub.remove();
  }, [userId]);
}
