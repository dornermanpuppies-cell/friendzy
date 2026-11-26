import { Ionicons } from '@/components/ui/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { TopBar } from '@/components/layout/TopBar';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { PersonCard } from '@/features/discover/PersonCard';
import { DISCOVER_SECTIONS, type DiscoverSectionMeta } from '@/features/discover/sections';
import { BannerRail } from '@/features/site/AnnouncementBar';
import { useAsync } from '@/hooks/useAsync';
import { discoverPeople } from '@/services/discovery';
import { getFeaturedCreators, getTrendingTopics } from '@/services/siteContent';
import { useAuth } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { gradients, palette, radius, shadows, spacing } from '@/theme/tokens';
import type { DiscoverCard, DiscoverSection } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';

const RAIL_SIZE = 12;

type RailState = { people: DiscoverCard[] | null; error: string | null };

function ShortcutCard({ title, subtitle, icon, colors: grad, onPress }: { title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap; colors: readonly [string, string, ...string[]]; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.shortcut} accessibilityRole="button" accessibilityLabel={title}>
      <LinearGradient colors={[...grad]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Ionicons name={icon} size={22} color={palette.white} />
      <Text variant="bodySemibold" color={palette.white} style={{ marginTop: spacing.sm }}>
        {title}
      </Text>
      <Text variant="caption" color="rgba(255,255,255,0.85)" numberOfLines={2}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

function Rail({ meta, state, loading, nearbyOff }: { meta: DiscoverSectionMeta; state: RailState | undefined; loading: boolean; nearbyOff?: boolean }) {
  const { colors } = useTheme();
  const href = `/people/${meta.id}`;
  return (
    <View style={styles.rail}>
      <Pressable onPress={() => router.navigate(href as never)} style={styles.railHeader} accessibilityRole="button" accessibilityLabel={`See all: ${meta.title}`}>
        <View style={[styles.railIcon, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name={meta.icon} size={16} color={colors.primary} />
        </View>
        <Text variant="h4" style={{ flex: 1 }} numberOfLines={1}>
          {meta.title}
        </Text>
        <Text variant="smallMedium" color="primary">
          See all
        </Text>
      </Pressable>
      {nearbyOff ? (
        <Pressable onPress={() => router.navigate(href as never)} style={[styles.nearbyCta, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]} accessibilityRole="button">
          <Ionicons name="location-outline" size={20} color={colors.primary} />
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text variant="smallMedium">Turn on nearby discovery</Text>
            <Text variant="caption" color="textMuted">
              Uses an approximate location only. Your exact position is never shared.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
      ) : loading && !state ? (
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} width={156} height={196} rounded={18} />
          ))}
        </View>
      ) : state?.error ? (
        <Text variant="small" color="danger">
          {state.error}
        </Text>
      ) : state?.people && state.people.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingVertical: 2 }}>
          {state.people.map((p) => (
            <PersonCard key={p.id} person={p} variant="tile" note={p.distance_km != null ? `~${p.distance_km} km` : undefined} />
          ))}
          <Pressable onPress={() => router.navigate(href as never)} style={[styles.moreTile, { borderColor: colors.border }]} accessibilityRole="button" accessibilityLabel={`See all ${meta.title}`}>
            <Ionicons name="arrow-forward-circle" size={28} color={colors.primary} />
            <Text variant="smallMedium" color="primary" style={{ marginTop: spacing.xs }}>
              See all
            </Text>
          </Pressable>
        </ScrollView>
      ) : (
        <Text variant="small" color="textMuted">
          {meta.emptyText}
        </Text>
      )}
    </View>
  );
}

