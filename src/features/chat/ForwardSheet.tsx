import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { forwardMessages } from '@/services/messaging';
import { useChatStore } from '@/store/chatStore';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';

export interface ForwardSheetProps {
  messageIds: string[];
  visible: boolean;
  onClose: () => void;
  onDone?: () => void;
}

export function ForwardSheet({ messageIds, visible, onClose, onDone }: ForwardSheetProps) {
  const { colors } = useTheme();
  const toast = useToast();
  const list = useChatStore((s) => s.lists.inbox);
  const conversations = useChatStore((s) => s.conversations);
  const load = useChatStore((s) => s.loadConversations);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (!visible) setSelected([]);
  }
  useEffect(() => {
    if (visible && !list?.loaded) void load('inbox');
  }, [visible, list?.loaded, load]);

  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 5 ? prev : [...prev, id]));

  const send = async () => {
    if (!selected.length) return;
    setBusy(true);
    try {
      const count = await forwardMessages(messageIds, selected);
      toast.success(`Forwarded to ${selected.length} chat${selected.length === 1 ? '' : 's'}`, `${count} message${count === 1 ? '' : 's'} sent`);
      onDone?.();
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const items = (list?.ids ?? []).map((id) => conversations[id]).filter(Boolean);

  return (
    <Sheet visible={visible} onClose={onClose} title="Forward to…" subtitle={`${messageIds.length} message${messageIds.length === 1 ? '' : 's'} · up to 5 chats`} footer={<Button title={selected.length ? `Send to ${selected.length}` : 'Send'} fullWidth onPress={send} disabled={!selected.length} loading={busy} style={{ marginBottom: spacing.md }} />}>
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        style={{ maxHeight: 400 }}
        renderItem={({ item }) => {
          const on = selected.includes(item.id);
          return (
            <Pressable onPress={() => toggle(item.id)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
              <Avatar uri={item.avatar_url} name={item.title} size={40} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text variant="bodyMedium" numberOfLines={1}>
                  {item.title ?? 'Conversation'}
                </Text>
                <Text variant="caption" color="textMuted">
                  {item.kind === 'group' ? `${item.members_count} members` : `@${item.other_user?.username ?? ''}`}
                </Text>
              </View>
              <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={on ? colors.primary : colors.textMuted} />
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text variant="body" color="textMuted" align="center" style={{ paddingVertical: spacing['2xl'] }}>
            {list?.loaded ? 'No conversations yet.' : 'Loading…'}
          </Text>
        }
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, borderRadius: 12 },
});
