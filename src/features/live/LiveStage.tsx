import { Ionicons } from '@/components/ui/Ionicons';
import type { LocalVideoTrack } from 'livekit-client';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Text } from '@/components/ui/Text';
import { VideoTile } from '@/features/calls/VideoTile';
import { AudioRenderer, flipCamera, isTrackReference, supportsCameraFlip, Track, useLocalParticipant, useParticipants, useTracks } from '@/lib/livekit/room';
import { palette, radius, spacing } from '@/theme/tokens';
import type { LiveSession } from '@/types/live';
import type { AuthorCard } from '@/types/social';

interface Publisher extends AuthorCard {
  role: 'host' | 'guest' | 'cohost' | 'moderator' | 'viewer';
  mic_enabled?: boolean;
  cam_enabled?: boolean;
}

/** Video grid for the host and everyone on stage (rendered inside LiveKitRoom). */
export function LiveStage({ live, myId, canPublish, bottomInset }: { live: LiveSession; myId: string | undefined; canPublish: boolean; bottomInset: number }) {
  const { width, height } = useWindowDimensions();
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const participants = useParticipants();
  const { localParticipant, isCameraEnabled, isMicrophoneEnabled } = useLocalParticipant();

  const publishers: Publisher[] = [{ ...live.host, role: 'host' }, ...live.stage.filter((s) => s.id !== live.host.id).map((s) => ({ ...s, role: s.role }))];
  const battle = live.battle && live.battle.status === 'active' ? live.battle : null;
  if (battle && !publishers.some((p) => p.id === battle.opponent.id)) publishers.push({ ...battle.opponent, role: 'cohost' });

  const videoTracks = tracks.filter(isTrackReference);
  const trackFor = (identity: string) => videoTracks.find((t) => t.participant.identity === identity && t.source === Track.Source.Camera);
  const connected = (identity: string) => participants.some((p) => p.identity === identity);

  const count = publishers.length;
  const columns = battle ? 2 : count <= 1 ? 1 : 2;
  const rows = Math.ceil(count / columns);
  const stageHeight = height;
  const tileWidth = width / columns;
  const tileHeight = count <= 1 ? stageHeight : stageHeight / rows;

  const toggleMic = () => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => undefined);
  const toggleCam = () => localParticipant.setCameraEnabled(!isCameraEnabled).catch(() => undefined);
  const switchCamera = async () => {
    const publication = localParticipant.getTrackPublication(Track.Source.Camera);
    await flipCamera(publication?.track as LocalVideoTrack | undefined).catch(() => undefined);
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <AudioRenderer />
      <View style={styles.grid}>
        {publishers.map((p) => {
          const isMe = p.id === myId;
          const track = trackFor(p.id);
          const online = connected(p.id);
          const camOn = isMe ? isCameraEnabled : Boolean(track) && (p.cam_enabled ?? true);
          const micOn = isMe ? isMicrophoneEnabled : participants.find((x) => x.identity === p.id)?.isMicrophoneEnabled ?? p.mic_enabled ?? true;
          return (
            <View key={p.id} style={{ width: tileWidth, height: tileHeight, backgroundColor: palette.night2 }}>
              {track && camOn ? <VideoTile trackRef={track} mirror={isMe} style={StyleSheet.absoluteFill} /> : (
                <View style={styles.placeholder}>
                  <Avatar uri={p.avatar_url} name={p.display_name} size={Math.min(120, tileHeight * 0.3)} ring={p.role === 'host'} />
                  <Text variant="small" color="rgba(255,255,255,0.75)" style={{ marginTop: spacing.sm }}>
                    {!online ? (p.role === 'host' ? 'Host is connecting…' : 'Connecting…') : 'Camera off'}
                  </Text>
                </View>
              )}
              {count > 1 ? (
                <View style={styles.tileLabel}>
                  {!micOn ? <Ionicons name="mic-off" size={12} color={palette.white} style={{ marginRight: 4 }} /> : null}
                  <Text variant="caption" color={palette.white} numberOfLines={1}>
                    {p.role === 'host' ? '👑 ' : p.role === 'cohost' ? '⭐ ' : ''}
                    {isMe ? 'You' : p.display_name}
                  </Text>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      {canPublish ? (
        <View style={[styles.controls, { bottom: bottomInset + 150 }]}>
          <Pressable onPress={toggleMic} style={[styles.control, !isMicrophoneEnabled && styles.controlOff]} accessibilityLabel={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}>
            <Ionicons name={isMicrophoneEnabled ? 'mic' : 'mic-off'} size={20} color={palette.white} />
          </Pressable>
          <Pressable onPress={toggleCam} style={[styles.control, !isCameraEnabled && styles.controlOff]} accessibilityLabel={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}>
            <Ionicons name={isCameraEnabled ? 'videocam' : 'videocam-off'} size={20} color={palette.white} />
          </Pressable>
          {supportsCameraFlip ? (
            <Pressable onPress={() => void switchCamera()} style={styles.control} accessibilityLabel="Flip camera">
              <Ionicons name="camera-reverse-outline" size={20} color={palette.white} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { position: 'absolute', left: spacing.sm, top: spacing.sm, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(9,8,23,0.55)', borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3, maxWidth: '80%' },
  controls: { position: 'absolute', left: spacing.md, gap: spacing.sm },
  control: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  controlOff: { backgroundColor: palette.danger },
});
