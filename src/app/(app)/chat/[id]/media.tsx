import { Ionicons } from '@/components/ui/Ionicons';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { AttachmentViewer } from '@/features/chat/AttachmentViewer';
import { VoiceNotePlayer } from '@/features/chat/VoiceNotePlayer';
import { useAsync } from '@/hooks/useAsync';
import { useAttachmentSource } from '@/hooks/useAttachmentSource';
import { openAttachment } from '@/services/attachments';
import { getSharedMedia } from '@/services/messaging';
import { useThreadMessages } from '@/store/chatStore';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { Message, MessageAttachment } from '@/types/messaging';
import { formatDate } from '@/utils/format';

type Kind = 'media' | 'docs' | 'audio' | 'links';

function Thumb({ attachment, size, onPress }: { attachment: MessageAttachment; size: number; onPress: () => void }) {
  const { uri: url } = useAttachmentSource(attachment, 'thumb');
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={{ width: size, height: size, padding: 1 }}>
      <View style={{ flex: 1, backgroundColor: colors.skeleton }}>
        {url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
        {attachment.kind === 'video' ? <Ionicons name="play-circle" size={22} color={palette.white} style={{ position: 'absolute', right: 6, bottom: 6 }} /> : null}
      </View>
    </Pressable>
  );
}

function AudioRow({ message }: { message: Message }) {
  const { colors } = useTheme();
  const a = message.attachments[0];
  const { uri: url } = useAttachmentSource(a, 'full');
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <VoiceNotePlayer uri={url} durationMs={a?.duration_ms} waveform={a?.waveform} tint={colors.primary} trackColor={colors.borderStrong} textColor={colors.textSecondary} compact />
      </View>
      <Text variant="caption" color="textMuted" style={{ marginLeft: spacing.md }}>
        {formatDate(message.created_at, 'd MMM')}
      </Text>
    </View>
  );
}

export default function SharedMediaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [kind, setKind] = useState<Kind>('media');
  const [viewer, setViewer] = useState<MessageAttachment | null>(null);
  const query = useAsync(() => getSharedMedia(String(id), kind), [id, kind]);
  // Links inside end-to-end encrypted messages are only known on this device (from the loaded thread).
  const thread = useThreadMessages(String(id));
  const columns = width >= 768 ? 4 : 3;
  const cell = Math.floor(Math.min(width, 640) / columns);

  const openDoc = async (a: MessageAttachment) => {
    try {
      await openAttachment(a);
    } catch {
      /* ignore */
    }
  };

  const linkMessages: Message[] = kind === 'links'
    ? [...(query.data ?? []), ...thread.filter((m) => m.encrypted && !m.deleted && /https?:\/\//.test(m.text ?? ''))]
        .filter((m, index, all) => all.findIndex((x) => x.id === m.id) === index)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
    : [];

  return (
    <Screen header={<ScreenHeader title="Media, links & docs" fallbackHref={`/chat/${id}/info`} />} scroll padded={false}>
      <View style={styles.filters}>
        {(['media', 'docs', 'audio', 'links'] as Kind[]).map((k) => (
          <Chip key={k} label={k === 'media' ? 'Media' : k === 'docs' ? 'Documents' : k === 'audio' ? 'Voice' : 'Links'} size="sm" selected={kind === k} onPress={() => setKind(k)} />
        ))}
      </View>
      {query.loading ? (
        <View style={{ padding: spacing.lg }}>
          <Skeleton height={200} />
        </View>
      ) : (kind === 'links' ? linkMessages : (query.data ?? [])).length === 0 ? (
        <EmptyState compact icon="folder-open-outline" title="Nothing here yet" description={kind === 'links' ? 'Links from messages loaded on this device appear here. Encrypted messages are only indexed locally.' : 'Shared items from this conversation appear here.'} />
      ) : kind === 'media' ? (
        <View style={styles.grid}>
          {(query.data ?? []).flatMap((m) => m.attachments.map((a) => <Thumb key={a.id} attachment={a} size={cell} onPress={() => setViewer(a)} />))}
        </View>
      ) : kind === 'audio' ? (
        (query.data ?? []).map((m) => <AudioRow key={m.id} message={m} />)
      ) : kind === 'docs' ? (
        (query.data ?? []).flatMap((m) =>
          m.attachments.map((a) => (
            <Pressable key={a.id} onPress={() => openDoc(a)} style={[styles.row, { borderBottomColor: colors.border }]}>
              <View style={[styles.docIcon, { backgroundColor: colors.primarySoft }]}>
                <Ionicons name="document-text" size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium" numberOfLines={1}>
                  {a.name ?? 'Document'}
                </Text>
                <Text variant="caption" color="textMuted">
                  {m.sender?.display_name} · {formatDate(m.created_at, 'd MMM yyyy')}
                </Text>
              </View>
              <Ionicons name="download-outline" size={20} color={colors.textMuted} />
            </Pressable>
          )),
        )
      ) : (
        linkMessages.map((m) => {
          const links = (m.text ?? '').match(/https?:\/\/[^\s]+/g) ?? [];
          return links.map((link) => (
            <Pressable key={`${m.id}-${link}`} onPress={() => Linking.openURL(link)} style={[styles.row, { borderBottomColor: colors.border }]}>
              <View style={[styles.docIcon, { backgroundColor: colors.primarySoft }]}>
                <Ionicons name="link" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium" color="primary" numberOfLines={1}>
                  {link}
                </Text>
                <Text variant="caption" color="textMuted">
                  {m.sender?.display_name} · {formatDate(m.created_at, 'd MMM yyyy')}
                </Text>
              </View>
            </Pressable>
          ));
        })
      )}
      <AttachmentViewer attachment={viewer} onClose={() => setViewer(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  docIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
});
