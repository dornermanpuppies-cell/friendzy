import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { GiftSheet } from '@/features/economy/GiftSheet';
import { FollowButton } from '@/features/profile/FollowButton';
import { LiveKitRoom, prepareAudio, releaseAudio } from '@/lib/livekit/room';
import { getLiveKitToken, type LiveKitCredentials } from '@/services/calls';
import { acceptLiveInvite, cancelLiveStageRequest, endLive, getLive, getLiveComments, getLiveSummary, joinLive, leaveLive, likeLive, liveHeartbeat, requestLiveStage, sendLiveComment, setLiveReminder, startLive, subscribeToLive } from '@/services/live';
import { useAuth } from '@/store/authStore';
import { palette, radius, spacing } from '@/theme/tokens';
import type { LiveComment, LiveGiftEvent, LiveSession, LiveSummary } from '@/types/live';
import type { AuthorCard } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';
import { formatCount, formatDate } from '@/utils/format';

import { LiveChatInput, LiveChatList } from './LiveChat';
import { FloatingHearts, LiveGiftOverlay } from './LiveGiftOverlay';
import { BattleSheet, CommentActionsSheet, FanClubSheet, HostControlsSheet, LiveSettingsSheet, ParticipantsSheet, RecipientSheet, ViewerMoreSheet, shareLive, type LiveSheetKind } from './LiveSheets';
import { LiveStage } from './LiveStage';

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

