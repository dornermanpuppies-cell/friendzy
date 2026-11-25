import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { StoryViewer } from '@/features/stories/StoryViewer';
import { getHighlightStories } from '@/services/stories';

/** Plays the stories saved in a highlight (they may be older than 24 hours). */
export default function HighlightScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/profile'));
  return (
    <>
      <StatusBar style="light" />
      <StoryViewer authorIds={[String(id)]} initialAuthorId={String(id)} onClose={close} loadStories={() => getHighlightStories(String(id))} />
    </>
  );
}
