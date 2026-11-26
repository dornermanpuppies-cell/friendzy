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
import { approveLiveGuest, askLiveQuestion, banLiveUser, cancelLiveGoal, deleteLiveComment, endLiveBattle, getFanClub, getLiveCommentFilters, getLiveDiscovery, getLiveParticipants, getLiveQuestions, getLiveTopSupporters, inviteLiveGuest, joinFanClub, leaveFanClub, muteLiveUser, pinLiveComment, removeLiveGuest, setLiveCohost, setLiveCommentFilter, setLiveGoal, setLiveGuestMedia, setLiveModerator, setLiveQuestion, startLiveBattle, updateLive, voteLiveQuestion } from '@/services/live';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, spacing } from '@/theme/tokens';
import type { LiveComment, LiveGoal, LiveSession } from '@/types/live';
import type { AuthorCard, StoryAudience } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';
import { formatCount } from '@/utils/format';

export type LiveSheetKind = 'controls' | 'viewers' | 'requests' | 'stage' | 'settings' | 'battle' | 'fanclub' | 'more' | 'report' | 'recipient' | 'goal' | 'questions' | 'supporters' | 'words' | null;

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
      <ListItem icon="flag-outline" title={live.goal ? 'Goal' : 'Set a goal'} subtitle={live.goal ? `${formatCount(live.goal.progress)} of ${formatCount(live.goal.target)} ${live.goal.kind}` : 'Show a gift or like target on screen'} onPress={() => onOpen('goal')} />
      <ListItem icon="help-circle-outline" title="Questions" subtitle={live.questions_pending > 0 ? `${live.questions_pending} waiting` : 'Pick one to answer on screen'} right={live.questions_pending > 0 ? <View style={styles.badge}><Text variant="caption" color={palette.white}>{live.questions_pending}</Text></View> : undefined} onPress={() => onOpen('questions')} />
      <ListItem icon="trophy-outline" title="Top supporters" subtitle="Who is sending the most gifts" onPress={() => onOpen('supporters')} />
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

