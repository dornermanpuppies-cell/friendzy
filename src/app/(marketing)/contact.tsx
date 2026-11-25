import { Ionicons } from '@expo/vector-icons';
import type { Metadata } from 'expo-router/server';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { MarketingArticle, MarketingLayout, Paragraph } from '@/components/layout/MarketingLayout';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

export function generateMetadata(): Metadata {
  return { title: 'Contact Friendzy', description: 'Get in touch with the Friendzy team for support, safety, press and partnerships.' };
}

const CHANNELS: { icon: keyof typeof Ionicons.glyphMap; title: string; email: string; text: string }[] = [
  { icon: 'help-buoy-outline', title: 'Support', email: 'support@friendzy.app', text: 'Account access, bugs and general questions.' },
  { icon: 'shield-checkmark-outline', title: 'Trust & Safety', email: 'safety@friendzy.app', text: 'Report urgent safety concerns or abuse.' },
  { icon: 'lock-closed-outline', title: 'Privacy', email: 'privacy@friendzy.app', text: 'Data requests and privacy questions.' },
  { icon: 'briefcase-outline', title: 'Business & press', email: 'hello@friendzy.app', text: 'Partnerships, creators and media.' },
];

export default function ContactPage() {
  const { colors } = useTheme();
  return (
    <MarketingLayout>
      <MarketingArticle title="Contact us" subtitle="We read every message. For the fastest help with your account, use the Help & support section first.">
        <View style={styles.grid}>
          {CHANNELS.map((c) => (
            <Pressable key={c.email} onPress={() => Linking.openURL(`mailto:${c.email}`)} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]} accessibilityRole="link">
              <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
                <Ionicons name={c.icon} size={22} color={colors.primary} />
              </View>
              <Text variant="h4" style={{ marginTop: spacing.md }}>
                {c.title}
              </Text>
              <Text variant="body" color="textMuted" style={{ marginTop: 4 }}>
                {c.text}
              </Text>
              <Text variant="bodySemibold" color="primary" style={{ marginTop: spacing.md }}>
                {c.email}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={{ marginTop: spacing['3xl'] }}>
          <Paragraph>If someone is in immediate danger, contact your local emergency services first, then report the account in the app so our safety team can act.</Paragraph>
        </View>
      </MarketingArticle>
    </MarketingLayout>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  card: { flexBasis: 300, flexGrow: 1, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing['2xl'] },
  icon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
