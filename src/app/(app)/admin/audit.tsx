import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { AdminShell, Row } from '@/features/admin/AdminShell';
import { useAsync } from '@/hooks/useAsync';
import { listAuditLogs } from '@/services/admin';
import { spacing } from '@/theme/tokens';
import type { AuditLog } from '@/types/admin';
import { formatDate } from '@/utils/format';

export default function AdminAuditScreen() {
  const [action, setAction] = useState('');
  const [debounced, setDebounced] = useState('');
  const [pages, setPages] = useState<AuditLog[][]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setDebounced(action.trim());
      setPages([]);
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [action]);
  const first = useAsync(() => listAuditLogs({ limit: 50, action: debounced || null }), [debounced]);
  const all = [...(first.data ?? []), ...pages.flat()];
  const last = all[all.length - 1];

  return (
    <AdminShell title="Audit log" refreshing={first.refreshing} onRefresh={() => { setPages([]); return first.refresh(); }}>
      <Input placeholder="Filter by action prefix (e.g. user., report., settings.)" leftIcon="filter-outline" value={action} onChangeText={setAction} autoCapitalize="none" />
      <View style={{ marginTop: spacing.md }}>
        {first.loading ? (
          <SkeletonList count={10} />
        ) : first.error ? (
          <EmptyState compact icon="lock-closed-outline" title="Not available" description={first.error} />
        ) : all.length === 0 ? (
          <EmptyState compact icon="document-text-outline" title="No entries" description="Admin actions are recorded here automatically." />
        ) : (
          all.map((l) => (
            <Row key={l.id}>
              <Avatar uri={l.admin?.avatar_url} name={l.admin?.display_name ?? 'System'} size={32} />
              <View style={{ flex: 1 }}>
                <Text variant="small">
                  <Text variant="smallMedium">{l.action}</Text>
                  {l.target_type ? ` · ${l.target_type} ${l.target_id?.slice(0, 8) ?? ''}` : ''}
                </Text>
                <Text variant="caption" color="textMuted" numberOfLines={2}>
                  {l.admin ? `@${l.admin.username}` : 'system'} · {formatDate(l.created_at, 'd MMM yyyy, HH:mm:ss')}
                  {Object.keys(l.metadata ?? {}).length ? ` · ${JSON.stringify(l.metadata)}` : ''}
                </Text>
              </View>
            </Row>
          ))
        )}
      </View>
      {last && (first.data?.length ?? 0) >= 50 ? (
        <Button title="Load older" variant="ghost" style={{ alignSelf: 'center', marginVertical: spacing.lg }} onPress={async () => { const older = await listAuditLogs({ limit: 50, before: last.created_at, action: debounced || null }); setPages((p) => [...p, older]); }} />
      ) : null}
    </AdminShell>
  );
}
