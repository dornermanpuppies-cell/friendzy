import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ListItem } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Sheet } from '@/components/ui/Sheet';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { createChallenge, createPlaylist, deleteDraft, deletePlaylist, fetchUserVideos, getChallenges, getCreatorAnalytics, getPlaylists, getVideoAnalytics, listDrafts, updatePlaylist, updateVideo } from '@/services/videos';
import { useAuth } from '@/store/authStore';
import { useVideoStore } from '@/store/videoStore';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { PostAudience } from '@/types/social';
import type { VideoCard } from '@/types/video';
import { getErrorMessage } from '@/utils/errors';
import { formatCount, formatDate } from '@/utils/format';

type Tab = 'overview' | 'videos' | 'drafts' | 'playlists' | 'challenges';
const TABS: { id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'overview', label: 'Overview', icon: 'stats-chart-outline' },
  { id: 'videos', label: 'Videos', icon: 'videocam-outline' },
  { id: 'drafts', label: 'Drafts', icon: 'document-outline' },
  { id: 'playlists', label: 'Playlists', icon: 'albums-outline' },
  { id: 'challenges', label: 'Challenges', icon: 'trophy-outline' },
];

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card style={styles.stat}>
      <Text variant="h3">{value}</Text>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      {hint ? (
        <Text variant="caption" color="textMuted">
          {hint}
        </Text>
      ) : null}
    </Card>
  );
}

function Bars({ data, color }: { data: { label: string; value: number }[]; color: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={styles.bars}>
      {data.map((d, i) => (
        <View key={i} style={styles.barCol}>
          <View style={[styles.bar, { height: Math.max(2, (d.value / max) * 80), backgroundColor: color }]} />
        </View>
      ))}
    </View>
  );
}

