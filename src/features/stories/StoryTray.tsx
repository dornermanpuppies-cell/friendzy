import { Ionicons } from '@/components/ui/Ionicons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, spacing } from '@/theme/tokens';
import type { StoryTrayItem } from '@/types/social';

export interface StoryTrayProps {
  items: StoryTrayItem[] | null;
  loading?: boolean;
}

export function StoryTray({ items, loading }: StoryTrayProps) {
  const { colors } = useTheme();
  const { profile } = useAuth();
  const self = items?.find((i) => i.is_self) ?? null;
  const others = (items ?? []).filter((i) => !i.is_self);
  const order = [...(self ? [self.author.id] : []), ...others.map((i) => i.author.id)];

  const open = (userId: string) => router.navigate({ pathname: '/story/[userId]', params: { userId, order: order.join(',') } } as never);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} style={[styles.container, { borderBottomColor: colors.border }]}>
      {/* Your story */}
      <Pressable onPress={() => (self ? open(self.author.id) : router.navigate('/compose/story' as never))} onLongPress={() => router.navigate('/compose/story' as never)} style={styles.item} accessibilityLabel={self ? 'Your story' : 'Add to your story'}>
        <View>
          <Avatar uri={profile?.avatar_url} name={profile?.display_name} size={64} ring={Boolean(self)} />
          <Pressable onPress={() => router.navigate('/compose/story' as never)} hitSlop={6} style={[styles.plus, { backgroundColor: colors.primary, borderColor: colors.background }]} accessibilityLabel="Create story">
            <Ionicons name="add" size={14} color={palette.white} />
          </Pressable>
        </View>
        <Text variant="caption" color="textSecondary" numberOfLines={1} style={styles.label}>
          Your story
        </Text>
      </Pressable>

      {loading && !items
        ? Array.from({ length: 5 }).map((_, i) => (
            <View key={i} style={styles.item}>
              <Skeleton circle height={64} />
              <Skeleton width={48} height={10} style={{ marginTop: spacing.sm }} />
            </View>
          ))
        : others.map((item) => (
            <Pressable key={item.author.id} onPress={() => open(item.author.id)} style={styles.item} accessibilityLabel={`${item.author.display_name}'s story`}>
              <View style={{ opacity: item.has_unseen ? 1 : 0.6 }}>
                <Avatar uri={item.author.avatar_url} name={item.author.display_name} size={64} ring />
              </View>
              <Text variant="caption" color={item.has_unseen ? 'text' : 'textMuted'} numberOfLines={1} style={styles.label}>
                {item.author.display_name.split(' ')[0]}
              </Text>
            </Pressable>
          ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { borderBottomWidth: StyleSheet.hairlineWidth },
  row: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.md },
  item: { width: 72, alignItems: 'center' },
  label: { marginTop: 6, maxWidth: 72 },
  plus: { position: 'absolute', right: 0, bottom: 0, width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
