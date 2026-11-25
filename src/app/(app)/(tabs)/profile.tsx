import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { Screen } from '@/components/ui/Screen';
import { LiveHistoryTab, ReelsTab } from '@/features/profile/ProfileMediaTabs';
import { ProfileView } from '@/features/profile/ProfileView';
import { useAsync } from '@/hooks/useAsync';
import { getUserInterests } from '@/services/interests';
import { getUserLanguages } from '@/services/languages';
import { useAuth, useAuthStore } from '@/store/authStore';

/** The signed-in user's own profile tab. */
export default function MyProfileScreen() {
  const { profile, user } = useAuth();
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const interests = useAsync(() => (user ? getUserInterests(user.id) : Promise.resolve([])), [user?.id]);
  const languages = useAsync(() => (user ? getUserLanguages(user.id) : Promise.resolve([])), [user?.id]);

  // Refresh counters, interests and languages whenever the tab regains focus.
  useFocusEffect(
    useCallback(() => {
      void refreshProfile();
      void interests.refresh();
      void languages.refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshProfile]),
  );

  if (!profile) return <Screen />;

  return (
    <Screen scroll padded={false} maxWidth={false} edges={['left', 'right']} refreshing={interests.refreshing} onRefresh={() => Promise.all([refreshProfile(), interests.refresh(), languages.refresh()])}>
      <ProfileView
        profile={profile}
        isOwner
        interests={interests.data ?? []}
        languages={languages.data ?? []}
        renderTab={(tab) => (tab === 'reels' ? <ReelsTab userId={profile.id} isOwner /> : tab === 'live' ? <LiveHistoryTab userId={profile.id} isOwner /> : null)}
      />
    </Screen>
  );
}
