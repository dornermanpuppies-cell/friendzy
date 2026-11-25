import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';

import { StoryViewer } from '@/features/stories/StoryViewer';
import { sendStoryReply } from '@/services/messaging';

export default function StoryScreen() {
  const { userId, order } = useLocalSearchParams<{ userId: string; order?: string }>();
  const authorIds = useMemo(() => {
    const list = (order ?? '').split(',').filter(Boolean);
    return list.length > 0 ? list : [String(userId)];
  }, [order, userId]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));

  return (
    <>
      <StatusBar style="light" />
      <StoryViewer
        authorIds={authorIds}
        initialAuthorId={String(userId)}
        onClose={close}
        onReply={async (story, text) => {
          await sendStoryReply(story, text);
        }}
      />
    </>
  );
}
