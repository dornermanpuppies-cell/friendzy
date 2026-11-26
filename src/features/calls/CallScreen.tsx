import { Ionicons } from '@/components/ui/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { LocalVideoTrack } from 'livekit-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { AudioRenderer, ConnectionState, flipCamera, isTrackReference, LiveKitRoom, prepareAudio, releaseAudio, setSpeakerphone, showAudioRoutePicker, supportsCameraFlip, Track, useConnectionState, useLocalParticipant, useParticipants, useTracks } from '@/lib/livekit/room';
import { answerCall, declineCall, getCall, getLiveKitToken, leaveCall, subscribeToCall, type CallRecord, type LiveKitCredentials } from '@/services/calls';
import { useAuth } from '@/store/authStore';
import { palette, radius, spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';

import { VideoTile } from './VideoTile';

const RING_TIMEOUT_MS = 45_000;

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function ControlButton({ icon, label, active, danger, onPress, disabled }: { icon: keyof typeof Ionicons.glyphMap; label: string; active?: boolean; danger?: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={styles.control} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.controlCircle, danger ? { backgroundColor: palette.danger } : active ? { backgroundColor: palette.white } : { backgroundColor: 'rgba(255,255,255,0.18)' }, disabled && { opacity: 0.4 }]}>
        <Ionicons name={icon} size={24} color={danger ? palette.white : active ? palette.ink : palette.white} />
      </View>
      <Text variant="caption" color="rgba(255,255,255,0.8)" style={{ marginTop: 6 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Everything rendered inside the LiveKit room context. */
function InCall({ call, onHangUp }: { call: CallRecord; onHangUp: () => void }) {
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const connection = useConnectionState();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], { onlySubscribed: false });
  const [speaker, setSpeaker] = useState(call.kind === 'video');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = call.started_at ? new Date(call.started_at).getTime() : Date.now();
    const timer = setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [call.started_at]);

  const videoTracks = tracks.filter(isTrackReference);
  const cards = call.participants;
  const cardFor = (identity: string) => cards.find((c) => c.user.id === identity)?.user;
  // Only the people invited to this call get a tile. Anything else in the LiveKit room
  // (server-side agents, recorders, a stale duplicate connection) is never shown.
  const remoteParticipants = participants.filter((p) => p.identity !== user?.id && Boolean(cardFor(p.identity)));
  const hiddenIdentities = participants.filter((p) => p.identity !== user?.id && !cardFor(p.identity)).map((p) => p.identity || '(empty)');

  const toggleMic = () => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => undefined);
  const toggleCam = () => localParticipant.setCameraEnabled(!isCameraEnabled).catch(() => undefined);
  const switchCamera = async () => {
    const publication = localParticipant.getTrackPublication(Track.Source.Camera);
    await flipCamera(publication?.track as LocalVideoTrack | undefined).catch(() => undefined);
  };
  const toggleSpeaker = async () => {
    if (Platform.OS === 'ios') {
      await showAudioRoutePicker();
      return;
    }
    const next = !speaker;
    setSpeaker(next);
    await setSpeakerphone(next);
  };

  const columns = remoteParticipants.length + 1 > 4 ? 3 : remoteParticipants.length + 1 > 1 ? 2 : 1;
  const tileWidth = (Math.min(width, 900) - spacing.md * (columns + 1)) / columns;
  const tileHeight = call.kind === 'video' ? tileWidth * (columns === 1 ? 1.4 : 1.1) : 160;

  const statusLabel =
    connection === ConnectionState.Connecting || connection === ConnectionState.Reconnecting
      ? connection === ConnectionState.Reconnecting
        ? 'Reconnecting…'
        : 'Connecting…'
      : call.status === 'ringing'
        ? 'Ringing…'
        : fmtDuration(elapsed);

  return (
    <View style={styles.flex}>
      <AudioRenderer />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text variant="h3" color={palette.white} numberOfLines={1}>
          {call.conversation.title ?? 'Call'}
        </Text>
        <Text variant="small" color="rgba(255,255,255,0.75)">
          {call.kind === 'video' ? 'Video call' : 'Voice call'} · {statusLabel}
        </Text>
      </View>

      <View style={styles.grid}>
        {[localParticipant, ...remoteParticipants].map((p) => {
          const isMe = p.identity === user?.id;
          const track = videoTracks.find((t) => t.participant.identity === p.identity && t.source === Track.Source.Camera);
          const card = isMe ? undefined : cardFor(p.identity);
          const name = isMe ? 'You' : (card?.display_name ?? p.name ?? 'Participant');
          const muted = isMe ? !isMicrophoneEnabled : !p.isMicrophoneEnabled;
          return (
            <View key={p.identity} testID={`call-tile:${isMe ? 'me' : 'remote'}:${p.identity}`} style={[styles.tile, { width: tileWidth, height: tileHeight }, p.isSpeaking && styles.tileSpeaking]}>
              {track && (isMe ? isCameraEnabled : p.isCameraEnabled) ? (
                <VideoTile trackRef={track} mirror={isMe} style={StyleSheet.absoluteFill} />
              ) : (
                <View style={styles.tilePlaceholder}>
                  <Avatar uri={isMe ? undefined : card?.avatar_url} name={name} size={Math.min(96, tileHeight * 0.45)} />
                </View>
              )}
              <View style={styles.tileLabel}>
                {muted ? <Ionicons name="mic-off" size={12} color={palette.white} style={{ marginRight: 4 }} /> : null}
                <Text variant="caption" color={palette.white} numberOfLines={1}>
                  {name}
                </Text>
              </View>
            </View>
          );
        })}
        {remoteParticipants.length === 0 && call.conversation.kind === 'direct' ? (
          <View style={[styles.tile, { width: tileWidth, height: tileHeight }]}>
            <View style={styles.tilePlaceholder}>
              <Avatar uri={call.conversation.avatar_url} name={call.conversation.title} size={Math.min(96, tileHeight * 0.45)} />
              <Text variant="small" color="rgba(255,255,255,0.75)" style={{ marginTop: spacing.sm }}>
                {call.status === 'ringing' ? 'Waiting for them to answer…' : 'Connecting…'}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      {hiddenIdentities.length ? <View testID={`call-hidden:${hiddenIdentities.join(',')}`} style={{ height: 0 }} /> : null}
      <View style={[styles.controls, { paddingBottom: insets.bottom + spacing.lg }]}>
        <ControlButton icon={isMicrophoneEnabled ? 'mic' : 'mic-off'} label={isMicrophoneEnabled ? 'Mute' : 'Unmute'} active={!isMicrophoneEnabled} onPress={toggleMic} />
        {call.kind === 'video' ? <ControlButton icon={isCameraEnabled ? 'videocam' : 'videocam-off'} label={isCameraEnabled ? 'Camera' : 'Camera off'} active={!isCameraEnabled} onPress={toggleCam} /> : null}
        {call.kind === 'video' && supportsCameraFlip ? <ControlButton icon="camera-reverse-outline" label="Flip" onPress={switchCamera} disabled={!isCameraEnabled} /> : null}
        {Platform.OS !== 'web' ? <ControlButton icon={speaker ? 'volume-high' : 'volume-medium'} label="Speaker" active={speaker} onPress={toggleSpeaker} /> : null}
        <ControlButton icon="call" label="End" danger onPress={onHangUp} />
      </View>
    </View>
  );
}

export function CallScreen({ callId }: { callId: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [call, setCall] = useState<CallRecord | null>(null);
  const [credentials, setCredentials] = useState<LiveKitCredentials | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const leftRef = useRef(false);
  const ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getCall(callId);
      if (!next) {
        setError('This call is no longer available.');
        return;
      }
      setCall(next);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }, [callId]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
    return subscribeToCall(callId, () => void refresh());
  }, [callId, refresh]);

  const joined = call?.my_state === 'joined';
  const finished = call ? ['ended', 'missed', 'declined', 'cancelled'].includes(call.status) : false;

  // Connect to media once we are a joined participant.
  useEffect(() => {
    if (!call || !joined || credentials || finished) return;
    let cancelled = false;
    (async () => {
      try {
        await prepareAudio(call.kind === 'video');
        const creds = await getLiveKitToken(call.room_name);
        if (!cancelled) setCredentials(creds);
      } catch (e) {
        if (!cancelled) setError(getErrorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [call, joined, credentials, finished]);

  // Caller: give up after the ring timeout.
  useEffect(() => {
    if (!call || !call.is_initiator || call.status !== 'ringing') return;
    ringTimer.current = setTimeout(() => {
      void leaveCall(callId, 'timeout').catch(() => undefined);
    }, RING_TIMEOUT_MS);
    return () => {
      if (ringTimer.current) clearTimeout(ringTimer.current);
    };
  }, [call?.status, call?.is_initiator, callId, call]);

  // Leave when the screen unmounts.
  useEffect(() => {
    return () => {
      if (!leftRef.current && joined) void leaveCall(callId).catch(() => undefined);
      void releaseAudio();
    };
  }, [callId, joined]);

  const hangUp = async () => {
    leftRef.current = true;
    try {
      await leaveCall(callId);
    } catch {
      /* ignore */
    }
    await releaseAudio();
    if (router.canGoBack()) router.back();
    else router.replace('/inbox');
  };

  const accept = async () => {
    setJoining(true);
    try {
      setCall(await answerCall(callId));
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setJoining(false);
    }
  };

  const decline = async () => {
    leftRef.current = true;
    await declineCall(callId).catch(() => undefined);
    if (router.canGoBack()) router.back();
    else router.replace('/inbox');
  };

  const gradient = useMemo(() => ['#1B0B3E', palette.purpleDeep, palette.night] as const, []);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <LinearGradient colors={[...gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {error ? (
        <View style={styles.center}>
          <Ionicons name="call-outline" size={48} color="rgba(255,255,255,0.6)" />
          <Text variant="h3" color={palette.white} align="center" style={{ marginTop: spacing.lg }}>
            Call unavailable
          </Text>
          <Text variant="body" color="rgba(255,255,255,0.75)" align="center" style={{ marginTop: spacing.sm, maxWidth: 360 }}>
            {error}
          </Text>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/inbox'))} style={styles.linkBtn}>
            <Text variant="bodySemibold" color={palette.pinkSoft}>
              Go back
            </Text>
          </Pressable>
        </View>
      ) : !call ? (
        <ActivityIndicator color={palette.white} style={styles.center} />
      ) : finished ? (
        <View style={styles.center}>
          <Avatar uri={call.conversation.avatar_url} name={call.conversation.title} size={96} />
          <Text variant="h3" color={palette.white} style={{ marginTop: spacing.lg }}>
            {call.conversation.title}
          </Text>
          <Text variant="body" color="rgba(255,255,255,0.75)" style={{ marginTop: spacing.xs }}>
            {call.status === 'ended' ? 'Call ended' : call.status === 'declined' ? 'Call declined' : call.is_initiator ? 'No answer' : 'Missed call'}
          </Text>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/inbox'))} style={styles.linkBtn}>
            <Text variant="bodySemibold" color={palette.pinkSoft}>
              Close
            </Text>
          </Pressable>
        </View>
      ) : !joined ? (
        <View style={[styles.center, { paddingBottom: insets.bottom + spacing['3xl'] }]}>
          <Text variant="small" color="rgba(255,255,255,0.7)">
            Incoming {call.kind} call
          </Text>
          <Avatar uri={call.initiator?.avatar_url ?? call.conversation.avatar_url} name={call.initiator?.display_name ?? call.conversation.title} size={120} ring />
          <Text variant="h2" color={palette.white} style={{ marginTop: spacing.lg }}>
            {call.initiator?.display_name ?? call.conversation.title}
          </Text>
          {call.conversation.kind === 'group' ? (
            <Text variant="body" color="rgba(255,255,255,0.75)">
              in {call.conversation.title}
            </Text>
          ) : null}
          <View style={styles.incomingActions}>
            <ControlButton icon="close" label="Decline" danger onPress={decline} />
            <Pressable onPress={accept} disabled={joining} style={styles.control} accessibilityLabel="Accept call">
              <View style={[styles.controlCircle, { backgroundColor: palette.success }]}>{joining ? <ActivityIndicator color={palette.white} /> : <Ionicons name={call.kind === 'video' ? 'videocam' : 'call'} size={26} color={palette.white} />}</View>
              <Text variant="caption" color="rgba(255,255,255,0.8)" style={{ marginTop: 6 }}>
                Accept
              </Text>
            </Pressable>
          </View>
        </View>
      ) : !credentials ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.white} />
          <Text variant="body" color="rgba(255,255,255,0.75)" style={{ marginTop: spacing.md }}>
            Securing the connection…
          </Text>
          <Pressable onPress={hangUp} style={styles.linkBtn}>
            <Text variant="bodySemibold" color={palette.pinkSoft}>
              Cancel
            </Text>
          </Pressable>
        </View>
      ) : (
        <LiveKitRoom
          serverUrl={credentials.url}
          token={credentials.token}
          connect
          audio
          video={call.kind === 'video'}
          options={{ adaptiveStream: true, dynacast: true }}
          onDisconnected={() => {
            if (!leftRef.current) void hangUp();
          }}
          onError={(e) => toast.error(getErrorMessage(e))}
        >
          <InCall call={call} onHangUp={hangUp} />
        </LiveKitRoom>
      )}
      {user ? null : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.night },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing['2xl'] },
  header: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignContent: 'center', gap: spacing.md, padding: spacing.md },
  tile: { borderRadius: radius.xl, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 2, borderColor: 'transparent' },
  tileSpeaking: { borderColor: palette.success },
  tilePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { position: 'absolute', left: spacing.sm, bottom: spacing.sm, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(9,8,23,0.55)', borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: spacing.lg, paddingTop: spacing.lg },
  control: { alignItems: 'center', width: 72 },
  controlCircle: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  incomingActions: { flexDirection: 'row', justifyContent: 'center', gap: spacing['5xl'], marginTop: spacing['4xl'] },
  linkBtn: { marginTop: spacing['2xl'], padding: spacing.md },
});
