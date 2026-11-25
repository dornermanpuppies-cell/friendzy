import { useState } from 'react';
import { View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ListItem } from '@/components/ui/ListItem';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { AdminShell, Row } from '@/features/admin/AdminShell';
import { useAsync } from '@/hooks/useAsync';
import { getMyAdminRole, grantRole, listAdmins, revokeRole, searchAdminUsers } from '@/services/admin';
import { useAuth } from '@/store/authStore';
import { spacing } from '@/theme/tokens';
import type { AdminRoleType } from '@/types/database';
import { getErrorMessage } from '@/utils/errors';
import { formatDate } from '@/utils/format';

const ROLES: { id: AdminRoleType; description: string }[] = [
  { id: 'super_admin', description: 'Everything, including roles, payouts switch and deleting accounts' },
  { id: 'admin', description: 'Users, content, lives, settings, site content, audit log' },
  { id: 'moderator', description: 'Reports, content removal, warnings, suspensions, live moderation' },
  { id: 'support', description: 'Verification, announcements, banners, read-only finance' },
  { id: 'finance', description: 'Withdrawals, coin adjustments, catalogues, Premium grants' },
];

export default function AdminAdminsScreen() {
  const { user } = useAuth();
  const toast = useToast();
  const admins = useAsync(() => listAdmins(), []);
  const myRole = useAsync(() => getMyAdminRole(), []);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<AdminRoleType>('moderator');
  const [busy, setBusy] = useState(false);
  const candidates = useAsync(() => (query.trim().length > 1 ? searchAdminUsers({ query: query.trim(), limit: 8 }) : Promise.resolve([])), [query]);
  const isSuper = myRole.data === 'super_admin';

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      await admins.refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell title="Admins & roles" refreshing={admins.refreshing} onRefresh={() => void admins.refresh()}>
      <Card style={{ marginTop: spacing.md }}>
        <Text variant="smallMedium">Roles</Text>
        {ROLES.map((r) => (
          <Text key={r.id} variant="caption" color="textMuted">
            • {r.id}: {r.description}
          </Text>
        ))}
        <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs }}>
          Roles can only be granted by a super admin and never from the client without this check. The first super admin is created in the SQL editor with {'select public.bootstrap_first_admin(\'owner@email\')'}.
        </Text>
      </Card>

      {isSuper ? (
        <View style={{ marginTop: spacing.lg }}>
          <Text variant="h4" style={{ marginBottom: spacing.sm }}>
            Grant a role
          </Text>
          <Input placeholder="Search user" leftIcon="search-outline" value={query} onChangeText={setQuery} autoCapitalize="none" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
            {ROLES.map((r) => (
              <Chip key={r.id} label={r.id} size="sm" selected={role === r.id} onPress={() => setRole(r.id)} />
            ))}
          </View>
          {(candidates.data ?? []).map((u) => (
            <ListItem key={u.id} left={<Avatar uri={u.avatar_url} name={u.display_name} size={36} />} title={`${u.display_name} @${u.username}`} subtitle={u.email ?? ''} right={<Button title={`Grant ${role}`} size="sm" onPress={() => void run(() => grantRole(u.id, role), 'Role granted')} disabled={busy} />} />
          ))}
        </View>
      ) : (
        <Text variant="small" color="textMuted" style={{ marginTop: spacing.lg }}>
          Only super admins can grant or revoke roles.
        </Text>
      )}

      <Text variant="h4" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
        Current admins
      </Text>
      {admins.loading ? (
        <SkeletonList count={3} />
      ) : admins.error ? (
        <EmptyState compact icon="lock-closed-outline" title="Not available" description={admins.error} />
      ) : (
        (admins.data ?? []).map((a) => (
          <Row key={a.id}>
            <Avatar uri={a.avatar_url} name={a.display_name} size={40} />
            <View style={{ flex: 1 }}>
              <Text variant="bodySemibold">
                {a.display_name} <Text variant="small" color="textMuted">@{a.username}</Text>
              </Text>
              <Text variant="caption" color="textMuted">
                {a.role} · since {formatDate(a.created_at, 'd MMM yyyy')}
                {a.granted_by ? ` · granted by @${a.granted_by.username}` : ''}
              </Text>
            </View>
            {isSuper && a.id !== user?.id ? <Button title="Revoke" size="sm" variant="ghost" onPress={() => void run(() => revokeRole(a.id), 'Role revoked')} disabled={busy} /> : null}
          </Row>
        ))
      )}
    </AdminShell>
  );
}
