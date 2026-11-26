import { Ionicons } from '@/components/ui/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { Input } from '@/components/ui/Input';
import { Text } from '@/components/ui/Text';
import { OnboardingShell } from '@/features/onboarding/OnboardingShell';
import { useOnboardingStep } from '@/features/onboarding/useOnboardingStep';
import { isUsernameAvailable } from '@/services/profiles';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, spacing } from '@/theme/tokens';
import { normalizeUsername, usernameError } from '@/utils/validation';

export default function OnboardingUsernameScreen() {
  const { index, saving, advance, profile } = useOnboardingStep('username');
  const { colors } = useTheme();
  const [username, setUsername] = useState(profile?.username ?? '');
  const [check, setCheck] = useState<{ value: string; available: boolean | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const normalized = normalizeUsername(username);
  const unchanged = normalized === profile?.username;
  const error = normalized ? usernameError(normalized) : 'Choose a username.';

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!normalized || unchanged || usernameError(normalized)) return;
    timer.current = setTimeout(async () => {
      try {
        setCheck({ value: normalized, available: await isUsernameAvailable(normalized) });
      } catch {
        setCheck({ value: normalized, available: null });
      }
    }, 450);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [normalized, unchanged]);

  const status: 'idle' | 'checking' | 'available' | 'taken' | 'invalid' =
    !normalized || unchanged
      ? 'idle'
      : usernameError(normalized)
        ? 'invalid'
        : check?.value === normalized
          ? check.available === null
            ? 'idle'
            : check.available
              ? 'available'
              : 'taken'
          : 'checking';

  const canContinue = !error && status !== 'taken' && status !== 'checking';

  return (
    <OnboardingShell
      step={index}
      title="Pick your username"
      subtitle="This is how friends find you. You can change it later (once every 14 days)."
      onPrimary={() => (unchanged ? advance() : advance({ username: normalized }))}
      primaryDisabled={!canContinue}
      primaryLoading={saving}
    >
      <Input
        label="Username"
        prefix="@"
        value={username}
        onChangeText={(v) => setUsername(v.toLowerCase())}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        maxLength={30}
        error={normalized && !unchanged ? (error ?? (status === 'taken' ? 'That username is already taken.' : undefined)) : undefined}
        helper={unchanged ? 'This is your current username.' : 'Letters, numbers, underscores and periods.'}
        rightElement={
          status === 'checking' ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : status === 'available' ? (
            <Ionicons name="checkmark-circle" size={20} color={palette.success} />
          ) : status === 'taken' || status === 'invalid' ? (
            <Ionicons name="close-circle" size={20} color={palette.danger} />
          ) : null
        }
      />
      <Text variant="small" color="textMuted" style={{ marginTop: spacing.lg }}>
        Your profile link will be friendzy.app/u/{normalized || 'username'}
      </Text>
    </OnboardingShell>
  );
}
