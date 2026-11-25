import { useState } from 'react';

import { CountryPicker } from '@/components/ui/CountryPicker';
import { Input } from '@/components/ui/Input';
import { Text } from '@/components/ui/Text';
import { OnboardingShell } from '@/features/onboarding/OnboardingShell';
import { useOnboardingStep } from '@/features/onboarding/useOnboardingStep';
import { spacing } from '@/theme/tokens';

export default function OnboardingCountryScreen() {
  const { index, saving, advance, profile } = useOnboardingStep('country');
  const [countryCode, setCountryCode] = useState(profile?.country_code ?? '');
  const [city, setCity] = useState(profile?.city ?? '');

  return (
    <OnboardingShell
      step={index}
      title="Where are you based?"
      subtitle="Your country helps people discover you. City is optional and never used to reveal your exact location."
      onPrimary={() => advance({ country_code: countryCode, city: city.trim() || null })}
      primaryDisabled={!countryCode}
      primaryLoading={saving}
    >
      <CountryPicker value={countryCode || null} onChange={setCountryCode} />
      <Input label="City (optional)" placeholder="e.g. Lisbon" value={city} onChangeText={setCity} maxLength={80} containerStyle={{ marginTop: spacing.lg }} autoCapitalize="words" />
      <Text variant="small" color="textMuted" style={{ marginTop: spacing.lg }}>
        Nearby discovery uses only an approximate location and stays off until you turn it on in Settings → Privacy.
      </Text>
    </OnboardingShell>
  );
}
