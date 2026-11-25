import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { ProfileRow } from '@/features/profile/ProfileRow';
import { useAsync } from '@/hooks/useAsync';
import {
  cancelFriendRequest,
  listIncomingFollowRequests,
  listIncomingFriendRequests,
  listOutgoingFriendRequests,
  respondFollowRequest,
  respondFriendRequest,
} from '@/services/relationships';
import { useAuth } from '@/store/authStore';
import { useBadgeStore } from '@/store/badgeStore';
import { spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';
import { timeAgo } from '@/utils/format';

type Tab = 'friends' | 'follows' | 'sent';

export default function RequestsScreen() {
  const { user } = useAuth();
  const toast = useToast();
  const refreshBadges = useBadgeStore((s) => s.refresh);
  const [tab, setTab] = useState<Tab>('friends');
  const [busyId, setBusyId] = useState<string | null>(null);

  const incoming = useAsync(() => (user ? listIncomingFriendRequests(user.id) : Promise.resolve([])), [user?.id]);
  const follows = useAsync(() => (user ? listIncomingFollowRequests(user.id) : Promise.resolve([])), [user?.id]);
  const outgoing = useAsync(() => (user ? listOutgoingFriendRequests(user.id) : Promise.resolve([])), [user?.id]);

  const act = async (id: string, fn: () => Promise<void>, success: string) => {
    setBusyId(id);
    try {
      await fn();
      toast.success(success);
      await Promise.all([incoming.refresh(), follows.refresh(), outgoing.refresh()]);
      if (user) void refreshBadges(user.id);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const current = tab === 'friends' ? incoming : tab === 'follows' ? follows : outgoing;

  return (
    <Screen header={<ScreenHeader title="Requests" fallbackHref="/home" />} scroll refreshing={current.refreshing} onRefresh={current.refresh}>
      <View style={styles.tabs}>
        <Chip label={`Friend requests${incoming.data?.length ? ` · ${incoming.data.length}` : ''}`} selected={tab === 'friends'} onPress={() => setTab('friends')} size="sm" />
        <Chip label={`Follow requests${follows.data?.length ? ` · ${follows.data.length}` : ''}`} selected={tab === 'follows'} onPress={() => setTab('follows')} size="sm" />
        <Chip label={`Sent${outgoing.data?.length ? ` · ${outgoing.data.length}` : ''}`} selected={tab === 'sent'} onPress={() => setTab('sent')} size="sm" />
      </View>

      {current.loading ? (
        <SkeletonList count={5} />
      ) : current.error ? (
        <EmptyState compact icon="cloud-offline-outline" title="Couldn't load requests" description={current.error} action={{ title: 'Retry', onPress: current.reload, variant: 'secondary' }} />
      ) : tab === 'friends' ? (
        incoming.data && incoming.data.length > 0 ? (
          incoming.data.map((r) =>
            r.profile ? (
              <View key={r.id} style={styles.item}>
                <ProfileRow profile={r.profile} subtitle={`@${r.profile.username} · ${timeAgo(r.created_at)}`} showBio={false} />
                {r.message ? (
                  <Text variant="small" color="textSecondary" style={styles.message}>
                    “{r.message}”
                  </Text>
                ) : null}
                <View style={styles.actions}>
                  <Button title="Accept" size="sm" leftIcon="checkmark" onPress={() => act(r.id, () => respondFriendRequest(r.id, true), 'You are now friends')} disabled={busyId === r.id} />
                  <Button title="Decline" size="sm" variant="secondary" onPress={() => act(r.id, () => respondFriendRequest(r.id, false), 'Request declined')} disabled={busyId === r.id} />
                </View>
              </View>
            ) : null,
          )
        ) : (
          <EmptyState compact icon="people-outline" title="No friend requests" description="When someone adds you as a friend, you can accept or decline here." />
        )
      ) : tab === 'follows' ? (
        follows.data && follows.data.length > 0 ? (
          follows.data.map((r) =>
            r.profile ? (
              <View key={r.id} style={styles.item}>
                <ProfileRow profile={r.profile} subtitle={`wants to follow you · ${timeAgo(r.created_at)}`} showBio={false} />
                <View style={styles.actions}>
                  <Button title="Approve" size="sm" leftIcon="checkmark" onPress={() => act(r.id, () => respondFollowRequest(r.id, true), 'Follower approved')} disabled={busyId === r.id} />
                  <Button title="Decline" size="sm" variant="secondary" onPress={() => act(r.id, () => respondFollowRequest(r.id, false), 'Request declined')} disabled={busyId === r.id} />
                </View>
              </View>
            ) : null,
          )
        ) : (
          <EmptyState compact icon="lock-closed-outline" title="No follow requests" description="Follow requests appear here when your account is private." />
        )
      ) : outgoing.data && outgoing.data.length > 0 ? (
        outgoing.data.map((r) =>
          r.profile ? (
            <View key={r.id} style={styles.item}>
              <ProfileRow
                profile={r.profile}
                subtitle={`Sent ${timeAgo(r.created_at)}`}
                showBio={false}
                right={<Button title="Cancel" size="sm" variant="secondary" onPress={() => act(r.id, () => cancelFriendRequest(r.id), 'Request cancelled')} disabled={busyId === r.id} />}
              />
            </View>
          ) : null,
        )
      ) : (
        <EmptyState compact icon="paper-plane-outline" title="No pending requests" description="Friend requests you send will be listed here until they are answered." />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.lg },
  item: { marginBottom: spacing.sm },
  message: { marginLeft: spacing['6xl'], marginBottom: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginLeft: spacing['6xl'] },
});
