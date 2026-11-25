import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { VerifiedBadge } from '@/components/ui/Badge';
import { ListItem } from '@/components/ui/ListItem';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { ReportSheet } from '@/features/profile/ReportSheet';
import { deleteComment, fetchComments, toggleCommentReaction } from '@/services/posts';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import type { CommentCard } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';
import { formatCount, timeAgo } from '@/utils/format';

import { RichText } from './RichText';
import { confirmAction } from './usePostActions';

export interface CommentItemProps {
  comment: CommentCard;
  canModerate?: boolean;
  onReply: (comment: CommentCard) => void;
  onEdit: (comment: CommentCard) => void;
  onChange: (comment: CommentCard) => void;
  onDelete: (comment: CommentCard) => void;
  depth?: number;
  /** New replies created by the composer for this thread (merged into the local list). */
  injectedReplies?: CommentCard[];
}

export function CommentItem({ comment, canModerate = false, onReply, onEdit, onChange, onDelete, depth = 0, injectedReplies = [] }: CommentItemProps) {
  const { colors } = useTheme();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [replies, setReplies] = useState<CommentCard[] | null>(null);
  const [loadingReplies, setLoadingReplies] = useState(false);

  const allReplies = replies ? mergeReplies(replies, injectedReplies) : injectedReplies;
  const hiddenReplies = Math.max(0, comment.replies_count - allReplies.length);

  const loadReplies = async () => {
    setLoadingReplies(true);
    try {
      const list = await fetchComments(comment.post_id, null, comment.id, 50);
      setReplies(list);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoadingReplies(false);
    }
  };

  const like = async () => {
    const prev = comment.viewer.reaction;
    const next = prev ? null : 'like';
    onChange({ ...comment, likes_count: Math.max(0, comment.likes_count + (next ? 1 : -1)), viewer: { ...comment.viewer, reaction: next } });
    try {
      const result = await toggleCommentReaction(comment.id, next);
      onChange({ ...comment, likes_count: result.likes_count, viewer: { ...comment.viewer, reaction: result.reaction } });
    } catch (error) {
      onChange(comment);
      toast.error(getErrorMessage(error));
    }
  };

  const destroy = () => {
    confirmAction('Delete comment?', 'This cannot be undone.', 'Delete', async () => {
      try {
        await deleteComment(comment.id);
        onDelete(comment);
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    });
  };

  return (
    <View style={[styles.row, depth > 0 && styles.reply]}>
      <Pressable onPress={() => router.navigate(`/u/${comment.author.username}` as never)}>
        <Avatar uri={comment.author.avatar_url} name={comment.author.display_name} size={depth > 0 ? 30 : 38} />
      </Pressable>
      <View style={styles.content}>
        <Pressable onLongPress={() => setMenuOpen(true)} delayLongPress={300} style={[styles.bubble, { backgroundColor: colors.surfaceMuted }]}>
          <View style={styles.nameRow}>
            <Text variant="smallMedium" numberOfLines={1} style={{ flexShrink: 1 }}>
              {comment.author.display_name}
            </Text>
            {comment.author.is_verified ? <VerifiedBadge size={12} style={{ marginLeft: 4 }} /> : null}
            <Text variant="caption" color="textMuted" style={{ marginLeft: 6 }}>
              {timeAgo(comment.created_at)}
              {comment.edited_at ? ' · edited' : ''}
            </Text>
          </View>
          {comment.removed ? (
            <Text variant="small" color="textMuted" style={{ fontStyle: 'italic' }}>
              This comment was removed.
            </Text>
          ) : (
            <RichText text={comment.text ?? ''} variant="small" style={{ fontSize: 14, lineHeight: 20 }} />
          )}
          {comment.media_url ? <Image source={{ uri: comment.media_url }} style={styles.media} contentFit="cover" /> : null}
        </Pressable>
        <View style={styles.actions}>
          <Pressable onPress={like} hitSlop={6} style={styles.actionBtn}>
            <Ionicons name={comment.viewer.reaction ? 'heart' : 'heart-outline'} size={15} color={comment.viewer.reaction ? colors.accent : colors.textMuted} />
            {comment.likes_count > 0 ? (
              <Text variant="caption" color="textMuted" style={{ marginLeft: 3 }}>
                {formatCount(comment.likes_count)}
              </Text>
            ) : null}
          </Pressable>
          <Pressable onPress={() => onReply(comment)} hitSlop={6} style={styles.actionBtn}>
            <Text variant="caption" color="textMuted">
              Reply
            </Text>
          </Pressable>
          <Pressable onPress={() => setMenuOpen(true)} hitSlop={6} style={styles.actionBtn} accessibilityLabel="Comment options">
            <Ionicons name="ellipsis-horizontal" size={15} color={colors.textMuted} />
          </Pressable>
        </View>

        {allReplies.map((reply) => (
          <CommentItem
            key={reply.id}
            comment={reply}
            depth={1}
            canModerate={canModerate}
            onReply={onReply}
            onEdit={onEdit}
            onChange={(updated) => setReplies((prev) => (prev ? prev.map((r) => (r.id === updated.id ? updated : r)) : prev))}
            onDelete={(deleted) => setReplies((prev) => (prev ? prev.filter((r) => r.id !== deleted.id) : prev))}
          />
        ))}
        {hiddenReplies > 0 && depth === 0 ? (
          <Pressable onPress={loadReplies} style={styles.viewReplies} disabled={loadingReplies}>
            <View style={[styles.replyLine, { backgroundColor: colors.borderStrong }]} />
            <Text variant="caption" color="textSecondary">
              {loadingReplies ? 'Loading…' : `View ${hiddenReplies} ${hiddenReplies === 1 ? 'reply' : 'replies'}`}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="Comment">
        <ListItem
          icon="copy-outline"
          title="Copy text"
          onPress={async () => {
            setMenuOpen(false);
            if (comment.text) {
              await Clipboard.setStringAsync(comment.text);
              toast.success('Copied');
            }
          }}
        />
        {comment.viewer.is_author ? (
          <ListItem
            icon="create-outline"
            title="Edit"
            onPress={() => {
              setMenuOpen(false);
              onEdit(comment);
            }}
          />
        ) : null}
        {comment.viewer.is_author || canModerate ? (
          <ListItem
            icon="trash-outline"
            title="Delete"
            danger
            onPress={() => {
              setMenuOpen(false);
              setTimeout(destroy, 200);
            }}
          />
        ) : null}
        {!comment.viewer.is_author ? (
          <ListItem
            icon="flag-outline"
            title="Report"
            danger
            onPress={() => {
              setMenuOpen(false);
              setTimeout(() => setReportOpen(true), 250);
            }}
          />
        ) : null}
        <View style={{ height: spacing.lg }} />
      </Sheet>
      <ReportSheet visible={reportOpen} onClose={() => setReportOpen(false)} targetType="comment" targetId={comment.id} targetLabel="comment" />
    </View>
  );
}

function mergeReplies(loaded: CommentCard[], injected: CommentCard[]): CommentCard[] {
  const ids = new Set(loaded.map((c) => c.id));
  return [...loaded, ...injected.filter((c) => !ids.has(c.id))];
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  reply: { paddingHorizontal: 0, paddingTop: spacing.sm, paddingBottom: 0 },
  content: { flex: 1, marginLeft: spacing.sm },
  bubble: { borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, ...(Platform.OS === 'web' ? ({ cursor: 'default' } as object) : null) },
  nameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  media: { width: 180, height: 180, borderRadius: radius.md, marginTop: spacing.sm },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginLeft: spacing.sm, gap: spacing.md },
  actionBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },
  viewReplies: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, marginLeft: spacing.sm },
  replyLine: { width: 24, height: 1, marginRight: spacing.sm },
});
