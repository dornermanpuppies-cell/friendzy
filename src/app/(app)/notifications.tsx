import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import {
  describeNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeToNotifications,
  type NotificationItem,
} from '@/services/notifications';
import { getProfilesByIds } from '@/services/profiles';
import { useAuth } from '@/store/authStore';
import { useBadgeStore } from '@/store/badgeStore';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';
import { timeAgo } from '@/utils/format';

const PAGE = 30;

const TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  new_follower: 'person-add',
  follow_request: 'person-add',
  follow_request_accepted: 'checkmark-circle',
  friend_request: 'people',
  friend_request_accepted: 'people',
  match_found: 'shuffle',
  security_alert: 'shield-checkmark',
};

export default function NotificationsScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const clearBadge = useBadgeStore((s) => s.clearNotifications);
  const decrement = useBadgeStore((s) => s.decrementNotifications);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const list = useAsync<NotificationItem[]>(() => (user ? listNotifications(user.id, PAGE) : Promise.resolve([])), [user?.id]);

  // Prepend realtime inserts (resolve the actor profile for display).
  useEffect(() => {
    if (!user) return;
    return subscribeToNotifications(user.id, async (row) => {
      const actor = row.actor_id ? (await getProfilesByIds([row.actor_id]).catch(() => []))[0] ?? null : null;
      list.setData((prev) => [{ ...row, actor }, ...(prev ?? [])]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const loadMore = useCallback(async () => {
    if (!user || loadingMore || !hasMore || !list.data?.length) return;
    setLoadingMore(true);
    try {
      const last = list.data[list.data.length - 1];
      const more = await listNotifications(user.id, PAGE, last.created_at);
      if (more.length < PAGE) setHasMore(false);
      list.setData((prev) => [...(prev ?? []), ...more]);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoadingMore(false);
    }
  }, [user, loadingMore, hasMore, list, toast]);

  const markAll = async () => {
    if (!user) return;
    try {
      await markAllNotificationsRead(user.id);
      list.setData((prev) => (prev ?? []).map((n) => ({ ...n, is_read: true })));
      clearBadge();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const open = async (item: NotificationItem) => {
    const { href } = describeNotification(item);
    if (!item.is_read) {
      list.setData((prev) => (prev ?? []).map((n) => (n.id === item.id ? { ...n, is_read: true } : n)));
      decrement();
      markNotificationRead(item.id).catch(() => undefined);
    }
    if (href) router.navigate(href as never);
  };

  const unread = (list.data ?? []).filter((n) => !n.is_read).length;

  return (
    <Screen
      padded={false}
      header={
        <ScreenHeader
          title="Notifications"
          right={unread > 0 ? <Button title="Mark all read" variant="ghost" size="sm" onPress={markAll} /> : null}
        />
      }
    >
      {list.loading ? (
        <View style={{ padding: spacing.lg }}>
          <SkeletonList count={8} />
        </View>
      ) : list.error ? (
        <EmptyState icon="cloud-offline-outline" title="Couldn't load notifications" description={list.error} action={{ title: 'Retry', onPress: list.reload, variant: 'secondary' }} />
      ) : (
        <FlatList
          data={list.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, (list.data?.length ?? 0) === 0 && { flex: 1 }]}
          onRefresh={list.refresh}
          refreshing={list.refreshing}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <EmptyState
              icon="notifications-outline"
              title="You're all caught up"
              description="Follows, friend requests, likes, comments, mentions, calls, live alerts and gifts will show up here."
              style={{ flex: 1 }}
            />
          }
          renderItem={({ item }) => {
            const { title, body } = describeNotification(item);
            return (
              <Pressable
                onPress={() => open(item)}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.row,
                  !item.is_read && { backgroundColor: colors.primarySoft },
                  (pressed || hovered) && { backgroundColor: colors.surfaceMuted },
                ]}
              >
                <View>
                  <Avatar uri={item.actor?.avatar_url} name={item.actor?.display_name ?? title} size={46} />
                  <View style={[styles.typeBadge, { borderColor: colors.background }]}>
                    <Ionicons name={TYPE_ICONS[item.type] ?? 'sparkles'} size={11} color={palette.white} />
                  </View>
                </View>
                <View style={styles.texts}>
                  <Text variant="body">
                    <Text variant="bodySemibold">{title}</Text> {body}
                  </Text>
                  <Text variant="caption" color="textMuted" style={{ marginTop: 2 }}>
                    {timeAgo(item.created_at)}
                  </Text>
                </View>
                {!item.is_read ? <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} /> : null}
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  typeBadge: { position: 'absolute', right: -4, bottom: -4, width: 20, height: 20, borderRadius: 10, backgroundColor: palette.purple, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, marginLeft: spacing.md },
  unreadDot: { width: 8, height: 8, borderRadius: radius.full, marginLeft: spacing.sm },
});
