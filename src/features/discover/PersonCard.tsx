import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Pill, VerifiedBadge } from '@/components/ui/Badge';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { languageNames } from '@/constants/languages';
import { FollowButton } from '@/features/profile/FollowButton';
import { startDirectConversation } from '@/services/messaging';
import type { FollowState } from '@/services/relationships';
import { useAuth } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { DiscoverCard } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';

import { FriendButton, type FriendState } from './FriendButton';
import { personMeta, pluralize, presenceLabel } from './presence';

export interface PersonCardProps {
  person: DiscoverCard;
  /** `row` = full card for lists; `tile` = compact card for horizontal rails. */
  variant?: 'row' | 'tile';
  /** Extra line under the meta (e.g. "~3 km away"). */
  note?: string;
  showActions?: boolean;
  onRelationshipChange?: (id: string, next: FriendState) => void;
}

function followStateOf(person: DiscoverCard): FollowState {
  return person.relationship.is_following ? 'following' : person.relationship.follow_requested ? 'requested' : 'none';
}

/** Opens (or reuses) a direct conversation. Nothing else — never starts a call. */
export function useMessageAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const open = async (person: Pick<DiscoverCard, 'id'>) => {
    if (busy) return;
    setBusy(person.id);
    try {
      const conversationId = await startDirectConversation(person.id);
      router.navigate(`/chat/${conversationId}` as never);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };
  return { open, busy };
}

export function PersonCard({ person, variant = 'row', note, showActions = true, onRelationshipChange }: PersonCardProps) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const message = useMessageAction();
  const isSelf = user?.id === person.id;
  const presence = presenceLabel(person.presence);
  const openProfile = () => router.navigate(`/u/${person.username}` as never);
  const friendState: FriendState = { is_friend: person.relationship.is_friend, friend_request: person.relationship.friend_request };

  if (variant === 'tile') {
    const signal = person.shared_interests > 0 ? pluralize(person.shared_interests, 'shared interest') : person.mutual_friends > 0 ? pluralize(person.mutual_friends, 'mutual friend') : presence?.text ?? (note ?? '');
    return (
      <Pressable onPress={openProfile} accessibilityRole="button" accessibilityLabel={`Open ${person.display_name}'s profile`} style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }, (pressed || hovered) && { borderColor: colors.borderStrong }]}>
        <Avatar uri={person.avatar_url} name={person.display_name} size={64} online={person.presence.is_online} verified={person.is_verified} />
        <Text variant="smallMedium" numberOfLines={1} align="center" style={{ marginTop: spacing.sm }}>
          {person.display_name}
        </Text>
        <Text variant="caption" color="textMuted" numberOfLines={1} align="center">
          {personMeta(person, { username: false }) || `@${person.username}`}
        </Text>
        <Text variant="caption" color={presence?.tone === 'online' && signal === presence.text ? 'success' : 'primary'} numberOfLines={1} align="center" style={{ marginTop: 2, minHeight: 15 }}>
          {signal}
        </Text>
        {showActions && !isSelf ? <FriendButton targetId={person.id} displayName={person.display_name} state={friendState} compact size="sm" fullWidth style={{ marginTop: spacing.sm }} onChange={(next) => onRelationshipChange?.(person.id, next)} /> : null}
      </Pressable>
    );
  }

  const meta = personMeta(person);
  const signals: { icon: keyof typeof Ionicons.glyphMap; text: string; tone?: 'gradient' | 'neutral' | 'success' }[] = [];
  if (person.shared_interests > 0) signals.push({ icon: 'sparkles', text: pluralize(person.shared_interests, 'shared interest'), tone: 'gradient' });
  if (person.mutual_friends > 0) signals.push({ icon: 'people', text: pluralize(person.mutual_friends, 'mutual friend') });
  if (person.languages.length > 0) signals.push({ icon: 'language', text: `Speaks ${languageNames(person.languages, 2)}` });
  if (person.distance_km != null) signals.push({ icon: 'navigate', text: `~${person.distance_km} km away` });

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable onPress={openProfile} accessibilityRole="button" accessibilityLabel={`Open ${person.display_name}'s profile`} style={styles.head}>
        <Avatar uri={person.avatar_url} name={person.display_name} size={56} online={person.presence.is_online} />
        <View style={styles.texts}>
          <View style={styles.nameRow}>
            <Text variant="bodySemibold" numberOfLines={1} style={{ flexShrink: 1 }}>
              {person.display_name}
            </Text>
            {person.is_verified ? <VerifiedBadge size={14} style={{ marginLeft: 4 }} /> : null}
            {person.is_premium ? <Ionicons name="diamond" size={12} color={palette.gold} style={{ marginLeft: 4 }} /> : null}
          </View>
          <Text variant="small" color="textMuted" numberOfLines={1}>
            {meta}
          </Text>
          {presence || note ? (
            <View style={styles.presenceRow}>
              {presence ? <View style={[styles.dot, { backgroundColor: presence.tone === 'online' ? palette.success : colors.textMuted }]} /> : null}
              <Text variant="caption" color={presence?.tone === 'online' ? 'success' : 'textMuted'} numberOfLines={1}>
                {[presence?.text, note].filter(Boolean).join(' · ')}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {person.bio ? (
        <Text variant="small" color="textSecondary" numberOfLines={2} style={{ marginTop: spacing.sm }}>
          {person.bio}
        </Text>
      ) : null}

      {person.interests.length > 0 ? (
        <View style={styles.chips}>
          {person.interests.slice(0, 4).map((i) => (
            <Chip key={i.id} label={i.name} emoji={i.emoji} size="sm" selected={i.shared} disabled style={{ opacity: 1 }} />
          ))}
          {person.interests.length > 4 ? (
            <Text variant="caption" color="textMuted" style={{ alignSelf: 'center' }}>
              +{person.interests.length - 4}
            </Text>
          ) : null}
        </View>
      ) : null}

      {signals.length > 0 ? (
        <View style={styles.signals}>
          {signals.map((s) => (
            <Pill key={s.text} label={s.text} icon={s.icon} tone={s.tone ?? 'neutral'} />
          ))}
        </View>
      ) : null}

      {showActions && !isSelf && !person.relationship.is_blocking ? (
        <View style={styles.actions}>
          <FriendButton targetId={person.id} displayName={person.display_name} state={friendState} size="sm" style={{ flex: 1 }} onChange={(next) => onRelationshipChange?.(person.id, next)} />
          <FollowButton targetId={person.id} state={followStateOf(person)} isPrivate={person.is_private} size="sm" />
          <IconButton icon="chatbubble-ellipses-outline" accessibilityLabel={`Message ${person.display_name}`} variant="surface" size={36} onPress={() => void message.open(person)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, marginBottom: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : null) },
  texts: { flex: 1, marginLeft: spacing.md },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  presenceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2, marginTop: spacing.sm },
  signals: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2, marginTop: spacing.sm },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  tile: { width: 156, alignItems: 'center', padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : null) },
});
