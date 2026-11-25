import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { PersonCard } from '@/features/discover/PersonCard';
import { DISCOVER_SECTIONS, getDiscoverSection, isDiscoverSection } from '@/features/discover/sections';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { DISCOVER_PAGE_SIZE, clearMyLocation, discoverPeople, refreshMyApproximateLocation } from '@/services/discovery';
import { updateMySettings } from '@/services/profiles';
import { useAuth, useAuthStore } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { layout, radius, spacing } from '@/theme/tokens';
import type { DiscoverCard } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';

export default function PeopleScreen() {
  const { kind: raw } = useLocalSearchParams<{ kind: string }>();
  const kind = isDiscoverSection(String(raw)) ? (String(raw) as ReturnType<typeof getDiscoverSection>['id']) : 'recommended';
  const meta = getDiscoverSection(kind);
  const { user, settings } = useAuth();
  const patchSettings = useAuthStore((s) => s.patchSettings);
  const { colors } = useTheme();
  const { isDesktop } = useBreakpoint();
  const toast = useToast();
  const [enabling, setEnabling] = useState(false);
  const nearbyOn = Boolean(settings?.nearby_enabled);

  const query = usePagedQuery<DiscoverCard, number>(
    async (cursor) => {
      const offset = cursor ?? 0;
      if (kind === 'nearby' && !nearbyOn) return { items: [], nextCursor: null };
      const items = await discoverPeople(kind, { limit: DISCOVER_PAGE_SIZE, offset });
      return { items, nextCursor: items.length < DISCOVER_PAGE_SIZE ? null : offset + DISCOVER_PAGE_SIZE };
    },
    (p) => p.id,
    `people:${kind}:${nearbyOn ? 'nearby-on' : 'nearby-off'}`,
  );

  const enableNearby = async () => {
    if (!user) return;
    setEnabling(true);
    try {
      await refreshMyApproximateLocation();
      if (!settings?.nearby_enabled) {
        await updateMySettings(user.id, { nearby_enabled: true });
        patchSettings({ nearby_enabled: true });
      }
      await query.refresh();
      toast.success('Nearby is on', 'Only an approximate location is stored.');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setEnabling(false);
    }
  };

  const disableNearby = async () => {
    if (!user) return;
    try {
      await clearMyLocation();
      await updateMySettings(user.id, { nearby_enabled: false });
      patchSettings({ nearby_enabled: false });
      toast.info('Nearby is off');
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const header = (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {DISCOVER_SECTIONS.map((s) => (
          <Chip key={s.id} label={s.short} icon={s.icon} size="sm" selected={s.id === kind} onPress={() => (s.id === kind ? undefined : router.replace(`/people/${s.id}` as never))} />
        ))}
      </ScrollView>
      <Text variant="small" color="textMuted" style={{ marginBottom: spacing.md }}>
        {meta.description}
      </Text>
      {kind === 'nearby' ? (
        <View style={[styles.banner, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
          <View style={{ flex: 1, marginHorizontal: spacing.md }}>
            <Text variant="smallMedium" color="primary">
              Approximate location only
            </Text>
            <Text variant="small" color="textSecondary">
              Friendzy stores your position rounded to about 1 km and shows people within 50 km who also opted in. Your exact location is never revealed.
            </Text>
          </View>
          {nearbyOn ? <Button title="Turn off" size="sm" variant="ghost" onPress={disableNearby} /> : <Button title="Turn on" size="sm" onPress={enableNearby} loading={enabling} />}
        </View>
      ) : null}
      {kind === 'nearby' && nearbyOn ? <Button title="Update my location" variant="ghost" size="sm" leftIcon="navigate-outline" onPress={enableNearby} loading={enabling} style={{ alignSelf: 'flex-start', marginBottom: spacing.sm }} /> : null}
    </View>
  );

  const empty = query.loading ? (
    <SkeletonList count={6} />
  ) : query.error ? (
    <EmptyState compact icon="cloud-offline-outline" title="Couldn't load people" description={query.error} action={{ title: 'Retry', onPress: () => void query.refresh(), variant: 'secondary' }} />
  ) : (
    <EmptyState
      compact
      icon={meta.icon}
      title={kind === 'nearby' && !nearbyOn ? 'Nearby is off' : meta.emptyTitle}
      description={meta.emptyText}
      action={kind === 'nearby' && !nearbyOn ? { title: 'Turn on nearby', onPress: () => void enableNearby() } : kind === 'interests' || kind === 'recommended' ? { title: 'Edit my interests', onPress: () => router.navigate('/onboarding/interests' as never), variant: 'secondary' } : { title: 'Try Meet Someone', onPress: () => router.navigate('/match' as never), variant: 'secondary' }}
      secondaryAction={{ title: 'Search people', onPress: () => router.navigate('/people/search' as never) }}
    />
  );

  return (
    <Screen header={<ScreenHeader title={meta.title} fallbackHref="/discover" right={<IconButton icon="search-outline" accessibilityLabel="Search people" onPress={() => router.navigate('/people/search' as never)} />} />} padded={false}>
      <FlatList
        data={query.items}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <PersonCard person={item} note={item.distance_km != null ? `~${item.distance_km} km away` : undefined} />}
        contentContainerStyle={[styles.list, { paddingHorizontal: isDesktop ? spacing['3xl'] : spacing.lg }]}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          query.loadingMore ? (
            <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.xl }} />
          ) : query.items.length > 0 && !query.hasMore ? (
            <Text variant="caption" color="textMuted" align="center" style={{ paddingVertical: spacing.xl }}>
              You’ve seen everyone in this section for now.
            </Text>
          ) : undefined
        }
        onEndReached={() => void query.loadMore()}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={query.refreshing} onRefresh={() => void query.refresh()} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing['4xl'], maxWidth: layout.maxContentWidth + spacing['3xl'] * 2, width: '100%', alignSelf: 'center' },
  tabs: { gap: spacing.sm, paddingVertical: spacing.md },
  banner: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.lg, marginBottom: spacing.md },
});
