import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { GiftSheet } from '@/features/economy/GiftSheet';
import { FollowButton } from '@/features/profile/FollowButton';
import { LiveHistoryTab, ReelsTab } from '@/features/profile/ProfileMediaTabs';
import { ProfileView } from '@/features/profile/ProfileView';
import { useAsync } from '@/hooks/useAsync';
import { getUserInterests } from '@/services/interests';
import { startDirectConversation } from '@/services/messaging';
import { recordProfileView } from '@/services/premium';
import { getPresence } from '@/services/presence';
import { getProfileByUsername } from '@/services/profiles';
import { cancelFriendRequest, getRelationship, respondFriendRequest, sendFriendRequest, unfriend, type FollowState } from '@/services/relationships';
import { blockUser, unblockUser } from '@/services/safety';
import { useAuth } from '@/store/authStore';
import { spacing } from '@/theme/tokens';
import type { Relationship } from '@/types/database';
import { getErrorMessage } from '@/utils/errors';
import { normalizeUsername } from '@/utils/validation';

function confirm(title: string, message: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Confirm', style: 'destructive', onPress: onConfirm },
  ]);
}

export default function PublicProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { user, profile: me } = useAuth();
  const toast = useToast();
  const normalized = normalizeUsername(String(username ?? ''));
  const [busy, setBusy] = useState(false);

  const profile = useAsync(() => getProfileByUsername(normalized), [normalized], { enabled: Boolean(normalized) });
  const targetId = profile.data?.id;
  const relationship = useAsync<Relationship | null>(() => (targetId ? getRelationship(targetId) : Promise.resolve(null)), [targetId]);
  const interests = useAsync(() => (targetId ? getUserInterests(targetId) : Promise.resolve([])), [targetId]);
  const presence = useAsync(async () => (targetId ? ((await getPresence([targetId])).get(targetId) ?? null) : null), [targetId]);
  const [giftOpen, setGiftOpen] = useState(false);

  useEffect(() => {
    if (targetId && targetId !== user?.id) void recordProfileView(targetId);
  }, [targetId, user?.id]);

  if (me && normalized === me.username) return <Redirect href="/profile" />;

  const backHeader = (
    <View style={styles.backHeader}>
      <IconButton icon="arrow-back" accessibilityLabel="Go back" variant="overlay" onPress={() => (router.canGoBack() ? router.back() : router.replace('/discover'))} />
    </View>
  );

  if (profile.loading) {
    return (
      <Screen padded={false} maxWidth={false}>
        <Skeleton height={160} rounded={0} />
        <View style={{ padding: spacing.lg }}>
          <Skeleton circle height={96} style={{ marginTop: -48 }} />
          <Skeleton width="50%" height={24} style={{ marginTop: spacing.lg }} />
          <Skeleton width="30%" height={14} style={{ marginTop: spacing.sm }} />
          <Skeleton height={60} style={{ marginTop: spacing.lg }} />
        </View>
      </Screen>
    );
  }

  if (profile.error || !profile.data) {
    return (
      <Screen header={<View style={styles.plainHeader}>{backHeader}</View>}>
        <EmptyState
          emoji="🔍"
          title="Profile not available"
          description={profile.error ?? `We couldn't find @${normalized}. The account may not exist, may have been removed, or you may not be able to view it.`}
          action={{ title: 'Back to Discover', onPress: () => router.replace('/discover') }}
          style={{ flex: 1 }}
        />
      </Screen>
    );
  }

  const p = profile.data;
  const rel = relationship.data;

  const run = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await fn();
      await Promise.all([relationship.refresh(), profile.refresh()]);
      if (success) toast.success(success);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const followState: FollowState = rel?.is_following ? 'following' : rel?.follow_requested ? 'requested' : 'none';

  const friendButton = (() => {
    if (!rel) return null;
    if (rel.is_friend) {
      return <Button title="Friends" variant="secondary" size="sm" leftIcon="people" onPress={() => confirm('Remove friend?', `${p.display_name} will no longer be your friend.`, () => void run(() => unfriend(p.id), 'Friend removed'))} disabled={busy} />;
    }
    if (rel.friend_request?.direction === 'incoming') {
      return (
        <>
          <Button title="Accept request" size="sm" leftIcon="checkmark" onPress={() => void run(() => respondFriendRequest(rel.friend_request!.id, true), 'You are now friends')} disabled={busy} />
          <Button title="Decline" variant="ghost" size="sm" onPress={() => void run(() => respondFriendRequest(rel.friend_request!.id, false))} disabled={busy} />
        </>
      );
    }
    if (rel.friend_request?.direction === 'outgoing') {
      return <Button title="Request sent" variant="secondary" size="sm" leftIcon="time-outline" onPress={() => void run(() => cancelFriendRequest(rel.friend_request!.id), 'Request cancelled')} disabled={busy} />;
    }
    return <Button title="Add friend" variant="outline" size="sm" leftIcon="person-add-outline" onPress={() => void run(() => sendFriendRequest(p.id), 'Friend request sent')} disabled={busy} />;
  })();

  const actions = rel?.is_blocking ? (
    <View>
      <Text variant="small" color="textMuted" style={{ marginBottom: spacing.sm }}>
        {"You blocked this account. They can't see your profile or contact you."}
      </Text>
      <Button title="Unblock" variant="secondary" size="sm" onPress={() => void run(() => unblockUser(p.id), 'Unblocked')} disabled={busy} />
    </View>
  ) : (
    <>
      <FollowButton targetId={p.id} state={followState} isPrivate={p.is_private} onChange={() => void relationship.refresh()} />
      {friendButton}
      <Button
        title="Message"
        variant="secondary"
        size="sm"
        leftIcon="chatbubble-ellipses-outline"
        onPress={async () => {
          try {
            const conversationId = await startDirectConversation(p.id);
            router.navigate(`/chat/${conversationId}` as never);
          } catch (error) {
            toast.error(getErrorMessage(error));
          }
        }}
      />
      <Button title="Gift" variant="outline" size="sm" leftIcon="gift-outline" onPress={() => setGiftOpen(true)} />
    </>
  );

  return (
    <Screen scroll padded={false} maxWidth={false} edges={['left', 'right']} refreshing={profile.refreshing} onRefresh={() => Promise.all([profile.refresh(), relationship.refresh(), presence.refresh()])}>
      <ProfileView
        profile={p}
        isOwner={false}
        interests={interests.data ?? []}
        presence={presence.data}
        actions={user ? actions : undefined}
        isBlocking={rel?.is_blocking}
        onBlock={() => confirm(`Block @${p.username}?`, 'They will be unfollowed, removed from your friends and unable to find or contact you.', () => void run(() => blockUser(p.id), 'Blocked'))}
        onUnblock={() => void run(() => unblockUser(p.id), 'Unblocked')}
        header={backHeader}
        renderTab={(tab) => (tab === 'reels' ? <ReelsTab userId={p.id} isOwner={false} /> : tab === 'live' ? <LiveHistoryTab userId={p.id} isOwner={false} /> : null)}
      />
      <GiftSheet visible={giftOpen} onClose={() => setGiftOpen(false)} targetType="profile" targetId={p.id} recipient={{ id: p.id, username: p.username, display_name: p.display_name, avatar_url: p.avatar_url, is_verified: p.is_verified, is_private: p.is_private, country_code: p.country_code }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  backHeader: { position: 'absolute', top: spacing.md, left: spacing.md, zIndex: 5 },
  plainHeader: { height: 56 },
});
