import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListItem, ListSection } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { Fingerprint } from '@/features/chat/Fingerprint';
import { useAsync } from '@/hooks/useAsync';
import { describeThisDevice, fingerprintOf, getPins, getUserDevices, myFingerprint, setDeviceVerified, type E2eeDeviceInfo, type PinRecord } from '@/lib/e2ee/devices';
import { fetchConversation } from '@/services/messaging';
import { useAuth } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import { useE2eeStore } from '@/store/e2eeStore';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import type { ConversationDetail } from '@/types/messaging';
import type { AuthorCard } from '@/types/social';
import { formatDate } from '@/utils/format';

interface Participant {
  person: AuthorCard;
  devices: E2eeDeviceInfo[];
  pins: Record<string, PinRecord>;
}

/** Security codes of everyone in a conversation, for out-of-band verification. */
export default function ConversationEncryptionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = String(id);
  const { user } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const cached = useChatStore((s) => s.conversations[conversationId]);
  const status = useE2eeStore((s) => s.status);
  const dismissNotice = useE2eeStore((s) => s.dismissNotice);
  const [verified, setVerified] = useState<Record<string, boolean>>({});

  const participants = useAsync<Participant[]>(async () => {
    const detail = cached && 'members' in cached ? (cached as ConversationDetail) : await fetchConversation(conversationId);
    const people: AuthorCard[] = detail.kind === 'direct' ? (detail.other_user ? [detail.other_user] : []) : detail.members.filter((m) => m.id !== user?.id);
    return Promise.all(
      people.map(async (person) => {
        const devices = (await getUserDevices(person.id, { force: true })).filter((d) => !d.revoked_at);
        return { person, devices, pins: await getPins(person.id) };
      }),
    );
  }, [conversationId, status]);

  useEffect(() => {
    for (const p of participants.data ?? []) dismissNotice(p.person.id);
  }, [participants.data, dismissNotice]);

  const isVerified = (p: Participant, d: E2eeDeviceInfo) => verified[d.device_id] ?? p.pins[d.device_id]?.verified ?? false;

  const toggle = async (p: Participant, d: E2eeDeviceInfo, value: boolean) => {
    setVerified((prev) => ({ ...prev, [d.device_id]: value }));
    try {
      await setDeviceVerified(p.person.id, d.device_id, value);
    } catch (error) {
      setVerified((prev) => ({ ...prev, [d.device_id]: !value }));
      toast.error(error instanceof Error ? error.message : 'Could not save');
    }
  };

  return (
    <Screen header={<ScreenHeader title="Verify security codes" fallbackHref={`/chat/${conversationId}/info`} />} scroll refreshing={participants.refreshing} onRefresh={participants.refresh}>
      <Text variant="body" color="textMuted" style={{ marginVertical: spacing.lg }}>
        Each device has a security code made from its public keys. Compare the codes below with what the other person sees under Settings → Chats → End-to-end encryption on their device — in person or on a call. Matching codes mean your messages are sealed for the right devices.
      </Text>

      <ListSection title="Your code on this device">
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text variant="caption" color="textMuted" style={{ marginBottom: spacing.xs }}>
            {describeThisDevice()}
          </Text>
          <Fingerprint value={status === 'ready' ? myFingerprint() : null} />
        </View>
      </ListSection>

      {participants.loading ? (
        <SkeletonList count={3} />
      ) : participants.error ? (
        <EmptyState compact icon="cloud-offline-outline" title="Couldn't load devices" description={participants.error} action={{ title: 'Retry', onPress: participants.reload, variant: 'secondary' }} />
      ) : (
        (participants.data ?? []).map((p) => (
          <ListSection key={p.person.id} title={p.person.display_name}>
            <View style={styles.personRow}>
              <Avatar uri={p.person.avatar_url} name={p.person.display_name} size={36} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text variant="bodyMedium">{p.person.display_name}</Text>
                <Text variant="caption" color="textMuted">
                  @{p.person.username} · {p.devices.length === 0 ? 'no encryption devices yet' : `${p.devices.length} device${p.devices.length === 1 ? '' : 's'}`}
                </Text>
              </View>
            </View>
            {p.devices.length === 0 ? (
              <Text variant="small" color="textMuted" style={{ paddingVertical: spacing.sm }}>
                {p.person.display_name} has not opened Friendzy on a device with encryption yet. Messages cannot be sent to them until they do.
              </Text>
            ) : (
              p.devices.map((d) => (
                <View key={d.device_id} style={[styles.card, { backgroundColor: colors.surface, borderColor: isVerified(p, d) ? colors.primary : colors.border, marginBottom: spacing.sm }]}>
                  <View style={styles.cardHead}>
                    <Ionicons name={d.platform === 'web' ? 'desktop-outline' : 'phone-portrait-outline'} size={18} color={colors.textMuted} />
                    <Text variant="caption" color="textMuted" style={{ marginLeft: spacing.sm, flex: 1 }}>
                      {d.platform === 'web' ? 'Browser' : d.platform === 'ios' ? 'iPhone / iPad' : 'Android'} · added {formatDate(d.created_at, 'd MMM yyyy')}
                      {p.pins[d.device_id] ? ` · first seen ${formatDate(p.pins[d.device_id].first_seen, 'd MMM')}` : ''}
                    </Text>
                  </View>
                  <View style={{ marginTop: spacing.sm }}>
                    <Fingerprint value={fingerprintOf(d)} compact />
                  </View>
                  <ListItem icon={isVerified(p, d) ? 'shield-checkmark' : 'shield-outline'} iconColor={isVerified(p, d) ? colors.primary : undefined} title="Mark as verified" subtitle="Only after comparing the code in person or on a call" switchValue={isVerified(p, d)} onSwitchChange={(v) => void toggle(p, d, v)} style={{ paddingHorizontal: 0 }} />
                </View>
              ))
            )}
          </ListSection>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center' },
  personRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
});
