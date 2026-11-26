import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ListItem, ListSection } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { WALLPAPERS } from '@/features/chat/wallpapers';
import { FriendButton } from '@/features/discover/FriendButton';
import { confirmAction } from '@/features/feed/usePostActions';
import { ProfileRow } from '@/features/profile/ProfileRow';
import { ReportSheet } from '@/features/profile/ReportSheet';
import { useAsync } from '@/hooks/useAsync';
import { env } from '@/lib/env';
import { pickImage, uploadProfileImage } from '@/services/media';
import { addMembers, clearConversation, fetchConversation, getJoinRequests, leaveConversation, removeMember, respondJoinRequest, rotateInviteLink, setConversationSettings, setDisappearing, setMemberRole, updateGroup } from '@/services/messaging';
import { searchProfiles } from '@/services/profiles';
import { getRelationship } from '@/services/relationships';
import { blockUser } from '@/services/safety';
import { useAuth } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { ProfileCard } from '@/types/database';
import { DISAPPEARING_OPTIONS, MUTE_OPTIONS, type ConversationDetail } from '@/types/messaging';
import { getErrorMessage } from '@/utils/errors';

export default function ConversationInfoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = String(id);
  const { user } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const upsert = useChatStore((s) => s.upsertConversation);
  const remove = useChatStore((s) => s.removeConversation);
  const detail = useAsync<ConversationDetail>(async () => {
    const d = await fetchConversation(conversationId);
    upsert(d);
    return d;
  }, [conversationId]);
  const c = detail.data;
  const [editOpen, setEditOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ProfileCard[]>([]);
  const [muteOpen, setMuteOpen] = useState(false);
  const [wallOpen, setWallOpen] = useState(false);
  const [disOpen, setDisOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [memberMenu, setMemberMenu] = useState<ConversationDetail['members'][number] | null>(null);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const search = useAsync(() => (query.trim() ? searchProfiles({ query: query.trim(), limit: 20 }) : Promise.resolve([])), [query], { enabled: addOpen });
  const requests = useAsync(() => (c?.is_admin ? getJoinRequests(conversationId) : Promise.resolve([])), [conversationId, requestsOpen, c?.is_admin]);
  const otherId = detail.data?.kind === 'direct' ? detail.data.other_user?.id : undefined;
  const relationship = useAsync(() => (otherId ? getRelationship(otherId) : Promise.resolve(null)), [otherId]);

  const run = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      if (success) toast.success(success);
      await detail.refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  if (!c) {
    return <Screen header={<ScreenHeader title="Info" fallbackHref="/inbox" />}>{detail.error ? <Text color="danger">{detail.error}</Text> : null}</Screen>;
  }

  const isGroup = c.kind === 'group';
  const other = c.other_user;
  const inviteUrl = c.invite_code ? `${env.siteUrl}/chat/join/${c.invite_code}` : null;

  const changeAvatar = async () => {
    if (!user) return;
    try {
      const image = await pickImage('avatar');
      if (!image) return;
      const url = await uploadProfileImage(user.id, 'avatar', image);
      await run(() => updateGroup(conversationId, { avatarUrl: url }), 'Group photo updated');
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <Screen header={<ScreenHeader title={isGroup ? 'Group info' : 'Contact info'} fallbackHref={`/chat/${conversationId}`} />} scroll refreshing={detail.refreshing} onRefresh={detail.refresh}>
      <View style={styles.hero}>
        <Pressable onPress={() => (isGroup && c.is_admin ? changeAvatar() : other ? router.navigate(`/u/${other.username}` as never) : undefined)}>
          <Avatar uri={c.avatar_url} name={c.title} size={96} />
          {isGroup && c.is_admin ? (
            <View style={[styles.camBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
              <Ionicons name="camera" size={14} color={palette.white} />
            </View>
          ) : null}
        </Pressable>
        <Text variant="h2" style={{ marginTop: spacing.md }} align="center">
          {c.title}
        </Text>
        <Text variant="body" color="textMuted" align="center">
          {isGroup ? `Group · ${c.members_count} members` : `@${other?.username ?? ''}`}
        </Text>
        {c.description ? (
          <Text variant="body" color="textSecondary" align="center" style={{ marginTop: spacing.sm }}>
            {c.description}
          </Text>
        ) : null}
        <View style={styles.heroActions}>
          {!isGroup && other ? <Button title="View profile" variant="secondary" size="sm" leftIcon="person-outline" onPress={() => router.navigate(`/u/${other.username}` as never)} /> : null}
          {!isGroup && other && relationship.data && !relationship.data.is_blocking && !relationship.data.is_blocked_by ? (
            <FriendButton targetId={other.id} displayName={other.display_name} state={{ is_friend: relationship.data.is_friend, friend_request: relationship.data.friend_request }} size="sm" onChange={() => void relationship.refresh()} />
          ) : null}
          {isGroup && c.is_admin ? <Button title="Edit" variant="secondary" size="sm" leftIcon="create-outline" onPress={() => { setTitle(c.title ?? ''); setDescription(c.description ?? ''); setEditOpen(true); }} /> : null}
          <Button title="Media" variant="secondary" size="sm" leftIcon="images-outline" onPress={() => router.navigate(`/chat/${conversationId}/media` as never)} />
          <Button title="Search" variant="secondary" size="sm" leftIcon="search-outline" onPress={() => router.navigate(`/chat/${conversationId}/search` as never)} />
        </View>
      </View>

      <ListSection title="Encryption">
        <ListItem icon="lock-closed-outline" title="End-to-end encrypted" subtitle={isGroup ? 'Verify each member’s security code' : `Verify ${other?.display_name ?? 'their'} security code`} onPress={() => router.navigate(`/chat/${conversationId}/encryption` as never)} />
      </ListSection>
      <ListSection title="Notifications & display">
        <ListItem icon={c.is_muted ? 'notifications-off-outline' : 'notifications-outline'} title="Mute notifications" value={c.is_muted ? 'Muted' : 'On'} onPress={() => (c.is_muted ? run(() => setConversationSettings(conversationId, { mutedUntil: null }), 'Unmuted') : setMuteOpen(true))} />
        <ListItem icon="color-palette-outline" title="Wallpaper" value={WALLPAPERS.find((w) => w.id === (c.wallpaper ?? 'default'))?.label ?? 'Night'} onPress={() => setWallOpen(true)} />
        <ListItem icon="timer-outline" title="Disappearing messages" value={DISAPPEARING_OPTIONS.find((o) => o.seconds === c.disappearing_seconds)?.label ?? 'Off'} onPress={() => (isGroup && !c.is_admin ? toast.info('Only admins can change this') : setDisOpen(true))} />
        <ListItem icon={c.is_pinned ? 'pin' : 'pin-outline'} title="Pin chat" switchValue={c.is_pinned} onSwitchChange={(v) => run(() => setConversationSettings(conversationId, { isPinned: v }))} />
        <ListItem icon="archive-outline" title="Archive chat" switchValue={c.is_archived} onSwitchChange={(v) => run(() => setConversationSettings(conversationId, { isArchived: v }))} />
      </ListSection>

      {isGroup ? (
        <>
          <ListSection title={`Members · ${c.members.length}`}>
            {c.is_admin ? <ListItem icon="person-add-outline" title="Add members" onPress={() => { setPicked([]); setQuery(''); setAddOpen(true); }} /> : null}
            {c.is_admin && c.pending_requests > 0 ? <ListItem icon="hourglass-outline" title="Join requests" value={String(c.pending_requests)} onPress={() => setRequestsOpen(true)} /> : null}
            {c.members.map((m) => (
              <ProfileRow key={m.id} profile={{ ...m, bio: null, followers_count: 0 }} showBio={false} subtitle={`@${m.username}${m.role !== 'member' ? ` · ${m.role}` : ''}`} right={c.is_admin && m.id !== user?.id ? <Pressable onPress={() => setMemberMenu(m)} hitSlop={8} accessibilityLabel="Member options"><Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} /></Pressable> : undefined} />
            ))}
          </ListSection>
          <ListSection title="Invite link">
            {inviteUrl ? (
              <>
                <ListItem icon="link-outline" title={inviteUrl.replace(/^https?:\/\//, '')} subtitle="Anyone with the link can join" onPress={async () => { await Clipboard.setStringAsync(inviteUrl); toast.success('Invite link copied'); }} showChevron={false} />
                {c.is_admin ? <ListItem icon="refresh-outline" title="Reset link" subtitle="Old links stop working" onPress={() => confirmAction('Reset invite link?', 'Anyone with the old link will no longer be able to join.', 'Reset', () => run(() => rotateInviteLink(conversationId), 'Invite link reset'))} /> : null}
                {c.is_admin ? <ListItem icon="shield-checkmark-outline" title="Approve new members" subtitle="Admins must approve people who join via link" switchValue={c.join_approval} onSwitchChange={(v) => run(() => updateGroup(conversationId, { joinApproval: v }))} /> : null}
              </>
            ) : null}
          </ListSection>
        </>
      ) : null}

      <ListSection title="Privacy">
        <ListItem icon="trash-outline" title="Clear chat" subtitle="Removes messages on your side" onPress={() => confirmAction('Clear this chat?', 'Messages are removed for you only.', 'Clear', () => run(() => clearConversation(conversationId), 'Chat cleared'))} />
        {!isGroup && other ? <ListItem icon="ban-outline" title={`Block ${other.display_name}`} danger onPress={() => confirmAction('Block?', 'They will not be able to message or find you.', 'Block', () => run(async () => { await blockUser(other.id); remove(conversationId); router.replace('/inbox'); }))} /> : null}
        <ListItem icon="flag-outline" title={isGroup ? 'Report group' : 'Report'} danger onPress={() => setReportOpen(true)} />
        <ListItem icon="exit-outline" title={isGroup ? 'Leave group' : 'Delete chat'} danger onPress={() => confirmAction(isGroup ? 'Leave group?' : 'Delete chat?', isGroup ? 'You will stop receiving messages.' : 'The chat is removed from your inbox.', isGroup ? 'Leave' : 'Delete', () => run(async () => { await leaveConversation(conversationId); remove(conversationId); router.replace('/inbox'); }))} />
      </ListSection>

      {/* Sheets */}
      <Sheet visible={editOpen} onClose={() => setEditOpen(false)} title="Edit group">
        <Input label="Group name" value={title} onChangeText={(v) => setTitle(v.slice(0, 80))} maxLength={80} />
        <Input label="Description" value={description} onChangeText={(v) => setDescription(v.slice(0, 500))} maxLength={500} multiline containerStyle={{ marginTop: spacing.md }} />
        <Button title="Save" fullWidth style={{ marginVertical: spacing.lg }} onPress={() => { setEditOpen(false); void run(() => updateGroup(conversationId, { title: title.trim() || undefined, description }), 'Group updated'); }} />
      </Sheet>
      <Sheet visible={addOpen} onClose={() => setAddOpen(false)} title="Add members" footer={<Button title={picked.length ? `Add ${picked.length}` : 'Add'} fullWidth disabled={!picked.length} style={{ marginBottom: spacing.md }} onPress={() => { setAddOpen(false); void run(() => addMembers(conversationId, picked.map((p) => p.id)), 'Members added'); }} />}>
        <Input placeholder="Search people" leftIcon="search-outline" value={query} onChangeText={setQuery} autoCapitalize="none" autoFocus />
        <ScrollView style={{ maxHeight: 320, marginTop: spacing.sm }}>
          {(search.data ?? []).filter((p) => !c.members.some((m) => m.id === p.id)).map((p) => {
            const on = picked.some((x) => x.id === p.id);
            return <ProfileRow key={p.id} profile={p} showBio={false} onPress={() => setPicked((prev) => (on ? prev.filter((x) => x.id !== p.id) : [...prev, p]))} right={<Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={on ? colors.primary : colors.textMuted} />} />;
          })}
        </ScrollView>
      </Sheet>
      <Sheet visible={muteOpen} onClose={() => setMuteOpen(false)} title="Mute notifications">
        {MUTE_OPTIONS.map((o) => (
          <Button key={o.label} title={o.label} variant="secondary" fullWidth style={{ marginBottom: spacing.sm }} onPress={() => { setMuteOpen(false); void run(() => setConversationSettings(conversationId, { mutedUntil: new Date(Date.now() + o.hours * 3600 * 1000).toISOString() }), 'Muted'); }} />
        ))}
        <View style={{ height: spacing.lg }} />
      </Sheet>
      <Sheet visible={wallOpen} onClose={() => setWallOpen(false)} title="Chat wallpaper">
        <View style={styles.wallGrid}>
          {WALLPAPERS.map((w) => (
            <Pressable key={w.id} onPress={() => { setWallOpen(false); void run(() => setConversationSettings(conversationId, { wallpaper: w.id === 'default' ? null : w.id })); }} style={[styles.wallTile, { borderColor: (c.wallpaper ?? 'default') === w.id ? colors.primary : 'transparent' }]} accessibilityLabel={`${w.label} wallpaper`}>
              <LinearGradient colors={w.colors} style={StyleSheet.absoluteFill} />
              <Text variant="caption" color={w.id === 'lavender' || w.id === 'cream' ? palette.ink : palette.white} style={styles.wallLabel}>
                {w.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={{ height: spacing.lg }} />
      </Sheet>
      <Sheet visible={disOpen} onClose={() => setDisOpen(false)} title="Disappearing messages" subtitle="New messages disappear for everyone after the selected time.">
        {DISAPPEARING_OPTIONS.map((o) => (
          <ListItem key={o.seconds} title={o.label} right={c.disappearing_seconds === o.seconds ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : undefined} onPress={() => { setDisOpen(false); void run(() => setDisappearing(conversationId, o.seconds)); }} showChevron={false} />
        ))}
        <View style={{ height: spacing.lg }} />
      </Sheet>
      <Sheet visible={Boolean(memberMenu)} onClose={() => setMemberMenu(null)} title={memberMenu?.display_name}>
        {memberMenu ? (
          <>
            <ListItem icon="person-outline" title="View profile" onPress={() => { setMemberMenu(null); router.navigate(`/u/${memberMenu.username}` as never); }} />
            {memberMenu.role === 'member' ? <ListItem icon="shield-outline" title="Make admin" onPress={() => { setMemberMenu(null); void run(() => setMemberRole(conversationId, memberMenu.id, 'admin'), 'Admin added'); }} /> : null}
            {memberMenu.role === 'admin' ? <ListItem icon="shield-outline" title="Remove as admin" onPress={() => { setMemberMenu(null); void run(() => setMemberRole(conversationId, memberMenu.id, 'member')); }} /> : null}
            {c.my_role === 'owner' && memberMenu.role !== 'owner' ? <ListItem icon="key-outline" title="Transfer ownership" onPress={() => { setMemberMenu(null); confirmAction('Transfer ownership?', `${memberMenu.display_name} becomes the group owner.`, 'Transfer', () => run(() => setMemberRole(conversationId, memberMenu.id, 'owner'), 'Ownership transferred')); }} /> : null}
            {memberMenu.role !== 'owner' ? <ListItem icon="person-remove-outline" title="Remove from group" danger onPress={() => { setMemberMenu(null); void run(() => removeMember(conversationId, memberMenu.id), 'Member removed'); }} /> : null}
          </>
        ) : null}
        <View style={{ height: spacing.lg }} />
      </Sheet>
      <Sheet visible={requestsOpen} onClose={() => setRequestsOpen(false)} title="Join requests">
        {(requests.data ?? []).length === 0 ? (
          <Text variant="body" color="textMuted" style={{ paddingVertical: spacing.lg }}>
            No pending requests.
          </Text>
        ) : (
          (requests.data ?? []).map((r) => (
            <ProfileRow key={r.id} profile={{ ...(r.user ?? { id: 'x', username: '', display_name: 'Unknown', avatar_url: null, is_verified: false, is_private: false, country_code: null }), bio: null, followers_count: 0 }} showBio={false} right={<View style={{ flexDirection: 'row', gap: spacing.xs }}><Button title="Approve" size="sm" onPress={() => run(() => respondJoinRequest(r.id, true).then(() => requests.refresh()), 'Approved')} /><Button title="Decline" size="sm" variant="ghost" onPress={() => run(() => respondJoinRequest(r.id, false).then(() => requests.refresh()))} /></View>} />
          ))
        )}
        <View style={{ height: spacing.lg }} />
      </Sheet>
      <ReportSheet visible={reportOpen} onClose={() => setReportOpen(false)} targetType={isGroup ? 'other' : 'profile'} targetId={isGroup ? conversationId : (other?.id ?? conversationId)} targetLabel={isGroup ? 'group' : 'profile'} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: spacing['2xl'] },
  camBadge: { position: 'absolute', right: 0, bottom: 0, width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  heroActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.lg },
  wallGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  wallTile: { width: '31%', aspectRatio: 0.75, borderRadius: radius.md, overflow: 'hidden', borderWidth: 2, justifyContent: 'flex-end', padding: spacing.sm },
  wallLabel: { fontWeight: '700' },
});
