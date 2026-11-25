import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { gradients, palette } from '@/theme/tokens';
import { initials } from '@/utils/format';

export interface AvatarProps {
  uri?: string | null;
  name?: string | null;
  size?: number;
  /** Gradient story ring around the avatar. */
  ring?: boolean;
  online?: boolean | null;
  verified?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Avatar({ uri, name, size = 44, ring = false, online, verified, style }: AvatarProps) {
  const { colors } = useTheme();
  const ringWidth = ring ? Math.max(2, Math.round(size * 0.05)) : 0;
  const gap = ring ? Math.max(2, Math.round(size * 0.04)) : 0;
  const inner = size - 2 * (ringWidth + gap);
  const fontSize = Math.max(10, Math.round(inner * 0.38));
  const dot = Math.max(8, Math.round(size * 0.24));
  const badge = Math.max(14, Math.round(size * 0.3));

  const image = uri ? (
    <Image
      source={{ uri }}
      style={{ width: inner, height: inner, borderRadius: inner / 2 }}
      contentFit="cover"
      transition={150}
      cachePolicy="memory-disk"
      accessibilityLabel={name ? `${name}'s profile picture` : 'Profile picture'}
    />
  ) : (
    <LinearGradient
      colors={[...gradients.cool]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: inner, height: inner, borderRadius: inner / 2, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text variant="h4" color={palette.white} style={{ fontSize, lineHeight: fontSize * 1.2 }}>
        {initials(name)}
      </Text>
    </LinearGradient>
  );

  return (
    <View style={[{ width: size, height: size }, style]}>
      {ring ? (
        <LinearGradient
          colors={[...gradients.ring]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
        />
      ) : null}
      <View
        style={{
          position: 'absolute',
          top: ringWidth,
          left: ringWidth,
          width: size - ringWidth * 2,
          height: size - ringWidth * 2,
          borderRadius: (size - ringWidth * 2) / 2,
          backgroundColor: colors.background,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {image}
      </View>
      {online ? (
        <View
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: palette.success,
            borderWidth: 2,
            borderColor: colors.background,
          }}
        />
      ) : null}
      {verified ? (
        <View
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: badge,
            height: badge,
            borderRadius: badge / 2,
            backgroundColor: palette.blue,
            borderWidth: 2,
            borderColor: colors.background,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="checkmark" size={Math.round(badge * 0.6)} color={palette.white} />
        </View>
      ) : null}
    </View>
  );
}
