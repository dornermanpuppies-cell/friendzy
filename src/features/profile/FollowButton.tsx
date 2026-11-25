import { useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { Button, type ButtonProps } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { followUser, unfollowUser, type FollowState } from '@/services/relationships';
import { getErrorMessage } from '@/utils/errors';

export interface FollowButtonProps {
  targetId: string;
  state: FollowState;
  isPrivate?: boolean;
  onChange?: (state: FollowState) => void;
  size?: ButtonProps['size'];
  style?: StyleProp<ViewStyle>;
  fullWidth?: boolean;
}

/** Follow / Following / Requested button with optimistic updates. */
export function FollowButton({ targetId, state, isPrivate, onChange, size = 'sm', style, fullWidth }: FollowButtonProps) {
  const toast = useToast();
  const [current, setCurrent] = useState<FollowState>(state);
  const [syncedState, setSyncedState] = useState<FollowState>(state);
  const [busy, setBusy] = useState(false);

  // Adopt a new value from props (e.g. after the relationship reloads) without an effect.
  if (state !== syncedState) {
    setSyncedState(state);
    setCurrent(state);
  }

  const apply = (next: FollowState) => {
    setCurrent(next);
    onChange?.(next);
  };

  const toggle = async () => {
    if (busy) return;
    const previous = current;
    setBusy(true);
    try {
      if (current === 'none') {
        apply(isPrivate ? 'requested' : 'following');
        const result = await followUser(targetId);
        apply(result);
      } else {
        apply('none');
        await unfollowUser(targetId);
      }
    } catch (error) {
      apply(previous);
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const title = current === 'following' ? 'Following' : current === 'requested' ? 'Requested' : 'Follow';
  const variant: ButtonProps['variant'] = current === 'none' ? 'gradient' : 'secondary';

  return (
    <Button
      title={title}
      variant={variant}
      size={size}
      onPress={toggle}
      disabled={busy}
      leftIcon={current === 'none' ? 'person-add-outline' : current === 'following' ? 'checkmark' : 'time-outline'}
      style={style}
      fullWidth={fullWidth}
      accessibilityLabel={title}
    />
  );
}