export default function DiscoverScreen() {
  const { settings, profile } = useAuth();
  const { colors } = useTheme();
  const nearbyOn = Boolean(settings?.nearby_enabled);

  // One request wave for all eight sections; a failing section never hides the others.
  const rails = useAsync<Partial<Record<DiscoverSection, RailState>>>(async () => {
    const sections = DISCOVER_SECTIONS.filter((s) => s.id !== 'nearby' || nearbyOn);
    const settled = await Promise.allSettled(sections.map((s) => discoverPeople(s.id, { limit: RAIL_SIZE })));
    const out: Partial<Record<DiscoverSection, RailState>> = {};
    sections.forEach((s, i) => {
      const r = settled[i];
      out[s.id] = r.status === 'fulfilled' ? { people: r.value, error: null } : { people: null, error: getErrorMessage(r.reason) };
    });
    return out;
  }, [nearbyOn]);
  const topics = useAsync(() => getTrendingTopics(12), []);
  const featured = useAsync(() => getFeaturedCreators(12), []);

  return (
    <Screen
      header={<TopBar title="Discover" right={<IconButton icon="options-outline" accessibilityLabel="Advanced people search" onPress={() => router.navigate('/people/search' as never)} />} />}
      scroll
      padded
      refreshing={rails.refreshing}
      onRefresh={() => Promise.all([rails.refresh(), topics.refresh(), featured.refresh()])}
    >
      <Pressable onPress={() => router.navigate('/people/search' as never)} accessibilityRole="search" accessibilityLabel="Search people worldwide" style={[styles.searchBar, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
        <Text variant="body" color="placeholder" style={{ flex: 1, marginLeft: spacing.sm }} numberOfLines={1}>
          Search people by name, country, interests, language…
        </Text>
        <Ionicons name="options-outline" size={18} color={colors.primary} />
      </Pressable>

      <BannerRail placement="discover" />

      <Pressable onPress={() => router.navigate('/match' as never)} style={[styles.matchCard, shadows.glow]} accessibilityRole="button" accessibilityLabel="Meet someone new">
        <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={{ flex: 1 }}>
          <Text variant="h3" color={palette.white}>
            Meet someone
          </Text>
          <Text variant="small" color="rgba(255,255,255,0.88)" style={{ marginTop: 2 }}>
            Get matched live with someone around the world who fits your preferences. You choose what happens next.
          </Text>
        </View>
        <View style={styles.matchIcon}>
          <Ionicons name="shuffle" size={26} color={palette.white} />
        </View>
      </Pressable>

      <View style={styles.quickRow}>
        <Button title="Friends" variant="secondary" size="sm" leftIcon="people-outline" onPress={() => router.navigate('/friends' as never)} />
        <Button title="Requests" variant="secondary" size="sm" leftIcon="person-add-outline" onPress={() => router.navigate('/requests' as never)} />
        <Button title="Search" variant="secondary" size="sm" leftIcon="search-outline" onPress={() => router.navigate('/people/search' as never)} />
      </View>

      <View style={styles.shortcuts}>
        <ShortcutCard title="Videos" subtitle="Short videos from creators" icon="play-circle" colors={gradients.primary} onPress={() => router.navigate('/videos' as never)} />
        <ShortcutCard title="Games" subtitle="Ludo, Chess, Trivia & more" icon="game-controller" colors={gradients.cool} onPress={() => router.navigate('/games' as never)} />
        <ShortcutCard title="Challenges" subtitle="Join hashtag challenges" icon="trophy" colors={[palette.gold, palette.pink]} onPress={() => router.navigate('/challenges' as never)} />
      </View>

      {DISCOVER_SECTIONS.slice(0, 3).map((meta) => (
        <Rail key={meta.id} meta={meta} state={rails.data?.[meta.id]} loading={rails.loading} nearbyOff={meta.id === 'nearby' && !nearbyOn} />
      ))}

      {featured.data && featured.data.length > 0 ? (
        <View style={styles.rail}>
          <Text variant="h4" style={{ marginBottom: spacing.sm }}>
            Featured creators
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
            {featured.data.map((c) => (
              <Pressable key={c.id} onPress={() => router.navigate(c.is_live ? '/live' : (`/u/${c.username}` as never))} style={[styles.creatorCard, { backgroundColor: colors.surface, borderColor: c.is_live ? palette.pink : colors.border }]}>
                <Avatar uri={c.avatar_url} name={c.display_name} size={56} verified={c.is_verified} ring={c.is_live} />
                <Text variant="smallMedium" numberOfLines={1} align="center" style={{ marginTop: spacing.sm }}>
                  {c.display_name}
                </Text>
                <Text variant="caption" color={c.is_live ? 'accent' : 'textMuted'} numberOfLines={1} align="center">
                  {c.is_live ? '● LIVE now' : (c.note ?? `${c.followers_count} followers`)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {DISCOVER_SECTIONS.slice(3, 6).map((meta) => (
        <Rail key={meta.id} meta={meta} state={rails.data?.[meta.id]} loading={rails.loading} />
      ))}

      {topics.data && topics.data.length > 0 ? (
        <View style={styles.rail}>
          <Text variant="h4" style={{ marginBottom: spacing.sm }}>
            Trending now
          </Text>
          <View style={styles.wrap}>
            {topics.data.map((t) => (
              <Chip key={t.tag} label={t.pinned ? `📌 ${t.label ?? `#${t.tag}`}` : `#${t.tag}`} size="sm" onPress={() => router.navigate(t.kind === 'challenge' ? (`/challenge/${t.tag}` as never) : (`/tag/${t.tag}` as never))} />
            ))}
          </View>
        </View>
      ) : null}

      {DISCOVER_SECTIONS.slice(6).map((meta) => (
        <Rail key={meta.id} meta={meta} state={rails.data?.[meta.id]} loading={rails.loading} />
      ))}

      <View style={[styles.privacyNote, { backgroundColor: colors.surfaceMuted }]}>
        <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} />
        <Text variant="caption" color="textSecondary" style={{ flex: 1, marginLeft: spacing.sm }}>
          Only people who chose to be discoverable appear here. Age, city, languages and activity are shown only when their owner allows it, and exact locations are never revealed.
          {profile?.discoverable === false ? ' You are currently hidden from discovery (Settings → Privacy).' : ''}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchBar: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderRadius: radius.full, borderWidth: 1, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  matchCard: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.xl, padding: spacing.lg, marginTop: spacing.xl, overflow: 'hidden' },
  matchIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginLeft: spacing.md },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  shortcuts: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  shortcut: { flex: 1, minHeight: 104, borderRadius: radius.lg, padding: spacing.md, overflow: 'hidden' },
  rail: { marginTop: spacing['2xl'] },
  railHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.sm },
  railIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  moreTile: { width: 96, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed' },
  nearbyCta: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  creatorCard: { width: 124, alignItems: 'center', padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  privacyNote: { flexDirection: 'row', alignItems: 'flex-start', padding: spacing.md, borderRadius: radius.lg, marginTop: spacing['2xl'] },
});
