import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { LockedPeopleList } from '@/features/premium/LockedPeopleList';
import { useAsync } from '@/hooks/useAsync';
import { getProfileViewers } from '@/services/premium';
import { spacing } from '@/theme/tokens';
import { timeAgo } from '@/utils/format';

export default function ProfileViewersScreen() {
  const viewers = useAsync(() => getProfileViewers(50), []);
  return (
    <Screen header={<ScreenHeader title="Profile visitors" fallbackHref="/premium" />} scroll padded refreshing={viewers.refreshing} onRefresh={() => void viewers.refresh()}>
      <Text variant="small" color="textMuted" style={{ marginTop: spacing.lg }}>
        People who opened your profile in the last 30 days.
      </Text>
      <LockedPeopleList data={viewers.data} loading={viewers.loading} error={viewers.error} lockedTitle="people viewed your profile" emptyTitle="No visitors yet" emptyDescription="Share your profile or post something to get noticed." subtitle={(v) => `Viewed ${timeAgo(v.viewed_at)}${v.views > 1 ? ` · ${v.views} visits` : ''}`} onRetry={() => void viewers.reload()} />
    </Screen>
  );
}
