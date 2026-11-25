import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ListItem } from '@/components/ui/ListItem';
import { Sheet } from '@/components/ui/Sheet';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { AdminShell, Row } from '@/features/admin/AdminShell';
import { useAsync } from '@/hooks/useAsync';
import { listContent, removeContent, restoreContent } from '@/services/admin';
import { radius, spacing } from '@/theme/tokens';
import type { AdminContentItem } from '@/types/admin';
import { getErrorMessage } from '@/utils/errors';
import { formatCount, timeAgo } from '@/utils/format';

type Kind = 'post' | 'video' | 'story' | 'comment';

export default function AdminContentScreen() {
  const toast = useToast();
  const [type, setType] = useState<Kind>('post');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [removedOnly, setRemovedOnly] = useState(false);
  const [target, setTarget] = useState<AdminContentItem | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(query.trim()), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);
  const items = useAsync(() => listContent({ type, query: debounced, removedOnly, limit: 50 }), [type, debounced, removedOnly]);

  const act = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      setTarget(null);
      setReason('');
      await items.refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const open = (item: AdminContentItem) => {
    if (type === 'post') router.navigate(`/post/${item.id}` as never);
    else if (type === 'video') router.navigate(`/video/${item.id}` as never);
    else if (type === 'comment' && item.parent) router.navigate((item.scope === 'video' ? `/video/${item.parent}` : item.scope === 'live' ? `/live/${item.parent}` : `/post/${item.parent}`) as never);
  };

  return (
    <AdminShell title="Content" refreshing={items.refreshing} onRefresh={() => void items.refresh()}>
      <View style={styles.wrap}>
        {(['post', 'video', 'story', 'comment'] as Kind[]).map((k) => (
          <Chip key={k} label={`${k}s`} size="sm" selected={type === k} onPress={() => setType(k)} />
        ))}
        <Chip label="Removed only" icon="eye-off-outline" size="sm" selected={removedOnly} onPress={() => setRemovedOnly((v) => !v)} />
      </View>
      {type !== 'story' ? <Input placeholder="Search text or paste an id" leftIcon="search-outline" value={query} onChangeText={setQuery} autoCapitalize="none" containerStyle={{ marginTop: spacing.sm }} /> : null}
      <View style={{ marginTop: spacing.md }}>
        {items.loading ? (
          <SkeletonList count={8} />
        ) : items.error ? (
          <EmptyState compact icon="cloud-offline-outline" title="Couldn't load content" description={items.error} action={{ title: 'Retry', onPress: () => void items.reload(), variant: 'secondary' }} />
        ) : !items.data || items.data.length === 0 ? (
          <EmptyState compact icon="images-outline" title="Nothing here" description="No content matches this filter." />
        ) : (
          items.data.map((item) => {
            const thumb = item.thumbnail_url ?? item.media?.[0]?.thumbnail_url ?? item.media?.[0]?.url ?? null;
            return (
              <Row key={item.id} onPress={() => open(item)}>
                {thumb ? <Image source={{ uri: thumb }} style={styles.thumb} contentFit="cover" /> : <Avatar uri={item.author?.avatar_url} name={item.author?.display_name} size={44} />}
                <View style={{ flex: 1 }}>
                  <Text variant="small" numberOfLines={2}>
                    {item.text ?? item.caption ?? (item.kind ? `${item.kind} story` : '(no text)')}
                  </Text>
                  <Text variant="caption" color="textMuted" numberOfLines={1}>
                    @{item.author?.username ?? '—'} · {timeAgo(item.created_at)}
                    {item.likes_count !== undefined ? ` · ${formatCount(item.likes_count)} likes` : ''}
                    {item.views_count !== undefined ? ` · ${formatCount(item.views_count)} views` : ''}
                    {item.reports_count ? ` · ${item.reports_count} reports` : ''}
                    {item.removed_at ? ` · REMOVED${item.removed_reason ? `: ${item.removed_reason}` : ''}` : ''}
                  </Text>
                </View>
                {item.removed_at ? <Button title="Restore" size="sm" variant="ghost" onPress={() => void act(() => restoreContent(type, item.id), 'Restored')} disabled={busy} /> : <Button title="Remove" size="sm" variant="ghost" onPress={() => setTarget(item)} />}
              </Row>
            );
          })
        )}
      </View>

      <Sheet visible={Boolean(target)} onClose={() => setTarget(null)} title={`Remove ${type}`} subtitle="The author is notified with the reason; the item can be restored later.">
        <Input label="Reason" value={reason} onChangeText={setReason} multiline maxLength={500} placeholder="Violation of community guidelines" />
        <ListItem icon="information-circle-outline" title="Removed content stays in the database" subtitle="Hidden from everyone except admins and the author (flagged)." showChevron={false} />
        <Button title="Remove" onPress={() => target && void act(() => removeContent(type, target.id, reason.trim() || 'Violation of community guidelines'), 'Content removed')} loading={busy} fullWidth style={{ marginVertical: spacing.md }} />
      </Sheet>
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  thumb: { width: 44, height: 56, borderRadius: radius.sm },
});
