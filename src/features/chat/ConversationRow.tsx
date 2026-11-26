import { Ionicons } from '@/components/ui/Ionicons';
import { memo } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Text } from '@/components/ui/Text';
import { useDecryptedPreview } from '@/hooks/useE2ee';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, spacing } from '@/theme/tokens';
import type { ConversationSummary } from '@/types/messaging';
import { formatDate } from '@/utils/format';

import { StatusTicks } from './MessageBubble';

function timeLabel(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return formatDate(date, 'HH:mm');
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if (now.getTime() - date.getTime() < 6 * 86400000) return formatDate(date, 'EEE');
  return formatDate(date, 'd MMM');
}

export interface ConversationRowProps {
  conversation: ConversationSummary;
  typingNames?: string[];
  online?: boolean | null;
  onPress: () => void;
  onLongPress?: () => void;
  selected?: boolean;
}

function ConversationRowInner({ conversation: c, typingNames = [], online, onPress, onLongPress, selected }: ConversationRowProps) {
  const { colors } = useTheme();
  const last = c.last_message;
  const unread = c.unread_count > 0 || c.marked_unread;
  // Sealed previews are decrypted on this device; the server only knows the kind.
  const lastPreview = useDecryptedPreview(c);
  const preview = typingNames.length
    ? `${typingNames.join(', ')} ${typingNames.length === 1 ? 'is' : 'are'} typing…`
    : last
      ? `${c.kind === 'group' && !last.is_mine && last.sender_name ? `${last.sender_name.split(' ')[0]}: ` : last.is_mine ? 'You: ' : ''}${lastPreview}`
      : c.is_request
        ? 'Message request'
        : c.kind === 'group'
          ? `${c.members_count} members`
          : 'Say hello 👋';

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      accessibilityRole="button"
      accessibilityLabel={`${c.title ?? 'Conversation'}${unread ? ', unread' : ''}`}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.row, (pressed || hovered) && { backgroundColor: colors.surfaceMuted }, selected && { backgroundColor: colors.primarySoft }]}
    >
      <View>
        <Avatar uri={c.avatar_url} name={c.title} size={54} online={c.kind === 'direct' ? online : undefined} />
        {c.kind === 'group' ? (
          <View style={[styles.groupBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
            <Ionicons name="people" size={10} color={palette.white} />
          </View>
        ) : null}
      </View>
      <View style={styles.texts}>
        <View style={styles.titleRow}>
          <Text variant={unread ? 'bodySemibold' : 'bodyMedium'} numberOfLines={1} style={{ flex: 1 }}>
            {c.title ?? 'Conversation'}
          </Text>
          <Text variant="caption" color={unread ? 'primary' : 'textMuted'}>
            {timeLabel(c.last_message_at)}
          </Text>
        </View>
        <View style={styles.previewRow}>
          {last?.is_mine && !typingNames.length ? (
            <View style={{ marginRight: 4 }}>
              <StatusTicks status={last.status} color={colors.textMuted} />
            </View>
          ) : null}
          <Text variant="small" color={typingNames.length ? 'primary' : unread ? 'text' : 'textMuted'} numberOfLines={1} style={{ flex: 1, fontWeight: unread ? '600' : '400', fontStyle: typingNames.length ? 'italic' : 'normal' }}>
            {preview}
          </Text>
          {c.is_muted ? <Ionicons name="notifications-off-outline" size={14} color={colors.textMuted} style={{ marginLeft: 4 }} /> : null}
          {c.is_pinned ? <Ionicons name="pin" size={14} color={colors.textMuted} style={{ marginLeft: 4 }} /> : null}
          {c.disappearing_seconds > 0 ? <Ionicons name="timer-outline" size={14} color={colors.textMuted} style={{ marginLeft: 4 }} /> : null}
          {unread ? (
            <View style={[styles.badge, { backgroundColor: c.is_muted ? colors.textMuted : colors.primary }]}>
              <Text variant="caption" color={palette.white} style={{ fontSize: 10, lineHeight: 12 }}>
                {c.unread_count > 99 ? '99+' : c.unread_count || ''}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export const ConversationRow = memo(ConversationRowInner);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : null) },
  groupBadge: { position: 'absolute', right: -2, bottom: -2, width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, marginLeft: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  previewRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  badge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.sm },
});
