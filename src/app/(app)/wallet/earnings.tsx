import { Ionicons } from '@/components/ui/Ionicons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Sheet } from '@/components/ui/Sheet';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { cancelWithdrawal, formatMoney, getEarningsSummary, requestWithdrawal } from '@/services/wallet';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';
import { formatCount, formatDate } from '@/utils/format';

const STATUS_COLOR: Record<string, string> = { pending: palette.warning, approved: palette.info, paid: palette.success, rejected: palette.danger, cancelled: palette.ink4 };

export default function EarningsScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const summary = useAsync(() => getEarningsSummary(), []);
  const [open, setOpen] = useState(false);
  const [coins, setCoins] = useState('');
  const [method, setMethod] = useState<'bank' | 'paypal'>('bank');
  const [details, setDetails] = useState({ account_name: '', iban: '', paypal_email: '' });
  const [busy, setBusy] = useState(false);

  const s = summary.data;
  const w = s?.wallet;
  const coinValue = w?.coin_value_cents ?? 0.5;
  const amount = Number(coins) || 0;

  const submit = async () => {
    setBusy(true);
    try {
      const payload: { type: 'bank' | 'paypal'; [key: string]: string } = method === 'bank' ? { type: 'bank', account_name: details.account_name.trim(), iban: details.iban.replace(/\s+/g, '') } : { type: 'paypal', paypal_email: details.paypal_email.trim() };
      await requestWithdrawal(amount, payload);
      toast.success('Withdrawal requested', 'Our finance team reviews requests within a few business days.');
      setOpen(false);
      setCoins('');
      await summary.refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const max = Math.max(1, ...(s?.daily ?? []).map((d) => d.coins));

  return (
    <Screen header={<ScreenHeader title="Creator earnings" fallbackHref="/wallet" />} scroll padded refreshing={summary.refreshing} onRefresh={() => void summary.refresh()}>
      {summary.loading || !s || !w ? (
        <SkeletonList count={5} />
      ) : (
        <>
          <View style={styles.grid}>
            <Card style={styles.stat}>
              <Text variant="h3">{formatCount(w.earnings_balance)}</Text>
              <Text variant="caption" color="textMuted">
                Available coins · ≈ {formatMoney(Math.floor(w.earnings_balance * coinValue))}
              </Text>
            </Card>
            <Card style={styles.stat}>
              <Text variant="h3">{formatCount(w.pending_earnings)}</Text>
              <Text variant="caption" color="textMuted">
                Pending payout
              </Text>
            </Card>
            <Card style={styles.stat}>
              <Text variant="h3">{formatCount(s.coins_30d)}</Text>
              <Text variant="caption" color="textMuted">
                Earned in 30 days ({s.gifts_30d} gifts)
              </Text>
            </Card>
            <Card style={styles.stat}>
              <Text variant="h3">{formatCount(w.lifetime_withdrawn)}</Text>
              <Text variant="caption" color="textMuted">
                Lifetime withdrawn
              </Text>
            </Card>
          </View>

          <Card style={{ marginTop: spacing.md }}>
            <Text variant="smallMedium">Last 30 days</Text>
            <View style={styles.bars}>
              {s.daily.map((d) => (
                <View key={d.day} style={styles.barCol}>
                  <View style={[styles.bar, { height: Math.max(2, (d.coins / max) * 70), backgroundColor: colors.primary }]} />
                </View>
              ))}
            </View>
            <Text variant="caption" color="textMuted">
              You keep {Math.round((1 - w.commission_rate) * 100)}% of every gift. 1 coin ≈ {formatMoney(coinValue)}.
            </Text>
          </Card>

          <View style={[styles.payout, { backgroundColor: w.payouts_enabled ? colors.primarySoft : colors.surfaceMuted }]}>
            <Ionicons name={w.payouts_enabled ? 'cash-outline' : 'time-outline'} size={22} color={w.payouts_enabled ? colors.primary : colors.textMuted} />
            <View style={{ flex: 1, marginHorizontal: spacing.md }}>
              <Text variant="smallMedium">{w.payouts_enabled ? 'Withdrawals are open' : 'Withdrawals open soon'}</Text>
              <Text variant="caption" color="textMuted">
                {w.payouts_enabled ? `Minimum ${formatCount(w.min_withdrawal_coins)} coins. Adults only; identity checks may apply.` : 'Payouts start once the payout provider and identity verification are live. Your earnings are safe and keep accumulating.'}
              </Text>
            </View>
            <Button title="Withdraw" size="sm" disabled={!w.payouts_enabled || w.earnings_balance < w.min_withdrawal_coins} onPress={() => setOpen(true)} />
          </View>

          {s.top_gifts.length > 0 ? (
            <>
              <Text variant="h4" style={styles.section}>
                Top gifts
              </Text>
              <View style={styles.wrap}>
                {s.top_gifts.map((g) => (
                  <Chip key={g.name} label={`${g.emoji} ${g.name} ×${g.count} · ${formatCount(g.coins)}`} size="sm" />
                ))}
              </View>
            </>
          ) : null}

          <Text variant="h4" style={styles.section}>
            Top supporters
          </Text>
          {s.top_supporters.length === 0 ? (
            <Text variant="small" color="textMuted">
              Nobody has gifted you yet. Go live or post videos to connect with supporters.
            </Text>
          ) : (
            s.top_supporters.map((t, i) => (
              <View key={t.user.id} style={[styles.row, { borderBottomColor: colors.border }]}>
                <Text variant="bodySemibold" color="textMuted" style={{ width: 24 }}>
                  {i + 1}
                </Text>
                <Avatar uri={t.user.avatar_url} name={t.user.display_name} size={36} />
                <Text variant="smallMedium" style={{ flex: 1, marginLeft: spacing.sm }}>
                  {t.user.display_name}
                </Text>
                <Text variant="small" color="textMuted">
                  {formatCount(t.coins)} coins · {t.gifts} gifts
                </Text>
              </View>
            ))
          )}

          <Text variant="h4" style={styles.section}>
            Withdrawals
          </Text>
          {s.withdrawals.length === 0 ? (
            <EmptyState compact emoji="🏦" title="No withdrawals yet" description="Requests and payouts will be listed here with their status." />
          ) : (
            s.withdrawals.map((wd) => (
              <View key={wd.id} style={[styles.row, { borderBottomColor: colors.border }]}>
                <View style={[styles.dot, { backgroundColor: STATUS_COLOR[wd.status] ?? colors.textMuted }]} />
                <View style={{ flex: 1, marginLeft: spacing.sm }}>
                  <Text variant="smallMedium">
                    {formatCount(wd.coins)} coins → {formatMoney(wd.amount_cents, wd.currency)}
                  </Text>
                  <Text variant="caption" color="textMuted">
                    {wd.status}
                    {wd.note ? ` · ${wd.note}` : ''} · {formatDate(wd.paid_at ?? wd.created_at, 'd MMM yyyy')}
                  </Text>
                </View>
                {wd.status === 'pending' ? <Button title="Cancel" size="sm" variant="ghost" onPress={async () => { try { await cancelWithdrawal(wd.id); await summary.refresh(); } catch (e) { toast.error(getErrorMessage(e)); } }} /> : null}
              </View>
            ))
          )}
        </>
      )}

      <Sheet visible={open} onClose={() => setOpen(false)} title="Request a withdrawal" subtitle={w ? `Available: ${formatCount(w.earnings_balance)} coins` : undefined} footer={<Button title={amount > 0 ? `Withdraw ${formatCount(amount)} coins (≈ ${formatMoney(Math.floor(amount * coinValue))})` : 'Enter an amount'} fullWidth disabled={!w || amount < (w.min_withdrawal_coins ?? 0) || amount > (w.earnings_balance ?? 0) || (method === 'bank' ? !details.account_name.trim() || details.iban.replace(/\s+/g, '').length < 8 : !/\S+@\S+\.\S+/.test(details.paypal_email))} loading={busy} onPress={() => void submit()} />}>
        <Input label="Coins" value={coins} onChangeText={(v) => setCoins(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" helper={w ? `Minimum ${formatCount(w.min_withdrawal_coins)} coins` : undefined} />
        <View style={[styles.wrap, { marginTop: spacing.md }]}>
          <Chip label="Bank transfer" icon="business-outline" size="sm" selected={method === 'bank'} onPress={() => setMethod('bank')} />
          <Chip label="PayPal" icon="logo-paypal" size="sm" selected={method === 'paypal'} onPress={() => setMethod('paypal')} />
        </View>
        {method === 'bank' ? (
          <>
            <Input label="Account holder" value={details.account_name} onChangeText={(v) => setDetails({ ...details, account_name: v })} containerStyle={{ marginTop: spacing.md }} />
            <Input label="IBAN / account number" value={details.iban} onChangeText={(v) => setDetails({ ...details, iban: v })} autoCapitalize="characters" containerStyle={{ marginTop: spacing.md }} />
          </>
        ) : (
          <Input label="PayPal email" value={details.paypal_email} onChangeText={(v) => setDetails({ ...details, paypal_email: v })} keyboardType="email-address" autoCapitalize="none" containerStyle={{ marginTop: spacing.md }} />
        )}
        <Text variant="caption" color="textMuted" style={{ marginTop: spacing.md, marginBottom: spacing.lg }}>
          Payout details are stored for this request only and reviewed by the finance team. Coins are held until the payout is confirmed or rejected.
        </Text>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  stat: { minWidth: 150, flexGrow: 1 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 80, marginTop: spacing.sm, gap: 2 },
  barCol: { flex: 1, justifyContent: 'flex-end' },
  bar: { borderRadius: 2 },
  payout: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.lg, marginTop: spacing.lg },
  section: { marginTop: spacing.xl, marginBottom: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
