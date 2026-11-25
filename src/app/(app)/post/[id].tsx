import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { CommentComposer } from '@/features/feed/CommentComposer';
import { CommentItem } from '@/features/feed/CommentItem';
import { PostSkeleton } from '@/features/feed/FeedList';
import { PostCard } from '@/features/feed/PostCard';
import { useAsync } from '@/hooks/useAsync';
import { fetchComments, getPost, subscribeToComments } from '@/services/posts';
import { usePostStore } from '@/store/postStore';
import { useTheme } from '@/theme/ThemeProvider';
import { layout, spacing } from '@/theme/tokens';
import type { CommentCard } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const cached = usePostStore((s) => s.byId[String(id)]);
  const upsert = usePostStore((s) => s.upsert);
  const query = useAsync(() => getPost(String(id)), [id]);
  const [comments, setComments] = useState<CommentCard[]>([]);
  const [injected, setInjected] = useState<Record<string, CommentCard[]>>({});
  const [loadingComments, setLoadingComments] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [replyTo, setReplyTo] = useState<CommentCard | null>(null);
  const [editing, setEditing] = useState<CommentCard | null>(null);
  const [commentsError, setCommentsError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) upsert(query.data);
  }, [query.data, upsert]);

  const post = cached ?? query.data ?? null;

  const loadComments = useCallback(async (before: string | null) => {
    try {
      const page = await fetchComments(String(id), before, null, 20);
      setComments((prev) => (before ? [...prev, ...page.filter((c) => !prev.some((p) => p.id === c.id))] : page));
      setHasMore(page.length === 20);
      setCommentsError(null);
    } catch (error) {
      setCommentsError(getErrorMessage(error));
    } finally {
      setLoadingComments(false);
    }
  }, [id]);

  useEffect(() => {
    void Promise.resolve().then(() => loadComments(null));
  }, [loadComments]);

  // Live updates: refetch the list when someone else comments.
  useEffect(() => {
    return subscribeToComments(String(id), () => void loadComments(null));
  }, [id, loadComments]);

  const onCreated = (comment: CommentCard) => {
    if (comment.parent_id) {
      setInjected((prev) => ({ ...prev, [comment.parent_id!]: [...(prev[comment.parent_id!] ?? []), comment] }));
      setComments((prev) => prev.map((c) => (c.id === comment.parent_id ? { ...c, replies_count: c.replies_count + 1 } : c)));
    } else {
      setComments((prev) => [comment, ...prev]);
    }
    usePostStore.getState().patch(String(id), (p) => ({ ...p, comments_count: p.comments_count + 1 }));
  };

  if (query.loading && !post) {
    return (
      <Screen header={<ScreenHeader title="Post" fallbackHref="/home" />} padded={false}>
        <PostSkeleton />
      </Screen>
    );
  }

  if (!post) {
    return (
      <Screen header={<ScreenHeader title="Post" fallbackHref="/home" />}>
        <EmptyState emoji="🫥" title="Post not available" description={query.error ?? 'It may have been deleted or you may not have permission to view it.'} style={{ flex: 1 }} />
      </Screen>
    );
  }

  return (
    <Screen
      header={<ScreenHeader title="Post" fallbackHref="/home" />}
      padded={false}
      maxWidth={false}
      footer={
        <View style={styles.composerWrap}>
          <CommentComposer
            postId={post.id}
            replyTo={replyTo}
            editing={editing}
            onCancel={() => {
              setReplyTo(null);
              setEditing(null);
            }}
            onCreated={onCreated}
            onEdited={(updated) => setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))}
            disabled={!post.allow_comments}
          />
        </View>
      }
    >
      <FlatList
        data={comments}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            <PostCard post={post} detail active />
            <View style={styles.commentsHeader}>
              <Text variant="h4">Comments</Text>
              <Text variant="small" color="textMuted">
                {post.comments_count}
              </Text>
            </View>
            {commentsError ? (
              <Text variant="small" color="danger" style={{ paddingHorizontal: spacing.lg }}>
                {commentsError}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loadingComments ? (
            <ActivityIndicator color={colors.primary} style={{ padding: spacing['2xl'] }} />
          ) : (
            <EmptyState compact icon="chatbubble-ellipses-outline" title="No comments yet" description={post.allow_comments ? 'Start the conversation.' : 'Comments are turned off for this post.'} />
          )
        }
        renderItem={({ item }) => (
          <CommentItem
            comment={item}
            canModerate={post.viewer.is_author}
            injectedReplies={injected[item.id] ?? []}
            onReply={(c) => {
              setEditing(null);
              setReplyTo(c);
            }}
            onEdit={(c) => {
              setReplyTo(null);
              setEditing(c);
            }}
            onChange={(updated) => setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))}
            onDelete={(deleted) => {
              setComments((prev) => prev.filter((c) => c.id !== deleted.id));
              usePostStore.getState().patch(String(id), (p) => ({ ...p, comments_count: Math.max(0, p.comments_count - 1 - deleted.replies_count) }));
            }}
          />
        )}
        onEndReached={() => hasMore && comments.length > 0 && void loadComments(comments[comments.length - 1].created_at)}
        onEndReachedThreshold={0.5}
        ListFooterComponent={<View style={{ height: spacing['2xl'] }} />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' },
  commentsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  composerWrap: { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' },
});
