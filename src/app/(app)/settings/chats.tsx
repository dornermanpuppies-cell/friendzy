import { router } from 'expo-router';
import { View } from 'react-native';

import { ListItem, ListSection } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { updateMySettings } from '@/services/profiles';
import { useAuth, useAuthStore } from '@/store/authStore';
import { spacing } from '@/theme/tokens';
import type { AudienceType } from '@/types/database';
import { getErrorMessage } from '@/utils/errors';

const AUDIENCE_LABELS: Record<AudienceType, string> = { everyone: 'Everyone', followers: 'Followers', friends: 'Friends', nobody: 'Nobody' };

export default function ChatSettingsScreen() {
  const { user, settings } = useAuth();
  const patchSettings = useAuthStore((s) => s.patchSettings);
  const toast = useToast();

  const toggleReadReceipts = async (value: boolean) => {
    if (!user) return;
    patchSettings({ read_receipts: value });
    try {
      await updateMySettings(user.id, { read_receipts: value });
    } catch (error) {
      patchSettings({ read_receipts: !value });
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <Screen header={<ScreenHeader title="Chats" fallbackHref="/settings" />} scroll>
      <View style={{ height: spacing.lg }} />
      <ListSection title="Privacy">
        <ListItem icon="chatbubble-ellipses-outline" title="Who can message me" value={AUDIENCE_LABELS[settings?.who_can_message ?? 'everyone']} subtitle="People outside this setting land in Requests" onPress={() => router.navigate('/settings/privacy')} />
        <ListItem icon="checkmark-done-outline" title="Read receipts" subtitle="Turning this off also hides other people's read receipts from you" switchValue={settings?.read_receipts ?? true} onSwitchChange={(v) => void toggleReadReceipts(v)} />
        <ListItem icon="ellipse-outline" title="Show online status" value={settings?.show_online_status ? 'On' : 'Off'} onPress={() => router.navigate('/settings/privacy')} />
      </ListSection>
      <ListSection title="Messages">
        <ListItem icon="star-outline" title="Starred messages" onPress={() => router.navigate('/chat/starred' as never)} />
        <ListItem icon="archive-outline" title="Archived chats" onPress={() => router.navigate('/inbox')} />
        <ListItem icon="timer-outline" title="Disappearing messages" subtitle="Set per conversation from its info screen" showChevron={false} />
        <ListItem icon="color-palette-outline" title="Wallpapers" subtitle="Choose a wallpaper per chat from its info screen" showChevron={false} />
      </ListSection>
      <ListSection title="Security">
        <ListItem icon="lock-closed-outline" title="End-to-end encryption" subtitle="Your security code, the devices that can read your chats, and what encryption does and does not cover" onPress={() => router.navigate('/settings/encryption' as never)} />
      </ListSection>
      <Text variant="caption" color="textMuted" style={{ marginTop: spacing.md }}>
        Blocked people can never message you regardless of these settings.
      </Text>
    </Screen>
  );
}
