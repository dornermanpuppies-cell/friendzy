import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { Metadata } from 'expo-router/server';
import { StyleSheet, View } from 'react-native';

import { MarketingArticle, MarketingLayout, Paragraph } from '@/components/layout/MarketingLayout';
import { Pill } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';

export function generateMetadata(): Metadata {
  return { title: 'Download Friendzy', description: 'Use Friendzy on the web today. Android and iOS apps are coming to Google Play and the App Store.' };
}

const PLATFORMS: { icon: keyof typeof Ionicons.glyphMap; title: string; status: string; available: boolean; text: string }[] = [
  { icon: 'globe-outline', title: 'Web', status: 'Available now', available: true, text: 'Works in any modern browser on desktop and mobile. Same account as the apps.' },
  { icon: 'logo-android', title: 'Android', status: 'Coming soon', available: false, text: 'Built with Expo. Will be published on Google Play once the mobile phases are complete.' },
  { icon: 'logo-apple', title: 'iOS', status: 'Coming soon', available: false, text: 'Built with Expo. Will be published on the App Store once the mobile phases are complete.' },
];

export default function DownloadPage() {
  const { colors } = useTheme();
  return (
    <MarketingLayout>
      <MarketingArticle title="Get Friendzy" subtitle="One account across every platform. Start on the web today and pick up where you left off on your phone later.">
        <View style={styles.grid}>
          {PLATFORMS.map((p) => (
            <View key={p.title} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.header}>
                <View style={[styles.icon, { backgroundColor: p.available ? colors.primarySoft : colors.surfaceMuted }]}>
                  <Ionicons name={p.icon} size={24} color={p.available ? colors.primary : colors.textMuted} />
                </View>
                <Pill label={p.status} tone={p.available ? 'success' : 'neutral'} />
              </View>
              <Text variant="h3" style={{ marginTop: spacing.md }}>
                {p.title}
              </Text>
              <Text variant="body" color="textMuted" style={{ marginTop: 4 }}>
                {p.text}
              </Text>
              {p.available ? <Button title="Open Friendzy" style={{ marginTop: spacing.lg }} onPress={() => router.navigate('/sign-up')} /> : null}
            </View>
          ))}
        </View>
        <View style={{ marginTop: spacing['3xl'] }}>
          <Paragraph>Store listings go live after the Android and iOS builds pass review. We never link to unofficial downloads — if you see a “Friendzy” app from another publisher, report it to safety@friendzy.app.</Paragraph>
          <Text variant="small" color={palette.ink3}>
            Apple and the Apple logo are trademarks of Apple Inc. Google Play is a trademark of Google LLC.
          </Text>
        </View>
      </MarketingArticle>
    </MarketingLayout>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  card: { flexBasis: 240, flexGrow: 1, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing['2xl'] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  icon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
