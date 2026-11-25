import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { joinViaInvite, previewInvite } from '@/services/messaging';
import { spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';

/** Landing page for group invite links (friendzy.app/chat/join/<code>). */
export default function JoinGroupScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const toast = useToast();
  const preview = useAsync(() => previewInvite(String(code)), [code]);
  const [busy, setBusy] = useState(false);

  const join = async () => {
    setBusy(true);
    try {
      const result = await joinViaInvite(String(code));
      if (result.status === 'requested') {
        toast.success('Request sent', 'An admin needs to approve you before you can join.');
        router.replace('/inbox');
      } else {
        router.replace(`/chat/${result.conversation_id}` as never);
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<ScreenHeader title="Group invite" fallbackHref="/inbox" />} scroll>
      {preview.loading ? (
        <Skeleton height={180} style={{ marginTop: spacing.lg }} />
      ) : !preview.data ? (
        <EmptyState emoji="🔗" title="Invite link is invalid" description="This link may have been reset by a group admin." action={{ title: 'Back to inbox', onPress: () => router.replace('/inbox') }} />
      ) : (
        <View style={styles.card}>
          <Avatar uri={preview.data.avatar_url} name={preview.data.title} size={96} />
          <Text variant="h2" align="center" style={{ marginTop: spacing.md }}>
            {preview.data.title}
          </Text>
          <Text variant="body" color="textMuted" align="center">
            {preview.data.members_count} member{preview.data.members_count === 1 ? '' : 's'}
            {preview.data.join_approval ? ' · admin approval required' : ''}
          </Text>
          {preview.data.description ? (
            <Text variant="body" align="center" style={{ marginTop: spacing.md }}>
              {preview.data.description}
            </Text>
          ) : null}
          {preview.data.already_member ? (
            <Button title="Open group" size="lg" style={{ marginTop: spacing['2xl'] }} onPress={() => router.replace(`/chat/${preview.data!.id}` as never)} />
          ) : (
            <Button title={preview.data.join_approval ? 'Request to join' : 'Join group'} size="lg" style={{ marginTop: spacing['2xl'] }} onPress={join} loading={busy} />
          )}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ card: { alignItems: 'center', paddingVertical: spacing['3xl'] } });
