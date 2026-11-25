import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { ListItem } from '@/components/ui/ListItem';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { ProfileRow } from '@/features/profile/ProfileRow';
import { ReportSheet } from '@/features/profile/ReportSheet';
import { useAsync } from '@/hooks/useAsync';
import { deleteStory, getStoryViewers, getUserStories, markStoryViewed, reactToStory } from '@/services/stories';
import { useAuth } from '@/store/authStore';
import { absoluteFillObject, fontFamily, palette, radius, spacing } from '@/theme/tokens';
import type { StoryCard } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';
import { timeAgo } from '@/utils/format';

import { confirmAction } from '../feed/usePostActions';

const IMAGE_DURATION = 5000;
const QUICK_REACTIONS = ['❤️', '🔥', '😂', '😮', '👏', '😢'];

export interface StoryViewerProps {
  /** Ordered list of author ids to page through. */
  authorIds: string[];
  initialAuthorId: string;
  onClose: () => void;
  /** Optional reply handler (wired to messaging). */
  onReply?: (story: StoryCard, text: string) => Promise<void>;
  /** Custom loader (e.g. highlight stories). Defaults to the author's active stories. */
  loadStories?: (authorId: string) => Promise<StoryCard[]>;
}

function StoryVideo({ uri, playing, onEnd, onDuration }: { uri: string; playing: boolean; onEnd: () => void; onDuration: (ms: number) => void }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.muted = false;
    p.timeUpdateEventInterval = 0.25;
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [playing, player]);
  useEffect(() => {
    if (status === 'readyToPlay' && player.duration) onDuration(player.duration * 1000);
  }, [status, player, onDuration]);
  useEffect(() => {
    const sub = player.addListener('playToEnd', onEnd);
    return () => sub.remove();
  }, [player, onEnd]);
  return (
    <>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      {status === 'loading' ? <ActivityIndicator color={palette.white} style={styles.center} /> : null}
    </>
  );
}

