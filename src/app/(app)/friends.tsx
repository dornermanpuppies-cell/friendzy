import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { CountBadge, VerifiedBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { ListItem } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Sheet } from '@/components/ui/Sheet';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useMessageAction } from '@/features/discover/PersonCard';
import { locationLabel, pluralize, presenceLabel } from '@/features/discover/presence';
import { confirmAction } from '@/features/feed/usePostActions';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { getFriendsList, unfriend } from '@/services/relationships';
import { blockUser } from '@/services/safety';
import { useAuth } from '@/store/authStore';
import { useBadgeStore } from '@/store/badgeStore';
import { useTheme } from '@/theme/ThemeProvider';
import { layout, palette, radius, spacing } from '@/theme/tokens';
import type { DiscoverCard } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';

const PAGE = 30;

function FriendRow({ friend, onMessage, onMenu, busy }: { friend: DiscoverCard; onMessage: () => void; onMenu: () => void; busy: boolean }) {
  const { colors } = useTheme();
  const presence = presenceLabel(friend.presence);
  const location = locationLabel(friend);
  const details = [presence?.text, location, friend.mutual_friends > 0 ? pluralize(friend.mutual_friends, 'mutual friend') : null].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={() => router.navigate(`/u/${friend.username}` as never)} accessibilityRole="button" accessibilityLabel={`Open ${friend.display_name}'s profile`} style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.row, (pressed || hovered) && { backgroundColor: colors.surfaceMuted }]}>
      <Avatar uri={friend.avatar_url} name={friend.display_name} size={50} online={friend.presence.is_online} />
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text variant="bodySemibold" numberOfLines={1} style={{ flexShrink: 1 }}>
            {friend.display_name}
          </Text>
          {friend.is_verified ? <VerifiedBadge size={14} style={{ marginLeft: 4 }} /> : null}
        </View>
        <Text variant="small" color="textMuted" numberOfLines={1}>
          @{friend.username}
        </Text>
        {details ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            {presence ? <View style={[styles.dot, { backgroundColor: presence.tone === 'online' ? palette.success : colors.textMuted }]} /> : null}
            <Text variant="caption" color={presence?.tone === 'online' ? 'success' : 'textMuted'} numberOfLines={1} style={{ flexShrink: 1 }}>
              {details}
            </Text>
          </View>
        ) : null}
      </View>
      <IconButton icon="chatbubble-ellipses-outline" accessibilityLabel={`Message ${friend.display_name}`} variant="surface" size={36} onPress={onMessage} disabled={busy} />
      <IconButton icon="ellipsis-horizontal" accessibilityLabel="More options" variant="ghost" size={36} onPress={onMenu} />
    </Pressable>
  );
}

