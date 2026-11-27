import { type PropsWithChildren, type ReactNode } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { ProgressDots } from '@/components/ui/ProgressDots';
import { Text } from '@/components/ui/Text';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

import { ONBOARDING_TOTAL } from './steps';

export interface OnboardingShellProps extends PropsWithChildren {
  step: number;
  title: string;
  subtitle?: string;
  primaryLabel?: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  primaryLoading?: boolean;
  onSkip?: () => void;
  footerNote?: ReactNode;
}

export function OnboardingShell({ step, title, subtitle, primaryLabel = 'Continue', onPrimary, primaryDisabled, primaryLoading, onSkip, footerNote, children }: OnboardingShellProps) {
  const { colors } = useTheme();
  const { isDesktop } = useBreakpoint();

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView behavior="padding" style={styles.root}>
        <View style={[styles.column, isDesktop && styles.columnDesktop]}>
          <View style={styles.header}>
            <ProgressDots total={ONBOARDING_TOTAL} current={step} style={{ flex: 1 }} />
            <View style={styles.skipSlot}>
              {onSkip ? (
                <Pressable onPress={onSkip} hitSlop={8} accessibilityRole="button">
                  <Text variant="bodyMedium" color="textMuted">
                    Skip
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text variant="caption" color="primary" style={{ marginBottom: spacing.sm }}>
              STEP {step + 1} OF {ONBOARDING_TOTAL}
            </Text>
            <Text variant="h1">{title}</Text>
            {subtitle ? (
              <Text variant="body" color="textMuted" style={{ marginTop: spacing.sm }}>
                {subtitle}
              </Text>
            ) : null}
            <View style={{ marginTop: spacing['2xl'] }}>{children}</View>
          </ScrollView>
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            {footerNote ? <View style={{ marginBottom: spacing.md }}>{footerNote}</View> : null}
            <Button title={primaryLabel} size="lg" fullWidth onPress={onPrimary} disabled={primaryDisabled} loading={primaryLoading} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  column: { flex: 1, width: '100%' },
  columnDesktop: { maxWidth: 560, alignSelf: 'center', paddingTop: spacing['3xl'] },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing['2xl'], paddingVertical: spacing.lg },
  skipSlot: { width: 48, alignItems: 'flex-end' },
  scroll: { flexGrow: 1, paddingHorizontal: spacing['2xl'], paddingBottom: spacing['2xl'] },
  footer: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.lg, paddingBottom: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
});
