import { Ionicons } from '@/components/ui/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { type PropsWithChildren, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Logo } from '@/components/ui/Logo';
import { Text } from '@/components/ui/Text';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';

const HIGHLIGHTS = [
  { icon: 'people-outline', text: 'Meet people worldwide who share your interests' },
  { icon: 'chatbubbles-outline', text: 'Private and group chats, voice notes and calls' },
  { icon: 'radio-outline', text: 'Short videos, stories and interactive livestreams' },
  { icon: 'game-controller-outline', text: 'Play social games and support creators' },
] as const;

export interface AuthShellProps extends PropsWithChildren {
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  back?: boolean;
}

/** Shared frame for authentication screens: brand panel on desktop, compact on phones. */
export function AuthShell({ title, subtitle, footer, back = true, children }: AuthShellProps) {
  const { colors } = useTheme();
  const { isDesktop } = useBreakpoint();

  const form = (
    <View style={[styles.formColumn, isDesktop && styles.formColumnDesktop]}>
      <View style={styles.formHeader}>
        {back ? (
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={[styles.back, { backgroundColor: colors.surfaceMuted }]}
          >
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </Pressable>
        ) : (
          <View style={styles.back} />
        )}
        {!isDesktop ? <Logo size={28} /> : null}
        <View style={styles.back} />
      </View>
      <View style={styles.formBody}>
        <Text variant="h1">{title}</Text>
        {subtitle ? (
          <Text variant="body" color="textMuted" style={{ marginTop: spacing.sm }}>
            {subtitle}
          </Text>
        ) : null}
        <View style={{ marginTop: spacing['2xl'] }}>{children}</View>
        {footer ? <View style={{ marginTop: spacing['2xl'] }}>{footer}</View> : null}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
        {isDesktop ? (
          <View style={styles.split}>
            <LinearGradient colors={['#1B0B3E', palette.purpleDeep, palette.night]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.brandPanel}>
              <View style={styles.orbPink} />
              <View style={styles.orbBlue} />
              <Logo size={40} color={palette.white} />
              <View style={{ flex: 1, justifyContent: 'center' }}>
                <Text variant="hero" color={palette.white} style={{ maxWidth: 440 }}>
                  Meet. Connect. Play. Earn.
                </Text>
                <Text variant="bodyLg" color="rgba(255,255,255,0.78)" style={{ marginTop: spacing.lg, maxWidth: 420 }}>
                  Friendzy brings new friendships, real conversations and live entertainment together — one account across web, Android and iOS.
                </Text>
                <View style={{ marginTop: spacing['3xl'], gap: spacing.md }}>
                  {HIGHLIGHTS.map((h) => (
                    <View key={h.text} style={styles.highlight}>
                      <View style={styles.highlightIcon}>
                        <Ionicons name={h.icon} size={18} color={palette.white} />
                      </View>
                      <Text variant="body" color="rgba(255,255,255,0.9)">
                        {h.text}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
              <Text variant="small" color="rgba(255,255,255,0.5)">
                © {new Date().getFullYear()} Friendzy
              </Text>
            </LinearGradient>
            <ScrollView contentContainerStyle={styles.scrollDesktop} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {form}
            </ScrollView>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {form}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  split: { flex: 1, flexDirection: 'row' },
  brandPanel: { width: '46%', maxWidth: 620, padding: spacing['5xl'], justifyContent: 'space-between', overflow: 'hidden' },
  orbPink: { position: 'absolute', width: 420, height: 420, borderRadius: 210, backgroundColor: 'rgba(255,40,185,0.22)', top: -120, right: -160 },
  orbBlue: { position: 'absolute', width: 360, height: 360, borderRadius: 180, backgroundColor: 'rgba(39,107,255,0.25)', bottom: -140, left: -120 },
  highlight: { flexDirection: 'row', alignItems: 'center' },
  highlightIcon: { width: 34, height: 34, borderRadius: radius.sm + 2, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  scroll: { flexGrow: 1, paddingBottom: spacing['3xl'] },
  scrollDesktop: { flexGrow: 1, justifyContent: 'center', paddingVertical: spacing['4xl'] },
  formColumn: { flex: 1, width: '100%' },
  formColumnDesktop: { maxWidth: 480, alignSelf: 'center' },
  formHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, height: 56 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  formBody: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.lg },
});
