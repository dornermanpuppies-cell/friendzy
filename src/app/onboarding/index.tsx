import { Redirect } from 'expo-router';

import { stepHref } from '@/features/onboarding/steps';
import { useAuthStore } from '@/store/authStore';

export default function OnboardingIndex() {
  const step = useAuthStore((s) => s.profile?.onboarding_step ?? 0);
  return <Redirect href={stepHref(step) as never} />;
}
