import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListItem, ListSection } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { listMySessions, revokeOtherSessions, revokeSession } from '@/services/account';
import { spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';
import { describeUserAgent, timeAgo } from '@/utils/format';

export default function SessionsScreen() {
  const toast = useToast();
  const sessions = useAsync(() => listMySessions(), []);
  const [busyId, setBusyId] = useState<string | null>(null);

  const revoke = async (id: string) => {
    setBusyId(id);
    try {
      await revokeSession(id);
      sessions.setData((prev) => (prev ?? []).filter((s) => s.id !== id));
      toast.success('Session signed out');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const revokeOthers = async () => {
    setBusyId('others');
    try {
      await revokeOtherSessions();
      await sessions.refresh();
      toast.success('Signed out everywhere else');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const others = (sessions.data ?? []).filter((s) => !s.is_current);

  return (
    <Screen header={<ScreenHeader title="Active sessions" fallbackHref="/settings/security" />} scroll refreshing={sessions.refreshing} onRefresh={sessions.refresh}>
      <Text variant="body" color="textMuted" style={{ marginVertical: spacing.lg }}>
        {"These are the devices and browsers currently signed in to your account. Sign out any you don't recognise and change your password."}
      </Text>
      {sessions.loading ? (
        <SkeletonList count={3} />
      ) : sessions.error ? (
        <EmptyState compact icon="cloud-offline-outline" title="Couldn't load sessions" description={sessions.error} action={{ title: 'Retry', onPress: sessions.reload, variant: 'secondary' }} />
      ) : (
        <>
          <ListSection title="Devices">
            {(sessions.data ?? []).map((s) => (
              <ListItem
                key={s.id}
                icon={/android|ios|iphone|ipad|friendzy/i.test(s.user_agent ?? '') ? 'phone-portrait-outline' : 'desktop-outline'}
                title={describeUserAgent(s.user_agent)}
                subtitle={`${s.is_current ? 'This device' : `Last active ${timeAgo(s.updated_at ?? s.created_at)}`}${s.ip ? ` · ${s.ip}` : ''}`}
                right={s.is_current ? <Pill label="Current" tone="success" /> : <Button title="Sign out" size="sm" variant="secondary" onPress={() => revoke(s.id)} disabled={busyId === s.id} />}
                showChevron={false}
              />
            ))}
          </ListSection>
          {others.length > 0 ? <Button title={`Sign out of ${others.length} other device${others.length === 1 ? '' : 's'}`} variant="outline" onPress={revokeOthers} loading={busyId === 'others'} /> : null}
        </>
      )}
    </Screen>
  );
}
