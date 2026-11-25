import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useAsync } from '@/hooks/useAsync';
import { getLeaderboard } from '@/services/games';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, spacing } from '@/theme/tokens';
import type { GameSlug } from '@/types/games';

const GAMES: { slug: GameSlug; label: string; emoji: string }[] = [
  { slug: 'ludo', label: 'Ludo', emoji: '🎲' },
  { slug: 'chess', label: 'Chess', emoji: '♟️' },
  { slug: 'trivia', label: 'Trivia', emoji: '🧠' },
  { slug: 'would_you_rather', label: 'Would You Rather', emoji: '🤔' },
  { slug: 'truth_or_dare', label: 'Truth or Dare', emoji: '🔥' },
  { slug: 'guess_the_song', label: 'Guess the Song', emoji: '🎵' },
];

export default function LeaderboardScreen() {
  const { game } = useLocalSearchParams<{ game: string }>();
  const { colors } = useTheme();
  const slug = (GAMES.find((g) => g.slug === game)?.slug ?? 'chess') as GameSlug;
  const board = useAsync(() => getLeaderboard(slug, 50), [slug]);

  return (
    <Screen header={<ScreenHeader title="Leaderboards" fallbackHref="/games" />} scroll padded>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.md }}>
        {GAMES.map((g) => (
          <Chip key={g.slug} label={g.label} emoji={g.emoji} size="sm" selected={g.slug === slug} onPress={() => router.setParams({ game: g.slug })} />
        ))}
      </ScrollView>
      {board.data?.me ? (
        <View style={[styles.me, { backgroundColor: colors.primarySoft }]}>
          <Text variant="smallMedium" color="primary">
            Your rank: #{board.data.me.rank} · {board.data.me.rating} rating · {board.data.me.wins}W {board.data.me.losses}L {board.data.me.draws}D
          </Text>
        </View>
      ) : null}
      {board.loading ? (
        <SkeletonList count={8} />
      ) : !board.data || board.data.top.length === 0 ? (
        <EmptyState compact emoji="🏆" title="No ranked games yet" description="Finish a game to appear on the leaderboard. Everyone starts at 1000." />
      ) : (
        board.data.top.map((e) => (
          <View key={e.user.id} style={[styles.row, { borderBottomColor: colors.border }]}>
            <Text variant="h4" color={e.rank <= 3 ? palette.gold : 'textMuted'} style={{ width: 36 }}>
              {e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : `#${e.rank}`}
            </Text>
            <Avatar uri={e.user.avatar_url} name={e.user.display_name} size={40} verified={e.user.is_verified} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text variant="bodySemibold">{e.user.display_name}</Text>
              <Text variant="caption" color="textMuted">
                {e.wins}W · {e.losses}L · {e.draws}D · {e.games_played} games
              </Text>
            </View>
            <Text variant="h4">{e.rating}</Text>
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  me: { padding: spacing.md, borderRadius: 12, marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
});
