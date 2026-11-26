import { Ionicons } from '@/components/ui/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { CountryPicker } from '@/components/ui/CountryPicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ListItem } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Sheet } from '@/components/ui/Sheet';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { countryName, flagEmoji } from '@/constants/countries';
import { languageName } from '@/constants/languages';
import { LanguagePickerSheet } from '@/features/discover/LanguagePickerSheet';
import { PersonCard } from '@/features/discover/PersonCard';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { DISCOVER_PAGE_SIZE, hasAnyPeopleFilter, hasPremiumPeopleFilter, searchPeople } from '@/services/discovery';
import { listInterests } from '@/services/interests';
import { getPremiumStatus } from '@/services/premium';
import { useAsync } from '@/hooks/useAsync';
import { useTheme } from '@/theme/ThemeProvider';
import { layout, radius, spacing } from '@/theme/tokens';
import type { DiscoverCard, PeopleSearchParams, PeopleSort } from '@/types/social';

const GENDERS = [
  { id: 'woman', label: 'Women' },
  { id: 'man', label: 'Men' },
  { id: 'non_binary', label: 'Non-binary' },
];

const SORTS: { id: PeopleSort; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'relevance', label: 'Best match', icon: 'sparkles-outline' },
  { id: 'active', label: 'Recently active', icon: 'time-outline' },
  { id: 'newest', label: 'Newest', icon: 'leaf-outline' },
  { id: 'popular', label: 'Popular', icon: 'flame-outline' },
  { id: 'name', label: 'Name', icon: 'text-outline' },
];

type Filters = Omit<PeopleSearchParams, 'query' | 'sort' | 'limit' | 'offset'>;

function filterKey(f: Filters): string {
  return JSON.stringify([f.country ?? '', (f.city ?? '').trim(), f.gender ?? '', [...(f.interestIds ?? [])].sort(), [...(f.languages ?? [])].sort(), f.onlineOnly ? 1 : 0, f.minAge ?? '', f.maxAge ?? '']);
}

