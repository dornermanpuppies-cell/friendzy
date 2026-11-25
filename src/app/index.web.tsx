import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, router } from 'expo-router';
import type { Metadata } from 'expo-router/server';
import { useEffect, useState, type PropsWithChildren } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';

import { MarketingLayout } from '@/components/layout/MarketingLayout';
import { Avatar } from '@/components/ui/Avatar';
import { Pill } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useAuthStore } from '@/store/authStore';
import { ThemeScope, useTheme } from '@/theme/ThemeProvider';
import { gradients, layout, palette, radius, shadows, spacing } from '@/theme/tokens';

export function generateMetadata(): Metadata {
  return {
    title: 'Friendzy — Meet. Connect. Play. Earn.',
    description:
      'Friendzy is a worldwide social platform to meet new people, chat privately and in groups, make voice and video calls, share short videos and stories, go live, play social games and support creators.',
  };
}

const FEATURES = [
  { icon: 'people', title: 'Meet new people', text: 'Discover people worldwide by interests, country and vibe. Random matching when you feel spontaneous.', colors: gradients.cool },
  { icon: 'chatbubbles', title: 'Chat like you mean it', text: 'Private and group conversations with voice notes, replies, reactions, media and read receipts.', colors: gradients.primary },
  { icon: 'videocam', title: 'Voice & video calls', text: 'Crystal-clear one-to-one and group calls powered by real-time media infrastructure.', colors: [palette.pink, palette.blue] as const },
  { icon: 'play-circle', title: 'Short videos & stories', text: 'A full-screen vertical feed with creator tools, duets, sounds and 24-hour stories.', colors: gradients.brand },
  { icon: 'radio', title: 'Go LIVE together', text: 'Interactive livestreams with multi-guest sessions, gifts, battles and moderation tools.', colors: [palette.purple, palette.blue] as const },
  { icon: 'game-controller', title: 'Play & earn', text: 'Ludo, chess, trivia and party games with friends. Creators earn through gifts and fan support.', colors: [palette.gold, palette.pink] as const },
] as const;

const STATS = [
  { value: '3', label: 'platforms, one account' },
  { value: '190+', label: 'countries supported' },
  { value: '24/7', label: 'safety & moderation' },
];

function Reveal({ children, delay = 0, style }: PropsWithChildren<{ delay?: number; style?: object }>) {
  const [opacity] = useState(() => new Animated.Value(Platform.OS === 'web' ? 0 : 1));
  const [translateY] = useState(() => new Animated.Value(Platform.OS === 'web' ? 18 : 0));
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 520, delay, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 520, delay, useNativeDriver: true }),
    ]).start();
  }, [delay, opacity, translateY]);
  return <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>{children}</Animated.View>;
}

function Section({ children, dark = false, style }: PropsWithChildren<{ dark?: boolean; style?: object }>) {
  const { isMobile } = useBreakpoint();
  const inner = (
    <View style={[styles.section, { paddingHorizontal: isMobile ? spacing.lg : spacing['3xl'] }, style]}>
      <View style={styles.sectionInner}>{children}</View>
    </View>
  );
  if (!dark) return inner;
  return (
    <ThemeScope scheme="dark">
      <View style={{ backgroundColor: palette.night }}>{inner}</View>
    </ThemeScope>
  );
}

