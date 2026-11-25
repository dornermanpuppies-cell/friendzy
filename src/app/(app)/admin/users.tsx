import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { AdminShell, Row } from '@/features/admin/AdminShell';
import { useAsync } from '@/hooks/useAsync';
import { searchAdminUsers } from '@/services/admin';
import { palette, spacing } from '@/theme/tokens';
import { formatDate } from '@/utils/format';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'reported', label: 'Reported' },
  { id: 'sanctioned', label: 'Sanctioned' },
  { id: 'premium', label: 'Premium' },
  { id: 'verified', label: 'Verified' },
  { id: 'admins', label: 'Admins' },
];
const STATUSES = ['active', 'suspended', 'banned', 'deactivated'];

export default function AdminUsersScreen() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState('all');
  const [status, setStatus] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setDebounced(query.trim());
      setOffset(0);
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);
  const users = useAsync(() => searchAdminUsers({ query: debounced, filter, status, limit: 30, offset }), [debounced, filter, status, offset]);

  return (
    <AdminShell title="Users" refreshing={users.refreshing} onRefresh={() => void users.refresh()}>
      <Input placeholder="Search by name, @username, email or user id" leftIcon="search-outline" value={query} onChangeText={setQuery} autoCapitalize="none" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
        {FILTERS.map((f) => (
          <Chip key={f.id} label={f.label} size="sm" selected={filter === f.id} onPress={() => { setFilter(f.id); setOffset(0); }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
        {STATUSES.map((s) => (
          <Chip key={s} label={s} size="sm" selected={status === s} onPress={() => { setStatus(status === s ? null : s); setOffset(0); }} />
        ))}
      </View>
      <View style={{ marginTop: spacing.md }}>
        {users.loading ? (
          <SkeletonList count={10} />
        ) : users.error ? (
          <EmptyState compact icon="cloud-offline-outline" title="Couldn't load users" description={users.error} action={{ title: 'Retry', onPress: () => void users.reload(), variant: 'secondary' }} />
        ) : !users.data || users.data.length === 0 ? (
          <EmptyState compact icon="people-outline" title="No users match" description="Try another search or filter." />
        ) : (
          users.data.map((u) => (
            <Row key={u.id} onPress={() => router.navigate(`/admin/users/${u.id}` as never)}>
              <Avatar uri={u.avatar_url} name={u.display_name} size={40} verified={u.is_verified} />
              <View style={{ flex: 1 }}>
                <Text variant="bodySemibold" numberOfLines={1}>
                  {u.display_name} <Text variant="small" color="textMuted">@{u.username}</Text>
                  {u.is_premium ? ' 💎' : ''}
                  {u.admin_role ? ` · ${u.admin_role}` : ''}
                </Text>
                <Text variant="caption" color="textMuted" numberOfLines={1}>
                  {u.email ?? 'no email'} · joined {formatDate(u.created_at, 'd MMM yyyy')} · {u.followers_count} followers
                  {u.open_reports ? ` · ${u.open_reports} open report${u.open_reports === 1 ? '' : 's'}` : ''}
                </Text>
              </View>
              <Text variant="caption" color={u.account_status === 'active' ? 'success' : 'danger'} style={{ color: u.account_status === 'active' ? palette.success : palette.danger }}>
                {u.account_status}
              </Text>
            </Row>
          ))
        )}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginVertical: spacing.lg }}>
        <Button title="Previous" size="sm" variant="ghost" disabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - 30))} />
        <Button title="Next" size="sm" variant="ghost" disabled={(users.data?.length ?? 0) < 30} onPress={() => setOffset(offset + 30)} />
      </View>
    </AdminShell>
  );
}
