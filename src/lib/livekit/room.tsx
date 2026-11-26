/**
 * LiveKit adapter — Android / iOS implementation.
 * The web counterpart lives in room.web.ts and exposes the same surface.
 */
import {
  AndroidAudioTypePresets,
  AudioSession,
  isTrackReference,
  LiveKitRoom,
  registerGlobals,
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
} from '@livekit/react-native';
import { ConnectionState, Track, facingModeFromLocalTrack, type LocalVideoTrack } from 'livekit-client';

registerGlobals();

export { ConnectionState, isTrackReference, LiveKitRoom, Track, useConnectionState, useLocalParticipant, useParticipants, useRoomContext, useTracks };
export type { TrackReference, TrackReferenceOrPlaceholder } from '@livekit/react-native';

/** Plays remote audio. Native tracks play automatically; the web adapter renders a real element. */
export function AudioRenderer(): null {
  return null;
}

export async function prepareAudio(video: boolean): Promise<void> {
  await AudioSession.configureAudio({
    android: { audioTypeOptions: AndroidAudioTypePresets.communication, preferredOutputList: video ? ['speaker', 'bluetooth', 'headset', 'earpiece'] : ['bluetooth', 'headset', 'earpiece', 'speaker'] },
    ios: { defaultOutput: video ? 'speaker' : 'earpiece' },
  });
  await AudioSession.startAudioSession();
}

export async function releaseAudio(): Promise<void> {
  await AudioSession.stopAudioSession().catch(() => undefined);
}

export async function setSpeakerphone(on: boolean): Promise<void> {
  await AudioSession.configureAudio({
    android: { audioTypeOptions: AndroidAudioTypePresets.communication, preferredOutputList: on ? ['speaker', 'bluetooth', 'headset', 'earpiece'] : ['bluetooth', 'headset', 'earpiece', 'speaker'] },
    ios: { defaultOutput: on ? 'speaker' : 'earpiece' },
  });
  try {
    const outputs = await AudioSession.getAudioOutputs();
    const target = on ? outputs.find((o) => o.includes('speaker')) : outputs.find((o) => o.includes('earpiece') || o.includes('receiver'));
    if (target) await AudioSession.selectAudioOutput(target);
  } catch {
    /* route picker fallback below */
  }
}

export async function showAudioRoutePicker(): Promise<void> {
  await AudioSession.showAudioRoutePicker().catch(() => undefined);
}

export async function flipCamera(track: LocalVideoTrack | undefined): Promise<void> {
  if (!track) return;
  const current = facingModeFromLocalTrack(track).facingMode;
  await track.restartTrack({ facingMode: current === 'user' ? 'environment' : 'user' });
}

export const supportsCameraFlip = true;
