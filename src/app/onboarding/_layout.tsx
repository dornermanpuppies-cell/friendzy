import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAuth } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';

/** Post-registration onboarding. Requires a session; finished users go to the app. */
export default function OnboardingLayout() {
  const { status, profile, profileLoading } = useAuth();
  const { colors } = useTheme();

  if (status === 'loading' || (status === 'signedIn' && !profile && profileLoading)) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (status === 'signedOut') return <Redirect href="/sign-in" />;
  if (profile?.onboarding_completed) return <Redirect href="/home" />;

  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}

const styles = StyleSheet.create({ center: { flex: 1, alignItems: 'center', justifyContent: 'center' } });
