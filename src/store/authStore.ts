import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { supabase } from '@/lib/supabase';
import { unregisterPush } from '@/services/push';
import { disableWebPush } from '@/services/webPush';
import type { ProfileRow, UserPrivateRow, UserSettingsRow } from '@/types/database';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  profile: ProfileRow | null;
  settings: UserSettingsRow | null;
  privateData: UserPrivateRow | null;
  isAdmin: boolean;
  profileLoading: boolean;
  profileError: string | null;
  initialized: boolean;

  initialize: () => Promise<void>;
  loadProfile: (userId: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  setProfile: (profile: ProfileRow | null) => void;
  patchProfile: (patch: Partial<ProfileRow>) => void;
  setSettings: (settings: UserSettingsRow | null) => void;
  patchSettings: (patch: Partial<UserSettingsRow>) => void;
  signOut: (scope?: 'local' | 'global' | 'others') => Promise<void>;
}

let unsubscribe: (() => void) | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  session: null,
  user: null,
  profile: null,
  settings: null,
  privateData: null,
  isAdmin: false,
  profileLoading: false,
  profileError: null,
  initialized: false,

  initialize: async () => {
    if (get().initialized) return;
    set({ initialized: true });

    const applySession = (session: Session | null) => {
      const previousUserId = get().user?.id;
      set({
        session,
        user: session?.user ?? null,
        status: session ? 'signedIn' : 'signedOut',
      });
      if (!session) {
        set({ profile: null, settings: null, privateData: null, isAdmin: false, profileError: null });
      } else if (session.user.id !== previousUserId || !get().profile) {
        // Defer: never await Supabase calls inside the auth state callback.
        setTimeout(() => void get().loadProfile(session.user.id), 0);
      }
    };

    try {
      const { data } = await supabase.auth.getSession();
      applySession(data.session);
    } catch (error) {
      console.warn('[auth] getSession failed', error);
      set({ status: 'signedOut' });
    }

    unsubscribe?.();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return;
      if (event === 'SIGNED_OUT') {
        applySession(null);
        return;
      }
      applySession(session);
    });
    unsubscribe = () => data.subscription.unsubscribe();
  },

  loadProfile: async (userId: string) => {
    set({ profileLoading: true, profileError: null });
    try {
      const [profileRes, settingsRes, privateRes, adminRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
        supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('user_private').select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('admin_roles').select('role').eq('user_id', userId).maybeSingle(),
      ]);
      if (profileRes.error) throw profileRes.error;
      // Only update if this is still the signed-in user (avoids races on fast account switches).
      if (get().user?.id !== userId) return;
      set({
        profile: profileRes.data ?? null,
        settings: settingsRes.data ?? null,
        privateData: privateRes.data ?? null,
        isAdmin: Boolean(adminRes.data),
        profileLoading: false,
      });
    } catch (error) {
      console.warn('[auth] loadProfile failed', error);
      set({ profileLoading: false, profileError: error instanceof Error ? error.message : String(error) });
    }
  },

  refreshProfile: async () => {
    const userId = get().user?.id;
    if (userId) await get().loadProfile(userId);
  },

  setProfile: (profile) => set({ profile }),
  patchProfile: (patch) => {
    const current = get().profile;
    if (current) set({ profile: { ...current, ...patch } });
  },
  setSettings: (settings) => set({ settings }),
  patchSettings: (patch) => {
    const current = get().settings;
    if (current) set({ settings: { ...current, ...patch } });
  },

  signOut: async (scope = 'local') => {
    const userId = get().user?.id;
    // Stop notifications for this account on this device before the session goes away.
    if (userId) {
      await Promise.race([Promise.allSettled([unregisterPush(userId), disableWebPush(userId)]), new Promise((resolve) => setTimeout(resolve, 2500))]);
    }
    try {
      await supabase.auth.signOut({ scope });
    } catch (error) {
      console.warn('[auth] signOut failed', error);
    } finally {
      set({ session: null, user: null, profile: null, settings: null, privateData: null, isAdmin: false, status: 'signedOut' });
    }
  },
}));

/** Convenience selector hook (shallow-compared so renders stay cheap). */
export function useAuth() {
  return useAuthStore(
    useShallow((s) => ({
      status: s.status,
      session: s.session,
      user: s.user,
      profile: s.profile,
      settings: s.settings,
      privateData: s.privateData,
      isAdmin: s.isAdmin,
      profileLoading: s.profileLoading,
      profileError: s.profileError,
    })),
  );
}
