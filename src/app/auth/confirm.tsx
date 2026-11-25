import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { verifyTokenHash } from '@/services/account';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { safeNextPath } from '@/utils/authUrl';
import { getErrorMessage } from '@/utils/errors';

/**
 * Token-hash confirmation route used by the branded Resend email templates.
 * Works on any device/browser because it does not depend on a PKCE verifier.
 */
export default function AuthConfirmScreen() {
  const { colors } = useTheme();
  const { token_hash: tokenHash, type, next } = useLocalSearchParams<{ token_hash?: string; type?: string; next?: string }>();
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    (async () => {
      if (!tokenHash || !type) {
        setError('This confirmation link is incomplete.');
        return;
      }
      try {
        await verifyTokenHash(tokenHash, type);
        const destination =
          type === 'recovery' ? '/auth/reset-password' : type === 'email_change' ? '/settings/account' : safeNextPath(next, '/home');
        router.replace(destination as never);
      } catch (err) {
        setError(getErrorMessage(err));
      }
    })();
  }, [tokenHash, type, next]);

  return (
    <Screen>
      <View style={styles.center}>
        <Logo size={44} />
        {error ? (
          <>
            <Text variant="h3" align="center" style={{ marginTop: spacing['2xl'] }}>
              {"This link can't be used"}
            </Text>
            <Text variant="body" color="textMuted" align="center" style={{ marginTop: spacing.sm, maxWidth: 420 }}>
              {error}
            </Text>
            <View style={styles.actions}>
              <Button title={type === 'recovery' ? 'Request a new reset link' : 'Go to sign in'} onPress={() => router.replace(type === 'recovery' ? '/forgot-password' : '/sign-in')} />
            </View>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing['2xl'] }} />
            <Text variant="body" color="textMuted" style={{ marginTop: spacing.md }}>
              Confirming…
            </Text>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing['2xl'] },
  actions: { marginTop: spacing['2xl'], alignItems: 'center' },
});
