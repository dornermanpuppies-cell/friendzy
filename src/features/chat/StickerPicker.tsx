import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Chip } from '@/components/ui/Chip';
import { Text } from '@/components/ui/Text';
import { env } from '@/lib/env';
import { getStickers } from '@/services/messaging';
import { useTheme } from '@/theme/ThemeProvider';
import { fontFamily, radius, spacing } from '@/theme/tokens';
import type { Sticker } from '@/types/messaging';

interface GifResult {
  id: string;
  url: string;
  preview: string;
  width: number;
  height: number;
}

async function searchTenor(query: string, key: string): Promise<GifResult[]> {
  const url = `https://tenor.googleapis.com/v2/${query ? 'search' : 'featured'}?key=${encodeURIComponent(key)}&client_key=friendzy&limit=24&media_filter=gif,tinygif${query ? `&q=${encodeURIComponent(query)}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GIF search failed (${res.status})`);
  const json = (await res.json()) as { results: { id: string; media_formats: Record<string, { url: string; dims: [number, number] }> }[] };
  return json.results.map((r) => ({
    id: r.id,
    url: r.media_formats.gif?.url ?? r.media_formats.tinygif?.url ?? '',
    preview: r.media_formats.tinygif?.url ?? r.media_formats.gif?.url ?? '',
    width: r.media_formats.tinygif?.dims?.[0] ?? 200,
    height: r.media_formats.tinygif?.dims?.[1] ?? 200,
  }));
}

export function StickerPicker({ onSticker, onGif, onClose }: { onSticker: (s: Sticker) => void; onGif: (url: string, preview: string) => void; onClose: () => void }) {
  const { colors } = useTheme();
  const [tab, setTab] = useState<'stickers' | 'gifs'>('stickers');
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [pack, setPack] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getStickers()
      .then((list) => {
        setStickers(list);
        setPack(list[0]?.pack ?? null);
      })
      .catch(() => setStickers([]));
  }, []);

  useEffect(() => {
    if (tab !== 'gifs' || !env.tenorApiKey) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setLoading(true);
      setError(null);
      searchTenor(query.trim(), env.tenorApiKey)
        .then(setGifs)
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    }, 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [tab, query]);

  const packs = useMemo(() => Array.from(new Set(stickers.map((s) => s.pack))), [stickers]);
  const visible = stickers.filter((s) => !pack || s.pack === pack);

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Chip label="Stickers" size="sm" selected={tab === 'stickers'} onPress={() => setTab('stickers')} />
          <Chip label="GIFs" size="sm" selected={tab === 'gifs'} onPress={() => setTab('gifs')} />
        </View>
        <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close picker">
          <Ionicons name="chevron-down" size={22} color={colors.textMuted} />
        </Pressable>
      </View>
      {tab === 'stickers' ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingBottom: spacing.sm }}>
            {packs.map((p) => (
              <Chip key={p} label={p[0].toUpperCase() + p.slice(1)} size="sm" selected={pack === p} onPress={() => setPack(p)} />
            ))}
          </ScrollView>
          <ScrollView style={{ maxHeight: 200 }} contentContainerStyle={styles.grid}>
            {visible.map((s) => (
              <Pressable key={s.id} onPress={() => onSticker(s)} style={styles.cell} accessibilityLabel={s.label ?? 'Sticker'}>
                {s.url ? <Image source={{ uri: s.url }} style={{ width: 48, height: 48 }} contentFit="contain" /> : <Text style={{ fontSize: 36, lineHeight: 44 }}>{s.emoji}</Text>}
              </Pressable>
            ))}
            {visible.length === 0 ? (
              <Text variant="small" color="textMuted" style={{ padding: spacing.md }}>
                No stickers available.
              </Text>
            ) : null}
          </ScrollView>
        </>
      ) : !env.tenorApiKey ? (
        <View style={styles.notice}>
          <Ionicons name="key-outline" size={18} color={colors.textMuted} />
          <Text variant="small" color="textMuted" style={{ flex: 1, marginLeft: spacing.sm }}>
            GIF search needs a Tenor API key (EXPO_PUBLIC_TENOR_API_KEY). Add it to enable this picker.
          </Text>
        </View>
      ) : (
        <>
          <View style={[styles.search, { backgroundColor: colors.inputBackground }]}>
            <Ionicons name="search-outline" size={16} color={colors.textMuted} />
            <TextInput value={query} onChangeText={setQuery} placeholder="Search GIFs" placeholderTextColor={colors.placeholder} style={[styles.searchInput, { color: colors.text }]} />
          </View>
          {loading ? <ActivityIndicator color={colors.primary} style={{ padding: spacing.lg }} /> : error ? <Text variant="small" color="danger">{error}</Text> : (
            <ScrollView style={{ maxHeight: 220 }} contentContainerStyle={styles.gifGrid}>
              {gifs.map((g) => (
                <Pressable key={g.id} onPress={() => onGif(g.url, g.preview)} style={styles.gifCell}>
                  <Image source={{ uri: g.preview }} style={{ width: '100%', height: 96, borderRadius: radius.sm }} contentFit="cover" />
                </Pressable>
              ))}
            </ScrollView>
          )}
          <Text variant="caption" color="textMuted" align="right" style={{ marginTop: 4 }}>
            Powered by Tenor
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.sm, marginBottom: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '16.66%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  search: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.full, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  searchInput: { flex: 1, fontFamily: fontFamily.body, fontSize: 14, paddingVertical: 8, marginLeft: spacing.sm },
  gifGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  gifCell: { width: '32%' },
});
