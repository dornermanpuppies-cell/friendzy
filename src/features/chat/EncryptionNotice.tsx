import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { palette, radius, spacing } from '@/theme/tokens';

/** The pill shown at the top of every conversation. Only states what is actually implemented. */
export function EncryptionNotice({ light, onPress }: { light: boolean; onPress: () => void }) {
  return (
    <View style={styles.row}>
      <Pressable onPress={onPress} style={[styles.pill, { backgroundColor: light ? 'rgba(112,0,255,0.08)' : 'rgba(255,255,255,0.1)' }]} accessibilityRole="button" accessibilityLabel="About end-to-end encryption">
        <Ionicons name="lock-closed" size={13} color={light ? palette.purple : palette.purpleSoft} style={{ marginRight: 6, marginTop: 1 }} />
        <Text variant="caption" style={{ color: light ? palette.ink2 : 'rgba(255,255,255,0.85)', flex: 1 }}>
          Messages in this chat are end-to-end encrypted. Only the people in it can read them — not even Friendzy. Tap to verify security codes.
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  pill: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, maxWidth: 420 },
});
