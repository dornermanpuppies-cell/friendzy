import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { AdminShell } from '@/features/admin/AdminShell';
import { useAsync } from '@/hooks/useAsync';
import { claimReport, listReports, resolveReport } from '@/services/admin';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import type { AdminReport } from '@/types/admin';
import type { AuthorCard } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';
import { timeAgo } from '@/utils/format';

const STATUSES = ['open', 'in_review', 'resolved', 'dismissed', 'all'];
const TYPES = ['profile', 'post', 'video', 'comment', 'message', 'live', 'gift'];
const ACTIONS = [
  { id: 'none', label: 'No action' },
  { id: 'remove_content', label: 'Remove content' },
  { id: 'warn_user', label: 'Warn user' },
  { id: 'restrict_user', label: 'Restrict feature (72h)' },
  { id: 'suspend_user', label: 'Suspend 7 days' },
  { id: 'ban_user', label: 'Ban' },
];

function TargetPreview({ report }: { report: AdminReport }) {
  const { colors } = useTheme();
  const t = report.target as { text?: string; caption?: string; title?: string; author?: AuthorCard; username?: string; display_name?: string; avatar_url?: string; thumbnail_url?: string; media?: { url: string; thumbnail_url: string | null }[]; removed_at?: string | null; deleted_at?: string | null } | null;
  if (!t) {
    return (
      <Text variant="small" color="textMuted">
        Target no longer exists.
      </Text>
    );
  }
  const author = t.author ?? (t.username ? { username: t.username, display_name: t.display_name ?? '', avatar_url: t.avatar_url ?? null } : null);
  const thumb = t.thumbnail_url ?? t.media?.[0]?.thumbnail_url ?? t.media?.[0]?.url ?? null;
  return (
    <View style={[styles.target, { backgroundColor: colors.surfaceMuted }]}>
      {thumb ? <Image source={{ uri: thumb }} style={styles.thumb} contentFit="cover" /> : null}
      <View style={{ flex: 1 }}>
        {author ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Avatar uri={author.avatar_url} name={author.display_name} size={20} />
            <Text variant="caption" color="textMuted" style={{ marginLeft: 4 }}>
              @{author.username}
            </Text>
          </View>
        ) : null}
        <Text variant="small" numberOfLines={4}>
          {t.text ?? t.caption ?? t.title ?? '(no text)'}
        </Text>
        {t.removed_at || t.deleted_at ? (
          <Text variant="caption" color="danger">
            Already removed
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export default function AdminReportsScreen() {
  const toast = useToast();
  const [status, setStatus] = useState('open');
  const [type, setType] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminReport | null>(null);
  const [action, setAction] = useState('none');
  const [resolution, setResolution] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const reports = useAsync(() => listReports({ status, targetType: type, limit: 50 }), [status, type]);

  const resolve = async (decision: 'resolved' | 'dismissed') => {
    if (!selected) return;
    setBusy(true);
    try {
      await resolveReport(selected.id, decision, { resolution: resolution.trim() || undefined, action: decision === 'resolved' ? action : 'none', reason: reason.trim() || undefined });
      toast.success(decision === 'resolved' ? 'Report resolved' : 'Report dismissed');
      setSelected(null);
      setAction('none');
      setResolution('');
      setReason('');
      await reports.refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell title="Reports" refreshing={reports.refreshing} onRefresh={() => void reports.refresh()}>
      <View style={styles.wrap}>
        {STATUSES.map((s) => (
          <Chip key={s} label={s.replace('_', ' ')} size="sm" selected={status === s} onPress={() => setStatus(s)} />
        ))}
      </View>
      <View style={[styles.wrap, { marginTop: spacing.xs }]}>
        {TYPES.map((t) => (
          <Chip key={t} label={t} size="sm" selected={type === t} onPress={() => setType(type === t ? null : t)} />
        ))}
      </View>
      <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
        {reports.loading ? (
          <SkeletonList count={6} />
        ) : reports.error ? (
          <EmptyState compact icon="cloud-offline-outline" title="Couldn't load reports" description={reports.error} action={{ title: 'Retry', onPress: () => void reports.reload(), variant: 'secondary' }} />
        ) : !reports.data || reports.data.length === 0 ? (
          <EmptyState compact icon="checkmark-done-outline" title="Queue is clear" description="No reports with this filter." />
        ) : (
          reports.data.map((r) => (
            <Card key={r.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Chip label={r.target_type} size="sm" />
                <Text variant="smallMedium" style={{ flex: 1 }}>
                  {r.reason}
                </Text>
                <Text variant="caption" color="textMuted">
                  {timeAgo(r.created_at)}
                </Text>
              </View>
              {r.details ? (
                <Text variant="small" color="textMuted" style={{ marginTop: spacing.xs }}>
                  “{r.details}”
                </Text>
              ) : null}
              <TargetPreview report={r} />
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, flexWrap: 'wrap', gap: spacing.xs }}>
                <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
                  by @{r.reporter?.username ?? 'unknown'}
                  {r.similar_reports > 0 ? ` · +${r.similar_reports} similar` : ''} · {r.status.replace('_', ' ')}
                  {r.reviewer ? ` · ${r.reviewer.username}` : ''}
                </Text>
                {r.target_owner ? <Button title="Owner" size="sm" variant="ghost" onPress={() => router.navigate(`/admin/users/${r.target_owner}` as never)} /> : null}
                {r.status === 'open' ? <Button title="Claim" size="sm" variant="ghost" onPress={async () => { try { await claimReport(r.id); await reports.refresh(); } catch (e) { toast.error(getErrorMessage(e)); } }} /> : null}
                {r.status === 'open' || r.status === 'in_review' ? <Button title="Review" size="sm" onPress={() => setSelected(r)} /> : null}
              </View>
            </Card>
          ))
        )}
      </View>

      <Sheet visible={Boolean(selected)} onClose={() => setSelected(null)} title="Resolve report" subtitle={selected ? `${selected.target_type} · ${selected.reason}` : undefined}>
        {selected ? (
          <View style={{ gap: spacing.md }}>
            <TargetPreview report={selected} />
            <Text variant="label" color="textMuted">
              Action
            </Text>
            <View style={styles.wrap}>
              {ACTIONS.filter((a) => !(selected.target_type === 'profile' && a.id === 'remove_content')).map((a) => (
                <Chip key={a.id} label={a.label} size="sm" selected={action === a.id} onPress={() => setAction(a.id)} />
              ))}
            </View>
            {action !== 'none' ? <Input label="Reason shown to the user" value={reason} onChangeText={setReason} multiline maxLength={500} placeholder={`Violation of community guidelines (${selected.reason})`} /> : null}
            <Input label="Internal resolution note" value={resolution} onChangeText={setResolution} multiline maxLength={500} />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button title="Dismiss" variant="secondary" onPress={() => void resolve('dismissed')} loading={busy} style={{ flex: 1 }} />
              <Button title={action === 'none' ? 'Resolve' : `Resolve & ${ACTIONS.find((a) => a.id === action)?.label.toLowerCase()}`} onPress={() => void resolve('resolved')} loading={busy} style={{ flex: 2 }} />
            </View>
          </View>
        ) : null}
      </Sheet>
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  target: { flexDirection: 'row', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, marginTop: spacing.sm },
  thumb: { width: 56, height: 56, borderRadius: radius.sm },
});
