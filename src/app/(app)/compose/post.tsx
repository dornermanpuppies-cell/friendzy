import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { ListItem } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { confirmAction } from '@/features/feed/usePostActions';
import { captureMedia, pickMedia, type PickedMedia } from '@/services/media';
import { createPost, editPost, getPost, uploadMediaItem, type UploadedMedia } from '@/services/posts';
import { useAuth } from '@/store/authStore';
import { usePostStore } from '@/store/postStore';
import { useTheme } from '@/theme/ThemeProvider';
import { absoluteFillObject, fontFamily, palette, radius, spacing } from '@/theme/tokens';
import type { PostAudience, PostType } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';

const DRAFT_KEY = 'friendzy.post-draft';
const MAX_TEXT = 2200;

type Mode = 'text' | 'media' | 'poll' | 'question';

const AUDIENCES: { id: PostAudience; label: string; icon: keyof typeof Ionicons.glyphMap; description: string }[] = [
  { id: 'public', label: 'Everyone', icon: 'earth-outline', description: 'Anyone on Friendzy (followers only if your account is private)' },
  { id: 'followers', label: 'Followers', icon: 'people-outline', description: 'People who follow you' },
  { id: 'friends', label: 'Friends', icon: 'heart-outline', description: 'Only your friends' },
];

