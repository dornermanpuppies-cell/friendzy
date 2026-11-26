import { Ionicons } from '@/components/ui/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { getTrendingSounds, uploadSound } from '@/services/videos';
import { useAuth } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { SoundItem } from '@/types/video';
import { getErrorMessage } from '@/utils/errors';
import { formatCount } from '@/utils/format';

export function SoundPickerSheet({ visible, onClose, onPick, selectedId }: { visible: boolean; onClose: () => void; onPick: (sound: SoundItem | null) => void; selectedId: string | null }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [uploading, setUploading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(query.trim()), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);
  const sounds = useAsync(() => getTrendingSounds(40, debounced || undefined), [debounced, visible], { enabled: visible });

  const upload = async () => {
    if (!user) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['audio/*'], copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      setUploading(true);
      const title = asset.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 80) || 'My sound';
      const sound = await uploadSound(user.id, asset.uri, { title, license_note: 'Uploaded by the creator — they confirmed they hold the rights.' });
      toast.success('Sound added to the library');
      onPick(sound);
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Add a sound" subtitle="Trending sounds and original sounds from Friendzy creators">
      <Input placeholder="Search sounds" leftIcon="search-outline" value={query} onChangeText={setQuery} autoCapitalize="none" />
      <View style={{ height: 360, marginTop: spacing.md }}>
        {sounds.loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : !sounds.data || sounds.data.length === 0 ? (
          <EmptyState compact emoji="🎵" title="No sounds yet" description="Upload an audio file you own the rights to, or publish a video — its original sound joins the library automatically." />
        ) : (
          <FlatList
            data={sounds.data}
            keyExtractor={(s) => s.id}
            renderItem={({ item }) => {
              const active = item.id === selectedId;
              return (
                <Pressable onPress={() => { onPick(item); onClose(); }} style={[styles.row, { borderColor: colors.border, backgroundColor: active ? colors.primarySoft : 'transparent' }]}>
                  <View style={[styles.disc, { backgroundColor: palette.night3 }]}>
                    <Ionicons name="musical-notes" size={18} color={palette.white} />
                  </View>
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text variant="bodySemibold" numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text variant="caption" color="textMuted" numberOfLines={1}>
                      {item.artist ?? (item.owner ? `@${item.owner.username}` : 'Original sound')} · {formatCount(item.uses_count)} videos
                      {item.duration_ms ? ` · ${Math.round(item.duration_ms / 1000)}s` : ''}
                    </Text>
                  </View>
                  {active ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
                </Pressable>
              );
            }}
          />
        )}
      </View>
      <View style={styles.footer}>
        {selectedId ? <Button title="Remove sound" variant="ghost" size="sm" onPress={() => { onPick(null); onClose(); }} /> : <View />}
        <Button title="Upload audio" variant="secondary" size="sm" leftIcon="cloud-upload-outline" onPress={() => void upload()} loading={uploading} />
      </View>
      <Text variant="caption" color="textMuted" style={{ marginBottom: spacing.md }}>
        Only upload music you created or are licensed to use. Copyrighted uploads can be removed.
      </Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm },
  disc: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.sm },
});
