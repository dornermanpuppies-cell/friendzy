import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { AttachmentViewer } from '@/features/chat/AttachmentViewer';
import { ChatComposer } from '@/features/chat/ChatComposer';
import { ForwardSheet } from '@/features/chat/ForwardSheet';
import { MessageActionsSheet } from '@/features/chat/MessageActionsSheet';
import { MessageBubble } from '@/features/chat/MessageBubble';
import { isLightWallpaper, wallpaperFor } from '@/features/chat/wallpapers';
import { confirmAction } from '@/features/feed/usePostActions';
import { ProfileRow } from '@/features/profile/ProfileRow';
import { ReportSheet } from '@/features/profile/ReportSheet';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { startCall } from '@/services/calls';
import { deleteMessage, editMessage, fetchConversation, getMessageInfo, markConversationRead, pinMessage, reactToMessage, respondMessageRequest, starMessage, subscribeToConversation } from '@/services/messaging';
import { getPresence } from '@/services/presence';
import { blockUser } from '@/services/safety';
import { useAuth } from '@/store/authStore';
import { useBadgeStore } from '@/store/badgeStore';
import { useChatStore } from '@/store/chatStore';
import { palette, spacing } from '@/theme/tokens';
import type { PresenceInfo } from '@/types/database';
import type { Message, MessageAttachment } from '@/types/messaging';
import { getErrorMessage } from '@/utils/errors';
import { formatDate, lastSeenLabel } from '@/utils/format';

