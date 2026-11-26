import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { REPORT_REASONS, reportTarget } from '@/services/safety';
import { useAuthStore } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import type { ReportTargetType } from '@/types/database';
import { getErrorMessage } from '@/utils/errors';

export interface ReportSheetProps {
  visible: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: string;
  targetLabel?: string;
  /** Content decrypted on the reporter's device (end-to-end encrypted messages are unreadable to the server). */
  contextText?: string;
}

export function ReportSheet({ visible, onClose, targetType, targetId, targetLabel, contextText }: ReportSheetProps) {
  const { colors } = useTheme();
  const toast = useToast();
  const userId = useAuthStore((s) => s.user?.id);
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const reset = () => {
    setReason(null);
    setDetails('');
    setDone(false);
  };

  const submit = async () => {
    if (!reason || !userId) return;
    setBusy(true);
    try {
      const trimmed = details.trim();
      const fullDetails = contextText ? `${trimmed}${trimmed ? '\n\n' : ''}Reported message (decrypted on the reporter's device): ${contextText.slice(0, 1000)}` : details;
      await reportTarget({ reporterId: userId, targetType, targetId, reason, details: fullDetails });
      setDone(true);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        onClose();
        setTimeout(reset, 300);
      }}
      title={done ? 'Thanks for your report' : `Report ${targetLabel ?? targetType}`}
      subtitle={done ? undefined : 'Your report is confidential. Tell us what is wrong.'}
    >
      {done ? (
        <View style={styles.done}>
          <View style={[styles.doneIcon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="shield-checkmark" size={30} color={colors.primary} />
          </View>
          <Text variant="body" color="textSecondary" align="center" style={{ marginBottom: spacing['2xl'] }}>
            Our safety team will review it. If someone is in immediate danger, contact your local emergency services.
          </Text>
          <Button title="Done" fullWidth onPress={onClose} />
        </View>
      ) : (
        <>
          <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
            {REPORT_REASONS.map((item) => {
              const selected = item.id === reason;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => setReason(item.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[styles.reason, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primarySoft : 'transparent' }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyMedium">{item.label}</Text>
                    <Text variant="small" color="textMuted">
                      {item.description}
                    </Text>
                  </View>
                  <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? colors.primary : colors.textMuted} />
                </Pressable>
              );
            })}
            {reason ? (
              <Input
                label="Additional details (optional)"
                placeholder="Describe what happened"
                multiline
                maxLength={1000}
                showCounter
                value={details}
                onChangeText={setDetails}
                containerStyle={{ marginTop: spacing.md }}
              />
            ) : null}
          </ScrollView>
          <Button title="Submit report" fullWidth onPress={submit} disabled={!reason} loading={busy} style={{ marginTop: spacing.lg, marginBottom: spacing.md }} />
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  reason: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.sm },
  done: { alignItems: 'center', paddingVertical: spacing.lg },
  doneIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
});
