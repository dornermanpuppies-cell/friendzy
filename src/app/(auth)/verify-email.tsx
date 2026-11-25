import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { AuthShell } from '@/features/auth/AuthShell';
import { resendVerificationEmail } from '@/services/account';
import { spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';

const COOLDOWN_SECONDS = 60;

export default function VerifyEmailScreen() {
  const toast = useToast();
  const { email } = useLocalSearchParams<{ email?: string }>();
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const resend = async () => {
    if (!email) {
      router.replace('/sign-in');
      return;
    }
    setBusy(true);
    try {
      await resendVerificationEmail(email);
      toast.success('Verification email sent', 'Check your inbox and spam folder.');
      setCooldown(COOLDOWN_SECONDS);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Verify your email" back={false}>
      <EmptyState
        icon="mail-open-outline"
        title={email ? `We sent a link to ${email}` : 'Check your inbox'}
        description="Tap the confirmation link in the email to activate your account. After confirming, come back and sign in — on any device."
        compact
      />
      <View style={styles.actions}>
        <Button
          title={cooldown > 0 ? `Resend email (${cooldown}s)` : 'Resend verification email'}
          variant="outline"
          fullWidth
          onPress={resend}
          disabled={cooldown > 0}
          loading={busy}
        />
        <Button title="I've confirmed — sign in" fullWidth onPress={() => router.replace('/sign-in')} style={{ marginTop: spacing.md }} />
        <Text variant="small" color="textMuted" align="center" style={{ marginTop: spacing.lg }}>
          Wrong address? Create the account again with the correct email.
        </Text>
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  actions: { marginTop: spacing.lg },
});
