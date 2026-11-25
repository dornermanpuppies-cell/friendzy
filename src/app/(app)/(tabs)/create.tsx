import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TopBar } from '@/components/layout/TopBar';
import { Pill } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { gradients, palette, radius, spacing } from '@/theme/tokens';

interface CreateOption {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  colors: readonly string[];
  href?: string;
  phase?: string;
}

const OPTIONS: CreateOption[] = [
  { id: 'post', title: 'Post', description: 'Text, photos, carousels, polls and questions for your followers.', icon: 'create-outline', colors: gradients.cool, href: '/compose/post' },
  { id: 'story', title: 'Story', description: 'A photo, video or text card that disappears after 24 hours.', icon: 'aperture-outline', colors: gradients.ring, href: '/compose/story' },
  { id: 'video', title: 'Video', description: 'Record or upload a short video with music, text and effects.', icon: 'videocam-outline', colors: gradients.primary, href: '/compose/video' },
  { id: 'live', title: 'Go LIVE', description: 'Broadcast to your followers, invite guests and receive gifts.', icon: 'radio-outline', colors: [palette.pink, palette.purple], href: '/live/go' },
];

export default function CreateScreen() {
  const { colors } = useTheme();
  const [selected, setSelected] = useState<CreateOption | null>(null);

  const open = (option: CreateOption) => {
    if (option.href) router.navigate(option.href as never);
    else setSelected(option);
  };

  return (
    <Screen header={<TopBar title="Create" showShortcuts={false} />} scroll padded>
      <Text variant="body" color="textMuted" style={{ marginTop: spacing.md }}>
        Share something with the Friendzy community.
      </Text>
      <View style={styles.grid}>
        {OPTIONS.map((option) => (
          <Pressable key={option.id} onPress={() => open(option)} accessibilityRole="button" style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.85 }]}>
            <LinearGradient colors={[...option.colors] as [string, string, ...string[]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.icon}>
              <Ionicons name={option.icon} size={24} color={palette.white} />
            </LinearGradient>
            <Text variant="h4" style={{ marginTop: spacing.md }}>
              {option.title}
            </Text>
            <Text variant="small" color="textMuted" style={{ marginTop: 4 }}>
              {option.description}
            </Text>
            {option.phase ? <Pill label="Coming soon" tone="primary" icon="time-outline" style={{ marginTop: spacing.md }} /> : null}
          </Pressable>
        ))}
      </View>

      <Sheet visible={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.title} subtitle={selected?.phase}>
        <Text variant="body" color="textSecondary">
          {selected?.description}
        </Text>
        <Button title="Got it" fullWidth onPress={() => setSelected(null)} style={{ marginVertical: spacing.lg }} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xl },
  card: { width: '47.5%', flexGrow: 1, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  icon: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
