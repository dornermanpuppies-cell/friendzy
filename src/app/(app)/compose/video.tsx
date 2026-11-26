import { Ionicons } from '@/components/ui/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ListItem } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { RangeSlider, ValueSlider } from '@/components/ui/Slider';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { SoundPickerSheet } from '@/features/video/SoundPickerSheet';
import { VideoEditorPreview } from '@/features/video/VideoEditorPreview';
import { useAsync } from '@/hooks/useAsync';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { captureMedia, pickMedia } from '@/services/media';
import { createVideo, deleteDraft, emptyDraft, getSound, getVideo, listDrafts, MAX_VIDEO_SECONDS, saveDraft, uploadVideoMedia } from '@/services/videos';
import { useAuth } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { PostAudience } from '@/types/social';
import { VIDEO_FILTERS, type SoundItem, type VideoDraftData, type VideoOverlay } from '@/types/video';
import { getErrorMessage } from '@/utils/errors';
import { formatDate } from '@/utils/format';

type Tool = 'trim' | 'speed' | 'filter' | 'text' | 'stickers' | 'sound' | 'cover';
const TOOLS: { id: Tool; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'trim', label: 'Trim', icon: 'cut-outline' },
  { id: 'speed', label: 'Speed', icon: 'speedometer-outline' },
  { id: 'filter', label: 'Filters', icon: 'color-filter-outline' },
  { id: 'text', label: 'Text', icon: 'text-outline' },
  { id: 'stickers', label: 'Stickers', icon: 'happy-outline' },
  { id: 'sound', label: 'Sound', icon: 'musical-notes-outline' },
  { id: 'cover', label: 'Cover', icon: 'image-outline' },
];
const SPEEDS = [0.5, 0.75, 1, 1.5, 2];
const TEXT_COLORS = [palette.white, palette.pink, palette.purpleSoft, palette.gold, palette.success, palette.blueSoft, palette.black];
const STICKERS = ['🔥', '😂', '❤️', '✨', '🎉', '😍', '👀', '💯', '🙌', '🎵', '🌈', '⭐', '🥳', '😎', '🤯', '💜', '🫶', '👑', '🍕', '☀️'];

