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
import { adminEndLive, listAdminLives } from '@/services/admin';
import { spacing } from '@/theme/tokens';
import type { LiveSession } from '@/types/live';
import { getErrorMessage } from '@/utils/errors';
import { formatCount, formatDate, timeAgo } from '@/utils/format';

export default function AdminLivesScreen() {
  const toast = useToast();
  const [status, setStatus] = useState('live');
  const [target, setTarget] = useState<LiveSession | null>(null);
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState('');
  const [busy, setBusy] = useState(false);
  const lives = useAsync(() => listAdminLives(status, 100), [status]);

  const end = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await adminEndLive(target.id, reason.trim() || 'Violation of community guidelines', hours ? Number(hours) : null);
      toast.success('Live ended');
      setTarget(null);
      setReason('');
      setHours('');
      await lives.refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell title="Live moderation" refreshing={lives.refreshing} onRefresh={() => void lives.refresh()}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {['live', 'preparing', 'scheduled', 'ended', 'all'].map((s) => (
          <Chip key={s} label={s} size="sm" selected={status === s} onPress={() => setStatus(s)} />
        ))}
      </View>
      <View style={{ marginTop: spacing.md }}>
        {lives.loading ? (
          <SkeletonList count={6} />
        ) : lives.error ? (
          <EmptyState compact icon="cloud-offline-outline" title="Couldn't load lives" description={lives.error} action={{ title: 'Retry', onPress: () => void lives.reload(), variant: 'secondary' }} />
        ) : !lives.data || lives.data.length === 0 ? (
          <EmptyState compact icon="radio-outline" title="No lives" description={`No ${status === 'all' ? '' : status + ' '}broadcasts right now.`} />
        ) : (
          lives.data.map((l) => (
            <Row key={l.id} onPress={() => router.navigate(`/live/${l.id}` as never)}>
              <Avatar uri={l.host.avatar_url} name={l.host.display_name} size={44} />
              <View style={{ flex: 1 }}>
                <Text variant="bodySemibold" numberOfLines={1}>
                  {l.title}
                </Text>
                <Text variant="caption" color="textMuted" numberOfLines={1}>
                  @{l.host.username} · {l.category} · {l.status} · {formatCount(l.viewers_count)} watching · peak {formatCount(l.peak_viewers)} · {formatCount(l.gifts_coins)} gift coins
                  {l.reports_count ? ` · ${l.reports_count} reports` : ''} · {l.started_at ? timeAgo(l.started_at) : formatDate(l.scheduled_at ?? l.created_at, 'd MMM, HH:mm')}
                </Text>
              </View>
              {l.status === 'live' || l.status === 'preparing' ? <Button title="End" size="sm" variant="ghost" onPress={() => setTarget(l)} /> : null}
            </Row>
          ))
        )}
      </View>
      <Sheet visible={Boolean(target)} onClose={() => setTarget(null)} title="End live" subtitle={target ? `${target.title} by @${target.host.username}` : undefined}>
        <Input label="Reason (sent to the host)" value={reason} onChangeText={setReason} multiline maxLength={500} />
        <Input label="Also block hosting for (hours, optional)" value={hours} onChangeText={setHours} keyboardType="number-pad" containerStyle={{ marginTop: spacing.md }} />
        <Button title="End live now" onPress={() => void end()} loading={busy} fullWidth style={{ marginVertical: spacing.md }} />
      </Sheet>
    </AdminShell>
  );
}
