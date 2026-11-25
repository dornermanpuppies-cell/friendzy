import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ListItem, ListSection } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { confirmAction } from '@/features/feed/usePostActions';
import { useAsync } from '@/hooks/useAsync';
import { createHighlight, deleteHighlight, getHighlights, getMyArchivedStories, updateHighlight } from '@/services/stories';
import { useAuth } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { gradients, palette, radius, spacing } from '@/theme/tokens';
import type { StoryHighlight } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';
import { formatDate } from '@/utils/format';

export default function HighlightsScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const highlights = useAsync(() => (user ? getHighlights(user.id) : Promise.resolve([])), [user?.id]);
  const archive = useAsync(() => getMyArchivedStories(), []);
  const [editing, setEditing] = useState<StoryHighlight | 'new' | null>(null);
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const cell = Math.floor(Math.min(width, 640) / 3) - spacing.sm;

  const openEditor = (h: StoryHighlight | 'new') => {
    setEditing(h);
    setTitle(h === 'new' ? '' : h.title);
    setSelected(new Set());
  };

  const save = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      if (editing === 'new') {
        if (selected.size === 0) {
          toast.error('Pick at least one story');
          return;
        }
        await createHighlight(title.trim(), Array.from(selected));
        toast.success('Highlight created');
      } else if (editing) {
        await updateHighlight(editing.id, { title: title.trim(), add: Array.from(selected) });
        toast.success('Highlight updated');
      }
      setEditing(null);
      await highlights.refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = (h: StoryHighlight) => {
    confirmAction('Delete highlight?', 'The stories themselves stay in your archive.', 'Delete', async () => {
      try {
        await deleteHighlight(h.id);
        await highlights.refresh();
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    });
  };

  return (
    <Screen header={<ScreenHeader title="Highlights" fallbackHref="/profile" right={<Button title="New" size="sm" leftIcon="add" onPress={() => openEditor('new')} />} />} scroll>
      <Text variant="body" color="textMuted" style={{ marginVertical: spacing.lg }}>
        Highlights keep your favourite stories on your profile after they expire.
      </Text>
      {highlights.loading ? (
        <Skeleton height={80} />
      ) : (highlights.data ?? []).length === 0 ? (
        <EmptyState compact emoji="⭐" title="No highlights yet" description="Create one from the stories in your archive." action={{ title: 'Create highlight', onPress: () => openEditor('new') }} />
      ) : (
        <ListSection title="Your highlights">
          {(highlights.data ?? []).map((h) => (
            <ListItem
              key={h.id}
              left={
                <View style={[styles.cover, { borderColor: colors.border }]}>
                  {h.cover_url ? <Image source={{ uri: h.cover_url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <LinearGradient colors={[...gradients.cool]} style={StyleSheet.absoluteFill} />}
                </View>
              }
              title={h.title}
              subtitle={`${h.count} stor${h.count === 1 ? 'y' : 'ies'}`}
              onPress={() => router.navigate({ pathname: '/highlight/[id]', params: { id: h.id } } as never)}
              right={
                <View style={{ flexDirection: 'row' }}>
                  <Pressable onPress={() => openEditor(h)} hitSlop={8} style={styles.iconBtn} accessibilityLabel="Edit highlight">
                    <Ionicons name="create-outline" size={20} color={colors.textSecondary} />
                  </Pressable>
                  <Pressable onPress={() => remove(h)} hitSlop={8} style={styles.iconBtn} accessibilityLabel="Delete highlight">
                    <Ionicons name="trash-outline" size={20} color={palette.danger} />
                  </Pressable>
                </View>
              }
              showChevron={false}
            />
          ))}
        </ListSection>
      )}

      <Text variant="h4" style={{ marginBottom: spacing.sm }}>
        Story archive
      </Text>
      <Text variant="small" color="textMuted" style={{ marginBottom: spacing.md }}>
        Only you can see your archive.
      </Text>
      {archive.loading ? (
        <Skeleton height={120} />
      ) : (archive.data ?? []).length === 0 ? (
        <EmptyState compact emoji="📼" title="Your archive is empty" description="Stories you share are kept here so you can add them to highlights later." />
      ) : (
        <View style={styles.grid}>
          {(archive.data ?? []).map((s) => (
            <View key={s.id} style={[styles.tile, { width: cell, height: cell * 1.5, backgroundColor: colors.skeleton }]}>
              {s.kind === 'text' ? (
                <LinearGradient colors={[s.style?.bg ?? palette.purple, s.style?.bg2 ?? palette.pink]} style={[StyleSheet.absoluteFill, styles.tileText]}>
                  <Text variant="caption" color={palette.white} numberOfLines={4} align="center">
                    {s.text}
                  </Text>
                </LinearGradient>
              ) : (
                <Image source={{ uri: s.thumbnail_url ?? s.media_url ?? undefined }} style={StyleSheet.absoluteFill} contentFit="cover" />
              )}
              <View style={styles.tileDate}>
                <Text variant="caption" color={palette.white}>
                  {formatDate(s.created_at, 'd MMM')}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      <Sheet visible={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'New highlight' : 'Edit highlight'} subtitle="Pick stories from your archive">
        <Input label="Title" placeholder="e.g. Summer" value={title} onChangeText={(v) => setTitle(v.slice(0, 30))} maxLength={30} />
        <View style={[styles.grid, { marginTop: spacing.md, maxHeight: 320 }]}>
          {(archive.data ?? []).map((s) => {
            const on = selected.has(s.id);
            return (
              <Pressable key={s.id} onPress={() => setSelected((prev) => { const next = new Set(prev); if (next.has(s.id)) next.delete(s.id); else next.add(s.id); return next; })} style={[styles.tile, { width: 84, height: 126, backgroundColor: colors.skeleton, borderWidth: 2, borderColor: on ? colors.primary : 'transparent' }]}>
                {s.kind === 'text' ? <LinearGradient colors={[s.style?.bg ?? palette.purple, s.style?.bg2 ?? palette.pink]} style={StyleSheet.absoluteFill} /> : <Image source={{ uri: s.thumbnail_url ?? s.media_url ?? undefined }} style={StyleSheet.absoluteFill} contentFit="cover" />}
                {on ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} style={styles.check} /> : null}
              </Pressable>
            );
          })}
        </View>
        <Button title={editing === 'new' ? 'Create highlight' : 'Save changes'} fullWidth onPress={save} loading={busy} disabled={!title.trim()} style={{ marginVertical: spacing.lg }} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cover: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { borderRadius: radius.md, overflow: 'hidden' },
  tileText: { alignItems: 'center', justifyContent: 'center', padding: spacing.sm },
  tileDate: { position: 'absolute', left: 6, bottom: 6, backgroundColor: 'rgba(9,8,23,0.55)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  check: { position: 'absolute', top: 4, right: 4, backgroundColor: '#fff', borderRadius: 11 },
});
