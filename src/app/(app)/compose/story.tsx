import { Ionicons } from '@/components/ui/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { ListItem } from '@/components/ui/ListItem';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { captureMedia, pickMedia, type PickedMedia } from '@/services/media';
import { uploadMediaItem } from '@/services/posts';
import { createStory, STORY_BACKGROUNDS } from '@/services/stories';
import { useAuth } from '@/store/authStore';
import { ThemeScope } from '@/theme/ThemeProvider';
import { absoluteFillObject, fontFamily, palette, radius, spacing } from '@/theme/tokens';
import type { StoryAudience, StorySticker } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';
import { useViewportSize } from '@/hooks/useViewportSize';

const STICKER_EMOJIS = ['❤️', '🔥', '😂', '✨', '🎉', '👀', '💯', '🙌', '🌍', '🎵', '☕', '🍕', '😎', '🥳', '💜', '⚡'];
const FONTS: { id: 'display' | 'body' | 'mono'; label: string }[] = [
  { id: 'display', label: 'Bold' },
  { id: 'body', label: 'Clean' },
  { id: 'mono', label: 'Mono' },
];
const AUDIENCES: { id: StoryAudience; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'everyone', label: 'Everyone', icon: 'earth-outline' },
  { id: 'followers', label: 'Followers', icon: 'people-outline' },
  { id: 'friends', label: 'Friends', icon: 'heart-outline' },
];

function DraggableSticker({ sticker, frame, onMove, onRemove }: { sticker: StorySticker; frame: { width: number; height: number }; onMove: (x: number, y: number) => void; onRemove: () => void }) {
  const tx = useSharedValue(sticker.x * frame.width);
  const ty = useSharedValue(sticker.y * frame.height);
  const start = useSharedValue({ x: 0, y: 0 });
  const pan = Gesture.Pan()
    .onStart(() => {
      start.value = { x: tx.value, y: ty.value };
    })
    .onUpdate((e) => {
      tx.value = Math.min(frame.width - 20, Math.max(20, start.value.x + e.translationX));
      ty.value = Math.min(frame.height - 20, Math.max(20, start.value.y + e.translationY));
    })
    .onEnd(() => {
      runOnJS(onMove)(tx.value / frame.width, ty.value / frame.height);
    });
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value - 24 * sticker.scale }, { translateY: ty.value - 24 * sticker.scale }] }));
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.sticker, style]}>
        <Pressable onLongPress={onRemove} delayLongPress={400}>
          <Text style={{ fontSize: 40 * sticker.scale, lineHeight: 48 * sticker.scale }}>{sticker.emoji}</Text>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

