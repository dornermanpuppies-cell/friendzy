import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { AdminShell, Row } from '@/features/admin/AdminShell';
import { useAsync } from '@/hooks/useAsync';
import { listCoinPurchases, listSubscriptions, listTransactions, listWithdrawals, reviewWithdrawal } from '@/services/admin';
import { formatMoney } from '@/services/wallet';
import { spacing } from '@/theme/tokens';
import type { AdminWithdrawal } from '@/types/admin';
import { getErrorMessage } from '@/utils/errors';
import { formatCount, formatDate, timeAgo } from '@/utils/format';

type Tab = 'withdrawals' | 'transactions' | 'purchases' | 'subscriptions';

export default function AdminFinanceScreen() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('withdrawals');
  const [status, setStatus] = useState('pending');
  const [target, setTarget] = useState<{ w: AdminWithdrawal; decision: 'approved' | 'paid' | 'rejected' } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const withdrawals = useAsync(() => listWithdrawals(status, 100), [status, tab], { enabled: tab === 'withdrawals' });
  const transactions = useAsync(() => listTransactions({ limit: 100 }), [tab], { enabled: tab === 'transactions' });
  const purchases = useAsync(() => listCoinPurchases(100), [tab], { enabled: tab === 'purchases' });
  const subscriptions = useAsync(() => listSubscriptions(null, 100), [tab], { enabled: tab === 'subscriptions' });

  const review = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await reviewWithdrawal(target.w.id, target.decision, note.trim() || undefined);
      toast.success(`Withdrawal ${target.decision}`);
      setTarget(null);
      setNote('');
      await withdrawals.refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell title="Finance" refreshing={withdrawals.refreshing || transactions.refreshing} onRefresh={() => Promise.all([withdrawals.refresh(), transactions.refresh()])}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {(['withdrawals', 'transactions', 'purchases', 'subscriptions'] as Tab[]).map((t) => (
          <Chip key={t} label={t} size="sm" selected={tab === t} onPress={() => setTab(t)} />
        ))}
      </View>

      {tab === 'withdrawals' ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
            {['pending', 'approved', 'paid', 'rejected', 'cancelled', 'all'].map((s) => (
              <Chip key={s} label={s} size="sm" selected={status === s} onPress={() => setStatus(s)} />
            ))}
          </View>
          <View style={{ marginTop: spacing.md }}>
            {withdrawals.loading ? (
              <SkeletonList count={5} />
            ) : withdrawals.error ? (
              <EmptyState compact icon="lock-closed-outline" title="Not available" description={withdrawals.error} />
            ) : !withdrawals.data || withdrawals.data.length === 0 ? (
              <EmptyState compact icon="cash-outline" title="No withdrawals" description={`Nothing ${status === 'all' ? '' : status} right now.`} />
            ) : (
              withdrawals.data.map((w) => (
                <Row key={w.id} onPress={() => router.navigate(`/admin/users/${w.user_id}` as never)}>
                  <Avatar uri={w.user.avatar_url} name={w.user.display_name} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodySemibold">
                      {formatCount(w.coins)} coins → {formatMoney(w.amount_cents, w.currency)} · {w.status}
                    </Text>
                    <Text variant="caption" color="textMuted" numberOfLines={2}>
                      @{w.user.username} · {w.user.email ?? ''} · age {w.user.age ?? '—'} · {String((w.method as { type?: string }).type ?? 'method')}: {Object.entries(w.method).filter(([k]) => k !== 'type').map(([k, v]) => `${k} ${String(v)}`).join(', ')} · {timeAgo(w.created_at)}
                      {w.note ? ` · ${w.note}` : ''}
                    </Text>
                  </View>
                  {w.status === 'pending' ? <Button title="Approve" size="sm" variant="ghost" onPress={() => setTarget({ w, decision: 'approved' })} /> : null}
                  {w.status === 'pending' || w.status === 'approved' ? (
                    <>
                      <Button title="Mark paid" size="sm" onPress={() => setTarget({ w, decision: 'paid' })} />
                      <Button title="Reject" size="sm" variant="ghost" onPress={() => setTarget({ w, decision: 'rejected' })} />
                    </>
                  ) : null}
                </Row>
              ))
            )}
          </View>
        </>
      ) : tab === 'transactions' ? (
        <View style={{ marginTop: spacing.md }}>
          {transactions.loading ? (
            <SkeletonList count={8} />
          ) : transactions.error ? (
            <EmptyState compact icon="lock-closed-outline" title="Not available" description={transactions.error} />
          ) : (
            (transactions.data ?? []).map((t) => (
              <Row key={t.id} onPress={() => router.navigate(`/admin/users/${t.user_id}` as never)}>
                <Avatar uri={t.user?.avatar_url} name={t.user?.display_name} size={36} />
                <View style={{ flex: 1 }}>
                  <Text variant="small">
                    #{t.id} · {t.kind} · {t.coins >= 0 ? '+' : ''}
                    {formatCount(t.coins)} coins
                  </Text>
                  <Text variant="caption" color="textMuted" numberOfLines={1}>
                    @{t.user?.username ?? '—'} · balance {formatCount(t.balance_after)} · earnings {formatCount(t.earnings_after)} · {t.reference_type ?? ''} {t.reference_id ? t.reference_id.slice(0, 8) : ''} · {formatDate(t.created_at, 'd MMM, HH:mm')}
                  </Text>
                </View>
              </Row>
            ))
          )}
        </View>
      ) : tab === 'purchases' ? (
        <View style={{ marginTop: spacing.md }}>
          {purchases.loading ? (
            <SkeletonList count={6} />
          ) : purchases.error ? (
            <EmptyState compact icon="lock-closed-outline" title="Not available" description={purchases.error} />
          ) : (purchases.data ?? []).length === 0 ? (
            <EmptyState compact icon="cart-outline" title="No purchases yet" description="Coin purchases confirmed by the RevenueCat webhook appear here." />
          ) : (
            (purchases.data ?? []).map((p) => (
              <Row key={String(p.id)} onPress={() => router.navigate(`/admin/users/${String(p.user_id)}` as never)}>
                <View style={{ flex: 1 }}>
                  <Text variant="small">
                    {String(p.sku)} · {formatCount(Number(p.coins) + Number(p.bonus_coins))} coins · {p.price_cents ? formatMoney(Number(p.price_cents), String(p.currency ?? 'USD')) : '—'} · {String(p.status)}
                  </Text>
                  <Text variant="caption" color="textMuted" numberOfLines={1}>
                    @{(p.user as { username?: string })?.username ?? '—'} · {String(p.store)} · {String(p.environment)} · {String(p.transaction_id)} · {formatDate(String(p.created_at), 'd MMM, HH:mm')}
                  </Text>
                </View>
              </Row>
            ))
          )}
        </View>
      ) : (
        <View style={{ marginTop: spacing.md }}>
          {subscriptions.loading ? (
            <SkeletonList count={6} />
          ) : subscriptions.error ? (
            <EmptyState compact icon="lock-closed-outline" title="Not available" description={subscriptions.error} />
          ) : (subscriptions.data ?? []).length === 0 ? (
            <EmptyState compact icon="diamond-outline" title="No subscriptions yet" description="Premium subscriptions synced from RevenueCat appear here." />
          ) : (
            (subscriptions.data ?? []).map((s) => (
              <Row key={String(s.user_id)} onPress={() => router.navigate(`/admin/users/${String(s.user_id)}` as never)}>
                <View style={{ flex: 1 }}>
                  <Text variant="small">
                    @{(s.user as { username?: string })?.username ?? '—'} · {String(s.status)}
                    {s.is_premium ? ' · active entitlement' : ''}
                  </Text>
                  <Text variant="caption" color="textMuted" numberOfLines={1}>
                    {String(s.product_id ?? '')} · {String(s.store)} · {String(s.environment)} · expires {s.expires_at ? formatDate(String(s.expires_at), 'd MMM yyyy') : '—'} · renews {String(s.will_renew)}
                  </Text>
                </View>
              </Row>
            ))
          )}
        </View>
      )}

      <Sheet visible={Boolean(target)} onClose={() => setTarget(null)} title={target ? `${target.decision === 'paid' ? 'Mark as paid' : target.decision === 'approved' ? 'Approve' : 'Reject'} withdrawal` : ''} subtitle={target ? `${formatCount(target.w.coins)} coins → ${formatMoney(target.w.amount_cents, target.w.currency)} for @${target.w.user.username}` : undefined}>
        <Text variant="small" color="textMuted">
          {target?.decision === 'paid' ? 'Confirm only after the transfer left your payout account. Coins are deducted from the creator’s pending balance.' : target?.decision === 'rejected' ? 'Coins are returned to the creator’s available earnings and they are notified.' : 'Approval tells the creator the request passed review; the payout still has to be sent and marked paid.'}
        </Text>
        <Input label="Note (optional, shown to the creator)" value={note} onChangeText={setNote} multiline maxLength={300} containerStyle={{ marginTop: spacing.md }} />
        <Button title="Confirm" onPress={() => void review()} loading={busy} fullWidth style={{ marginVertical: spacing.md }} />
      </Sheet>
    </AdminShell>
  );
}
