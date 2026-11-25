import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { getCallHistory, startCall, type CallRecord } from '@/services/calls';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';
import { formatDate } from '@/utils/format';

function outcomeLabel(call: CallRecord): { text: string; color: 'textMuted' | 'danger' } {
  const dur = call.duration_seconds ? ` · ${Math.floor(call.duration_seconds / 60)}:${String(call.duration_seconds % 60).padStart(2, '0')}` : '';
  switch (call.outcome) {
    case 'answered':
      return { text: `${call.direction === 'outgoing' ? 'Outgoing' : 'Incoming'}${dur}`, color: 'textMuted' };
    case 'declined':
      return { text: call.direction === 'outgoing' ? 'Declined' : 'You declined', color: 'textMuted' };
    case 'no_answer':
      return { text: 'No answer', color: 'textMuted' };
    default:
      return { text: 'Missed', color: 'danger' };
  }
}

export default function CallsScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const history = usePagedQuery<CallRecord, string>(
    async (cursor) => {
      const items = await getCallHistory(cursor);
      return { items, nextCursor: items.length < 30 ? null : items[items.length - 1].created_at };
    },
    (c) => c.id,
    'calls',
  );

  const callBack = async (call: CallRecord, kind: 'voice' | 'video') => {
    try {
      const id = await startCall(call.conversation_id, kind);
      router.navigate(`/call/${id}` as never);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <Screen header={<ScreenHeader title="Calls" fallbackHref="/inbox" />} scroll padded={false} refreshing={history.refreshing} onRefresh={history.refresh}>
      {history.loading ? (
        <View style={{ padding: spacing.lg }}>
          <SkeletonList count={8} />
        </View>
      ) : history.items.length === 0 ? (
        <EmptyState icon="call-outline" title="No calls yet" description="Start a voice or video call from any conversation. Your call history appears here." action={{ title: 'Open inbox', onPress: () => router.navigate('/inbox'), variant: 'secondary' }} />
      ) : (
        history.items.map((call) => {
          const outcome = outcomeLabel(call);
          return (
            <Pressable key={call.id} onPress={() => router.navigate(`/chat/${call.conversation_id}` as never)} style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, pressed && { backgroundColor: colors.surfaceMuted }]}>
              <Avatar uri={call.conversation.avatar_url} name={call.conversation.title} size={48} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text variant="bodyMedium" numberOfLines={1} style={outcome.color === 'danger' ? { color: palette.danger } : undefined}>
                  {call.conversation.title ?? 'Call'}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name={call.direction === 'outgoing' ? 'arrow-up-outline' : 'arrow-down-outline'} size={13} color={outcome.color === 'danger' ? palette.danger : colors.textMuted} style={{ transform: [{ rotate: '45deg' }] }} />
                  <Text variant="small" color={outcome.color} style={{ marginLeft: 4 }}>
                    {outcome.text} · {formatDate(call.created_at, 'd MMM HH:mm')}
                  </Text>
                </View>
              </View>
              <Pressable onPress={() => callBack(call, call.kind)} hitSlop={8} style={styles.callBtn} accessibilityLabel={`Call back (${call.kind})`}>
                <Ionicons name={call.kind === 'video' ? 'videocam-outline' : 'call-outline'} size={22} color={colors.primary} />
              </Pressable>
            </Pressable>
          );
        })
      )}
      {history.hasMore && history.items.length > 0 ? (
        <Pressable onPress={() => void history.loadMore()} style={{ padding: spacing.lg, alignItems: 'center' }}>
          <Text variant="smallMedium" color="primary">
            {history.loadingMore ? 'Loading…' : 'Load more'}
          </Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  callBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
