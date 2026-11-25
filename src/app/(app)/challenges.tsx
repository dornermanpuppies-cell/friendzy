import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useAsync } from '@/hooks/useAsync';
import { getChallenges } from '@/services/videos';
import { useTheme } from '@/theme/ThemeProvider';
import { gradients, palette, radius, spacing } from '@/theme/tokens';
import { formatCount } from '@/utils/format';

export default function ChallengesScreen() {
  const { colors } = useTheme();
  const challenges = useAsync(() => getChallenges(30), []);
  return (
    <Screen header={<ScreenHeader title="Challenges" fallbackHref="/discover" right={<Button title="Create" size="sm" variant="secondary" leftIcon="add" onPress={() => router.navigate('/studio?tab=challenges' as never)} />} />} scroll padded refreshing={challenges.refreshing} onRefresh={() => void challenges.refresh()}>
      {challenges.loading ? (
        <SkeletonList count={5} />
      ) : !challenges.data || challenges.data.length === 0 ? (
        <EmptyState emoji="🏆" title="No challenges yet" description="Challenges are hashtag campaigns anyone can start. Create one from your Creator Studio." action={{ title: 'Create a challenge', onPress: () => router.navigate('/studio?tab=challenges' as never) }} />
      ) : (
        <View style={{ gap: spacing.md, paddingVertical: spacing.lg }}>
          {challenges.data.map((c) => (
            <Pressable key={c.id} onPress={() => router.navigate(`/challenge/${c.tag}` as never)} style={[styles.card, { borderColor: colors.border }]}>
              {c.cover_url ? <Image source={{ uri: c.cover_url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <LinearGradient colors={[...gradients.cool]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
              <LinearGradient colors={['transparent', 'rgba(9,8,23,0.85)']} style={StyleSheet.absoluteFill} />
              <View style={styles.cardText}>
                <Text variant="caption" color="rgba(255,255,255,0.85)">
                  #{c.tag} · {formatCount(c.videos_count ?? 0)} videos
                </Text>
                <Text variant="h3" color={palette.white} numberOfLines={2}>
                  {c.title}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { height: 140, borderRadius: radius.xl, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, justifyContent: 'flex-end', backgroundColor: palette.night3 },
  cardText: { padding: spacing.lg },
});