type Row = { type: 'message'; message: Message } | { type: 'day'; id: string; label: string };

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return formatDate(d, 'EEEE, d MMM');
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = String(id);
  const { user, profile } = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { isDesktop } = useBreakpoint();
  const listRef = useRef<FlatList<Row>>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [actions, setActions] = useState<Message | null>(null);
  const [forward, setForward] = useState<string[] | null>(null);
  const [viewer, setViewer] = useState<MessageAttachment | null>(null);
  const [info, setInfo] = useState<{ user: Message['sender']; delivered_at: string | null; read_at: string | null }[] | null>(null);
  const [report, setReport] = useState<Message | null>(null);
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [presence, setPresence] = useState<PresenceInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { conversation, messages, thread, typing, upsertConversation, loadMessages, send, retry, discardFailed, patchMessage, removeMessage, applyRemoteMessage, applyMemberUpdate, setTyping, patchConversation } = useChatStore(
    useShallow((s) => ({
      conversation: s.conversations[conversationId],
      messages: s.messages[conversationId],
      thread: s.threads[conversationId],
      typing: s.typing[conversationId],
      upsertConversation: s.upsertConversation,
      loadMessages: s.loadMessages,
      send: s.send,
      retry: s.retry,
      discardFailed: s.discardFailed,
      patchMessage: s.patchMessage,
      removeMessage: s.removeMessage,
      applyRemoteMessage: s.applyRemoteMessage,
      applyMemberUpdate: s.applyMemberUpdate,
      setTyping: s.setTyping,
      patchConversation: s.patchConversation,
    })),
  );
  const refreshInbox = useBadgeStore((s) => s.refreshInbox);
  const typingRef = useRef<((typing: boolean, name: string, userId: string) => void) | null>(null);

  // Load conversation + messages.
  useEffect(() => {
    let cancelled = false;
    fetchConversation(conversationId)
      .then((detail) => {
        if (!cancelled) upsertConversation(detail);
      })
      .catch((error) => !cancelled && setLoadError(getErrorMessage(error)));
    void loadMessages(conversationId);
    return () => {
      cancelled = true;
    };
  }, [conversationId, upsertConversation, loadMessages]);

  // Presence for direct chats.
  useEffect(() => {
    const other = conversation?.other_user?.id;
    if (!other) return;
    let cancelled = false;
    const tick = () => getPresence([other]).then((map) => !cancelled && setPresence(map.get(other) ?? null)).catch(() => undefined);
    tick();
    const timer = setInterval(tick, 45_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [conversation?.other_user?.id]);

  // Realtime.
  useEffect(() => {
    const sub = subscribeToConversation(conversationId, {
      onMessageInsert: (row) => {
        void applyRemoteMessage(conversationId, row.id).then(() => {
          if (row.sender_id !== user?.id) void markConversationRead(conversationId).then(() => patchConversation(conversationId, { unread_count: 0 }));
        });
      },
      onMessageUpdate: (row) => void applyRemoteMessage(conversationId, row.id),
      onMessageDelete: (row) => removeMessage(conversationId, row.id),
      onReactionChange: (messageId) => void applyRemoteMessage(conversationId, messageId),
      onMemberUpdate: (row) => applyMemberUpdate(conversationId, row.user_id, row.last_read_at, row.last_delivered_at),
      onTyping: (payload) => setTyping(conversationId, { user_id: payload.user_id, name: payload.name }, payload.typing),
    });
    typingRef.current = sub.sendTyping;
    return () => {
      typingRef.current = null;
      sub.unsubscribe();
    };
  }, [conversationId, user?.id, applyRemoteMessage, removeMessage, applyMemberUpdate, setTyping, patchConversation]);

  // Mark read when the screen is focused.
  useFocusEffect(
    useCallback(() => {
      if (!conversation || conversation.is_request) return;
      void markConversationRead(conversationId).then(() => {
        patchConversation(conversationId, { unread_count: 0, marked_unread: false });
        void refreshInbox();
      });
    }, [conversationId, conversation?.id, conversation?.is_request]), // eslint-disable-line react-hooks/exhaustive-deps
  );

  const wallpaper = wallpaperFor(conversation?.wallpaper ?? profile?.id ? conversation?.wallpaper : null);
  const light = isLightWallpaper(wallpaper);
  const isGroup = conversation?.kind === 'group';
  const canModerate = Boolean(conversation && (conversation.my_role === 'owner' || conversation.my_role === 'admin'));
  const typingNames = (typing ?? []).filter((t) => t.until > Date.now() && t.user_id !== user?.id).map((t) => t.name.split(' ')[0]);

  const rows = useMemo<Row[]>(() => {
    const list = messages ?? [];
    const out: Row[] = [];
    let lastDay = '';
    for (const m of list) {
      const day = new Date(m.created_at).toDateString();
      if (day !== lastDay) {
        out.push({ type: 'day', id: `day-${day}`, label: dayLabel(m.created_at) });
        lastDay = day;
      }
      out.push({ type: 'message', message: m });
    }
    return out.reverse(); // inverted list
  }, [messages]);

  const scrollToMessage = (messageId: string) => {
    const index = rows.findIndex((r) => r.type === 'message' && r.message.id === messageId);
    if (index >= 0) listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    else toast.info('Message is further up', 'Load older messages to find it.');
  };

  const react = async (m: Message, emoji: string | null) => {
    const prev = m.my_reaction;
    patchMessage(conversationId, m.id, (x) => ({ ...x, my_reaction: emoji }));
    try {
      await reactToMessage(m.id, emoji);
      void applyRemoteMessage(conversationId, m.id);
    } catch (error) {
      patchMessage(conversationId, m.id, (x) => ({ ...x, my_reaction: prev }));
      toast.error(getErrorMessage(error));
    }
  };

  const del = (m: Message, forEveryone: boolean) => {
    confirmAction(forEveryone ? 'Delete for everyone?' : 'Delete for you?', forEveryone ? 'This message will be removed for all participants.' : 'The message is removed from your view only.', 'Delete', async () => {
      try {
        await deleteMessage(m.id, forEveryone);
        if (forEveryone) patchMessage(conversationId, m.id, { deleted: true, text: null, attachments: [], metadata: {} });
        else removeMessage(conversationId, m.id);
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    });
  };

  const deleteSelected = () => {
    if (!selection?.size) return;
    confirmAction(`Delete ${selection.size} message${selection.size === 1 ? '' : 's'}?`, 'They will be removed from your view.', 'Delete', async () => {
      for (const mid of selection) {
        try {
          await deleteMessage(mid, false);
          removeMessage(conversationId, mid);
        } catch (error) {
          toast.error(getErrorMessage(error));
        }
      }
      setSelection(null);
    });
  };

  const handleCall = async (kind: 'voice' | 'video') => {
    if (!conversation) return;
    try {
      const callId = await startCall(conversation.id, kind);
      router.navigate(`/call/${callId}` as never);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const headerSubtitle = (() => {
    if (!conversation) return '';
    if (typingNames.length) return `${typingNames.join(', ')} typing…`;
    if (isGroup) return `${conversation.members_count} members${conversation.disappearing_seconds ? ' · disappearing on' : ''}`;
    const seen = lastSeenLabel(presence?.last_seen_at, presence?.is_online);
    return [seen, conversation.disappearing_seconds ? 'disappearing on' : ''].filter(Boolean).join(' · ');
  })();

  if (loadError) {
    return (
      <View style={[styles.root, { backgroundColor: palette.night, paddingTop: insets.top }]}>
        <EmptyState icon="chatbubble-ellipses-outline" title="Conversation unavailable" description={loadError} action={{ title: 'Back to inbox', onPress: () => router.replace('/inbox') }} style={{ flex: 1 }} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style={light ? 'dark' : 'light'} />
      <LinearGradient colors={wallpaper.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: isDesktop ? spacing.sm : insets.top, backgroundColor: light ? 'rgba(255,255,255,0.85)' : 'rgba(9,8,23,0.85)' }]}>
          {selection ? (
            <>
              <Pressable onPress={() => setSelection(null)} style={styles.headerBtn} accessibilityLabel="Cancel selection">
                <Ionicons name="close" size={24} color={light ? palette.ink : palette.white} />
              </Pressable>
              <Text variant="h4" style={{ flex: 1, color: light ? palette.ink : palette.white }}>
                {selection.size} selected
              </Text>
              <Pressable onPress={() => setForward(Array.from(selection))} style={styles.headerBtn} accessibilityLabel="Forward selected" disabled={!selection.size}>
                <Ionicons name="arrow-redo-outline" size={22} color={light ? palette.ink : palette.white} />
              </Pressable>
              <Pressable onPress={deleteSelected} style={styles.headerBtn} accessibilityLabel="Delete selected" disabled={!selection.size}>
                <Ionicons name="trash-outline" size={22} color={palette.danger} />
              </Pressable>
            </>
          ) : (
            <>
              <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/inbox'))} style={styles.headerBtn} accessibilityLabel="Back">
                <Ionicons name="arrow-back" size={24} color={light ? palette.ink : palette.white} />
              </Pressable>
              <Pressable onPress={() => router.navigate(`/chat/${conversationId}/info` as never)} style={styles.headerTitle} accessibilityLabel="Conversation info">
                <Avatar uri={conversation?.avatar_url} name={conversation?.title} size={38} online={!isGroup ? presence?.is_online : undefined} />
                <View style={{ flex: 1, marginLeft: spacing.sm }}>
                  <Text variant="bodySemibold" numberOfLines={1} style={{ color: light ? palette.ink : palette.white }}>
                    {conversation?.title ?? '…'}
                  </Text>
                  {headerSubtitle ? (
                    <Text variant="caption" numberOfLines={1} style={{ color: typingNames.length ? palette.pinkSoft : light ? palette.ink3 : 'rgba(255,255,255,0.7)' }}>
                      {headerSubtitle}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
              {!conversation?.is_request ? (
                <>
                  <Pressable onPress={() => handleCall('voice')} style={styles.headerBtn} accessibilityLabel="Voice call">
                    <Ionicons name="call-outline" size={22} color={light ? palette.ink : palette.white} />
                  </Pressable>
                  <Pressable onPress={() => handleCall('video')} style={styles.headerBtn} accessibilityLabel="Video call">
                    <Ionicons name="videocam-outline" size={24} color={light ? palette.ink : palette.white} />
                  </Pressable>
                </>
              ) : null}
              <Pressable onPress={() => router.navigate(`/chat/${conversationId}/search` as never)} style={styles.headerBtn} accessibilityLabel="Search in conversation">
                <Ionicons name="search-outline" size={22} color={light ? palette.ink : palette.white} />
              </Pressable>
            </>
          )}
        </View>

        {/* Pinned banner */}
        {conversation && 'pins' in conversation && Array.isArray((conversation as { pins?: Message[] }).pins) && ((conversation as { pins?: Message[] }).pins?.length ?? 0) > 0 ? (
          <Pressable onPress={() => scrollToMessage((conversation as { pins: Message[] }).pins[0].id)} style={[styles.pinBanner, { backgroundColor: light ? 'rgba(255,255,255,0.75)' : 'rgba(9,8,23,0.6)' }]}>
            <Ionicons name="pin" size={16} color={palette.purpleSoft} />
            <Text variant="caption" numberOfLines={1} style={{ flex: 1, marginLeft: spacing.sm, color: light ? palette.ink : palette.white }}>
              {(conversation as { pins: Message[] }).pins[0].text ?? 'Pinned message'}
            </Text>
          </Pressable>
        ) : null}

        {/* Messages */}
        {!thread?.loaded ? (
          <ActivityIndicator color={palette.purpleSoft} style={{ flex: 1 }} />
        ) : (
          <FlatList
            ref={listRef}
            data={rows}
            inverted
            keyExtractor={(r) => (r.type === 'message' ? r.message.id : r.id)}
            renderItem={({ item, index }) => {
              if (item.type === 'day') {
                return (
                  <View style={styles.dayRow}>
                    <View style={[styles.dayPill, { backgroundColor: light ? 'rgba(23,19,38,0.08)' : 'rgba(255,255,255,0.12)' }]}>
                      <Text variant="caption" style={{ color: light ? palette.ink2 : 'rgba(255,255,255,0.8)' }}>
                        {item.label}
                      </Text>
                    </View>
                  </View>
                );
              }
              const next = rows[index + 1]; // chronologically previous (list is inverted)
              const showSender = !(next && next.type === 'message' && next.message.sender?.id === item.message.sender?.id && next.message.kind !== 'system');
              return (
                <MessageBubble
                  message={item.message}
                  isGroup={Boolean(isGroup)}
                  showSender={showSender}
                  wallpaper={wallpaper}
                  lightWallpaper={light}
                  onReply={(m) => { setEditing(null); setReplyTo(m); }}
                  onLongPress={setActions}
                  onPressAttachment={(_, a) => setViewer(a)}
                  onPressQuoted={scrollToMessage}
                  onRetry={(m) => m.client_id && retry(conversationId, m.client_id)}
                  onDiscard={(m) => m.client_id && discardFailed(conversationId, m.client_id)}
                  onReact={react}
                  selectionMode={Boolean(selection)}
                  selected={selection?.has(item.message.id)}
                  onToggleSelect={(m) => setSelection((prev) => { const next = new Set(prev ?? []); if (next.has(m.id)) next.delete(m.id); else next.add(m.id); return next; })}
                />
              );
            }}
            onEndReached={() => thread.hasMore && void loadMessages(conversationId, true)}
            onEndReachedThreshold={0.4}
            ListFooterComponent={thread.loading && thread.hasMore ? <ActivityIndicator color={palette.purpleSoft} style={{ padding: spacing.md }} /> : <View style={{ height: spacing.md }} />}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Avatar uri={conversation?.avatar_url} name={conversation?.title} size={72} />
                <Text variant="h4" style={{ color: light ? palette.ink : palette.white, marginTop: spacing.md }}>
                  {conversation?.title}
                </Text>
                <Text variant="small" style={{ color: light ? palette.ink3 : 'rgba(255,255,255,0.7)', textAlign: 'center', marginTop: 4 }}>
                  {isGroup ? 'Say hello to the group.' : 'This is the beginning of your conversation. Messages are protected in transit and stored securely.'}
                </Text>
              </View>
            }
            contentContainerStyle={[styles.listContent, rows.length === 0 && { flex: 1, justifyContent: 'center', transform: [{ scaleY: -1 }] }]}
            onScrollToIndexFailed={() => undefined}
            keyboardShouldPersistTaps="handled"
            removeClippedSubviews={false}
          />
        )}

        {/* Request banner or composer */}
        {conversation?.is_request ? (
          <View style={[styles.requestBar, { paddingBottom: insets.bottom + spacing.md, backgroundColor: light ? 'rgba(255,255,255,0.9)' : 'rgba(9,8,23,0.9)' }]}>
            <Text variant="small" style={{ color: light ? palette.ink2 : 'rgba(255,255,255,0.85)', textAlign: 'center', marginBottom: spacing.md }}>
              {conversation.other_user?.display_name ?? 'This person'} wants to message you. Accept to reply — they won’t know you’ve seen it until you do.
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' }}>
              <Button title="Accept" onPress={async () => { try { await respondMessageRequest(conversationId, true); patchConversation(conversationId, { is_request: false }); toast.success('Request accepted'); } catch (error) { toast.error(getErrorMessage(error)); } }} />
              <Button title="Delete" variant="secondary" onPress={async () => { try { await respondMessageRequest(conversationId, false); useChatStore.getState().removeConversation(conversationId); router.replace('/inbox'); } catch (error) { toast.error(getErrorMessage(error)); } }} />
              {conversation.other_user ? <Button title="Block" variant="ghost" onPress={() => confirmAction('Block this person?', 'They will not be able to contact you.', 'Block', async () => { try { await blockUser(conversation.other_user!.id); useChatStore.getState().removeConversation(conversationId); router.replace('/inbox'); } catch (error) { toast.error(getErrorMessage(error)); } })} /> : null}
            </View>
          </View>
        ) : (
          <ChatComposer
            replyTo={replyTo}
            editing={editing}
            lightWallpaper={light}
            onCancelContext={() => { setReplyTo(null); setEditing(null); }}
            onTyping={(typing) => profile && typingRef.current?.(typing, profile.display_name, profile.id)}
            onSendText={(text) => { void send({ conversationId, text, replyToId: replyTo?.id ?? null }); setReplyTo(null); }}
            onSendAttachments={(items, kind, text) => { void send({ conversationId, kind, text: text ?? null, attachments: items, replyToId: replyTo?.id ?? null }); setReplyTo(null); }}
            onSendSticker={(s) => void send({ conversationId, kind: 'sticker', text: s.label, metadata: { sticker_id: s.id, emoji: s.emoji ?? undefined, url: s.url ?? undefined } })}
            onSendGif={(url, preview) => void send({ conversationId, kind: 'gif', metadata: { url, thumbnail_url: preview } })}
            onSendLocation={(metadata) => void send({ conversationId, kind: 'location', metadata })}
            onSubmitEdit={async (text) => { if (!editing) return; const target = editing; setEditing(null); try { const updated = await editMessage(target.id, text); useChatStore.getState().upsertMessage(updated); } catch (error) { toast.error(getErrorMessage(error)); } }}
          />
        )}
      </KeyboardAvoidingView>

      <MessageActionsSheet
        message={actions}
        isGroup={Boolean(isGroup)}
        canModerate={canModerate}
        onClose={() => setActions(null)}
        onReply={(m) => { setEditing(null); setReplyTo(m); }}
        onReact={react}
        onCopy={async (m) => { await Clipboard.setStringAsync(m.text ?? ''); toast.success('Copied'); }}
        onForward={(m) => setForward([m.id])}
        onStar={async (m) => { try { await starMessage(m.id, !m.starred); patchMessage(conversationId, m.id, { starred: !m.starred }); toast.success(m.starred ? 'Unstarred' : 'Starred'); } catch (error) { toast.error(getErrorMessage(error)); } }}
        onPin={async (m) => { try { await pinMessage(m.id, !m.pinned); patchMessage(conversationId, m.id, { pinned: !m.pinned }); const detail = await fetchConversation(conversationId); upsertConversation(detail); } catch (error) { toast.error(getErrorMessage(error)); } }}
        onEdit={(m) => { setReplyTo(null); setEditing(m); }}
        onDelete={del}
        onInfo={async (m) => { try { setInfo(await getMessageInfo(m.id)); } catch (error) { toast.error(getErrorMessage(error)); } }}
        onReport={setReport}
        onSelect={(m) => setSelection(new Set([m.id]))}
      />
      <ForwardSheet messageIds={forward ?? []} visible={Boolean(forward)} onClose={() => setForward(null)} onDone={() => setSelection(null)} />
      <AttachmentViewer attachment={viewer} onClose={() => setViewer(null)} />
      <Sheet visible={Boolean(info)} onClose={() => setInfo(null)} title="Message info">
        {(info ?? []).length === 0 ? (
          <Text variant="body" color="textMuted" style={{ paddingVertical: spacing.lg }}>
            No recipients yet.
          </Text>
        ) : (
          (info ?? []).map((row) => (
            <ProfileRow key={row.user?.id ?? 'x'} profile={{ ...(row.user ?? { id: 'x', username: '', display_name: 'Unknown', avatar_url: null, is_verified: false, is_private: false, country_code: null }), bio: null, followers_count: 0 }} showBio={false} subtitle={row.read_at ? `Read ${formatDate(row.read_at, 'd MMM HH:mm')}` : row.delivered_at ? `Delivered ${formatDate(row.delivered_at, 'd MMM HH:mm')}` : 'Sent'} onPress={() => undefined} />
          ))
        )}
        <View style={{ height: spacing.lg }} />
      </Sheet>
      {report ? <ReportSheet visible onClose={() => setReport(null)} targetType="message" targetId={report.id} targetLabel="message" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xs, paddingBottom: spacing.xs, ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(12px)' } as object) : null) },
  headerBtn: { width: 42, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  pinBanner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  listContent: { paddingVertical: spacing.md },
  dayRow: { alignItems: 'center', marginVertical: spacing.md },
  dayPill: { borderRadius: 12, paddingHorizontal: spacing.md, paddingVertical: 3 },
  emptyWrap: { alignItems: 'center', paddingHorizontal: spacing['3xl'] },
  requestBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
});
