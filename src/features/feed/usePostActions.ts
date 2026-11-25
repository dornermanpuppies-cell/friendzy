import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback } from 'react';
import { Alert, Platform, Share } from 'react-native';

import { useToast } from '@/components/ui/Toast';
import { env } from '@/lib/env';
import { deletePost, sendFeedFeedback, togglePostReaction, toggleRepost, toggleSave, undoFeedFeedback } from '@/services/posts';
import { followUser, unfollowUser } from '@/services/relationships';
import { usePostStore } from '@/store/postStore';
import type { PostCard, ReactionType } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';

export function postUrl(id: string): string {
  return `${env.siteUrl}/post/${id}`;
}

export function confirmAction(title: string, message: string, confirmLabel: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

/** Optimistic post interactions shared by cards, detail screens and menus. */
export function usePostActions(post: PostCard | undefined, options: { onRemoved?: (id: string) => void } = {}) {
  const toast = useToast();
  const patch = usePostStore((s) => s.patch);
  const remove = usePostStore((s) => s.remove);
  const id = post?.id;

  const react = useCallback(
    async (reaction: ReactionType | null) => {
      if (!post || !id) return;
      const prev = post.viewer.reaction;
      const next = reaction === prev ? null : reaction;
      const delta = (next ? 1 : 0) - (prev ? 1 : 0);
      patch(id, (p) => ({ ...p, likes_count: Math.max(0, p.likes_count + delta), viewer: { ...p.viewer, reaction: next } }));
      try {
        const result = await togglePostReaction(id, next);
        patch(id, (p) => ({ ...p, likes_count: result.likes_count, viewer: { ...p.viewer, reaction: result.reaction } }));
      } catch (error) {
        patch(id, (p) => ({ ...p, likes_count: Math.max(0, p.likes_count - delta), viewer: { ...p.viewer, reaction: prev } }));
        toast.error(getErrorMessage(error));
      }
    },
    [post, id, patch, toast],
  );

  const save = useCallback(async () => {
    if (!post || !id) return;
    const prev = post.viewer.saved;
    patch(id, (p) => ({ ...p, viewer: { ...p.viewer, saved: !prev }, saves_count: Math.max(0, p.saves_count + (prev ? -1 : 1)) }));
    try {
      const result = await toggleSave(id);
      patch(id, (p) => ({ ...p, viewer: { ...p.viewer, saved: result.saved } }));
      toast.success(result.saved ? 'Saved' : 'Removed from saved');
    } catch (error) {
      patch(id, (p) => ({ ...p, viewer: { ...p.viewer, saved: prev } }));
      toast.error(getErrorMessage(error));
    }
  }, [post, id, patch, toast]);

  const repost = useCallback(async () => {
    if (!post || !id) return;
    const prev = post.viewer.reposted;
    patch(id, (p) => ({ ...p, viewer: { ...p.viewer, reposted: !prev }, reposts_count: Math.max(0, p.reposts_count + (prev ? -1 : 1)) }));
    try {
      const result = await toggleRepost(id);
      patch(id, (p) => ({ ...p, viewer: { ...p.viewer, reposted: result.reposted }, reposts_count: result.reposts_count }));
      toast.success(result.reposted ? 'Reposted to your profile' : 'Repost removed');
    } catch (error) {
      patch(id, (p) => ({ ...p, viewer: { ...p.viewer, reposted: prev } }));
      toast.error(getErrorMessage(error));
    }
  }, [post, id, patch, toast]);

  const share = useCallback(async () => {
    if (!id) return;
    const url = postUrl(id);
    try {
      if (Platform.OS === 'web') {
        const nav = typeof navigator !== 'undefined' ? navigator : undefined;
        if (nav?.share) await nav.share({ url, title: 'Friendzy post' });
        else {
          await Clipboard.setStringAsync(url);
          toast.success('Link copied');
        }
      } else {
        await Share.share({ message: url, url });
      }
    } catch {
      /* cancelled */
    }
  }, [id, toast]);

  const copyLink = useCallback(async () => {
    if (!id) return;
    await Clipboard.setStringAsync(postUrl(id));
    toast.success('Link copied');
  }, [id, toast]);

  const hide = useCallback(
    async (kind: 'hide' | 'not_interested') => {
      if (!id) return;
      options.onRemoved?.(id);
      try {
        await sendFeedFeedback(id, kind);
        toast.show({
          title: kind === 'hide' ? 'Post hidden' : "We'll show fewer posts like this",
          description: kind === 'not_interested' ? `Fewer posts from @${post?.author.username}` : undefined,
          tone: 'info',
        });
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    },
    [id, options, post?.author.username, toast],
  );

  const undoHide = useCallback(async () => {
    if (!id) return;
    await undoFeedFeedback(id).catch(() => undefined);
  }, [id]);

  const destroy = useCallback(() => {
    if (!id) return;
    confirmAction('Delete post?', 'This cannot be undone.', 'Delete', async () => {
      try {
        await deletePost(id);
        remove(id);
        options.onRemoved?.(id);
        toast.success('Post deleted');
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    });
  }, [id, remove, options, toast]);

  const toggleFollowAuthor = useCallback(async () => {
    if (!post || !id) return;
    const prev = post.viewer.following_author;
    patch(id, (p) => ({ ...p, viewer: { ...p.viewer, following_author: !prev } }));
    try {
      if (prev) await unfollowUser(post.author.id);
      else {
        const state = await followUser(post.author.id);
        if (state === 'requested') {
          patch(id, (p) => ({ ...p, viewer: { ...p.viewer, following_author: false } }));
          toast.info('Follow request sent');
        }
      }
    } catch (error) {
      patch(id, (p) => ({ ...p, viewer: { ...p.viewer, following_author: prev } }));
      toast.error(getErrorMessage(error));
    }
  }, [post, id, patch, toast]);

  const openDetail = useCallback(() => {
    if (id) router.navigate(`/post/${id}` as never);
  }, [id]);

  return { react, save, repost, share, copyLink, hide, undoHide, destroy, toggleFollowAuthor, openDetail };
}
