import '@/global.css';

import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Logo } from '@/components/ui/Logo';
import { Text } from '@/components/ui/Text';
import { ToastProvider } from '@/components/ui/Toast';
import { useAppFonts } from '@/hooks/useAppFonts';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export const unstable_settings = {
  // Keep the landing/welcome route as the anchor so back navigation is predictable.
  anchor: 'index',
};

export default function RootLayout() {
  const fontsReady = useAppFonts();
  const initialize = useAuthStore((s) => s.initialize);
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    if (isSupabaseConfigured) void initialize();
  }, [initialize]);

  useEffect(() => {
    if (fontsReady && (status !== 'loading' || !isSupabaseConfigured)) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsReady, status]);

  // On native, wait for fonts so the first frame uses the brand typography.
  if (!fontsReady && Platform.OS !== 'web') return null;

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ToastProvider>{isSupabaseConfigured ? <RootNavigator /> : <ConfigurationRequired />}</ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { isDark, colors } = useTheme();
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: Platform.OS === 'web' ? 'none' : 'default',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="auth" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(app)" />
        <Stack.Screen name="(marketing)" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </>
  );
}

function ConfigurationRequired() {
  const { colors } = useTheme();
  return (
    <View style={[styles.config, { backgroundColor: colors.background }]}>
      <Logo size={40} />
      <Text variant="h2" align="center" style={{ marginTop: spacing['2xl'] }}>
        Configuration required
      </Text>
      <Text variant="body" color="textMuted" align="center" style={{ marginTop: spacing.md, maxWidth: 420 }}>
        Friendzy needs its Supabase project URL and anon key. Copy .env.example to .env.local, fill in
        EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then restart the dev server.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  config: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing['3xl'] },
});
