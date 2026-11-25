import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ListItem } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Sheet } from '@/components/ui/Sheet';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { BannerRail } from '@/features/site/AnnouncementBar';
import { useAsync } from '@/hooks/useAsync';
import { createGameRoom, joinGameRoom, leaveGameRoom, listGameRooms, subscribeToGameInvites } from '@/services/games';
import { useAuth } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { GameInfo, GameRoom } from '@/types/games';
import { getErrorMessage } from '@/utils/errors';
import { timeAgo } from '@/utils/format';

function RoomRow({ room, action }: { room: GameRoom; action: React.ReactNode }) {
  const { colors } = useTheme();
  const joined = room.participants.filter((p) => p.state === 'joined').length;
  return (
    <View style={[styles.room, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text style={{ fontSize: 28 }}>{room.game_info.emoji}</Text>
      <View style={{ flex: 1, marginHorizontal: spacing.md }}>
        <Text variant="bodySemibold">
          {room.game_info.name}
          {room.is_private ? ' · Private' : ''}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
          <Avatar uri={room.host.avatar_url} name={room.host.display_name} size={18} />
          <Text variant="caption" color="textMuted" style={{ marginLeft: 4 }}>
            {room.host.display_name} · {joined}/{room.max_players} players · {room.status === 'playing' ? 'in progress' : timeAgo(room.created_at)}
          </Text>
        </View>
      </View>
      {action}
    </View>
  );
}

export default function GamesScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const toast = useToast();
  const lobby = useAsync(() => listGameRooms(), []);
  const [picked, setPicked] = useState<GameInfo | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void lobby.refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );
  useEffect(() => {
    if (!user) return;
    return subscribeToGameInvites(user.id, () => void lobby.refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const go = (room: GameRoom) => router.navigate(`/games/room/${room.id}` as never);

  const create = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      const room = await createGameRoom(picked.slug, isPrivate, maxPlayers);
      setPicked(null);
      go(room);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const join = async (params: { roomId?: string; code?: string }) => {
    setBusy(true);
    try {
      go(await joinGameRoom(params));
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const columns = width >= 900 ? 3 : 2;
  const data = lobby.data;

  return (
    <Screen header={<ScreenHeader title="Games" fallbackHref="/discover" right={<Button title="Leaderboards" size="sm" variant="ghost" leftIcon="podium-outline" onPress={() => router.navigate('/games/leaderboard/chess' as never)} />} />} scroll padded refreshing={lobby.refreshing} onRefresh={() => void lobby.refresh()}>
      <BannerRail placement="games" />
      {lobby.loading && !data ? (
        <SkeletonList count={6} />
      ) : lobby.error ? (
        <EmptyState icon="cloud-offline-outline" title="Couldn't load games" description={lobby.error} action={{ title: 'Retry', onPress: () => void lobby.reload(), variant: 'secondary' }} />
      ) : data ? (
        <>
          {data.mine.length > 0 ? (
            <>
              <Text variant="h4" style={styles.section}>
                Your games
              </Text>
              {data.mine.map((r) => (
                <RoomRow key={r.id} room={r} action={<Button title={r.status === 'playing' ? 'Resume' : 'Open'} size="sm" onPress={() => go(r)} />} />
              ))}
            </>
          ) : null}
          {data.invites.length > 0 ? (
            <>
              <Text variant="h4" style={styles.section}>
                Invitations
              </Text>
              {data.invites.map((r) => (
                <RoomRow key={r.id} room={r} action={<View style={{ flexDirection: 'row', gap: spacing.xs }}><Button title="Join" size="sm" onPress={() => void join({ roomId: r.id })} disabled={busy} /><Button title="Decline" size="sm" variant="ghost" onPress={async () => { await leaveGameRoom(r.id).catch(() => undefined); void lobby.refresh(); }} /></View>} />
              ))}
            </>
          ) : null}

          <Text variant="h4" style={styles.section}>
            Play together
          </Text>
          <View style={styles.grid}>
            {data.games.map((g) => (
              <Pressable key={g.slug} onPress={() => { setPicked(g); setMaxPlayers(null); setIsPrivate(false); }} style={[styles.gameCard, { width: `${100 / columns - 2}%`, backgroundColor: colors.surface, borderColor: colors.border }]} accessibilityLabel={`Play ${g.name}`}>
                <Text style={{ fontSize: 36 }}>{g.emoji}</Text>
                <Text variant="h4" style={{ marginTop: spacing.xs }}>
                  {g.name}
                </Text>
                <Text variant="caption" color="textMuted" numberOfLines={3}>
                  {g.description}
                </Text>
                <Text variant="caption" color="primary" style={{ marginTop: spacing.xs }}>
                  {g.min_players === g.max_players ? `${g.min_players} players` : `${g.min_players}–${g.max_players} players`}
                  {g.playing_now ? ` · ${g.playing_now} playing now` : ''}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text variant="h4" style={styles.section}>
            Join with a code
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
            <Input placeholder="6-letter room code" value={code} onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} autoCapitalize="characters" containerStyle={{ flex: 1 }} />
            <Button title="Join" onPress={() => void join({ code })} disabled={code.length !== 6 || busy} />
          </View>

          <Text variant="h4" style={styles.section}>
            Open rooms
          </Text>
          {data.open.length === 0 ? (
            <EmptyState compact emoji="🎲" title="No open rooms right now" description="Start a game and friends can join from this list or with your room code." />
          ) : (
            data.open.map((r) => <RoomRow key={r.id} room={r} action={<Button title="Join" size="sm" onPress={() => void join({ roomId: r.id })} disabled={busy} />} />)
          )}
        </>
      ) : null}

      <Sheet visible={Boolean(picked)} onClose={() => setPicked(null)} title={picked ? `${picked.emoji} ${picked.name}` : ''} subtitle={picked?.description} footer={<Button title="Create room" fullWidth onPress={() => void create()} loading={busy} leftIcon="add-circle-outline" />}>
        {picked ? (
          <View>
            {picked.max_players > picked.min_players ? (
              <>
                <Text variant="label" color="textMuted" style={{ marginBottom: spacing.xs }}>
                  Players
                </Text>
                <View style={styles.wrap}>
                  {Array.from({ length: picked.max_players - picked.min_players + 1 }).map((_, i) => {
                    const n = picked.min_players + i;
                    return <Chip key={n} label={`${n}`} size="sm" selected={(maxPlayers ?? picked.max_players) === n} onPress={() => setMaxPlayers(n)} />;
                  })}
                </View>
              </>
            ) : null}
            <ListItem icon={isPrivate ? 'lock-closed-outline' : 'globe-outline'} title={isPrivate ? 'Private room' : 'Public room'} subtitle={isPrivate ? 'Only people with the code or an invite can join' : 'Listed in open rooms for anyone to join'} switchValue={isPrivate} onSwitchChange={setIsPrivate} />
            <View style={[styles.rules, { backgroundColor: colors.surfaceMuted }]}>
              <Ionicons name="time-outline" size={16} color={colors.textMuted} />
              <Text variant="caption" color="textMuted" style={{ marginLeft: spacing.xs, flex: 1 }}>
                {picked.turn_seconds}s per turn · results are validated on the server and count towards the {picked.name} leaderboard.
              </Text>
            </View>
            <Button title={`${picked.name} leaderboard`} variant="ghost" size="sm" leftIcon="podium-outline" onPress={() => { setPicked(null); router.navigate(`/games/leaderboard/${picked.slug}` as never); }} style={{ alignSelf: 'flex-start', marginTop: spacing.sm }} />
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.xl, marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'space-between' },
  gameCard: { padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, minHeight: 150 },
  room: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, marginBottom: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  rules: { flexDirection: 'row', alignItems: 'center', padding: spacing.sm, borderRadius: radius.sm, marginTop: spacing.sm },
  unused: { color: palette.white },
});
