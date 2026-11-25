import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { getMyVerificationRequest, requestVerification, uploadVerificationDocument, VERIFICATION_CATEGORIES } from '@/services/verification';
import { useAuth } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { VerificationRequest } from '@/types/admin';
import { getErrorMessage } from '@/utils/errors';
import { formatDate } from '@/utils/format';

const STATUS: Record<string, { color: string; label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  pending: { color: palette.warning, label: 'Under review', icon: 'time-outline' },
  approved: { color: palette.success, label: 'Approved', icon: 'checkmark-circle-outline' },
  rejected: { color: palette.danger, label: 'Not approved', icon: 'close-circle-outline' },
};

export default function VerificationScreen() {
  const { user, profile } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const current = useAsync(() => getMyVerificationRequest(), []);
  const [fullName, setFullName] = useState(profile?.display_name ?? '');
  const [category, setCategory] = useState<VerificationRequest['category']>('creator');
  const [links, setLinks] = useState('');
  const [note, setNote] = useState('');
  const [doc, setDoc] = useState<{ uri: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const pickDocument = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets?.length) return;
      setDoc({ uri: res.assets[0].uri, name: res.assets[0].name });
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const submit = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const path = doc ? await uploadVerificationDocument(user.id, doc.uri) : null;
      await requestVerification({ full_name: fullName.trim(), category, links: links.split(/\n|,/).map((l) => l.trim()).filter(Boolean).slice(0, 5), document_path: path, note: note.trim() || null });
      toast.success('Request submitted', 'We review verification requests manually and notify you of the decision.');
      await current.refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const req = current.data;
  const canApply = !profile?.is_verified && (!req || (req.status === 'rejected' && req.reviewed_at && Date.now() - new Date(req.reviewed_at).getTime() > 30 * 24 * 3600 * 1000));

  return (
    <Screen header={<ScreenHeader title="Verification" fallbackHref="/settings" />} scroll padded keyboardAvoiding>
      <View style={{ paddingVertical: spacing.lg }}>
        <Text variant="h3">Get the verified badge</Text>
        <Text variant="small" color="textMuted" style={{ marginTop: spacing.xs }}>
          Verification confirms that notable creators, public figures, businesses and communities are who they say they are. It does not unlock features and can be removed for guideline violations.
        </Text>
      </View>
      {profile?.is_verified ? (
        <Card style={{ borderColor: palette.success }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="checkmark-circle" size={24} color={palette.success} />
            <Text variant="bodySemibold" style={{ marginLeft: spacing.sm }}>
              Your account is verified
            </Text>
          </View>
        </Card>
      ) : null}
      {current.loading ? (
        <SkeletonList count={2} />
      ) : req ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name={STATUS[req.status].icon} size={22} color={STATUS[req.status].color} />
            <Text variant="bodySemibold" style={{ marginLeft: spacing.sm }}>
              {STATUS[req.status].label}
            </Text>
          </View>
          <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs }}>
            Submitted {formatDate(req.created_at, 'd MMM yyyy')} as {VERIFICATION_CATEGORIES.find((c) => c.id === req.category)?.label}
            {req.reviewed_at ? ` · reviewed ${formatDate(req.reviewed_at, 'd MMM yyyy')}` : ''}
          </Text>
          {req.decision_note ? (
            <Text variant="small" style={{ marginTop: spacing.sm }}>
              Reviewer note: {req.decision_note}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {canApply ? (
        <>
          <Input label="Full name or official name" value={fullName} onChangeText={setFullName} maxLength={120} />
          <Text variant="label" color="textMuted" style={{ marginTop: spacing.lg, marginBottom: spacing.xs }}>
            Category
          </Text>
          <View style={styles.wrap}>
            {VERIFICATION_CATEGORIES.map((c) => (
              <Chip key={c.id} label={c.label} size="sm" selected={category === c.id} onPress={() => setCategory(c.id)} />
            ))}
          </View>
          <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs }}>
            {VERIFICATION_CATEGORIES.find((c) => c.id === category)?.description}
          </Text>
          <Input label="Links that prove notability (one per line)" value={links} onChangeText={setLinks} multiline placeholder="https://…" containerStyle={{ marginTop: spacing.lg }} autoCapitalize="none" />
          <View style={[styles.doc, { borderColor: colors.border }]}>
            <Ionicons name="document-attach-outline" size={22} color={colors.primary} />
            <View style={{ flex: 1, marginHorizontal: spacing.md }}>
              <Text variant="smallMedium">{doc ? doc.name : 'Identity or ownership document (optional)'}</Text>
              <Text variant="caption" color="textMuted">
                Stored privately; only the verification team can open it.
              </Text>
            </View>
            <Button title={doc ? 'Change' : 'Upload'} size="sm" variant="secondary" onPress={() => void pickDocument()} />
          </View>
          <Input label="Anything else we should know" value={note} onChangeText={setNote} multiline maxLength={1000} containerStyle={{ marginTop: spacing.lg }} />
          <Button title="Submit request" onPress={() => void submit()} loading={busy} disabled={fullName.trim().length < 2} fullWidth style={{ marginTop: spacing.xl }} />
        </>
      ) : !profile?.is_verified && req?.status === 'rejected' ? (
        <Text variant="small" color="textMuted">
          You can apply again 30 days after the last decision.
        </Text>
      ) : null}
      <Text variant="caption" color="textMuted" style={{ marginVertical: spacing['2xl'] }}>
        Submitting false information leads to permanent denial and may result in account action.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  doc: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, marginTop: spacing.lg },
});