/** Illustrative phone mock built from the design system (no fake user data). */
function PhoneMock() {
  return (
    <View style={[styles.phone, shadows.md]}>
      <LinearGradient colors={['#1B0B3E', palette.night]} style={StyleSheet.absoluteFill} />
      <View style={styles.phoneNotch} />
      <View style={styles.phoneHeader}>
        <Text variant="h4" color={palette.white}>
          Discover
        </Text>
        <Ionicons name="search" size={18} color="rgba(255,255,255,0.8)" />
      </View>
      <View style={styles.storyRow}>
        {['You', 'Live', 'New', 'Near'].map((label, i) => (
          <View key={label} style={{ alignItems: 'center', marginRight: spacing.md }}>
            <Avatar name={label} size={46} ring={i !== 0} />
            <Text variant="caption" color="rgba(255,255,255,0.75)" style={{ marginTop: 4 }}>
              {label}
            </Text>
          </View>
        ))}
      </View>
      {[
        { name: 'Nearby creators', meta: 'Live now · 2.1K watching', pill: 'LIVE', tone: 'gradient' as const },
        { name: 'Language exchange', meta: '12 people online', pill: 'Room', tone: 'primary' as const },
        { name: 'Trivia night', meta: 'Starts in 5 min', pill: 'Game', tone: 'success' as const },
      ].map((row) => (
        <View key={row.name} style={styles.mockRow}>
          <View style={styles.mockThumb}>
            <LinearGradient colors={[...gradients.primary]} style={StyleSheet.absoluteFill} />
          </View>
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text variant="bodySemibold" color={palette.white}>
              {row.name}
            </Text>
            <Text variant="caption" color="rgba(255,255,255,0.65)">
              {row.meta}
            </Text>
          </View>
          <Pill label={row.pill} tone={row.tone} />
        </View>
      ))}
      <View style={styles.mockTabBar}>
        {(['home', 'compass', 'add', 'radio', 'person'] as const).map((icon, i) => (
          <View key={icon} style={[styles.mockTab, i === 2 && styles.mockCreate]}>
            {i === 2 ? (
              <LinearGradient colors={[...gradients.primary]} style={[StyleSheet.absoluteFill, { borderRadius: 20 }]} />
            ) : null}
            <Ionicons name={icon} size={i === 2 ? 22 : 18} color={i === 2 ? palette.white : i === 1 ? palette.pinkSoft : 'rgba(255,255,255,0.6)'} />
          </View>
        ))}
      </View>
    </View>
  );
}

