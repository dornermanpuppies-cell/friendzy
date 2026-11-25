import { VideoTrack } from '@livekit/components-react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import type { TrackReference } from '@/lib/livekit/room';

/** Renders a LiveKit video track as a <video> element (web implementation). */
export function VideoTile({ trackRef, mirror = false, style }: { trackRef: TrackReference; mirror?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flex: 1, overflow: 'hidden' }, style]}>
      <VideoTrack trackRef={trackRef} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: mirror ? 'scaleX(-1)' : undefined, backgroundColor: '#090817' }} />
    </View>
  );
}
