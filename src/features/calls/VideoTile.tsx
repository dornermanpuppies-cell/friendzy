import { VideoTrack } from '@livekit/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import type { TrackReference } from '@/lib/livekit/room';

/** Renders a LiveKit video track (native implementation). */
export function VideoTile({ trackRef, mirror = false, style }: { trackRef: TrackReference; mirror?: boolean; style?: StyleProp<ViewStyle> }) {
  const flattened = (StyleSheet.flatten([{ flex: 1 }, style]) ?? {}) as ViewStyle;
  return <VideoTrack trackRef={trackRef} style={flattened} objectFit="cover" mirror={mirror} />;
}
