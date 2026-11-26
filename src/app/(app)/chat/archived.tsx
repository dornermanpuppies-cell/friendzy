import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { EmptyState } from '@/components/ui/EmptyState';
import { ListItem } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Sheet } from '@/components/ui/Sheet';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { ConversationRow } from '@/features/chat/ConversationRow';
import { confirmAction } from '@/features/feed/usePostActions';
import { updateMySettings } from '@/services/profiles';
import { setConversationSettings, unarchiveAllChats } from '@/services/messaging';
import { useAuth, useAuthStore } from '@/store/authStore';
import { useBadgeStore } from '@/store/badgeStore';
import { useChatStore } from '@/store/chatStore';
import { ThemeScope } from '@/theme/ThemeProvider';
import { layout, palette, spacing } from '@/theme/tokens';
import type { ConversationSummary } from '@/types/messaging';
import { getErrorMessage } from '@/utils/errors';

/**
 * The archive, kept deliberately plain: the chats you put away, a switch that decides whether a new
 * message pulls one back out, and a way to empty the whole thing.
 */
export default function ArchivedChatsScreen() {
  const toast = useToast();
  const { user, settings } = useAuth();
  const patchSettings = useAuthStore((s) => s.patchSettings);
  const refreshInbox = useBadgeStore((s) => s.refreshInbox);
  const [menu, setMenu] = useState<ConversationSummary | null>(null);

  const { list, conversations, load, patch } = useChatStore(
    useShallow((s) => ({ list: s.lists.archived, conversations: s.conversations, load: s.loadConversations, patch: s.patchConversation })),
  );

  useFocusEffect(
    useCallback(() => {
      void load('archived');
    }, [load]),
  );

  const items = useMemo(() => (list?.ids ?? []).map((id) => conversations[id]).filter(Boolean), [list?.ids, conversations]);
  const keepArchived = settings?.keep_chats_archived ?? true;

  const toggleKeep = async (value: boolean) => {
    if (!user) return;
    patchSettings({ keep_chats_archived: value });
    try {
      await updateMySettings(user.id, { keep_chats_archived: value });
    } catch (error) {
      patchSettings({ keep_chats_archived: !value });
      toast.error(getErrorMessage(error));
    }
  };

  const unarchive = async (c: ConversationSummary) => {
    setMenu(null);
    patch(c.id, { is_archived: false });
    try {
      await setConversationSettings(c.id, { isArchived: false });
      await Promise.all([load('archived'), load('inbox'), refreshInbox()]);
      toast.success('Moved back to your inbox');
    } catch (error) {
      patch(c.id, { is_archived: true });
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <ThemeScope scheme="dark">
      <Screen
        header={<ScreenHeader title="Archived" fallbackHref="/inbox" />}
        padded={false}
        backgroundColor={palette.night}
      >
        <View style={{ width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' }}>
          <ListItem
            icon="file-tray-full-outline"
            title="Keep chats archived"
            subtitle="New messages leave these chats archived and silent"
            switchValue={keepArchived}
            onSwitchChange={(v) => void toggleKeep(v)}
          />
        </View>
        {!list?.loaded ? (
          <View style={{ padding: spacing.lg }}>
            <SkeletonList count={5} />
          </View>
        ) : items.length === 0 ? (
          <EmptyState
            icon="archive-outline"
            title="No archived chats"
            description="Archive a chat from its menu in the inbox and it moves here, out of the way."
            style={{ flex: 1 }}
          />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(c) => c.id}
            contentContainerStyle={{ width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', paddingBottom: 96 }}
            refreshing={list.loading}
            onRefresh={() => void load('archived')}
            onEndReached={() => list.hasMore && void load('archived', true)}
            onEndReachedThreshold={0.5}
            renderItem={({ item }) => <ConversationRow conversation={item} onPress={() => router.navigate(`/chat/${item.id}` as never)} onLongPress={() => setMenu(item)} />}
            ListFooterComponent={
              items.length > 0 ? (
                <ListItem
                  icon="arrow-undo-outline"
                  title="Unarchive all"
                  subtitle={`${items.length} ${items.length === 1 ? 'chat goes' : 'chats go'} back to your inbox`}
                  showChevron={false}
                  onPress={() =>
                    confirmAction('Unarchive all chats?', 'They all move back to your inbox.', 'Unarchive', async () => {
                      try {
                        const moved = await unarchiveAllChats();
                        await Promise.all([load('archived'), load('inbox'), refreshInbox()]);
                        toast.success(`${moved} ${moved === 1 ? 'chat' : 'chats'} moved back`);
                      } catch (error) {
                        toast.error(getErrorMessage(error));
                      }
                    })
                  }
                />
              ) : undefined
            }
          />
        )}
      </Screen>

      <Sheet visible={Boolean(menu)} onClose={() => setMenu(null)} title={menu?.title ?? 'Chat'}>
        <ListItem icon="arrow-undo-outline" title="Unarchive" onPress={() => menu && void unarchive(menu)} />
        <ListItem icon="information-circle-outline" title={menu?.kind === 'group' ? 'Group info' : 'Contact info'} onPress={() => { const id = menu?.id; setMenu(null); if (id) router.navigate(`/chat/${id}/info` as never); }} />
        <Text variant="caption" color="textMuted" style={{ marginTop: spacing.md }}>
          Archived chats stay out of your inbox and send no notifications while &quot;Keep chats archived&quot; is on.
        </Text>
        <View style={{ height: spacing.lg }} />
      </Sheet>
    </ThemeScope>
  );
}
