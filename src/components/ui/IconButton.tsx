import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Platform, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { gradients, palette, radius } from '@/theme/tokens';

export interface IconButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  icon: keyof typeof Ionicons.glyphMap;
  size?: number;
  iconSize?: number;
  variant?: 'ghost' | 'surface' | 'gradient' | 'outline' | 'overlay';
  color?: string;
  badge?: number | boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
}

export function IconButton({
  icon,
  size = 44,
  iconSize,
  variant = 'ghost',
  color,
  badge,
  style,
  disabled,
  ...rest
}: IconButtonProps) {
  const { colors } = useTheme();
  const resolvedIconSize = iconSize ?? Math.round(size * 0.5);
  const iconColor =
    color ?? (variant === 'gradient' ? palette.white : variant === 'overlay' ? palette.white : colors.text);

  const backgroundStyle: ViewStyle =
    variant === 'surface'
      ? { backgroundColor: colors.surfaceMuted }
      : variant === 'outline'
        ? { borderWidth: 1, borderColor: colors.border }
        : variant === 'overlay'
          ? { backgroundColor: 'rgba(9,8,23,0.45)' }
          : {};

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      {...rest}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.base,
        { width: size, height: size, borderRadius: radius.full },
        backgroundStyle,
        disabled && styles.disabled,
        pressed && styles.pressed,
        hovered && variant === 'ghost' && { backgroundColor: colors.surfaceMuted },
        style,
      ]}
    >
      {variant === 'gradient' ? (
        <LinearGradient colors={[...gradients.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: radius.full }]} />
      ) : null}
      <Ionicons name={icon} size={resolvedIconSize} color={iconColor} />
      {badge ? (
        <View style={[styles.badge, { borderColor: colors.background }]}>
          {typeof badge === 'number' ? (
            <Text variant="caption" color={palette.white} style={styles.badgeText}>
              {badge > 99 ? '99+' : badge}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer', transitionDuration: '120ms' } as object) : null),
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: palette.pink,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  badgeText: { fontSize: 9, lineHeight: 11, fontWeight: '700' },
});