export function StoryViewer({ authorIds, initialAuthorId, onClose, onReply, loadStories }: StoryViewerProps) {
  const { user } = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [authorIndex, setAuthorIndex] = useState(Math.max(0, authorIds.indexOf(initialAuthorId)));
  const [storyIndex, setStoryIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const durationRef = useRef(IMAGE_DURATION);
  const startedAt = useRef(0);
  const elapsedBeforePause = useRef(0);
  const frame = useRef<ReturnType<typeof setInterval> | null>(null);

  const authorId = authorIds[authorIndex];
  const stories = useAsync(() => (loadStories ? loadStories(authorId) : getUserStories(authorId)), [authorId]);
  const list = stories.data ?? [];
  const story = list[storyIndex] as StoryCard | undefined;
  const isOwner = story?.author.id === user?.id;
  const viewers = useAsync(() => (story && isOwner ? getStoryViewers(story.id) : Promise.resolve([])), [story?.id, viewersOpen], { enabled: viewersOpen && Boolean(story) });

  const goNextAuthor = useCallback(() => {
    if (authorIndex < authorIds.length - 1) {
      setAuthorIndex((i) => i + 1);
      setStoryIndex(0);
    } else onClose();
  }, [authorIndex, authorIds.length, onClose]);

  const goNext = useCallback(() => {
    if (storyIndex < list.length - 1) setStoryIndex((i) => i + 1);
    else goNextAuthor();
  }, [storyIndex, list.length, goNextAuthor]);

  const goPrev = useCallback(() => {
    if (storyIndex > 0) setStoryIndex((i) => i - 1);
    else if (authorIndex > 0) {
      setAuthorIndex((i) => i - 1);
      setStoryIndex(0);
    } else setStoryIndex(0);
  }, [storyIndex, authorIndex]);

  // Start from the first unseen story for this author (derived when the list arrives).
  const [indexedData, setIndexedData] = useState(stories.data);
  if (stories.data !== indexedData) {
    setIndexedData(stories.data);
    if (stories.data) {
      const firstUnseen = stories.data.findIndex((s) => !s.viewer.seen && !s.viewer.is_author);
      setStoryIndex(firstUnseen >= 0 ? firstUnseen : 0);
    }
  }

  // Reset the progress bar when the story changes (derived during render).
  const [progressFor, setProgressFor] = useState<string | undefined>(story?.id);
  if (progressFor !== story?.id) {
    setProgressFor(story?.id);
    setProgress(0);
  }

  // Mark viewed + reset timer when story changes.
  useEffect(() => {
    if (!story) return;
    durationRef.current = story.kind === 'video' ? (story.duration_ms ?? 15000) : IMAGE_DURATION;
    elapsedBeforePause.current = 0;
    startedAt.current = Date.now();
    if (!story.viewer.is_author) void markStoryViewed(story.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id]);

  // Progress ticker.
  useEffect(() => {
    if (!story) return;
    if (frame.current) clearInterval(frame.current);
    if (paused || menuOpen || viewersOpen || reportOpen) {
      elapsedBeforePause.current += Date.now() - startedAt.current;
      return;
    }
    startedAt.current = Date.now();
    frame.current = setInterval(() => {
      const elapsed = elapsedBeforePause.current + (Date.now() - startedAt.current);
      const fraction = Math.min(1, elapsed / durationRef.current);
      setProgress(fraction);
      if (fraction >= 1 && story.kind !== 'video') goNext();
    }, 50);
    return () => {
      if (frame.current) clearInterval(frame.current);
    };
  }, [story?.id, paused, menuOpen, viewersOpen, reportOpen, goNext, story]);

  const react = async (emoji: string) => {
    if (!story) return;
    try {
      await reactToStory(story.id, story.viewer.reaction === emoji ? null : emoji);
      stories.setData((prev) => (prev ? prev.map((s) => (s.id === story.id ? { ...s, viewer: { ...s.viewer, reaction: s.viewer.reaction === emoji ? null : emoji } } : s)) : prev));
      toast.success(`Reacted ${emoji}`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const sendReply = async () => {
    if (!story || !onReply || !replyText.trim()) return;
    setSending(true);
    try {
      await onReply(story, replyText.trim());
      setReplyText('');
      toast.success('Reply sent');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSending(false);
    }
  };

  const destroy = () => {
    if (!story) return;
    setMenuOpen(false);
    confirmAction('Delete story?', 'It will disappear for everyone immediately.', 'Delete', async () => {
      try {
        await deleteStory(story.id);
        const remaining = list.filter((s) => s.id !== story.id);
        stories.setData(remaining);
        if (remaining.length === 0) goNextAuthor();
        else setStoryIndex((i) => Math.min(i, remaining.length - 1));
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    });
  };

  const bg = story?.style?.bg ?? '#7000FF';
  const bg2 = story?.style?.bg2 ?? '#FF28B9';
  const frameWidth = Math.min(width, 520);
  const frameHeight = Platform.OS === 'web' ? Math.min(height, (frameWidth * 16) / 9) : height;

  return (
    <View style={[styles.root, { paddingTop: Platform.OS === 'web' ? 0 : insets.top }]}>
      <View style={[styles.frame, { width: frameWidth, height: frameHeight }]}>
        {stories.loading ? (
          <ActivityIndicator color={palette.white} style={styles.center} />
        ) : stories.error || !story ? (
          <View style={styles.center}>
            <Text color={palette.white} align="center">
              {stories.error ?? 'No stories to show'}
            </Text>
            <Pressable onPress={goNextAuthor} style={{ marginTop: spacing.lg }}>
              <Text color={palette.pinkSoft}>Continue</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {story.kind === 'text' ? (
              <LinearGradient colors={[bg, bg2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, styles.textStory]}>
                <Text
                  style={{
                    fontFamily: story.style?.font === 'mono' ? fontFamily.mono : story.style?.font === 'body' ? fontFamily.body : fontFamily.display,
                    fontSize: 30,
                    lineHeight: 40,
                    fontWeight: '700',
                    color: story.style?.color ?? palette.white,
                    textAlign: story.style?.align ?? 'center',
                  }}
                >
                  {story.text}
                </Text>
              </LinearGradient>
            ) : story.kind === 'video' && story.media_url ? (
              <StoryVideo uri={story.media_url} playing={!paused && !menuOpen && !viewersOpen} onEnd={goNext} onDuration={(ms) => (durationRef.current = ms)} />
            ) : (
              <Image source={{ uri: story.media_url ?? undefined }} style={StyleSheet.absoluteFill} contentFit="cover" transition={100} />
            )}
            {story.stickers?.map((s) => (
              <View key={s.id} pointerEvents="none" style={{ position: 'absolute', left: s.x * frameWidth - 20 * s.scale, top: s.y * frameHeight - 20 * s.scale }}>
                <Text style={{ fontSize: 40 * s.scale, lineHeight: 48 * s.scale }}>{s.emoji}</Text>
              </View>
            ))}
            <LinearGradient colors={['rgba(0,0,0,0.55)', 'transparent']} style={styles.topShade} pointerEvents="none" />
            <LinearGradient colors={['transparent', 'rgba(0,0,0,0.6)']} style={styles.bottomShade} pointerEvents="none" />

            {/* Tap zones */}
            <Pressable style={styles.leftZone} onPress={goPrev} onLongPress={() => setPaused(true)} onPressOut={() => setPaused(false)} delayLongPress={180} />
            <Pressable style={styles.rightZone} onPress={goNext} onLongPress={() => setPaused(true)} onPressOut={() => setPaused(false)} delayLongPress={180} />

            {/* Progress */}
            <View style={styles.progressRow} pointerEvents="none">
              {list.map((s, i) => (
                <View key={s.id} style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${i < storyIndex ? 100 : i === storyIndex ? progress * 100 : 0}%` }]} />
                </View>
              ))}
            </View>

            {/* Header */}
            <View style={styles.header}>
              <Pressable
                onPress={() => {
                  onClose();
                  router.navigate(`/u/${story.author.username}` as never);
                }}
                style={styles.headerUser}
              >
                <Avatar uri={story.author.avatar_url} name={story.author.display_name} size={36} />
                <View style={{ marginLeft: spacing.sm }}>
                  <Text variant="bodySemibold" color={palette.white} numberOfLines={1}>
                    {story.author.display_name}
                  </Text>
                  <Text variant="caption" color="rgba(255,255,255,0.75)">
                    {timeAgo(story.created_at)}
                    {story.music_title ? ` · ♪ ${story.music_title}` : ''}
                  </Text>
                </View>
              </Pressable>
              <Pressable onPress={() => setMenuOpen(true)} hitSlop={8} style={styles.iconBtn} accessibilityLabel="Story options">
                <Ionicons name="ellipsis-horizontal" size={22} color={palette.white} />
              </Pressable>
              <Pressable onPress={onClose} hitSlop={8} style={styles.iconBtn} accessibilityLabel="Close">
                <Ionicons name="close" size={26} color={palette.white} />
              </Pressable>
            </View>

            {story.caption ? (
              <View style={styles.caption} pointerEvents="none">
                <Text variant="body" color={palette.white} align="center">
                  {story.caption}
                </Text>
              </View>
            ) : null}

            {/* Footer */}
            <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
              {isOwner ? (
                <Pressable onPress={() => setViewersOpen(true)} style={styles.viewersBtn}>
                  <Ionicons name="eye-outline" size={18} color={palette.white} />
                  <Text variant="smallMedium" color={palette.white} style={{ marginLeft: 6 }}>
                    {story.views_count} view{story.views_count === 1 ? '' : 's'}
                  </Text>
                </Pressable>
              ) : (
                <>
                  <View style={styles.reactions}>
                    {QUICK_REACTIONS.map((emoji) => (
                      <Pressable key={emoji} onPress={() => react(emoji)} style={[styles.reaction, story.viewer.reaction === emoji && styles.reactionActive]} accessibilityLabel={`React ${emoji}`}>
                        <Text style={{ fontSize: 24, lineHeight: 30 }}>{emoji}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {onReply ? (
                    <View style={styles.replyRow}>
                      <Pressable onPressIn={() => setPaused(true)} style={styles.replyInputWrap}>
                        <TextInputCompat value={replyText} onChangeText={setReplyText} placeholder={`Reply to ${story.author.display_name.split(' ')[0]}…`} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)} onSubmit={sendReply} />
                      </Pressable>
                      <Pressable onPress={sendReply} disabled={!replyText.trim() || sending} style={[styles.sendBtn, { opacity: replyText.trim() ? 1 : 0.5 }]} accessibilityLabel="Send reply">
                        {sending ? <ActivityIndicator color={palette.white} size="small" /> : <Ionicons name="paper-plane" size={18} color={palette.white} />}
                      </Pressable>
                    </View>
                  ) : null}
                </>
              )}
            </View>
          </>
        )}
      </View>

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="Story">
        {isOwner ? (
          <>
            <ListItem icon="eye-outline" title="Viewers" onPress={() => { setMenuOpen(false); setTimeout(() => setViewersOpen(true), 200); }} />
            <ListItem icon="trash-outline" title="Delete story" danger onPress={destroy} />
          </>
        ) : (
          <>
            <ListItem icon="person-outline" title="View profile" onPress={() => { setMenuOpen(false); onClose(); if (story) router.navigate(`/u/${story.author.username}` as never); }} />
            <ListItem icon="flag-outline" title="Report story" danger onPress={() => { setMenuOpen(false); setTimeout(() => setReportOpen(true), 250); }} />
          </>
        )}
        <View style={{ height: spacing.lg }} />
      </Sheet>

      <Sheet visible={viewersOpen} onClose={() => setViewersOpen(false)} title="Viewers" subtitle={story ? `${story.views_count} view${story.views_count === 1 ? '' : 's'}` : undefined}>
        {viewers.loading ? (
          <ActivityIndicator style={{ padding: spacing['2xl'] }} />
        ) : (viewers.data ?? []).length === 0 ? (
          <Text variant="body" color="textMuted" align="center" style={{ paddingVertical: spacing['2xl'] }}>
            No views yet.
          </Text>
        ) : (
          (viewers.data ?? []).map((v) => (
            <ProfileRow key={v.user.id} profile={{ ...v.user, bio: null, followers_count: 0 }} showBio={false} subtitle={`@${v.user.username} · ${timeAgo(v.viewed_at)}`} right={v.reaction ? <Text style={{ fontSize: 22 }}>{v.reaction}</Text> : undefined} onPress={() => { setViewersOpen(false); onClose(); router.navigate(`/u/${v.user.username}` as never); }} />
          ))
        )}
        <View style={{ height: spacing.lg }} />
      </Sheet>
      {story ? <ReportSheet visible={reportOpen} onClose={() => setReportOpen(false)} targetType="other" targetId={story.id} targetLabel="story" /> : null}
    </View>
  );
}

// Minimal text input that avoids pulling RN TextInput styling boilerplate into the viewer.
function TextInputCompat({ value, onChangeText, placeholder, onFocus, onBlur, onSubmit }: { value: string; onChangeText: (v: string) => void; placeholder: string; onFocus: () => void; onBlur: () => void; onSubmit: () => void }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="rgba(255,255,255,0.6)"
      onFocus={onFocus}
      onBlur={onBlur}
      onSubmitEditing={onSubmit}
      returnKeyType="send"
      style={{ color: palette.white, fontFamily: fontFamily.body, fontSize: 15, paddingVertical: 10, paddingHorizontal: 14, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) }}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.black, alignItems: 'center', justifyContent: 'center' },
  frame: { backgroundColor: palette.night, overflow: 'hidden', borderRadius: Platform.OS === 'web' ? radius.xl : 0 },
  center: { ...absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  textStory: { alignItems: 'center', justifyContent: 'center', padding: spacing['3xl'] },
  topShade: { position: 'absolute', top: 0, left: 0, right: 0, height: 140 },
  bottomShade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 200 },
  leftZone: { position: 'absolute', left: 0, top: 100, bottom: 140, width: '35%' },
  rightZone: { position: 'absolute', right: 0, top: 100, bottom: 140, width: '65%' },
  progressRow: { position: 'absolute', top: spacing.sm, left: spacing.sm, right: spacing.sm, flexDirection: 'row', gap: 4 },
  progressTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  progressFill: { height: 3, backgroundColor: palette.white },
  header: { position: 'absolute', top: spacing.lg, left: spacing.md, right: spacing.sm, flexDirection: 'row', alignItems: 'center' },
  headerUser: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  caption: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: 140, backgroundColor: 'rgba(9,8,23,0.45)', borderRadius: radius.md, padding: spacing.md },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.md },
  viewersBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: 'rgba(9,8,23,0.45)', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full },
  reactions: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: spacing.md },
  reaction: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  reactionActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  replyRow: { flexDirection: 'row', alignItems: 'center' },
  replyInputWrap: { flex: 1, borderRadius: radius.full, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)', marginRight: spacing.sm },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.purple, alignItems: 'center', justifyContent: 'center' },
});
