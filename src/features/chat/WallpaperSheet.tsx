import { Ionicons } from '@/components/ui/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { pickImage } from '@/services/media';
import { getWallpaperUrl, isImageWallpaper, uploadChatWallpaper } from '@/services/wallpapers';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';

import { WALLPAPERS } from './wallpapers';

/** Small preview of the photo currently chosen, resolved through a signed URL. */
function PhotoTile({ value, selected, onPress }: { value: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getWallpaperUrl(value).then((u) => !cancelled && setUrl(u));
    return () => {
      cancelled = true;
    };
  }, [value]);
  return (
    <Pressable onPress={onPress} style={[styles.tile, { borderColor: selected ? colors.primary : 'transparent' }]} accessibilityLabel="Your photo wallpaper">
      {url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.night2 }]} />}
      <View style={styles.tileLabel}>
        <Text variant="caption" color={palette.white}>
          Photo
        </Text>
      </View>
    </Pressable>
  );
}

export interface WallpaperSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Current value: a preset id, `img:<path>`, or null. */
  value: string | null;
  /** Called with the new value. `null` clears it. */
  onSelect: (value: string | null) => void | Promise<void>;
  userId: string;
  title?: string;
  /** Label for the "no choice of its own" option — differs between one chat and the account default. */
  clearLabel?: string;
}

/**
 * Picks the background for a chat: one of the built-in colours, or a photo from the phone.
 * Used both per chat (from chat info) and account-wide (from Settings → Chats).
 */
export function WallpaperSheet({ visible, onClose, value, onSelect, userId, title = 'Chat wallpaper', clearLabel = 'Use the default' }: WallpaperSheetProps) {
  const { colors } = useTheme();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const choose = async (next: string | null) => {
    try {
      await onSelect(next);
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const fromPhotos = async () => {
    setBusy(true);
    try {
      const picked = await pickImage('cover');
      if (!picked) return;
      const stored = await uploadChatWallpaper(userId, picked.uri);
      await onSelect(stored);
      toast.success('Wallpaper updated');
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle="Only you see this background">
      <Button title={busy ? 'Uploading…' : 'Choose a photo'} leftIcon="image-outline" fullWidth loading={busy} onPress={() => void fromPhotos()} />
      {busy ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} /> : null}
      <View style={styles.grid}>
        {isImageWallpaper(value) ? <PhotoTile value={value as string} selected onPress={() => undefined} /> : null}
        {WALLPAPERS.map((w) => (
          <Pressable
            key={w.id}
            onPress={() => void choose(w.id === 'default' ? null : w.id)}
            style={[styles.tile, { borderColor: value === w.id || (!value && w.id === 'default') ? colors.primary : 'transparent' }]}
            accessibilityLabel={`${w.label} wallpaper`}
          >
            <LinearGradient colors={w.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <View style={styles.tileLabel}>
              <Text variant="caption" color={palette.white}>
                {w.label}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
      {value ? (
        <Pressable onPress={() => void choose(null)} style={styles.clear} accessibilityLabel={clearLabel}>
          <Ionicons name="refresh-outline" size={16} color={colors.textMuted} />
          <Text variant="small" color="textMuted" style={{ marginLeft: spacing.sm }}>
            {clearLabel}
          </Text>
        </Pressable>
      ) : null}
      <View style={{ height: spacing.lg }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  tile: { width: 92, height: 120, borderRadius: radius.md, overflow: 'hidden', borderWidth: 2, justifyContent: 'flex-end' },
  tileLabel: { backgroundColor: 'rgba(9,8,23,0.55)', paddingVertical: 3, alignItems: 'center' },
  clear: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.md, marginTop: spacing.sm },
});
