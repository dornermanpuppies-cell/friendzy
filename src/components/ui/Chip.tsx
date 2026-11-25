import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Platform, Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { gradients, palette, radius, spacing } from '@/theme/tokens';

export interface ChipProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  selected?: boolean;
  emoji?: string | null;
  icon?: keyof typeof Ionicons.glyphMap;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}

export function Chip({ label, selected = false, emoji, icon, size = 'md', style, disabled, ...rest }: ChipProps) {
  const { colors, isDark } = useTheme();
  const height = size === 'sm' ? 32 : 40;
  const textColor = selected ? palette.white : colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: Boolean(disabled) }}
      disabled={disabled}
      {...rest}
      style={({ pressed }) => [
        styles.base,
        {
          height,
          borderRadius: radius.full,
          paddingHorizontal: size === 'sm' ? spacing.md : spacing.lg,
          backgroundColor: selected ? 'transparent' : isDark ? colors.surfaceMuted : colors.surfaceMuted,
          borderColor: selected ? 'transparent' : colors.border,
        },
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {selected ? (
        <LinearGradient colors={[...gradients.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: radius.full }]} />
      ) : null}
      {emoji ? (
        <Text variant={size === 'sm' ? 'small' : 'body'} style={styles.emoji}>
          {emoji}
        </Text>
      ) : null}
      {icon ? <Ionicons name={icon} size={size === 'sm' ? 14 : 16} color={textColor} style={styles.emoji} /> : null}
      <Text variant={size === 'sm' ? 'smallMedium' : 'bodyMedium'} style={{ color: textColor }} numberOfLines={1}>
        {label}
      </Text>
      {selected ? <Ionicons name="checkmark" size={size === 'sm' ? 14 : 16} color={palette.white} style={styles.check} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer', userSelect: 'none' } as object) : null),
  },
  emoji: { marginRight: spacing.xs + 2 },
  check: { marginLeft: spacing.xs + 2 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});
