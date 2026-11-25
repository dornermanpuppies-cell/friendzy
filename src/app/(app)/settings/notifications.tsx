import { View } from 'react-native';

import { EmptyState } from '@/components/ui/EmptyState';
import { ListItem, ListSection } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';
import { spacing } from '@/theme/tokens';
import type { NotificationPreferencesRow } from '@/types/database';
import { getErrorMessage } from '@/utils/errors';

type PrefKey = Exclude<keyof NotificationPreferencesRow, 'user_id' | 'created_at' | 'updated_at'>;

const GROUPS: { title: string; items: { key: PrefKey; label: string; subtitle?: string }[] }[] = [
  {
    title: 'Channels',
    items: [
      { key: 'push_enabled', label: 'Push notifications', subtitle: 'Delivered through Expo Push once the mobile apps are built' },
      { key: 'email_enabled', label: 'Email notifications', subtitle: 'Important account activity' },
    ],
  },
  {
    title: 'Social',
    items: [
      { key: 'new_followers', label: 'New followers' },
      { key: 'friend_requests', label: 'Friend requests', subtitle: 'New requests and accepted requests' },
      { key: 'matches', label: 'Meet Someone matches', subtitle: 'When someone is matched with you live' },
      { key: 'likes', label: 'Likes' },
      { key: 'comments', label: 'Comments & replies' },
      { key: 'mentions', label: 'Mentions' },
      { key: 'reposts', label: 'Reposts' },
    ],
  },
  {
    title: 'Communication',
    items: [
      { key: 'messages', label: 'New messages' },
      { key: 'calls', label: 'Incoming & missed calls' },
      { key: 'live', label: 'Live broadcasts', subtitle: 'When people you follow go live or schedule a live' },
      { key: 'gifts', label: 'Gifts' },
    ],
  },
  {
    title: 'Account',
    items: [
      { key: 'subscription', label: 'Subscription updates' },
      { key: 'security', label: 'Security alerts', subtitle: 'New sign-ins and password changes (recommended)' },
    ],
  },
];

export default function NotificationSettingsScreen() {
  const { user } = useAuth();
  const toast = useToast();
  const prefs = useAsync<NotificationPreferencesRow | null>(async () => {
    if (!user) return null;
    const { data, error } = await supabase.from('notification_preferences').select('*').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return data;
  }, [user?.id]);

  const toggle = async (key: PrefKey, value: boolean) => {
    if (!user || !prefs.data) return;
    const previous = prefs.data[key];
    prefs.setData((p) => (p ? { ...p, [key]: value } : p));
    const { error } = await supabase
      .from('notification_preferences')
      .update({ [key]: value } as Partial<Omit<NotificationPreferencesRow, 'user_id' | 'created_at' | 'updated_at'>>)
      .eq('user_id', user.id);
    if (error) {
      prefs.setData((p) => (p ? { ...p, [key]: previous } : p));
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <Screen header={<ScreenHeader title="Notifications" fallbackHref="/settings" />} scroll>
      <Text variant="body" color="textMuted" style={{ marginVertical: spacing.lg }}>
        Choose what you want to hear about. In-app notifications are always available in your notification centre.
      </Text>
      {prefs.error ? (
        <EmptyState compact icon="cloud-offline-outline" title="Couldn't load preferences" description={prefs.error} action={{ title: 'Retry', onPress: prefs.reload, variant: 'secondary' }} />
      ) : prefs.data ? (
        GROUPS.map((group) => (
          <ListSection key={group.title} title={group.title}>
            {group.items.map((item) => (
              <ListItem key={item.key} title={item.label} subtitle={item.subtitle} switchValue={prefs.data![item.key] as boolean} onSwitchChange={(v) => void toggle(item.key, v)} disabled={item.key !== 'push_enabled' && item.key !== 'email_enabled' && !prefs.data!.push_enabled && !prefs.data!.email_enabled} />
            ))}
          </ListSection>
        ))
      ) : (
        <View />
      )}
    </Screen>
  );
}
