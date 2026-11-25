import { Stack } from 'expo-router';

import { VideoFeedScreen } from '@/features/video/VideoFeedScreen';
import { useBreakpoint } from '@/hooks/useBreakpoint';

/** Full-screen short-video feed (also embedded in Home → Videos). */
export default function VideosScreen() {
  const { isDesktop } = useBreakpoint();
  return (
    <>
      <Stack.Screen options={{ title: 'Videos' }} />
      <VideoFeedScreen showBack={!isDesktop} />
    </>
  );
}
