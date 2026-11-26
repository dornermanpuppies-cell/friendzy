import * as Clipboard from 'expo-clipboard';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, monospace' });

/** 60-digit security code rendered as 4 rows of 3 groups; tap to copy. */
export function Fingerprint({ value, compact }: { value: string | null; compact?: boolean }) {
  const { colors } = useTheme();
  const toast = useToast();
  if (!value) {
    return (
      <Text variant="caption" color="textMuted">
        Not available yet.
      </Text>
    );
  }
  const groups = value.split(' ');
  const rows = [0, 1, 2, 3].map((r) => groups.slice(r * 3, r * 3 + 3));
  return (
    <Pressable
      onPress={async () => {
        await Clipboard.setStringAsync(value);
        toast.success('Security code copied');
      }}
      accessibilityRole="button"
      accessibilityLabel="Copy security code"
      style={[styles.box, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }, compact && { paddingVertical: spacing.xs }]}
    >
      {rows.map((row, i) => (
        <Text key={i} style={[styles.line, { fontFamily: MONO, color: colors.text, fontSize: compact ? 12 : 14 }]}>
          {row.join('   ')}
        </Text>
      ))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignItems: 'center' },
  line: { letterSpacing: 1, lineHeight: 22 },
});
