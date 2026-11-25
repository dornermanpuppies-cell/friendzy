import { router } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { AuthShell } from '@/features/auth/AuthShell';
import { requestPasswordReset } from '@/services/account';
import { spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';
import { forgotPasswordSchema, zodFieldErrors } from '@/utils/validation';

export default function ForgotPasswordScreen() {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setError(zodFieldErrors(parsed.error).email);
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await requestPasswordReset(parsed.data.email);
      setSent(true);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthShell title="Check your email" back={false}>
        <EmptyState
          icon="mail-unread-outline"
          title={`We sent a link to ${email.trim()}`}
          description="Open the email and tap “Choose a new password”. The link expires in 1 hour. If you don't see it, check your spam folder."
          action={{ title: 'Back to sign in', onPress: () => router.replace('/sign-in') }}
          secondaryAction={{ title: 'Use a different email', onPress: () => setSent(false) }}
          compact
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" subtitle="Enter the email address linked to your account and we'll send you a reset link.">
      <Input
        label="Email"
        placeholder="you@example.com"
        value={email}
        onChangeText={setEmail}
        error={error}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        leftIcon="mail-outline"
        returnKeyType="send"
        onSubmitEditing={submit}
      />
      <Button title="Send reset link" size="lg" fullWidth onPress={submit} loading={busy} style={{ marginTop: spacing['2xl'] }} />
    </AuthShell>
  );
}
