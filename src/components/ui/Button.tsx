import { Ionicons } from '@/components/ui/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { gradients, palette, radius, shadows, spacing } from '@/theme/tokens';

export type ButtonVariant = 'gradient' | 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'light';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
  glow?: boolean;
}

const HEIGHTS: Record<ButtonSize, number> = { sm: 38, md: 48, lg: 56 };
const PADDINGS: Record<ButtonSize, number> = { sm: spacing.lg, md: spacing['2xl'], lg: spacing['3xl'] };
const FONT_SIZES: Record<ButtonSize, number> = { sm: 13, md: 15, lg: 16 };

export function Button({
  title,
  variant = 'gradient',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  leftIcon,
  rightIcon,
  style,
  glow = false,
  ...pressableProps
}: ButtonProps) {
  const { colors, isDark } = useTheme();
  const isDisabled = disabled || loading;

  const textColor = (() => {
    switch (variant) {
      case 'gradient':
      case 'primary':
      case 'danger':
        return palette.white;
      case 'light':
        return palette.purple;
      case 'secondary':
        return colors.text;
      case 'outline':
      case 'ghost':
        return colors.primary;
    }
  })();

  const containerStyle: ViewStyle = (() => {
    switch (variant) {
      case 'primary':
        return { backgroundColor: palette.purple };
      case 'danger':
        return { backgroundColor: palette.danger };
      case 'light':
        return { backgroundColor: palette.white };
      case 'secondary':
        return { backgroundColor: isDark ? colors.surfaceStrong : colors.surfaceMuted };
      case 'outline':
        return { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.primary };
      case 'ghost':
        return { backgroundColor: 'transparent' };
      default:
        return {};
    }
  })();

  const content = (
    <View style={styles.content}>
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <>
          {leftIcon ? <Ionicons name={leftIcon} size={FONT_SIZES[size] + 3} color={textColor} style={styles.iconLeft} /> : null}
          <Text variant="button" style={{ color: textColor, fontSize: FONT_SIZES[size] }} numberOfLines={1}>
            {title}
          </Text>
          {rightIcon ? <Ionicons name={rightIcon} size={FONT_SIZES[size] + 3} color={textColor} style={styles.iconRight} /> : null}
        </>
      )}
    </View>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      {...pressableProps}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.base,
        { height: HEIGHTS[size], borderRadius: radius.full },
        fullWidth && styles.fullWidth,
        variant !== 'gradient' && containerStyle,
        variant !== 'gradient' && { paddingHorizontal: PADDINGS[size] },
        (variant === 'gradient' || glow) && !isDisabled && shadows.glow,
        isDisabled && styles.disabled,
        pressed && styles.pressed,
        hovered && !pressed && styles.hovered,
        style,
      ]}
    >
      {variant === 'gradient' ? (
        <LinearGradient
          colors={[...gradients.primary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.gradient, { paddingHorizontal: PADDINGS[size], borderRadius: radius.full }]}
        >
          {content}
        </LinearGradient>
      ) : (
        content
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexDirection: 'row',
    alignSelf: 'flex-start',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer', userSelect: 'none', transitionDuration: '120ms' } as object) : null),
  },
  fullWidth: { alignSelf: 'stretch', width: '100%' },
  gradient: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  iconLeft: { marginRight: spacing.sm },
  iconRight: { marginLeft: spacing.sm },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  hovered: { opacity: 0.92 },
});