const POLL_DURATIONS = [
  { label: '1 day', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
  { label: 'No end', hours: null },
];

interface Draft {
  text: string;
  audience: PostAudience;
  mode: Mode;
  pollOptions: string[];
  pollMultiple: boolean;
  pollHours: number | null;
  locationName: string;
  allowComments: boolean;
}

export default function ComposePostScreen() {
  const params = useLocalSearchParams<{ text?: string; edit?: string; share?: string }>();
  const { profile, user } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const upsert = usePostStore((s) => s.upsert);

  const [mode, setMode] = useState<Mode>('text');
  const [text, setText] = useState(params.text ?? '');
  const [audience, setAudience] = useState<PostAudience>('public');
  const [allowComments, setAllowComments] = useState(true);
  const [locationName, setLocationName] = useState('');
  const [media, setMedia] = useState<PickedMedia[]>([]);
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollMultiple, setPollMultiple] = useState(false);
  const [pollHours, setPollHours] = useState<number | null>(24);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ index: number; fraction: number } | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(() => Boolean(params.edit || params.text || params.share));
  const editingId = params.edit ?? null;
  const sharePostId = params.share ?? null;
  const shared = usePostStore((s) => (sharePostId ? s.byId[sharePostId] : undefined));

  // Restore draft (new posts only).
  useEffect(() => {
    if (editingId || params.text || sharePostId) return;
    AsyncStorage.getItem(DRAFT_KEY)
      .then((raw) => {
        if (!raw) return;
        const draft = JSON.parse(raw) as Draft;
        setText(draft.text ?? '');
        setAudience(draft.audience ?? 'public');
        setMode(draft.mode === 'media' ? 'text' : (draft.mode ?? 'text'));
        setPollOptions(draft.pollOptions?.length ? draft.pollOptions : ['', '']);
        setPollMultiple(Boolean(draft.pollMultiple));
        setPollHours(draft.pollHours ?? 24);
        setLocationName(draft.locationName ?? '');
        setAllowComments(draft.allowComments ?? true);
      })
      .catch(() => undefined)
      .finally(() => setDraftLoaded(true));
  }, [editingId, params.text, sharePostId]);

  // Load the post being edited.
  useEffect(() => {
    if (!editingId) return;
    getPost(editingId)
      .then((post) => {
        setText(post.text ?? '');
        setAudience(post.audience);
        setAllowComments(post.allow_comments);
        setMode(post.type === 'poll' ? 'poll' : post.type === 'question' ? 'question' : post.media.length ? 'media' : 'text');
      })
      .catch((error) => toast.error(getErrorMessage(error)));
  }, [editingId, toast]);

  // Persist draft.
  useEffect(() => {
    if (!draftLoaded || editingId || sharePostId) return;
    const draft: Draft = { text, audience, mode, pollOptions, pollMultiple, pollHours, locationName, allowComments };
    const empty = !text.trim() && pollOptions.every((o) => !o.trim()) && !locationName;
    (empty ? AsyncStorage.removeItem(DRAFT_KEY) : AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft))).catch(() => undefined);
  }, [draftLoaded, editingId, sharePostId, text, audience, mode, pollOptions, pollMultiple, pollHours, locationName, allowComments]);

  const addMedia = async (source: 'library' | 'camera' | 'video') => {
    try {
      if (source === 'library') {
        const picked = await pickMedia({ multiple: true, max: 10 - media.length });
        if (picked.length) {
          setMedia((m) => [...m, ...picked].slice(0, 10));
          setMode('media');
        }
      } else {
        const captured = await captureMedia(source === 'video' ? 'video' : 'image');
        if (captured) {
          setMedia((m) => [...m, captured].slice(0, 10));
          setMode('media');
        }
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const type: PostType = useMemo(() => {
    if (sharePostId) return 'share';
    if (mode === 'poll') return 'poll';
    if (mode === 'question') return 'question';
    if (media.length > 1) return 'carousel';
    if (media.length === 1) return media[0].kind === 'video' ? 'video' : 'photo';
    return 'text';
  }, [mode, media, sharePostId]);

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (type === 'poll') return text.trim().length > 0 && pollOptions.filter((o) => o.trim()).length >= 2;
    if (type === 'share') return true;
    if (media.length > 0) return true;
    return text.trim().length > 0;
  }, [submitting, type, text, pollOptions, media.length]);

  const submit = async () => {
    if (!user || !canSubmit) return;
    setSubmitting(true);
    try {
      if (editingId) {
        const updated = await editPost(editingId, { text: text.trim(), audience, allowComments });
        upsert(updated);
        toast.success('Post updated');
        router.back();
        return;
      }
      const uploaded: UploadedMedia[] = [];
      for (let i = 0; i < media.length; i += 1) {
        setProgress({ index: i, fraction: 0 });
        const item = media[i];
        uploaded.push(await uploadMediaItem(user.id, 'posts', { uri: item.uri, kind: item.kind, mime: item.mime, width: item.width, height: item.height, durationMs: item.durationMs }, (p) => setProgress({ index: i, fraction: p.fraction })));
      }
      setProgress(null);
      const post = await createPost({
        type,
        text: text.trim() || undefined,
        audience,
        allowComments,
        media: uploaded,
        poll: type === 'poll' ? { options: pollOptions.map((o) => o.trim()).filter(Boolean), multiple: pollMultiple, durationHours: pollHours } : undefined,
        sharedPostId: sharePostId ?? undefined,
        locationName: locationName.trim() || undefined,
      });
      upsert(post);
      await AsyncStorage.removeItem(DRAFT_KEY).catch(() => undefined);
      toast.success('Posted!');
      if (router.canGoBack()) router.back();
      else router.replace('/home');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  };

  const discard = () => {
    const dirty = text.trim() || media.length || pollOptions.some((o) => o.trim());
    const leave = () => {
      AsyncStorage.removeItem(DRAFT_KEY).catch(() => undefined);
      if (router.canGoBack()) router.back();
      else router.replace('/home');
    };
    if (!dirty || editingId) {
      leave();
      return;
    }
    if (Platform.OS === 'web') {
      leave();
      return;
    }
    confirmAction('Discard post?', 'Your draft will be kept so you can finish later.', 'Keep draft & close', () => {
      if (router.canGoBack()) router.back();
      else router.replace('/home');
    });
  };

  const audienceMeta = AUDIENCES.find((a) => a.id === audience)!;

  return (
    <Screen
      header={
        <ScreenHeader
          title={editingId ? 'Edit post' : sharePostId ? 'Share post' : 'New post'}
          left={
            <Pressable onPress={discard} hitSlop={8} style={styles.headerBtn} accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          }
          right={<Button title={editingId ? 'Save' : 'Post'} size="sm" onPress={submit} disabled={!canSubmit} loading={submitting} />}
        />
      }
      padded={false}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.authorRow}>
          <Avatar uri={profile?.avatar_url} name={profile?.display_name} size={44} />
          <View style={{ marginLeft: spacing.md, flex: 1 }}>
            <Text variant="bodySemibold">{profile?.display_name}</Text>
            <Pressable onPress={() => setAudienceOpen(true)} style={[styles.audienceChip, { borderColor: colors.border }]} accessibilityLabel="Choose audience">
              <Ionicons name={audienceMeta.icon} size={14} color={colors.primary} />
              <Text variant="caption" color="primary" style={{ marginHorizontal: 4 }}>
                {audienceMeta.label}
              </Text>
              <Ionicons name="chevron-down" size={12} color={colors.primary} />
            </Pressable>
          </View>
        </View>

        <TextInput
          value={text}
          onChangeText={(v) => setText(v.slice(0, MAX_TEXT))}
          placeholder={mode === 'poll' ? 'Ask your question…' : mode === 'question' ? 'Ask the community anything…' : sharePostId ? 'Say something about this…' : "What's happening?"}
          placeholderTextColor={colors.placeholder}
          multiline
          autoFocus={Platform.OS !== 'web'}
          style={[styles.input, { color: colors.text }]}
        />

        {media.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mediaStrip}>
            {media.map((m, i) => (
              <View key={`${m.uri}-${i}`} style={[styles.mediaThumb, { backgroundColor: colors.skeleton }]}>
                <Image source={{ uri: m.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                {m.kind === 'video' ? (
                  <View style={styles.videoBadge}>
                    <Ionicons name="videocam" size={14} color={palette.white} />
                  </View>
                ) : null}
                {progress && progress.index === i ? (
                  <View style={styles.progressOverlay}>
                    <Text variant="caption" color={palette.white}>
                      {Math.round(progress.fraction * 100)}%
                    </Text>
                  </View>
                ) : null}
                {!submitting ? (
                  <Pressable onPress={() => setMedia((list) => list.filter((_, j) => j !== i))} style={styles.removeBtn} accessibilityLabel="Remove media">
                    <Ionicons name="close" size={14} color={palette.white} />
                  </Pressable>
                ) : null}
              </View>
            ))}
            {media.length < 10 ? (
              <Pressable onPress={() => addMedia('library')} style={[styles.mediaThumb, styles.addThumb, { borderColor: colors.border }]} accessibilityLabel="Add more media">
                <Ionicons name="add" size={28} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </ScrollView>
        ) : null}

        {shared ? (
          <View style={[styles.sharePreview, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
            <Text variant="smallMedium">{shared.author.display_name}</Text>
            <Text variant="small" color="textSecondary" numberOfLines={3}>
              {shared.text ?? (shared.media.length ? 'Media post' : '')}
            </Text>
          </View>
        ) : null}

        {mode === 'poll' ? (
          <View style={[styles.pollBox, { borderColor: colors.border }]}>
            {pollOptions.map((option, i) => (
              <Input
                key={i}
                placeholder={`Option ${i + 1}${i >= 2 ? ' (optional)' : ''}`}
                value={option}
                onChangeText={(v) => setPollOptions((opts) => opts.map((o, j) => (j === i ? v.slice(0, 80) : o)))}
                maxLength={80}
                containerStyle={{ marginBottom: spacing.sm }}
                rightElement={
                  i >= 2 ? (
                    <Pressable onPress={() => setPollOptions((opts) => opts.filter((_, j) => j !== i))} hitSlop={8} accessibilityLabel="Remove option">
                      <Ionicons name="close" size={18} color={colors.textMuted} />
                    </Pressable>
                  ) : null
                }
              />
            ))}
            {pollOptions.length < 4 ? <Button title="Add option" variant="ghost" size="sm" leftIcon="add" onPress={() => setPollOptions((o) => [...o, ''])} /> : null}
            <View style={styles.pollMeta}>
              <Text variant="smallMedium" color="textSecondary">
                Poll length
              </Text>
              <View style={styles.wrap}>
                {POLL_DURATIONS.map((d) => (
                  <Chip key={d.label} label={d.label} size="sm" selected={pollHours === d.hours} onPress={() => setPollHours(d.hours)} />
                ))}
              </View>
              <ListItem title="Allow multiple answers" switchValue={pollMultiple} onSwitchChange={setPollMultiple} style={{ paddingHorizontal: 0 }} />
            </View>
          </View>
        ) : null}

        {locationName ? (
          <Pressable onPress={() => setLocationOpen(true)} style={styles.locationRow}>
            <Ionicons name="location" size={16} color={colors.primary} />
            <Text variant="small" color="primary" style={{ marginLeft: 4 }}>
              {locationName}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {/* Toolbar */}
      <View style={[styles.toolbar, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        {!editingId && !sharePostId ? (
          <>
            <ToolButton icon="images-outline" label="Photos" onPress={() => addMedia('library')} disabled={mode === 'poll'} />
            {Platform.OS !== 'web' ? <ToolButton icon="camera-outline" label="Camera" onPress={() => addMedia('camera')} disabled={mode === 'poll'} /> : null}
            <ToolButton icon="stats-chart-outline" label="Poll" active={mode === 'poll'} onPress={() => setMode((m) => (m === 'poll' ? 'text' : 'poll'))} disabled={media.length > 0} />
            <ToolButton icon="help-circle-outline" label="Question" active={mode === 'question'} onPress={() => setMode((m) => (m === 'question' ? 'text' : 'question'))} disabled={media.length > 0} />
            <ToolButton icon="location-outline" label="Place" active={Boolean(locationName)} onPress={() => setLocationOpen(true)} />
          </>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <Text variant="caption" color={text.length > MAX_TEXT - 100 ? 'warning' : 'textMuted'}>
          {text.length}/{MAX_TEXT}
        </Text>
      </View>

      <Sheet visible={audienceOpen} onClose={() => setAudienceOpen(false)} title="Who can see this?">
        {AUDIENCES.map((a) => (
          <ListItem
            key={a.id}
            icon={a.icon}
            title={a.label}
            subtitle={a.description}
            right={audience === a.id ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : undefined}
            onPress={() => {
              setAudience(a.id);
              setAudienceOpen(false);
            }}
            showChevron={false}
          />
        ))}
        <ListItem icon="chatbubble-ellipses-outline" title="Allow comments" switchValue={allowComments} onSwitchChange={setAllowComments} />
        <View style={{ height: spacing.lg }} />
      </Sheet>

      <Sheet visible={locationOpen} onClose={() => setLocationOpen(false)} title="Add a place" subtitle="A place name you type yourself — your device location is not used.">
        <Input placeholder="e.g. Lisbon, Portugal" value={locationName} onChangeText={(v) => setLocationName(v.slice(0, 100))} maxLength={100} autoFocus />
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.lg }}>
          <Button title="Done" onPress={() => setLocationOpen(false)} />
          {locationName ? <Button title="Remove" variant="ghost" onPress={() => { setLocationName(''); setLocationOpen(false); }} /> : null}
        </View>
      </Sheet>
    </Screen>
  );
}

function ToolButton({ icon, label, onPress, active, disabled }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; active?: boolean; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityLabel={label} style={[styles.tool, active && { backgroundColor: colors.primarySoft }, disabled && { opacity: 0.4 }]}>
      <Ionicons name={icon} size={22} color={active ? colors.primary : colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing['3xl'] },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  authorRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.lg },
  audienceChip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3, marginTop: 4 },
  input: { fontFamily: fontFamily.body, fontSize: 18, lineHeight: 26, minHeight: 120, textAlignVertical: 'top', ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  mediaStrip: { gap: spacing.sm, paddingVertical: spacing.md },
  mediaThumb: { width: 120, height: 120, borderRadius: radius.md, overflow: 'hidden' },
  addThumb: { borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  videoBadge: { position: 'absolute', left: 6, bottom: 6, backgroundColor: 'rgba(9,8,23,0.6)', borderRadius: 8, padding: 3 },
  removeBtn: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(9,8,23,0.7)', alignItems: 'center', justifyContent: 'center' },
  progressOverlay: { ...absoluteFillObject, backgroundColor: 'rgba(9,8,23,0.55)', alignItems: 'center', justifyContent: 'center' },
  sharePreview: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.md },
  pollBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.md },
  pollMeta: { marginTop: spacing.md, gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md },
  toolbar: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs },
  tool: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
