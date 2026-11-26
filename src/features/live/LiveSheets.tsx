import { Ionicons } from '@/components/ui/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Share, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ListItem, ListSection } from '@/components/ui/ListItem';
import { Sheet } from '@/components/ui/Sheet';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { ReportSheet } from '@/features/profile/ReportSheet';
import { useAsync } from '@/hooks/useAsync';
import { env } from '@/lib/env';
import { approveLiveGuest, banLiveUser, deleteLiveComment, endLiveBattle, getFanClub, getLiveDiscovery, getLiveParticipants, inviteLiveGuest, joinFanClub, leaveFanClub, muteLiveUser, pinLiveComment, removeLiveGuest, setLiveCohost, setLiveGuestMedia, setLiveModerator, startLiveBattle, updateLive } from '@/services/live';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, spacing } from '@/theme/tokens';
import type { LiveComment, LiveSession } from '@/types/live';
import type { AuthorCard, StoryAudience } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';
import { formatCount } from '@/utils/format';

export type LiveSheetKind = 'controls' | 'viewers' | 'requests' | 'stage' | 'settings' | 'battle' | 'fanclub' | 'more' | 'report' | 'recipient' | null;

export async function shareLive(live: LiveSession, toast: ReturnType<typeof useToast>) {
  const url = `${env.siteUrl}/live/${live.id}`;
  try {
    if (Platform.OS === 'web') {
      const nav = typeof navigator !== 'undefined' ? navigator : undefined;
      if (nav?.share) await nav.share({ title: `${live.host.display_name} is live on Friendzy`, url });
      else {
        await Clipboard.setStringAsync(url);
        toast.success('Link copied');
      }
    } else {
      await Share.share({ message: `${live.host.display_name} is live: ${live.title} — ${url}`, url });
    }
  } catch {
    /* cancelled */
  }
}

export function HostControlsSheet({ live, visible, onClose, onOpen, onEnd }: { live: LiveSession; visible: boolean; onClose: () => void; onOpen: (kind: LiveSheetKind) => void; onEnd: () => void }) {
  const toast = useToast();
  return (
    <Sheet visible={visible} onClose={onClose} title="Host controls">
      <ListItem icon="hand-right-outline" title="Stage requests" subtitle={`${live.pending_requests} waiting`} right={live.pending_requests > 0 ? <View style={styles.badge}><Text variant="caption" color={palette.white}>{live.pending_requests}</Text></View> : undefined} onPress={() => onOpen('requests')} />
      <ListItem icon="people-outline" title="On stage" subtitle={`${live.stage.length} of 4 guests · co-hosts, mic & camera`} onPress={() => onOpen('stage')} />
      <ListItem icon="eye-outline" title="Viewers" subtitle="Invite on stage, moderators, mute or ban" onPress={() => onOpen('viewers')} />
      <ListItem icon="flash-outline" title={live.battle?.status === 'active' ? 'Battle in progress' : 'Start a battle'} subtitle={live.battle?.status === 'active' ? 'Gifts count as points until the timer ends' : 'Challenge a co-host or another live host'} onPress={() => onOpen('battle')} />
      <ListItem icon="settings-outline" title="Settings" subtitle="Comments, slow mode, guests, title" onPress={() => onOpen('settings')} />
      <ListItem icon="share-social-outline" title="Share live link" onPress={() => void shareLive(live, toast)} showChevron={false} />
      <ListItem icon="stop-circle-outline" title="End live" danger onPress={onEnd} showChevron={false} />
    </Sheet>
  );
}

