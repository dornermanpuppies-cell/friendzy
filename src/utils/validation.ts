import { z } from 'zod';

import { isValidCountryCode } from '@/constants/countries';
import { APP } from '@/lib/env';

/** Mirrors public.username_regex() in the database. */
export const USERNAME_REGEX = /^[a-z0-9_](?:[a-z0-9_]|\.(?=[a-z0-9_])){1,28}[a-z0-9_]$/;

export const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'friendzy', 'friendzyapp', 'friendzy_official', 'official', 'support', 'help',
  'root', 'api', 'www', 'mail', 'null', 'undefined', 'me', 'settings', 'login', 'signin', 'signup', 'register',
  'about', 'terms', 'privacy', 'live', 'discover', 'home', 'create', 'inbox', 'notifications', 'explore',
  'search', 'moderator', 'staff', 'team', 'system', 'security', 'billing', 'premium', 'auth', 'onboarding',
  'u', 'user', 'users', 'profile', 'profiles', 'account', 'accounts', 'wallet', 'games', 'legal', 'contact',
  'download', 'features', 'guidelines', 'press', 'careers', 'blog', 'status', 'dev', 'developer', 'developers',
  'test', 'tests', 'store', 'shop', 'app', 'apps', 'messages', 'calls', 'video', 'videos', 'stories', 'story',
]);

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase().replace(/^@/, '');
}

export function usernameError(input: string): string | null {
  const u = normalizeUsername(input);
  if (u.length < 3) return 'Username must be at least 3 characters.';
  if (u.length > 30) return 'Username must be 30 characters or fewer.';
  if (!USERNAME_REGEX.test(u)) {
    return 'Use only lowercase letters, numbers, underscores and periods (no period at the start, end or twice in a row).';
  }
  if (RESERVED_USERNAMES.has(u)) return 'That username is reserved.';
  return null;
}

export function calculateAge(birthDate: Date, today: Date = new Date()): number {
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age -= 1;
  return age;
}

/** Parses an ISO date (YYYY-MM-DD) without timezone shifting. */
export function parseIsoDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function birthDateError(value: string, today: Date = new Date()): string | null {
  const date = parseIsoDate(value);
  if (!date) return 'Enter your date of birth as YYYY-MM-DD.';
  const age = calculateAge(date, today);
  if (age < 0 || age > 120) return 'Please enter a valid date of birth.';
  if (age < APP.minSignupAge) return `You must be at least ${APP.minSignupAge} to join Friendzy.`;
  return null;
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Too short' | 'Weak' | 'Fair' | 'Good' | 'Strong';
}

export function passwordStrength(password: string): PasswordStrength {
  if (password.length < 8) return { score: 0, label: 'Too short' };
  let score = 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password) || password.length >= 14) score += 1;
  const labels: PasswordStrength['label'][] = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
  const clamped = Math.min(score, 4) as PasswordStrength['score'];
  return { score: clamped, label: labels[clamped] };
}

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(72, 'Password must be 72 characters or fewer.')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use at least one letter and one number.');

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address.');

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Display name is required.')
  .max(50, 'Display name must be 50 characters or fewer.');

export const usernameSchema = z
  .string()
  .transform(normalizeUsername)
  .superRefine((v, ctx) => {
    const err = usernameError(v);
    if (err) ctx.addIssue({ code: 'custom', message: err });
  });

export const bioSchema = z.string().trim().max(300, 'Bio must be 300 characters or fewer.');

export const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => isValidCountryCode(v), 'Choose your country.');

export const birthDateSchema = z.string().superRefine((v, ctx) => {
  const err = birthDateError(v);
  if (err) ctx.addIssue({ code: 'custom', message: err });
});

export const GENDER_OPTIONS = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
] as const;

export const genderSchema = z.enum(['woman', 'man', 'non_binary', 'other', 'prefer_not_to_say']).optional();

export const signUpSchema = z.object({
  displayName: displayNameSchema,
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  birthDate: birthDateSchema,
  countryCode: countrySchema,
  gender: genderSchema,
  acceptTerms: z.literal(true, { message: 'Please accept the Terms, Privacy Policy and Community Guidelines.' }),
});

export type SignUpInput = z.input<typeof signUpSchema>;
export type SignUpValues = z.output<typeof signUpSchema>;

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match.' });

export const changePasswordSchema = z
  .object({ current: z.string().min(1, 'Enter your current password.'), password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match.' })
  .refine((v) => v.password !== v.current, { path: ['password'], message: 'Choose a password you have not used before.' });

export const editProfileSchema = z.object({
  displayName: displayNameSchema,
  username: usernameSchema,
  bio: bioSchema,
  countryCode: z.string().trim().toUpperCase().refine((v) => v === '' || isValidCountryCode(v), 'Choose a valid country.'),
  city: z.string().trim().max(80, 'City must be 80 characters or fewer.'),
  website: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === '' || /^https?:\/\/[^\s]+$/i.test(v), 'Website must start with http:// or https://'),
});

/** Flattens zod issues into { field: message }. */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
