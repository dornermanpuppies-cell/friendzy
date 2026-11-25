import { router } from 'expo-router';
import { useState } from 'react';

import { useToast } from '@/components/ui/Toast';
import { updateMyProfile } from '@/services/profiles';
import { useAuthStore } from '@/store/authStore';
import type { ProfileUpdate } from '@/types/database';
import { getErrorMessage } from '@/utils/errors';

import { ONBOARDING_TOTAL, stepHref, stepIndex, type OnboardingStep } from './steps';

/** Shared save-and-advance logic for onboarding steps. */
export function useOnboardingStep(step: OnboardingStep) {
  const index = stepIndex(step);
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const setProfile = useAuthStore((s) => s.setProfile);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const isLast = index === ONBOARDING_TOTAL - 1;

  const advance = async (patch?: ProfileUpdate, options?: { beforeSave?: () => Promise<void> }) => {
    if (!user) return;
    setSaving(true);
    try {
      await options?.beforeSave?.();
      const updated = await updateMyProfile(user.id, {
        ...patch,
        onboarding_step: Math.max(profile?.onboarding_step ?? 0, index + 1),
        ...(isLast ? { onboarding_completed: true } : {}),
      });
      setProfile(updated);
      router.replace((isLast ? '/home' : stepHref(index + 1)) as never);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return { index, isLast, saving, advance, skip: () => advance(), user, profile };
}
