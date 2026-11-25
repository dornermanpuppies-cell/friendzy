import { Ionicons } from '@expo/vector-icons';
import { type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Switch, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';

export interface ListItemProps {
  title: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  /** Right-side content: a chevron (default when onPress), a value label, a switch or custom node. */
  right?: ReactNode;
  value?: string;
  switchValue?: boolean;
  onSwitchChange?: (value: boolean) => void;
  onPress?: () => void;
  danger?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  showChevron?: boolean;
  left?: ReactNode;
}

export function ListItem({
  title,
  subtitle,
  icon,
  iconColor,
  right,
  value,
  switchValue,
  onSwitchChange,
  onPress,
  danger = false,
  disabled = false,
  style,
  showChevron,
  left,
}: ListItemProps) {
  const { colors, isDark } = useTheme();
  const titleColor = danger ? palette.danger : colors.text;
  const isSwitch = typeof switchValue === 'boolean';
  const chevron = showChevron ?? (Boolean(onPress) && !isSwitch && !right);

  const content = (
    <>
      {left ? (
        <View style={styles.icon}>{left}</View>
      ) : icon ? (
        <View style={[styles.icon, { backgroundColor: danger ? 'rgba(255,77,109,0.12)' : colors.primarySoft }]}>
          <Ionicons name={icon} size={18} color={iconColor ?? (danger ? palette.danger : colors.primary)} />
        </View>
      ) : null}
      <View style={styles.texts}>
        <Text variant="bodyMedium" style={{ color: titleColor }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="small" color="textMuted" numberOfLines={2} style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="small" color="textMuted" style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right}
      {isSwitch ? (
        <Switch
          value={switchValue}
          onValueChange={onSwitchChange}
          disabled={disabled}
          trackColor={{ false: isDark ? colors.surfaceStrong : colors.borderStrong, true: palette.purple }}
          thumbColor={palette.white}
          {...(Platform.OS === 'web' ? ({ activeThumbColor: palette.white } as object) : null)}
        />
      ) : null}
      {chevron ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={styles.chevron} /> : null}
    </>
  );

  if (!onPress || isSwitch) {
    return (
      <Pressable
        onPress={isSwitch && onSwitchChange ? () => onSwitchChange(!switchValue) : undefined}
        disabled={disabled || !isSwitch}
        style={[styles.row, disabled && styles.disabled, style]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        (pressed || hovered) && { backgroundColor: colors.surfaceMuted },
        disabled && styles.disabled,
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}

export function ListSection({ title, children, style }: { title?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.section, style]}>
      {title ? (
        <Text variant="label" color="textMuted" style={styles.sectionTitle}>
          {title}
        </Text>
      ) : null}
      <View style={[styles.sectionBody, { backgroundColor: colors.surface, borderColor: colors.border }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 56,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : null),
  },
  icon: { width: 36, height: 36, borderRadius: radius.sm + 2, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  texts: { flex: 1 },
  subtitle: { marginTop: 2 },
  value: { marginLeft: spacing.md, maxWidth: 160 },
  chevron: { marginLeft: spacing.sm },
  disabled: { opacity: 0.5 },
  section: { marginBottom: spacing['2xl'] },
  sectionTitle: { marginBottom: spacing.sm, marginLeft: spacing.xs },
  sectionBody: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
});
