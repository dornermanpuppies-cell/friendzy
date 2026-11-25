import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { TopBar } from '@/components/layout/TopBar';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { CountryPicker } from '@/components/ui/CountryPicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { ListItem } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton, SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { countryName, flagEmoji } from '@/constants/countries';
import { FollowButton } from '@/features/profile/FollowButton';
import { ProfileRow } from '@/features/profile/ProfileRow';
import { BannerRail } from '@/features/site/AnnouncementBar';
import { useAsync } from '@/hooks/useAsync';
import { getNearbyPeople, getOnlinePeople } from '@/services/discovery';
import { getPremiumStatus, hasPremiumFilters, searchProfilesAdvanced, type AdvancedSearchParams } from '@/services/premium';
import { getNewMembers, getPopularProfiles, getSuggestedProfiles, searchProfiles } from '@/services/profiles';
import { getFeaturedCreators, getTrendingTopics } from '@/services/siteContent';
import { useAuth } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { gradients, palette, radius, shadows, spacing } from '@/theme/tokens';
import type { ProfileCard } from '@/types/database';

type Section = 'suggested' | 'new' | 'popular';

const SECTIONS: { id: Section; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'suggested', label: 'For you', icon: 'sparkles-outline' },
  { id: 'new', label: 'New members', icon: 'leaf-outline' },
  { id: 'popular', label: 'Popular', icon: 'flame-outline' },
];

const GENDERS = [
  { id: 'woman', label: 'Women' },
  { id: 'man', label: 'Men' },
  { id: 'non_binary', label: 'Non-binary' },
];

