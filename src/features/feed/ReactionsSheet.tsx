import { FlatList, View } from 'react-native';

import { EmptyState } from '@/components/ui/EmptyState';
import { Sheet } from '@/components/ui/Sheet';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { ProfileRow } from '@/features/profile/ProfileRow';
import { useAsync } from '@/hooks/useAsync';
import { getPostReactions } from '@/services/posts';
import { spacing } from '@/theme/tokens';
import { reactionEmoji } from '@/types/social';

export function ReactionsSheet({ postId, visible, onClose }: { postId: string; visible: boolean; onClose: () => void }) {
  const query = useAsync(() => getPostReactions(postId), [postId, visible], { enabled: visible });
  return (
    <Sheet visible={visible} onClose={onClose} title="Reactions">
      {query.loading ? (
        <SkeletonList count={5} />
      ) : query.data && query.data.length > 0 ? (
        <FlatList
          data={query.data}
          keyExtractor={(item) => item.user.id}
          style={{ maxHeight: 460 }}
          renderItem={({ item }) => (
            <ProfileRow
              profile={{ ...item.user, bio: null, followers_count: 0 }}
              showBio={false}
              onPress={onClose}
              right={<Text style={{ fontSize: 22 }}>{reactionEmoji(item.reaction)}</Text>}
            />
          )}
        />
      ) : (
        <EmptyState compact icon="heart-outline" title="No reactions yet" description="Be the first to react." />
      )}
      <View style={{ height: spacing.lg }} />
    </Sheet>
  );
}
