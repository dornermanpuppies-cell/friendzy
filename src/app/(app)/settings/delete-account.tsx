import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { deleteMyAccount, signInWithEmail } from '@/services/account';
import { useAuth, useAuthStore } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';

const CONFIRM_WORD = 'DELETE';

export default function DeleteAccountScreen() {
  const { user, profile } = useAuth();
  const signOut = useAuthStore((s) => s.signOut);
  const toast = useToast();
  const { colors } = useTheme();
  const [password, setPassword] = useState('');
  const [confirmWord, setConfirmWord] = useState('');
  const [busy, setBusy] = useState(false);

  const canDelete = confirmWord.trim().toUpperCase() === CONFIRM_WORD && password.length > 0;

  const remove = async () => {
    if (!user?.email || !canDelete) return;
    setBusy(true);
    try {
      // Re-authenticate before an irreversible action.
      await signInWithEmail(user.email, password);
      await deleteMyAccount();
      await signOut('local');
      toast.success('Your account has been deleted', 'We are sorry to see you go.');
      router.replace('/');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<ScreenHeader title="Delete account" fallbackHref="/settings" />} scroll>
      <View style={[styles.warning, { backgroundColor: 'rgba(255,77,109,0.10)', borderColor: 'rgba(255,77,109,0.35)' }]}>
        <Text variant="h4" color={palette.danger}>
          This cannot be undone
        </Text>
        <Text variant="body" color="textSecondary" style={{ marginTop: spacing.sm }}>
          Deleting @{profile?.username} permanently removes your profile, followers, friends, interests, settings, notifications and uploaded profile media. Any future Premium
          subscription must be cancelled separately with the App Store, Google Play or your card provider.
        </Text>
      </View>

      <Text variant="body" color="textMuted" style={{ marginTop: spacing['2xl'] }}>
        To confirm, enter your password and type <Text variant="bodySemibold">{CONFIRM_WORD}</Text> below.
      </Text>
      <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" containerStyle={{ marginTop: spacing.lg }} />
      <Input label={`Type ${CONFIRM_WORD}`} value={confirmWord} onChangeText={setConfirmWord} autoCapitalize="characters" autoCorrect={false} containerStyle={{ marginTop: spacing.lg }} />
      <Button title="Permanently delete my account" variant="danger" fullWidth size="lg" onPress={remove} disabled={!canDelete} loading={busy} style={{ marginTop: spacing['2xl'] }} />
      <Button title="Keep my account" variant="ghost" fullWidth onPress={() => router.back()} style={{ marginTop: spacing.sm }} />
      <Text variant="small" color="textMuted" align="center" style={{ marginTop: spacing.lg, color: colors.textMuted }}>
        Need a break instead? You can make your account private or turn off discovery in Privacy settings.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({ warning: { marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1 } });
