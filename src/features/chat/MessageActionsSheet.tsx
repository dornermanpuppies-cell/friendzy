import { Pressable, StyleSheet, View } from 'react-native';

import { ListItem } from '@/components/ui/ListItem';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import type { Message } from '@/types/messaging';

const QUICK = ['❤️', '😂', '👍', '😮', '😢', '🔥', '🙏', '🎉'];

export interface MessageActionsSheetProps {
  message: Message | null;
  isGroup: boolean;
  canModerate: boolean;
  onClose: () => void;
  onReply: (m: Message) => void;
  onReact: (m: Message, emoji: string | null) => void;
  onCopy: (m: Message) => void;
  onForward: (m: Message) => void;
  onStar: (m: Message) => void;
  onPin: (m: Message) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message, forEveryone: boolean) => void;
  onInfo: (m: Message) => void;
  onReport: (m: Message) => void;
  onSelect: (m: Message) => void;
}

export function MessageActionsSheet({ message, isGroup, canModerate, onClose, onReply, onReact, onCopy, onForward, onStar, onPin, onEdit, onDelete, onInfo, onReport, onSelect }: MessageActionsSheetProps) {
  const { colors } = useTheme();
  const m = message;
  const run = (fn: () => void) => () => {
    onClose();
    setTimeout(fn, 120);
  };
  const within24h = m ? Date.now() - new Date(m.created_at).getTime() < 24 * 3600 * 1000 : false;
  const within48h = m ? Date.now() - new Date(m.created_at).getTime() < 48 * 3600 * 1000 : false;

  return (
    <Sheet visible={Boolean(m)} onClose={onClose}>
      {m ? (
        <>
          {!m.deleted ? (
            <View style={styles.reactions}>
              {QUICK.map((emoji) => (
                <Pressable key={emoji} onPress={run(() => onReact(m, m.my_reaction === emoji ? null : emoji))} style={[styles.reaction, m.my_reaction === emoji && { backgroundColor: colors.primarySoft }]} accessibilityLabel={`React ${emoji}`}>
                  <Text style={{ fontSize: 26, lineHeight: 32 }}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {!m.deleted ? <ListItem icon="arrow-undo-outline" title="Reply" onPress={run(() => onReply(m))} /> : null}
          {!m.deleted && (m.kind === 'text' || m.text) ? <ListItem icon="copy-outline" title="Copy" onPress={run(() => onCopy(m))} /> : null}
          {!m.deleted ? <ListItem icon="arrow-redo-outline" title="Forward" onPress={run(() => onForward(m))} /> : null}
          {!m.deleted ? <ListItem icon={m.starred ? 'star' : 'star-outline'} title={m.starred ? 'Unstar' : 'Star'} onPress={run(() => onStar(m))} /> : null}
          {!m.deleted && (!isGroup || canModerate) ? <ListItem icon="pin-outline" title={m.pinned ? 'Unpin' : 'Pin'} subtitle="Up to 3 pinned messages" onPress={run(() => onPin(m))} /> : null}
          {m.is_mine && m.kind === 'text' && !m.deleted && within24h ? <ListItem icon="create-outline" title="Edit" onPress={run(() => onEdit(m))} /> : null}
          {m.is_mine ? <ListItem icon="information-circle-outline" title="Message info" subtitle="Delivered and read times" onPress={run(() => onInfo(m))} /> : null}
          <ListItem icon="checkbox-outline" title="Select messages" onPress={run(() => onSelect(m))} />
          <ListItem icon="trash-outline" title="Delete for me" onPress={run(() => onDelete(m, false))} />
          {!m.deleted && ((m.is_mine && within48h) || canModerate) ? <ListItem icon="trash-bin-outline" title="Delete for everyone" danger onPress={run(() => onDelete(m, true))} /> : null}
          {!m.is_mine && !m.deleted ? <ListItem icon="flag-outline" title="Report" danger onPress={run(() => onReport(m))} /> : null}
          <View style={{ height: spacing.lg }} />
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  reactions: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  reaction: { width: 40, height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});
