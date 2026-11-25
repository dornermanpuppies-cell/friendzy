import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { exchangeCodeForSession, setSessionFromTokens, verifyTokenHash } from '@/services/account';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { parseAuthUrl, safeNextPath } from '@/utils/authUrl';
import { getErrorMessage } from '@/utils/errors';

/**
 * Handles redirects from Supabase Auth emails (verification, recovery, email
 * change, magic link). Supports PKCE codes, implicit tokens and token hashes.
 */
export default function AuthCallbackScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<Record<string, string>>();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<string | undefined>(undefined);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    (async () => {
      const fromUrl = Platform.OS === 'web' && typeof window !== 'undefined' ? parseAuthUrl(window.location.href) : {};
      const merged = {
        code: params.code ?? fromUrl.code,
        accessToken: fromUrl.accessToken,
        refreshToken: fromUrl.refreshToken,
        tokenHash: params.token_hash ?? fromUrl.tokenHash,
        type: params.type ?? fromUrl.type,
        next: params.next ?? fromUrl.next,
        error: params.error ?? params.error_code ?? fromUrl.error,
        errorDescription: params.error_description ?? fromUrl.errorDescription,
      };
      setKind(merged.type);

      if (merged.error) {
        setError(merged.errorDescription?.replace(/\+/g, ' ') ?? getErrorMessage({ code: merged.error }));
        return;
      }

      try {
        if (merged.code) {
          await exchangeCodeForSession(merged.code);
        } else if (merged.accessToken && merged.refreshToken) {
          await setSessionFromTokens(merged.accessToken, merged.refreshToken);
        } else if (merged.tokenHash && merged.type) {
          await verifyTokenHash(merged.tokenHash, merged.type);
        } else {
          setError('This link is incomplete or has already been used.');
          return;
        }

        if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.hash) {
          window.history.replaceState(null, '', window.location.pathname);
        }

        const destination = merged.type === 'recovery' ? '/auth/reset-password' : safeNextPath(merged.next, '/home');
        router.replace(destination as never);
      } catch (err) {
        setError(getErrorMessage(err));
      }
    })();
  }, [params]);

  return (
    <Screen>
      <View style={styles.center}>
        <Logo size={44} />
        {error ? (
          <>
            <Text variant="h3" align="center" style={{ marginTop: spacing['2xl'] }}>
              {"We couldn't complete that link"}
            </Text>
            <Text variant="body" color="textMuted" align="center" style={{ marginTop: spacing.sm, maxWidth: 420 }}>
              {error}
            </Text>
            <View style={styles.actions}>
              {kind === 'recovery' ? (
                <Button title="Request a new reset link" onPress={() => router.replace('/forgot-password')} />
              ) : (
                <Button title="Go to sign in" onPress={() => router.replace('/sign-in')} />
              )}
              <Button title="Back to home" variant="ghost" onPress={() => router.replace('/')} style={{ marginTop: spacing.sm }} />
            </View>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing['2xl'] }} />
            <Text variant="body" color="textMuted" style={{ marginTop: spacing.md }}>
              Confirming your link…
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
