import { Ionicons } from '@/components/ui/Ionicons';
import * as Haptics from 'expo-haptics';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { answerCall, declineCall, getCall, getRingingCall, subscribeToCall, subscribeToIncomingCalls, type CallRecord } from '@/services/calls';
import { getErrorMessage } from '@/utils/errors';
import { useAuth } from '@/store/authStore';
import { palette, radius, shadows, spacing } from '@/theme/tokens';

/**
 * App-wide incoming call banner. Listens for new call invitations over
 * realtime and lets the user accept (navigates into the call) or decline.
 */
export function IncomingCallOverlay() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const toast = useToast();
  const [call, setCall] = useState<CallRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const hapticTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // New invitations arrive over realtime; a call that was already ringing when the app
  // opened (or came back to the foreground) is picked up with get_ringing_call.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const checkRinging = () => {
      getRingingCall()
        .then((record) => {
          if (!cancelled && record && record.status === 'ringing' && !record.is_initiator) setCall(record);
        })
        .catch(() => undefined);
    };
    checkRinging();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkRinging();
    });
    const unsubscribe = subscribeToIncomingCalls(user.id, async (callId) => {
      try {
        const record = await getCall(callId);
        if (!cancelled && record && record.status === 'ringing' && !record.is_initiator) setCall(record);
      } catch {
        /* ignore */
      }
    });
    return () => {
      cancelled = true;
      appState.remove();
      unsubscribe();
    };
  }, [user]);

  // Follow the call's status while the banner is visible.
  useEffect(() => {
    if (!call) return;
    const unsubscribe = subscribeToCall(call.id, async () => {
      const record = await getCall(call.id).catch(() => null);
      if (!record || record.status !== 'ringing' || record.my_state !== 'invited') setCall(null);
    });
    if (Platform.OS !== 'web') {
      hapticTimer.current = setInterval(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined), 2000);
    }
    const timeout = setTimeout(() => setCall(null), 50_000);
    return () => {
      unsubscribe();
      clearTimeout(timeout);
      if (hapticTimer.current) clearInterval(hapticTimer.current);
    };
  }, [call?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!call || pathname.startsWith('/call/')) return null;

  const accept = async () => {
    setBusy(true);
    try {
      const answered = await answerCall(call.id);
      if (answered.status === 'active') router.navigate(`/call/${call.id}` as never);
      else toast.info('Call ended', 'That call is no longer ringing.');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
      setCall(null);
    }
  };

  const decline = async () => {
    await declineCall(call.id).catch(() => undefined);
    setCall(null);
  };

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + spacing.sm }]}>
      <View style={[styles.banner, shadows.md]}>
        <Pressable onPress={() => router.navigate(`/call/${call.id}` as never)} style={styles.info}>
          <Avatar uri={call.initiator?.avatar_url ?? call.conversation.avatar_url} name={call.initiator?.display_name ?? call.conversation.title} size={44} />
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text variant="bodySemibold" color={palette.white} numberOfLines={1}>
              {call.initiator?.display_name ?? call.conversation.title}
            </Text>
            <Text variant="small" color="rgba(255,255,255,0.75)" numberOfLines={1}>
              Incoming {call.kind} call{call.conversation.kind === 'group' ? ` · ${call.conversation.title}` : ''}
            </Text>
          </View>
        </Pressable>
        <Pressable onPress={decline} style={[styles.btn, { backgroundColor: palette.danger }]} accessibilityLabel="Decline call">
          <Ionicons name="close" size={22} color={palette.white} />
        </Pressable>
        <Pressable onPress={accept} disabled={busy} style={[styles.btn, { backgroundColor: palette.success, marginLeft: spacing.sm }]} accessibilityLabel="Accept call">
          <Ionicons name={call.kind === 'video' ? 'videocam' : 'call'} size={22} color={palette.white} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 999, paddingHorizontal: spacing.md },
  banner: { width: '100%', maxWidth: 520, flexDirection: 'row', alignItems: 'center', backgroundColor: palette.night2, borderRadius: radius.xl, padding: spacing.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  info: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  btn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
