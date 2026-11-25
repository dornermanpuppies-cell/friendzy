import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  rounded?: number;
  circle?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({ width = '100%', height = 16, rounded = radius.sm, circle = false, style }: SkeletonProps) {
  const { colors } = useTheme();
  const [opacity] = useState(() => new Animated.Value(0.5));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  const size = circle ? height : undefined;
  return (
    <Animated.View
      style={[
        {
          width: circle ? size : width,
          height,
          borderRadius: circle ? height / 2 : rounded,
          backgroundColor: colors.skeleton,
          opacity,
        },
        style,
      ]}
    />
  );
}

/** A typical user row placeholder (avatar + two lines). */
export function SkeletonRow({ lines = 2 }: { lines?: number }) {
  return (
    <View style={styles.row}>
      <Skeleton circle height={48} />
      <View style={styles.rowLines}>
        <Skeleton width="55%" height={14} />
        {lines > 1 ? <Skeleton width="35%" height={12} style={{ marginTop: spacing.sm }} /> : null}
      </View>
    </View>
  );
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  rowLines: { flex: 1, marginLeft: spacing.md },
});
