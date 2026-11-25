import { useState } from 'react';
import { View } from 'react-native';

import { Chip } from '@/components/ui/Chip';
import { ListItem, ListSection } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { updateMyProfile, updateMySettings } from '@/services/profiles';
import { useAuth, useAuthStore } from '@/store/authStore';
import { spacing } from '@/theme/tokens';
import type { AudienceType, UserSettingsRow } from '@/types/database';
import { getErrorMessage } from '@/utils/errors';

type AudienceKey = 'who_can_message' | 'who_can_comment' | 'who_can_see_friends' | 'story_audience';

const AUDIENCE_LABELS: Record<AudienceType, string> = { everyone: 'Everyone', followers: 'Followers', friends: 'Friends', nobody: 'Nobody' };
const AUDIENCE_OPTIONS: AudienceType[] = ['everyone', 'followers', 'friends', 'nobody'];

export default function PrivacySettingsScreen() {
  const { user, profile, settings } = useAuth();
  const patchSettings = useAuthStore((s) => s.patchSettings);
  const patchProfile = useAuthStore((s) => s.patchProfile);
  const toast = useToast();
  const [editing, setEditing] = useState<{ key: AudienceKey; title: string } | null>(null);

  const saveSetting = async <K extends keyof Omit<UserSettingsRow, 'user_id' | 'created_at' | 'updated_at'>>(key: K, value: UserSettingsRow[K]) => {
    if (!user || !settings) return;
    const previous = settings[key];
    patchSettings({ [key]: value } as Partial<UserSettingsRow>);
    try {
      await updateMySettings(user.id, { [key]: value } as Partial<UserSettingsRow>);
    } catch (error) {
      patchSettings({ [key]: previous } as Partial<UserSettingsRow>);
      toast.error(getErrorMessage(error));
    }
  };

  const saveProfileFlag = async (key: 'is_private' | 'discoverable', value: boolean) => {
    if (!user || !profile) return;
    const previous = profile[key];
    patchProfile({ [key]: value });
    try {
      await updateMyProfile(user.id, { [key]: value });
    } catch (error) {
      patchProfile({ [key]: previous });
      toast.error(getErrorMessage(error));
    }
  };

  if (!settings || !profile) return <Screen header={<ScreenHeader title="Privacy" fallbackHref="/settings" />} />;

  return (
    <Screen header={<ScreenHeader title="Privacy" fallbackHref="/settings" />} scroll>
      <View style={{ height: spacing.lg }} />
      <ListSection title="Account">
        <ListItem icon="lock-closed-outline" title="Private account" subtitle="New followers must be approved. Your posts are visible only to followers." switchValue={profile.is_private} onSwitchChange={(v) => void saveProfileFlag('is_private', v)} />
        <ListItem icon="compass-outline" title="Discoverable" subtitle="Appear in search, suggestions and new members" switchValue={profile.discoverable} onSwitchChange={(v) => void saveProfileFlag('discoverable', v)} />
      </ListSection>

      <ListSection title="Activity status">
        <ListItem icon="ellipse-outline" title="Show online status" subtitle="Others can see when you're active" switchValue={settings.show_online_status} onSwitchChange={(v) => void saveSetting('show_online_status', v)} />
        <ListItem icon="time-outline" title="Show last seen" subtitle="Others can see when you were last active" switchValue={settings.show_last_seen} onSwitchChange={(v) => void saveSetting('show_last_seen', v)} />
        <ListItem icon="checkmark-done-outline" title="Read receipts" subtitle="Applies to messages (coming in the messaging phase)" switchValue={settings.read_receipts} onSwitchChange={(v) => void saveSetting('read_receipts', v)} />
      </ListSection>

      <ListSection title="Who can…">
        <ListItem icon="chatbubble-ellipses-outline" title="Message me" value={AUDIENCE_LABELS[settings.who_can_message]} onPress={() => setEditing({ key: 'who_can_message', title: 'Who can message you' })} />
        <ListItem icon="chatbox-ellipses-outline" title="Comment on my posts" value={AUDIENCE_LABELS[settings.who_can_comment]} onPress={() => setEditing({ key: 'who_can_comment', title: 'Who can comment' })} />
        <ListItem icon="people-outline" title="See my friends list" value={AUDIENCE_LABELS[settings.who_can_see_friends]} onPress={() => setEditing({ key: 'who_can_see_friends', title: 'Who can see your friends' })} />
        <ListItem icon="aperture-outline" title="See my stories" value={AUDIENCE_LABELS[settings.story_audience]} onPress={() => setEditing({ key: 'story_audience', title: 'Story audience' })} />
      </ListSection>

      <ListSection title="Discovery & location">
        <ListItem icon="shuffle-outline" title="Random matching" subtitle="Let Friendzy match you with people who share your interests" switchValue={settings.random_match_enabled} onSwitchChange={(v) => void saveSetting('random_match_enabled', v)} />
        <ListItem icon="location-outline" title="Nearby discovery" subtitle="Uses an approximate location only. Your exact location is never shared." switchValue={settings.nearby_enabled} onSwitchChange={(v) => void saveSetting('nearby_enabled', v)} />
        <ListItem icon="flag-outline" title="Show my country on my profile" switchValue={settings.show_country} onSwitchChange={(v) => void saveSetting('show_country', v)} />
      </ListSection>

      <Sheet visible={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.title}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingBottom: spacing.xl }}>
          {AUDIENCE_OPTIONS.map((option) => (
            <Chip
              key={option}
              label={AUDIENCE_LABELS[option]}
              selected={editing ? settings[editing.key] === option : false}
              onPress={() => {
                if (editing) void saveSetting(editing.key, option);
                setEditing(null);
              }}
            />
          ))}
        </View>
        <Text variant="small" color="textMuted" style={{ paddingBottom: spacing.lg }}>
          People you block can never contact you regardless of this setting.
        </Text>
      </Sheet>
    </Screen>
  );
}