export default function PeopleSearchScreen() {
  const params = useLocalSearchParams<{ q?: string; country?: string }>();
  const { colors } = useTheme();
  const { isDesktop } = useBreakpoint();
  const [query, setQuery] = useState(String(params.q ?? ''));
  const [debounced, setDebounced] = useState(String(params.q ?? '').trim());
  const [filters, setFilters] = useState<Filters>({ country: params.country ? String(params.country).toUpperCase() : null });
  const [draft, setDraft] = useState<Filters>(filters);
  const [sort, setSort] = useState<PeopleSort>('relevance');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [languagesOpen, setLanguagesOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const premium = useAsync(() => getPremiumStatus(), []);
  const interests = useAsync(() => listInterests(), []);
  const isPremium = Boolean(premium.data?.is_premium);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(query.trim()), 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const applied: PeopleSearchParams = { ...filters, query: debounced, sort };
  const results = usePagedQuery<DiscoverCard, number>(
    async (cursor) => {
      const offset = cursor ?? 0;
      const items = await searchPeople({ ...applied, limit: DISCOVER_PAGE_SIZE, offset });
      return { items, nextCursor: items.length < DISCOVER_PAGE_SIZE ? null : offset + DISCOVER_PAGE_SIZE };
    },
    (p) => p.id,
    `search:${debounced}:${sort}:${filterKey(filters)}`,
  );

  const applyFilters = () => {
    if (hasPremiumPeopleFilter(draft) && !isPremium) {
      setFiltersOpen(false);
      router.navigate('/premium' as never);
      return;
    }
    setFilters({ ...draft, city: draft.city?.trim() || null });
    setFiltersOpen(false);
  };

  const removeFilter = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const activeChips: { key: string; label: string; onRemove: () => void }[] = [];
  if (filters.country) activeChips.push({ key: 'country', label: `${flagEmoji(filters.country)} ${countryName(filters.country)}`, onRemove: () => removeFilter({ country: null }) });
  if (filters.city) activeChips.push({ key: 'city', label: `City: ${filters.city}`, onRemove: () => removeFilter({ city: null }) });
  if (filters.gender) activeChips.push({ key: 'gender', label: GENDERS.find((g) => g.id === filters.gender)?.label ?? filters.gender, onRemove: () => removeFilter({ gender: null }) });
  (filters.interestIds ?? []).forEach((id) => activeChips.push({ key: `i${id}`, label: interests.data?.find((i) => i.id === id)?.name ?? 'Interest', onRemove: () => removeFilter({ interestIds: (filters.interestIds ?? []).filter((x) => x !== id) }) }));
  (filters.languages ?? []).forEach((code) => activeChips.push({ key: `l${code}`, label: languageName(code), onRemove: () => removeFilter({ languages: (filters.languages ?? []).filter((x) => x !== code) }) }));
  if (filters.onlineOnly) activeChips.push({ key: 'online', label: 'Online now', onRemove: () => removeFilter({ onlineOnly: false }) });
  if (filters.minAge != null || filters.maxAge != null) activeChips.push({ key: 'age', label: `Age ${filters.minAge ?? 16}–${filters.maxAge ?? '99+'}`, onRemove: () => removeFilter({ minAge: null, maxAge: null }) });
  const anyFilter = hasAnyPeopleFilter(applied);

  const header = (
    <View style={{ paddingTop: spacing.md }}>
      <Input placeholder="Search by name or @username" leftIcon="search-outline" value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} returnKeyType="search" autoFocus={!params.q} rightElement={query ? <Ionicons name="close-circle" size={18} color={colors.textMuted} onPress={() => setQuery('')} /> : undefined} />
      <View style={styles.row}>
        <Chip label={activeChips.length ? `Filters · ${activeChips.length}` : 'Filters'} icon="options-outline" size="sm" selected={activeChips.length > 0} onPress={() => { setDraft(filters); setFiltersOpen(true); }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingLeft: spacing.sm }}>
          {SORTS.map((s) => (
            <Chip key={s.id} label={s.label} icon={s.icon} size="sm" selected={sort === s.id} onPress={() => setSort(s.id)} />
          ))}
        </ScrollView>
      </View>
      {activeChips.length > 0 ? (
        <View style={styles.activeRow}>
          {activeChips.map((c) => (
            <Chip key={c.key} label={c.label} size="sm" selected icon="close" onPress={c.onRemove} />
          ))}
          <Chip label="Clear all" size="sm" onPress={() => setFilters({})} />
        </View>
      ) : null}
      <Text variant="small" color="textMuted" style={{ marginVertical: spacing.md }}>
        {results.loading ? 'Searching…' : `${results.items.length}${results.hasMore ? '+' : ''} ${results.items.length === 1 ? 'person' : 'people'}${anyFilter ? ' match your search' : ' to discover'} · worldwide`}
      </Text>
    </View>
  );

  const premiumError = results.error && /premium/i.test(results.error);
  const empty = results.loading ? (
    <SkeletonList count={6} />
  ) : results.error ? (
    <EmptyState compact icon={premiumError ? 'diamond-outline' : 'cloud-offline-outline'} title={premiumError ? 'Premium filter' : 'Something went wrong'} description={results.error} action={premiumError ? { title: 'Go Premium', onPress: () => router.navigate('/premium' as never) } : { title: 'Retry', onPress: () => void results.refresh(), variant: 'secondary' }} secondaryAction={premiumError ? { title: 'Remove age filter', onPress: () => setFilters((f) => ({ ...f, minAge: null, maxAge: null })) } : undefined} />
  ) : (
    <EmptyState compact icon="search-outline" title="No people found" description="Try another name, remove a filter, or widen your search to more countries and languages. Only people who chose to be discoverable are shown." action={anyFilter ? { title: 'Clear filters', onPress: () => { setFilters({}); setQuery(''); }, variant: 'secondary' } : undefined} />
  );

  return (
    <Screen header={<ScreenHeader title="Search people" fallbackHref="/discover" />} padded={false}>
      <FlatList
        data={results.items}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <PersonCard person={item} />}
        contentContainerStyle={[styles.list, { paddingHorizontal: isDesktop ? spacing['3xl'] : spacing.lg }]}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={results.loadingMore ? <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.xl }} /> : undefined}
        onEndReached={() => void results.loadMore()}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={results.refreshing} onRefresh={() => void results.refresh()} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />

      <Sheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        subtitle="Filters only match people who chose to share that detail."
        maxHeightFraction={0.92}
        footer={
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
            <Button title="Reset" variant="ghost" onPress={() => setDraft({})} />
            <Button title={hasPremiumPeopleFilter(draft) && !isPremium ? 'Unlock age filter with Premium' : 'Show results'} onPress={applyFilters} style={{ flex: 1 }} leftIcon={hasPremiumPeopleFilter(draft) && !isPremium ? 'diamond-outline' : undefined} />
          </View>
        }
      >
        <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <CountryPicker value={draft.country ?? null} label="Country" placeholder="Any country" allowClear onChange={(code) => setDraft({ ...draft, country: code || null })} />
          <Input label="City" placeholder="Any city" value={draft.city ?? ''} onChangeText={(v) => setDraft({ ...draft, city: v })} autoCapitalize="words" containerStyle={{ marginTop: spacing.lg }} />

          <Text variant="label" color="textMuted" style={styles.label}>
            Gender
          </Text>
          <View style={styles.wrap}>
            {GENDERS.map((g) => (
              <Chip key={g.id} label={g.label} size="sm" selected={draft.gender === g.id} onPress={() => setDraft({ ...draft, gender: draft.gender === g.id ? null : g.id })} />
            ))}
          </View>
          <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs }}>
            Gender is voluntary — only people who show it on their profile are matched.
          </Text>

          <Text variant="label" color="textMuted" style={styles.label}>
            Interests
          </Text>
          <View style={styles.wrap}>
            {(interests.data ?? []).map((i) => {
              const on = (draft.interestIds ?? []).includes(i.id);
              return <Chip key={i.id} label={i.name} emoji={i.emoji} size="sm" selected={on} onPress={() => setDraft({ ...draft, interestIds: on ? (draft.interestIds ?? []).filter((x) => x !== i.id) : [...(draft.interestIds ?? []), i.id] })} />;
            })}
          </View>

          <Text variant="label" color="textMuted" style={styles.label}>
            Languages
          </Text>
          <View style={styles.wrap}>
            {(draft.languages ?? []).map((code) => (
              <Chip key={code} label={languageName(code)} size="sm" selected icon="close" onPress={() => setDraft({ ...draft, languages: (draft.languages ?? []).filter((x) => x !== code) })} />
            ))}
            <Chip label="Add language" icon="add" size="sm" onPress={() => setLanguagesOpen(true)} />
          </View>

          <ListItem icon="radio-button-on-outline" title="Online now only" switchValue={Boolean(draft.onlineOnly)} onSwitchChange={(v) => setDraft({ ...draft, onlineOnly: v })} style={{ marginTop: spacing.lg }} />

          <Text variant="label" color="textMuted" style={styles.label}>
            Age range {isPremium ? '' : '💎 Premium'}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Input placeholder="Min" keyboardType="number-pad" value={draft.minAge?.toString() ?? ''} onChangeText={(v) => setDraft({ ...draft, minAge: v ? Math.max(16, Math.min(99, Number(v) || 16)) : null })} containerStyle={{ flex: 1 }} />
            <Input placeholder="Max" keyboardType="number-pad" value={draft.maxAge?.toString() ?? ''} onChangeText={(v) => setDraft({ ...draft, maxAge: v ? Math.max(16, Math.min(99, Number(v) || 99)) : null })} containerStyle={{ flex: 1 }} />
          </View>
          <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs, marginBottom: spacing.lg }}>
            Ages are shown only for adults who chose to display them. Members under 18 and adults are never shown to each other.
          </Text>
        </ScrollView>
      </Sheet>

      <LanguagePickerSheet visible={languagesOpen} onClose={() => setLanguagesOpen(false)} value={draft.languages ?? []} onChange={(codes) => setDraft({ ...draft, languages: codes })} max={10} title="Languages" subtitle="Find people who speak…" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing['4xl'], maxWidth: layout.maxContentWidth + spacing['3xl'] * 2, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md },
  activeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  label: { marginTop: spacing.lg, marginBottom: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sheetNote: { borderRadius: radius.md },
});
