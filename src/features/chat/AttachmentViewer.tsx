import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { useSignedUrl } from '@/hooks/useSignedUrl';
import { palette, spacing } from '@/theme/tokens';
import type { MessageAttachment } from '@/types/messaging';

function VideoPane({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls />;
}

export function AttachmentViewer({ attachment, onClose }: { attachment: MessageAttachment | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const url = useSignedUrl(attachment?.path);
  return (
    <Modal visible={Boolean(attachment)} transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        {attachment && url ? attachment.kind === 'video' ? <VideoPane uri={url} /> : <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}
        <View style={[styles.bar, { top: insets.top + spacing.sm }]}>
          <Pressable onPress={onClose} style={styles.btn} accessibilityLabel="Close">
            <Ionicons name="close" size={26} color={palette.white} />
          </Pressable>
          <Text variant="smallMedium" color={palette.white} numberOfLines={1} style={{ flex: 1, marginHorizontal: spacing.md }}>
            {attachment?.name ?? (attachment?.kind === 'video' ? 'Video' : 'Photo')}
          </Text>
          <Pressable onPress={() => url && Linking.openURL(url)} style={styles.btn} accessibilityLabel="Open or download">
            <Ionicons name="download-outline" size={24} color={palette.white} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.black },
  bar: { position: 'absolute', left: spacing.sm, right: spacing.sm, flexDirection: 'row', alignItems: 'center' },
  btn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(9,8,23,0.5)', alignItems: 'center', justifyContent: 'center' },
});