export default function ComposeStoryScreen() {
  const { user, settings } = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width, height } = useViewportSize();
  const [media, setMedia] = useState<PickedMedia | null>(null);
  const [text, setText] = useState('');
  const [caption, setCaption] = useState('');
  const [bg, setBg] = useState(STORY_BACKGROUNDS[0]);
  const [font, setFont] = useState<'display' | 'body' | 'mono'>('display');
  const [stickers, setStickers] = useState<StorySticker[]>([]);
  const [audience, setAudience] = useState<StoryAudience>(settings?.story_audience === 'nobody' ? 'friends' : ((settings?.story_audience as StoryAudience | undefined) ?? 'followers'));
  const [stickersOpen, setStickersOpen] = useState(false);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [musicTitle, setMusicTitle] = useState('');
  const [musicOpen, setMusicOpen] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const frameWidth = Math.min(width, 480);
  const frameHeight = Math.min(height - insets.top - insets.bottom - 150, (frameWidth * 16) / 9);
  const isTextStory = !media;

  const choose = async (source: 'library' | 'camera' | 'video') => {
    try {
      if (source === 'library') {
        const [picked] = await pickMedia({ multiple: false });
        if (picked) setMedia(picked);
      } else {
        const captured = await captureMedia(source === 'video' ? 'video' : 'image');
        if (captured) setMedia(captured);
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const addSticker = (emoji: string) => {
    setStickers((s) => [...s, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, emoji, x: 0.3 + Math.random() * 0.4, y: 0.3 + Math.random() * 0.3, scale: 1 }]);
    setStickersOpen(false);
  };

  const canSubmit = !submitting && (media !== null || text.trim().length > 0);

  const submit = async () => {
    if (!user || !canSubmit) return;
    setSubmitting(true);
    try {
      let mediaUrl: string | null = null;
      let thumbnailUrl: string | null = null;
      let durationMs: number | null = null;
      if (media) {
        setProgress(0);
        const uploaded = await uploadMediaItem(user.id, 'stories', { uri: media.uri, kind: media.kind, mime: media.mime, width: media.width, height: media.height, durationMs: media.durationMs }, (p) => setProgress(p.fraction));
        mediaUrl = uploaded.url;
        thumbnailUrl = uploaded.thumbnail_url ?? null;
        durationMs = uploaded.duration_ms ?? null;
      }
      await createStory({
        kind: media ? media.kind : 'text',
        mediaUrl,
        thumbnailUrl,
        text: isTextStory ? text.trim() : null,
        style: isTextStory ? { bg: bg.colors[0], bg2: bg.colors[1], font, align: 'center', color: palette.white } : {},
        stickers,
        caption: !isTextStory && caption.trim() ? caption.trim() : null,
        musicTitle: musicTitle.trim() || null,
        audience,
        durationMs: media?.kind === 'video' ? (durationMs ?? media.durationMs ?? null) : null,
      });
      toast.success('Story shared', 'It disappears in 24 hours unless you add it to a highlight.');
      if (router.canGoBack()) router.back();
      else router.replace('/home');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  };

  const audienceMeta = AUDIENCES.find((a) => a.id === audience)!;

  return (
    <ThemeScope scheme="dark">
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))} hitSlop={8} style={styles.iconBtn} accessibilityLabel="Close">
            <Ionicons name="close" size={26} color={palette.white} />
          </Pressable>
          <Text variant="h4" color={palette.white}>
            New story
          </Text>
          <Pressable onPress={() => setAudienceOpen(true)} style={styles.audienceBtn} accessibilityLabel="Audience">
            <Ionicons name={audienceMeta.icon} size={14} color={palette.white} />
            <Text variant="caption" color={palette.white} style={{ marginLeft: 4 }}>
              {audienceMeta.label}
            </Text>
          </Pressable>
        </View>

        <View style={[styles.frame, { width: frameWidth, height: frameHeight }]}>
          {media ? (
            <>
              <Image source={{ uri: media.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
              {media.kind === 'video' ? (
                <View style={styles.videoTag}>
                  <Ionicons name="videocam" size={14} color={palette.white} />
                  <Text variant="caption" color={palette.white} style={{ marginLeft: 4 }}>
                    Video
                  </Text>
                </View>
              ) : null}
              <Pressable onPress={() => setMedia(null)} style={styles.removeMedia} accessibilityLabel="Remove media">
                <Ionicons name="trash-outline" size={18} color={palette.white} />
              </Pressable>
            </>
          ) : (
            <LinearGradient colors={bg.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, styles.textFrame]}>
              <TextInput
                value={text}
                onChangeText={(v) => setText(v.slice(0, 500))}
                placeholder="Type something…"
                placeholderTextColor="rgba(255,255,255,0.7)"
                multiline
                textAlign="center"
                style={[styles.textInput, { fontFamily: font === 'mono' ? fontFamily.mono : font === 'body' ? fontFamily.body : fontFamily.display }]}
              />
            </LinearGradient>
          )}
          {stickers.map((s) => (
            <DraggableSticker key={s.id} sticker={s} frame={{ width: frameWidth, height: frameHeight }} onMove={(x, y) => setStickers((list) => list.map((it) => (it.id === s.id ? { ...it, x, y } : it)))} onRemove={() => setStickers((list) => list.filter((it) => it.id !== s.id))} />
          ))}
          {progress !== null ? (
            <View style={styles.progressOverlay}>
              <Text variant="h3" color={palette.white}>
                {Math.round(progress * 100)}%
              </Text>
              <Text variant="small" color="rgba(255,255,255,0.8)">
                Uploading…
              </Text>
            </View>
          ) : null}
        </View>

        {/* Tools */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tools}>
          <Chip label="Photo/Video" icon="images-outline" size="sm" onPress={() => choose('library')} />
          {Platform.OS !== 'web' ? <Chip label="Camera" icon="camera-outline" size="sm" onPress={() => choose('camera')} /> : null}
          {Platform.OS !== 'web' ? <Chip label="Record" icon="videocam-outline" size="sm" onPress={() => choose('video')} /> : null}
          <Chip label="Sticker" icon="happy-outline" size="sm" onPress={() => setStickersOpen(true)} />
          <Chip label={musicTitle ? `♪ ${musicTitle}` : 'Sound'} icon="musical-notes-outline" size="sm" selected={Boolean(musicTitle)} onPress={() => setMusicOpen(true)} />
        </ScrollView>
        {isTextStory ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tools}>
            {STORY_BACKGROUNDS.map((b) => (
              <Pressable key={b.id} onPress={() => setBg(b)} style={[styles.swatch, bg.id === b.id && styles.swatchActive]} accessibilityLabel={`${b.id} background`}>
                <LinearGradient colors={b.colors} style={StyleSheet.absoluteFill} />
              </Pressable>
            ))}
            <View style={{ width: spacing.md }} />
            {FONTS.map((f) => (
              <Chip key={f.id} label={f.label} size="sm" selected={font === f.id} onPress={() => setFont(f.id)} />
            ))}
          </ScrollView>
        ) : (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
            <Input placeholder="Add a caption…" value={caption} onChangeText={(v) => setCaption(v.slice(0, 300))} maxLength={300} />
          </View>
        )}
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Text variant="caption" color="rgba(255,255,255,0.6)" style={{ flex: 1 }}>
            Long-press a sticker to remove it. Stories vanish after 24 hours.
          </Text>
          <Button title="Share story" onPress={submit} disabled={!canSubmit} loading={submitting} rightIcon="arrow-forward" />
        </View>
      </View>

      <Sheet visible={stickersOpen} onClose={() => setStickersOpen(false)} title="Add a sticker">
        <View style={styles.stickerGrid}>
          {STICKER_EMOJIS.map((e) => (
            <Pressable key={e} onPress={() => addSticker(e)} style={styles.stickerCell} accessibilityLabel={`Sticker ${e}`}>
              <Text style={{ fontSize: 34, lineHeight: 42 }}>{e}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ height: spacing.lg }} />
      </Sheet>
      <Sheet visible={audienceOpen} onClose={() => setAudienceOpen(false)} title="Who can see your story?">
        {AUDIENCES.map((a) => (
          <ListItem key={a.id} icon={a.icon} title={a.label} right={audience === a.id ? <Ionicons name="checkmark-circle" size={22} color={palette.purpleSoft} /> : undefined} onPress={() => { setAudience(a.id); setAudienceOpen(false); }} showChevron={false} />
        ))}
        <View style={{ height: spacing.lg }} />
      </Sheet>
      <Sheet visible={musicOpen} onClose={() => setMusicOpen(false)} title="Sound" subtitle="Credit the track you're using. Only use music you have the rights to share.">
        <Input placeholder="Song title – artist" value={musicTitle} onChangeText={(v) => setMusicTitle(v.slice(0, 80))} maxLength={80} autoFocus />
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.lg }}>
          <Button title="Done" onPress={() => setMusicOpen(false)} />
          {musicTitle ? <Button title="Remove" variant="ghost" onPress={() => { setMusicTitle(''); setMusicOpen(false); }} /> : null}
        </View>
      </Sheet>
    </ThemeScope>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.night, alignItems: 'center' },
  header: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, height: 52 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  audienceBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.14)', paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full },
  frame: { borderRadius: radius.xl, overflow: 'hidden', backgroundColor: palette.night2 },
  textFrame: { alignItems: 'center', justifyContent: 'center', padding: spacing['2xl'] },
  textInput: { color: palette.white, fontSize: 30, lineHeight: 40, fontWeight: '700', width: '100%', ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  videoTag: { position: 'absolute', left: spacing.md, top: spacing.md, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(9,8,23,0.6)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  removeMedia: { position: 'absolute', right: spacing.md, top: spacing.md, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(9,8,23,0.6)', alignItems: 'center', justifyContent: 'center' },
  sticker: { position: 'absolute', left: 0, top: 0 },
  progressOverlay: { ...absoluteFillObject, backgroundColor: 'rgba(9,8,23,0.6)', alignItems: 'center', justifyContent: 'center' },
  tools: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm, alignItems: 'center' },
  swatch: { width: 34, height: 34, borderRadius: 17, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  swatchActive: { borderColor: palette.white },
  footer: { width: '100%', flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  stickerGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  stickerCell: { width: '16.66%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
});
