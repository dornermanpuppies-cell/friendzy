import { Ionicons } from '@/components/ui/Ionicons';
import type { Metadata } from 'expo-router/server';
import { StyleSheet, View } from 'react-native';

import { MarketingArticle, MarketingLayout } from '@/components/layout/MarketingLayout';
import { Pill } from '@/components/ui/Badge';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

export function generateMetadata(): Metadata {
  return { title: 'Friendzy features', description: 'Discovery, messaging, calls, short video, stories, livestreaming, games, gifts and Premium — all in Friendzy.' };
}

const GROUPS: { title: string; icon: keyof typeof Ionicons.glyphMap; status: 'live' | 'soon'; items: string[] }[] = [
  { title: 'Accounts & profiles', icon: 'person-circle-outline', status: 'live', items: ['Email sign-up with verification and password recovery', 'Rich profiles with cover, bio, interests, country and stats', 'Private or public accounts, blocking and reporting', 'Active-session management and account deletion'] },
  { title: 'Meet new people', icon: 'people-outline', status: 'live', items: ['Suggestions by shared interests', 'Search by name, username and country', 'New members, popular people, follow & friend requests', 'Random matching and nearby discovery (coming next)'] },
  { title: 'Messaging & calls', icon: 'chatbubbles-outline', status: 'soon', items: ['One-to-one and group chats with media, voice notes, replies and reactions', 'Read receipts, typing indicators, pinned and starred messages', 'Voice and video calls, group calls and call history'] },
  { title: 'Video & stories', icon: 'play-circle-outline', status: 'soon', items: ['Full-screen vertical video feed with creator tools', '24-hour stories with highlights', 'Duets, stitches, sounds and challenges'] },
  { title: 'LIVE', icon: 'radio-outline', status: 'soon', items: ['Interactive livestreams with multi-guest sessions and battles', 'Gifts, fan clubs and supporter badges', 'Scheduled lives and live discovery'] },
  { title: 'Games, gifts & Premium', icon: 'game-controller-outline', status: 'soon', items: ['Ludo, chess, trivia and party games with friends', 'Coins, animated gifts and creator earnings with an auditable ledger', 'Friendzy Premium monthly and yearly plans'] },
];

export default function FeaturesPage() {
  const { colors } = useTheme();
  return (
    <MarketingLayout>
      <MarketingArticle title="Everything Friendzy does" subtitle="One account. One design. Web, Android and iOS. Here is what is available today and what is being built next.">
        <View style={styles.grid}>
          {GROUPS.map((g) => (
            <View key={g.title} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
                  <Ionicons name={g.icon} size={22} color={colors.primary} />
                </View>
                <Pill label={g.status === 'live' ? 'Available now' : 'In development'} tone={g.status === 'live' ? 'success' : 'primary'} />
              </View>
              <Text variant="h3" style={{ marginTop: spacing.md }}>
                {g.title}
              </Text>
              {g.items.map((item) => (
                <View key={item} style={styles.item}>
                  <Ionicons name="checkmark-circle" size={18} color={g.status === 'live' ? '#22C55E' : colors.textMuted} />
                  <Text variant="body" color="textSecondary" style={{ flex: 1, marginLeft: spacing.sm }}>
                    {item}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </MarketingArticle>
    </MarketingLayout>
  );
}

const styles = StyleSheet.create({
  grid: { gap: spacing.lg },
  card: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing['2xl'] },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  icon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  item: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.md },
});
