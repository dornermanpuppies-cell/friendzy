import { router } from 'expo-router';
import { type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { VerifiedBadge } from '@/components/ui/Badge';
import { Text } from '@/components/ui/Text';
import { flagEmoji } from '@/constants/countries';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import type { ProfileCard } from '@/types/database';

export interface ProfileRowProps {
  profile: ProfileCard;
  right?: ReactNode;
  subtitle?: string;
  showBio?: boolean;
  online?: boolean | null;
  onPress?: () => void;
}

export function ProfileRow({ profile, right, subtitle, showBio = true, online, onPress }: ProfileRowProps) {
  const { colors } = useTheme();
  const open = onPress ?? (() => router.navigate(`/u/${profile.username}` as never));
  const meta = subtitle ?? `@${profile.username}${profile.country_code ? `  ${flagEmoji(profile.country_code)}` : ''}`;

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`Open ${profile.display_name}'s profile`}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.row, (pressed || hovered) && { backgroundColor: colors.surfaceMuted }]}
    >
      <Avatar uri={profile.avatar_url} name={profile.display_name} size={48} online={online} />
      <View style={styles.texts}>
        <View style={styles.nameRow}>
          <Text variant="bodySemibold" numberOfLines={1} style={styles.name}>
            {profile.display_name}
          </Text>
          {profile.is_verified ? <VerifiedBadge size={14} style={{ marginLeft: 4 }} /> : null}
        </View>
        <Text variant="small" color="textMuted" numberOfLines={1}>
          {meta}
        </Text>
        {showBio && profile.bio ? (
          <Text variant="small" color="textSecondary" numberOfLines={1} style={{ marginTop: 2 }}>
            {profile.bio}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: 14,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : null),
  },
  texts: { flex: 1, marginLeft: spacing.md },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { flexShrink: 1 },
  right: { marginLeft: spacing.md },
});
