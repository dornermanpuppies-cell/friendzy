import { Ionicons } from '@/components/ui/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { gradients, palette, radius, spacing } from '@/theme/tokens';

export function VerifiedBadge({ size = 16, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      accessibilityLabel="Verified account"
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <Ionicons name="checkmark" size={size * 0.65} color={palette.white} />
    </View>
  );
}

export function Pill({
  label,
  tone = 'neutral',
  icon,
  style,
}: {
  label: string;
  tone?: 'neutral' | 'primary' | 'success' | 'danger' | 'warning' | 'gradient' | 'premium';
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const bg =
    tone === 'primary'
      ? colors.primarySoft
      : tone === 'success'
        ? 'rgba(34,197,94,0.14)'
        : tone === 'danger'
          ? 'rgba(255,77,109,0.14)'
          : tone === 'warning'
            ? 'rgba(245,158,11,0.16)'
            : colors.surfaceMuted;
  const fg =
    tone === 'primary'
      ? colors.primary
      : tone === 'success'
        ? palette.success
        : tone === 'danger'
          ? palette.danger
          : tone === 'warning'
            ? palette.warning
            : tone === 'gradient' || tone === 'premium'
              ? palette.white
              : colors.textSecondary;

  return (
    <View style={[styles.pill, { backgroundColor: tone === 'gradient' || tone === 'premium' ? 'transparent' : bg }, style]}>
      {tone === 'gradient' || tone === 'premium' ? (
        <LinearGradient
          colors={tone === 'premium' ? [...gradients.premium] : [...gradients.primary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: radius.full }]}
        />
      ) : null}
      {icon ? <Ionicons name={icon} size={12} color={fg} style={{ marginRight: 4 }} /> : null}
      <Text variant="caption" style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
}

export function CountBadge({ count, style }: { count: number; style?: StyleProp<ViewStyle> }) {
  if (count <= 0) return null;
  return (
    <View style={[styles.count, style]}>
      <Text variant="caption" color={palette.white} style={{ fontSize: 10, lineHeight: 12 }}>
        {count > 99 ? '99+' : count}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.full,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  count: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: palette.pink,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
