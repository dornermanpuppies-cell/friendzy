import { router } from 'expo-router';
import { Alert, Platform, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { ListItem, ListSection } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { countryName, flagEmoji } from '@/constants/countries';
import { useAsync } from '@/hooks/useAsync';
import { getPremiumStatus } from '@/services/premium';
import { useAuth, useAuthStore } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { formatDate } from '@/utils/format';

export default function SettingsScreen() {
  const { profile, user, isAdmin } = useAuth();
  const signOut = useAuthStore((s) => s.signOut);
  const { preference } = useTheme();
  const premium = useAsync(() => getPremiumStatus(), []);

  const confirmSignOut = () => {
    const run = () => void signOut();
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Sign out of Friendzy on this device?')) run();
      return;
    }
    Alert.alert('Sign out', 'Sign out of Friendzy on this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: run },
    ]);
  };

  return (
    <Screen header={<ScreenHeader title="Settings" fallbackHref="/profile" />} scroll>
      <View style={{ paddingVertical: spacing.lg }}>
        <ListItem
          left={<Avatar uri={profile?.avatar_url} name={profile?.display_name} size={48} verified={profile?.is_verified} />}
          title={profile?.display_name ?? ''}
          subtitle={`@${profile?.username ?? ''}${profile?.country_code ? ` · ${flagEmoji(profile.country_code)} ${countryName(profile.country_code)}` : ''}`}
          onPress={() => router.navigate('/profile/edit')}
          style={{ paddingHorizontal: 0 }}
        />
      </View>

      <ListSection title="Friendzy">
        <ListItem icon="diamond-outline" title="Friendzy Premium" subtitle={premium.data?.is_premium ? `Active${premium.data.expires_at ? ` until ${formatDate(premium.data.expires_at, 'd MMM yyyy')}` : ''}` : 'Exclusive gifts, who viewed you, advanced search, themes'} onPress={() => router.navigate('/premium' as never)} />
        <ListItem icon="wallet-outline" title="Wallet & earnings" subtitle="Coins, gifts, creator payouts" onPress={() => router.navigate('/wallet' as never)} />
        <ListItem icon="videocam-outline" title="Creator Studio" subtitle="Video analytics, drafts, playlists, challenges" onPress={() => router.navigate('/studio' as never)} />
        <ListItem icon="game-controller-outline" title="Games" subtitle="Ludo, Chess, Trivia and more with friends" onPress={() => router.navigate('/games' as never)} />
        <ListItem icon="checkmark-circle-outline" title="Verification" subtitle={profile?.is_verified ? 'Your account is verified' : 'Request the verified badge'} onPress={() => router.navigate('/settings/verification' as never)} />
      </ListSection>

      <ListSection title="Account">
        <ListItem icon="person-circle-outline" title="Account" subtitle={user?.email ?? undefined} onPress={() => router.navigate('/settings/account')} />
        <ListItem icon="key-outline" title="Password & security" subtitle="Change password, active sessions" onPress={() => router.navigate('/settings/security')} />
        <ListItem icon="phone-portrait-outline" title="Active sessions" subtitle="See where you're signed in" onPress={() => router.navigate('/settings/sessions')} />
      </ListSection>

      <ListSection title="Privacy & safety">
        <ListItem icon="lock-closed-outline" title="Privacy" subtitle="Private account, online status, discovery, who can contact you" onPress={() => router.navigate('/settings/privacy')} />
        <ListItem icon="ban-outline" title="Blocked accounts" onPress={() => router.navigate('/settings/blocked')} />
        <ListItem icon="shield-checkmark-outline" title="Community Guidelines" onPress={() => router.navigate('/guidelines')} />
      </ListSection>

      <ListSection title="Preferences">
        <ListItem icon="color-palette-outline" title="Appearance" value={preference === 'system' ? 'System' : preference === 'dark' ? 'Dark' : 'Light'} onPress={() => router.navigate('/settings/appearance')} />
        <ListItem icon="notifications-outline" title="Notifications" subtitle="Push and in-app notification preferences" onPress={() => router.navigate('/settings/notifications')} />
        <ListItem icon="chatbubbles-outline" title="Chats" subtitle="Read receipts, requests, starred messages" onPress={() => router.navigate('/settings/chats' as never)} />
      </ListSection>

      <ListSection title="Support">
        <ListItem icon="help-circle-outline" title="Help & support" onPress={() => router.navigate('/help')} />
        <ListItem icon="document-text-outline" title="Terms of Service" onPress={() => router.navigate('/terms')} />
        <ListItem icon="shield-outline" title="Privacy Policy" onPress={() => router.navigate('/privacy')} />
        {isAdmin ? <ListItem icon="construct-outline" title="Administration" subtitle="Dashboard, moderation, finance, settings" onPress={() => router.navigate('/admin' as never)} /> : null}
      </ListSection>

      <ListSection>
        <ListItem icon="log-out-outline" title="Sign out" onPress={confirmSignOut} showChevron={false} />
        <ListItem icon="trash-outline" title="Delete account" danger onPress={() => router.navigate('/settings/delete-account')} />
      </ListSection>

      <Text variant="caption" color="textMuted" align="center" style={{ marginBottom: spacing['2xl'] }}>
        Friendzy v0.1.0
      </Text>
    </Screen>
  );
}
