import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { AdminShell, MiniBars, StatCard } from '@/features/admin/AdminShell';
import { useAsync } from '@/hooks/useAsync';
import { getAdminAnalytics, getAdminOverview } from '@/services/admin';
import { formatMoney } from '@/services/wallet';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { formatCount, formatDate } from '@/utils/format';

export default function AdminOverviewScreen() {
  const { colors } = useTheme();
  const [days, setDays] = useState(30);
  const overview = useAsync(() => getAdminOverview(), []);
  const analytics = useAsync(() => getAdminAnalytics(days), [days]);
  const o = overview.data;
  const a = analytics.data;

  return (
    <AdminShell title="Administration" refreshing={overview.refreshing} onRefresh={() => Promise.all([overview.refresh(), analytics.refresh()])}>
      {overview.error ? <EmptyState compact icon="cloud-offline-outline" title="Couldn't load" description={overview.error} action={{ title: 'Retry', onPress: () => void overview.reload(), variant: 'secondary' }} /> : null}
      {!o ? (
        <SkeletonList count={6} />
      ) : (
        <>
          <Text variant="h4" style={styles.section}>
            Users
          </Text>
          <View style={styles.grid}>
            <StatCard label="Total users" value={o.users.total} />
            <StatCard label="New today" value={o.users.new_today} hint={`${o.users.new_7d} this week · ${o.users.new_30d} this month`} />
            <StatCard label="Online now" value={o.users.online_now} hint={`${o.users.active_24h} active in 24h`} />
            <StatCard label="Premium" value={o.users.premium} hint={`${o.users.verified} verified`} />
            <StatCard label="Suspended / banned" value={`${o.users.suspended} / ${o.users.banned}`} tone={o.users.banned > 0 ? 'warning' : undefined} />
          </View>
          <Text variant="h4" style={styles.section}>
            Moderation
          </Text>
          <View style={styles.grid}>
            <StatCard label="Open reports" value={o.moderation.open_reports} tone={o.moderation.open_reports > 0 ? 'danger' : 'success'} hint={`${o.moderation.in_review} in review`} />
            <StatCard label="Pending verifications" value={o.moderation.pending_verifications} tone={o.moderation.pending_verifications > 0 ? 'warning' : undefined} />
            <StatCard label="Active sanctions" value={o.moderation.active_sanctions} />
            <StatCard label="Lives now" value={o.content.lives_now} hint={`${o.content.lives_today} started today`} />
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.sm }}>
            <Button title="Review reports" size="sm" leftIcon="flag-outline" onPress={() => router.navigate('/admin/reports' as never)} />
            <Button title="Verification queue" size="sm" variant="secondary" leftIcon="checkmark-circle-outline" onPress={() => router.navigate('/admin/verification' as never)} />
            <Button title="Live moderation" size="sm" variant="secondary" leftIcon="radio-outline" onPress={() => router.navigate('/admin/lives' as never)} />
          </View>
          <Text variant="h4" style={styles.section}>
            Content today
          </Text>
          <View style={styles.grid}>
            <StatCard label="Posts" value={o.content.posts_today} hint={`${o.content.removed_posts} removed overall`} />
            <StatCard label="Videos" value={o.content.videos_today} hint={`${o.content.removed_videos} removed overall`} />
            <StatCard label="Stories" value={o.content.stories_today} />
            <StatCard label="Messages" value={o.content.messages_today} />
            <StatCard label="Game rooms" value={o.content.games_today} />
          </View>
          <Text variant="h4" style={styles.section}>
            Finance (30 days)
          </Text>
          <View style={styles.grid}>
            <StatCard label="Coin revenue" value={formatMoney(o.finance.revenue_cents_30d)} hint={`${formatCount(o.finance.coins_purchased_30d)} coins sold`} />
            <StatCard label="Gift volume" value={`${formatCount(o.finance.gifts_coins_30d)} coins`} hint={`${formatCount(o.finance.commission_coins_30d)} commission`} />
            <StatCard label="Pending withdrawals" value={o.finance.pending_withdrawals} hint={formatMoney(o.finance.pending_withdrawal_cents)} tone={o.finance.pending_withdrawals > 0 ? 'warning' : undefined} />
            <StatCard label="Coins in circulation" value={formatCount(o.finance.coins_in_circulation)} hint={`${formatCount(o.finance.creator_earnings_outstanding)} creator earnings outstanding`} />
            <StatCard label="Payouts" value={o.finance.payouts_enabled ? 'Enabled' : 'Disabled'} tone={o.finance.payouts_enabled ? 'success' : 'warning'} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing['2xl'], marginBottom: spacing.sm, gap: spacing.sm, flexWrap: 'wrap' }}>
            <Text variant="h4" style={{ flex: 1 }}>
              Analytics
            </Text>
            {[7, 30, 90].map((d) => (
              <Chip key={d} label={`${d}d`} size="sm" selected={days === d} onPress={() => setDays(d)} />
            ))}
          </View>
          {!a ? (
            <SkeletonList count={3} />
          ) : (
            <View style={styles.grid}>
              {(
                [
                  ['Sign-ups', a.series.map((s) => s.signups), colors.primary],
                  ['Posts', a.series.map((s) => s.posts), colors.blue],
                  ['Videos', a.series.map((s) => s.videos), colors.accent],
                  ['Lives', a.series.map((s) => s.lives), colors.warning],
                  ['Messages', a.series.map((s) => s.messages), colors.success],
                  ['Gift coins', a.series.map((s) => s.gifts_coins), colors.primary],
                  ['Purchases (cents)', a.series.map((s) => s.purchase_cents), colors.success],
                  ['Reports', a.series.map((s) => s.reports), colors.danger],
                  ['New Premium', a.series.map((s) => s.new_premium), colors.accent],
                ] as [string, number[], string][]
              ).map(([label, data, color]) => (
                <Card key={label} style={styles.chart}>
                  <Text variant="smallMedium">{label}</Text>
                  <Text variant="caption" color="textMuted">
                    {formatCount(data.reduce((x, y) => x + y, 0))} total · {formatDate(a.series[0]?.day, 'd MMM')} → {formatDate(a.series[a.series.length - 1]?.day, 'd MMM')}
                  </Text>
                  <MiniBars data={data} color={color} />
                </Card>
              ))}
              <Card style={styles.chart}>
                <Text variant="smallMedium">Top countries</Text>
                {a.top_countries.length === 0 ? (
                  <Text variant="caption" color="textMuted">
                    No data yet
                  </Text>
                ) : (
                  a.top_countries.map((c) => (
                    <Text key={c.country_code} variant="caption" color="textMuted">
                      {c.country_code}: {c.users}
                    </Text>
                  ))
                )}
              </Card>
              <Card style={styles.chart}>
                <Text variant="smallMedium">Top creators by gift income</Text>
                {a.top_creators.length === 0 ? (
                  <Text variant="caption" color="textMuted">
                    No gifts yet
                  </Text>
                ) : (
                  a.top_creators.map((c) => (
                    <Text key={c.id} variant="caption" color="textMuted">
                      @{c.username}: {formatCount(c.coins)} coins
                    </Text>
                  ))
                )}
              </Card>
              <Card style={styles.chart}>
                <Text variant="smallMedium">Games played</Text>
                {a.games.length === 0 ? (
                  <Text variant="caption" color="textMuted">
                    No games yet
                  </Text>
                ) : (
                  a.games.map((g) => (
                    <Text key={g.game} variant="caption" color="textMuted">
                      {g.game.replace(/_/g, ' ')}: {g.rooms} rooms
                    </Text>
                  ))
                )}
              </Card>
            </View>
          )}
          <Text variant="caption" color="textMuted" style={{ marginVertical: spacing.xl }}>
            Generated {formatDate(o.generated_at, 'd MMM yyyy, HH:mm')}. All admin actions are recorded in the audit log.
          </Text>
        </>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.lg, marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chart: { minWidth: 220, flexGrow: 1, flexBasis: '30%' },
});
