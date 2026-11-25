import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { gradients, radius, spacing } from '@/theme/tokens';

/** Segmented step indicator used by onboarding and multi-step forms. */
export function ProgressDots({ total, current, style }: { total: number; current: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, style]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: current + 1 }}>
      {Array.from({ length: total }).map((_, i) => {
        const done = i <= current;
        return (
          <View key={i} style={[styles.segment, { backgroundColor: colors.surfaceStrong }]}>
            {done ? (
              <LinearGradient colors={[...gradients.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.xs + 2 },
  segment: { flex: 1, height: 4, borderRadius: radius.full, overflow: 'hidden' },
});
