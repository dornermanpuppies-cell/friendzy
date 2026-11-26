import { Ionicons } from '@/components/ui/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
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
import { ConversationRow } from '@/features/chat/ConversationRow';
import { confirmAction } from '@/features/feed/usePostActions';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { clearConversation, leaveConversation, markConversationRead, respondMessageRequest, setConversationSettings } from '@/services/messaging';
import { useBadgeStore } from '@/store/badgeStore';
import { useChatStore } from '@/store/chatStore';
import { ThemeScope, useTheme } from '@/theme/ThemeProvider';
import { gradients, layout, palette, radius, shadows, spacing } from '@/theme/tokens';
import { MUTE_OPTIONS, type ConversationSummary, type InboxFilter } from '@/types/messaging';
import { getErrorMessage } from '@/utils/errors';

const FILTERS: { id: InboxFilter; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'inbox', label: 'All', icon: 'chatbubbles-outline' },
  { id: 'unread', label: 'Unread', icon: 'mail-unread-outline' },
  { id: 'groups', label: 'Groups', icon: 'people-outline' },
  { id: 'requests', label: 'Requests', icon: 'person-add-outline' },
  { id: 'archived', label: 'Archived', icon: 'archive-outline' },
];

export default function InboxScreen() {
  const { colors } = useTheme();
  const { isDesktop } = useBreakpoint();
  const toast = useToast();
  const [filter, setFilter] = useState<InboxFilter>('inbox');
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<ConversationSummary | null>(null);
  const [muteOpen, setMuteOpen] = useState(false);
  const { list, conversations, load, patch, remove } = useChatStore(
    useShallow((s) => ({ list: s.lists[filter], conversations: s.conversations, load: s.loadConversations, patch: s.patchConversation, remove: s.removeConversation })),
  );
  const requestsList = useChatStore((s) => s.lists.requests);
  const refreshInbox = useBadgeStore((s) => s.refreshInbox);

  useFocusEffect(
    useCallback(() => {
      void load(filter);
      if (filter !== 'requests') void load('requests');
      void refreshInbox();
    }, [filter, load, refreshInbox]),
  );

  const items = useMemo(() => {
    const all = (list?.ids ?? []).map((id) => conversations[id]).filter(Boolean);
    const q = query.trim().toLowerCase();
    return q ? all.filter((c) => (c.title ?? '').toLowerCase().includes(q) || (c.other_user?.username ?? '').includes(q) || (c.last_message?.preview ?? '').toLowerCase().includes(q)) : all;
  }, [list?.ids, conversations, query]);

  const requestCount = (requestsList?.ids ?? []).length;

  const act = async (fn: () => Promise<unknown>, success?: string) => {
    setMenu(null);
    try {
      await fn();
      if (success) toast.success(success);
      await Promise.all([load(filter), refreshInbox()]);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const openConversation = (c: ConversationSummary) => router.navigate(`/chat/${c.id}` as never);

  return (
    <ThemeScope scheme="dark">
      <Screen
        header={
          <ScreenHeader
            title="Inbox"
            fallbackHref="/home"
            back={!isDesktop}
            right={
              <View style={{ flexDirection: 'row' }}>
                <IconButton icon="star-outline" accessibilityLabel="Starred messages" onPress={() => router.navigate('/chat/starred' as never)} />
                <IconButton icon="people-outline" accessibilityLabel="New group" onPress={() => router.navigate('/chat/new-group' as never)} />
                <IconButton icon="create-outline" accessibilityLabel="New chat" onPress={() => router.navigate('/chat/new' as never)} />
              </View>
            }
          />
        }
        padded={false}
        backgroundColor={palette.night}
      >
        <View style={styles.top}>
          <Input placeholder="Search chats" leftIcon="search-outline" value={query} onChangeText={setQuery} autoCapitalize="none" />
          <View style={styles.filters}>
            {FILTERS.map((f) => (
              <Chip key={f.id} label={f.id === 'requests' && requestCount ? `${f.label} · ${requestCount}` : f.label} icon={f.icon} size="sm" selected={filter === f.id} onPress={() => setFilter(f.id)} />
            ))}
          </View>
        </View>
        {!list?.loaded ? (
          <View style={{ padding: spacing.lg }}>
            <SkeletonList count={7} />
          </View>
        ) : list.error ? (
          <EmptyState icon="cloud-offline-outline" title="Couldn't load chats" description={list.error} action={{ title: 'Retry', onPress: () => void load(filter), variant: 'secondary' }} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(c) => c.id}
            contentContainerStyle={[styles.list, items.length === 0 && { flex: 1 }]}
            refreshing={list.loading}
            onRefresh={() => void load(filter)}
            onEndReached={() => list.hasMore && void load(filter, true)}
            onEndReachedThreshold={0.5}
            renderItem={({ item }) => <ConversationRow conversation={item} onPress={() => openConversation(item)} onLongPress={() => setMenu(item)} />}
            ListEmptyComponent={
              <EmptyState
                icon={filter === 'requests' ? 'person-add-outline' : filter === 'archived' ? 'archive-outline' : 'chatbubbles-outline'}
                title={filter === 'requests' ? 'No message requests' : filter === 'archived' ? 'No archived chats' : filter === 'unread' ? 'You’re all caught up' : query ? 'No chats match' : 'No conversations yet'}
                description={filter === 'requests' ? 'Messages from people you don’t follow or aren’t friends with land here first.' : filter === 'inbox' && !query ? 'Start a chat with a friend or someone you discovered.' : undefined}
                action={filter === 'inbox' && !query ? { title: 'New chat', onPress: () => router.navigate('/chat/new' as never), leftIcon: 'create-outline' } : undefined}
                style={{ flex: 1 }}
              />
            }
          />
        )}
        {!isDesktop ? (
          <Pressable onPress={() => router.navigate('/chat/new' as never)} style={[styles.fab, shadows.glowPink]} accessibilityLabel="New chat">
            <LinearGradient colors={[...gradients.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fabInner}>
              <Ionicons name="chatbubble-ellipses" size={24} color={palette.white} />
            </LinearGradient>
          </Pressable>
        ) : null}
      </Screen>

      <Sheet visible={Boolean(menu)} onClose={() => setMenu(null)} title={menu?.title ?? 'Chat'}>
        {menu?.is_request ? (
          <>
            <ListItem icon="checkmark-circle-outline" title="Accept request" onPress={() => menu && act(() => respondMessageRequest(menu.id, true), 'Request accepted')} />
            <ListItem icon="close-circle-outline" title="Delete request" danger onPress={() => menu && act(() => respondMessageRequest(menu.id, false))} />
          </>
        ) : menu ? (
          <>
            <ListItem icon={menu.unread_count > 0 || menu.marked_unread ? 'mail-open-outline' : 'mail-unread-outline'} title={menu.unread_count > 0 || menu.marked_unread ? 'Mark as read' : 'Mark as unread'} onPress={() => act(async () => { if (menu.unread_count > 0 || menu.marked_unread) { await markConversationRead(menu.id); patch(menu.id, { unread_count: 0, marked_unread: false }); } else { await setConversationSettings(menu.id, { markedUnread: true }); patch(menu.id, { marked_unread: true }); } })} />
            <ListItem icon={menu.is_pinned ? 'pin' : 'pin-outline'} title={menu.is_pinned ? 'Unpin chat' : 'Pin chat'} onPress={() => act(() => setConversationSettings(menu.id, { isPinned: !menu.is_pinned }))} />
            <ListItem icon={menu.is_muted ? 'notifications-outline' : 'notifications-off-outline'} title={menu.is_muted ? 'Unmute' : 'Mute notifications'} onPress={() => (menu.is_muted ? act(() => setConversationSettings(menu.id, { mutedUntil: null }), 'Unmuted') : setMuteOpen(true))} />
            <ListItem icon={menu.is_archived ? 'arrow-undo-outline' : 'archive-outline'} title={menu.is_archived ? 'Unarchive' : 'Archive'} onPress={() => act(() => setConversationSettings(menu.id, { isArchived: !menu.is_archived }))} />
            <ListItem icon="information-circle-outline" title={menu.kind === 'group' ? 'Group info' : 'Contact info'} onPress={() => { setMenu(null); router.navigate(`/chat/${menu.id}/info` as never); }} />
            <ListItem icon="trash-outline" title="Clear chat" subtitle="Removes the history on your side only" onPress={() => { setMenu(null); confirmAction('Clear this chat?', 'Messages are removed for you only.', 'Clear', () => act(() => clearConversation(menu.id), 'Chat cleared')); }} />
            <ListItem icon="exit-outline" title={menu.kind === 'group' ? 'Leave group' : 'Delete chat'} danger onPress={() => { setMenu(null); confirmAction(menu.kind === 'group' ? 'Leave group?' : 'Delete chat?', menu.kind === 'group' ? 'You will stop receiving messages from this group.' : 'The chat is removed from your inbox. It reopens if either of you messages again.', menu.kind === 'group' ? 'Leave' : 'Delete', () => act(async () => { await leaveConversation(menu.id); remove(menu.id); })); }} />
          </>
        ) : null}
        <View style={{ height: spacing.lg }} />
      </Sheet>

      <Sheet visible={muteOpen} onClose={() => setMuteOpen(false)} title="Mute notifications">
        <Text variant="small" color="textMuted" style={{ marginBottom: spacing.md }}>
          You’ll still see new messages, but won’t get push notifications.
        </Text>
        {MUTE_OPTIONS.map((o) => (
          <Button key={o.label} title={o.label} variant="secondary" fullWidth style={{ marginBottom: spacing.sm }} onPress={() => { setMuteOpen(false); if (menu) void act(() => setConversationSettings(menu.id, { mutedUntil: new Date(Date.now() + o.hours * 3600 * 1000).toISOString() }), 'Muted'); }} />
        ))}
        <View style={{ height: spacing.lg }} />
      </Sheet>
    </ThemeScope>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingVertical: spacing.md },
  list: { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', paddingBottom: 96 },
  fab: { position: 'absolute', right: spacing.xl, bottom: spacing['2xl'], borderRadius: radius.full },
  fabInner: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
});
