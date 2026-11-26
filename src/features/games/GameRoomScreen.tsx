import { Ionicons } from '@/components/ui/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { createRematch, EngineError, engineAction, getGameMessages, getGameRoom, inviteToGame, leaveGameRoom, sendGameMessage, setGameReady, subscribeToGameRoom } from '@/services/games';
import { listFriends } from '@/services/profiles';
import { useAuth } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { GameMessage, GameRoom } from '@/types/games';
import { getErrorMessage } from '@/utils/errors';
import { timeAgo } from '@/utils/format';

import { ChessBoard } from './ChessBoard';
import { LudoBoard } from './LudoBoard';
import { RoundsBoard } from './RoundsBoard';
import { TruthOrDareBoard } from './TruthOrDareBoard';

function confirm(title: string, message: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Confirm', style: 'destructive', onPress: onConfirm },
  ]);
}

export function GameRoomScreen({ roomId }: { roomId: string }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [messages, setMessages] = useState<GameMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [text, setText] = useState('');
  const tickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const friends = useAsync(() => (user && inviteOpen ? listFriends(user.id, 50) : Promise.resolve([])), [user?.id, inviteOpen]);

  const refresh = useCallback(async () => {
    try {
      const next = await getGameRoom(roomId);
      if (!next) {
        setError('This room no longer exists.');
        return;
      }
      setRoom(next);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }, [roomId]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
    void getGameMessages(roomId).then(setMessages).catch(() => undefined);
    return subscribeToGameRoom(roomId, {
      onRoom: () => void refresh(),
      onMessage: () => {
        void getGameMessages(roomId).then((rows) => {
          setMessages(rows);
          setUnread((u) => (chatOpen ? 0 : u + 1));
        });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, refresh]);

  // Turn timeouts: whoever is online asks the engine to apply the timeout.
  useEffect(() => {
    if (tickRef.current) clearTimeout(tickRef.current);
    if (!room || room.status !== 'playing' || !room.turn_deadline) return;
    const delay = Math.max(500, new Date(room.turn_deadline).getTime() - Date.now() + 800);
    tickRef.current = setTimeout(() => {
      void engineAction('tick', roomId)
        .then((res) => res.room && setRoom(res.room))
        .catch(() => void refresh());
    }, delay);
    return () => {
      if (tickRef.current) clearTimeout(tickRef.current);
    };
  }, [room?.turn_deadline, room?.status, room?.version, roomId, refresh, room]);

  // `busy` only covers a move of mine that is in flight. Starting the game gets its own flag:
  // the board often appears through realtime before the start request has returned, and taps
  // made in that window must not be dropped.
  const act = async (action: 'start' | 'forfeit' | 'move', move?: Record<string, unknown>) => {
    if (!room) return;
    const setFlag = action === 'start' ? setStarting : setBusy;
    setFlag(true);
    try {
      const res = await engineAction(action, roomId, { move, version: action === 'move' ? room.version : undefined });
      if (res.room) setRoom((current) => (current && current.version > res.room.version ? current : res.room));
    } catch (e) {
      if (e instanceof EngineError && e.room) setRoom(e.room);
      if (!(e instanceof EngineError && e.code === 'STALE')) toast.error(getErrorMessage(e));
      else void refresh();
    } finally {
      setFlag(false);
    }
  };

  const leave = () => {
    if (!room) return;
    const playing = room.status === 'playing';
    confirm(playing ? 'Forfeit the game?' : 'Leave room?', playing ? 'Leaving a running game counts as a loss.' : 'You can rejoin while the room is waiting.', async () => {
      try {
        if (playing) await act('forfeit');
        await leaveGameRoom(roomId);
      } catch {
        /* ignore */
      }
      router.replace('/games');
    });
  };

  const send = async () => {
    if (!text.trim()) return;
    try {
      const m = await sendGameMessage(roomId, text.trim());
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      setText('');
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  if (error) {
    return (
      <Screen header={<ScreenHeader title="Game" fallbackHref="/games" />}>
        <EmptyState emoji="🎲" title="Room unavailable" description={error} action={{ title: 'Back to games', onPress: () => router.replace('/games') }} />
      </Screen>
    );
  }
  if (!room || !user) {
    return (
      <Screen header={<ScreenHeader title="Game" fallbackHref="/games" />}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing['3xl'] }} />
      </Screen>
    );
  }

  const joined = room.participants.filter((p) => p.state === 'joined');
  const me = room.participants.find((p) => p.id === user.id);
  const canStart = room.is_host && joined.length >= room.game_info.min_players && joined.filter((p) => p.id !== room.host.id).every((p) => p.is_ready);

  const board = () => {
    const props = { room, myId: user.id, busy, onMove: (move: Record<string, unknown>) => act('move', move) };
    switch (room.game) {
      case 'ludo':
        return <LudoBoard {...props} />;
      case 'chess':
        return <ChessBoard {...props} />;
      case 'truth_or_dare':
        return <TruthOrDareBoard {...props} />;
      default:
        return <RoundsBoard {...props} />;
    }
  };

  return (
    <Screen
      header={
        <ScreenHeader
          title={`${room.game_info.emoji} ${room.game_info.name}`}
          subtitle={room.status === 'waiting' ? `Waiting · ${joined.length}/${room.max_players}` : room.status === 'playing' ? `Round ${room.round}` : 'Finished'}
          fallbackHref="/games"
          right={
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <Pressable onPress={() => { setChatOpen(true); setUnread(0); }} style={styles.iconBtn} accessibilityLabel="Room chat">
                <Ionicons name="chatbubbles-outline" size={22} color={colors.text} />
                {unread > 0 ? <View style={styles.dot} /> : null}
              </Pressable>
              {room.status !== 'finished' && room.status !== 'cancelled' ? (
                <Pressable onPress={leave} style={styles.iconBtn} accessibilityLabel="Leave room">
                  <Ionicons name="exit-outline" size={22} color={colors.danger} />
                </Pressable>
              ) : null}
            </View>
          }
        />
      }
      scroll
      padded
    >
      {room.status === 'waiting' ? (
        <View style={{ paddingVertical: spacing.lg }}>
          <View style={[styles.codeCard, { backgroundColor: colors.surfaceMuted }]}>
            <View style={{ flex: 1 }}>
              <Text variant="caption" color="textMuted">
                ROOM CODE
              </Text>
              <Text variant="h2">{room.invite_code ?? '——————'}</Text>
            </View>
            <Button title="Copy" size="sm" variant="secondary" leftIcon="copy-outline" onPress={async () => { if (room.invite_code) { await Clipboard.setStringAsync(room.invite_code); toast.success('Code copied'); } }} />
            <Button title="Invite" size="sm" leftIcon="person-add-outline" onPress={() => setInviteOpen(true)} style={{ marginLeft: spacing.xs }} />
          </View>
          <Text variant="h4" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
            Players
          </Text>
          {room.participants.filter((p) => p.state !== 'left').map((p) => (
            <View key={p.id} style={[styles.playerRow, { borderBottomColor: colors.border }]}>
              <Avatar uri={p.avatar_url} name={p.display_name} size={40} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text variant="bodySemibold">
                  {p.display_name}
                  {p.id === room.host.id ? ' 👑' : ''}
                </Text>
                <Text variant="caption" color="textMuted">
                  {p.state === 'invited' ? 'Invited · waiting to join' : p.id === room.host.id ? 'Host' : p.is_ready ? 'Ready' : 'Not ready yet'}
                </Text>
              </View>
              {p.state === 'joined' && p.id !== room.host.id ? <Ionicons name={p.is_ready ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={p.is_ready ? colors.success : colors.textMuted} /> : null}
            </View>
          ))}
          {Array.from({ length: Math.max(0, room.max_players - room.participants.filter((p) => p.state !== 'left').length) }).map((_, i) => (
            <View key={`empty-${i}`} style={[styles.playerRow, { borderBottomColor: colors.border }]}>
              <View style={[styles.emptySeat, { borderColor: colors.border }]}>
                <Ionicons name="person-add-outline" size={18} color={colors.textMuted} />
              </View>
              <Text variant="small" color="textMuted" style={{ marginLeft: spacing.md }}>
                Open seat
              </Text>
            </View>
          ))}
          <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
            {room.is_host ? (
              <>
                <Button title={joined.length < room.game_info.min_players ? `Waiting for ${room.game_info.min_players - joined.length} more player${room.game_info.min_players - joined.length === 1 ? '' : 's'}` : canStart ? 'Start game' : 'Waiting for everyone to be ready'} leftIcon="play" onPress={() => void act('start')} disabled={!canStart || starting} loading={starting} glow fullWidth />
              </>
            ) : me?.state === 'joined' ? (
              <Button title={me.is_ready ? 'Ready ✓ (tap to undo)' : "I'm ready"} variant={me.is_ready ? 'secondary' : 'primary'} leftIcon={me.is_ready ? 'checkmark-done' : 'checkmark'} onPress={async () => { try { setRoom(await setGameReady(roomId, !me.is_ready)); } catch (e) { toast.error(getErrorMessage(e)); } }} fullWidth />
            ) : null}
            <Text variant="caption" color="textMuted" align="center">
              {room.game_info.turn_seconds}s per turn · results are validated by the Friendzy game server.
            </Text>
          </View>
        </View>
      ) : room.status === 'playing' ? (
        <View style={{ paddingVertical: spacing.lg }}>{board()}</View>
      ) : (
        <View style={{ paddingVertical: spacing.lg }}>
          <Text variant="h2" align="center">
            {room.status === 'cancelled' ? 'Game cancelled' : room.winner_id === user.id ? '🏆 You won!' : room.winner_id ? `${room.participants.find((p) => p.id === room.winner_id)?.display_name ?? 'Someone'} won` : "It's a draw"}
          </Text>
          <View style={{ marginTop: spacing.lg }}>
            {(room.results ?? []).map((r) => (
              <View key={r.user.id} style={[styles.playerRow, { borderBottomColor: colors.border }]}>
                <Text variant="h4" color={r.rank === 1 ? palette.gold : 'textMuted'} style={{ width: 36 }}>
                  #{r.rank}
                </Text>
                <Avatar uri={r.user.avatar_url} name={r.user.display_name} size={40} />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text variant="bodySemibold">{r.user.display_name}</Text>
                  <Text variant="caption" color="textMuted">
                    Score {r.score}
                  </Text>
                </View>
                <Text variant="smallMedium" color={r.rating_delta >= 0 ? 'success' : 'danger'}>
                  {r.rating_delta >= 0 ? '+' : ''}
                  {r.rating_delta}
                </Text>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl }}>
            {room.status === 'finished' ? <Button title="Rematch" leftIcon="refresh" onPress={async () => { try { const next = await createRematch(roomId); router.replace(`/games/room/${next.id}` as never); } catch (e) { toast.error(getErrorMessage(e)); } }} style={{ flex: 1 }} /> : null}
            <Button title="Back to games" variant="secondary" onPress={() => router.replace('/games')} style={{ flex: 1 }} />
          </View>
          <Button title="Leaderboard" variant="ghost" size="sm" leftIcon="podium-outline" onPress={() => router.navigate(`/games/leaderboard/${room.game}` as never)} style={{ alignSelf: 'center', marginTop: spacing.sm }} />
        </View>
      )}

      {/* Room chat */}
      <Sheet visible={chatOpen} onClose={() => setChatOpen(false)} title="Room chat">
        <ScrollView style={{ height: 320 }} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}>
          {messages.length === 0 ? (
            <Text variant="small" color="textMuted">
              Say hi to the other players 👋
            </Text>
          ) : (
            messages.map((m) => (
              <View key={m.id} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <Avatar uri={m.user?.avatar_url} name={m.user?.display_name} size={28} />
                <View style={{ flex: 1, marginLeft: spacing.sm }}>
                  <Text variant="caption" color="textMuted">
                    {m.user?.display_name ?? 'Player'} · {timeAgo(m.created_at)}
                  </Text>
                  <Text variant="body">{m.text}</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <TextInput value={text} onChangeText={setText} placeholder="Message…" placeholderTextColor={colors.placeholder} style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text }]} maxLength={300} onSubmitEditing={() => void send()} returnKeyType="send" />
          <Button title="Send" size="sm" onPress={() => void send()} disabled={!text.trim()} />
        </View>
      </Sheet>

      {/* Invite friends */}
      <Sheet visible={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite friends" subtitle={room.invite_code ? `Or share the code ${room.invite_code}` : undefined}>
        {friends.loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : !friends.data || friends.data.length === 0 ? (
          <EmptyState compact emoji="👥" title="No friends yet" description="Add friends on Friendzy to invite them directly, or share the room code." />
        ) : (
          friends.data.map((f) => (
            <View key={f.id} style={[styles.playerRow, { borderBottomColor: colors.border }]}>
              <Avatar uri={f.avatar_url} name={f.display_name} size={36} />
              <Text variant="smallMedium" style={{ flex: 1, marginLeft: spacing.md }}>
                {f.display_name}
              </Text>
              <Button title={room.participants.some((p) => p.id === f.id) ? 'Invited' : 'Invite'} size="sm" variant="ghost" disabled={room.participants.some((p) => p.id === f.id)} onPress={async () => { try { await inviteToGame(roomId, f.id); toast.success(`Invited ${f.display_name}`); await refresh(); } catch (e) { toast.error(getErrorMessage(e)); } }} />
            </View>
          ))
        )}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: palette.pink },
  codeCard: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, borderRadius: radius.lg },
  playerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  emptySeat: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, height: 42, borderRadius: radius.md, paddingHorizontal: spacing.md },
});
