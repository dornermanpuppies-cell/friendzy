import { View } from 'react-native';

import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { OnboardingShell } from '@/features/onboarding/OnboardingShell';
import { useOnboardingStep } from '@/features/onboarding/useOnboardingStep';
import { FollowButton } from '@/features/profile/FollowButton';
import { ProfileRow } from '@/features/profile/ProfileRow';
import { useAsync } from '@/hooks/useAsync';
import { getSuggestedProfiles } from '@/services/profiles';
import { spacing } from '@/theme/tokens';

export default function OnboardingSuggestedScreen() {
  const { index, saving, advance } = useOnboardingStep('suggested');
  const suggestions = useAsync(() => getSuggestedProfiles(15), []);

  return (
    <OnboardingShell
      step={index}
      title="People you might like"
      subtitle="Follow a few people to get your feed started. Suggestions are based on shared interests."
      primaryLabel="Finish & enter Friendzy"
      onPrimary={() => advance()}
      primaryLoading={saving}
      onSkip={() => advance()}
    >
      {suggestions.loading ? (
        <SkeletonList count={6} />
      ) : suggestions.error ? (
        <EmptyState compact icon="cloud-offline-outline" title="Couldn't load suggestions" description={suggestions.error} action={{ title: 'Try again', onPress: suggestions.reload, variant: 'secondary' }} />
      ) : suggestions.data && suggestions.data.length > 0 ? (
        <View>
          {suggestions.data.map((p) => (
            <ProfileRow
              key={p.id}
              profile={p}
              subtitle={p.shared_interests ? `${p.shared_interests} shared interest${p.shared_interests === 1 ? '' : 's'} · @${p.username}` : `@${p.username}`}
              right={<FollowButton targetId={p.id} state="none" isPrivate={p.is_private} />}
            />
          ))}
        </View>
      ) : (
        <EmptyState
          compact
          emoji="🌱"
          title="You're one of the first here"
          description="Friendzy is just getting started. As more people join, we'll suggest friends who share your interests."
        />
      )}
      <Text variant="small" color="textMuted" style={{ marginTop: spacing.lg }}>
        You can always find more people in Discover.
      </Text>
    </OnboardingShell>
  );
}
