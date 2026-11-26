import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useAsync } from '@/hooks/useAsync';
import { searchMessages } from '@/services/messaging';
import { useThreadMessages } from '@/store/chatStore';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { formatDate } from '@/utils/format';

/** Search inside one conversation (or across all when no id is provided). */
export default function ChatSearchScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(query.trim()), 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const results = useAsync(() => (debounced.length >= 2 ? searchMessages(debounced, id ? String(id) : undefined) : Promise.resolve([])), [debounced, id]);
  // End-to-end encrypted messages cannot be searched by the server; match the ones decrypted on this device.
  const thread = useThreadMessages(id ? String(id) : undefined);
  const combined = useMemo(() => {
    if (debounced.length < 2) return [];
    const needle = debounced.toLowerCase();
    const local = thread.filter((m) => m.encrypted && !m.deleted && (m.text ?? '').toLowerCase().includes(needle));
    return [...(results.data ?? []), ...local].filter((m, index, all) => all.findIndex((x) => x.id === m.id) === index).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [debounced, results.data, thread]);

  return (
    <Screen header={<ScreenHeader title="Search messages" fallbackHref={id ? `/chat/${id}` : '/inbox'} />} padded={false}>
      <View style={{ padding: spacing.lg }}>
        <Input placeholder="Search in conversation" leftIcon="search-outline" value={query} onChangeText={setQuery} autoFocus autoCapitalize="none" />
        <Text variant="caption" color="textMuted" style={{ marginTop: spacing.sm }}>
          🔒 Encrypted messages are searched on this device only{id ? ' — scroll up in the chat to load older ones first' : ''}.
        </Text>
      </View>
      {results.loading && debounced.length >= 2 ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <SkeletonList count={5} />
        </View>
      ) : (
        <FlatList
          data={combined}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingBottom: spacing['3xl'] }}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.navigate(`/chat/${item.conversation_id}` as never)} style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, pressed && { backgroundColor: colors.surfaceMuted }]}>
              <Avatar uri={item.sender?.avatar_url} name={item.sender?.display_name} size={40} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text variant="smallMedium" numberOfLines={1}>
                    {item.sender?.display_name ?? 'Unknown'}
                    {item.conversation?.title && !id ? ` · ${item.conversation.title}` : ''}
                  </Text>
                  <Text variant="caption" color="textMuted">
                    {formatDate(item.created_at, 'd MMM HH:mm')}
                  </Text>
                </View>
                <Text variant="small" color="textSecondary" numberOfLines={2}>
                  {item.text}
                </Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={debounced.length >= 2 ? <EmptyState compact icon="search-outline" title="No messages found" description={`Nothing matched “${debounced}”.`} /> : <EmptyState compact icon="chatbubble-ellipses-outline" title="Search your messages" description="Type at least two characters." />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
});
