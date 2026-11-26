import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';

import { StoryViewer } from '@/features/stories/StoryViewer';
import { sendStoryReply } from '@/services/messaging';
import { useAuthStore } from '@/store/authStore';
import { AppError } from '@/utils/errors';

export default function StoryScreen() {
  const { userId, order } = useLocalSearchParams<{ userId: string; order?: string }>();
  const me = useAuthStore((s) => s.user?.id);
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
          if (!me) throw new AppError('Please sign in again.', 'NOT_AUTHENTICATED');
          await sendStoryReply(story, text, me);
        }}
      />
    </>
  );
}
