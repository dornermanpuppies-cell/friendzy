import { router } from 'expo-router';

import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';

export default function NotFoundScreen() {
  return (
    <Screen>
      <EmptyState
        emoji="🧭"
        title="This page doesn't exist"
        description="The link may be broken or the page may have moved."
        action={{ title: 'Go to Friendzy', onPress: () => router.replace('/') }}
        style={{ flex: 1 }}
      />
    </Screen>
  );
}
