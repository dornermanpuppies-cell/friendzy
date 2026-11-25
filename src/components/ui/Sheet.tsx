import { Ionicons } from '@expo/vector-icons';
import { type PropsWithChildren, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, shadows, spacing } from '@/theme/tokens';

export interface SheetProps extends PropsWithChildren {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  footer?: ReactNode;
  /** Max height as a fraction of the window on mobile (default 0.9). */
  maxHeightFraction?: number;
  /** Prevent dismiss by tapping the backdrop. */
  dismissable?: boolean;
}

/** Bottom sheet on phones, centred dialog on desktop. */
export function Sheet({ visible, onClose, title, subtitle, footer, children, maxHeightFraction = 0.9, dismissable = true }: SheetProps) {
  const { colors } = useTheme();
  const { isDesktop, height } = useBreakpoint();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType={isDesktop ? 'fade' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.backdropHost, isDesktop && styles.center]}>
        <Pressable
          accessibilityLabel="Close"
          onPress={dismissable ? onClose : undefined}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
        />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={isDesktop ? undefined : styles.sheetHost} pointerEvents="box-none">
          <View
            style={[
              styles.panel,
              { backgroundColor: colors.backgroundElevated, maxHeight: height * maxHeightFraction },
              isDesktop ? [styles.dialog, shadows.md] : [styles.bottomSheet, { paddingBottom: insets.bottom + spacing.lg }],
            ]}
          >
            {!isDesktop ? <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} /> : null}
            {title ? (
              <View style={styles.header}>
                <View style={styles.headerTexts}>
                  <Text variant="h4">{title}</Text>
                  {subtitle ? (
                    <Text variant="small" color="textMuted" style={{ marginTop: 2 }}>
                      {subtitle}
                    </Text>
                  ) : null}
                </View>
                <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={[styles.close, { backgroundColor: colors.surfaceMuted }]}>
                  <Ionicons name="close" size={18} color={colors.text} />
                </Pressable>
              </View>
            ) : null}
            <View style={styles.body}>{children}</View>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdropHost: { flex: 1, justifyContent: 'flex-end' },
  center: { justifyContent: 'center', alignItems: 'center' },
  sheetHost: { justifyContent: 'flex-end' },
  panel: { overflow: 'hidden' },
  bottomSheet: { borderTopLeftRadius: radius['2xl'], borderTopRightRadius: radius['2xl'], paddingTop: spacing.sm },
  dialog: { width: 520, maxWidth: '92%', borderRadius: radius['2xl'], paddingTop: spacing.sm },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  headerTexts: { flex: 1 },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: spacing.xl, flexShrink: 1 },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
});
