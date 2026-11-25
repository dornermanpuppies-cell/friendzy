/**
 * Public runtime configuration.
 *
 * Only EXPO_PUBLIC_* variables are available here — they are inlined into the
 * client bundle by Expo CLI and must never contain secrets. Server-side secrets
 * (LiveKit API secret, Resend key, RevenueCat secret keys, payment secrets) live
 * exclusively in Supabase Edge Function secrets. See docs/CONFIGURATION.md.
 */

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const siteUrl = (process.env.EXPO_PUBLIC_SITE_URL ?? 'http://localhost:8081').replace(/\/$/, '');
const liveKitUrl = process.env.EXPO_PUBLIC_LIVEKIT_URL ?? '';
const revenueCatIosKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
const revenueCatAndroidKey = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '';
const revenueCatTestKey = process.env.EXPO_PUBLIC_REVENUECAT_TEST_KEY ?? '';
const tenorApiKey = process.env.EXPO_PUBLIC_TENOR_API_KEY ?? '';
// Download page: store / direct-download links appear only when these exist (no decorative buttons).
const appStoreUrl = process.env.EXPO_PUBLIC_APP_STORE_URL ?? '';
const playStoreUrl = process.env.EXPO_PUBLIC_PLAY_STORE_URL ?? '';
const androidApkUrl = process.env.EXPO_PUBLIC_ANDROID_APK_URL ?? '';

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
} as const;

/** Which integrations currently have the public configuration they need. */
export const integrations = {
  supabase: Boolean(supabaseUrl && supabaseAnonKey),
  liveKit: Boolean(liveKitUrl),
  revenueCat: Boolean(revenueCatIosKey || revenueCatAndroidKey || revenueCatTestKey),
  appStore: Boolean(appStoreUrl),
  playStore: Boolean(playStoreUrl),
  androidApk: Boolean(androidApkUrl),
} as const;

export const APP = {
  name: 'Friendzy',
  tagline: 'Meet. Connect. Play. Earn.',
  scheme: 'friendzy',
  supportEmail: 'support@friendzy.app',
  minSignupAge: 16,
  adultAge: 18,
} as const;
