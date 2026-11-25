import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Avatar } from '@/components/ui/Avatar';
import { Text } from '@/components/ui/Text';
import { RichText } from '@/features/feed/RichText';
import { useSignedUrl } from '@/hooks/useSignedUrl';
import { palette, radius, spacing } from '@/theme/tokens';
import type { Message, MessageAttachment, MessageStatus } from '@/types/messaging';
import { formatDate } from '@/utils/format';

import { VoiceNotePlayer } from './VoiceNotePlayer';
import type { ChatWallpaper } from './wallpapers';

export interface MessageBubbleProps {
  message: Message;
  isGroup: boolean;
  showSender: boolean;
  wallpaper: ChatWallpaper;
  lightWallpaper: boolean;
  onReply: (message: Message) => void;
  onLongPress: (message: Message) => void;
  onPressAttachment: (message: Message, attachment: MessageAttachment) => void;
  onPressQuoted: (messageId: string) => void;
  onRetry: (message: Message) => void;
  onDiscard: (message: Message) => void;
  onReact: (message: Message, emoji: string | null) => void;
  selected?: boolean;
  onToggleSelect?: (message: Message) => void;
  selectionMode?: boolean;
}

export function StatusTicks({ status, color }: { status: MessageStatus | null; color: string }) {
  if (!status) return null;
  if (status === 'sending') return <Ionicons name="time-outline" size={13} color={color} />;
  if (status === 'failed') return <Ionicons name="alert-circle" size={13} color={palette.danger} />;
  if (status === 'sent') return <Ionicons name="checkmark" size={14} color={color} />;
  return <Ionicons name="checkmark-done" size={14} color={status === 'read' ? '#4FC3F7' : color} />;
}

