import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ListItem, ListSection } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { ProfileRow } from '@/features/profile/ProfileRow';
import { useAsync } from '@/hooks/useAsync';
import { startDirectConversation } from '@/services/messaging';
import { listFriends, searchProfiles } from '@/services/profiles';
import { useAuth } from '@/store/authStore';
import { spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';

export default function NewChatScreen() {
  const { user } = useAuth();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(query.trim()), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const friends = useAsync(() => (user ? listFriends(user.id, 100) : Promise.resolve([])), [user?.id]);
  const results = useAsync(() => (debounced ? searchProfiles({ query: debounced, limit: 30 }) : Promise.resolve([])), [debounced]);

  const open = async (userId: string) => {
    setBusyId(userId);
    try {
      const id = await startDirectConversation(userId);
      router.replace(`/chat/${id}` as never);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const list = debounced ? results.data : friends.data;
  const loading = debounced ? results.loading : friends.loading;

  return (
    <Screen header={<ScreenHeader title="New chat" fallbackHref="/inbox" />} scroll>
      <View style={{ paddingTop: spacing.md }}>
        <Input placeholder="Search people" leftIcon="search-outline" value={query} onChangeText={setQuery} autoFocus autoCapitalize="none" autoCorrect={false} />
      </View>
      <ListSection style={{ marginTop: spacing.lg }}>
        <ListItem icon="people-outline" title="New group" subtitle="Chat with up to 256 people" onPress={() => router.navigate('/chat/new-group' as never)} />
      </ListSection>
      <Text variant="label" color="textMuted" style={{ marginBottom: spacing.sm }}>
        {debounced ? 'Results' : 'Friends'}
      </Text>
      {loading ? (
        <SkeletonList count={6} />
      ) : (list ?? []).length > 0 ? (
        (list ?? []).filter((p) => p.id !== user?.id).map((p) => <ProfileRow key={p.id} profile={p} showBio={false} onPress={() => (busyId ? undefined : open(p.id))} />)
      ) : (
        <EmptyState compact icon={debounced ? 'search-outline' : 'people-outline'} title={debounced ? 'No people found' : 'No friends yet'} description={debounced ? 'Try another name or username.' : 'Search for anyone on Friendzy to start a conversation. If they don’t follow you, it arrives as a request.'} />
      )}
    </Screen>
  );
}