function fmt(ms: number) {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`;
}

const uid = () => Math.random().toString(36).slice(2, 10);

export default function ComposeVideoScreen() {
  const params = useLocalSearchParams<{ duet?: string; stitch?: string; sound?: string; draft?: string; replyTo?: string; tag?: string }>();
  const { user, profile } = useAuth();
  const { colors, isDark } = useTheme();
  const { isDesktop } = useBreakpoint();
  const toast = useToast();

  const [draft, setDraft] = useState<VideoDraftData>(() => emptyDraft({ caption: params.tag ? `#${params.tag} ` : '', duet_of: params.duet ?? null, stitch_of: params.stitch ?? null, reply_to_comment_id: params.replyTo ?? null }));
  const [draftId, setDraftId] = useState<string | null>(params.draft ?? null);
  const [step, setStep] = useState<'pick' | 'edit' | 'details'>('pick');
  const [tool, setTool] = useState<Tool>('trim');
  const [playing, setPlaying] = useState(true);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [sound, setSound] = useState<SoundItem | null>(null);
  const [soundOpen, setSoundOpen] = useState(false);
  const [overlayText, setOverlayText] = useState('');
  const [overlayColor, setOverlayColor] = useState<string>(palette.white);
  const [selectedOverlay, setSelectedOverlay] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  const drafts = useAsync(() => (user ? listDrafts(user.id) : Promise.resolve([])), [user?.id, step]);
  const reference = useAsync(() => (params.duet || params.stitch ? getVideo(String(params.duet ?? params.stitch)) : Promise.resolve(null)), [params.duet, params.stitch]);

  // Resume a draft or preselect a sound from the URL.
  useEffect(() => {
    if (!params.draft || !user) return;
    let cancelled = false;
    void listDrafts(user.id)
      .then((rows) => {
        const found = rows.find((d) => d.id === params.draft);
        if (!found || cancelled) return;
        setDraft(found.data);
        setDraftId(found.id);
        if (found.data.uri) setStep('edit');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [params.draft, user]);
  useEffect(() => {
    if (params.sound) {
      void getSound(String(params.sound)).then((s) => {
        if (s) {
          setSound(s);
          setDraft((d) => ({ ...d, sound_id: s.id, sound_title: s.title }));
        }
      });
    }
  }, [params.sound]);

  const update = useCallback((patch: Partial<VideoDraftData>) => setDraft((d) => ({ ...d, ...patch })), []);
  const duration = draft.duration_ms ?? 0;
  const trimEnd = draft.trim_end_ms ?? duration;

  const choose = async (source: 'camera' | 'library') => {
    setBusy(true);
    try {
      const picked = source === 'camera' ? await captureMedia('video') : (await pickMedia({ kinds: ['videos'], multiple: false }))[0];
      if (!picked) return;
      if (picked.durationMs && picked.durationMs > MAX_VIDEO_SECONDS * 1000) {
        toast.error(`Videos can be up to ${MAX_VIDEO_SECONDS / 60} minutes long. Trim it first.`);
        return;
      }
      update({ uri: picked.uri, mime: picked.mime, width: picked.width ?? null, height: picked.height ?? null, duration_ms: picked.durationMs ?? null, trim_start_ms: 0, trim_end_ms: picked.durationMs ?? null, cover_time_ms: 500 });
      setStep('edit');
      setPlaying(true);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const addOverlay = (overlay: Omit<VideoOverlay, 'id' | 'x' | 'y'>) => {
    const id = uid();
    update({ overlays: [...draft.overlays, { id, x: 0.5, y: 0.4 + (draft.overlays.length % 4) * 0.08, ...overlay }] });
    setSelectedOverlay(id);
  };

  const persistDraft = async (silent = false) => {
    if (!user) return;
    try {
      const id = await saveDraft(user.id, draft, draftId);
      setDraftId(id);
      if (!silent) toast.success('Draft saved', 'The video file stays on this device until you post.');
    } catch (error) {
      if (!silent) toast.error(getErrorMessage(error));
    }
  };

  const publish = async () => {
    if (!user || !draft.uri) return;
    setPublishing(true);
    setProgress(0);
    setPlaying(false);
    try {
      const uploaded = await uploadVideoMedia(user.id, draft.uri, { mime: draft.mime, coverTimeMs: draft.cover_time_ms, onProgress: (p) => setProgress(p.fraction) });
      const created = await createVideo({
        ...draft,
        media_url: uploaded.mediaUrl,
        thumbnail_url: uploaded.thumbnailUrl,
        width: draft.width ?? uploaded.width,
        height: draft.height ?? uploaded.height,
        duration_ms: draft.duration_ms ?? null,
        trim_end_ms: draft.trim_end_ms && draft.duration_ms && draft.trim_end_ms >= draft.duration_ms - 50 ? null : draft.trim_end_ms,
      });
      if (draftId) await deleteDraft(draftId).catch(() => undefined);
      toast.success('Video posted');
      router.replace(`/video/${created.id}` as never);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setPublishing(false);
    }
  };

  const refVideo = reference.data;
  const stitchMax = refVideo?.duration_ms ? Math.max(0, refVideo.duration_ms - 5000) : 0;

  const toolPanel = useMemo(() => {
    switch (tool) {
      case 'trim':
        return (
          <View>
            <RangeSlider start={draft.trim_start_ms} end={trimEnd} min={0} max={Math.max(duration, 1000)} minRange={1000} format={fmt} onChange={(s, e) => update({ trim_start_ms: Math.round(s), trim_end_ms: Math.round(e) })} onComplete={(s) => setSeekTo(Math.round(s) + Math.random() * 0.001)} />
            <Text variant="caption" color="textMuted">
              Clip length {fmt(trimEnd - draft.trim_start_ms)} · trims apply at playback, the original stays untouched.
            </Text>
          </View>
        );
      case 'speed':
        return (
          <View style={styles.wrap}>
            {SPEEDS.map((s) => (
              <Chip key={s} label={`${s}×`} selected={draft.playback_rate === s} onPress={() => update({ playback_rate: s })} />
            ))}
          </View>
        );
      case 'filter':
        return (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {VIDEO_FILTERS.map((f) => (
              <Pressable key={f.id} onPress={() => update({ filter: f.id })} style={[styles.filterTile, { borderColor: draft.filter === f.id ? colors.primary : colors.border }]}>
                <View style={[styles.filterSwatch, { backgroundColor: f.tint ?? (isDark ? palette.night3 : palette.lavenderDeep) }]} />
                <Text variant="caption">{f.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        );
      case 'text':
        return (
          <View>
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
              <Input placeholder="Type something…" value={overlayText} onChangeText={setOverlayText} maxLength={80} containerStyle={{ flex: 1 }} />
              <Button title="Add" size="sm" onPress={() => { if (overlayText.trim()) { addOverlay({ kind: 'text', text: overlayText.trim(), color: overlayColor, background: overlayColor === palette.white ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.0)' }); setOverlayText(''); } }} disabled={!overlayText.trim()} />
            </View>
            <View style={[styles.wrap, { marginTop: spacing.sm }]}>
              {TEXT_COLORS.map((c) => (
                <Pressable key={c} onPress={() => setOverlayColor(c)} style={[styles.colorDot, { backgroundColor: c, borderColor: overlayColor === c ? colors.primary : colors.border }]} accessibilityLabel={`Text colour ${c}`} />
              ))}
            </View>
            <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs }}>
              Drag text on the preview to position it. Tap it, then ✕ to remove.
            </Text>
          </View>
        );
      case 'stickers':
        return (
          <View style={styles.wrap}>
            {STICKERS.map((s) => (
              <Pressable key={s} onPress={() => addOverlay({ kind: 'sticker', emoji: s })} style={[styles.sticker, { backgroundColor: colors.surfaceMuted }]}>
                <Text style={{ fontSize: 26 }}>{s}</Text>
              </Pressable>
            ))}
          </View>
        );
      case 'sound':
        return (
          <View>
            <ListItem icon="musical-notes-outline" title={sound ? sound.title : 'Add a sound'} subtitle={sound ? (sound.artist ?? 'From the Friendzy library') : 'Trending sounds and original sounds from creators'} onPress={() => setSoundOpen(true)} />
            <ValueSlider label="Original audio" value={Math.round(draft.original_volume * 100)} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => update({ original_volume: v / 100 })} style={{ marginTop: spacing.sm }} />
            <ValueSlider label="Added sound" value={Math.round(draft.sound_volume * 100)} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => update({ sound_volume: v / 100 })} disabled={!sound} style={{ marginTop: spacing.sm }} />
          </View>
        );
      case 'cover':
        return (
          <View>
            <ValueSlider label="Cover frame" value={draft.cover_time_ms} min={draft.trim_start_ms} max={Math.max(trimEnd, draft.trim_start_ms + 100)} step={100} format={fmt} onChange={(v) => { update({ cover_time_ms: v }); setPlaying(false); setSeekTo(v); }} />
            <Text variant="caption" color="textMuted">
              The frame shown in grids and link previews. Scrub to pick it.
            </Text>
          </View>
        );
      default:
        return null;
    }
  }, [tool, draft, trimEnd, duration, update, colors, isDark, overlayText, overlayColor, sound]);

  // ---------------------------------------------------------------- pick step
  if (step === 'pick') {
    return (
      <Screen header={<ScreenHeader title="New video" fallbackHref="/create" />} scroll padded>
        {refVideo ? (
          <View style={[styles.refCard, { backgroundColor: colors.surfaceMuted }]}>
            {refVideo.thumbnail_url ? <Image source={{ uri: refVideo.thumbnail_url }} style={styles.refThumb} /> : null}
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text variant="bodySemibold">{params.duet ? 'Duet with' : 'Stitch'} @{refVideo.author.username}</Text>
              <Text variant="small" color="textMuted">
                {params.duet ? 'Your clip plays side by side with the original.' : 'Up to 5 seconds of the original play first, then your clip.'}
              </Text>
            </View>
          </View>
        ) : null}
        <View style={[styles.pickRow, isDesktop && { flexDirection: 'row' }]}>
          <Pressable onPress={() => void choose('camera')} style={[styles.pickCard, { backgroundColor: colors.surface, borderColor: colors.border }]} disabled={busy}>
            <Ionicons name="videocam" size={34} color={colors.primary} />
            <Text variant="h4" style={{ marginTop: spacing.sm }}>
              Record
            </Text>
            <Text variant="small" color="textMuted" align="center">
              Use your camera (up to 3 minutes)
            </Text>
          </Pressable>
          <Pressable onPress={() => void choose('library')} style={[styles.pickCard, { backgroundColor: colors.surface, borderColor: colors.border }]} disabled={busy}>
            <Ionicons name="images" size={34} color={colors.accent} />
            <Text variant="h4" style={{ marginTop: spacing.sm }}>
              Upload
            </Text>
            <Text variant="small" color="textMuted" align="center">
              Choose a video from this device
            </Text>
          </Pressable>
        </View>
        <Text variant="h4" style={{ marginTop: spacing['2xl'], marginBottom: spacing.sm }}>
          Drafts
        </Text>
        {drafts.data && drafts.data.length > 0 ? (
          drafts.data.map((d) => (
            <ListItem
              key={d.id}
              icon="document-outline"
              title={d.data.caption?.trim() ? d.data.caption.slice(0, 60) : 'Untitled draft'}
              subtitle={`${formatDate(d.updated_at, 'd MMM, HH:mm')}${d.data.uri ? '' : ' · video file not on this device'}`}
              onPress={() => { setDraft(d.data); setDraftId(d.id); setStep(d.data.uri ? 'edit' : 'pick'); if (!d.data.uri) toast.info('Pick the video again', 'Drafts keep your edits and caption; the file stays on the device where you saved it.'); }}
              right={<Pressable onPress={() => void deleteDraft(d.id).then(() => drafts.refresh())} hitSlop={8} accessibilityLabel="Delete draft"><Ionicons name="trash-outline" size={18} color={colors.textMuted} /></Pressable>}
            />
          ))
        ) : (
          <Text variant="small" color="textMuted">
            Drafts you save appear here.
          </Text>
        )}
      </Screen>
    );
  }

  // ---------------------------------------------------------------- edit step
  if (step === 'edit') {
    return (
      <Screen header={<ScreenHeader title="Edit" back={false} left={<Button title="Back" variant="ghost" size="sm" leftIcon="chevron-back" onPress={() => setStep('pick')} />} right={<Button title="Next" size="sm" rightIcon="chevron-forward" onPress={() => { setPlaying(false); setStep('details'); }} />} />} padded={false} maxWidth={false}>
        <View style={[styles.editor, isDesktop && { flexDirection: 'row' }]}>
          <View style={[styles.preview, isDesktop && { flex: 1, maxWidth: 420, margin: spacing.lg }]}>
            <VideoEditorPreview draft={draft} soundUrl={sound?.url ?? null} playing={playing} onTogglePlay={() => setPlaying((p) => !p)} onDuration={(ms) => { if (!draft.duration_ms) update({ duration_ms: ms, trim_end_ms: ms }); }} onMoveOverlay={(id, x, y) => update({ overlays: draft.overlays.map((o) => (o.id === id ? { ...o, x, y } : o)) })} onRemoveOverlay={(id) => update({ overlays: draft.overlays.filter((o) => o.id !== id) })} selectedOverlay={selectedOverlay} onSelectOverlay={setSelectedOverlay} seekTo={seekTo} />
            {params.stitch && refVideo ? (
              <View style={[styles.stitchBox, { backgroundColor: colors.surfaceMuted }]}>
                <Text variant="smallMedium">Stitch segment from @{refVideo.author.username}</Text>
                <ValueSlider value={draft.stitch_start_ms ?? 0} min={0} max={Math.max(stitchMax, 0)} step={100} format={(v) => `${fmt(v)} → ${fmt(v + 5000)}`} onChange={(v) => update({ stitch_start_ms: v, stitch_end_ms: v + 5000 })} />
              </View>
            ) : null}
          </View>
          <View style={[styles.tools, isDesktop && { flex: 1, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolTabs}>
              {TOOLS.map((t) => (
                <Pressable key={t.id} onPress={() => setTool(t.id)} style={styles.toolTab} accessibilityRole="tab" accessibilityState={{ selected: tool === t.id }}>
                  <Ionicons name={t.icon} size={22} color={tool === t.id ? colors.primary : colors.textMuted} />
                  <Text variant="caption" color={tool === t.id ? 'primary' : 'textMuted'}>
                    {t.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.toolPanel}>{toolPanel}</View>
          </View>
        </View>
        <SoundPickerSheet visible={soundOpen} onClose={() => setSoundOpen(false)} selectedId={draft.sound_id} onPick={(s) => { setSound(s); update({ sound_id: s?.id ?? null, sound_title: s?.title ?? null, original_volume: s ? Math.min(draft.original_volume, 0.5) : 1 }); }} />
      </Screen>
    );
  }

  // ------------------------------------------------------------- details step
  return (
    <Screen header={<ScreenHeader title="Post video" back={false} left={<Button title="Back" variant="ghost" size="sm" leftIcon="chevron-back" onPress={() => setStep('edit')} disabled={publishing} />} />} scroll padded keyboardAvoiding>
      <View style={{ flexDirection: 'row', marginTop: spacing.lg }}>
        <View style={[styles.coverThumb, { backgroundColor: colors.surfaceMuted }]}>
          <Ionicons name="videocam" size={28} color={colors.textMuted} />
          <Text variant="caption" color="textMuted">
            {fmt(trimEnd - draft.trim_start_ms)}
          </Text>
        </View>
        <Input placeholder="Describe your video… #hashtags and @mentions work" value={draft.caption} onChangeText={(caption) => update({ caption })} multiline maxLength={2200} showCounter containerStyle={{ flex: 1, marginLeft: spacing.md }} style={{ minHeight: 110 }} />
      </View>
      <Text variant="label" color="textMuted" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
        Who can watch
      </Text>
      <View style={styles.wrap}>
        {(['public', 'followers', 'friends'] as PostAudience[]).map((a) => (
          <Chip key={a} label={a === 'public' ? 'Everyone' : a === 'followers' ? 'Followers' : 'Friends'} icon={a === 'public' ? 'globe-outline' : a === 'followers' ? 'people-outline' : 'heart-outline'} selected={draft.audience === a} onPress={() => update({ audience: a })} />
        ))}
      </View>
      <View style={{ marginTop: spacing.lg }}>
        <ListItem icon="chatbubble-outline" title="Allow comments" switchValue={draft.allow_comments} onSwitchChange={(v) => update({ allow_comments: v })} />
        <ListItem icon="people-outline" title="Allow duets" switchValue={draft.allow_duet} onSwitchChange={(v) => update({ allow_duet: v })} />
        <ListItem icon="cut-outline" title="Allow stitches" switchValue={draft.allow_stitch} onSwitchChange={(v) => update({ allow_stitch: v })} />
        <ListItem icon="download-outline" title="Allow downloads" switchValue={draft.allow_download} onSwitchChange={(v) => update({ allow_download: v })} />
      </View>
      {sound ? (
        <Text variant="small" color="textMuted" style={{ marginTop: spacing.md }}>
          🎵 {sound.title} · {Math.round(draft.sound_volume * 100)}% · original {Math.round(draft.original_volume * 100)}%
        </Text>
      ) : (
        <Text variant="small" color="textMuted" style={{ marginTop: spacing.md }}>
          Your original audio will be added to the sound library as “Original sound – {profile?.display_name ?? 'you'}”.
        </Text>
      )}
      {publishing ? (
        <View style={[styles.progress, { backgroundColor: colors.surfaceMuted }]}>
          <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${Math.round(progress * 100)}%` }]} />
          <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs }}>
            {progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : 'Publishing…'}
          </Text>
        </View>
      ) : null}
      <View style={[styles.actions, isDesktop && { flexDirection: 'row' }]}>
        <Button title="Save draft" variant="secondary" leftIcon="save-outline" onPress={() => void persistDraft()} disabled={publishing} fullWidth={!isDesktop} />
        <Button title="Post" leftIcon="paper-plane-outline" onPress={() => void publish()} loading={publishing} disabled={!draft.uri} fullWidth={!isDesktop} glow />
      </View>
      {Platform.OS === 'web' ? (
        <Text variant="caption" color="textMuted" align="center" style={{ marginTop: spacing.md }}>
          Large files upload faster from the Friendzy app.
        </Text>
      ) : null}
      {!draft.uri ? <EmptyState compact icon="alert-circle-outline" title="No video selected" description="Go back and pick a video first." /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  refCard: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.lg, marginTop: spacing.lg },
  refThumb: { width: 48, height: 64, borderRadius: radius.sm, backgroundColor: palette.night3 },
  pickRow: { gap: spacing.md, marginTop: spacing.xl },
  pickCard: { flex: 1, alignItems: 'center', padding: spacing['2xl'], borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
  editor: { flex: 1 },
  preview: { flex: 1, margin: spacing.md, minHeight: 320 },
  tools: { paddingBottom: spacing.lg },
  toolTabs: { paddingHorizontal: spacing.md, gap: spacing.lg, paddingVertical: spacing.sm },
  toolTab: { alignItems: 'center', minWidth: 56 },
  toolPanel: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, minHeight: 120 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filterTile: { width: 72, alignItems: 'center', padding: spacing.xs, borderRadius: radius.md, borderWidth: 1.5 },
  filterSwatch: { width: 56, height: 56, borderRadius: radius.sm, marginBottom: 4 },
  colorDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2 },
  sticker: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  stitchBox: { padding: spacing.md, borderRadius: radius.md, marginTop: spacing.sm },
  coverThumb: { width: 84, height: 112, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  progress: { marginTop: spacing.lg, borderRadius: radius.sm, padding: spacing.sm },
  progressFill: { height: 6, borderRadius: 3 },
  actions: { gap: spacing.md, marginTop: spacing['2xl'] },
});
