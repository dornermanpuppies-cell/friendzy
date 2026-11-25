import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';

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
import { listVerificationRequests, reviewVerification, signedDocumentUrl } from '@/services/admin';
import { spacing } from '@/theme/tokens';
import type { VerificationRequest } from '@/types/admin';
import { getErrorMessage } from '@/utils/errors';
import { formatDate } from '@/utils/format';

export default function AdminVerificationScreen() {
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const [target, setTarget] = useState<{ req: VerificationRequest; approve: boolean } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const requests = useAsync(() => listVerificationRequests(status, 100), [status]);

  const decide = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await reviewVerification(target.req.id, target.approve, note.trim() || undefined);
      toast.success(target.approve ? 'Approved' : 'Rejected');
      setTarget(null);
      setNote('');
      await requests.refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const openDocument = async (path: string) => {
    const url = await signedDocumentUrl(path);
    if (url) await Linking.openURL(url).catch(() => toast.error('Could not open the document'));
    else toast.error('Document not available');
  };

  return (
    <AdminShell title="Verification requests" refreshing={requests.refreshing} onRefresh={() => void requests.refresh()}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {['pending', 'approved', 'rejected', 'all'].map((s) => (
          <Chip key={s} label={s} size="sm" selected={status === s} onPress={() => setStatus(s)} />
        ))}
      </View>
      <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
        {requests.loading ? (
          <SkeletonList count={4} />
        ) : requests.error ? (
          <EmptyState compact icon="lock-closed-outline" title="Not available" description={requests.error} />
        ) : !requests.data || requests.data.length === 0 ? (
          <EmptyState compact icon="checkmark-circle-outline" title="Queue is empty" description="No verification requests with this status." />
        ) : (
          requests.data.map((r) => (
            <Card key={r.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Avatar uri={r.user?.avatar_url} name={r.user?.display_name} size={44} verified={r.user?.is_verified} />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text variant="bodySemibold">
                    {r.full_name} <Text variant="small" color="textMuted">@{r.user?.username}</Text>
                  </Text>
                  <Text variant="caption" color="textMuted">
                    {r.category} · {r.user?.followers_count ?? 0} followers · {r.user?.email ?? ''} · {formatDate(r.created_at, 'd MMM yyyy')} · {r.status}
                  </Text>
                </View>
              </View>
              {r.links.length > 0 ? (
                <View style={{ marginTop: spacing.sm }}>
                  {r.links.map((l) => (
                    <Text key={l} variant="small" color="primary" onPress={() => void Linking.openURL(l).catch(() => undefined)}>
                      {l}
                    </Text>
                  ))}
                </View>
              ) : null}
              {r.note ? (
                <Text variant="small" style={{ marginTop: spacing.sm }}>
                  “{r.note}”
                </Text>
              ) : null}
              {r.decision_note ? (
                <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs }}>
                  Decision: {r.decision_note}
                  {r.reviewer ? ` · @${r.reviewer.username}` : ''}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                <Button title="User" size="sm" variant="ghost" onPress={() => router.navigate(`/admin/users/${r.user_id}` as never)} />
                {r.document_path ? <Button title="Open document" size="sm" variant="ghost" leftIcon="document-attach-outline" onPress={() => void openDocument(r.document_path!)} /> : null}
                {r.status === 'pending' ? (
                  <>
                    <Button title="Approve" size="sm" onPress={() => setTarget({ req: r, approve: true })} />
                    <Button title="Reject" size="sm" variant="secondary" onPress={() => setTarget({ req: r, approve: false })} />
                  </>
                ) : null}
              </View>
            </Card>
          ))
        )}
      </View>
      <Sheet visible={Boolean(target)} onClose={() => setTarget(null)} title={target?.approve ? 'Approve verification' : 'Reject verification'}>
        <Input label="Note to the user (optional)" value={note} onChangeText={setNote} multiline maxLength={500} />
        <Button title="Confirm" onPress={() => void decide()} loading={busy} fullWidth style={{ marginVertical: spacing.md }} />
      </Sheet>
    </AdminShell>
  );
}
