import { Ionicons } from '@/components/ui/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button, type ButtonProps } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, spacing } from '@/theme/tokens';

export interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  emoji?: string;
  title: string;
  description?: string;
  action?: Pick<ButtonProps, 'title' | 'onPress' | 'variant' | 'leftIcon'>;
  secondaryAction?: Pick<ButtonProps, 'title' | 'onPress' | 'leftIcon'>;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({ icon = 'sparkles-outline', emoji, title, description, action, secondaryAction, compact = false, style }: EmptyStateProps) {
  const { colors, isDark } = useTheme();
  const size = compact ? 56 : 84;
  return (
    <View style={[styles.container, compact && styles.compact, style]}>
      <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', marginBottom: spacing.lg }}>
        <LinearGradient
          colors={isDark ? ['rgba(112,0,255,0.35)', 'rgba(255,40,185,0.25)'] : ['rgba(112,0,255,0.12)', 'rgba(255,40,185,0.12)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, styles.center]}
        >
          {emoji ? (
            <Text style={{ fontSize: size * 0.45, lineHeight: size * 0.6 }}>{emoji}</Text>
          ) : (
            <Ionicons name={icon} size={size * 0.42} color={isDark ? palette.pinkSoft : palette.purple} />
          )}
        </LinearGradient>
      </View>
      <Text variant={compact ? 'h4' : 'h3'} align="center">
        {title}
      </Text>
      {description ? (
        <Text variant="body" color="textMuted" align="center" style={styles.description}>
          {description}
        </Text>
      ) : null}
      {action ? <Button {...action} style={styles.action} /> : null}
      {secondaryAction ? <Button variant="ghost" {...secondaryAction} style={styles.secondary} /> : null}
      <View style={{ height: 1, backgroundColor: colors.background }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing['5xl'], paddingHorizontal: spacing['2xl'] },
  compact: { paddingVertical: spacing['2xl'] },
  center: { alignItems: 'center', justifyContent: 'center' },
  description: { marginTop: spacing.sm, maxWidth: 360 },
  action: { marginTop: spacing['2xl'] },
  secondary: { marginTop: spacing.sm },
});
