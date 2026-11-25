import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Text } from '@/components/ui/Text';
import { palette, radius, spacing } from '@/theme/tokens';
import type { LiveGiftEvent } from '@/types/live';

type Gift = LiveGiftEvent['gift'];

const TIER_SIZE: Record<string, number> = { basic: 40, rare: 56, epic: 72, legendary: 96 };

/**
 * Slide-in gift banners (one at a time) + big emoji burst for epic/legendary
 * gifts. The parent owns the queue; we always show its head and ask the parent
 * to drop it once the animation finished.
 */
export function LiveGiftOverlay({ queue, onConsumed, top }: { queue: Gift[]; onConsumed: () => void; top: number }) {
  const current = queue[0] ?? null;
  const slide = useRef(new Animated.Value(-320)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const onConsumedRef = useRef(onConsumed);
  onConsumedRef.current = onConsumed;

  useEffect(() => {
    if (!current) return;
    slide.setValue(-320);
    burst.setValue(0);
    const big = current.gift.tier === 'epic' || current.gift.tier === 'legendary';
    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(slide, { toValue: 0, duration: 350, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }),
        big ? Animated.timing(burst, { toValue: 1, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: true }) : Animated.delay(0),
      ]),
      Animated.delay(big ? 2600 : 1800),
      Animated.parallel([Animated.timing(slide, { toValue: -320, duration: 300, useNativeDriver: true }), Animated.timing(burst, { toValue: 0, duration: 300, useNativeDriver: true })]),
    ]);
    animation.start(({ finished }) => {
      if (finished) onConsumedRef.current();
    });
    return () => animation.stop();
  }, [current?.id, current, slide, burst]);

  if (!current) return null;
  const size = TIER_SIZE[current.gift.tier] ?? 40;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { top }]}>
      <Animated.View style={[styles.banner, { transform: [{ translateX: slide }] }]}>
        <Avatar uri={current.sender.avatar_url} name={current.sender.display_name} size={32} />
        <View style={{ marginLeft: spacing.sm, flex: 1 }}>
          <Text variant="smallMedium" color={palette.white} numberOfLines={1}>
            {current.sender.display_name}
          </Text>
          <Text variant="caption" color="rgba(255,255,255,0.85)" numberOfLines={1}>
            sent {current.gift.name}
            {current.receiver ? ` to ${current.receiver.display_name}` : ''}
          </Text>
        </View>
        <Text style={{ fontSize: 26 }}>{current.gift.emoji}</Text>
        <View style={styles.combo}>
          <Text variant="smallMedium" color={palette.gold}>
            ×{current.quantity}
          </Text>
        </View>
      </Animated.View>
      {current.gift.tier === 'epic' || current.gift.tier === 'legendary' ? (
        <Animated.View style={[styles.burst, { opacity: burst, transform: [{ scale: burst.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.4] }) }] }]}>
          <Text style={{ fontSize: size }}>{current.gift.emoji}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

interface Heart {
  id: number;
  x: number;
  anim: Animated.Value;
  emoji: string;
}

/** Floating hearts triggered by the like button (burst counter increments). */
export function FloatingHearts({ burst, bottom }: { burst: number; bottom: number }) {
  const [hearts, setHearts] = useState<Heart[]>([]);
  const [seen, setSeen] = useState(burst);
  if (burst !== seen) {
    // Derive a new heart from the incremented counter during render (no effect needed).
    setSeen(burst);
    const anim = new Animated.Value(0);
    const id = burst + Math.random();
    const emoji = ['❤️', '💜', '💖', '🩷', '🔥'][Math.floor(Math.random() * 5)];
    const heart: Heart = { id, x: Math.random() * 40 - 20, anim, emoji };
    setHearts((h) => [...h.slice(-12), heart]);
    Animated.timing(anim, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => setHearts((h) => h.filter((x) => x.id !== id)));
  }
  return (
    <View pointerEvents="none" style={[styles.hearts, { bottom }]}>
      {hearts.map((h) => (
        <Animated.Text key={h.id} style={{ position: 'absolute', right: 10 + h.x, fontSize: 26, opacity: h.anim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.9, 0] }), transform: [{ translateY: h.anim.interpolate({ inputRange: [0, 1], outputRange: [0, -260] }) }, { translateX: h.anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, h.x, -h.x] }) }] }}>
          {h.emoji}
        </Animated.Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { position: 'absolute', left: spacing.md, top: 0, width: 300, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(112,0,255,0.75)', borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  combo: { marginLeft: spacing.sm, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  burst: { position: 'absolute', alignSelf: 'center', top: 140 },
  hearts: { position: 'absolute', right: 0, width: 80, height: 300 },
});
