import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { fontFamily, gradients, palette, shadows } from '@/theme/tokens';

export interface LogoProps {
  size?: number;
  /** Show the "Friendzy" wordmark next to the mark. */
  wordmark?: boolean;
  /** Force wordmark colour (defaults to theme text). */
  color?: string;
  style?: StyleProp<ViewStyle>;
}

/** Friendzy brand mark: gradient rounded square with a chat-bubble "F". */
export function Logo({ size = 36, wordmark = true, color, style }: LogoProps) {
  const { colors } = useTheme();
  const r = size * 0.3;
  return (
    <View style={[styles.row, style]}>
      <View style={[{ width: size, height: size, borderRadius: r, overflow: 'hidden' }, shadows.glow]}>
        <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, styles.center]}>
          <View style={{ position: 'absolute', right: size * 0.16, bottom: size * 0.16, width: size * 0.22, height: size * 0.22, borderRadius: size * 0.06, backgroundColor: 'rgba(255,255,255,0.35)', transform: [{ rotate: '45deg' }] }} />
          <Text style={{ fontFamily: fontFamily.display, fontWeight: '800', color: palette.white, fontSize: size * 0.58, lineHeight: size * 0.7, marginLeft: -size * 0.04 }}>
            F
          </Text>
        </LinearGradient>
      </View>
      {wordmark ? (
        <Text
          style={{
            fontFamily: fontFamily.display,
            fontWeight: '800',
            fontSize: size * 0.66,
            lineHeight: size * 0.8,
            letterSpacing: -size * 0.02,
            marginLeft: size * 0.28,
            color: color ?? colors.text,
          }}
        >
          Friendzy
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
