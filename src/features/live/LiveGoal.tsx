import { Ionicons } from '@/components/ui/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Text } from '@/components/ui/Text';
import { gradients, palette, radius, spacing } from '@/theme/tokens';
import type { LiveGoal, LiveSupporter } from '@/types/live';
import { formatCount } from '@/utils/format';

/**
 * The goal the host set for this broadcast, with a bar that fills as gifts or likes come in.
 * Tapping it opens the goal sheet (the host can change it, everyone else sees the detail).
 */
export const LiveGoalBar = memo(function LiveGoalBar({ goal, onPress }: { goal: LiveGoal; onPress: () => void }) {
  const fraction = Math.max(0, Math.min(1, goal.target > 0 ? goal.progress / goal.target : 0));
  const width = useRef(new Animated.Value(fraction)).current;
  const reached = goal.status === 'reached';

  useEffect(() => {
    Animated.timing(width, { toValue: fraction, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [fraction, width]);

  return (
    <Pressable onPress={onPress} style={styles.goal} accessibilityLabel={`Goal: ${formatCount(goal.progress)} of ${formatCount(goal.target)} ${goal.kind}`}>
      <View style={styles.goalRow}>
        <Ionicons name={reached ? 'trophy' : goal.kind === 'coins' ? 'diamond' : 'heart'} size={13} color={reached ? palette.gold : palette.pinkSoft} />
        <Text variant="caption" color={palette.white} numberOfLines={1} style={{ flex: 1, marginLeft: 5 }}>
          {goal.label ?? (goal.kind === 'coins' ? 'Gift goal' : 'Like goal')}
        </Text>
        <Text variant="caption" color={reached ? palette.gold : 'rgba(255,255,255,0.85)'}>
          {reached ? 'Reached 🎉' : `${formatCount(goal.progress)}/${formatCount(goal.target)}`}
        </Text>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fillWrap, { width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}>
          <LinearGradient colors={reached ? [palette.gold, palette.gold] : [...gradients.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.fill} />
        </Animated.View>
      </View>
    </Pressable>
  );
});

/** Top three supporters of the running broadcast, newest totals first. Tap for the full ranking. */
export const SupporterRail = memo(function SupporterRail({ supporters, onPress }: { supporters: LiveSupporter[]; onPress: () => void }) {
  if (supporters.length === 0) return null;
  return (
    <Pressable onPress={onPress} style={styles.rail} accessibilityLabel="Top supporters">
      {supporters.slice(0, 3).map((s, index) => (
        <View key={s.user.id} style={[styles.railItem, index > 0 && { marginLeft: -8 }]}>
          <Avatar uri={s.user.avatar_url} name={s.user.display_name} size={26} />
          <View style={[styles.rank, { backgroundColor: index === 0 ? palette.gold : index === 1 ? '#C0C6D4' : '#CD7F32' }]}>
            <Text variant="caption" color={palette.night} style={styles.rankText}>
              {s.rank}
            </Text>
          </View>
        </View>
      ))}
    </Pressable>
  );
});

/** The question the host put on screen. */
export const FeaturedQuestion = memo(function FeaturedQuestion({ question, canClear, onClear }: { question: { id: string; text: string; user: { display_name: string; avatar_url: string | null } }; canClear: boolean; onClear: () => void }) {
  return (
    <View style={styles.question}>
      <Ionicons name="help-circle" size={16} color={palette.gold} />
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        <Text variant="caption" color="rgba(255,255,255,0.7)" numberOfLines={1}>
          {question.user.display_name} asked
        </Text>
        <Text variant="smallMedium" color={palette.white} numberOfLines={3}>
          {question.text}
        </Text>
      </View>
      {canClear ? (
        <Pressable onPress={onClear} hitSlop={8} accessibilityLabel="Mark question answered">
          <Ionicons name="checkmark-circle-outline" size={20} color={palette.white} />
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  goal: { backgroundColor: 'rgba(9,8,23,0.55)', borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  goalRow: { flexDirection: 'row', alignItems: 'center' },
  track: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden', marginTop: 5 },
  fillWrap: { height: 5 },
  fill: { flex: 1, borderRadius: 3 },
  rail: { flexDirection: 'row', alignItems: 'center' },
  railItem: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  rank: { position: 'absolute', bottom: -2, right: -2, minWidth: 13, height: 13, borderRadius: 7, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  rankText: { fontSize: 9, lineHeight: 13, fontWeight: '800' },
  question: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(9,8,23,0.6)', borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderLeftWidth: 3, borderLeftColor: palette.gold },
});
