import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ListItem } from '@/components/ui/ListItem';
import { Sheet } from '@/components/ui/Sheet';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { AdminShell, StatCard } from '@/features/admin/AdminShell';
import { useAsync } from '@/hooks/useAsync';
import { addAdminNote, adjustCoins, adminAuthAction, getAdminUser, grantPremium, liftSanction, restrictFeature, revokePremium, setAccountStatus, setVerified, warnUser } from '@/services/admin';
import { formatMoney } from '@/services/wallet';
import { useAuth } from '@/store/authStore';
import { palette, spacing } from '@/theme/tokens';
import type { AccountStatus } from '@/types/database';
import { getErrorMessage } from '@/utils/errors';
import { formatCount, formatDate } from '@/utils/format';

type Action = 'status' | 'warn' | 'restrict' | 'note' | 'coins' | 'premium' | null;
const FEATURES = ['post', 'comment', 'message', 'live', 'gift', 'game'];

export default function AdminUserDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user: me } = useAuth();
  const toast = useToast();
  const detail = useAsync(() => getAdminUser(String(id)), [id]);
  const [action, setAction] = useState<Action>(null);
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('7');
  const [status, setStatus] = useState<AccountStatus>('suspended');
  const [feature, setFeature] = useState('comment');
  const [hours, setHours] = useState('72');
  const [delta, setDelta] = useState('');
  const [busy, setBusy] = useState(false);
  const u = detail.data;

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      setAction(null);
      setReason('');
      await detail.refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell title="User" refreshing={detail.refreshing} onRefresh={() => void detail.refresh()}>
      {detail.loading ? (
        <SkeletonList count={6} />
      ) : detail.error || !u ? (
        <EmptyState compact icon="person-outline" title="User not found" description={detail.error ?? 'No such user.'} action={{ title: 'Back to users', onPress: () => router.replace('/admin/users' as never) }} />
      ) : (
        <>
          <Card style={{ marginTop: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Avatar uri={u.avatar_url} name={u.display_name} size={64} verified={u.is_verified} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text variant="h3">
                  {u.display_name}
                  {u.is_premium ? ' 💎' : ''}
                </Text>
                <Text variant="small" color="textMuted">
                  @{u.username} · {u.email ?? 'no email'} · id {u.id}
                </Text>
                <Text variant="caption" color="textMuted">
                  Joined {formatDate(u.created_at, 'd MMM yyyy')} · {u.country_code ?? '—'} · age {u.age ?? '—'} · last seen {u.last_seen_at ? formatDate(u.last_seen_at, 'd MMM, HH:mm') : 'never'}
                  {u.admin_role ? ` · ${u.admin_role}` : ''}
                </Text>
              </View>
              <Chip label={u.account_status} size="sm" selected={u.account_status !== 'active'} />
            </View>
            <View style={styles.actions}>
              <Button title="View profile" size="sm" variant="ghost" leftIcon="person-outline" onPress={() => router.navigate(`/u/${u.username}` as never)} />
              <Button title={u.is_verified ? 'Remove verification' : 'Verify'} size="sm" variant="ghost" leftIcon="checkmark-circle-outline" onPress={() => void run(() => setVerified(u.id, !u.is_verified), 'Updated')} disabled={busy} />
              <Button title="Warn" size="sm" variant="ghost" leftIcon="alert-circle-outline" onPress={() => setAction('warn')} />
              <Button title="Restrict feature" size="sm" variant="ghost" leftIcon="hand-left-outline" onPress={() => setAction('restrict')} />
              <Button title={u.account_status === 'active' ? 'Suspend / ban' : 'Reinstate'} size="sm" variant={u.account_status === 'active' ? 'ghost' : 'secondary'} leftIcon={u.account_status === 'active' ? 'ban-outline' : 'refresh-outline'} onPress={() => { setStatus(u.account_status === 'active' ? 'suspended' : 'active'); setAction('status'); }} />
              <Button title="Add note" size="sm" variant="ghost" leftIcon="create-outline" onPress={() => setAction('note')} />
              <Button title="Adjust coins" size="sm" variant="ghost" leftIcon="server-outline" onPress={() => setAction('coins')} />
              <Button title={u.is_premium ? 'Revoke Premium' : 'Grant Premium'} size="sm" variant="ghost" leftIcon="diamond-outline" onPress={() => setAction('premium')} />
              <Button title="Sign out everywhere" size="sm" variant="ghost" leftIcon="log-out-outline" onPress={() => void run(() => adminAuthAction('sign_out_user', u.id), 'Sessions revoked')} disabled={busy || u.id === me?.id} />
              <Button title="Block sign-in" size="sm" variant="ghost" leftIcon="lock-closed-outline" onPress={() => void run(() => adminAuthAction('ban_auth', u.id), 'Sign-in blocked')} disabled={busy || u.id === me?.id} />
              <Button title="Allow sign-in" size="sm" variant="ghost" leftIcon="lock-open-outline" onPress={() => void run(() => adminAuthAction('unban_auth', u.id), 'Sign-in allowed')} disabled={busy} />
            </View>
          </Card>

          <View style={styles.grid}>
            <StatCard label="Followers" value={u.followers_count} hint={`${u.following_count} following · ${u.friends_count} friends`} />
            <StatCard label="Posts / videos" value={`${u.posts_count} / ${u.videos_count}`} hint={`${u.stats?.lives ?? 0} lives`} />
            <StatCard label="Coin balance" value={formatCount(u.wallet?.balance ?? 0)} hint={`earnings ${formatCount(u.wallet?.earnings_balance ?? 0)} · pending ${formatCount(u.wallet?.pending_earnings ?? 0)}`} />
            <StatCard label="Purchases" value={formatMoney(u.stats?.coin_purchases_cents ?? 0)} hint={`gifts sent ${formatCount(u.stats?.gifts_sent_coins ?? 0)} · received ${formatCount(u.stats?.gifts_received_coins ?? 0)}`} />
            <StatCard label="Reports" value={`${u.reports_received ?? 0} received`} hint={`${u.reports_made ?? 0} made · ${u.open_reports} open`} tone={u.open_reports > 0 ? 'warning' : undefined} />
            <StatCard label="Devices" value={u.devices ?? 0} hint={`${u.stats?.games_played ?? 0} games played`} />
          </View>

          <Text variant="h4" style={styles.section}>
            Sanctions
          </Text>
          {(u.sanctions ?? []).length === 0 ? (
            <Text variant="small" color="textMuted">
              No sanctions on record.
            </Text>
          ) : (
            (u.sanctions ?? []).map((s) => (
              <ListItem key={s.id} icon={s.kind === 'warning' ? 'alert-circle-outline' : s.kind === 'feature_restriction' ? 'hand-left-outline' : 'ban-outline'} iconColor={s.lifted_at ? undefined : palette.danger} title={`${s.kind.replace('_', ' ')}${s.feature ? ` · ${s.feature}` : ''}${s.lifted_at ? ' (lifted)' : s.ends_at && new Date(s.ends_at) < new Date() ? ' (expired)' : ''}`} subtitle={`${s.reason} · ${formatDate(s.created_at, 'd MMM yyyy')}${s.ends_at ? ` → ${formatDate(s.ends_at, 'd MMM yyyy')}` : ''}${s.created_by_user ? ` · by @${s.created_by_user.username}` : ''}`} right={!s.lifted_at && s.kind !== 'warning' ? <Button title="Lift" size="sm" variant="ghost" onPress={() => void run(() => liftSanction(s.id, 'Lifted by admin'), 'Sanction lifted')} /> : undefined} showChevron={false} />
            ))
          )}

          <Text variant="h4" style={styles.section}>
            Internal notes
          </Text>
          {(u.notes ?? []).length === 0 ? (
            <Text variant="small" color="textMuted">
              No notes yet.
            </Text>
          ) : (
            (u.notes ?? []).map((n) => <ListItem key={n.id} icon="document-text-outline" title={n.note} subtitle={`${n.admin ? `@${n.admin.username}` : 'admin'} · ${formatDate(n.created_at, 'd MMM yyyy, HH:mm')}`} showChevron={false} />)
          )}

          {u.subscription ? (
            <>
              <Text variant="h4" style={styles.section}>
                Subscription
              </Text>
              <Text variant="small" color="textMuted">
                {String(u.subscription.status)} · {String(u.subscription.store)} · {String(u.subscription.product_id ?? '')} · expires {u.subscription.expires_at ? formatDate(String(u.subscription.expires_at), 'd MMM yyyy') : '—'}
              </Text>
            </>
          ) : null}
          {u.verification ? (
            <>
              <Text variant="h4" style={styles.section}>
                Verification request
              </Text>
              <Text variant="small" color="textMuted">
                {u.verification.status} · {u.verification.category} · {formatDate(u.verification.created_at, 'd MMM yyyy')}
              </Text>
            </>
          ) : null}
          <View style={{ height: spacing['3xl'] }} />
        </>
      )}

      <Sheet visible={action !== null} onClose={() => setAction(null)} title={action === 'status' ? 'Change account status' : action === 'warn' ? 'Send a warning' : action === 'restrict' ? 'Restrict a feature' : action === 'note' ? 'Internal note' : action === 'coins' ? 'Adjust coins' : 'Premium'}>
        {u ? (
          <View style={{ gap: spacing.md }}>
            {action === 'status' ? (
              <>
                <View style={styles.wrap}>
                  {(['active', 'suspended', 'banned', 'deactivated'] as AccountStatus[]).map((s) => (
                    <Chip key={s} label={s} size="sm" selected={status === s} onPress={() => setStatus(s)} />
                  ))}
                </View>
                {status === 'suspended' ? <Input label="Days (empty = indefinite)" value={days} onChangeText={setDays} keyboardType="number-pad" /> : null}
              </>
            ) : null}
            {action === 'restrict' ? (
              <>
                <View style={styles.wrap}>
                  {FEATURES.map((f) => (
                    <Chip key={f} label={f} size="sm" selected={feature === f} onPress={() => setFeature(f)} />
                  ))}
                </View>
                <Input label="Hours (empty = until lifted)" value={hours} onChangeText={setHours} keyboardType="number-pad" />
              </>
            ) : null}
            {action === 'coins' ? <Input label="Coins (negative to debit)" value={delta} onChangeText={setDelta} keyboardType="numbers-and-punctuation" helper="Recorded as an auditable ledger adjustment" /> : null}
            {action === 'premium' && !u.is_premium ? <Input label="Days" value={days} onChangeText={setDays} keyboardType="number-pad" /> : null}
            <Input label={action === 'note' ? 'Note' : 'Reason (shown to the user, except notes)'} value={reason} onChangeText={setReason} multiline maxLength={500} />
            <Button
              title="Confirm"
              loading={busy}
              disabled={reason.trim().length < 2}
              onPress={() => {
                if (action === 'status') void run(() => setAccountStatus(u.id, status, reason.trim(), status === 'suspended' && days ? Number(days) : null), 'Account status updated');
                else if (action === 'warn') void run(() => warnUser(u.id, reason.trim()), 'Warning sent');
                else if (action === 'restrict') void run(() => restrictFeature(u.id, feature, hours ? Number(hours) : null, reason.trim()), 'Feature restricted');
                else if (action === 'note') void run(() => addAdminNote(u.id, reason.trim()), 'Note added');
                else if (action === 'coins') void run(() => adjustCoins(u.id, Number(delta), reason.trim()), 'Coins adjusted');
                else if (action === 'premium') void run(() => (u.is_premium ? revokePremium(u.id, reason.trim()) : grantPremium(u.id, Number(days) || 30, reason.trim())), u.is_premium ? 'Premium revoked' : 'Premium granted');
              }}
            />
          </View>
        ) : null}
      </Sheet>
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  section: { marginTop: spacing.xl, marginBottom: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
