import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ListItem, ListSection } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { WallpaperSheet } from '@/features/chat/WallpaperSheet';
import { updateMySettings } from '@/services/profiles';
import { isImageWallpaper } from '@/services/wallpapers';
import { WALLPAPERS } from '@/features/chat/wallpapers';
import { useAuth, useAuthStore } from '@/store/authStore';
import { spacing } from '@/theme/tokens';
import type { AudienceType } from '@/types/database';
import { getErrorMessage } from '@/utils/errors';

const AUDIENCE_LABELS: Record<AudienceType, string> = { everyone: 'Everyone', followers: 'Followers', friends: 'Friends', nobody: 'Nobody' };

export default function ChatSettingsScreen() {
  const { user, settings } = useAuth();
  const patchSettings = useAuthStore((s) => s.patchSettings);
  const toast = useToast();
  const [wallpaperOpen, setWallpaperOpen] = useState(false);

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

  const keepArchived = settings?.keep_chats_archived ?? true;
  const toggleKeepArchived = async (value: boolean) => {
    if (!user) return;
    patchSettings({ keep_chats_archived: value });
    try {
      await updateMySettings(user.id, { keep_chats_archived: value });
    } catch (error) {
      patchSettings({ keep_chats_archived: !value });
      toast.error(getErrorMessage(error));
    }
  };

  const setDefaultWallpaper = async (value: string | null) => {
    if (!user) return;
    const previous = settings?.chat_wallpaper ?? null;
    patchSettings({ chat_wallpaper: value });
    try {
      await updateMySettings(user.id, { chat_wallpaper: value });
    } catch (error) {
      patchSettings({ chat_wallpaper: previous });
      throw error;
    }
  };

  const wallpaperLabel = isImageWallpaper(settings?.chat_wallpaper)
    ? 'Your photo'
    : (WALLPAPERS.find((w) => w.id === settings?.chat_wallpaper)?.label ?? 'Night');

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
        <ListItem icon="archive-outline" title="Archived chats" onPress={() => router.navigate('/chat/archived' as never)} />
        <ListItem icon="file-tray-full-outline" title="Keep chats archived" subtitle="Archived chats stay archived and silent when new messages arrive" switchValue={keepArchived} onSwitchChange={(v) => void toggleKeepArchived(v)} />
        <ListItem icon="timer-outline" title="Disappearing messages" subtitle="Set per conversation from its info screen" showChevron={false} />
        <ListItem icon="color-palette-outline" title="Default wallpaper" value={wallpaperLabel} subtitle="Used by every chat without one of its own" onPress={() => setWallpaperOpen(true)} />
      </ListSection>
      <ListSection title="Security">
        <ListItem icon="lock-closed-outline" title="End-to-end encryption" subtitle="Your security code, the devices that can read your chats, and what encryption does and does not cover" onPress={() => router.navigate('/settings/encryption' as never)} />
      </ListSection>
      <Text variant="caption" color="textMuted" style={{ marginTop: spacing.md }}>
        Blocked people can never message you regardless of these settings.
      </Text>
      <WallpaperSheet
        visible={wallpaperOpen}
        onClose={() => setWallpaperOpen(false)}
        value={settings?.chat_wallpaper ?? null}
        userId={user?.id ?? ''}
        title="Default wallpaper"
        clearLabel="Use the standard background"
        onSelect={setDefaultWallpaper}
      />
    </Screen>
  );
}
