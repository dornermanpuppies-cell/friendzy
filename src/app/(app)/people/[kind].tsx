import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { FollowButton } from '@/features/profile/FollowButton';
import { ProfileRow } from '@/features/profile/ProfileRow';
import { useAsync } from '@/hooks/useAsync';
import { clearMyLocation, getNearbyPeople, getOnlinePeople, refreshMyApproximateLocation } from '@/services/discovery';
import { getNewMembers, getPopularProfiles } from '@/services/profiles';
import { updateMySettings } from '@/services/profiles';
import { useAuth, useAuthStore } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import type { ProfileCard } from '@/types/database';
import { getErrorMessage } from '@/utils/errors';

type Kind = 'online' | 'nearby' | 'new' | 'popular';

const TITLES: Record<Kind, string> = { online: 'Online now', nearby: 'People nearby', new: 'New members', popular: 'Popular people' };

export default function PeopleScreen() {
  const { kind: raw } = useLocalSearchParams<{ kind: string }>();
  const kind = (['online', 'nearby', 'new', 'popular'].includes(String(raw)) ? raw : 'online') as Kind;
  const { user, settings } = useAuth();
  const patchSettings = useAuthStore((s) => s.patchSettings);
  const { colors } = useTheme();
  const toast = useToast();
  const [enabling, setEnabling] = useState(false);

  const query = useAsync<(ProfileCard & { distance_km?: number; is_online?: boolean | null; city?: string | null })[]>(async () => {
    if (kind === 'online') return getOnlinePeople(60);
    if (kind === 'new') return getNewMembers(user?.id, 60);
    if (kind === 'popular') return getPopularProfiles(user?.id, 60);
    const nearby = await getNearbyPeople(50, 60);
    return nearby.map((n) => ({ ...n.profile, distance_km: n.distance_km, is_online: n.is_online, city: n.city }));
  }, [kind, user?.id, settings?.nearby_enabled]);

  const enableNearby = async () => {
    if (!user) return;
    setEnabling(true);
    try {
      await refreshMyApproximateLocation();
      if (!settings?.nearby_enabled) {
        await updateMySettings(user.id, { nearby_enabled: true });
        patchSettings({ nearby_enabled: true });
      }
      await query.reload();
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

  return (
    <Screen header={<ScreenHeader title={TITLES[kind]} fallbackHref="/discover" />} scroll refreshing={query.refreshing} onRefresh={query.refresh}>
      {kind === 'nearby' ? (
        <View style={[styles.banner, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
          <View style={{ flex: 1, marginHorizontal: spacing.md }}>
            <Text variant="smallMedium" color="primary">
              Approximate location only
            </Text>
            <Text variant="small" color="textSecondary">
              Friendzy stores your position rounded to about 1 km and shows people within 50 km. Your exact location is never revealed.
            </Text>
          </View>
          {settings?.nearby_enabled ? <Button title="Turn off" size="sm" variant="ghost" onPress={disableNearby} /> : <Button title="Turn on" size="sm" onPress={enableNearby} loading={enabling} />}
        </View>
      ) : null}
      {kind === 'nearby' && settings?.nearby_enabled ? <Button title="Update my location" variant="ghost" size="sm" leftIcon="navigate-outline" onPress={enableNearby} loading={enabling} style={{ alignSelf: 'flex-start', marginBottom: spacing.sm }} /> : null}

      {query.loading ? (
        <SkeletonList count={8} />
      ) : query.error ? (
        <EmptyState compact icon="cloud-offline-outline" title="Couldn't load people" description={query.error} action={{ title: 'Retry', onPress: query.reload, variant: 'secondary' }} />
      ) : query.data && query.data.length > 0 ? (
        query.data.map((p) => (
          <ProfileRow
            key={p.id}
            profile={p}
            online={kind === 'online' ? true : p.is_online}
            subtitle={kind === 'nearby' ? `~${p.distance_km} km away${p.city ? ` · ${p.city}` : ''}` : undefined}
            right={p.id !== user?.id ? <FollowButton targetId={p.id} state="none" isPrivate={p.is_private} /> : undefined}
          />
        ))
      ) : (
        <EmptyState
          compact
          emoji={kind === 'online' ? '🟢' : kind === 'nearby' ? '📍' : '🌱'}
          title={kind === 'online' ? 'Nobody is online right now' : kind === 'nearby' ? (settings?.nearby_enabled ? 'No one nearby yet' : 'Nearby is off') : 'No people yet'}
          description={kind === 'nearby' && !settings?.nearby_enabled ? 'Turn on nearby discovery to find people around you.' : 'Check back soon — Friendzy is growing every day.'}
          action={{ title: 'Try random match', onPress: () => router.navigate('/match' as never), variant: 'secondary' }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.lg, marginVertical: spacing.lg },
});
