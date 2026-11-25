import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { typography, type ThemeColors, type TypographyVariant } from '@/theme/tokens';

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  /** A theme colour key (e.g. "textMuted") or any colour string. */
  color?: keyof ThemeColors | (string & {});
  align?: TextStyle['textAlign'];
  weight?: TextStyle['fontWeight'];
}

export function Text({ variant = 'body', color, align, weight, style, ...rest }: TextProps) {
  const { colors } = useTheme();
  const resolved = color ? ((colors as unknown as Record<string, string>)[color] ?? color) : colors.text;
  return (
    <RNText
      style={[typography[variant], { color: resolved }, align ? { textAlign: align } : null, weight ? { fontWeight: weight } : null, style]}
      {...rest}
    />
  );
}
