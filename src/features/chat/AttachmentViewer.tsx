import { Ionicons } from '@/components/ui/Ionicons';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useAttachmentSource } from '@/hooks/useAttachmentSource';
import { openAttachment } from '@/services/attachments';
import { palette, spacing } from '@/theme/tokens';
import type { MessageAttachment } from '@/types/messaging';
import { getErrorMessage } from '@/utils/errors';

function VideoPane({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls />;
}

/** Full-screen viewer. Encrypted media is decrypted on this device before it is shown. */
export function AttachmentViewer({ attachment, onClose }: { attachment: MessageAttachment | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const source = useAttachmentSource(attachment, 'full');
  const isMedia = attachment?.kind === 'image' || attachment?.kind === 'video';
  return (
    <Modal visible={Boolean(attachment)} transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        {attachment && source.uri && isMedia ? attachment.kind === 'video' ? <VideoPane uri={source.uri} /> : <Image source={{ uri: source.uri }} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}
        {attachment && source.loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={palette.white} />
            <Text variant="caption" color={palette.white} style={{ marginTop: spacing.sm }}>
              {attachment.e2ee ? 'Decrypting…' : 'Loading…'}
            </Text>
          </View>
        ) : null}
        {attachment && !source.loading && (source.error || !isMedia) ? (
          <View style={styles.center}>
            <Ionicons name={source.error ? 'alert-circle-outline' : 'document-text-outline'} size={40} color={palette.white} />
            <Text variant="small" color={palette.white} align="center" style={{ marginTop: spacing.sm, paddingHorizontal: spacing.xl }}>
              {source.error ? 'This file could not be opened on this device.' : (attachment.name ?? 'Document')}
            </Text>
            {!source.error ? (
              <Pressable onPress={() => openAttachment(attachment).catch((e) => toast.error(getErrorMessage(e)))} style={styles.openBtn}>
                <Text variant="smallMedium" color={palette.white}>
                  Open
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <View style={[styles.bar, { top: insets.top + spacing.sm }]}>
          <Pressable onPress={onClose} style={styles.btn} accessibilityLabel="Close">
            <Ionicons name="close" size={26} color={palette.white} />
          </Pressable>
          <View style={{ flex: 1, marginHorizontal: spacing.md }}>
            <Text variant="smallMedium" color={palette.white} numberOfLines={1}>
              {attachment?.name ?? (attachment?.kind === 'video' ? 'Video' : attachment?.kind === 'image' ? 'Photo' : 'File')}
            </Text>
            {attachment?.e2ee ? (
              <Text variant="caption" color="rgba(255,255,255,0.7)">
                🔒 End-to-end encrypted
              </Text>
            ) : null}
          </View>
          <Pressable onPress={() => attachment && openAttachment(attachment).catch((e) => toast.error(getErrorMessage(e)))} style={styles.btn} accessibilityLabel="Save or share" disabled={!attachment || source.loading}>
            <Ionicons name="download-outline" size={24} color={palette.white} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.black },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  bar: { position: 'absolute', left: spacing.sm, right: spacing.sm, flexDirection: 'row', alignItems: 'center' },
  btn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(9,8,23,0.5)', alignItems: 'center', justifyContent: 'center' },
  openBtn: { marginTop: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 20, backgroundColor: palette.purple },
});