export function LiveSettingsSheet({ live, visible, onClose, onChanged, onOpenWords }: { live: LiveSession; visible: boolean; onClose: () => void; onChanged: (live: LiveSession) => void; onOpenWords: () => void }) {
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
      <ListSection title="Moderation">
        <ListItem icon="funnel-outline" title="Blocked words" subtitle="Comments containing them never appear" onPress={() => onOpenWords()} />
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
        <ListItem icon="help-circle-outline" title="Ask a question" subtitle="The host can put it on screen" onPress={() => onOpen('questions')} />
        <ListItem icon="trophy-outline" title="Top supporters" subtitle="Ranking for this broadcast" onPress={() => onOpen('supporters')} />
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

/** Host picks the target the room is working towards; everyone else sees how it is going. */
export function GoalSheet({ live, visible, onClose, onChanged }: { live: LiveSession; visible: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<LiveGoal['kind']>(live.goal?.kind ?? 'coins');
  const [target, setTarget] = useState(String(live.goal?.target ?? 1000));
  const [label, setLabel] = useState(live.goal?.label ?? '');
  const [busy, setBusy] = useState(false);

  if (!live.is_host) {
    return (
      <Sheet visible={visible} onClose={onClose} title="Goal">
        {live.goal ? (
          <>
            <Text variant="h3">{live.goal.label ?? (live.goal.kind === 'coins' ? 'Gift goal' : 'Like goal')}</Text>
            <Text variant="body" color="textMuted" style={{ marginTop: spacing.xs }}>
              {formatCount(live.goal.progress)} of {formatCount(live.goal.target)} {live.goal.kind === 'coins' ? 'coins' : 'likes'}
              {live.goal.status === 'reached' ? ' · reached 🎉' : ''}
            </Text>
            <Text variant="small" color="textMuted" style={{ marginTop: spacing.md }}>
              {live.goal.kind === 'coins' ? 'Send a gift to move the bar.' : 'Tap the heart to move the bar.'}
            </Text>
          </>
        ) : (
          <EmptyState compact icon="flag-outline" title="No goal yet" description="The host has not set a target for this broadcast." />
        )}
        <View style={{ height: spacing.lg }} />
      </Sheet>
    );
  }

  const apply = async () => {
    const value = Number(target.replace(/[^0-9]/g, ''));
    if (!value || value < 1) {
      toast.error('Pick a target above zero');
      return;
    }
    setBusy(true);
    try {
      await setLiveGoal(live.id, kind, value, label.trim() || null);
      toast.success('Goal set');
      onChanged();
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={live.goal ? 'Change the goal' : 'Set a goal'} subtitle="Everyone watching sees the bar fill up">
      <View style={styles.wrap}>
        <Chip label="🎁 Gift coins" size="sm" selected={kind === 'coins'} onPress={() => setKind('coins')} />
        <Chip label="❤️ Likes" size="sm" selected={kind === 'likes'} onPress={() => setKind('likes')} />
      </View>
      <Input label="Target" value={target} onChangeText={setTarget} keyboardType="number-pad" placeholder="1000" style={{ marginTop: spacing.md }} />
      <View style={styles.wrap}>
        {(kind === 'coins' ? [500, 1000, 5000, 10000] : [100, 500, 1000, 5000]).map((n) => (
          <Chip key={n} label={formatCount(n)} size="sm" selected={target === String(n)} onPress={() => setTarget(String(n))} />
        ))}
      </View>
      <Input label="What is it for? (optional)" value={label} onChangeText={setLabel} maxLength={60} placeholder="New microphone" style={{ marginTop: spacing.md }} />
      <Button title={live.goal ? 'Update goal' : 'Start goal'} glow fullWidth loading={busy} onPress={() => void apply()} style={{ marginTop: spacing.lg }} />
      {live.goal ? (
        <Button
          title="Remove goal"
          variant="ghost"
          fullWidth
          style={{ marginTop: spacing.sm }}
          onPress={async () => {
            try {
              await cancelLiveGoal(live.id);
              onChanged();
              onClose();
            } catch (error) {
              toast.error(getErrorMessage(error));
            }
          }}
        />
      ) : null}
      <View style={{ height: spacing.lg }} />
    </Sheet>
  );
}

/** Viewers ask and upvote; the host puts one on screen and marks it answered. */
export function QuestionsSheet({ live, visible, onClose, onChanged }: { live: LiveSession; visible: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const canModerate = live.is_host || live.is_moderator;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useAsync(() => getLiveQuestions(live.id, 'open', 50), [live.id, visible, live.questions_pending], { enabled: visible });

  const ask = async () => {
    const value = text.trim();
    if (value.length < 3) {
      toast.error('Write a question first');
      return;
    }
    setBusy(true);
    try {
      await askLiveQuestion(live.id, value);
      setText('');
      toast.success('Question sent');
      await list.refresh();
      onChanged();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await list.refresh();
      onChanged();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Questions" subtitle={canModerate ? 'Pick one to show on screen' : 'The host answers the ones with most votes'}>
      {!live.is_host ? (
        <Input
          placeholder="Ask something…"
          value={text}
          onChangeText={setText}
          maxLength={150}
          rightElement={<Button title="Ask" size="sm" variant="ghost" loading={busy} onPress={() => void ask()} />}
        />
      ) : null}
      {list.loading && !list.data ? (
        <SkeletonList count={3} />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState compact icon="help-circle-outline" title="No questions yet" description={live.is_host ? 'Viewers can send questions from the live.' : 'Be the first to ask.'} />
      ) : (
        (list.data ?? []).map((q) => (
          <ListItem
            key={q.id}
            left={<Avatar uri={q.user.avatar_url} name={q.user.display_name} size={36} />}
            title={q.text}
            subtitle={`${q.user.display_name} · ${q.upvotes} ${q.upvotes === 1 ? 'vote' : 'votes'}${q.status === 'featured' ? ' · on screen' : ''}`}
            showChevron={false}
            right={
              canModerate ? (
                <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                  {q.status === 'featured' ? (
                    <Button title="Answered" size="sm" variant="secondary" onPress={() => void act(() => setLiveQuestion(q.id, 'answered'))} />
                  ) : (
                    <Button title="Show" size="sm" onPress={() => void act(() => setLiveQuestion(q.id, 'featured'))} />
                  )}
                  <Button title="Hide" size="sm" variant="ghost" onPress={() => void act(() => setLiveQuestion(q.id, 'dismissed'))} />
                </View>
              ) : (
                <Button
                  title={`▲ ${q.upvotes}`}
                  size="sm"
                  variant={q.my_vote ? 'secondary' : 'ghost'}
                  onPress={() => void act(() => voteLiveQuestion(q.id, !q.my_vote))}
                />
              )
            }
          />
        ))
      )}
      <View style={{ height: spacing.lg }} />
    </Sheet>
  );
}

/** Ranking of who has gifted the most in this broadcast. */
export function SupportersSheet({ live, visible, onClose }: { live: LiveSession; visible: boolean; onClose: () => void }) {
  const list = useAsync(() => getLiveTopSupporters(live.id, 50), [live.id, visible, live.gifts_coins], { enabled: visible });
  return (
    <Sheet visible={visible} onClose={onClose} title="Top supporters" subtitle="Gift coins sent during this broadcast">
      {list.loading && !list.data ? (
        <SkeletonList count={4} />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState compact icon="trophy-outline" title="No gifts yet" description="The first gift takes the top spot." />
      ) : (
        (list.data ?? []).map((s) => (
          <ListItem
            key={s.user.id}
            left={<Avatar uri={s.user.avatar_url} name={s.user.display_name} size={40} />}
            title={s.user.display_name}
            subtitle={`${formatCount(s.coins)} coins · ${s.gifts} ${s.gifts === 1 ? 'gift' : 'gifts'}`}
            right={<Text variant="h4" color={s.rank === 1 ? palette.gold : undefined}>#{s.rank}</Text>}
            showChevron={false}
            onPress={() => router.navigate(`/u/${s.user.username}` as never)}
          />
        ))
      )}
      <View style={{ height: spacing.lg }} />
    </Sheet>
  );
}

/** Words the host blocks across their broadcasts. */
export function BlockedWordsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const toast = useToast();
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useAsync(() => getLiveCommentFilters(), [visible], { enabled: visible });

  const add = async () => {
    const value = word.trim();
    if (value.length < 2) {
      toast.error('Blocked words need at least two characters');
      return;
    }
    setBusy(true);
    try {
      await setLiveCommentFilter(value, true);
      setWord('');
      await list.refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Blocked words" subtitle="Comments containing these never reach your live">
      <Input placeholder="Add a word" value={word} onChangeText={setWord} maxLength={40} autoCapitalize="none" rightElement={<Button title="Add" size="sm" variant="ghost" loading={busy} onPress={() => void add()} />} />
      {(list.data ?? []).length === 0 ? (
        <EmptyState compact icon="funnel-outline" title="Nothing blocked" description="Add words you never want to see in your chat." />
      ) : (
        <View style={styles.wrap}>
          {(list.data ?? []).map((w) => (
            <Chip
              key={w}
              label={w}
              size="sm"
              selected
              icon="close"
              onPress={async () => {
                try {
                  await setLiveCommentFilter(w, false);
                  await list.refresh();
                } catch (error) {
                  toast.error(getErrorMessage(error));
                }
              }}
            />
          ))}
        </View>
      )}
      <Text variant="caption" color="textMuted" style={{ marginTop: spacing.md }}>
        Up to 50 words. Matching is case-insensitive and applies to every broadcast you host.
      </Text>
      <View style={{ height: spacing.lg }} />
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
