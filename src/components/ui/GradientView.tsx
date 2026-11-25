import { LinearGradient, type LinearGradientProps } from 'expo-linear-gradient';

import { gradients } from '@/theme/tokens';

export interface GradientViewProps extends Omit<LinearGradientProps, 'colors'> {
  preset?: keyof typeof gradients;
  colors?: readonly string[];
  direction?: 'horizontal' | 'vertical' | 'diagonal';
}

export function GradientView({ preset = 'primary', colors, direction = 'diagonal', start, end, ...rest }: GradientViewProps) {
  const resolved = (colors ?? gradients[preset]) as unknown as [string, string, ...string[]];
  const dir =
    direction === 'horizontal'
      ? { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } }
      : direction === 'vertical'
        ? { start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 } }
        : { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };
  return <LinearGradient colors={resolved} start={start ?? dir.start} end={end ?? dir.end} {...rest} />;
}
