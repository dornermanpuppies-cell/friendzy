import { type PropsWithChildren, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useTheme } from '@/theme/ThemeProvider';
import { layout, spacing } from '@/theme/tokens';

export interface ScreenProps extends PropsWithChildren {
  /** Wrap children in a ScrollView. */
  scroll?: boolean;
  /** Horizontal padding. */
  padded?: boolean;
  /** Center and constrain content width on large screens. */
  maxWidth?: number | false;
  edges?: Edge[];
  header?: ReactNode;
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  backgroundColor?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
  keyboardAvoiding?: boolean;
  scrollProps?: ScrollViewProps;
}

export function Screen({
  children,
  scroll = false,
  padded = true,
  maxWidth = layout.maxContentWidth,
  edges = ['top', 'left', 'right'],
  header,
  footer,
  style,
  contentStyle,
  backgroundColor,
  refreshing,
  onRefresh,
  keyboardAvoiding = true,
  scrollProps,
}: ScreenProps) {
  const { colors } = useTheme();
  const { isDesktop } = useBreakpoint();
  const bg = backgroundColor ?? colors.background;

  const constrained = (
    <View
      style={[
        styles.content,
        padded && { paddingHorizontal: isDesktop ? spacing['3xl'] : spacing.lg },
        maxWidth ? { maxWidth, width: '100%', alignSelf: 'center' } : null,
        contentStyle,
      ]}
    >
      {children}
    </View>
  );

  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
      {...scrollProps}
    >
      {constrained}
    </ScrollView>
  ) : (
    constrained
  );

  return (
    <SafeAreaView edges={isDesktop ? [] : edges} style={[styles.flex, { backgroundColor: bg }, style]}>
      {header}
      {keyboardAvoiding ? (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
      {footer}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: spacing['4xl'] },
});
