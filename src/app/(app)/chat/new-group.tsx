import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { ProfileRow } from '@/features/profile/ProfileRow';
import { useAsync } from '@/hooks/useAsync';
import { pickImage, uploadProfileImage } from '@/services/media';
import { createGroup } from '@/services/messaging';
import { listFriends, searchProfiles } from '@/services/profiles';
import { useAuth } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, spacing } from '@/theme/tokens';
import type { ProfileCard } from '@/types/database';
import { getErrorMessage } from '@/utils/errors';

export default function NewGroupScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [picked, setPicked] = useState<ProfileCard[]>([]);
  const [busy, setBusy] = useState(false);
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
  const list = (debounced ? results.data : friends.data) ?? [];

  const toggle = (p: ProfileCard) => setPicked((prev) => (prev.some((x) => x.id === p.id) ? prev.filter((x) => x.id !== p.id) : prev.length >= 255 ? prev : [...prev, p]));

  const create = async () => {
    if (!user || !title.trim()) return;
    setBusy(true);
    try {
      let avatarUrl: string | null = null;
      if (avatarUri) avatarUrl = await uploadProfileImage(user.id, 'avatar', { uri: avatarUri, mimeType: 'image/jpeg' });
      const id = await createGroup(title.trim(), picked.map((p) => p.id), description.trim() || undefined, avatarUrl);
      toast.success('Group created');
      router.replace(`/chat/${id}` as never);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<ScreenHeader title="New group" fallbackHref="/inbox" right={<Button title="Create" size="sm" onPress={create} disabled={!title.trim()} loading={busy} />} />} scroll>
      <View style={styles.header}>
        <Button
          title={avatarUri ? 'Change photo' : 'Add photo'}
          variant="ghost"
          size="sm"
          leftIcon="camera-outline"
          onPress={async () => {
            try {
              const img = await pickImage('avatar');
              if (img) setAvatarUri(img.uri);
            } catch (error) {
              toast.error(getErrorMessage(error));
            }
          }}
        />
        <Avatar uri={avatarUri} name={title || 'G'} size={72} />
      </View>
      <Input label="Group name" placeholder="e.g. Weekend crew" value={title} onChangeText={(v) => setTitle(v.slice(0, 80))} maxLength={80} />
      <Input label="Description (optional)" placeholder="What is this group about?" value={description} onChangeText={(v) => setDescription(v.slice(0, 500))} maxLength={500} multiline containerStyle={{ marginTop: spacing.md }} />

      <Text variant="label" color="textMuted" style={{ marginTop: spacing['2xl'], marginBottom: spacing.sm }}>
        Members · {picked.length}
      </Text>
      {picked.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.md }}>
          {picked.map((p) => (
            <View key={p.id} style={{ alignItems: 'center', width: 64 }}>
              <View>
                <Avatar uri={p.avatar_url} name={p.display_name} size={52} />
                <Ionicons name="close-circle" size={20} color={palette.danger} style={styles.removeBadge} onPress={() => toggle(p)} />
              </View>
              <Text variant="caption" numberOfLines={1}>
                {p.display_name.split(' ')[0]}
              </Text>
            </View>
          ))}
        </ScrollView>
      ) : null}
      <Input placeholder="Search people to add" leftIcon="search-outline" value={query} onChangeText={setQuery} autoCapitalize="none" />
      <View style={{ marginTop: spacing.sm }}>
        {(debounced ? results.loading : friends.loading) ? (
          <SkeletonList count={5} />
        ) : (
          list
            .filter((p) => p.id !== user?.id)
            .map((p) => {
              const on = picked.some((x) => x.id === p.id);
              return <ProfileRow key={p.id} profile={p} showBio={false} onPress={() => toggle(p)} right={<Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={on ? colors.primary : colors.textMuted} />} />;
            })
        )}
        {list.length === 0 && !friends.loading && !results.loading ? (
          <Text variant="small" color="textMuted">
            {debounced ? 'No people found.' : 'Add friends first, or search for anyone on Friendzy.'}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  removeBadge: { position: 'absolute', right: -4, top: -4, backgroundColor: '#fff', borderRadius: 10 },
});
