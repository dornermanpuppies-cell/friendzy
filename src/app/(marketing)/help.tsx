import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { Metadata } from 'expo-router/server';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { MarketingArticle, MarketingLayout } from '@/components/layout/MarketingLayout';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

export function generateMetadata(): Metadata {
  return { title: 'Friendzy Help & Support', description: 'Answers to common questions about accounts, privacy, safety and Friendzy features.' };
}

const FAQ: { q: string; a: string }[] = [
  { q: 'I did not receive my verification email', a: 'Check your spam or promotions folder and make sure the address is correct. You can request a new email from the “Verify your email” screen. Links expire after one hour.' },
  { q: 'How do I reset my password?', a: 'On the sign-in screen choose “Forgot password?”. We will email you a link to choose a new password. If you are signed in, go to Settings → Password & security.' },
  { q: 'Can I change my username?', a: 'Yes — Settings → Edit profile. Usernames must be 3–30 characters (lowercase letters, numbers, underscores and periods) and can be changed once every 14 days.' },
  { q: 'Who can see my profile and activity?', a: 'Everyone can see public profiles. Switch on “Private account” in Settings → Privacy to approve followers manually. You can also hide your online status and last seen, and control who can message or comment.' },
  { q: 'Does Friendzy share my location?', a: 'No. Nearby discovery is off by default, uses only an approximate location when enabled, and never shows your exact position to anyone.' },
  { q: 'How do I block or report someone?', a: 'Open their profile, tap the ••• menu and choose Block or Report. Blocked people cannot find or contact you. Reports are confidential and reviewed by our safety team.' },
  { q: 'How do I delete my account?', a: 'Settings → Delete account. You will need to confirm your password. Deletion is permanent and removes your profile, connections and settings.' },
  { q: 'What is the minimum age?', a: 'You must be 16 or older to use Friendzy. Random matching, livestreaming, gifts and nearby discovery are limited to users aged 18 and over.' },
  { q: 'When are messaging, video, LIVE and games coming?', a: 'They are being built in phases on the same account and design system. Follow people now — your network carries over automatically as each feature launches.' },
];

export default function HelpPage() {
  const { colors } = useTheme();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <MarketingLayout>
      <MarketingArticle title="Help & support" subtitle="Quick answers to the most common questions. Still stuck? Contact us and we will help.">
        <View style={styles.list}>
          {FAQ.map((item, i) => {
            const expanded = open === i;
            return (
              <Pressable key={item.q} onPress={() => setOpen(expanded ? null : i)} accessibilityRole="button" accessibilityState={{ expanded }} style={[styles.item, { borderColor: colors.border, backgroundColor: expanded ? colors.surfaceMuted : colors.surface }]}>
                <View style={styles.itemHeader}>
                  <Text variant="h4" style={{ flex: 1 }}>
                    {item.q}
                  </Text>
                  <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
                </View>
                {expanded ? (
                  <Text variant="body" color="textSecondary" style={{ marginTop: spacing.md }}>
                    {item.a}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        <View style={styles.cta}>
          <Button title="Contact support" leftIcon="mail-outline" onPress={() => router.navigate('/contact')} />
          <Button title="Community Guidelines" variant="outline" onPress={() => router.navigate('/guidelines')} />
        </View>
      </MarketingArticle>
    </MarketingLayout>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  item: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.xl },
  itemHeader: { flexDirection: 'row', alignItems: 'center' },
  cta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing['3xl'] },
});
