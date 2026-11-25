import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button, type ButtonProps } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { confirmAction } from '@/features/feed/usePostActions';
import { cancelFriendRequest, getRelationship, respondFriendRequest, sendFriendRequest, unfriend } from '@/services/relationships';
import { useAuthStore } from '@/store/authStore';
import { useBadgeStore } from '@/store/badgeStore';
import { spacing } from '@/theme/tokens';
import type { CardRelationship } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';

export type FriendState = Pick<CardRelationship, 'is_friend' | 'friend_request'>;

export interface FriendButtonProps {
  targetId: string;
  displayName: string;
  state: FriendState;
  onChange?: (next: FriendState) => void;
  size?: ButtonProps['size'];
  /** Short labels for tiles. */
  compact?: boolean;
  /** Show a Decline button next to Accept for incoming requests. */
  showDecline?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

const NONE: FriendState = { is_friend: false, friend_request: null };

function keyOf(state: FriendState): string {
  return `${state.is_friend ? 'f' : '-'}:${state.friend_request?.id ?? ''}:${state.friend_request?.direction ?? ''}`;
}

/**
 * Add friend → Requested → Friends (and Accept / Decline for incoming requests)
 * with optimistic updates. Duplicate and blocked requests are rejected server-side.
 */
export function FriendButton({ targetId, displayName, state, onChange, size = 'sm', compact = false, showDecline = false, fullWidth, style }: FriendButtonProps) {
  const toast = useToast();
  const userId = useAuthStore((s) => s.user?.id);
  const refreshBadges = useBadgeStore((s) => s.refresh);
  const [current, setCurrent] = useState<FriendState>(state);
  const [syncedKey, setSyncedKey] = useState(keyOf(state));
  const [busy, setBusy] = useState(false);

  // Adopt new props (e.g. after a reload) without an effect.
  if (keyOf(state) !== syncedKey) {
    setSyncedKey(keyOf(state));
    setCurrent(state);
  }

  const apply = (next: FriendState) => {
    setCurrent(next);
    onChange?.(next);
  };

  const run = async (optimistic: FriendState, fn: () => Promise<FriendState | void>, success?: string | ((result: FriendState) => string)) => {
    if (busy) return;
    const previous = current;
    setBusy(true);
    apply(optimistic);
    try {
      const result = (await fn()) ?? optimistic;
      apply(result);
      if (success) toast.success(typeof success === 'function' ? success(result) : success);
      if (userId) void refreshBadges(userId);
    } catch (error) {
      apply(previous);
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(
      { is_friend: false, friend_request: { id: 'pending', direction: 'outgoing', created_at: new Date().toISOString() } },
      async () => {
        const id = await sendFriendRequest(targetId);
        // The server auto-accepts when the other person already asked us — read back the truth.
        const rel = await getRelationship(targetId).catch(() => null);
        if (rel) return { is_friend: rel.is_friend, friend_request: rel.friend_request };
        return { is_friend: false, friend_request: { id, direction: 'outgoing', created_at: new Date().toISOString() } };
      },
      (result) => (result.is_friend ? `You and ${displayName} are now friends` : 'Friend request sent'),
    );

  const cancel = () => {
    const id = current.friend_request?.id;
    if (!id) return;
    confirmAction('Cancel friend request?', `${displayName} will no longer see your request.`, 'Cancel request', () => void run(NONE, () => cancelFriendRequest(id), 'Request cancelled'));
  };

  const accept = () => {
    const id = current.friend_request?.id;
    if (!id) return;
    void run({ is_friend: true, friend_request: null }, () => respondFriendRequest(id, true), `You and ${displayName} are now friends`);
  };

  const decline = () => {
    const id = current.friend_request?.id;
    if (!id) return;
    void run(NONE, () => respondFriendRequest(id, false), 'Request declined');
  };

  const remove = () => confirmAction('Remove friend?', `${displayName} will no longer be your friend. They are not notified.`, 'Remove', () => void run(NONE, () => unfriend(targetId), 'Friend removed'));

  let title: string;
  let variant: ButtonProps['variant'];
  let icon: ButtonProps['leftIcon'];
  let onPress: () => void;
  if (current.is_friend) {
    title = 'Friends';
    variant = 'secondary';
    icon = 'people';
    onPress = remove;
  } else if (current.friend_request?.direction === 'incoming') {
    title = 'Accept';
    variant = 'gradient';
    icon = 'checkmark';
    onPress = accept;
  } else if (current.friend_request?.direction === 'outgoing') {
    title = compact ? 'Sent' : 'Requested';
    variant = 'secondary';
    icon = 'time-outline';
    onPress = cancel;
  } else {
    title = compact ? 'Add' : 'Add friend';
    variant = 'gradient';
    icon = 'person-add-outline';
    onPress = add;
  }

  const button = <Button title={title} variant={variant} size={size} leftIcon={icon} onPress={onPress} disabled={busy || current.friend_request?.id === 'pending'} fullWidth={fullWidth} style={showDecline && current.friend_request?.direction === 'incoming' ? { flex: 1 } : style} accessibilityLabel={current.is_friend ? `Friends with ${displayName}` : title} />;

  if (showDecline && current.friend_request?.direction === 'incoming') {
    return (
      <View style={[styles.pair, style]}>
        {button}
        <Button title="Decline" variant="ghost" size={size} onPress={decline} disabled={busy} />
      </View>
    );
  }
  return button;
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
