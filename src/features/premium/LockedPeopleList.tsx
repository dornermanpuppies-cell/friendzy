import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { ProfileRow } from '@/features/profile/ProfileRow';
import type { LockedList } from '@/services/premium';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { AuthorCard } from '@/types/social';

/** Shared renderer for Premium-gated lists ("who viewed you", "who liked you"). */
export function LockedPeopleList<T extends AuthorCard>({ data, loading, error, emptyTitle, emptyDescription, lockedTitle, subtitle, onRetry }: { data: LockedList<T> | null; loading: boolean; error: string | null; emptyTitle: string; emptyDescription: string; lockedTitle: string; subtitle: (item: T) => string; onRetry: () => void }) {
  const { colors } = useTheme();
  if (loading) return <SkeletonList count={6} />;
  if (error) return <EmptyState compact icon="cloud-offline-outline" title="Couldn't load" description={error} action={{ title: 'Retry', onPress: onRetry, variant: 'secondary' }} />;
  if (!data) return null;
  if (data.locked) {
    return (
      <View style={[styles.locked, { backgroundColor: colors.surfaceMuted }]}>
        <View style={styles.blurRow}>
          {Array.from({ length: Math.min(5, Math.max(1, data.count)) }).map((_, i) => (
            <View key={i} style={[styles.blurAvatar, { backgroundColor: colors.surfaceStrong, marginLeft: i === 0 ? 0 : -12 }]}>
              <Ionicons name="person" size={20} color={colors.textMuted} />
            </View>
          ))}
        </View>
        <Text variant="h3" align="center" style={{ marginTop: spacing.md }}>
          {data.count > 0 ? `${data.count} ${lockedTitle}` : emptyTitle}
        </Text>
        <Text variant="small" color="textMuted" align="center" style={{ marginTop: spacing.xs }}>
          {data.count > 0 ? 'Friendzy Premium reveals who they are.' : emptyDescription}
        </Text>
        <Button title="Unlock with Premium" leftIcon="diamond-outline" glow onPress={() => router.navigate('/premium' as never)} style={{ marginTop: spacing.lg }} />
      </View>
    );
  }
  if (data.items.length === 0) return <EmptyState compact emoji="👀" title={emptyTitle} description={emptyDescription} />;
  return (
    <View>
      {data.items.map((item) => (
        <ProfileRow key={item.id} profile={{ ...item, bio: null, followers_count: 0 } as never} subtitle={subtitle(item)} right={<Avatar uri={item.avatar_url} name={item.display_name} size={0} style={{ display: 'none' }} />} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  locked: { alignItems: 'center', padding: spacing['2xl'], borderRadius: radius.xl, marginTop: spacing.lg },
  blurRow: { flexDirection: 'row' },
  blurAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: palette.white },
});
