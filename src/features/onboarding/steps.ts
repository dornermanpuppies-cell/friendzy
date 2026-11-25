export const ONBOARDING_STEPS = ['photo', 'username', 'bio', 'interests', 'country', 'preferences', 'suggested'] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_TOTAL = ONBOARDING_STEPS.length;

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

export function stepHref(index: number): string {
  const step = ONBOARDING_STEPS[Math.max(0, Math.min(index, ONBOARDING_TOTAL - 1))];
  return `/onboarding/${step}`;
}

/** Steps a user may skip; username and country are required for a complete profile. */
export const OPTIONAL_STEPS: ReadonlySet<OnboardingStep> = new Set(['photo', 'bio', 'interests', 'preferences', 'suggested']);
