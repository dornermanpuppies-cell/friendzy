import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback } from 'react';
import { Platform, Share } from 'react-native';

import { useToast } from '@/components/ui/Toast';
import { env } from '@/lib/env';
import { deleteVideo, recordVideoShare, sendVideoFeedback, toggleVideoLike, toggleVideoRepost, toggleVideoSave } from '@/services/videos';
import { useVideoStore } from '@/store/videoStore';
import type { VideoCard } from '@/types/video';
import { getErrorMessage } from '@/utils/errors';

/** Optimistic like/save/repost/share/feedback helpers shared by feed, grid and detail screens. */
export function useVideoActions() {
  const toast = useToast();
  const patch = useVideoStore((s) => s.patch);
  const remove = useVideoStore((s) => s.remove);

  const like = useCallback(
    async (video: VideoCard) => {
      const liked = !video.viewer.liked;
      patch(video.id, { viewer: { ...video.viewer, liked }, likes_count: Math.max(0, video.likes_count + (liked ? 1 : -1)) });
      try {
        const result = await toggleVideoLike(video.id);
        patch(video.id, { viewer: { ...video.viewer, liked: result.liked }, likes_count: result.likes_count });
      } catch (error) {
        patch(video.id, { viewer: video.viewer, likes_count: video.likes_count });
        toast.error(getErrorMessage(error));
      }
    },
    [patch, toast],
  );

  const save = useCallback(
    async (video: VideoCard) => {
      const saved = !video.viewer.saved;
      patch(video.id, { viewer: { ...video.viewer, saved }, saves_count: Math.max(0, video.saves_count + (saved ? 1 : -1)) });
      try {
        const result = await toggleVideoSave(video.id);
        patch(video.id, { viewer: { ...video.viewer, saved: result.saved }, saves_count: result.saves_count });
        toast.success(result.saved ? 'Saved' : 'Removed from saved');
      } catch (error) {
        patch(video.id, { viewer: video.viewer, saves_count: video.saves_count });
        toast.error(getErrorMessage(error));
      }
    },
    [patch, toast],
  );

  const repost = useCallback(
    async (video: VideoCard) => {
      const reposted = !video.viewer.reposted;
      patch(video.id, { viewer: { ...video.viewer, reposted }, reposts_count: Math.max(0, video.reposts_count + (reposted ? 1 : -1)) });
      try {
        const result = await toggleVideoRepost(video.id);
        patch(video.id, { viewer: { ...video.viewer, reposted: result.reposted }, reposts_count: result.reposts_count });
        toast.success(result.reposted ? 'Reposted to your profile' : 'Repost removed');
      } catch (error) {
        patch(video.id, { viewer: video.viewer, reposts_count: video.reposts_count });
        toast.error(getErrorMessage(error));
      }
    },
    [patch, toast],
  );

  const share = useCallback(
    async (video: VideoCard) => {
      const url = `${env.siteUrl}/video/${video.id}`;
      try {
        if (Platform.OS === 'web') {
          const nav = typeof navigator !== 'undefined' ? navigator : undefined;
          if (nav?.share) await nav.share({ title: `${video.author.display_name} on Friendzy`, url });
          else {
            await Clipboard.setStringAsync(url);
            toast.success('Link copied');
          }
        } else {
          const result = await Share.share({ message: `${video.caption ? `${video.caption}\n` : ''}${url}`, url });
          if (result.action === Share.dismissedAction) return;
        }
        patch(video.id, { shares_count: video.shares_count + 1 });
        void recordVideoShare(video.id);
      } catch {
        /* cancelled */
      }
    },
    [patch, toast],
  );

  const copyLink = useCallback(
    async (video: VideoCard) => {
      await Clipboard.setStringAsync(`${env.siteUrl}/video/${video.id}`);
      toast.success('Link copied');
    },
    [toast],
  );

  const notInterested = useCallback(
    async (video: VideoCard, kind: 'hide' | 'not_interested' = 'not_interested') => {
      try {
        await sendVideoFeedback(video.id, kind);
        remove(video.id);
        toast.success(kind === 'hide' ? 'Video hidden' : "We'll show you fewer videos like this");
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    },
    [remove, toast],
  );

  const destroy = useCallback(
    async (video: VideoCard) => {
      try {
        await deleteVideo(video.id);
        remove(video.id);
        toast.success('Video deleted');
        if (router.canGoBack()) router.back();
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    },
    [remove, toast],
  );

  return { like, save, repost, share, copyLink, notInterested, destroy };
}