export default function StudioScreen() {
  const params = useLocalSearchParams<{ tab?: Tab; video?: string; edit?: string }>();
  const { user } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(params.tab ?? 'overview');
  const [days, setDays] = useState(28);
  const [analyticsVideo, setAnalyticsVideo] = useState<string | null>(params.video ?? null);
  const [editVideo, setEditVideo] = useState<VideoCard | null>(null);
  const [newPlaylist, setNewPlaylist] = useState<{ title: string; description: string } | null>(null);
  const [addTo, setAddTo] = useState<string | null>(null);
  const [newChallenge, setNewChallenge] = useState<{ tag: string; title: string; description: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const patch = useVideoStore((s) => s.patch);

  const analytics = useAsync(() => getCreatorAnalytics(days), [days], { enabled: tab === 'overview' });
  const videos = usePagedQuery<VideoCard>((cursor) => fetchUserVideos(user!.id, typeof cursor === 'string' ? cursor : null), (v) => v.id, `studio:${user?.id ?? ''}`, { enabled: Boolean(user) });
  const drafts = useAsync(() => (user ? listDrafts(user.id) : Promise.resolve([])), [user?.id, tab]);
  const playlists = useAsync(() => (user ? getPlaylists(user.id) : Promise.resolve([])), [user?.id, tab]);
  const challenges = useAsync(() => getChallenges(30), [tab]);
  const videoAnalytics = useAsync(() => (analyticsVideo ? getVideoAnalytics(analyticsVideo) : Promise.resolve(null)), [analyticsVideo]);

  const [consumedEdit, setConsumedEdit] = useState<string | null>(null);
  if (params.edit && params.edit !== consumedEdit) {
    const v = videos.items.find((x) => x.id === params.edit);
    if (v) {
      setConsumedEdit(params.edit);
      setEditVideo(v);
    }
  }

  const saveEdit = async () => {
    if (!editVideo) return;
    setSaving(true);
    try {
      const updated = await updateVideo(editVideo.id, { caption: editVideo.caption, audience: editVideo.audience, allow_comments: editVideo.allow_comments, allow_duet: editVideo.allow_duet, allow_stitch: editVideo.allow_stitch, allow_download: editVideo.allow_download });
      patch(updated.id, updated);
      videos.setItems((items) => items.map((v) => (v.id === updated.id ? updated : v)));
      toast.success('Video updated');
      setEditVideo(null);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const content = () => {
    if (tab === 'overview') {
      const a = analytics.data;
      return (
        <View>
          <View style={styles.wrap}>
            {[7, 28, 90].map((d) => (
              <Chip key={d} label={`${d} days`} size="sm" selected={days === d} onPress={() => setDays(d)} />
            ))}
          </View>
          {analytics.loading || !a ? (
            <SkeletonList count={4} />
          ) : (
            <>
              <View style={styles.statGrid}>
                <Stat label="Views" value={formatCount(a.totals.views)} />
                <Stat label="Likes" value={formatCount(a.totals.likes)} />
                <Stat label="Comments" value={formatCount(a.totals.comments)} />
                <Stat label="New followers" value={formatCount(a.totals.new_followers)} hint={`${formatCount(a.totals.followers)} total`} />
                <Stat label="Avg. watch" value={`${(a.totals.avg_watch_ms / 1000).toFixed(1)}s`} />
                <Stat label="Completion" value={`${Math.round(a.totals.completion_rate * 100)}%`} />
              </View>
              <Card style={{ marginTop: spacing.md }}>
                <Text variant="smallMedium">Daily views</Text>
                <Bars data={a.daily.map((d) => ({ label: d.day, value: d.views }))} color={colors.primary} />
                <Text variant="caption" color="textMuted">
                  {formatDate(a.daily[0]?.day, 'd MMM')} → {formatDate(a.daily[a.daily.length - 1]?.day, 'd MMM')}
                </Text>
              </Card>
              <Text variant="h4" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
                Top videos
              </Text>
              {a.top_videos.length === 0 ? (
                <EmptyState compact emoji="🎬" title="No videos yet" description="Publish your first short video to see analytics." action={{ title: 'Create a video', onPress: () => router.navigate('/compose/video' as never) }} />
              ) : (
                a.top_videos.map((v) => <VideoRow key={v.id} video={v} onPress={() => setAnalyticsVideo(v.id)} />)
              )}
            </>
          )}
        </View>
      );
    }
    if (tab === 'videos') {
      return videos.loading ? (
        <SkeletonList count={6} />
      ) : videos.items.length === 0 ? (
        <EmptyState compact emoji="🎬" title="No videos yet" description="Your published videos appear here with per-video analytics." action={{ title: 'Create a video', onPress: () => router.navigate('/compose/video' as never) }} />
      ) : (
        <View>
          {videos.items.map((v) => (
            <VideoRow key={v.id} video={v} onPress={() => setAnalyticsVideo(v.id)} right={<Button title="Edit" size="sm" variant="ghost" onPress={() => setEditVideo(v)} />} />
          ))}
          {videos.hasMore ? <Button title="Load more" variant="ghost" onPress={() => void videos.loadMore()} loading={videos.loadingMore} /> : null}
        </View>
      );
    }
    if (tab === 'drafts') {
      return drafts.loading ? (
        <SkeletonList count={3} />
      ) : !drafts.data || drafts.data.length === 0 ? (
        <EmptyState compact emoji="📝" title="No drafts" description="Save a draft from the video composer to continue later." />
      ) : (
        drafts.data.map((d) => (
          <ListItem key={d.id} icon="document-outline" title={d.data.caption?.trim() ? d.data.caption.slice(0, 60) : 'Untitled draft'} subtitle={`Saved ${formatDate(d.updated_at, 'd MMM, HH:mm')}`} onPress={() => router.navigate(`/compose/video?draft=${d.id}` as never)} right={<Pressable onPress={() => void deleteDraft(d.id).then(() => drafts.refresh())} hitSlop={8} accessibilityLabel="Delete draft"><Ionicons name="trash-outline" size={18} color={colors.textMuted} /></Pressable>} />
        ))
      );
    }
    if (tab === 'playlists') {
      return (
        <View>
          <Button title="New playlist" leftIcon="add" variant="secondary" onPress={() => setNewPlaylist({ title: '', description: '' })} style={{ alignSelf: 'flex-start', marginBottom: spacing.md }} />
          {playlists.loading ? (
            <SkeletonList count={3} />
          ) : !playlists.data || playlists.data.length === 0 ? (
            <EmptyState compact emoji="📂" title="No playlists" description="Group your videos into series your audience can binge." />
          ) : (
            playlists.data.map((p) => (
              <ListItem
                key={p.id}
                left={p.cover_url ? <Image source={{ uri: p.cover_url }} style={styles.playlistCover} /> : <View style={[styles.playlistCover, { backgroundColor: colors.surfaceMuted }]} />}
                title={p.title}
                subtitle={`${p.videos_count ?? 0} videos · ${p.is_public ? 'Public' : 'Private'}`}
                onPress={() => router.navigate(`/playlist/${p.id}?title=${encodeURIComponent(p.title)}` as never)}
                right={
                  <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                    <Button title="Add" size="sm" variant="ghost" onPress={() => setAddTo(p.id)} />
                    <Pressable onPress={() => void deletePlaylist(p.id).then(() => playlists.refresh())} hitSlop={8} accessibilityLabel="Delete playlist" style={{ justifyContent: 'center' }}>
                      <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                    </Pressable>
                  </View>
                }
              />
            ))
          )}
        </View>
      );
    }
    return (
      <View>
        <Button title="Start a challenge" leftIcon="trophy-outline" variant="secondary" onPress={() => setNewChallenge({ tag: '', title: '', description: '' })} style={{ alignSelf: 'flex-start', marginBottom: spacing.md }} />
        {challenges.loading ? (
          <SkeletonList count={3} />
        ) : !challenges.data || challenges.data.length === 0 ? (
          <EmptyState compact emoji="🏆" title="No challenges yet" description="Start a hashtag challenge and invite creators to join." />
        ) : (
          challenges.data.map((c) => <ListItem key={c.id} icon="trophy-outline" title={c.title} subtitle={`#${c.tag} · ${formatCount(c.videos_count ?? 0)} videos${c.creator ? ` · by @${c.creator.username}` : ''}`} onPress={() => router.navigate(`/challenge/${c.tag}` as never)} />)
        )}
      </View>
    );
  };

  return (
    <Screen header={<ScreenHeader title="Creator Studio" fallbackHref="/profile" />} scroll padded>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.wrap, { paddingVertical: spacing.md }]}>
        {TABS.map((t) => (
          <Chip key={t.id} label={t.label} icon={t.icon} size="sm" selected={tab === t.id} onPress={() => setTab(t.id)} />
        ))}
      </ScrollView>
      {content()}

      {/* Per-video analytics */}
      <Sheet visible={Boolean(analyticsVideo)} onClose={() => setAnalyticsVideo(null)} title="Video analytics">
        {videoAnalytics.loading || !videoAnalytics.data ? (
          <SkeletonList count={3} />
        ) : (
          <View>
            <VideoRow video={videoAnalytics.data.video} onPress={() => router.navigate(`/video/${videoAnalytics.data!.video.id}` as never)} />
            <View style={styles.statGrid}>
              <Stat label="Views" value={formatCount(videoAnalytics.data.video.views_count)} />
              <Stat label="Unique viewers" value={formatCount(videoAnalytics.data.unique_viewers)} />
              <Stat label="Avg. watch" value={`${(videoAnalytics.data.avg_watch_ms / 1000).toFixed(1)}s`} />
              <Stat label="Completion" value={`${Math.round(videoAnalytics.data.completion_rate * 100)}%`} />
              <Stat label="Likes" value={formatCount(videoAnalytics.data.video.likes_count)} />
              <Stat label="Shares" value={formatCount(videoAnalytics.data.video.shares_count)} />
            </View>
            <Bars data={videoAnalytics.data.views_by_day.map((d) => ({ label: d.day, value: d.views }))} color={colors.accent} />
          </View>
        )}
      </Sheet>

      {/* Edit video details */}
      <Sheet visible={Boolean(editVideo)} onClose={() => setEditVideo(null)} title="Edit video" footer={<Button title="Save" onPress={() => void saveEdit()} loading={saving} fullWidth />}>
        {editVideo ? (
          <View>
            <Input label="Caption" value={editVideo.caption ?? ''} onChangeText={(caption) => setEditVideo({ ...editVideo, caption })} multiline maxLength={2200} />
            <Text variant="label" color="textMuted" style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
              Audience
            </Text>
            <View style={styles.wrap}>
              {(['public', 'followers', 'friends'] as PostAudience[]).map((a) => (
                <Chip key={a} label={a === 'public' ? 'Everyone' : a === 'followers' ? 'Followers' : 'Friends'} size="sm" selected={editVideo.audience === a} onPress={() => setEditVideo({ ...editVideo, audience: a })} />
              ))}
            </View>
            <ListItem icon="chatbubble-outline" title="Allow comments" switchValue={editVideo.allow_comments} onSwitchChange={(v) => setEditVideo({ ...editVideo, allow_comments: v })} />
            <ListItem icon="people-outline" title="Allow duets" switchValue={editVideo.allow_duet} onSwitchChange={(v) => setEditVideo({ ...editVideo, allow_duet: v })} />
            <ListItem icon="cut-outline" title="Allow stitches" switchValue={editVideo.allow_stitch} onSwitchChange={(v) => setEditVideo({ ...editVideo, allow_stitch: v })} />
            <ListItem icon="download-outline" title="Allow downloads" switchValue={editVideo.allow_download} onSwitchChange={(v) => setEditVideo({ ...editVideo, allow_download: v })} />
          </View>
        ) : null}
      </Sheet>

      {/* New playlist */}
      <Sheet visible={Boolean(newPlaylist)} onClose={() => setNewPlaylist(null)} title="New playlist" footer={<Button title="Create" fullWidth disabled={!newPlaylist?.title.trim()} loading={saving} onPress={async () => { if (!newPlaylist) return; setSaving(true); try { await createPlaylist(newPlaylist.title.trim(), newPlaylist.description.trim() || undefined); setNewPlaylist(null); await playlists.refresh(); } catch (e) { toast.error(getErrorMessage(e)); } finally { setSaving(false); } }} />}>
        {newPlaylist ? (
          <View>
            <Input label="Title" value={newPlaylist.title} onChangeText={(title) => setNewPlaylist({ ...newPlaylist, title })} maxLength={60} />
            <Input label="Description" value={newPlaylist.description} onChangeText={(description) => setNewPlaylist({ ...newPlaylist, description })} maxLength={300} multiline containerStyle={{ marginTop: spacing.md }} />
          </View>
        ) : null}
      </Sheet>

      {/* Add videos to a playlist */}
      <Sheet visible={Boolean(addTo)} onClose={() => setAddTo(null)} title="Add videos">
        {videos.items.length === 0 ? (
          <EmptyState compact emoji="🎬" title="No videos to add" description="Publish videos first." />
        ) : (
          videos.items.map((v) => (
            <VideoRow
              key={v.id}
              video={v}
              onPress={async () => {
                if (!addTo) return;
                try {
                  await updatePlaylist(addTo, { add: [v.id] });
                  toast.success('Added to playlist');
                  await playlists.refresh();
                } catch (e) {
                  toast.error(getErrorMessage(e));
                }
              }}
            />
          ))
        )}
      </Sheet>

      {/* New challenge */}
      <Sheet visible={Boolean(newChallenge)} onClose={() => setNewChallenge(null)} title="Start a challenge" footer={<Button title="Create challenge" fullWidth disabled={!newChallenge?.tag.trim() || !newChallenge?.title.trim()} loading={saving} onPress={async () => { if (!newChallenge) return; setSaving(true); try { const c = await createChallenge({ tag: newChallenge.tag.trim(), title: newChallenge.title.trim(), description: newChallenge.description.trim() || undefined }); setNewChallenge(null); router.navigate(`/challenge/${c.tag}` as never); } catch (e) { toast.error(getErrorMessage(e)); } finally { setSaving(false); } }} />}>
        {newChallenge ? (
          <View>
            <Input label="Hashtag" prefix="#" value={newChallenge.tag} onChangeText={(tag) => setNewChallenge({ ...newChallenge, tag: tag.replace(/[^a-z0-9_]/gi, '').toLowerCase() })} autoCapitalize="none" maxLength={50} helper="Letters, numbers and underscores" />
            <Input label="Title" value={newChallenge.title} onChangeText={(title) => setNewChallenge({ ...newChallenge, title })} maxLength={80} containerStyle={{ marginTop: spacing.md }} />
            <Input label="Description" value={newChallenge.description} onChangeText={(description) => setNewChallenge({ ...newChallenge, description })} maxLength={500} multiline containerStyle={{ marginTop: spacing.md }} />
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

function VideoRow({ video, onPress, right }: { video: VideoCard; onPress: () => void; right?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.videoRow, { borderBottomColor: colors.border }]}>
      {video.thumbnail_url ? <Image source={{ uri: video.thumbnail_url }} style={styles.thumb} contentFit="cover" /> : <View style={[styles.thumb, { backgroundColor: palette.night3 }]} />}
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <Text variant="smallMedium" numberOfLines={2}>
          {video.caption?.trim() || 'Untitled video'}
        </Text>
        <Text variant="caption" color="textMuted">
          {formatDate(video.created_at, 'd MMM yyyy')} · {formatCount(video.views_count)} views · {formatCount(video.likes_count)} likes · {formatCount(video.comments_count)} comments
        </Text>
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  stat: { minWidth: 140, flexGrow: 1 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 90, marginTop: spacing.sm, gap: 2 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 2 },
  videoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  thumb: { width: 48, height: 64, borderRadius: radius.sm },
  playlistCover: { width: 44, height: 44, borderRadius: radius.sm },
});
