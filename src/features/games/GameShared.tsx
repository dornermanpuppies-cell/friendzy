import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { Avatar } from '@/components/ui/Avatar';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { GameParticipant, GameRoom } from '@/types/games';

/** Seconds left until `deadline` (ticks every 500 ms; 0 when there is no deadline). */
export function useCountdown(deadline: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [deadline]);
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
}

/** A short vibration (phones only) when it becomes the player's turn. */
export function useTurnHaptics(myTurn: boolean): void {
  const previous = useRef(myTurn);
  useEffect(() => {
    if (myTurn && !previous.current && Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }
    previous.current = myTurn;
  }, [myTurn]);
}

export function tapHaptic(): void {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

export function PlayersStrip({ room, scores, turnUser, highlight, badges }: { room: GameRoom; scores?: Record<string, number>; turnUser?: string | null; highlight?: Record<string, string>; badges?: Record<string, string> }) {
  const { colors } = useTheme();
  const players = room.participants.filter((p) => p.state !== 'invited');
  return (
    <View style={styles.strip}>
      {players.map((p) => {
        const active = turnUser === p.id;
        const badge = badges?.[p.id];
        return (
          <View key={p.id} style={[styles.player, { borderColor: active ? colors.primary : 'transparent', backgroundColor: active ? colors.primarySoft : 'transparent', opacity: p.state === 'left' ? 0.4 : 1 }]}>
            <View>
              <Avatar uri={p.avatar_url} name={p.display_name} size={36} />
              {highlight?.[p.id] ? <View style={[styles.seatDot, { backgroundColor: highlight[p.id] }]} /> : null}
              {badge ? (
                <View style={[styles.badge, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Text variant="caption" style={{ fontSize: 10, lineHeight: 12 }} color={badge.startsWith('+') ? 'success' : badge === '✓' ? 'success' : 'textMuted'}>
                    {badge}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text variant="caption" numberOfLines={1} style={{ maxWidth: 72 }}>
              {p.state === 'left' ? `${p.display_name} (left)` : p.display_name}
            </Text>
            {scores ? (
              <Text variant="smallMedium" color="primary">
                {scores[p.id] ?? 0}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export function TurnBanner({ label, seconds, total }: { label: string; seconds: number; total: number }) {
  const { colors } = useTheme();
  const fraction = total > 0 ? Math.min(1, seconds / total) : 0;
  const urgent = seconds > 0 && seconds <= 5;
  return (
    <View style={[styles.banner, { backgroundColor: urgent ? 'rgba(255,77,109,0.12)' : colors.surfaceMuted }]}>
      <Text variant="smallMedium" style={{ flex: 1 }} numberOfLines={2}>
        {label}
      </Text>
      <Text variant="smallMedium" color={urgent ? 'danger' : 'textMuted'}>
        {seconds}s
      </Text>
      <View style={[styles.timer, { backgroundColor: colors.border }]}>
        <View style={[styles.timerFill, { width: `${fraction * 100}%`, backgroundColor: urgent ? palette.danger : colors.primary }]} />
      </View>
    </View>
  );
}

const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

/**
 * Dice face that tumbles through random faces for ~650 ms whenever `rollKey`
 * changes, then settles on `value`.
 */
export function Dice({ value, rollKey, color, size = 44 }: { value: number | null; rollKey: string | number | null; color: string; size?: number }) {
  const { colors } = useTheme();
  const [face, setFace] = useState<number | null>(value);
  const [rolling, setRolling] = useState(false);
  const scale = useSharedValue(1);
  const rotate = useSharedValue(0);
  const lastKey = useRef(rollKey);

  useEffect(() => {
    if (rollKey === lastKey.current || value === null) {
      setFace(value);
      return;
    }
    lastKey.current = rollKey;
    setRolling(true);
    scale.value = withSequence(withTiming(1.25, { duration: 160, easing: Easing.out(Easing.quad) }), withTiming(1, { duration: 420, easing: Easing.elastic(1.4) }));
    rotate.value = withSequence(withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) }), withTiming(0, { duration: 0 }));
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      setFace(1 + Math.floor(Math.random() * 6));
      if (ticks >= 9) {
        clearInterval(timer);
        setFace(value);
        setRolling(false);
      }
    }, 70);
    return () => clearInterval(timer);
  }, [rollKey, value, scale, rotate]);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }, { rotate: `${rotate.value * 360}deg` }] }));
  return (
    <Animated.View style={[styles.dice, { width: size + 20, height: size + 20, backgroundColor: colors.surfaceMuted, borderColor: rolling ? color : 'transparent' }, animated]}>
      <Text style={{ fontSize: size, lineHeight: size + 8, color: face ? color : colors.textMuted }}>{face ? FACES[face - 1] : '🎲'}</Text>
    </Animated.View>
  );
}

/** Soft pulsing ring used to mark pieces the player may move. */
export function PulseRing({ size, color }: { size: number; color: string }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [progress]);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: 1 + progress.value * 0.25 }], opacity: 0.9 - progress.value * 0.6 }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 3, borderColor: color }, animated]} />;
}

export function participantById(room: GameRoom, id: string | null | undefined): GameParticipant | undefined {
  return room.participants.find((p) => p.id === id);
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  player: { alignItems: 'center', padding: spacing.xs, borderRadius: radius.md, borderWidth: 1.5, minWidth: 72 },
  seatDot: { position: 'absolute', right: -2, bottom: -2, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: palette.white },
  badge: { position: 'absolute', left: -6, top: -6, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, flexWrap: 'wrap' },
  timer: { width: '100%', height: 4, borderRadius: 2, overflow: 'hidden' },
  timerFill: { height: 4 },
  dice: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
});
