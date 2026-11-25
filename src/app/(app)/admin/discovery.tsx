import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { AdminShell, Row, StatCard } from '@/features/admin/AdminShell';
import { useAsync } from '@/hooks/useAsync';
import { getDiscoveryAbuse } from '@/services/admin';
import { spacing } from '@/theme/tokens';
import type { AdminDiscoveryPerson } from '@/types/admin';
import { formatDate } from '@/utils/format';

const WINDOWS = [
  { hours: 24, label: '24h' },
  { hours: 72, label: '3d' },
  { hours: 168, label: '7d' },
  { hours: 720, label: '30d' },
];

function PeopleList({ title, hint, people, metric, empty }: { title: string; hint: string; people: AdminDiscoveryPerson[]; metric: (p: AdminDiscoveryPerson) => string; empty: string }) {
  return (
    <Card style={styles.panel}>
      <Text variant="smallMedium">{title}</Text>
      <Text variant="caption" color="textMuted" style={{ marginBottom: spacing.sm }}>
        {hint}
      </Text>
      {people.length === 0 ? (
        <Text variant="caption" color="textMuted">
          {empty}
        </Text>
      ) : (
        people.map((p) => (
          <Row key={p.id} onPress={() => router.navigate(`/admin/users/${p.id}` as never)}>
            <Avatar uri={p.avatar_url} name={p.display_name} size={32} />
            <View style={{ flex: 1 }}>
              <Text variant="smallMedium" numberOfLines={1}>
                {p.display_name}
              </Text>
              <Text variant="caption" color="textMuted" numberOfLines={1}>
                @{p.username}
              </Text>
            </View>
            <Text variant="caption" color="textSecondary">
              {metric(p)}
            </Text>
          </Row>
        ))
      )}
    </Card>
  );
}

export default function AdminDiscoveryScreen() {
  const [hours, setHours] = useState(24);
  const data = useAsync(() => getDiscoveryAbuse(hours), [hours]);
  const d = data.data;
  const actions = d?.stats.match_actions ?? {};

  return (
    <AdminShell title="Discovery & matching" refreshing={data.refreshing} onRefresh={data.refresh}>
      <View style={styles.header}>
        <Text variant="small" color="textMuted" style={{ flex: 1 }}>
          Friend-request and Meet Someone abuse signals. Open a person to warn, restrict messaging, suspend or ban them — every action is audited.
        </Text>
        {WINDOWS.map((w) => (
          <Chip key={w.hours} label={w.label} size="sm" selected={hours === w.hours} onPress={() => setHours(w.hours)} />
        ))}
      </View>
      {data.error ? <EmptyState compact icon="cloud-offline-outline" title="Couldn't load" description={data.error} action={{ title: 'Retry', onPress: () => void data.reload(), variant: 'secondary' }} /> : null}
      {!d ? (
        <SkeletonList count={6} />
      ) : (
        <>
          <View style={styles.grid}>
            <StatCard label="Searching right now" value={d.stats.searching_now} />
            <StatCard label="Live matches" value={d.stats.live_matches} />
            <StatCard label="Friend requests sent" value={d.stats.friend_requests} hint={`${d.stats.friend_requests_declined} declined`} />
            <StatCard label="Blocks" value={d.stats.blocks} tone={d.stats.blocks > 0 ? 'warning' : undefined} />
            <StatCard label="Match actions" value={Object.values(actions).reduce((a, b) => a + b, 0)} hint={Object.entries(actions).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none yet'} />
            <StatCard label="Reported via matching" value={(actions.report ?? 0) + (actions.block ?? 0)} tone={(actions.report ?? 0) + (actions.block ?? 0) > 0 ? 'danger' : 'success'} />
          </View>
          <View style={styles.grid}>
            <PeopleList title="Heavy requesters" hint="5+ friend requests in the window" people={d.top_requesters} metric={(p) => `${p.sent ?? 0} sent · ${p.declined ?? 0} declined`} empty="No one sent an unusual number of requests." />
            <PeopleList title="Most blocked" hint="Blocked by 2+ people in the window" people={d.most_blocked} metric={(p) => `${p.blocks ?? 0} blocks`} empty="No repeated blocks." />
            <PeopleList title="Reported or blocked in Meet Someone" hint="Excluded from the reporter's future matches automatically" people={d.match_reported} metric={(p) => `${p.reports ?? 0} reports`} empty="No matching reports." />
            <PeopleList title="Heavy skippers" hint="40+ match actions in the window (possible bots or mass skipping)" people={d.heavy_skippers} metric={(p) => `${p.actions ?? 0} actions`} empty="Nobody is mass-skipping." />
          </View>
          <Text variant="caption" color="textMuted" style={{ marginVertical: spacing.xl }}>
            Window since {formatDate(d.since, 'd MMM yyyy, HH:mm')}. Members under 18 are never matched and never appear in adult discovery.
          </Text>
        </>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  panel: { minWidth: 260, flexGrow: 1, flexBasis: '45%' },
});
