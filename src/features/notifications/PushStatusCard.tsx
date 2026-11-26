import { Ionicons } from '@/components/ui/Ionicons';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { supabase } from '@/lib/supabase';
import { lastPushRegistration, PUSH_RESULT_LABEL, registerForPush, type PushRegistrationResult } from '@/services/push';
import { enableWebPush, getWebPushStatus, type WebPushStatus } from '@/services/webPush';
import { useAuth } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';

type State =
  | { kind: 'loading' }
  | { kind: 'on'; detail: string }
  | { kind: 'off'; detail: string; canEnable: boolean }
  | { kind: 'blocked'; detail: string }
  | { kind: 'unavailable'; detail: string };

const WEB_LABEL: Record<WebPushStatus, string> = {
  unsupported: 'This browser does not support push notifications. On iPhone, add Friendzy to the Home Screen first (Share → Add to Home Screen).',
  insecure: 'Notifications need a secure (https) address.',
  default: 'Get notified about messages, calls, friend requests and more — even when this tab is closed.',
  denied: 'Notifications are blocked for this site. Allow them in the browser’s site settings (the lock icon next to the address) and reload.',
  granted: 'Permission granted — finishing the setup…',
  subscribed: 'This browser receives Friendzy notifications, even when the tab is closed.',
};

/** Shows whether this device can receive pushes, lets the user turn them on, and sends a test. */
export function PushStatusCard({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState<'enable' | 'test' | null>(null);

  const refresh = useCallback(async () => {
    if (Platform.OS === 'web') {
      const status = await getWebPushStatus();
      if (status === 'subscribed') setState({ kind: 'on', detail: WEB_LABEL.subscribed });
      else if (status === 'denied') setState({ kind: 'blocked', detail: WEB_LABEL.denied });
      else if (status === 'unsupported' || status === 'insecure') setState({ kind: 'unavailable', detail: WEB_LABEL[status] });
      else setState({ kind: 'off', detail: WEB_LABEL[status], canEnable: true });
      return;
    }
    if (!Device.isDevice) {
      setState({ kind: 'unavailable', detail: PUSH_RESULT_LABEL.simulator });
      return;
    }
    const permission = await Notifications.getPermissionsAsync();
    const last = lastPushRegistration?.result;
    if (last === 'registered') setState({ kind: 'on', detail: PUSH_RESULT_LABEL.registered });
    else if (permission.status === 'denied' && !permission.canAskAgain) setState({ kind: 'blocked', detail: PUSH_RESULT_LABEL.denied });
    else if (last === 'no_firebase' || last === 'no_project_id') setState({ kind: 'unavailable', detail: PUSH_RESULT_LABEL[last] });
    else setState({ kind: 'off', detail: last ? PUSH_RESULT_LABEL[last as PushRegistrationResult] : 'Allow notifications to hear about messages, calls, friend requests and more when the app is closed.', canEnable: true });
  }, []);

  useEffect(() => {
    // Deferred: the status comes from platform APIs, never from a synchronous setState in the effect body.
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const enable = async () => {
    if (!user) return;
    setBusy('enable');
    try {
      if (Platform.OS === 'web') {
        const result = await enableWebPush(user.id);
        if (result === 'subscribed') toast.success('Notifications are on', 'You will be notified even when this tab is closed.');
        else if (result === 'denied') toast.error('Notifications are blocked', WEB_LABEL.denied);
      } else {
        const result = await registerForPush(user.id);
        if (result === 'registered') toast.success('Notifications are on');
        else toast.error('Could not turn on notifications', PUSH_RESULT_LABEL[result]);
      }
    } catch (error) {
      toast.error('Could not turn on notifications', getErrorMessage(error));
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const sendTest = async () => {
    setBusy('test');
    try {
      const { error } = await supabase.rpc('request_test_notification');
      if (error) throw error;
      toast.success('Test sent', 'It should arrive within a few seconds. It also appears in your notification list.');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const icon = state.kind === 'on' ? 'notifications' : state.kind === 'blocked' ? 'notifications-off' : 'notifications-outline';
  const tint = state.kind === 'on' ? colors.success : state.kind === 'blocked' ? colors.danger : colors.primary;
  const headline = state.kind === 'loading' ? 'Checking notifications…' : state.kind === 'on' ? 'Notifications are on' : state.kind === 'blocked' ? 'Notifications are blocked' : state.kind === 'unavailable' ? 'Notifications not available here' : 'Turn on notifications';

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: state.kind === 'on' ? colors.success : colors.border }, compact && { padding: spacing.md }]} testID={`push-status:${state.kind}`}>
      <View style={styles.row}>
        <View style={[styles.iconWrap, { backgroundColor: colors.surfaceMuted }]}>
          <Ionicons name={icon} size={22} color={tint} />
        </View>
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text variant="bodySemibold">{headline}</Text>
          {state.kind !== 'loading' ? (
            <Text variant="caption" color="textMuted" style={{ marginTop: 2 }}>
              {state.detail}
            </Text>
          ) : null}
        </View>
      </View>
      {state.kind === 'off' && state.canEnable ? <Button title={Platform.OS === 'web' ? 'Turn on notifications' : 'Allow notifications'} leftIcon="notifications-outline" onPress={() => void enable()} loading={busy === 'enable'} style={{ marginTop: spacing.md }} fullWidth /> : null}
      {state.kind === 'blocked' && Platform.OS !== 'web' ? <Button title="Open system settings" variant="secondary" onPress={() => void Linking.openSettings()} style={{ marginTop: spacing.md }} fullWidth /> : null}
      {state.kind === 'on' ? <Button title="Send me a test notification" variant="secondary" size="sm" leftIcon="paper-plane-outline" onPress={() => void sendTest()} loading={busy === 'test'} style={{ marginTop: spacing.md, alignSelf: 'flex-start' }} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center' },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
