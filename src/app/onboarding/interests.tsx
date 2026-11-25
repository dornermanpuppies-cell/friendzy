import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { MAX_INTERESTS, MIN_INTERESTS, type InterestItem } from '@/constants/interests';
import { OnboardingShell } from '@/features/onboarding/OnboardingShell';
import { stepIndex } from '@/features/onboarding/steps';
import { useOnboardingStep } from '@/features/onboarding/useOnboardingStep';
import { useAsync } from '@/hooks/useAsync';
import { getUserInterestIds, groupInterestsByCategory, listInterests, setUserInterests } from '@/services/interests';
import { useAuthStore } from '@/store/authStore';
import { spacing } from '@/theme/tokens';

export default function OnboardingInterestsScreen() {
  const userId = useAuthStore((s) => s.user?.id);
  const catalogue = useAsync(() => listInterests(), []);
  const existing = useAsync(() => (userId ? getUserInterestIds(userId) : Promise.resolve([] as number[])), [userId]);

  if (catalogue.loading || existing.loading) {
    return (
      <OnboardingShell step={stepIndex('interests')} title="What are you into?" subtitle="Loading interests…" onPrimary={() => undefined} primaryDisabled>
        <View style={styles.wrap}>
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} width={90 + (i % 4) * 22} height={40} rounded={20} />
          ))}
        </View>
      </OnboardingShell>
    );
  }

  if (catalogue.error || !catalogue.data) {
    return (
      <OnboardingShell step={stepIndex('interests')} title="What are you into?" onPrimary={catalogue.reload} primaryLabel="Try again">
        <EmptyState compact icon="cloud-offline-outline" title="Couldn't load interests" description={catalogue.error ?? undefined} />
      </OnboardingShell>
    );
  }

  return <InterestsStep interests={catalogue.data} initialSelected={existing.data ?? []} />;
}

/** Mounted only once the catalogue and the user's current picks are loaded. */
function InterestsStep({ interests, initialSelected }: { interests: InterestItem[]; initialSelected: number[] }) {
  const { index, saving, advance, skip, user } = useOnboardingStep('interests');
  const [selected, setSelected] = useState<Set<number>>(() => new Set(initialSelected));

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_INTERESTS) next.add(id);
      return next;
    });
  };

  const groups = groupInterestsByCategory(interests);
  const count = selected.size;

  return (
    <OnboardingShell
      step={index}
      title="What are you into?"
      subtitle={`Pick ${MIN_INTERESTS} to ${MAX_INTERESTS} interests. We'll use them to suggest people and content you'll love.`}
      primaryLabel={count >= MIN_INTERESTS ? `Continue with ${count} selected` : `Select ${MIN_INTERESTS - count} more`}
      primaryDisabled={count < MIN_INTERESTS}
      primaryLoading={saving}
      onPrimary={() =>
        advance(undefined, {
          beforeSave: async () => {
            if (user) await setUserInterests(user.id, Array.from(selected));
          },
        })
      }
      onSkip={skip}
    >
      {groups.map((group) => (
        <View key={group.category} style={{ marginBottom: spacing['2xl'] }}>
          <Text variant="label" color="textMuted" style={{ marginBottom: spacing.md }}>
            {group.category}
          </Text>
          <View style={styles.wrap}>
            {group.items.map((item) => (
              <Chip
                key={item.id}
                label={item.name}
                emoji={item.emoji}
                selected={selected.has(item.id)}
                onPress={() => toggle(item.id)}
                disabled={!selected.has(item.id) && count >= MAX_INTERESTS}
              />
            ))}
          </View>
        </View>
      ))}
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({ wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm } });
