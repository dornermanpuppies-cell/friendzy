import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { ListItem, ListSection } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { requestEmailChange } from '@/services/account';
import { updateMyPrivate, updateMySettings } from '@/services/profiles';
import { useAuth, useAuthStore } from '@/store/authStore';
import { spacing } from '@/theme/tokens';
import type { GenderType } from '@/types/database';
import { getErrorMessage } from '@/utils/errors';
import { formatDate } from '@/utils/format';
import { emailSchema, GENDER_OPTIONS } from '@/utils/validation';

export default function AccountSettingsScreen() {
  const { user, privateData, settings } = useAuth();
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const patchSettings = useAuthStore((s) => s.patchSettings);
  const toast = useToast();
  const [emailOpen, setEmailOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const pendingEmail = (user as { new_email?: string } | null)?.new_email;

  const submitEmail = async () => {
    const parsed = emailSchema.safeParse(newEmail);
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message);
      return;
    }
    if (parsed.data === user?.email) {
      setEmailError('That is already your email address.');
      return;
    }
    setEmailError(undefined);
    setBusy(true);
    try {
      await requestEmailChange(parsed.data);
      setEmailOpen(false);
      toast.success('Confirm the change', `We sent confirmation links to ${parsed.data}${user?.email ? ` and ${user.email}` : ''}.`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const setGender = async (gender: GenderType | null) => {
    if (!user) return;
    try {
      await updateMyPrivate(user.id, { gender });
      await refreshProfile();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const toggleShowGender = async (value: boolean) => {
    if (!user) return;
    patchSettings({ show_gender: value });
    try {
      await updateMySettings(user.id, { show_gender: value });
    } catch (error) {
      patchSettings({ show_gender: !value });
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <Screen header={<ScreenHeader title="Account" fallbackHref="/settings" />} scroll>
      <View style={{ height: spacing.lg }} />
      <ListSection title="Email">
        <ListItem icon="mail-outline" title={user?.email ?? '—'} subtitle={pendingEmail ? `Pending change to ${pendingEmail} — confirm via email` : user?.email_confirmed_at ? 'Verified' : 'Not verified'} onPress={() => setEmailOpen(true)} showChevron />
      </ListSection>

      <ListSection title="Personal information">
        <ListItem icon="calendar-outline" title="Date of birth" value={privateData?.birth_date ? formatDate(privateData.birth_date) : 'Not set'} subtitle="Contact support to correct your date of birth" showChevron={false} />
        <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
          <Text variant="bodyMedium">Gender (optional)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
            {GENDER_OPTIONS.map((g) => (
              <Chip key={g.value} label={g.label} size="sm" selected={privateData?.gender === g.value} onPress={() => void setGender(privateData?.gender === g.value ? null : g.value)} />
            ))}
          </View>
        </View>
        <ListItem icon="eye-outline" title="Show gender on my profile" switchValue={settings?.show_gender ?? false} onSwitchChange={(v) => void toggleShowGender(v)} />
      </ListSection>

      <ListSection title="Account details">
        <ListItem icon="finger-print-outline" title="Account ID" value={user?.id.slice(0, 8)} showChevron={false} />
        <ListItem icon="time-outline" title="Member since" value={formatDate(user?.created_at)} showChevron={false} />
      </ListSection>

      <Sheet visible={emailOpen} onClose={() => setEmailOpen(false)} title="Change email address" subtitle="We'll send a confirmation link to both your current and new address.">
        <Input label="New email" placeholder="new@example.com" value={newEmail} onChangeText={setNewEmail} error={emailError} autoCapitalize="none" keyboardType="email-address" autoComplete="email" leftIcon="mail-outline" />
        <Button title="Send confirmation" fullWidth onPress={submitEmail} loading={busy} style={{ marginVertical: spacing.lg }} />
      </Sheet>
    </Screen>
  );
}
