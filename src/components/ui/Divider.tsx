import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

export function Divider({ label, style }: { label?: string; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  if (!label) return <View style={[styles.line, { backgroundColor: colors.border }, style]} />;
  return (
    <View style={[styles.row, style]}>
      <View style={[styles.line, styles.flex, { backgroundColor: colors.border }]} />
      <Text variant="caption" color="textMuted" style={styles.label}>
        {label}
      </Text>
      <View style={[styles.line, styles.flex, { backgroundColor: colors.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  line: { height: StyleSheet.hairlineWidth, width: '100%' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, width: undefined },
  label: { marginHorizontal: spacing.md },
});