function ImageAttachment({ attachment, onPress, width }: { attachment: MessageAttachment; onPress: () => void; width: number }) {
  const url = useSignedUrl(attachment.thumbnail_path ?? attachment.path);
  const ratio = attachment.width && attachment.height ? Math.min(Math.max(attachment.width / attachment.height, 0.6), 1.8) : 1;
  return (
    <Pressable onPress={onPress} accessibilityRole="imagebutton" accessibilityLabel={attachment.kind === 'video' ? 'Video' : 'Photo'}>
      <View style={[styles.imageWrap, { width, height: width / ratio }]}>
        {url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} /> : null}
        {attachment.kind === 'video' ? (
          <View style={styles.playBadge}>
            <Ionicons name="play" size={22} color={palette.white} style={{ marginLeft: 2 }} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function DocumentAttachment({ attachment, onPress, textColor }: { attachment: MessageAttachment; onPress: () => void; textColor: string }) {
  const size = attachment.size_bytes ? (attachment.size_bytes > 1024 * 1024 ? `${(attachment.size_bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(attachment.size_bytes / 1024)} KB`) : '';
  return (
    <Pressable onPress={onPress} style={styles.docRow} accessibilityLabel={`Document ${attachment.name ?? ''}`}>
      <View style={styles.docIcon}>
        <Ionicons name="document-text" size={22} color={palette.white} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="smallMedium" style={{ color: textColor }} numberOfLines={2}>
          {attachment.name ?? 'Document'}
        </Text>
        <Text variant="caption" style={{ color: textColor, opacity: 0.7 }}>
          {(attachment.mime ?? '').split('/')[1]?.toUpperCase() ?? ''} {size}
        </Text>
      </View>
      <Ionicons name="download-outline" size={18} color={textColor} />
    </Pressable>
  );
}

function AudioAttachment({ attachment, mine, textColor }: { attachment: MessageAttachment; mine: boolean; textColor: string }) {
  const url = useSignedUrl(attachment.path);
  return <VoiceNotePlayer uri={url} durationMs={attachment.duration_ms} waveform={attachment.waveform} tint={mine ? palette.white : palette.purpleSoft} trackColor={mine ? 'rgba(255,255,255,0.35)' : 'rgba(163,102,255,0.35)'} textColor={textColor} />;
}

function MessageBubbleInner({ message, isGroup, showSender, wallpaper, lightWallpaper, onReply, onLongPress, onPressAttachment, onPressQuoted, onRetry, onDiscard, onReact, selected, onToggleSelect, selectionMode }: MessageBubbleProps) {
  const mine = message.is_mine;
  const translateX = useSharedValue(0);
  const pan = Gesture.Pan()
    .activeOffsetX([18, 999])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      translateX.value = Math.min(80, Math.max(0, e.translationX));
    })
    .onEnd(() => {
      if (translateX.value > 56) runOnJS(onReply)(message);
      translateX.value = withSpring(0, { damping: 18, stiffness: 220 });
    });
  const animated = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  const replyHint = useAnimatedStyle(() => ({ opacity: Math.min(1, translateX.value / 56) }));

  const bubbleBg = mine ? palette.purple : wallpaper.bubble;
  const textColor = mine ? palette.white : wallpaper.textOnBubble;
  const metaColor = mine ? 'rgba(255,255,255,0.75)' : lightWallpaper ? palette.ink3 : 'rgba(255,255,255,0.6)';
  const time = formatDate(message.created_at, 'HH:mm');
  const mediaWidth = 240;

  if (message.kind === 'system') {
    return (
      <View style={styles.systemRow}>
        <View style={[styles.systemPill, { backgroundColor: lightWallpaper ? 'rgba(23,19,38,0.08)' : 'rgba(255,255,255,0.12)' }]}>
          <Text variant="caption" style={{ color: lightWallpaper ? palette.ink2 : 'rgba(255,255,255,0.8)' }} align="center">
            {message.sender ? `${message.sender.display_name} ` : ''}
            {message.text}
          </Text>
        </View>
      </View>
    );
  }

  const content = () => {
    if (message.deleted) {
      return (
        <View style={styles.inline}>
          <Ionicons name="ban-outline" size={14} color={metaColor} />
          <Text variant="small" style={{ color: metaColor, fontStyle: 'italic', marginLeft: 4 }}>
            This message was deleted
          </Text>
        </View>
      );
    }
    switch (message.kind) {
      case 'image':
      case 'video':
        return (
          <View style={{ gap: 4 }}>
            {message.attachments.map((a) => (
              <ImageAttachment key={a.id} attachment={a} width={mediaWidth} onPress={() => onPressAttachment(message, a)} />
            ))}
            {message.text ? <RichText text={message.text} variant="body" style={{ color: textColor, marginTop: 2 }} /> : null}
          </View>
        );
      case 'audio':
        return message.attachments[0] ? <AudioAttachment attachment={message.attachments[0]} mine={mine} textColor={textColor} /> : null;
      case 'document':
        return (
          <View>
            {message.attachments.map((a) => (
              <DocumentAttachment key={a.id} attachment={a} textColor={textColor} onPress={() => onPressAttachment(message, a)} />
            ))}
          </View>
        );
      case 'sticker':
        return <Text style={{ fontSize: 64, lineHeight: 76 }}>{String(message.metadata.emoji ?? message.text ?? '✨')}</Text>;
      case 'gif':
        return (
          <Pressable onPress={() => message.metadata.url && Linking.openURL(String(message.metadata.url))}>
            <Image source={{ uri: String(message.metadata.url ?? '') }} style={{ width: mediaWidth, height: mediaWidth * 0.75, borderRadius: radius.md }} contentFit="cover" />
          </Pressable>
        );
      case 'location': {
        const lat = Number(message.metadata.lat);
        const lng = Number(message.metadata.lng);
        const url = Platform.select({ ios: `maps:0,0?q=${lat},${lng}`, android: `geo:${lat},${lng}?q=${lat},${lng}`, default: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}` })!;
        return (
          <Pressable onPress={() => Linking.openURL(url)} style={styles.locationCard}>
            <View style={styles.locationIcon}>
              <Ionicons name="location" size={26} color={palette.white} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="smallMedium" style={{ color: textColor }}>
                {String(message.metadata.name ?? 'Shared location')}
              </Text>
              <Text variant="caption" style={{ color: metaColor }}>
                {lat.toFixed(4)}, {lng.toFixed(4)} · Open in maps
              </Text>
            </View>
          </Pressable>
        );
      }
      case 'post':
        return (
          <Pressable onPress={() => message.metadata.post_id && router.navigate(`/post/${message.metadata.post_id}` as never)} style={[styles.shareCard, { borderColor: metaColor }]}>
            {message.metadata.thumbnail_url ? <Image source={{ uri: String(message.metadata.thumbnail_url) }} style={styles.shareThumb} contentFit="cover" /> : null}
            <View style={{ flex: 1 }}>
              <Text variant="caption" style={{ color: metaColor }}>
                Shared post
              </Text>
              <Text variant="small" style={{ color: textColor }} numberOfLines={3}>
                {String(message.metadata.display_name ?? '')}
                {message.text ? ` · ${message.text}` : ''}
              </Text>
            </View>
          </Pressable>
        );
      case 'video_share':
        return (
          <Pressable onPress={() => message.metadata.video_id && router.navigate(`/video/${message.metadata.video_id}` as never)} style={[styles.shareCard, { borderColor: metaColor }]}>
            {message.metadata.thumbnail_url ? <Image source={{ uri: String(message.metadata.thumbnail_url) }} style={styles.shareThumb} contentFit="cover" /> : null}
            <View style={{ flex: 1 }}>
              <Text variant="caption" style={{ color: metaColor }}>
                Shared video
              </Text>
              <Text variant="small" style={{ color: textColor }} numberOfLines={3}>
                {message.text ?? ''}
              </Text>
            </View>
          </Pressable>
        );
      case 'profile':
        return (
          <Pressable onPress={() => message.metadata.username && router.navigate(`/u/${message.metadata.username}` as never)} style={[styles.shareCard, { borderColor: metaColor }]}>
            <Avatar uri={(message.metadata.avatar_url as string | null) ?? null} name={String(message.metadata.display_name ?? '')} size={40} />
            <View style={{ flex: 1, marginLeft: spacing.sm }}>
              <Text variant="smallMedium" style={{ color: textColor }}>
                {String(message.metadata.display_name ?? '')}
              </Text>
              <Text variant="caption" style={{ color: metaColor }}>
                @{String(message.metadata.username ?? '')} · View profile
              </Text>
            </View>
          </Pressable>
        );
      case 'story_reply':
        return (
          <View>
            <View style={[styles.storyRef, { borderColor: metaColor }]}>
              {message.metadata.thumbnail_url ? <Image source={{ uri: String(message.metadata.thumbnail_url) }} style={styles.storyThumb} contentFit="cover" /> : <View style={[styles.storyThumb, { backgroundColor: palette.purpleDeep }]} />}
              <Text variant="caption" style={{ color: metaColor, flex: 1 }} numberOfLines={2}>
                Replied to a story{message.metadata.story_text ? `: ${String(message.metadata.story_text)}` : ''}
              </Text>
            </View>
            {message.text ? <RichText text={message.text} variant="body" style={{ color: textColor, marginTop: spacing.xs }} /> : null}
          </View>
        );
      case 'call': {
        const kind = message.metadata.call_kind === 'video' ? 'Video call' : 'Voice call';
        const outcome = message.metadata.outcome;
        const secs = Number(message.metadata.duration_seconds ?? 0);
        const dur = secs > 0 ? ` · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '';
        return (
          <View style={styles.inline}>
            <Ionicons name={message.metadata.call_kind === 'video' ? 'videocam' : 'call'} size={18} color={outcome === 'missed' ? palette.danger : textColor} />
            <Text variant="small" style={{ color: textColor, marginLeft: 6 }}>
              {outcome === 'missed' ? `Missed ${kind.toLowerCase()}` : outcome === 'declined' ? `${kind} declined` : outcome === 'cancelled' ? `${kind} cancelled` : `${kind}${dur}`}
            </Text>
          </View>
        );
      }
      default:
        return <RichText text={message.text ?? ''} variant="body" style={{ color: textColor }} />;
    }
  };

  const isMedia = (message.kind === 'image' || message.kind === 'video') && !message.text;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs, animated]}>
        <Animated.View style={[styles.replyHint, replyHint]} pointerEvents="none">
          <Ionicons name="arrow-undo" size={18} color={lightWallpaper ? palette.ink3 : 'rgba(255,255,255,0.8)'} />
        </Animated.View>
        {selectionMode ? (
          <Pressable onPress={() => onToggleSelect?.(message)} style={styles.selectBox} accessibilityRole="checkbox" accessibilityState={{ checked: Boolean(selected) }}>
            <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected ? palette.purpleSoft : lightWallpaper ? palette.ink3 : 'rgba(255,255,255,0.6)'} />
          </Pressable>
        ) : null}
        {!mine && isGroup ? (
          <View style={{ width: 32, marginRight: 6, alignSelf: 'flex-end' }}>
            {showSender && message.sender ? <Avatar uri={message.sender.avatar_url} name={message.sender.display_name} size={28} /> : null}
          </View>
        ) : null}
        <Pressable
          onLongPress={() => (selectionMode ? onToggleSelect?.(message) : onLongPress(message))}
          onPress={selectionMode ? () => onToggleSelect?.(message) : undefined}
          delayLongPress={280}
          style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, { backgroundColor: message.kind === 'sticker' ? 'transparent' : bubbleBg }, isMedia && styles.bubbleMedia, selected && { opacity: 0.7 }]}
        >
          {showSender && !mine && isGroup && message.sender ? (
            <Pressable onPress={() => router.navigate(`/u/${message.sender!.username}` as never)}>
              <Text variant="caption" style={{ color: palette.pinkSoft, fontWeight: '700', marginBottom: 2 }}>
                {message.sender.display_name}
              </Text>
            </Pressable>
          ) : null}
          {message.forwarded ? (
            <View style={styles.inline}>
              <Ionicons name="arrow-redo-outline" size={12} color={metaColor} />
              <Text variant="caption" style={{ color: metaColor, fontStyle: 'italic', marginLeft: 4 }}>
                Forwarded
              </Text>
            </View>
          ) : null}
          {message.reply_to ? (
            <Pressable onPress={() => onPressQuoted(message.reply_to!.id)} style={[styles.quote, { borderLeftColor: mine ? palette.pinkSoft : palette.purpleSoft, backgroundColor: mine ? 'rgba(0,0,0,0.18)' : lightWallpaper ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)' }]}>
              <Text variant="caption" style={{ color: mine ? palette.pinkSoft : palette.purpleSoft, fontWeight: '700' }} numberOfLines={1}>
                {message.reply_to.sender?.display_name ?? 'Unknown'}
              </Text>
              <Text variant="caption" style={{ color: textColor }} numberOfLines={2}>
                {message.reply_to.preview}
              </Text>
            </Pressable>
          ) : null}
          {content()}
          {typeof message.upload_progress === 'number' && message.status === 'sending' ? (
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(message.upload_progress * 100)}%` }]} />
            </View>
          ) : null}
          <View style={[styles.meta, isMedia && styles.metaOverlay]}>
            {message.expires_at ? <Ionicons name="timer-outline" size={11} color={metaColor} style={{ marginRight: 3 }} /> : null}
            {message.edited_at ? (
              <Text variant="caption" style={{ color: metaColor, marginRight: 4, fontSize: 10 }}>
                edited
              </Text>
            ) : null}
            <Text variant="caption" style={{ color: isMedia ? palette.white : metaColor, fontSize: 10 }}>
              {time}
            </Text>
            {mine ? (
              <View style={{ marginLeft: 3 }}>
                <StatusTicks status={message.status} color={isMedia ? palette.white : metaColor} />
              </View>
            ) : null}
          </View>
        </Pressable>
        {message.reactions.length > 0 ? (
          <View style={[styles.reactions, mine ? { right: spacing.md } : { left: isGroup ? 44 : spacing.md }]}>
            {message.reactions.slice(0, 4).map((r) => (
              <Pressable key={r.emoji} onPress={() => onReact(message, message.my_reaction === r.emoji ? null : r.emoji)} style={[styles.reactionChip, { backgroundColor: lightWallpaper ? palette.white : palette.night3, borderColor: message.my_reaction === r.emoji ? palette.purpleSoft : 'transparent' }]}>
                <Text style={{ fontSize: 12, lineHeight: 15 }}>
                  {r.emoji}
                  {r.count > 1 ? ` ${r.count}` : ''}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {message.status === 'failed' ? (
          <View style={styles.failedRow}>
            <Text variant="caption" color="danger">
              {message.error ?? 'Not sent'}
            </Text>
            <Pressable onPress={() => onRetry(message)} hitSlop={6}>
              <Text variant="caption" color="primary" style={{ marginLeft: spacing.sm, fontWeight: '700' }}>
                Retry
              </Text>
            </Pressable>
            <Pressable onPress={() => onDiscard(message)} hitSlop={6}>
              <Text variant="caption" color="textMuted" style={{ marginLeft: spacing.sm }}>
                Discard
              </Text>
            </Pressable>
          </View>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

export const MessageBubble = memo(MessageBubbleInner);

const styles = StyleSheet.create({
  row: { paddingHorizontal: spacing.md, marginVertical: 2, flexDirection: 'row', alignItems: 'flex-end' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  replyHint: { position: 'absolute', left: -14, top: '40%' },
  selectBox: { width: 32, alignSelf: 'center', alignItems: 'center' },
  bubble: { maxWidth: '78%', borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bubbleMine: { borderBottomRightRadius: 6 },
  bubbleTheirs: { borderBottomLeftRadius: 6 },
  bubbleMedia: { padding: 4 },
  inline: { flexDirection: 'row', alignItems: 'center' },
  quote: { borderLeftWidth: 3, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, marginBottom: spacing.xs },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 2 },
  metaOverlay: { position: 'absolute', right: 10, bottom: 8, backgroundColor: 'rgba(9,8,23,0.55)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  imageWrap: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.2)' },
  playBadge: { position: 'absolute', top: '50%', left: '50%', marginLeft: -24, marginTop: -24, width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(9,8,23,0.55)', alignItems: 'center', justifyContent: 'center' },
  docRow: { flexDirection: 'row', alignItems: 'center', minWidth: 220, paddingVertical: 4 },
  docIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  locationCard: { flexDirection: 'row', alignItems: 'center', minWidth: 220 },
  locationIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  shareCard: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: spacing.sm, minWidth: 220 },
  shareThumb: { width: 56, height: 56, borderRadius: radius.sm, marginRight: spacing.sm },
  storyRef: { flexDirection: 'row', alignItems: 'center', borderLeftWidth: 3, paddingLeft: spacing.sm, gap: spacing.sm },
  storyThumb: { width: 36, height: 56, borderRadius: 6 },
  reactions: { position: 'absolute', bottom: -10, flexDirection: 'row', gap: 4 },
  reactionChip: { borderRadius: radius.full, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1.5 },
  failedRow: { position: 'absolute', right: spacing.md, bottom: -16, flexDirection: 'row', alignItems: 'center' },
  progressTrack: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', marginTop: 4, overflow: 'hidden' },
  progressFill: { height: 3, backgroundColor: palette.white },
  systemRow: { alignItems: 'center', marginVertical: spacing.sm, paddingHorizontal: spacing['2xl'] },
  systemPill: { borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 4, maxWidth: '90%' },
});
