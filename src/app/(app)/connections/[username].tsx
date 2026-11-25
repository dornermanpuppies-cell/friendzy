import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SkeletonList } from '@/components/ui/Skeleton';
import { FollowButton } from '@/features/profile/FollowButton';
import { ProfileRow } from '@/features/profile/ProfileRow';
import { useAsync } from '@/hooks/useAsync';
import { getProfileByUsername, listFollowers, listFollowing, listFriends } from '@/services/profiles';
import { useAuth } from '@/store/authStore';
import { spacing } from '@/theme/tokens';
import type { ProfileCard } from '@/types/database';

type Tab = 'followers' | 'following' | 'friends';

export default function ConnectionsScreen() {
  const { username, tab: initialTab } = useLocalSearchParams<{ username: string; tab?: Tab }>();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>(initialTab === 'following' || initialTab === 'friends' ? initialTab : 'followers');

  const profile = useAsync(() => getProfileByUsername(String(username ?? '')), [username]);
  const targetId = profile.data?.id;

  const list = useAsync<ProfileCard[]>(
    () => {
      if (!targetId) return Promise.resolve([]);
      if (tab === 'following') return listFollowing(targetId, 100);
      if (tab === 'friends') return listFriends(targetId, 100);
      return listFollowers(targetId, 100);
    },
    [targetId, tab],
  );

  const counts = profile.data
    ? { followers: profile.data.followers_count, following: profile.data.following_count, friends: profile.data.friends_count }
    : null;

  return (
    <Screen header={<ScreenHeader title={profile.data ? `@${profile.data.username}` : 'Connections'} fallbackHref="/profile" />} scroll refreshing={list.refreshing} onRefresh={list.refresh}>
      <View style={styles.tabs}>
        <Chip label={`Followers${counts ? ` · ${counts.followers}` : ''}`} size="sm" selected={tab === 'followers'} onPress={() => setTab('followers')} />
        <Chip label={`Following${counts ? ` · ${counts.following}` : ''}`} size="sm" selected={tab === 'following'} onPress={() => setTab('following')} />
        <Chip label={`Friends${counts ? ` · ${counts.friends}` : ''}`} size="sm" selected={tab === 'friends'} onPress={() => setTab('friends')} />
      </View>
      {profile.loading || list.loading ? (
        <SkeletonList count={8} />
      ) : list.error || profile.error ? (
        <EmptyState compact icon="cloud-offline-outline" title="Couldn't load this list" description={list.error ?? profile.error ?? undefined} action={{ title: 'Retry', onPress: list.reload, variant: 'secondary' }} />
      ) : list.data && list.data.length > 0 ? (
        list.data.map((p) => <ProfileRow key={p.id} profile={p} showBio={false} right={p.id !== user?.id ? <FollowButton targetId={p.id} state="none" isPrivate={p.is_private} /> : undefined} />)
      ) : (
        <EmptyState
          compact
          icon="people-outline"
          title={tab === 'followers' ? 'No followers yet' : tab === 'following' ? 'Not following anyone yet' : 'No friends yet'}
          description={tab === 'friends' ? 'Friendships are mutual — send a friend request from a profile.' : 'Discover people to grow your network.'}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.lg } });
