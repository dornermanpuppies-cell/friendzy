import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ListItem } from '@/components/ui/ListItem';
import { Sheet } from '@/components/ui/Sheet';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { AdminShell } from '@/features/admin/AdminShell';
import { useAsync } from '@/hooks/useAsync';
import { deleteAnnouncement, deleteBanner, deleteTrendingTopic, listAnnouncements, listBanners, searchAdminUsers, setFeaturedCreator, upsertAnnouncement, upsertBanner, upsertTrendingTopic } from '@/services/admin';
import { getFeaturedCreators, getTrendingTopics } from '@/services/siteContent';
import { spacing } from '@/theme/tokens';
import type { Announcement, Banner, TrendingTopic } from '@/types/admin';
import { getErrorMessage } from '@/utils/errors';
import { formatDate } from '@/utils/format';

type Tab = 'announcements' | 'banners' | 'featured' | 'trending';

export default function AdminSiteScreen() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('announcements');
  const [announcement, setAnnouncement] = useState<Partial<Announcement> | null>(null);
  const [banner, setBanner] = useState<Partial<Banner> | null>(null);
  const [topic, setTopic] = useState<Partial<TrendingTopic> | null>(null);
  const [featureQuery, setFeatureQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const announcements = useAsync(() => listAnnouncements(), [tab]);
  const banners = useAsync(() => listBanners(), [tab]);
  const featured = useAsync(() => getFeaturedCreators(50), [tab]);
  const topics = useAsync(() => getTrendingTopics(30), [tab]);
  const candidates = useAsync(() => (featureQuery.trim().length > 1 ? searchAdminUsers({ query: featureQuery.trim(), limit: 8 }) : Promise.resolve([])), [featureQuery]);

  const run = async (fn: () => Promise<unknown>, success: string, refresh: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      setAnnouncement(null);
      setBanner(null);
      setTopic(null);
      await refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell title="Site content">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {(['announcements', 'banners', 'featured', 'trending'] as Tab[]).map((t) => (
          <Chip key={t} label={t} size="sm" selected={tab === t} onPress={() => setTab(t)} />
        ))}
      </View>

      {tab === 'announcements' ? (
        <View style={{ marginTop: spacing.md }}>
          <Button title="New announcement" size="sm" leftIcon="add" onPress={() => setAnnouncement({ kind: 'info', audience: 'all', is_active: true })} style={{ alignSelf: 'flex-start' }} />
          {announcements.loading ? <SkeletonList count={3} /> : (announcements.data ?? []).length === 0 ? <EmptyState compact icon="megaphone-outline" title="No announcements" description="Announcements appear at the top of Home for the chosen audience." /> : (announcements.data ?? []).map((a) => <ListItem key={a.id} icon={a.is_active ? 'megaphone' : 'megaphone-outline'} title={a.title} subtitle={`${a.kind} · ${a.audience} · ${a.is_active ? 'active' : 'inactive'} · ${a.dismissals ?? 0} dismissals · ${formatDate(a.starts_at, 'd MMM')}${a.ends_at ? ` → ${formatDate(a.ends_at, 'd MMM')}` : ''}`} onPress={() => setAnnouncement(a)} />)}
        </View>
      ) : null}

      {tab === 'banners' ? (
        <View style={{ marginTop: spacing.md }}>
          <Button title="New banner" size="sm" leftIcon="add" onPress={() => setBanner({ placement: 'home', is_active: true, sort_order: 0 })} style={{ alignSelf: 'flex-start' }} />
          {banners.loading ? <SkeletonList count={3} /> : (banners.data ?? []).length === 0 ? <EmptyState compact icon="image-outline" title="No banners" description="Banners are promotional cards shown on Home, Discover, LIVE, Wallet or Games." /> : (banners.data ?? []).map((b) => <ListItem key={b.id} icon="image-outline" title={b.title} subtitle={`${b.placement} · ${b.is_active ? 'active' : 'inactive'} · ${b.link ?? 'no link'}`} onPress={() => setBanner(b)} />)}
          <Text variant="caption" color="textMuted" style={{ marginTop: spacing.sm }}>
            Image URLs can point to the public “banners” storage bucket (upload via the Supabase dashboard) or any HTTPS image.
          </Text>
        </View>
      ) : null}

      {tab === 'featured' ? (
        <View style={{ marginTop: spacing.md }}>
          <Input placeholder="Search a user to feature" leftIcon="search-outline" value={featureQuery} onChangeText={setFeatureQuery} autoCapitalize="none" />
          {(candidates.data ?? []).map((u) => (
            <ListItem key={u.id} title={`${u.display_name} @${u.username}`} subtitle={`${u.followers_count} followers`} right={<Button title="Feature" size="sm" onPress={() => void run(() => setFeaturedCreator(u.id, true, null, null), 'Creator featured', featured.refresh)} />} />
          ))}
          <Text variant="h4" style={{ marginTop: spacing.lg, marginBottom: spacing.xs }}>
            Currently featured
          </Text>
          {featured.loading ? <SkeletonList count={3} /> : (featured.data ?? []).length === 0 ? <Text variant="small" color="textMuted">Nobody featured yet.</Text> : (featured.data ?? []).map((c) => <ListItem key={c.id} title={`${c.display_name} @${c.username}`} subtitle={c.note ?? `${c.followers_count} followers`} right={<Button title="Remove" size="sm" variant="ghost" onPress={() => void run(() => setFeaturedCreator(c.id, false), 'Removed', featured.refresh)} />} />)}
        </View>
      ) : null}

      {tab === 'trending' ? (
        <View style={{ marginTop: spacing.md }}>
          <Button title="Pin a topic" size="sm" leftIcon="add" onPress={() => setTopic({ kind: 'hashtag', is_active: true, sort_order: 0 })} style={{ alignSelf: 'flex-start' }} />
          {topics.loading ? <SkeletonList count={3} /> : (topics.data ?? []).map((t) => <ListItem key={t.tag} icon={t.pinned ? 'pin' : 'trending-up-outline'} title={t.label ?? `#${t.tag}`} subtitle={`#${t.tag} · ${t.kind} · ${t.pinned ? 'pinned' : 'organic'} · ${t.posts_count ?? 0} posts`} onPress={t.pinned ? () => setTopic(t) : undefined} />)}
        </View>
      ) : null}

      <Sheet visible={Boolean(announcement)} onClose={() => setAnnouncement(null)} title={announcement?.id ? 'Edit announcement' : 'New announcement'}>
        {announcement ? (
          <View style={{ gap: spacing.sm }}>
            <Input label="Title" value={announcement.title ?? ''} onChangeText={(title) => setAnnouncement({ ...announcement, title })} maxLength={120} />
            <Input label="Body" value={announcement.body ?? ''} onChangeText={(body) => setAnnouncement({ ...announcement, body })} multiline maxLength={2000} />
            <Input label="Link (optional, e.g. /premium)" value={announcement.link ?? ''} onChangeText={(link) => setAnnouncement({ ...announcement, link: link || null })} autoCapitalize="none" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {(['info', 'update', 'warning', 'promo'] as const).map((k) => (
                <Chip key={k} label={k} size="sm" selected={announcement.kind === k} onPress={() => setAnnouncement({ ...announcement, kind: k })} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {(['all', 'premium', 'free', 'creators'] as const).map((a) => (
                <Chip key={a} label={a} size="sm" selected={announcement.audience === a} onPress={() => setAnnouncement({ ...announcement, audience: a })} />
              ))}
            </View>
            <Input label="Ends at (ISO, optional)" value={announcement.ends_at ?? ''} onChangeText={(ends_at) => setAnnouncement({ ...announcement, ends_at: ends_at || null })} autoCapitalize="none" placeholder="2026-12-31T23:59:00Z" />
            <ListItem icon="eye-outline" title="Active" switchValue={announcement.is_active !== false} onSwitchChange={(v) => setAnnouncement({ ...announcement, is_active: v })} />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {announcement.id ? <Button title="Delete" variant="ghost" onPress={() => void run(() => deleteAnnouncement(announcement.id!), 'Deleted', announcements.refresh)} /> : null}
              <Button title="Save" loading={busy} disabled={!announcement.title || !announcement.body} onPress={() => void run(() => upsertAnnouncement(announcement), 'Saved', announcements.refresh)} style={{ flex: 1 }} />
            </View>
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={Boolean(banner)} onClose={() => setBanner(null)} title={banner?.id ? 'Edit banner' : 'New banner'}>
        {banner ? (
          <View style={{ gap: spacing.sm }}>
            <Input label="Title" value={banner.title ?? ''} onChangeText={(title) => setBanner({ ...banner, title })} maxLength={80} />
            <Input label="Subtitle" value={banner.subtitle ?? ''} onChangeText={(subtitle) => setBanner({ ...banner, subtitle: subtitle || null })} />
            <Input label="Image URL" value={banner.image_url ?? ''} onChangeText={(image_url) => setBanner({ ...banner, image_url: image_url || null })} autoCapitalize="none" />
            <Input label="Link (e.g. /games)" value={banner.link ?? ''} onChangeText={(link) => setBanner({ ...banner, link: link || null })} autoCapitalize="none" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {(['home', 'discover', 'live', 'wallet', 'games'] as const).map((p) => (
                <Chip key={p} label={p} size="sm" selected={banner.placement === p} onPress={() => setBanner({ ...banner, placement: p })} />
              ))}
            </View>
            <ListItem icon="eye-outline" title="Active" switchValue={banner.is_active !== false} onSwitchChange={(v) => setBanner({ ...banner, is_active: v })} />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {banner.id ? <Button title="Delete" variant="ghost" onPress={() => void run(() => deleteBanner(banner.id!), 'Deleted', banners.refresh)} /> : null}
              <Button title="Save" loading={busy} disabled={!banner.title} onPress={() => void run(() => upsertBanner(banner), 'Saved', banners.refresh)} style={{ flex: 1 }} />
            </View>
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={Boolean(topic)} onClose={() => setTopic(null)} title={topic?.id ? 'Edit topic' : 'Pin a topic'}>
        {topic ? (
          <View style={{ gap: spacing.sm }}>
            <Input label="Hashtag" prefix="#" value={topic.tag ?? ''} onChangeText={(tag) => setTopic({ ...topic, tag: tag.toLowerCase().replace(/[^a-z0-9_]/g, '') })} autoCapitalize="none" />
            <Input label="Label (optional)" value={topic.label ?? ''} onChangeText={(label) => setTopic({ ...topic, label: label || null })} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {(['hashtag', 'topic', 'challenge'] as const).map((k) => (
                <Chip key={k} label={k} size="sm" selected={topic.kind === k} onPress={() => setTopic({ ...topic, kind: k })} />
              ))}
            </View>
            <ListItem icon="eye-outline" title="Active" switchValue={topic.is_active !== false} onSwitchChange={(v) => setTopic({ ...topic, is_active: v })} />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {topic.id ? <Button title="Unpin" variant="ghost" onPress={() => void run(() => deleteTrendingTopic(topic.id!), 'Unpinned', topics.refresh)} /> : null}
              <Button title="Save" loading={busy} disabled={!topic.tag} onPress={() => void run(() => upsertTrendingTopic(topic), 'Saved', topics.refresh)} style={{ flex: 1 }} />
            </View>
          </View>
        ) : null}
      </Sheet>
    </AdminShell>
  );
}
