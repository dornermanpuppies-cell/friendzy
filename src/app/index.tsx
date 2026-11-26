import { Ionicons } from '@/components/ui/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, Redirect, router } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { Text } from '@/components/ui/Text';
import { useAuthStore } from '@/store/authStore';
import { ThemeScope } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';

const FEATURES = [
  { icon: 'people', label: 'Meet people worldwide' },
  { icon: 'chatbubbles', label: 'Chat, voice notes & calls' },
  { icon: 'radio', label: 'Short videos & livestreams' },
  { icon: 'game-controller', label: 'Social games & gifts' },
] as const;

/** Native welcome screen (the website shows the landing page instead). */
export default function WelcomeScreen() {
  const status = useAuthStore((s) => s.status);

  if (status === 'signedIn') return <Redirect href="/home" />;

  return (
    <ThemeScope scheme="dark">
      <LinearGradient colors={['#1B0B3E', palette.purpleDeep, palette.night]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.root}>
        <View style={styles.orbPink} />
        <View style={styles.orbBlue} />
        <SafeAreaView style={styles.safe}>
          {status === 'loading' ? (
            <View style={styles.center}>
              <Logo size={56} wordmark={false} />
              <ActivityIndicator color={palette.white} style={{ marginTop: spacing['2xl'] }} />
            </View>
          ) : (
            <>
              <View style={styles.hero}>
                <Logo size={52} color={palette.white} />
                <Text variant="hero" color={palette.white} style={{ marginTop: spacing['4xl'] }}>
                  Meet. Connect.{'\n'}Play. Earn.
                </Text>
                <Text variant="bodyLg" color="rgba(255,255,255,0.78)" style={{ marginTop: spacing.lg }}>
                  Make genuine friends around the world, chat for real, go live and play together.
                </Text>
                <View style={styles.features}>
                  {FEATURES.map((f) => (
                    <View key={f.label} style={styles.feature}>
                      <View style={styles.featureIcon}>
                        <Ionicons name={f.icon} size={16} color={palette.white} />
                      </View>
                      <Text variant="bodyMedium" color="rgba(255,255,255,0.92)">
                        {f.label}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
              <View style={styles.actions}>
                <Button title="Create account" size="lg" fullWidth onPress={() => router.push('/sign-up')} />
                <Button title="Sign in" variant="light" size="lg" fullWidth onPress={() => router.push('/sign-in')} style={{ marginTop: spacing.md }} />
                <Text variant="caption" color="rgba(255,255,255,0.55)" align="center" style={{ marginTop: spacing.lg }}>
                  By continuing you agree to our{' '}
                  <Link href="/terms">
                    <Text variant="caption" color={palette.white}>
                      Terms
                    </Text>
                  </Link>
                  ,{' '}
                  <Link href="/privacy">
                    <Text variant="caption" color={palette.white}>
                      Privacy Policy
                    </Text>
                  </Link>{' '}
                  and{' '}
                  <Link href="/guidelines">
                    <Text variant="caption" color={palette.white}>
                      Community Guidelines
                    </Text>
                  </Link>
                  .
                </Text>
              </View>
            </>
          )}
        </SafeAreaView>
      </LinearGradient>
    </ThemeScope>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  safe: { flex: 1, paddingHorizontal: spacing['2xl'] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { flex: 1, justifyContent: 'center' },
  features: { marginTop: spacing['3xl'], gap: spacing.md },
  feature: { flexDirection: 'row', alignItems: 'center' },
  featureIcon: { width: 30, height: 30, borderRadius: radius.sm, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  actions: { paddingBottom: spacing.lg },
  orbPink: { position: 'absolute', width: 380, height: 380, borderRadius: 190, backgroundColor: 'rgba(255,40,185,0.25)', top: -140, right: -120 },
  orbBlue: { position: 'absolute', width: 320, height: 320, borderRadius: 160, backgroundColor: 'rgba(39,107,255,0.28)', bottom: 60, left: -160 },
});