export default function LandingPage() {
  const status = useAuthStore((s) => s.status);
  const { colors } = useTheme();
  const { isMobile, isDesktop } = useBreakpoint();

  if (status === 'signedIn') return <Redirect href="/home" />;

  return (
    <MarketingLayout>
      {/* Hero */}
      <ThemeScope scheme="dark">
        <LinearGradient colors={['#1B0B3E', palette.purpleDeep, palette.night]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={styles.orbPink} />
          <View style={styles.orbBlue} />
          <View style={[styles.heroInner, { paddingHorizontal: isMobile ? spacing.lg : spacing['3xl'], flexDirection: isDesktop ? 'row' : 'column' }]}>
            <View style={[styles.heroText, isDesktop && { paddingRight: spacing['5xl'] }]}>
              <Reveal>
                <Pill label="Now in early access" tone="gradient" icon="sparkles" />
              </Reveal>
              <Reveal delay={80}>
                <Text variant="hero" color={palette.white} style={[styles.heroTitle, isMobile && { fontSize: 38, lineHeight: 44 }]}>
                  Meet. Connect.{'\n'}Play. Earn.
                </Text>
              </Reveal>
              <Reveal delay={160}>
                <Text variant="bodyLg" color="rgba(255,255,255,0.8)" style={{ marginTop: spacing.lg, maxWidth: 520 }}>
                  Friendzy brings together everything you love about social apps — meeting new people, real conversations, short
                  videos, livestreams and games — in one beautiful, safe place. One account across web, Android and iOS.
                </Text>
              </Reveal>
              <Reveal delay={240}>
                <View style={[styles.heroActions, isMobile && { flexDirection: 'column' }]}>
                  <Button title="Join Friendzy — it's free" size="lg" onPress={() => router.push('/sign-up')} fullWidth={isMobile} />
                  <Button title="Sign in" size="lg" variant="light" onPress={() => router.push('/sign-in')} fullWidth={isMobile} style={isMobile ? { marginTop: spacing.md } : { marginLeft: spacing.md }} />
                </View>
              </Reveal>
              <Reveal delay={320}>
                <View style={styles.stats}>
                  {STATS.map((s) => (
                    <View key={s.label} style={styles.stat}>
                      <Text variant="h2" color={palette.white}>
                        {s.value}
                      </Text>
                      <Text variant="small" color="rgba(255,255,255,0.65)">
                        {s.label}
                      </Text>
                    </View>
                  ))}
                </View>
              </Reveal>
            </View>
            <Reveal delay={200} style={[styles.heroMock, !isDesktop && { marginTop: spacing['4xl'], alignSelf: 'center' }]}>
              <PhoneMock />
            </Reveal>
          </View>
        </LinearGradient>
      </ThemeScope>

      {/* Features */}
      <Section>
        <Text variant="label" color="primary">
          Everything in one app
        </Text>
        <Text variant={isMobile ? 'h1' : 'hero'} style={{ marginTop: spacing.sm, maxWidth: 720 }}>
          The strongest social features, designed as one connected experience.
        </Text>
        <View style={[styles.grid, { marginTop: spacing['3xl'] }]}>
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={60 * i} style={[styles.featureCard, { width: isDesktop ? '31.5%' : isMobile ? '100%' : '48%', backgroundColor: colors.surface, borderColor: colors.border }]}>
              <LinearGradient colors={[...f.colors] as [string, string, ...string[]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.featureIcon}>
                <Ionicons name={f.icon} size={22} color={palette.white} />
              </LinearGradient>
              <Text variant="h4" style={{ marginTop: spacing.lg }}>
                {f.title}
              </Text>
              <Text variant="body" color="textMuted" style={{ marginTop: spacing.sm }}>
                {f.text}
              </Text>
            </Reveal>
          ))}
        </View>
      </Section>

      {/* Discovery */}
      <Section style={{ backgroundColor: colors.surfaceMuted }}>
        <View style={[styles.split, !isDesktop && { flexDirection: 'column' }]}>
          <View style={styles.splitText}>
            <Text variant="label" color="primary">
              Social discovery
            </Text>
            <Text variant="h1" style={{ marginTop: spacing.sm }}>
              Find your people, anywhere on Earth.
            </Text>
            <Text variant="bodyLg" color="textSecondary" style={{ marginTop: spacing.lg }}>
              People you may know, trending creators, new members, people online right now and optional nearby discovery — all
              with privacy controls you set yourself. Your exact location is never shared.
            </Text>
            <View style={{ marginTop: spacing['2xl'], gap: spacing.md }}>
              {['Search by username, country, city or interests', 'Random matching based on compatible interests', 'Follow, add friends or message — according to each person’s privacy settings'].map((t) => (
                <View key={t} style={styles.check}>
                  <Ionicons name="checkmark-circle" size={20} color={palette.purple} />
                  <Text variant="body" color="textSecondary" style={{ marginLeft: spacing.sm, flex: 1 }}>
                    {t}
                  </Text>
                </View>
              ))}
            </View>
          </View>
          <View style={[styles.splitVisual, !isDesktop && { marginTop: spacing['3xl'] }]}>
            <View style={[styles.cardStack, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.md]}>
              {['Shared interests', 'Online now', 'New this week'].map((label, i) => (
                <View key={label} style={[styles.stackRow, { borderColor: colors.border }]}>
                  <Avatar name={label} size={44} online={i === 1} />
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text variant="bodySemibold">{label}</Text>
                    <Text variant="small" color="textMuted">
                      Smart suggestions tuned to your interests
                    </Text>
                  </View>
                  <Button title="Follow" size="sm" onPress={() => router.push('/sign-up')} />
                </View>
              ))}
            </View>
          </View>
        </View>
      </Section>

      {/* Messaging + Live */}
      <Section dark>
        <View style={[styles.split, !isDesktop && { flexDirection: 'column' }]}>
          <View style={styles.splitText}>
            <Text variant="label" color={palette.pinkSoft}>
              Messaging & calls
            </Text>
            <Text variant="h1" color={palette.white} style={{ marginTop: spacing.sm }}>
              Conversations that feel alive.
            </Text>
            <Text variant="bodyLg" color="rgba(255,255,255,0.75)" style={{ marginTop: spacing.lg }}>
              Swipe to reply, react, edit, forward and star messages. Voice notes with playback speed, disappearing messages,
              group chats with admins and invite links, plus voice and video calls — all synced across your devices.
            </Text>
          </View>
          <View style={[styles.splitText, !isDesktop && { marginTop: spacing['3xl'] }]}>
            <Text variant="label" color={palette.blueSoft}>
              Video & LIVE
            </Text>
            <Text variant="h1" color={palette.white} style={{ marginTop: spacing.sm }}>
              Create, go live, get support.
            </Text>
            <Text variant="bodyLg" color="rgba(255,255,255,0.75)" style={{ marginTop: spacing.lg }}>
              A vertical short-video feed with powerful creator tools, 24-hour stories and interactive livestreams with
              multi-guest sessions, animated gifts, fan clubs and creator earnings.
            </Text>
          </View>
        </View>
      </Section>

      {/* Premium */}
      <Section>
        <LinearGradient colors={['#1B0B3E', palette.purple, palette.pink]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.premium, { padding: isMobile ? spacing['2xl'] : spacing['5xl'] }]}>
          <View style={{ flex: 1 }}>
            <Pill label="Friendzy Premium" tone="premium" icon="diamond" />
            <Text variant="h1" color={palette.white} style={{ marginTop: spacing.lg, maxWidth: 560 }}>
              Stand out, see who likes you and unlock exclusive features.
            </Text>
            <Text variant="bodyLg" color="rgba(255,255,255,0.85)" style={{ marginTop: spacing.md, maxWidth: 560 }}>
              Advanced discovery filters, more profile visibility, exclusive badges and gifts, premium themes and priority support.
              Monthly and yearly plans — billed through the App Store, Google Play or card on the web.
            </Text>
            <Button title="Create your account" variant="light" size="lg" style={{ marginTop: spacing['2xl'] }} onPress={() => router.push('/sign-up')} />
          </View>
        </LinearGradient>
      </Section>

      {/* Download */}
      <Section style={{ paddingTop: 0 }}>
        <View style={[styles.download, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <View style={{ flex: 1 }}>
            <Text variant="h2">Friendzy on every screen</Text>
            <Text variant="body" color="textMuted" style={{ marginTop: spacing.sm, maxWidth: 520 }}>
              Use Friendzy in your browser today. The Android and iOS apps are in development and will be published on Google Play and
              the App Store — same account, same friends, same conversations.
            </Text>
          </View>
          <View style={[styles.storeBadges, isMobile && { marginTop: spacing.lg }]}>
            {[
              { icon: 'logo-apple', label: 'App Store', sub: 'Coming soon' },
              { icon: 'logo-google-playstore', label: 'Google Play', sub: 'Coming soon' },
            ].map((b) => (
              <View key={b.label} style={[styles.storeBadge, { backgroundColor: palette.ink }]}>
                <Ionicons name={b.icon as keyof typeof Ionicons.glyphMap} size={22} color={palette.white} />
                <View style={{ marginLeft: spacing.sm }}>
                  <Text variant="caption" color="rgba(255,255,255,0.7)">
                    {b.sub}
                  </Text>
                  <Text variant="bodySemibold" color={palette.white}>
                    {b.label}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </Section>
    </MarketingLayout>
  );
}

const styles = StyleSheet.create({
  hero: { overflow: 'hidden', paddingVertical: spacing['6xl'] },
  heroInner: { width: '100%', maxWidth: layout.maxPageWidth, alignSelf: 'center', alignItems: 'center' },
  heroText: { flex: 1, width: '100%' },
  heroTitle: { marginTop: spacing.lg },
  heroActions: { flexDirection: 'row', marginTop: spacing['3xl'] },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing['3xl'], marginTop: spacing['4xl'] },
  stat: {},
  heroMock: { alignItems: 'center' },
  orbPink: { position: 'absolute', width: 520, height: 520, borderRadius: 260, backgroundColor: 'rgba(255,40,185,0.22)', top: -200, right: -120 },
  orbBlue: { position: 'absolute', width: 460, height: 460, borderRadius: 230, backgroundColor: 'rgba(39,107,255,0.26)', bottom: -220, left: -140 },
  phone: { width: 300, height: 600, borderRadius: 44, overflow: 'hidden', borderWidth: 8, borderColor: '#0E0B22', padding: spacing.lg },
  phoneNotch: { alignSelf: 'center', width: 96, height: 24, borderRadius: 12, backgroundColor: '#0E0B22', marginTop: -spacing.lg + 8, marginBottom: spacing.md },
  phoneHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  storyRow: { flexDirection: 'row', marginBottom: spacing.lg },
  mockRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  mockThumb: { width: 48, height: 48, borderRadius: radius.md, overflow: 'hidden' },
  mockTabBar: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.08)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  mockTab: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  mockCreate: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden' },
  section: { paddingVertical: spacing['6xl'] },
  sectionInner: { width: '100%', maxWidth: layout.maxPageWidth, alignSelf: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xl },
  featureCard: { borderRadius: radius.xl, padding: spacing['2xl'], borderWidth: StyleSheet.hairlineWidth },
  featureIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  split: { flexDirection: 'row', alignItems: 'center', gap: spacing['5xl'] },
  splitText: { flex: 1 },
  splitVisual: { flex: 1, width: '100%' },
  check: { flexDirection: 'row', alignItems: 'flex-start' },
  cardStack: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  stackRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  premium: { borderRadius: radius['2xl'], flexDirection: 'row', overflow: 'hidden' },
  download: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing['2xl'], flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg },
  storeBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  storeBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md, minWidth: 160 },
});
