import { Platform } from 'react-native';

import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import type { SessionInfo } from '@/types/database';
import { AppError } from '@/utils/errors';

/** Where auth emails should send the user back to, per platform. */
export function authRedirectUrl(path: '/auth/callback' | '/auth/confirm' = '/auth/callback'): string {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.location?.origin) return `${window.location.origin}${path}`;
    return `${env.siteUrl}${path}`;
  }
  // Native: the website confirm page completes the token exchange and deep-links back.
  return `${env.siteUrl}${path}`;
}

export interface SignUpParams {
  email: string;
  password: string;
  displayName: string;
  username: string;
  birthDate: string;
  countryCode: string;
  gender?: string;
}

export async function signUpWithEmail(params: SignUpParams) {
  const { data, error } = await supabase.auth.signUp({
    email: params.email,
    password: params.password,
    options: {
      emailRedirectTo: authRedirectUrl('/auth/callback'),
      data: {
        display_name: params.displayName,
        username: params.username,
        birth_date: params.birthDate,
        country_code: params.countryCode,
        gender: params.gender ?? null,
        accepted_terms: 'true',
      },
    },
  });
  if (error) throw error;
  // When email confirmation is enabled, Supabase returns a user without a session.
  // If identities is empty the email already exists (Supabase hides this for privacy).
  const identities = data.user?.identities ?? [];
  if (data.user && identities.length === 0) {
    throw new AppError('An account with this email already exists. Try signing in instead.', 'user_already_exists');
  }
  return { user: data.user, session: data.session, needsEmailConfirmation: !data.session };
}

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function resendVerificationEmail(email: string) {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: authRedirectUrl('/auth/callback') },
  });
  if (error) throw error;
}

export async function requestPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: authRedirectUrl('/auth/callback') + '?next=/auth/reset-password',
  });
  if (error) throw error;
}

export async function updatePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

/** Re-authenticates with the current password before changing it. */
export async function changePassword(email: string, currentPassword: string, newPassword: string) {
  const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
  if (verifyError) throw new AppError('Your current password is incorrect.', 'invalid_credentials');
  await updatePassword(newPassword);
}

export async function requestEmailChange(newEmail: string) {
  const { error } = await supabase.auth.updateUser(
    { email: newEmail },
    { emailRedirectTo: authRedirectUrl('/auth/callback') + '?next=/settings/account' },
  );
  if (error) throw error;
}

export async function exchangeCodeForSession(code: string) {
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
  return data.session;
}

export async function setSessionFromTokens(accessToken: string, refreshToken: string) {
  const { data, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error) throw error;
  return data.session;
}

export async function verifyTokenHash(tokenHash: string, type: string) {
  const allowed = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'] as const;
  type Allowed = (typeof allowed)[number];
  const safeType: Allowed = (allowed as readonly string[]).includes(type) ? (type as Allowed) : 'email';
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: safeType });
  if (error) throw error;
  return data.session;
}

export async function listMySessions(): Promise<SessionInfo[]> {
  const { data, error } = await supabase.rpc('get_my_sessions');
  if (error) throw error;
  return (data ?? []) as SessionInfo[];
}

export async function revokeSession(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_my_session', { p_session_id: sessionId });
  if (error) throw error;
}

export async function revokeOtherSessions(): Promise<void> {
  const { error } = await supabase.rpc('revoke_other_sessions');
  if (error) throw error;
  await supabase.auth.signOut({ scope: 'others' }).catch(() => undefined);
}

/** Permanently deletes the account (cascades through all user data). */
export async function deleteMyAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_my_account');
  if (error) throw error;
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
}
