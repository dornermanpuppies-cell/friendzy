import { useEffect, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, shadows, spacing } from '@/theme/tokens';
import { REACTIONS, type ReactionType } from '@/types/social';

export interface ReactionPickerProps {
  visible: boolean;
  current: ReactionType | null;
  onSelect: (reaction: ReactionType) => void;
  onClose: () => void;
}

/** Floating emoji bar shown on long-press of the react button. */
export function ReactionPicker({ visible, current, onSelect, onClose }: ReactionPickerProps) {
  const { colors } = useTheme();
  const [scale] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.spring(scale, { toValue: visible ? 1 : 0, useNativeDriver: true, damping: 14, stiffness: 220 }).start();
  }, [visible, scale]);

  if (!visible) return null;

  return (
    <>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close reactions" />
      <Animated.View style={[styles.bar, { backgroundColor: colors.backgroundElevated, borderColor: colors.border, transform: [{ scale }] }, shadows.md]}>
        {REACTIONS.map((r) => (
          <Pressable
            key={r.type}
            onPress={() => onSelect(r.type)}
            accessibilityRole="button"
            accessibilityLabel={r.label}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.item,
              current === r.type && { backgroundColor: colors.primarySoft },
              (pressed || hovered) && { transform: [{ scale: 1.25 }] },
            ]}
          >
            <Text style={styles.emoji}>{r.emoji}</Text>
          </Pressable>
        ))}
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: spacing.md,
    bottom: 52,
    flexDirection: 'row',
    padding: spacing.xs,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 20,
    ...(Platform.OS === 'web' ? ({ cursor: 'default' } as object) : null),
  },
  item: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 26, lineHeight: 32 },
});

export function ReactionSummary({ counts, total }: { counts?: Partial<Record<ReactionType, number>>; total: number }) {
  const { colors } = useTheme();
  if (total <= 0) return <View />;
  const top = counts ? (Object.entries(counts) as [ReactionType, number][]).sort((a, b) => b[1] - a[1]).slice(0, 3) : [['like', total] as [ReactionType, number]];
  return (
    <View style={summaryStyles.row}>
      <View style={summaryStyles.emojis}>
        {top.map(([type]) => (
          <View key={type} style={[summaryStyles.emojiWrap, { borderColor: colors.background }]}>
            <Text style={summaryStyles.emojiSmall}>{REACTIONS.find((r) => r.type === type)?.emoji}</Text>
          </View>
        ))}
      </View>
      <Text variant="small" color="textMuted">
        {total}
      </Text>
    </View>
  );
}

const summaryStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  emojis: { flexDirection: 'row', marginRight: 6 },
  emojiWrap: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginRight: -5, backgroundColor: '#fff' },
  emojiSmall: { fontSize: 11, lineHeight: 14 },
});
