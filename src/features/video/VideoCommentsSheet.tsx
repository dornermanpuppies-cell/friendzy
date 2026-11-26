import { Ionicons } from '@/components/ui/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { addVideoComment, deleteVideoComment, fetchVideoComments, toggleVideoCommentLike } from '@/services/videos';
import { useVideoStore } from '@/store/videoStore';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { VideoCard, VideoCommentCard } from '@/types/video';
import { getErrorMessage } from '@/utils/errors';
import { formatCount, timeAgo } from '@/utils/format';

function CommentRow({ comment, onReply, onLike, onDelete, depth = 0 }: { comment: VideoCommentCard; onReply: (c: VideoCommentCard) => void; onLike: (c: VideoCommentCard) => void; onDelete: (c: VideoCommentCard) => void; depth?: number }) {
  const { colors } = useTheme();
  const [showReplies, setShowReplies] = useState(false);
  const [replies, setReplies] = useState<VideoCommentCard[] | null>(null);
  const [loadingReplies, setLoadingReplies] = useState(false);

  const loadReplies = async () => {
    if (replies) {
      setShowReplies((s) => !s);
      return;
    }
    setLoadingReplies(true);
    try {
      setReplies(await fetchVideoComments(comment.video_id, null, comment.id, 50));
      setShowReplies(true);
    } finally {
      setLoadingReplies(false);
    }
  };

  return (
    <View style={[styles.row, depth > 0 && { marginLeft: 44 }]}>
      <Pressable onPress={() => router.navigate(`/u/${comment.author.username}` as never)}>
        <Avatar uri={comment.author.avatar_url} name={comment.author.display_name} size={depth > 0 ? 28 : 36} />
      </Pressable>
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        <Text variant="smallMedium" color="textMuted">
          {comment.author.display_name} · {timeAgo(comment.created_at)}
          {comment.edited_at ? ' · edited' : ''}
        </Text>
        <Text variant="body" color={comment.removed ? 'textMuted' : 'text'} style={comment.removed ? { fontStyle: 'italic' } : undefined}>
          {comment.removed ? 'Comment removed' : comment.text}
        </Text>
        {comment.reply_video ? (
          <Pressable onPress={() => router.navigate(`/video/${comment.reply_video!.id}` as never)} style={[styles.replyVideo, { borderColor: colors.border }]}>
            <Ionicons name="videocam" size={14} color={colors.primary} />
            <Text variant="caption" color="primary" style={{ marginLeft: 4 }}>
              Video reply
            </Text>
          </Pressable>
        ) : null}
        <View style={styles.actions}>
          <Pressable onPress={() => onReply(comment)} hitSlop={6}>
            <Text variant="caption" color="textMuted">
              Reply
            </Text>
          </Pressable>
          {comment.replies_count > 0 && depth === 0 ? (
            <Pressable onPress={() => void loadReplies()} hitSlop={6} style={{ marginLeft: spacing.lg }}>
              <Text variant="caption" color="primary">
                {loadingReplies ? 'Loading…' : showReplies ? 'Hide replies' : `View ${comment.replies_count} repl${comment.replies_count === 1 ? 'y' : 'ies'}`}
              </Text>
            </Pressable>
          ) : null}
          {comment.viewer.is_author ? (
            <Pressable onPress={() => onDelete(comment)} hitSlop={6} style={{ marginLeft: spacing.lg }}>
              <Text variant="caption" color="danger">
                Delete
              </Text>
            </Pressable>
          ) : null}
        </View>
        {showReplies && replies ? replies.map((r) => <CommentRow key={r.id} comment={r} onReply={onReply} onLike={onLike} onDelete={onDelete} depth={1} />) : null}
      </View>
      <Pressable onPress={() => onLike(comment)} style={styles.like} hitSlop={6} accessibilityLabel="Like comment">
        <Ionicons name={comment.viewer.liked ? 'heart' : 'heart-outline'} size={18} color={comment.viewer.liked ? palette.pink : colors.textMuted} />
        <Text variant="caption" color="textMuted">
          {comment.likes_count > 0 ? formatCount(comment.likes_count) : ''}
        </Text>
      </Pressable>
    </View>
  );
}

