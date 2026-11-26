import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ListItem, ListSection } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { changePassword, revokeOtherSessions } from '@/services/account';
import { useAuth } from '@/store/authStore';
import { spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';
import { changePasswordSchema, passwordStrength, zodFieldErrors } from '@/utils/validation';

export default function SecuritySettingsScreen() {
  const { user } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const submit = async () => {
    const parsed = changePasswordSchema.safeParse({ current, password, confirm });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    if (!user?.email) return;
    setErrors({});
    setBusy(true);
    try {
      await changePassword(user.email, parsed.data.current, parsed.data.password);
      setCurrent('');
      setPassword('');
      setConfirm('');
      toast.success('Password changed', 'Use your new password next time you sign in.');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const signOutOthers = async () => {
    setRevoking(true);
    try {
      await revokeOtherSessions();
      toast.success('Signed out everywhere else', 'Only this device stays signed in.');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setRevoking(false);
    }
  };

  const strength = passwordStrength(password);

  return (
    <Screen header={<ScreenHeader title="Password & security" fallbackHref="/settings" />} scroll>
      <Text variant="h4" style={{ marginTop: spacing.xl }}>
        Change password
      </Text>
      <Input label="Current password" value={current} onChangeText={setCurrent} error={errors.current} secureTextEntry autoComplete="current-password" containerStyle={{ marginTop: spacing.md }} />
      <Input label="New password" value={password} onChangeText={setPassword} error={errors.password} helper={password ? `Strength: ${strength.label}` : 'At least 8 characters with a letter and a number'} secureTextEntry autoComplete="new-password" containerStyle={{ marginTop: spacing.lg }} />
      <Input label="Confirm new password" value={confirm} onChangeText={setConfirm} error={errors.confirm} secureTextEntry autoComplete="new-password" containerStyle={{ marginTop: spacing.lg }} />
      <Button title="Update password" onPress={submit} loading={busy} style={{ marginTop: spacing.xl }} />

      <View style={{ height: spacing['3xl'] }} />
      <ListSection title="Sessions">
        <ListItem icon="phone-portrait-outline" title="Active sessions" subtitle="Review devices and sign out individually" onPress={() => router.navigate('/settings/sessions')} />
        <ListItem icon="lock-closed-outline" title="Encryption devices" subtitle="Devices that can read your end-to-end encrypted chats" onPress={() => router.navigate('/settings/encryption' as never)} />
        <ListItem icon="log-out-outline" title="Sign out of all other devices" subtitle="Keeps this device signed in" onPress={signOutOthers} disabled={revoking} showChevron={false} />
      </ListSection>

      <ListSection title="Account recovery">
        <ListItem icon="mail-outline" title="Recovery email" value={user?.email ?? ''} subtitle="Password reset links are sent to your verified email" showChevron={false} />
      </ListSection>
    </Screen>
  );
}
