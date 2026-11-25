import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { Text } from '@/components/ui/Text';
import { OnboardingShell } from '@/features/onboarding/OnboardingShell';
import { useOnboardingStep } from '@/features/onboarding/useOnboardingStep';
import { spacing } from '@/theme/tokens';

const PROMPTS = [
  'Here to make friends from around the world 🌍',
  'Gamer looking for a squad 🎮',
  'Music lover · always up for a chat 🎧',
  'Learning languages — let’s practice together 🗣️',
  'Creator sharing my daily life ✨',
];

export default function OnboardingBioScreen() {
  const { index, saving, advance, skip, profile } = useOnboardingStep('bio');
  const [bio, setBio] = useState(profile?.bio ?? '');

  return (
    <OnboardingShell
      step={index}
      title="Say hi in a few words"
      subtitle="A short bio helps people understand what you're about."
      onPrimary={() => advance({ bio: bio.trim() || null })}
      primaryLoading={saving}
      onSkip={skip}
    >
      <Input placeholder="Tell people a little about you…" value={bio} onChangeText={setBio} multiline maxLength={300} showCounter autoFocus />
      <Text variant="smallMedium" color="textMuted" style={{ marginTop: spacing['2xl'], marginBottom: spacing.sm }}>
        Need inspiration?
      </Text>
      <View style={styles.prompts}>
        {PROMPTS.map((p) => (
          <Chip key={p} label={p} size="sm" selected={bio === p} onPress={() => setBio(p)} />
        ))}
      </View>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({ prompts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm } });
