import { Ionicons } from '@/components/ui/Ionicons';
import { forwardRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { fontFamily, palette, radius, spacing } from '@/theme/tokens';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string | null;
  helper?: string;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  rightElement?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  /** Shows a character counter when maxLength is set. */
  showCounter?: boolean;
  prefix?: string;
}

export const Input = forwardRef<ComponentRef<typeof TextInput>, InputProps>(function Input(
  { label, error, helper, leftIcon, rightElement, containerStyle, showCounter, prefix, secureTextEntry, style, multiline, onFocus, onBlur, value, maxLength, editable = true, ...rest },
  ref,
) {
  const { colors, isDark } = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(Boolean(secureTextEntry));

  const borderColor = error ? palette.danger : focused ? colors.primary : colors.border;

  return (
    <View style={[styles.wrapper, containerStyle]}>
      {label ? (
        <Text variant="smallMedium" color="textSecondary" style={styles.label}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.field,
          {
            backgroundColor: colors.inputBackground,
            borderColor,
            borderWidth: focused || error ? 1.5 : 1,
            minHeight: multiline ? 112 : 50,
            opacity: editable ? 1 : 0.6,
          },
          focused && !error && (isDark ? styles.focusGlowDark : styles.focusGlow),
        ]}
      >
        {leftIcon ? <Ionicons name={leftIcon} size={18} color={focused ? colors.primary : colors.textMuted} style={styles.leftIcon} /> : null}
        {prefix ? (
          <Text variant="bodyMedium" color="textMuted" style={styles.prefix}>
            {prefix}
          </Text>
        ) : null}
        <TextInput
          ref={ref}
          value={value}
          maxLength={maxLength}
          editable={editable}
          placeholderTextColor={colors.placeholder}
          secureTextEntry={hidden}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            styles.input,
            { color: colors.text, paddingTop: multiline ? spacing.md : 0 },
            Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
            style,
          ]}
          {...rest}
        />
        {secureTextEntry ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            style={styles.rightIcon}
          >
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
        {rightElement ? <View style={styles.rightIcon}>{rightElement}</View> : null}
      </View>
      {error || helper || (showCounter && maxLength) ? (
        <View style={styles.footer}>
          <Text variant="small" color={error ? 'danger' : 'textMuted'} style={styles.footerText}>
            {error ?? helper ?? ''}
          </Text>
          {showCounter && maxLength ? (
            <Text variant="caption" color="textMuted">
              {(value?.length ?? 0)}/{maxLength}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: { width: '100%' },
  label: { marginBottom: spacing.sm },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  focusGlow: Platform.select({
    web: { boxShadow: '0 0 0 4px rgba(112,0,255,0.12)' } as object,
    default: {},
  }) as object,
  focusGlowDark: Platform.select({
    web: { boxShadow: '0 0 0 4px rgba(163,102,255,0.22)' } as object,
    default: {},
  }) as object,
  input: {
    flex: 1,
    fontFamily: fontFamily.body,
    fontSize: 15,
    lineHeight: 20,
    paddingVertical: spacing.md,
  },
  leftIcon: { marginRight: spacing.sm },
  rightIcon: { marginLeft: spacing.sm },
  prefix: { marginRight: 2 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: spacing.xs, paddingHorizontal: spacing.xs },
  footerText: { flex: 1 },
});
