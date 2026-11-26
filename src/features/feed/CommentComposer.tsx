import { Ionicons } from '@/components/ui/Ionicons';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { addComment, editComment } from '@/services/posts';
import { useAuth } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { fontFamily, palette, radius, spacing } from '@/theme/tokens';
import type { CommentCard } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';

export interface CommentComposerProps {
  postId: string;
  replyTo: CommentCard | null;
  editing: CommentCard | null;
  onCancel: () => void;
  onCreated: (comment: CommentCard) => void;
  onEdited: (comment: CommentCard) => void;
  disabled?: boolean;
  disabledReason?: string;
}

export function CommentComposer({ postId, replyTo, editing, onCancel, onCreated, onEdited, disabled, disabledReason }: CommentComposerProps) {
  const { colors, isDark } = useTheme();
  const { profile } = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);

  const [lastEditingId, setLastEditingId] = useState<string | null>(editing?.id ?? null);
  if ((editing?.id ?? null) !== lastEditingId) {
    setLastEditingId(editing?.id ?? null);
    if (editing) setText(editing.text ?? '');
  }
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  const submit = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      if (editing) {
        const updated = await editComment(editing.id, value);
        onEdited(updated);
      } else {
        const created = await addComment(postId, value, replyTo?.id ?? null);
        onCreated(created);
      }
      setText('');
      onCancel();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (disabled) {
    return (
      <View style={[styles.disabled, { borderTopColor: colors.border, paddingBottom: insets.bottom + spacing.sm }]}>
        <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.textMuted} />
        <Text variant="small" color="textMuted" style={{ marginLeft: spacing.sm }}>
          {disabledReason ?? 'Comments are turned off for this post.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: insets.bottom + spacing.sm }]}>
      {replyTo || editing ? (
        <View style={[styles.context, { backgroundColor: colors.surfaceMuted }]}>
          <Text variant="caption" color="textSecondary" style={{ flex: 1 }} numberOfLines={1}>
            {editing ? 'Editing your comment' : `Replying to @${replyTo?.author.username}`}
          </Text>
          <Pressable
            onPress={() => {
              setText('');
              onCancel();
            }}
            hitSlop={8}
          >
            <Ionicons name="close" size={16} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.row}>
        <Avatar uri={profile?.avatar_url} name={profile?.display_name} size={34} />
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          placeholder={replyTo ? 'Write a reply…' : 'Add a comment…'}
          placeholderTextColor={colors.placeholder}
          multiline
          maxLength={1000}
          style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.border }]}
          onSubmitEditing={submit}
          blurOnSubmit={false}
        />
        <Pressable onPress={submit} disabled={!text.trim() || busy} accessibilityLabel="Send comment" style={[styles.send, { backgroundColor: text.trim() ? colors.primary : isDark ? colors.surfaceStrong : colors.surfaceMuted }]}>
          {busy ? <ActivityIndicator color={palette.white} size="small" /> : <Ionicons name={editing ? 'checkmark' : 'arrow-up'} size={20} color={text.trim() ? palette.white : colors.textMuted} />}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  context: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.sm, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  input: { flex: 1, marginHorizontal: spacing.sm, minHeight: 40, maxHeight: 120, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontFamily: fontFamily.body, fontSize: 15 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  disabled: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md },
});
