import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { getStarredMessages, starMessage } from '@/services/messaging';
import { previewFor } from '@/store/chatStore';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';
import { formatDate } from '@/utils/format';

export default function StarredMessagesScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const starred = useAsync(() => getStarredMessages(), []);

  const unstar = async (id: string) => {
    try {
      await starMessage(id, false);
      starred.setData((prev) => (prev ?? []).filter((m) => m.id !== id));
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <Screen header={<ScreenHeader title="Starred messages" fallbackHref="/inbox" />} scroll padded={false} refreshing={starred.refreshing} onRefresh={starred.refresh}>
      {starred.loading ? (
        <View style={{ padding: spacing.lg }}>
          <SkeletonList count={5} />
        </View>
      ) : (starred.data ?? []).length === 0 ? (
        <EmptyState icon="star-outline" title="No starred messages" description="Long-press a message and tap Star to keep it here." />
      ) : (
        (starred.data ?? []).map((m) => (
          <Pressable key={m.id} onPress={() => router.navigate(`/chat/${m.conversation_id}` as never)} onLongPress={() => unstar(m.id)} style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, pressed && { backgroundColor: colors.surfaceMuted }]}>
            <Avatar uri={m.sender?.avatar_url} name={m.sender?.display_name} size={40} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="smallMedium" numberOfLines={1} style={{ flex: 1 }}>
                  {m.sender?.display_name ?? 'Unknown'}
                  {m.conversation?.title ? ` · ${m.conversation.title}` : ''}
                </Text>
                <Text variant="caption" color="textMuted">
                  {formatDate(m.created_at, 'd MMM')}
                </Text>
              </View>
              <Text variant="small" color="textSecondary" numberOfLines={2}>
                {previewFor(m)}
              </Text>
            </View>
          </Pressable>
        ))
      )}
      {(starred.data ?? []).length > 0 ? (
        <Text variant="caption" color="textMuted" align="center" style={{ padding: spacing.lg }}>
          Long-press to unstar.
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth } });
