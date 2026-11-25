import { router } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { AuthShell } from '@/features/auth/AuthShell';
import { updatePassword } from '@/services/account';
import { useAuthStore } from '@/store/authStore';
import { spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';
import { resetPasswordSchema, zodFieldErrors } from '@/utils/validation';

export default function ResetPasswordScreen() {
  const toast = useToast();
  const status = useAuthStore((s) => s.status);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsed = resetPasswordSchema.safeParse({ password, confirm });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await updatePassword(parsed.data.password);
      toast.success('Password updated', 'You are signed in with your new password.');
      router.replace('/home');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (status === 'signedOut') {
    return (
      <AuthShell title="Link expired" back={false}>
        <EmptyState
          icon="time-outline"
          title="This reset link is no longer valid"
          description="Password reset links expire after 1 hour and can only be used once. Request a new one to continue."
          action={{ title: 'Request a new link', onPress: () => router.replace('/forgot-password') }}
          compact
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle="Use at least 8 characters with a letter and a number." back={false}>
      <Input label="New password" placeholder="New password" value={password} onChangeText={setPassword} error={errors.password} secureTextEntry autoComplete="new-password" leftIcon="lock-closed-outline" />
      <Input
        label="Confirm password"
        placeholder="Repeat the new password"
        value={confirm}
        onChangeText={setConfirm}
        error={errors.confirm}
        secureTextEntry
        autoComplete="new-password"
        leftIcon="lock-closed-outline"
        containerStyle={{ marginTop: spacing.lg }}
        onSubmitEditing={submit}
      />
      <Button title="Update password" size="lg" fullWidth onPress={submit} loading={busy || status === 'loading'} style={{ marginTop: spacing['2xl'] }} />
    </AuthShell>
  );
}
