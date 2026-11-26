/**
 * LiveKit adapter — web implementation (react-dom + livekit-client).
 * Mirrors the surface of room.ts so screens stay platform-agnostic.
 */
import { isTrackReference, LiveKitRoom as BaseLiveKitRoom, RoomAudioRenderer, useConnectionState, useLocalParticipant, useParticipants, useRoomContext, useTracks } from '@livekit/components-react';
import { ConnectionState, Track, facingModeFromLocalTrack, type LocalVideoTrack } from 'livekit-client';
import type { ComponentProps } from 'react';

export { ConnectionState, isTrackReference, Track, useConnectionState, useLocalParticipant, useParticipants, useRoomContext, useTracks };

/**
 * The web LiveKitRoom renders a plain <div>; without flex sizing the React Native
 * views inside it collapse to zero height (the call UI was there but invisible).
 */
export function LiveKitRoom(props: ComponentProps<typeof BaseLiveKitRoom>) {
  return <BaseLiveKitRoom {...props} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', ...(props.style ?? {}) }} />;
}
export type { TrackReference, TrackReferenceOrPlaceholder } from '@livekit/components-react';

export const AudioRenderer = RoomAudioRenderer;

export async function prepareAudio(_video: boolean): Promise<void> {
  /* browsers manage audio routing */
}

export async function releaseAudio(): Promise<void> {
  /* nothing to release */
}

export async function setSpeakerphone(_on: boolean): Promise<void> {
  /* not applicable in browsers */
}

export async function showAudioRoutePicker(): Promise<void> {
  /* not applicable in browsers */
}

export async function flipCamera(track: LocalVideoTrack | undefined): Promise<void> {
  if (!track) return;
  const current = facingModeFromLocalTrack(track).facingMode;
  await track.restartTrack({ facingMode: current === 'user' ? 'environment' : 'user' });
}

export const supportsCameraFlip = typeof navigator !== 'undefined' && /Mobi|Android/i.test(navigator.userAgent);