export function VideoCommentsSheet({ video, onClose }: { video: VideoCard | null; onClose: () => void }) {
  const { colors } = useTheme();
  const toast = useToast();
  const patch = useVideoStore((s) => s.patch);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<VideoCommentCard | null>(null);
  const [sending, setSending] = useState(false);
  const videoId = video?.id ?? '';
  const query = usePagedQuery<VideoCommentCard>((cursor) => fetchVideoComments(videoId, typeof cursor === 'string' ? cursor : null).then((items) => ({ items, nextCursor: items.length < 20 ? null : items[items.length - 1].created_at })), (c) => c.id, `vcomments:${videoId}`, { enabled: Boolean(videoId) });

  const [lastVideoId, setLastVideoId] = useState(videoId);
  if (lastVideoId !== videoId) {
    setLastVideoId(videoId);
    setText('');
    setReplyTo(null);
  }

  const submit = async () => {
    if (!video || !text.trim()) return;
    setSending(true);
    try {
      const created = await addVideoComment(video.id, text.trim(), replyTo?.id ?? null);
      if (!replyTo) query.prepend(created);
      else query.setItems((items) => items.map((c) => (c.id === replyTo.id ? { ...c, replies_count: c.replies_count + 1 } : c)));
      patch(video.id, { comments_count: video.comments_count + 1 });
      setText('');
      setReplyTo(null);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSending(false);
    }
  };

  const like = async (c: VideoCommentCard) => {
    try {
      const result = await toggleVideoCommentLike(c.id);
      query.setItems((items) => items.map((x) => (x.id === c.id ? { ...x, likes_count: result.likes_count, viewer: { ...x.viewer, liked: result.liked } } : x)));
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const remove = async (c: VideoCommentCard) => {
    try {
      await deleteVideoComment(c.id);
      query.removeWhere((x) => x.id === c.id);
      if (video) patch(video.id, { comments_count: Math.max(0, video.comments_count - 1) });
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <Sheet visible={Boolean(video)} onClose={onClose} title={video ? `${formatCount(video.comments_count)} comment${video.comments_count === 1 ? '' : 's'}` : 'Comments'} maxHeightFraction={0.85}>
      <View style={{ height: 420 }}>
        {query.loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing['2xl'] }} />
        ) : query.items.length === 0 ? (
          <EmptyState compact emoji="💬" title={video?.allow_comments ? 'No comments yet' : 'Comments are off'} description={video?.allow_comments ? 'Start the conversation.' : 'The creator turned off comments for this video.'} />
        ) : (
          <FlatList data={query.items} keyExtractor={(c) => c.id} renderItem={({ item }) => <CommentRow comment={item} onReply={setReplyTo} onLike={like} onDelete={remove} />} onEndReached={() => void query.loadMore()} onEndReachedThreshold={0.5} ListFooterComponent={query.loadingMore ? <ActivityIndicator color={colors.primary} style={{ margin: spacing.md }} /> : undefined} />
        )}
      </View>
      {video?.allow_comments ? (
        <View style={[styles.composer, { borderTopColor: colors.border }]}>
          {replyTo ? (
            <View style={styles.replyBar}>
              <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
                Replying to {replyTo.author.display_name}
              </Text>
              <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
                <Ionicons name="close" size={16} color={colors.textMuted} />
              </Pressable>
            </View>
          ) : null}
          <View style={styles.inputRow}>
            <TextInput value={text} onChangeText={setText} placeholder="Add a comment…" placeholderTextColor={colors.placeholder} style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text }]} maxLength={500} multiline />
            <Button title="Post" size="sm" onPress={() => void submit()} loading={sending} disabled={!text.trim()} />
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  like: { alignItems: 'center', marginLeft: spacing.sm, width: 32 },
  replyVideo: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm, marginTop: spacing.sm },
  replyBar: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  input: { flex: 1, minHeight: 40, maxHeight: 100, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: 15 },
});
