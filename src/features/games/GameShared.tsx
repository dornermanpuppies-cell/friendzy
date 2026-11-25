import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { GameParticipant, GameRoom } from '@/types/games';

/** Seconds left until `deadline` (ticks every 500 ms; 0 when there is no deadline). */
export function useCountdown(deadline: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [deadline]);
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
}

export function PlayersStrip({ room, scores, turnUser, highlight }: { room: GameRoom; scores?: Record<string, number>; turnUser?: string | null; highlight?: Record<string, string> }) {
  const { colors } = useTheme();
  const players = room.participants.filter((p) => p.state !== 'invited');
  return (
    <View style={styles.strip}>
      {players.map((p) => {
        const active = turnUser === p.id;
        return (
          <View key={p.id} style={[styles.player, { borderColor: active ? colors.primary : 'transparent', backgroundColor: active ? colors.primarySoft : 'transparent', opacity: p.state === 'left' ? 0.4 : 1 }]}>
            <View>
              <Avatar uri={p.avatar_url} name={p.display_name} size={36} />
              {highlight?.[p.id] ? <View style={[styles.seatDot, { backgroundColor: highlight[p.id] }]} /> : null}
            </View>
            <Text variant="caption" numberOfLines={1} style={{ maxWidth: 72 }}>
              {p.display_name}
            </Text>
            {scores ? (
              <Text variant="smallMedium" color="primary">
                {scores[p.id] ?? 0}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export function TurnBanner({ label, seconds, total }: { label: string; seconds: number; total: number }) {
  const { colors } = useTheme();
  const fraction = total > 0 ? Math.min(1, seconds / total) : 0;
  return (
    <View style={[styles.banner, { backgroundColor: colors.surfaceMuted }]}>
      <Text variant="smallMedium" style={{ flex: 1 }} numberOfLines={1}>
        {label}
      </Text>
      <Text variant="smallMedium" color={seconds <= 5 ? 'danger' : 'textMuted'}>
        {seconds}s
      </Text>
      <View style={[styles.timer, { backgroundColor: colors.border }]}>
        <View style={[styles.timerFill, { width: `${fraction * 100}%`, backgroundColor: seconds <= 5 ? palette.danger : colors.primary }]} />
      </View>
    </View>
  );
}

export function participantById(room: GameRoom, id: string | null | undefined): GameParticipant | undefined {
  return room.participants.find((p) => p.id === id);
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  player: { alignItems: 'center', padding: spacing.xs, borderRadius: radius.md, borderWidth: 1.5, minWidth: 72 },
  seatDot: { position: 'absolute', right: -2, bottom: -2, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: palette.white },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, flexWrap: 'wrap' },
  timer: { width: '100%', height: 4, borderRadius: 2, overflow: 'hidden' },
  timerFill: { height: 4 },
});