function PeopleRail({ title, href, people, loading, emptyText, subtitle }: { title: string; href: string; people: ProfileCard[] | null; loading: boolean; emptyText: string; subtitle?: (p: ProfileCard) => string | undefined }) {
  const { colors } = useTheme();
  return (
    <View style={styles.rail}>
      <View style={styles.railHeader}>
        <Text variant="h4">{title}</Text>
        <Pressable onPress={() => router.navigate(href as never)} hitSlop={8}>
          <Text variant="smallMedium" color="primary">
            See all
          </Text>
        </Pressable>
      </View>
      {loading && !people ? (
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} width={120} height={150} rounded={18} />
          ))}
        </View>
      ) : people && people.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
          {people.map((p) => (
            <Pressable key={p.id} onPress={() => router.navigate(`/u/${p.username}` as never)} style={[styles.personCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Avatar uri={p.avatar_url} name={p.display_name} size={56} online={title === 'Online now' ? true : undefined} verified={p.is_verified} />
              <Text variant="smallMedium" numberOfLines={1} align="center" style={{ marginTop: spacing.sm }}>
                {p.display_name}
              </Text>
              <Text variant="caption" color="textMuted" numberOfLines={1} align="center">
                {subtitle?.(p) ?? `@${p.username}`}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <Text variant="small" color="textMuted">
          {emptyText}
        </Text>
      )}
    </View>
  );
}

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

export default function DiscoverScreen() {
  const params = useLocalSearchParams<{ filters?: string }>();
  const { user, settings } = useAuth();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [country, setCountry] = useState<string | null>(null);
  const [countryOpen, setCountryOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(params.filters === '1');
  const [filters, setFilters] = useState<AdvancedSearchParams>({});
  const [draft, setDraft] = useState<AdvancedSearchParams>({});
  const [section, setSection] = useState<Section>('suggested');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const premium = useAsync(() => getPremiumStatus(), []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(query.trim()), 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const advanced = hasPremiumFilters(filters) || Boolean(filters.verifiedOnly);
  const searching = debounced.length > 0 || Boolean(country) || advanced;

  const results = useAsync<ProfileCard[]>(() => {
    if (advanced) return searchProfilesAdvanced({ ...filters, query: debounced, country, limit: 40 }).then((rows) => rows.map((r) => ({ ...r, is_private: r.is_private, shared_interests: r.shared_interests })) as unknown as ProfileCard[]);
    if (searching) return searchProfiles({ query: debounced, country, limit: 40 });
    if (section === 'new') return getNewMembers(user?.id, 30);
    if (section === 'popular') return getPopularProfiles(user?.id, 30);
    return getSuggestedProfiles(30);
  }, [searching, advanced, debounced, country, section, user?.id, JSON.stringify(filters)]);

  const online = useAsync(() => getOnlinePeople(12), []);
  const nearby = useAsync(() => (settings?.nearby_enabled ? getNearbyPeople(50, 12) : Promise.resolve([])), [settings?.nearby_enabled]);
  const topics = useAsync(() => getTrendingTopics(12), []);
  const featured = useAsync(() => getFeaturedCreators(12), []);

  const applyFilters = () => {
    if (hasPremiumFilters(draft) && !premium.data?.is_premium) {
      setFiltersOpen(false);
      router.navigate('/premium' as never);
      return;
    }
    setFilters(draft);
    setFiltersOpen(false);
  };
  const activeFilterCount = [filters.minAge != null || filters.maxAge != null, Boolean(filters.gender), Boolean(filters.onlineOnly), Boolean(filters.verifiedOnly)].filter(Boolean).length;

  return (
    <Screen
      header={<TopBar title="Discover" right={<IconButton icon="search-outline" accessibilityLabel="Search everything" onPress={() => router.navigate('/search' as never)} />} />}
      scroll
      padded
      refreshing={results.refreshing}
      onRefresh={() => Promise.all([results.refresh(), online.refresh(), nearby.refresh(), topics.refresh(), featured.refresh()])}
    >
      <View style={{ paddingTop: spacing.md }}>
        <Input placeholder="Search people by name or @username" leftIcon="search-outline" value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} returnKeyType="search" />
        <View style={styles.filters}>
          <Chip label={country ? `${flagEmoji(country)} ${countryName(country)}` : 'Country'} icon={country ? undefined : 'globe-outline'} selected={Boolean(country)} onPress={() => setCountryOpen(true)} size="sm" />
          <Chip label={activeFilterCount ? `Filters · ${activeFilterCount}` : 'Filters'} icon="options-outline" selected={activeFilterCount > 0} onPress={() => { setDraft(filters); setFiltersOpen(true); }} size="sm" style={{ marginLeft: spacing.sm }} />
          {country || activeFilterCount ? (
            <Pressable onPress={() => { setCountry(null); setFilters({}); }} hitSlop={8} accessibilityLabel="Clear filters" style={styles.clear}>
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {!searching ? (
        <>
          <BannerRail placement="discover" />
          <Pressable onPress={() => router.navigate('/match' as never)} style={[styles.matchCard, shadows.glow]} accessibilityRole="button" accessibilityLabel="Start random matching">
            <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <View style={{ flex: 1 }}>
              <Text variant="h3" color={palette.white}>
                Random match
              </Text>
              <Text variant="small" color="rgba(255,255,255,0.85)" style={{ marginTop: 2 }}>
                Meet someone new who shares your interests. Skip anytime.
              </Text>
            </View>
            <View style={styles.matchIcon}>
              <Ionicons name="shuffle" size={26} color={palette.white} />
            </View>
          </Pressable>

          <View style={styles.shortcuts}>
            <ShortcutCard title="Videos" subtitle="Short videos from creators" icon="play-circle" colors={gradients.primary} onPress={() => router.navigate('/videos' as never)} />
            <ShortcutCard title="Games" subtitle="Ludo, Chess, Trivia & more" icon="game-controller" colors={gradients.cool} onPress={() => router.navigate('/games' as never)} />
            <ShortcutCard title="Challenges" subtitle="Join hashtag challenges" icon="trophy" colors={[palette.gold, palette.pink]} onPress={() => router.navigate('/challenges' as never)} />
          </View>

          {featured.data && featured.data.length > 0 ? (
            <View style={styles.rail}>
              <Text variant="h4" style={{ marginBottom: spacing.sm }}>
                Featured creators
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
                {featured.data.map((c) => (
                  <Pressable key={c.id} onPress={() => router.navigate(c.is_live ? '/live' : (`/u/${c.username}` as never))} style={[styles.personCard, { backgroundColor: colors.surface, borderColor: c.is_live ? palette.pink : colors.border }]}>
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

          <PeopleRail title="Online now" href="/people/online" people={online.data} loading={online.loading} emptyText="Nobody online right now — check back soon." />
          <PeopleRail
            title="Nearby"
            href="/people/nearby"
            people={nearby.data ? nearby.data.map((n) => ({ ...n.profile, distance: n.distance_km })) : null}
            loading={nearby.loading}
            emptyText={settings?.nearby_enabled ? 'No one nearby yet.' : 'Turn on nearby discovery to see people around you.'}
            subtitle={(p) => ((p as ProfileCard & { distance?: number }).distance ? `~${(p as ProfileCard & { distance?: number }).distance} km` : undefined)}
          />

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

          <View style={styles.sections}>
            {SECTIONS.map((s) => (
              <Chip key={s.id} label={s.label} icon={s.icon} selected={section === s.id} onPress={() => setSection(s.id)} />
            ))}
          </View>
        </>
      ) : (
        <Text variant="small" color="textMuted" style={{ marginTop: spacing.lg }}>
          {results.data ? `${results.data.length} result${results.data.length === 1 ? '' : 's'}${advanced ? ' · advanced filters' : ''}` : 'Searching…'}
        </Text>
      )}

      <View style={{ marginTop: spacing.md }}>
        {results.loading ? (
          <SkeletonList count={8} />
        ) : results.error ? (
          <EmptyState compact icon={/premium/i.test(results.error) ? 'diamond-outline' : 'cloud-offline-outline'} title={/premium/i.test(results.error) ? 'Premium filters' : 'Something went wrong'} description={results.error} action={/premium/i.test(results.error) ? { title: 'Go Premium', onPress: () => router.navigate('/premium' as never) } : { title: 'Retry', onPress: results.reload, variant: 'secondary' }} />
        ) : results.data && results.data.length > 0 ? (
          results.data.map((p) => (
            <ProfileRow
              key={p.id}
              profile={p}
              subtitle={(p as ProfileCard & { is_online?: boolean }).is_online ? `Online now · @${p.username}` : p.shared_interests ? `${p.shared_interests} shared interest${p.shared_interests === 1 ? '' : 's'} · @${p.username}` : undefined}
              right={p.id !== user?.id ? <FollowButton targetId={p.id} state="none" isPrivate={p.is_private} /> : undefined}
            />
          ))
        ) : searching ? (
          <EmptyState compact icon="search-outline" title="No people found" description="Try a different name, username, country or filters." />
        ) : (
          <EmptyState compact emoji="🌍" title={section === 'suggested' ? 'No suggestions yet' : 'Nobody here yet'} description="Friendzy is just getting started. Invite friends and check back soon." action={{ title: 'Try random match', onPress: () => router.navigate('/match' as never), variant: 'secondary' }} />
        )}
      </View>

      <Sheet visible={countryOpen} onClose={() => setCountryOpen(false)} title="Filter by country">
        <CountryPicker value={country} label="" allowClear onChange={(code) => { setCountry(code || null); setCountryOpen(false); }} />
        <Text variant="small" color="textMuted" style={{ marginVertical: spacing.lg }}>
          Only people who chose to be discoverable are shown. Exact locations are never revealed.
        </Text>
      </Sheet>

      <Sheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title="Search filters" subtitle={premium.data?.is_premium ? 'Premium filters unlocked' : 'Age, gender and online filters are a Premium perk'} footer={<View style={{ flexDirection: 'row', gap: spacing.sm }}><Button title="Reset" variant="ghost" onPress={() => setDraft({})} /><Button title={hasPremiumFilters(draft) && !premium.data?.is_premium ? 'Unlock with Premium' : 'Apply'} onPress={applyFilters} style={{ flex: 1 }} leftIcon={hasPremiumFilters(draft) && !premium.data?.is_premium ? 'diamond-outline' : undefined} /></View>}>
        <Text variant="label" color="textMuted" style={{ marginBottom: spacing.xs }}>
          Age range {premium.data?.is_premium ? '' : '💎'}
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Input placeholder="Min" keyboardType="number-pad" value={draft.minAge?.toString() ?? ''} onChangeText={(v) => setDraft({ ...draft, minAge: v ? Math.max(16, Math.min(120, Number(v))) : null })} containerStyle={{ flex: 1 }} />
          <Input placeholder="Max" keyboardType="number-pad" value={draft.maxAge?.toString() ?? ''} onChangeText={(v) => setDraft({ ...draft, maxAge: v ? Math.max(16, Math.min(120, Number(v))) : null })} containerStyle={{ flex: 1 }} />
        </View>
        <Text variant="label" color="textMuted" style={{ marginTop: spacing.lg, marginBottom: spacing.xs }}>
          Gender {premium.data?.is_premium ? '' : '💎'}
        </Text>
        <View style={styles.wrap}>
          {GENDERS.map((g) => (
            <Chip key={g.id} label={g.label} size="sm" selected={draft.gender === g.id} onPress={() => setDraft({ ...draft, gender: draft.gender === g.id ? null : g.id })} />
          ))}
        </View>
        <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs }}>
          Only people who chose to show their gender are matched by this filter.
        </Text>
        <ListItem icon="radio-button-on-outline" title={`Online now ${premium.data?.is_premium ? '' : '💎'}`} switchValue={Boolean(draft.onlineOnly)} onSwitchChange={(v) => setDraft({ ...draft, onlineOnly: v })} />
        <ListItem icon="checkmark-circle-outline" title="Verified accounts only" switchValue={Boolean(draft.verifiedOnly)} onSwitchChange={(v) => setDraft({ ...draft, verifiedOnly: v })} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md },
  clear: { marginLeft: spacing.sm },
  matchCard: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.xl, padding: spacing.lg, marginTop: spacing.xl, overflow: 'hidden' },
  matchIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginLeft: spacing.md },
  shortcuts: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  shortcut: { flex: 1, minHeight: 104, borderRadius: radius.lg, padding: spacing.md, overflow: 'hidden' },
  rail: { marginTop: spacing['2xl'] },
  railHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  personCard: { width: 124, alignItems: 'center', padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sections: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing['2xl'] },
});
