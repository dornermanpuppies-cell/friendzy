import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { ProfileRow } from '@/features/profile/ProfileRow';
import { useAsync } from '@/hooks/useAsync';
import { listBlockedUsers, unblockUser } from '@/services/safety';
import { spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';
import { timeAgo } from '@/utils/format';

export default function BlockedAccountsScreen() {
  const toast = useToast();
  const blocked = useAsync(() => listBlockedUsers(), []);
  const [busyId, setBusyId] = useState<string | null>(null);

  const unblock = async (id: string) => {
    setBusyId(id);
    try {
      await unblockUser(id);
      blocked.setData((prev) => (prev ?? []).filter((p) => p.id !== id));
      toast.success('Unblocked');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen header={<ScreenHeader title="Blocked accounts" fallbackHref="/settings" />} scroll refreshing={blocked.refreshing} onRefresh={blocked.refresh}>
      <Text variant="body" color="textMuted" style={{ marginVertical: spacing.lg }}>
        {"Blocked people can't find your profile, follow you, send requests or contact you. They are not notified."}
      </Text>
      {blocked.loading ? (
        <SkeletonList count={4} />
      ) : blocked.error ? (
        <EmptyState compact icon="cloud-offline-outline" title="Couldn't load blocked accounts" description={blocked.error} action={{ title: 'Retry', onPress: blocked.reload, variant: 'secondary' }} />
      ) : blocked.data && blocked.data.length > 0 ? (
        blocked.data.map((p) => (
          <ProfileRow
            key={p.id}
            profile={p}
            subtitle={`Blocked ${timeAgo(p.blocked_at)}`}
            showBio={false}
            onPress={() => undefined}
            right={<Button title="Unblock" size="sm" variant="secondary" onPress={() => unblock(p.id)} disabled={busyId === p.id} />}
          />
        ))
      ) : (
        <EmptyState compact icon="ban-outline" title="No blocked accounts" description="You can block someone from the menu on their profile." />
      )}
    </Screen>
  );
}
