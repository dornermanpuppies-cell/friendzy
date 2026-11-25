import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { LockedPeopleList } from '@/features/premium/LockedPeopleList';
import { useAsync } from '@/hooks/useAsync';
import { getMatchAdmirers } from '@/services/premium';
import { spacing } from '@/theme/tokens';
import { timeAgo } from '@/utils/format';

export default function AdmirersScreen() {
  const admirers = useAsync(() => getMatchAdmirers(50), []);
  return (
    <Screen header={<ScreenHeader title="Who liked you" fallbackHref="/premium" />} scroll padded refreshing={admirers.refreshing} onRefresh={() => void admirers.refresh()}>
      <Text variant="small" color="textMuted" style={{ marginTop: spacing.lg }}>
        People who chose you in Random match and are waiting for your answer.
      </Text>
      <LockedPeopleList data={admirers.data} loading={admirers.loading} error={admirers.error} lockedTitle="people liked you" emptyTitle="Nobody yet" emptyDescription="Keep matching — when someone picks you, they appear here." subtitle={(v) => `Liked you ${timeAgo(v.liked_at)}`} onRetry={() => void admirers.reload()} />
    </Screen>
  );
}
