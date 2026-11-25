import { Redirect, Stack } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { Sidebar } from '@/components/layout/Sidebar';
import { Button } from '@/components/ui/Button';
import { IncomingCallOverlay } from '@/features/calls/IncomingCallOverlay';
import { Logo } from '@/components/ui/Logo';
import { Text } from '@/components/ui/Text';
import { stepHref } from '@/features/onboarding/steps';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { usePresenceHeartbeat } from '@/hooks/usePresenceHeartbeat';
import { usePushRegistration } from '@/hooks/usePushRegistration';
import { useAuth, useAuthStore } from '@/store/authStore';
import { useBadgeStore } from '@/store/badgeStore';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

/**
 * Authenticated application shell. Guards the session, forces onboarding,
 * starts realtime badges + presence and renders the desktop sidebar.
 */
export default function AppLayout() {
  const { status, profile, profileLoading, profileError, user } = useAuth();
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const signOut = useAuthStore((s) => s.signOut);
  const { colors } = useTheme();
  const { isDesktop } = useBreakpoint();
  const ready = status === 'signedIn' && Boolean(profile?.onboarding_completed);

  usePresenceHeartbeat(ready ? user?.id : undefined);
  usePushRegistration(ready ? user?.id : undefined);

  const startBadges = useBadgeStore((s) => s.start);
  useEffect(() => {
    if (!ready || !user?.id) return;
    return startBadges(user.id);
  }, [ready, user?.id, startBadges]);

  if (status === 'loading' || (status === 'signedIn' && !profile && profileLoading)) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Logo size={44} wordmark={false} />
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }

  if (status === 'signedOut') return <Redirect href={Platform.OS === 'web' ? '/sign-in' : '/'} />;

  if (!profile) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: spacing['2xl'] }]}>
        <Logo size={44} />
        <Text variant="h3" align="center" style={{ marginTop: spacing['2xl'] }}>
          {"We couldn't load your profile"}
        </Text>
        <Text variant="body" color="textMuted" align="center" style={{ marginTop: spacing.sm, maxWidth: 420 }}>
          {profileError ?? 'Please check your connection and try again.'}
        </Text>
        <Button title="Try again" onPress={() => void refreshProfile()} style={{ marginTop: spacing['2xl'] }} />
        <Button title="Sign out" variant="ghost" onPress={() => void signOut()} style={{ marginTop: spacing.sm }} />
      </View>
    );
  }

  if (!profile.onboarding_completed) return <Redirect href={stepHref(profile.onboarding_step) as never} />;

  if (profile.account_status !== 'active') {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: spacing['2xl'] }]}>
        <Logo size={44} />
        <Text variant="h3" align="center" style={{ marginTop: spacing['2xl'] }}>
          Your account is {profile.account_status}
        </Text>
        <Text variant="body" color="textMuted" align="center" style={{ marginTop: spacing.sm, maxWidth: 420 }}>
          This account cannot use Friendzy right now. If you believe this is a mistake, contact support.
        </Text>
        <Button title="Sign out" variant="secondary" onPress={() => void signOut()} style={{ marginTop: spacing['2xl'] }} />
      </View>
    );
  }

  return (
    <View style={[styles.shell, { flexDirection: isDesktop ? 'row' : 'column', backgroundColor: colors.background }]}>
      {isDesktop ? <Sidebar /> : null}
      <View style={styles.content}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: Platform.OS === 'web' ? 'none' : 'default',
          }}
        />
        <IncomingCallOverlay />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  shell: { flex: 1 },
  content: { flex: 1, minWidth: 0 },
});