export default function FriendsScreen() {
  const { user, profile } = useAuth();
  const { colors } = useTheme();
  const { isDesktop } = useBreakpoint();
  const toast = useToast();
  const message = useMessageAction();
  const pendingRequests = useBadgeStore((s) => s.requests);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [menu, setMenu] = useState<DiscoverCard | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(query.trim()), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const friends = usePagedQuery<DiscoverCard, number>(
    async (cursor) => {
      const offset = cursor ?? 0;
      const items = await getFriendsList({ query: debounced, limit: PAGE, offset });
      return { items, nextCursor: items.length < PAGE ? null : offset + PAGE };
    },
    (p) => p.id,
    `friends:${user?.id ?? ''}:${debounced}`,
    { enabled: Boolean(user) },
  );

  const onlineCount = friends.items.filter((f) => f.presence.is_online).length;

  const remove = (friend: DiscoverCard) =>
    confirmAction('Remove friend?', `${friend.display_name} will no longer be your friend. They are not notified.`, 'Remove', async () => {
      try {
        await unfriend(friend.id);
        friends.removeWhere((f) => f.id === friend.id);
        toast.success('Friend removed');
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    });

  const block = (friend: DiscoverCard) =>
    confirmAction(`Block ${friend.display_name}?`, 'They will be removed from your friends and unable to find or contact you.', 'Block', async () => {
      try {
        await blockUser(friend.id);
        friends.removeWhere((f) => f.id === friend.id);
        toast.info('Blocked');
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    });

  const header = (
    <View style={{ paddingTop: spacing.md }}>
      <Pressable onPress={() => router.navigate('/requests' as never)} style={[styles.requests, { backgroundColor: pendingRequests > 0 ? colors.primarySoft : colors.surfaceMuted }]} accessibilityRole="button" accessibilityLabel="Friend requests">
        <Ionicons name="person-add-outline" size={20} color={colors.primary} />
        <Text variant="smallMedium" style={{ flex: 1, marginLeft: spacing.md }}>
          {pendingRequests > 0 ? `${pluralize(pendingRequests, 'pending request')} waiting for you` : 'Friend requests'}
        </Text>
        {pendingRequests > 0 ? <CountBadge count={pendingRequests} /> : <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
      </Pressable>
      <Input placeholder="Search your friends" leftIcon="search-outline" value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} containerStyle={{ marginTop: spacing.md }} />
      <View style={styles.statsRow}>
        <Text variant="small" color="textMuted" style={{ flex: 1 }}>
          {profile ? `${pluralize(profile.friends_count, 'friend')}` : ''}
          {onlineCount > 0 ? ` · ${onlineCount} online` : ''}
        </Text>
        <Button title="Find friends" variant="ghost" size="sm" leftIcon="compass-outline" onPress={() => router.navigate('/discover')} />
      </View>
    </View>
  );

  const empty = friends.loading ? (
    <SkeletonList count={6} />
  ) : friends.error ? (
    <EmptyState compact icon="cloud-offline-outline" title="Couldn't load friends" description={friends.error} action={{ title: 'Retry', onPress: () => void friends.refresh(), variant: 'secondary' }} />
  ) : debounced ? (
    <EmptyState compact icon="search-outline" title="No friends match" description={`No friend matches “${debounced}”. Search the whole community instead?`} action={{ title: 'Search people', onPress: () => router.navigate({ pathname: '/people/search', params: { q: debounced } } as never), variant: 'secondary' }} />
  ) : (
    <EmptyState compact emoji="🤝" title="No friends yet" description="Friendships are mutual — send a friend request from someone's profile or Discover, and it shows up here once they accept." action={{ title: 'Discover people', onPress: () => router.navigate('/discover') }} secondaryAction={{ title: 'Meet someone', onPress: () => router.navigate('/match' as never), leftIcon: 'shuffle' }} />
  );

  return (
    <Screen header={<ScreenHeader title="Friends" fallbackHref="/home" right={<IconButton icon="person-add-outline" accessibilityLabel="Friend requests" onPress={() => router.navigate('/requests' as never)} />} />} padded={false}>
      <FlatList
        data={friends.items}
        keyExtractor={(f) => f.id}
        renderItem={({ item }) => <FriendRow friend={item} onMessage={() => void message.open(item)} onMenu={() => setMenu(item)} busy={message.busy === item.id} />}
        contentContainerStyle={[styles.list, { paddingHorizontal: isDesktop ? spacing['3xl'] : spacing.lg }]}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={friends.loadingMore ? <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.xl }} /> : undefined}
        onEndReached={() => void friends.loadMore()}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={friends.refreshing} onRefresh={() => void friends.refresh()} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />

      <Sheet visible={Boolean(menu)} onClose={() => setMenu(null)} title={menu?.display_name} subtitle={menu ? `@${menu.username}` : undefined}>
        {menu ? (
          <>
            <ListItem icon="person-outline" title="View profile" onPress={() => { const m = menu; setMenu(null); router.navigate(`/u/${m.username}` as never); }} />
            <ListItem icon="chatbubble-ellipses-outline" title="Message" onPress={() => { const m = menu; setMenu(null); void message.open(m); }} />
            <ListItem icon="people-outline" title="Mutual friends" value={String(menu.mutual_friends)} onPress={() => { const m = menu; setMenu(null); router.navigate(`/connections/${m.username}?tab=friends` as never); }} />
            <ListItem icon="person-remove-outline" title="Remove friend" danger onPress={() => { const m = menu; setMenu(null); remove(m); }} />
            <ListItem icon="ban-outline" title="Block" danger onPress={() => { const m = menu; setMenu(null); block(m); }} />
          </>
        ) : null}
        <View style={{ height: spacing.lg }} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing['4xl'], maxWidth: layout.maxContentWidth + spacing['3xl'] * 2, width: '100%', alignSelf: 'center' },
  requests: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.lg },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.sm, borderRadius: radius.md },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 5 },
});
