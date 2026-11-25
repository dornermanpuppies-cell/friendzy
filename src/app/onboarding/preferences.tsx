import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/ui/Chip';
import { ListItem, ListSection } from '@/components/ui/ListItem';
import { Text } from '@/components/ui/Text';
import { LOOKING_FOR_OPTIONS } from '@/constants/interests';
import { OnboardingShell } from '@/features/onboarding/OnboardingShell';
import { useOnboardingStep } from '@/features/onboarding/useOnboardingStep';
import { updateMySettings } from '@/services/profiles';
import { useAuthStore } from '@/store/authStore';
import { spacing } from '@/theme/tokens';

export default function OnboardingPreferencesScreen() {
  const { index, saving, advance, skip, user, profile } = useOnboardingStep('preferences');
  const settings = useAuthStore((s) => s.settings);
  const setSettings = useAuthStore((s) => s.setSettings);
  const [lookingFor, setLookingFor] = useState<Set<string>>(new Set(settings?.looking_for ?? ['friends']));
  const [discoverable, setDiscoverable] = useState(profile?.discoverable ?? true);
  const [showOnline, setShowOnline] = useState(settings?.show_online_status ?? true);
  const [randomMatch, setRandomMatch] = useState(settings?.random_match_enabled ?? true);

  const toggle = (id: string) =>
    setLookingFor((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <OnboardingShell
      step={index}
      title="How do you want to connect?"
      subtitle="You stay in control — every option can be changed later in Settings."
      onPrimary={() =>
        advance(
          { discoverable },
          {
            beforeSave: async () => {
              if (!user) return;
              const updated = await updateMySettings(user.id, {
                looking_for: Array.from(lookingFor),
                show_online_status: showOnline,
                random_match_enabled: randomMatch,
              });
              setSettings(updated);
            },
          },
        )
      }
      primaryLoading={saving}
      onSkip={skip}
    >
      <Text variant="label" color="textMuted" style={{ marginBottom: spacing.md }}>
        {"I'm here for"}
      </Text>
      <View style={styles.wrap}>
        {LOOKING_FOR_OPTIONS.map((o) => (
          <Chip key={o.id} label={o.label} emoji={o.emoji} selected={lookingFor.has(o.id)} onPress={() => toggle(o.id)} />
        ))}
      </View>

      <ListSection title="Discovery" style={{ marginTop: spacing['3xl'] }}>
        <ListItem icon="compass-outline" title="Show me in Discover" subtitle="Appear in suggestions, search and new members" switchValue={discoverable} onSwitchChange={setDiscoverable} />
        <ListItem icon="shuffle-outline" title="Random matching" subtitle="Let Friendzy match you with people who share your interests" switchValue={randomMatch} onSwitchChange={setRandomMatch} />
        <ListItem icon="ellipse-outline" title="Show when I'm online" subtitle="Friends can see your online status" switchValue={showOnline} onSwitchChange={setShowOnline} />
      </ListSection>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({ wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm } });
