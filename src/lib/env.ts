/**
 * Public runtime configuration.
 *
 * Only EXPO_PUBLIC_* variables are available here — they are inlined into the
 * client bundle by Expo CLI and must never contain secrets. Server-side secrets
 * (LiveKit API secret, Resend key, RevenueCat secret keys, payment secrets) live
 * exclusively in Supabase Edge Function secrets. See docs/CONFIGURATION.md.
 */
import { normalizePublicUrl, stripWrappingQuotes } from '@/lib/publicConfig';

// Pasted values are read forgivingly (wrapping quotes, missing https:// or wss://, trailing slash).
const supabaseUrl = normalizePublicUrl(process.env.EXPO_PUBLIC_SUPABASE_URL, 'https');
const supabaseAnonKey = stripWrappingQuotes(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
const siteUrl = normalizePublicUrl(process.env.EXPO_PUBLIC_SITE_URL, 'https') || 'http://localhost:8081';
const liveKitUrl = normalizePublicUrl(process.env.EXPO_PUBLIC_LIVEKIT_URL, 'wss');
const revenueCatIosKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
const revenueCatAndroidKey = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '';
const revenueCatTestKey = process.env.EXPO_PUBLIC_REVENUECAT_TEST_KEY ?? '';
const tenorApiKey = process.env.EXPO_PUBLIC_TENOR_API_KEY ?? '';
// Download page: store / direct-download links appear only when these exist (no decorative buttons).
const appStoreUrl = process.env.EXPO_PUBLIC_APP_STORE_URL ?? '';
const playStoreUrl = process.env.EXPO_PUBLIC_PLAY_STORE_URL ?? '';
const androidApkUrl = process.env.EXPO_PUBLIC_ANDROID_APK_URL ?? '';
// "owner/repository" on GitHub — the Download page looks up the latest Android APK release there
// (set automatically on Netlify from the connected repository and by the Android workflow).
const githubRepo = (process.env.EXPO_PUBLIC_GITHUB_REPO ?? '').trim();

export const env = {
  supabaseUrl,
  supabaseAnonKey,
  siteUrl,
  liveKitUrl,
  revenueCatIosKey,
  revenueCatAndroidKey,
  revenueCatTestKey,
  tenorApiKey,
  appStoreUrl,
  playStoreUrl,
  androidApkUrl,
  githubRepo,
} as const;

/** Which integrations currently have the public configuration they need. */
export const integrations = {
  supabase: Boolean(supabaseUrl && supabaseAnonKey),
  liveKit: Boolean(liveKitUrl),
  revenueCat: Boolean(revenueCatIosKey || revenueCatAndroidKey || revenueCatTestKey),
  appStore: Boolean(appStoreUrl),
  playStore: Boolean(playStoreUrl),
  androidApk: Boolean(androidApkUrl),
  githubReleases: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepo),
} as const;

export const APP = {
  name: 'Friendzy',
  tagline: 'Meet. Connect. Play. Earn.',
  scheme: 'friendzy',
  supportEmail: 'support@friendzy.app',
  minSignupAge: 16,
  adultAge: 18,
} as const;