export function ParticipantsSheet({ live, mode, visible, onClose, onChanged }: { live: LiveSession; mode: 'viewers' | 'requests' | 'stage'; visible: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const list = useAsync(() => getLiveParticipants(live.id, mode === 'requests' ? 'requested' : mode === 'stage' ? 'on_stage' : 'watching'), [live.id, mode, visible, live.pending_requests, live.stage.length], { enabled: visible });
  const run = async (fn: () => Promise<void>, success?: string) => {
    try {
      await fn();
      if (success) toast.success(success);
      await list.refresh();
      onChanged();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };
  const title = mode === 'requests' ? 'Stage requests' : mode === 'stage' ? 'On stage' : 'Viewers';
  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={mode === 'viewers' ? `${formatCount(live.viewers_count)} watching` : undefined}>
      {list.loading ? (
        <SkeletonList count={4} />
      ) : !list.data || list.data.length === 0 ? (
        <EmptyState compact icon={mode === 'requests' ? 'hand-right-outline' : 'people-outline'} title={mode === 'requests' ? 'No requests right now' : mode === 'stage' ? 'Nobody on stage' : 'No viewers yet'} description={mode === 'requests' ? 'Viewers can tap "Join stage" to ask.' : mode === 'stage' ? 'Approve a request or invite a viewer.' : 'Share your live to get people in.'} />
      ) : (
        list.data.map((p) => (
          <View key={p.id} style={styles.row}>
            <Avatar uri={p.avatar_url} name={p.display_name} size={40} verified={p.is_verified} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text variant="bodySemibold" numberOfLines={1}>
                {p.display_name}
              </Text>
              <Text variant="caption" color="textMuted">
                @{p.username}
                {p.role === 'moderator' ? ' · moderator' : p.role === 'cohost' ? ' · co-host' : p.role === 'guest' ? ' · guest' : ''}
                {p.state === 'invited' ? ' · invited' : ''}
              </Text>
            </View>
            {mode === 'requests' ? (
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                <Button title="Approve" size="sm" onPress={() => void run(() => approveLiveGuest(live.id, p.id, true), `${p.display_name} is on stage`)} disabled={live.stage.length >= 4 || p.state === 'invited'} />
                <Button title="Decline" size="sm" variant="ghost" onPress={() => void run(() => approveLiveGuest(live.id, p.id, false))} />
              </View>
            ) : mode === 'stage' ? (
              <View style={{ flexDirection: 'row', gap: 2 }}>
                <Button title={p.role === 'cohost' ? 'Co-host ✓' : 'Co-host'} size="sm" variant={p.role === 'cohost' ? 'secondary' : 'ghost'} onPress={() => void run(() => setLiveCohost(live.id, p.id, p.role !== 'cohost'))} />
                <Button title={p.mic_enabled ? 'Mic' : 'Muted'} size="sm" variant="ghost" leftIcon={p.mic_enabled ? 'mic-outline' : 'mic-off-outline'} onPress={() => void run(() => setLiveGuestMedia(live.id, p.id, { mic: !p.mic_enabled }))} />
                <Button title="Remove" size="sm" variant="ghost" onPress={() => void run(() => removeLiveGuest(live.id, p.id), 'Removed from stage')} />
              </View>
            ) : p.id === live.host.id ? (
              <Text variant="caption" color="textMuted">
                Host
              </Text>
            ) : (
              <View style={{ flexDirection: 'row', gap: 2 }}>
                {live.allow_guests && p.state !== 'on_stage' ? <Button title="Invite" size="sm" variant="ghost" leftIcon="person-add-outline" onPress={() => void run(() => inviteLiveGuest(live.id, p.id), 'Invitation sent')} /> : null}
                <Button title={p.role === 'moderator' ? 'Mod ✓' : 'Mod'} size="sm" variant="ghost" onPress={() => void run(() => setLiveModerator(live.id, p.id, p.role !== 'moderator'))} />
                <Button title="Mute" size="sm" variant="ghost" onPress={() => void run(() => muteLiveUser(live.id, p.id, 10), 'Muted for 10 minutes')} />
                <Button title="Ban" size="sm" variant="ghost" onPress={() => void run(() => banLiveUser(live.id, p.id, true), 'Banned from this live')} />
              </View>
            )}
          </View>
        ))
      )}
    </Sheet>
  );
}

export function LiveSettingsSheet({ live, visible, onClose, onChanged }: { live: LiveSession; visible: boolean; onClose: () => void; onChanged: (live: LiveSession) => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(live.title);
  const save = async (patch: Parameters<typeof updateLive>[1]) => {
    try {
      onChanged(await updateLive(live.id, patch));
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Live settings">
      <Input label="Title" value={title} onChangeText={setTitle} maxLength={80} rightElement={title.trim() !== live.title ? <Button title="Save" size="sm" variant="ghost" onPress={() => void save({ title: title.trim() })} /> : undefined} />
      <ListSection title="Comments">
        <ListItem icon="chatbubbles-outline" title="Allow comments" switchValue={live.allow_comments} onSwitchChange={(v) => void save({ allow_comments: v })} />
        <Text variant="label" color="textMuted" style={{ marginTop: spacing.sm, marginBottom: spacing.xs }}>
          Who can comment
        </Text>
        <View style={styles.wrap}>
          {(['everyone', 'followers', 'friends'] as StoryAudience[]).map((a) => (
            <Chip key={a} label={a === 'everyone' ? 'Everyone' : a === 'followers' ? 'Followers' : 'Friends'} size="sm" selected={live.comment_audience === a} onPress={() => void save({ comment_audience: a })} />
          ))}
        </View>
        <Text variant="label" color="textMuted" style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
          Slow mode
        </Text>
        <View style={styles.wrap}>
          {[0, 5, 15, 30, 60].map((s) => (
            <Chip key={s} label={s === 0 ? 'Off' : `${s}s`} size="sm" selected={live.slow_mode_seconds === s} onPress={() => void save({ slow_mode_seconds: s })} />
          ))}
        </View>
      </ListSection>
      <ListSection title="Stage">
        <ListItem icon="people-outline" title="Allow guest requests" switchValue={live.allow_guests} onSwitchChange={(v) => void save({ allow_guests: v })} />
      </ListSection>
    </Sheet>
  );
}

export function BattleSheet({ live, visible, onClose, onChanged }: { live: LiveSession; visible: boolean; onClose: () => void; onChanged: (live: LiveSession) => void }) {
  const toast = useToast();
  const [minutes, setMinutes] = useState(5);
  const [busy, setBusy] = useState(false);
  const discovery = useAsync(() => getLiveDiscovery(null), [visible], { enabled: visible && !live.battle });
  const candidates: AuthorCard[] = [...live.stage.filter((s) => s.id !== live.host.id), ...(discovery.data?.live ?? []).filter((l) => l.id !== live.id).map((l) => l.host)].filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i);
  const start = async (opponent: AuthorCard) => {
    setBusy(true);
    try {
      onChanged(await startLiveBattle(live.id, opponent.id, minutes));
      toast.success(`Battle with ${opponent.display_name} started`);
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Live battle" subtitle="Gifts received during the battle count as points">
      {live.battle && live.battle.status === 'active' ? (
        <View>
          <Text variant="body">
            {live.battle.host.display_name} {formatCount(live.battle.host_score)} — {formatCount(live.battle.opponent_score)} {live.battle.opponent.display_name}
          </Text>
          <Button title="End battle now" variant="secondary" style={{ marginTop: spacing.md }} onPress={async () => { try { onChanged(await endLiveBattle(live.id)); onClose(); } catch (e) { toast.error(getErrorMessage(e)); } }} />
        </View>
      ) : (
        <View>
          <View style={styles.wrap}>
            {[3, 5, 10].map((m) => (
              <Chip key={m} label={`${m} min`} size="sm" selected={minutes === m} onPress={() => setMinutes(m)} />
            ))}
          </View>
          <Text variant="label" color="textMuted" style={{ marginTop: spacing.lg, marginBottom: spacing.xs }}>
            Pick an opponent
          </Text>
          {discovery.loading ? (
            <SkeletonList count={3} />
          ) : candidates.length === 0 ? (
            <EmptyState compact icon="flash-outline" title="No opponents available" description="Invite a guest on stage or wait for another host to go live." />
          ) : (
            candidates.map((c) => (
              <ListItem key={c.id} left={<Avatar uri={c.avatar_url} name={c.display_name} size={40} />} title={c.display_name} subtitle={live.stage.some((s) => s.id === c.id) ? 'On your stage' : 'Live now'} right={<Button title="Battle" size="sm" onPress={() => void start(c)} disabled={busy} />} />
            ))
          )}
        </View>
      )}
    </Sheet>
  );
}

export function FanClubSheet({ creator, visible, onClose }: { creator: AuthorCard; visible: boolean; onClose: () => void }) {
  const toast = useToast();
  const club = useAsync(() => getFanClub(creator.id), [creator.id, visible], { enabled: visible });
  const toggle = async () => {
    try {
      if (club.data?.my_membership) await leaveFanClub(creator.id);
      else await joinFanClub(creator.id);
      await club.refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={`${creator.display_name}'s fan club`} subtitle="Earn points with gifts and watch time to level up">
      {club.loading || !club.data ? (
        <SkeletonList count={3} />
      ) : (
        <View>
          <Text variant="body">
            {formatCount(club.data.members_count)} member{club.data.members_count === 1 ? '' : 's'}
            {club.data.my_membership ? ` · you are level ${club.data.my_membership.level} (${formatCount(club.data.my_membership.points)} pts)` : ''}
          </Text>
          <Button title={club.data.my_membership ? 'Leave fan club' : 'Join fan club'} variant={club.data.my_membership ? 'secondary' : 'primary'} leftIcon="heart-outline" onPress={() => void toggle()} style={{ marginTop: spacing.md }} />
          <Text variant="label" color="textMuted" style={{ marginTop: spacing.lg, marginBottom: spacing.xs }}>
            Levels
          </Text>
          <View style={styles.wrap}>
            {club.data.levels.map((l) => (
              <Chip key={l.level} label={`L${l.level} · ${formatCount(l.points)} pts`} size="sm" selected={club.data!.my_membership?.level === l.level} />
            ))}
          </View>
          <Text variant="label" color="textMuted" style={{ marginTop: spacing.lg, marginBottom: spacing.xs }}>
            Top fans
          </Text>
          {club.data.top_fans.length === 0 ? (
            <Text variant="small" color="textMuted">
              Be the first fan.
            </Text>
          ) : (
            club.data.top_fans.map((f, i) => <ListItem key={f.user.id} left={<Avatar uri={f.user.avatar_url} name={f.user.display_name} size={36} />} title={`${i + 1}. ${f.user.display_name}`} subtitle={`Level ${f.level} · ${formatCount(f.points)} pts`} onPress={() => router.navigate(`/u/${f.user.username}` as never)} />)
          )}
        </View>
      )}
    </Sheet>
  );
}

export function ViewerMoreSheet({ live, visible, onClose, onOpen }: { live: LiveSession; visible: boolean; onClose: () => void; onOpen: (kind: LiveSheetKind) => void }) {
  const toast = useToast();
  const [report, setReport] = useState(false);
  return (
    <>
      <Sheet visible={visible && !report} onClose={onClose} title={live.title} subtitle={`Hosted by ${live.host.display_name}`}>
        <ListItem icon="person-outline" title="View host profile" onPress={() => { onClose(); router.navigate(`/u/${live.host.username}` as never); }} />
        <ListItem icon="heart-outline" title="Fan club" subtitle={live.fan_badge ? `You are level ${live.fan_badge.level}` : 'Join to earn a badge in chat'} onPress={() => onOpen('fanclub')} />
        <ListItem icon="share-social-outline" title="Share" onPress={() => void shareLive(live, toast)} showChevron={false} />
        <ListItem icon="flag-outline" title="Report this live" danger onPress={() => setReport(true)} showChevron={false} />
      </Sheet>
      {report ? <ReportSheet visible onClose={() => { setReport(false); onClose(); }} targetType="live" targetId={live.id} targetLabel="this live" /> : null}
    </>
  );
}

export function RecipientSheet({ live, visible, onClose, onPick }: { live: LiveSession; visible: boolean; onClose: () => void; onPick: (recipient: AuthorCard) => void }) {
  const people: AuthorCard[] = [live.host, ...live.stage.filter((s) => s.id !== live.host.id)];
  return (
    <Sheet visible={visible} onClose={onClose} title="Who gets the gift?">
      {people.map((p) => (
        <ListItem key={p.id} left={<Avatar uri={p.avatar_url} name={p.display_name} size={40} />} title={p.display_name} subtitle={p.id === live.host.id ? 'Host' : 'On stage'} onPress={() => onPick(p)} />
      ))}
    </Sheet>
  );
}

export function CommentActionsSheet({ live, comment, onClose, onDone }: { live: LiveSession; comment: LiveComment | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { colors } = useTheme();
  const run = async (fn: () => Promise<void>, success: string) => {
    try {
      await fn();
      toast.success(success);
      onDone();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      onClose();
    }
  };
  return (
    <Sheet visible={Boolean(comment)} onClose={onClose} title="Comment">
      {comment ? (
        <View>
          <Text variant="small" color="textMuted" style={{ marginBottom: spacing.sm }}>
            {comment.user?.display_name}: {comment.text}
          </Text>
          <ListItem icon="pin-outline" title={comment.pinned ? 'Unpin' : 'Pin to top'} onPress={() => void run(() => pinLiveComment(comment.id, !comment.pinned), comment.pinned ? 'Unpinned' : 'Pinned')} showChevron={false} />
          <ListItem icon="trash-outline" title="Delete comment" onPress={() => void run(() => deleteLiveComment(comment.id), 'Comment removed')} showChevron={false} />
          {comment.user && comment.user.id !== live.host.id ? (
            <>
              <ListItem icon="volume-mute-outline" title="Mute for 10 minutes" onPress={() => void run(() => muteLiveUser(live.id, comment.user!.id, 10), 'Muted')} showChevron={false} />
              <ListItem icon="ban-outline" title="Ban from this live" danger onPress={() => void run(() => banLiveUser(live.id, comment.user!.id, true), 'Banned')} showChevron={false} />
            </>
          ) : null}
          <View style={{ height: spacing.md, borderTopColor: colors.border }}>
            <Ionicons name="shield-checkmark-outline" size={1} color="transparent" />
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: palette.pink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
});
