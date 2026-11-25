import { createClient, processLock } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { env, integrations } from '@/lib/env';
import { largeSecureStore } from '@/lib/secureStorage';
import type { Database } from '@/types/database';

const isWeb = Platform.OS === 'web';

/**
 * Single Supabase client shared by the website, Android and iOS.
 *
 * - Web: sessions persist in localStorage (memory during static rendering).
 * - Native: sessions are encrypted at rest (see lib/secureStorage.ts).
 * - Auth callbacks (email verification, password recovery) are handled
 *   explicitly by the /auth/callback and /auth/confirm routes, so automatic
 *   URL detection is disabled to avoid double processing.
 */
export const supabase = createClient<Database>(
  env.supabaseUrl || 'https://not-configured.supabase.co',
  env.supabaseAnonKey || 'not-configured',
  {
    auth: {
      storage: isWeb ? undefined : largeSecureStore,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
      lock: isWeb ? undefined : processLock,
    },
    global: {
      headers: { 'x-friendzy-platform': Platform.OS },
    },
  },
);

export const isSupabaseConfigured = integrations.supabase;

// Keep tokens fresh only while the app is in the foreground on native.
if (!isWeb) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}

/** Public URL for an object in a public storage bucket. */
export function publicStorageUrl(bucket: string, path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
