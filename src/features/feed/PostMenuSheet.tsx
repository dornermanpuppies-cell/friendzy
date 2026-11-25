import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ListItem } from '@/components/ui/ListItem';
import { Sheet } from '@/components/ui/Sheet';
import { ReportSheet } from '@/features/profile/ReportSheet';
import { spacing } from '@/theme/tokens';
import type { PostCard } from '@/types/social';

import { usePostActions } from './usePostActions';

export interface PostMenuSheetProps {
  post: PostCard;
  visible: boolean;
  onClose: () => void;
  onRemoved?: (id: string) => void;
  onEdit?: () => void;
}

export function PostMenuSheet({ post, visible, onClose, onRemoved, onEdit }: PostMenuSheetProps) {
  const actions = usePostActions(post, { onRemoved });
  const [reportOpen, setReportOpen] = useState(false);
  const isAuthor = post.viewer.is_author;

  const run = (fn: () => void | Promise<void>) => () => {
    onClose();
    setTimeout(() => void fn(), 150);
  };

  return (
    <>
      <Sheet visible={visible} onClose={onClose} title="Post options">
        <ListItem icon="link-outline" title="Copy link" onPress={run(actions.copyLink)} />
        <ListItem icon="share-social-outline" title="Share" onPress={run(actions.share)} />
        <ListItem icon={post.viewer.saved ? 'bookmark' : 'bookmark-outline'} title={post.viewer.saved ? 'Remove from saved' : 'Save post'} onPress={run(actions.save)} />
        {!isAuthor ? (
          <>
            <ListItem
              icon={post.viewer.following_author ? 'person-remove-outline' : 'person-add-outline'}
              title={post.viewer.following_author ? `Unfollow @${post.author.username}` : `Follow @${post.author.username}`}
              onPress={run(actions.toggleFollowAuthor)}
            />
            <ListItem icon="eye-off-outline" title="Hide this post" onPress={run(() => actions.hide('hide'))} />
            <ListItem icon="remove-circle-outline" title="Not interested" subtitle={`Show fewer posts from @${post.author.username}`} onPress={run(() => actions.hide('not_interested'))} />
            <ListItem
              icon="flag-outline"
              title="Report"
              danger
              onPress={() => {
                onClose();
                setTimeout(() => setReportOpen(true), 250);
              }}
            />
          </>
        ) : (
          <>
            {post.type !== 'share' && onEdit ? <ListItem icon="create-outline" title="Edit post" onPress={run(onEdit)} /> : null}
            <ListItem icon="people-outline" title="Audience" value={post.audience === 'public' ? 'Everyone' : post.audience === 'followers' ? 'Followers' : 'Friends'} onPress={onEdit ? run(onEdit) : () => router.navigate(`/post/${post.id}` as never)} />
            <ListItem icon="trash-outline" title="Delete post" danger onPress={run(actions.destroy)} />
          </>
        )}
        <View style={{ height: spacing.lg }} />
      </Sheet>
      <ReportSheet visible={reportOpen} onClose={() => setReportOpen(false)} targetType="post" targetId={post.id} targetLabel="post" />
    </>
  );
}