function elapsedLabel(startedAt: string | null, now: number): string {
  if (!startedAt) return '0:00';
  const s = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function RailButton({ icon, label, onPress, active }: { icon: keyof typeof Ionicons.glyphMap; label?: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} style={styles.railButton} accessibilityRole="button" accessibilityLabel={label ?? icon}>
      <View style={[styles.railCircle, active && { backgroundColor: palette.pink }]}>
        <Ionicons name={icon} size={22} color={palette.white} />
      </View>
      {label ? (
        <Text variant="caption" color={palette.white} style={{ marginTop: 2 }}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function LiveRoom({ liveId }: { liveId: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [live, setLive] = useState<LiveSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [credentialsFor, setCredentialsFor] = useState<{ key: string; creds: LiveKitCredentials } | null>(null);
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [giftQueue, setGiftQueue] = useState<LiveGiftEvent['gift'][]>([]);
  const [hearts, setHearts] = useState(0);
  const [summary, setSummary] = useState<LiveSummary | null>(null);
  const [sheet, setSheet] = useState<LiveSheetKind>(null);
  const [giftFor, setGiftFor] = useState<AuthorCard | null>(null);
  const [commentAction, setCommentAction] = useState<LiveComment | null>(null);
  const [now, setNow] = useState(Date.now());
  const [starting, setStarting] = useState(false);
  const joinedRef = useRef(false);
  const likeBuffer = useRef(0);
  const likeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getLive(liveId);
      if (!next) {
        setError('This live is not available.');
        return;
      }
      setLive(next);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }, [liveId]);

  const loadComments = useCallback(async () => {
    try {
      const rows = await getLiveComments(liveId, null, 80);
      setComments(rows.reverse());
    } catch {
      /* ignore */
    }
  }, [liveId]);

  const scheduleCommentReload = useCallback(() => {
    if (commentTimer.current) return;
    commentTimer.current = setTimeout(() => {
      commentTimer.current = null;
      void loadComments();
    }, 350);
  }, [loadComments]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      void refresh();
      void loadComments();
    });
    return subscribeToLive(liveId, {
      onSession: () => void refresh(),
      onComment: scheduleCommentReload,
      onParticipants: () => void refresh(),
      onGift: (event) => setGiftQueue((q) => [...q, event.gift]),
      onBattle: () => void refresh(),
    });
  }, [liveId, refresh, loadComments, scheduleCommentReload]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const status = live?.status;
  const isHost = Boolean(live?.is_host);
  const canPublish = isHost || live?.my_state === 'on_stage';

  // Viewers join + everyone heartbeats while the live is running.
  useEffect(() => {
    if (!live || status !== 'live') return;
    let cancelled = false;
    if (!isHost && !joinedRef.current) {
      void joinLive(liveId)
        .then((joined) => {
          joinedRef.current = true;
          if (!cancelled) setLive(joined);
        })
        .catch((e) => setError(getErrorMessage(e)));
    }
    const timer = setInterval(() => void liveHeartbeat(liveId), 25_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [live?.id, status, isHost, liveId, live]);

  // Leave + release audio on unmount.
  useEffect(() => {
    return () => {
      if (joinedRef.current) void leaveLive(liveId).catch(() => undefined);
      void releaseAudio();
    };
  }, [liveId]);

  // Media token (re-minted when publish permission changes, e.g. approved on stage).
  const eligible = status === 'live' || (isHost && status === 'preparing');
  const roomName = live?.room_name ?? null;
  const credKey = roomName && eligible ? `${roomName}:${canPublish ? 'pub' : 'sub'}` : null;
  const credentials = credKey && credentialsFor?.key === credKey ? credentialsFor.creds : null;
  useEffect(() => {
    if (!credKey || !roomName || credentials) return;
    let cancelled = false;
    (async () => {
      try {
        if (canPublish) await prepareAudio(true);
        const creds = await getLiveKitToken(roomName);
        if (!cancelled) setCredentialsFor({ key: credKey, creds });
      } catch (e) {
        if (!cancelled) toast.error(getErrorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [credKey, roomName, credentials, canPublish, toast]);

  const like = () => {
    setHearts((h) => h + 1);
    likeBuffer.current += 1;
    if (!likeTimer.current) {
      likeTimer.current = setTimeout(() => {
        const n = likeBuffer.current;
        likeBuffer.current = 0;
        likeTimer.current = null;
        void likeLive(liveId, n).catch(() => undefined);
      }, 1200);
    }
  };

  const sendComment = async (text: string) => {
    try {
      const created = await sendLiveComment(liveId, text);
      setComments((prev) => (prev.some((c) => c.id === created.id) ? prev : [...prev, created]));
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const start = async () => {
    setStarting(true);
    try {
      setLive(await startLive(liveId));
      toast.success("You're live!", 'Your followers have been notified.');
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  const end = () =>
    confirm('End live?', 'Your viewers will be disconnected and a summary is saved to your live history.', async () => {
      try {
        await endLive(liveId);
        const s = await getLiveSummary(liveId);
        setSummary(s);
        void refresh();
      } catch (e) {
        toast.error(getErrorMessage(e));
      }
    });

  const leave = async () => {
    if (joinedRef.current) {
      joinedRef.current = false;
      await leaveLive(liveId).catch(() => undefined);
    }
    if (router.canGoBack()) router.back();
    else router.replace('/live');
  };

  const openGift = () => {
    if (!live) return;
    if (live.stage.length > 0) setSheet('recipient');
    else {
      setGiftFor(live.host);
    }
  };

  const bottomInset = insets.bottom + spacing.md;
  const canModerate = Boolean(live && (live.is_host || live.is_moderator));

  // ---------------------------------------------------------------- states
  if (error) {
    return (
      <View style={[styles.root, styles.center]}>
        <StatusBar style="light" />
        <Ionicons name="radio-outline" size={48} color="rgba(255,255,255,0.6)" />
        <Text variant="h3" color={palette.white} align="center" style={{ marginTop: spacing.lg }}>
          Live unavailable
        </Text>
        <Text variant="body" color="rgba(255,255,255,0.75)" align="center" style={{ marginTop: spacing.sm, maxWidth: 360 }}>
          {error}
        </Text>
        <Button title="Back to LIVE" variant="secondary" onPress={() => router.replace('/live')} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }
  if (!live) {
    return (
      <View style={[styles.root, styles.center]}>
        <StatusBar style="light" />
        <ActivityIndicator color={palette.white} />
      </View>
    );
  }

  if (summary || status === 'ended' || status === 'cancelled') {
    const s = summary;
    return (
      <View style={[styles.root, styles.center, { padding: spacing['2xl'] }]}>
        <StatusBar style="light" />
        {live.cover_url ? <Image source={{ uri: live.cover_url }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={30} /> : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(9,8,23,0.8)' }]} />
        <Avatar uri={live.host.avatar_url} name={live.host.display_name} size={96} ring />
        <Text variant="h2" color={palette.white} align="center" style={{ marginTop: spacing.lg }}>
          {isHost ? 'Live ended' : `${live.host.display_name}'s live has ended`}
        </Text>
        <Text variant="body" color="rgba(255,255,255,0.75)" align="center" style={{ marginTop: spacing.xs }}>
          {live.title}
        </Text>
        <View style={styles.summaryGrid}>
          {[
            { label: 'Duration', value: s ? elapsedLabel(new Date(now - s.duration_seconds * 1000).toISOString(), now) : elapsedLabel(live.started_at, live.ended_at ? new Date(live.ended_at).getTime() : now) },
            { label: 'Peak viewers', value: formatCount(live.peak_viewers) },
            { label: 'Total views', value: formatCount(live.total_views) },
            { label: 'Likes', value: formatCount(live.likes_count) },
            { label: 'Gifts', value: `${formatCount(live.gifts_count)} · ${formatCount(live.gifts_coins)} coins` },
            ...(s ? [{ label: 'New followers', value: formatCount(s.new_followers) }, { label: 'Unique viewers', value: formatCount(s.unique_viewers) }] : []),
          ].map((item) => (
            <View key={item.label} style={styles.summaryCell}>
              <Text variant="h4" color={palette.white}>
                {item.value}
              </Text>
              <Text variant="caption" color="rgba(255,255,255,0.7)">
                {item.label}
              </Text>
            </View>
          ))}
        </View>
        {s && s.top_gifters.length > 0 ? (
          <View style={{ marginTop: spacing.lg, width: '100%', maxWidth: 420 }}>
            <Text variant="smallMedium" color={palette.white}>
              Top supporters
            </Text>
            {s.top_gifters.map((g) => (
              <View key={g.user.id} style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm }}>
                <Avatar uri={g.user.avatar_url} name={g.user.display_name} size={28} />
                <Text variant="small" color={palette.white} style={{ marginLeft: spacing.sm, flex: 1 }}>
                  {g.user.display_name}
                </Text>
                <Text variant="small" color={palette.gold}>
                  {formatCount(g.coins)} coins
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing['2xl'] }}>
          {!isHost ? <FollowButton targetId={live.host.id} state={live.following_host ? 'following' : 'none'} isPrivate={live.host.is_private} /> : null}
          <Button title={isHost ? 'Done' : 'Browse lives'} variant="secondary" onPress={() => router.replace('/live')} />
        </View>
      </View>
    );
  }

  if (status === 'scheduled') {
    const when = live.scheduled_at ? new Date(live.scheduled_at).getTime() : now;
    const diff = Math.max(0, when - now);
    const countdown = diff > 3600_000 ? `${Math.floor(diff / 3600_000)}h ${Math.floor((diff % 3600_000) / 60_000)}m` : `${Math.floor(diff / 60_000)}m ${Math.floor((diff % 60_000) / 1000)}s`;
    return (
      <View style={[styles.root, styles.center, { padding: spacing['2xl'] }]}>
        <StatusBar style="light" />
        {live.cover_url ? <Image source={{ uri: live.cover_url }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={20} /> : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(9,8,23,0.75)' }]} />
        <Pressable onPress={() => void leave()} style={[styles.close, { top: insets.top + spacing.sm }]} accessibilityLabel="Close">
          <Ionicons name="close" size={22} color={palette.white} />
        </Pressable>
        <Avatar uri={live.host.avatar_url} name={live.host.display_name} size={96} ring />
        <Text variant="caption" color={palette.pinkSoft} style={{ marginTop: spacing.lg }}>
          SCHEDULED LIVE
        </Text>
        <Text variant="h2" color={palette.white} align="center">
          {live.title}
        </Text>
        <Text variant="body" color="rgba(255,255,255,0.8)" align="center" style={{ marginTop: spacing.xs }}>
          {live.host.display_name} · {formatDate(live.scheduled_at, 'EEE d MMM, HH:mm')}
        </Text>
        <Text variant="h1" color={palette.white} style={{ marginTop: spacing.xl }}>
          {diff > 0 ? countdown : 'Starting soon'}
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing['2xl'] }}>
          {isHost ? (
            <Button title="Start now" leftIcon="radio-outline" glow onPress={() => void start()} loading={starting} />
          ) : (
            <Button title={live.reminder_set ? 'Reminder on' : 'Remind me'} leftIcon={live.reminder_set ? 'notifications' : 'notifications-outline'} variant={live.reminder_set ? 'secondary' : 'primary'} onPress={async () => { try { await setLiveReminder(live.id, !live.reminder_set); await refresh(); } catch (e) { toast.error(getErrorMessage(e)); } }} />
          )}
          <Button title="Share" variant="secondary" leftIcon="share-social-outline" onPress={() => void shareLive(live, toast)} />
        </View>
      </View>
    );
  }

  const battle = live.battle && live.battle.status === 'active' ? live.battle : null;
  const battleTotal = battle ? Math.max(1, battle.host_score + battle.opponent_score) : 1;
  const battleLeft = battle ? Math.max(0, Math.floor((new Date(battle.ends_at).getTime() - now) / 1000)) : 0;
  const commentDisabled = !live.allow_comments ? 'Comments are off for this live' : live.my_state === 'removed' ? 'You cannot comment in this live' : null;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {credentials ? (
        <LiveKitRoom
          serverUrl={credentials.url}
          token={credentials.token}
          connect
          audio={canPublish}
          video={canPublish}
          options={{ adaptiveStream: true, dynacast: true }}
          onDisconnected={() => {
            setCredentialsFor(null);
            if (status === 'live') void refresh();
          }}
          onError={(e) => toast.error(getErrorMessage(e))}
        >
          <LiveStage live={live} myId={user?.id} canPublish={canPublish} bottomInset={bottomInset} />
        </LiveKitRoom>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          {live.cover_url ? <Image source={{ uri: live.cover_url }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={12} /> : null}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(9,8,23,0.55)' }]} />
          <ActivityIndicator color={palette.white} />
          <Text variant="small" color="rgba(255,255,255,0.8)" style={{ marginTop: spacing.sm }}>
            {status === 'preparing' && !isHost ? 'The host is getting ready…' : 'Connecting to the live…'}
          </Text>
        </View>
      )}

      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.55)', 'transparent']} style={styles.topShade} />
      <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.7)']} style={styles.bottomShade} />

      {/* Top bar */}
      <View style={[styles.topBar, { top: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.navigate(`/u/${live.host.username}` as never)} style={styles.hostPill} accessibilityLabel="Host profile">
          <Avatar uri={live.host.avatar_url} name={live.host.display_name} size={32} />
          <View style={{ marginLeft: spacing.sm, maxWidth: 130 }}>
            <Text variant="smallMedium" color={palette.white} numberOfLines={1}>
              {live.host.display_name}
            </Text>
            <Text variant="caption" color="rgba(255,255,255,0.75)" numberOfLines={1}>
              {formatCount(live.likes_count)} likes
            </Text>
          </View>
          {!isHost ? <View style={{ marginLeft: spacing.sm }}><FollowButton targetId={live.host.id} state={live.following_host ? 'following' : 'none'} isPrivate={live.host.is_private} /></View> : null}
        </Pressable>
        <View style={{ flex: 1 }} />
        <View style={styles.liveBadge}>
          <Text variant="caption" color={palette.white}>
            {status === 'preparing' ? 'PREVIEW' : 'LIVE'}
          </Text>
        </View>
        <Pressable onPress={() => setSheet('viewers')} style={styles.viewersPill} accessibilityLabel="Viewers">
          <Ionicons name="eye" size={14} color={palette.white} />
          <Text variant="caption" color={palette.white} style={{ marginLeft: 4 }}>
            {formatCount(live.viewers_count)}
          </Text>
        </Pressable>
        <Pressable onPress={() => (isHost ? end() : void leave())} style={styles.closeInline} accessibilityLabel={isHost ? 'End live' : 'Leave live'}>
          <Ionicons name="close" size={22} color={palette.white} />
        </Pressable>
      </View>
      <View style={[styles.subBar, { top: insets.top + spacing.sm + 48 }]}>
        <Text variant="caption" color="rgba(255,255,255,0.85)" numberOfLines={1} style={{ flex: 1 }}>
          {live.title} · {elapsedLabel(live.started_at, now)}
        </Text>
      </View>

      {battle ? (
        <View style={[styles.battle, { top: insets.top + spacing.sm + 76 }]}>
          <View style={styles.battleRow}>
            <Text variant="smallMedium" color={palette.white} numberOfLines={1} style={{ flex: 1 }}>
              {battle.host.display_name} {formatCount(battle.host_score)}
            </Text>
            <Text variant="caption" color={palette.gold}>
              ⚔️ {Math.floor(battleLeft / 60)}:{String(battleLeft % 60).padStart(2, '0')}
            </Text>
            <Text variant="smallMedium" color={palette.white} numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>
              {formatCount(battle.opponent_score)} {battle.opponent.display_name}
            </Text>
          </View>
          <View style={styles.battleBar}>
            <View style={[styles.battleFill, { flex: battle.host_score / battleTotal || 0.5, backgroundColor: palette.pink }]} />
            <View style={[styles.battleFill, { flex: battle.opponent_score / battleTotal || 0.5, backgroundColor: palette.blue }]} />
          </View>
        </View>
      ) : null}

      <LiveGiftOverlay queue={giftQueue} onConsumed={() => setGiftQueue((q) => q.slice(1))} top={insets.top + spacing.sm + (battle ? 130 : 84)} />
      <FloatingHearts burst={hearts} bottom={bottomInset + 120} />

      {/* Invitation banner */}
      {live.my_state === 'invited' ? (
        <View style={[styles.invite, { bottom: bottomInset + 300 }]}>
          <Text variant="smallMedium" color={palette.white} style={{ flex: 1 }}>
            {live.host.display_name} invited you on stage
          </Text>
          <Button title="Join" size="sm" onPress={async () => { try { await acceptLiveInvite(liveId); await refresh(); } catch (e) { toast.error(getErrorMessage(e)); } }} />
        </View>
      ) : null}

      {/* Right rail */}
      <View style={[styles.rail, { bottom: bottomInset + 70 }]}>
        {!isHost ? <RailButton icon="heart" label={formatCount(live.likes_count)} onPress={like} /> : null}
        <RailButton icon="gift" label="Gift" onPress={openGift} />
        <RailButton icon="share-social" label="Share" onPress={() => void shareLive(live, toast)} />
        {!isHost && live.allow_guests && status === 'live' ? (
          live.my_state === 'on_stage' ? null : live.my_state === 'requested' ? (
            <RailButton icon="hand-right" label="Requested" active onPress={async () => { await cancelLiveStageRequest(liveId).catch(() => undefined); await refresh(); }} />
          ) : (
            <RailButton icon="hand-right-outline" label="Join stage" onPress={async () => { try { await requestLiveStage(liveId); await refresh(); toast.success('Request sent to the host'); } catch (e) { toast.error(getErrorMessage(e)); } }} />
          )
        ) : null}
        {isHost || live.is_moderator ? <RailButton icon="options" label={isHost ? 'Controls' : 'Moderate'} onPress={() => setSheet(isHost ? 'controls' : 'requests')} active={live.pending_requests > 0} /> : <RailButton icon="ellipsis-horizontal" onPress={() => setSheet('more')} />}
      </View>

      {/* Chat */}
      <View style={[styles.chat, { bottom: bottomInset }]}>
        {live.pinned_comment ? (
          <View style={styles.pinned}>
            <Ionicons name="pin" size={12} color={palette.gold} />
            <Text variant="caption" color={palette.white} numberOfLines={2} style={{ marginLeft: 4, flex: 1 }}>
              {live.pinned_comment.user?.display_name}: {live.pinned_comment.text}
            </Text>
          </View>
        ) : null}
        <LiveChatList comments={comments} onLongPress={canModerate ? setCommentAction : undefined} />
        {status === 'live' ? <LiveChatInput onSend={sendComment} disabledReason={commentDisabled} slowModeSeconds={live.slow_mode_seconds} /> : null}
      </View>

      {/* Host preview overlay */}
      {isHost && status === 'preparing' ? (
        <View style={[styles.preparing, { bottom: bottomInset + 60 }]}>
          <Text variant="small" color="rgba(255,255,255,0.85)" align="center">
            Check your camera and mic. Followers are notified when you start.
          </Text>
          <Button title="Start LIVE" leftIcon="radio" glow onPress={() => void start()} loading={starting} style={{ marginTop: spacing.sm }} />
          <Button title="Cancel" variant="ghost" size="sm" onPress={() => confirm('Discard this live?', 'The draft broadcast will be cancelled.', async () => { await endLive(liveId).catch(() => undefined); router.replace('/live'); })} style={{ marginTop: spacing.xs }} />
        </View>
      ) : null}

      {/* Sheets */}
      <GiftSheet visible={Boolean(giftFor)} onClose={() => setGiftFor(null)} targetType="live" targetId={live.id} recipient={giftFor} liveRecipientId={giftFor && giftFor.id !== live.host.id ? giftFor.id : null} />
      <RecipientSheet live={live} visible={sheet === 'recipient'} onClose={() => setSheet(null)} onPick={(p) => { setSheet(null); setGiftFor(p); }} />
      <HostControlsSheet live={live} visible={sheet === 'controls'} onClose={() => setSheet(null)} onOpen={setSheet} onEnd={() => { setSheet(null); end(); }} />
      <ParticipantsSheet live={live} mode={sheet === 'requests' ? 'requests' : sheet === 'stage' ? 'stage' : 'viewers'} visible={sheet === 'viewers' || sheet === 'requests' || sheet === 'stage'} onClose={() => setSheet(null)} onChanged={() => void refresh()} />
      <LiveSettingsSheet live={live} visible={sheet === 'settings'} onClose={() => setSheet(null)} onChanged={setLive} />
      <BattleSheet live={live} visible={sheet === 'battle'} onClose={() => setSheet(null)} onChanged={setLive} />
      <FanClubSheet creator={live.host} visible={sheet === 'fanclub'} onClose={() => setSheet(null)} />
      <ViewerMoreSheet live={live} visible={sheet === 'more'} onClose={() => setSheet(null)} onOpen={setSheet} />
      <CommentActionsSheet live={live} comment={commentAction} onClose={() => setCommentAction(null)} onDone={() => { void loadComments(); void refresh(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.night },
  center: { alignItems: 'center', justifyContent: 'center' },
  topShade: { position: 'absolute', left: 0, right: 0, top: 0, height: 160 },
  bottomShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 320 },
  topBar: { position: 'absolute', left: spacing.md, right: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hostPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: radius.full, padding: 4, paddingRight: spacing.sm },
  liveBadge: { backgroundColor: palette.danger, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  viewersPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  closeInline: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', right: spacing.md, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  subBar: { position: 'absolute', left: spacing.md, right: 110, flexDirection: 'row', alignItems: 'center' },
  battle: { position: 'absolute', left: spacing.md, right: spacing.md, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: radius.md, padding: spacing.sm },
  battleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  battleBar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 6 },
  battleFill: { height: 6 },
  invite: { position: 'absolute', left: spacing.md, right: 80, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(112,0,255,0.85)', borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  rail: { position: 'absolute', right: spacing.sm, alignItems: 'center', gap: spacing.sm },
  railButton: { alignItems: 'center', width: 56 },
  railCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  chat: { position: 'absolute', left: spacing.md, right: 72, gap: spacing.sm },
  pinned: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,200,87,0.25)', borderRadius: radius.md, padding: spacing.sm },
  preparing: { position: 'absolute', left: spacing.lg, right: spacing.lg, alignItems: 'center', backgroundColor: 'rgba(9,8,23,0.7)', borderRadius: radius.xl, padding: spacing.lg },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.md, marginTop: spacing.xl, maxWidth: 480 },
  summaryCell: { width: 120, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: radius.md, padding: spacing.md },
});
