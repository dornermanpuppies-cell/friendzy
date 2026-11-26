import { Ionicons } from '@/components/ui/Ionicons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Pill } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListItem, ListSection } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { Fingerprint } from '@/features/chat/Fingerprint';
import { confirmAction } from '@/features/feed/usePostActions';
import { useAsync } from '@/hooks/useAsync';
import { describeThisDevice, ensureLocalDevice, listMyDevices, myFingerprint, revokeDevice } from '@/lib/e2ee/devices';
import { useAuth } from '@/store/authStore';
import { useE2eeStore } from '@/store/e2eeStore';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';
import { formatDate, timeAgo } from '@/utils/format';

const STORAGE_LABEL: Record<string, string> = {
  keychain: 'Private keys are stored on this device, protected by its keychain / keystore.',
  indexeddb: 'Private keys are stored in this browser (IndexedDB) wrapped with a non-exportable WebCrypto key.',
  localstorage: 'This browser has no IndexedDB/WebCrypto; private keys are kept in local storage. Prefer the app or a modern browser.',
};

export default function EncryptionSettingsScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const status = useE2eeStore((s) => s.status);
  const deviceId = useE2eeStore((s) => s.deviceId);
  const [busy, setBusy] = useState<string | null>(null);

  const local = useAsync(async () => (user ? ensureLocalDevice(user.id) : null), [user?.id]);
  const devices = useAsync(() => listMyDevices(), [status]);
  const others = (devices.data ?? []).filter((d) => d.device_id !== deviceId);

  const remove = (id: string, name: string | null) => {
    confirmAction('Remove this device?', `${name ?? 'This device'} will no longer receive the keys for new messages. Messages it already received stay readable there — also sign it out under Security → Active sessions.`, 'Remove', async () => {
      setBusy(id);
      try {
        await revokeDevice(id);
        devices.setData((prev) => (prev ?? []).filter((d) => d.device_id !== id));
        toast.success('Device removed');
      } catch (error) {
        toast.error(getErrorMessage(error));
      } finally {
        setBusy(null);
      }
    });
  };

  return (
    <Screen header={<ScreenHeader title="End-to-end encryption" fallbackHref="/settings/chats" />} scroll refreshing={devices.refreshing} onRefresh={devices.refresh}>
      <Text variant="body" color="textMuted" style={{ marginVertical: spacing.lg }}>
        Chat messages, photos, videos, voice notes and files are encrypted on your device before they leave it and can only be opened on the devices of the people in the chat. Friendzy’s servers store sealed envelopes they cannot read.
      </Text>

      <ListSection title="This device">
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.cardHead}>
            <Ionicons name="phone-portrait-outline" size={22} color={colors.primary} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text variant="bodyMedium">{describeThisDevice()}</Text>
              <Text variant="caption" color="textMuted">
                {status === 'ready' && local.data ? `Keys created ${formatDate(local.data.createdAt, 'd MMM yyyy')}` : status === 'error' ? 'Setup failed — pull to retry' : 'Setting up…'}
              </Text>
            </View>
            <Pill label={status === 'ready' ? 'Active' : status === 'error' ? 'Error' : 'Setting up'} tone={status === 'ready' ? 'success' : status === 'error' ? 'danger' : 'neutral'} />
          </View>
          <Text variant="caption" color="textMuted" style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
            Your security code on this device
          </Text>
          <Fingerprint value={status === 'ready' ? myFingerprint() : null} />
          <Text variant="caption" color="textMuted" style={{ marginTop: spacing.sm }}>
            Friends can compare this code with the one shown in their chat info with you. Matching codes mean nobody swapped your keys.
          </Text>
          <Text variant="caption" color="textMuted" style={{ marginTop: spacing.sm }}>
            {STORAGE_LABEL[local.data?.storage ?? 'keychain']}
          </Text>
        </View>
      </ListSection>

      <ListSection title={`Other devices${others.length ? ` · ${others.length}` : ''}`}>
        {devices.loading ? (
          <SkeletonList count={2} />
        ) : devices.error ? (
          <EmptyState compact icon="cloud-offline-outline" title="Couldn't load devices" description={devices.error} action={{ title: 'Retry', onPress: devices.reload, variant: 'secondary' }} />
        ) : others.length === 0 ? (
          <Text variant="small" color="textMuted" style={{ paddingVertical: spacing.md }}>
            Only this device can read your encrypted chats. Signing in elsewhere adds a device here; new devices cannot read messages sent before they were added.
          </Text>
        ) : (
          others.map((d) => (
            <ListItem
              key={d.device_id}
              icon={d.platform === 'web' ? 'desktop-outline' : 'phone-portrait-outline'}
              title={d.name ?? (d.platform === 'web' ? 'Browser' : d.platform === 'ios' ? 'iPhone' : 'Android')}
              subtitle={`Added ${formatDate(d.created_at, 'd MMM yyyy')}${d.last_seen_at ? ` · last seen ${timeAgo(d.last_seen_at)}` : ''}`}
              right={<Button title="Remove" size="sm" variant="secondary" onPress={() => remove(d.device_id, d.name)} disabled={busy === d.device_id} />}
              showChevron={false}
            />
          ))
        )}
      </ListSection>

      <ListSection title="What this covers">
        <Text variant="small" color="textSecondary" style={styles.para}>
          • Every new message you send or receive in 1:1 and group chats, including replies, edits, forwards, stickers, GIF and location messages, and all attachments.
        </Text>
        <Text variant="small" color="textSecondary" style={styles.para}>
          • Each message gets its own random key, sealed separately for each device in the chat and signed by the sending device. The server also refuses messages that are not encrypted for every current device.
        </Text>
      </ListSection>
      <ListSection title="What it does not cover">
        <Text variant="small" color="textSecondary" style={styles.para}>
          • Who you talk to, when, message types, file sizes, reactions and read receipts are visible to the service (needed to deliver messages).
        </Text>
        <Text variant="small" color="textSecondary" style={styles.para}>
          • Voice and video calls, lives, games, posts, stories and comments are encrypted in transit (TLS) but not end-to-end.
        </Text>
        <Text variant="small" color="textSecondary" style={styles.para}>
          • System notices in chats (for example “X joined”) and call logs are generated by the server and are not sealed.
        </Text>
        <Text variant="small" color="textSecondary" style={styles.para}>
          • There is no automatic key rotation yet: if a device’s private key is ever extracted, messages sent to that device could be read with it. Remove lost devices here and sign them out.
        </Text>
        <Text variant="small" color="textSecondary" style={styles.para}>
          • Keys are trusted on first use. Compare security codes in person or on a call to rule out a swapped key, and watch for “security code changed” notices.
        </Text>
        <Text variant="small" color="textSecondary" style={styles.para}>
          • Decrypted media is cached in this app’s private storage so it opens quickly; it is removed when the app data is cleared.
        </Text>
      </ListSection>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.lg },
  cardHead: { flexDirection: 'row', alignItems: 'center' },
  para: { paddingVertical: spacing.xs },
});
