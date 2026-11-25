import { StyleSheet, View, type ViewProps } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { radius, shadows, spacing } from '@/theme/tokens';

export interface CardProps extends ViewProps {
  padded?: boolean;
  elevated?: boolean;
  muted?: boolean;
  bordered?: boolean;
}

export function Card({ padded = true, elevated = false, muted = false, bordered = true, style, ...rest }: CardProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: muted ? colors.surfaceMuted : colors.surface,
          borderColor: colors.border,
          borderWidth: bordered ? StyleSheet.hairlineWidth : 0,
        },
        padded && styles.padded,
        elevated && shadows.md,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.xl, overflow: 'hidden' },
  padded: { padding: spacing.lg },
});
