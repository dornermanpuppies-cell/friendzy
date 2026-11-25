import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { gradients, palette, spacing } from '@/theme/tokens';

const TIPS = [
  'Looking for someone who shares your interests…',
  'Friendzy is worldwide — people are joining all the time.',
  'Your exact location is never shared with matches.',
  'You decide what happens next: chat, add as a friend, or skip.',
  'Blocked and skipped people are never shown to you again.',
];

const useNative = Platform.OS !== 'web';

export function MatchSearching({ avatarUrl, name, waited, searchingNow }: { avatarUrl: string | null; name: string; waited: number; searchingNow: number }) {
  const { colors } = useTheme();
  // Animated values are created once per mount (lazy state keeps them stable across renders).
  const [rings] = useState(() => [0, 1, 2].map(() => new Animated.Value(0)));
  const [spin] = useState(() => new Animated.Value(0));
  const [tip, setTip] = useState(0);

  useEffect(() => {
    const loops = rings.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 650),
          Animated.timing(value, { toValue: 1, duration: 2000, easing: Easing.out(Easing.quad), useNativeDriver: useNative }),
          Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: useNative }),
        ]),
      ),
    );
    const rotation = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 3200, easing: Easing.linear, useNativeDriver: useNative }));
    loops.forEach((l) => l.start());
    rotation.start();
    const timer = setInterval(() => setTip((t) => (t + 1) % TIPS.length), 3500);
    return () => {
      loops.forEach((l) => l.stop());
      rotation.stop();
      clearInterval(timer);
    };
  }, [rings, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.root} accessibilityRole="progressbar" accessibilityLabel="Searching for someone to meet">
      <View style={styles.stage}>
        {rings.map((value, i) => (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={[
              styles.ring,
              {
                borderColor: i % 2 === 0 ? palette.purple : palette.pink,
                opacity: value.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.55, 0] }),
                transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
              },
            ]}
          />
        ))}
        <Animated.View style={[styles.spinner, { transform: [{ rotate }] }]} pointerEvents="none">
          <LinearGradient colors={[palette.blue, palette.purple, palette.pink, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.spinnerGradient} />
        </Animated.View>
        <View style={[styles.avatarHole, { backgroundColor: colors.background }]}>
          <Avatar uri={avatarUrl} name={name} size={96} />
        </View>
      </View>
      <Text variant="h3" align="center" style={{ marginTop: spacing['2xl'] }}>
        Searching the world…
      </Text>
      <Text variant="body" color="textMuted" align="center" style={{ marginTop: spacing.xs, minHeight: 44 }}>
        {TIPS[tip]}
      </Text>
      <View style={styles.statsRow}>
        <LinearGradient colors={[...gradients.cool]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.statPill}>
          <Text variant="caption" color={palette.white}>
            {searchingNow > 0 ? `${searchingNow} ${searchingNow === 1 ? 'person' : 'people'} searching right now` : 'Waiting for someone to join'}
          </Text>
        </LinearGradient>
        <Text variant="caption" color="textMuted">
          {waited >= 60 ? `${Math.floor(waited / 60)}m ${waited % 60}s` : `${waited}s`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', paddingVertical: spacing['2xl'] },
  stage: { width: 260, height: 260, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 120, height: 120, borderRadius: 60, borderWidth: 2 },
  spinner: { position: 'absolute', width: 124, height: 124, borderRadius: 62, overflow: 'hidden' },
  spinnerGradient: { flex: 1, borderRadius: 62 },
  avatarHole: { width: 108, height: 108, borderRadius: 54, alignItems: 'center', justifyContent: 'center' },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  statPill: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 999 },
});
