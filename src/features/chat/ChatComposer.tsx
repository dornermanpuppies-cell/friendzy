import { Ionicons } from '@/components/ui/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListItem } from '@/components/ui/ListItem';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { confirmAction } from '@/features/feed/usePostActions';
import { captureMedia, pickMedia } from '@/services/media';
import type { LocalAttachment } from '@/services/messaging';
import { useTheme } from '@/theme/ThemeProvider';
import { fontFamily, palette, radius, spacing } from '@/theme/tokens';
import type { Message, MessageMetadata, Sticker } from '@/types/messaging';
import { AppError, getErrorMessage } from '@/utils/errors';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';

import { StickerPicker } from './StickerPicker';
import { VoiceRecorder, type VoiceNoteResult } from './VoiceRecorder';

export interface ChatComposerProps {
  replyTo: Message | null;
  editing: Message | null;
  onCancelContext: () => void;
  onSendText: (text: string) => void;
  onSendAttachments: (items: LocalAttachment[], kind: 'image' | 'video' | 'audio' | 'document', text?: string) => void;
  onSendSticker: (sticker: Sticker) => void;
  onSendGif: (url: string, previewUrl: string) => void;
  onSendLocation: (metadata: MessageMetadata) => void;
  onSubmitEdit: (text: string) => void;
  onTyping: (typing: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
  lightWallpaper: boolean;
}

export function ChatComposer({ replyTo, editing, onCancelContext, onSendText, onSendAttachments, onSendSticker, onSendGif, onSendLocation, onSubmitEdit, onTyping, disabled, disabledReason, lightWallpaper }: ChatComposerProps) {
  const { colors } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  // While the keyboard is open the navigation-bar strip is behind it, so reserving space for it
  // would leave a dead gap above the keys.
  const keyboardInset = useKeyboardInset();
  const bottomSpace = (keyboardInset > 0 ? 0 : insets.bottom) + spacing.sm;
  const [text, setText] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingSent = useRef(false);

  const [lastEditingId, setLastEditingId] = useState<string | null>(editing?.id ?? null);
  if ((editing?.id ?? null) !== lastEditingId) {
    setLastEditingId(editing?.id ?? null);
    if (editing) setText(editing.text ?? '');
  }
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  const handleChange = (value: string) => {
    setText(value);
    if (!typingSent.current && value.length > 0) {
      typingSent.current = true;
      onTyping(true);
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      typingSent.current = false;
      onTyping(false);
    }, 2500);
  };

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    if (editing) onSubmitEdit(value);
    else onSendText(value);
    setText('');
    typingSent.current = false;
    onTyping(false);
  };

  const pickFromLibrary = async () => {
    setAttachOpen(false);
    try {
      const picked = await pickMedia({ multiple: true, max: 10 });
      if (!picked.length) return;
      const items: LocalAttachment[] = picked.map((p) => ({ uri: p.uri, kind: p.kind, mime: p.mime, width: p.width, height: p.height, durationMs: p.durationMs, size: p.fileSize }));
      const kind = items.every((i) => i.kind === 'video') ? 'video' : 'image';
      onSendAttachments(items, kind);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const capture = async (kind: 'image' | 'video') => {
    setAttachOpen(false);
    try {
      const captured = await captureMedia(kind);
      if (captured) onSendAttachments([{ uri: captured.uri, kind: captured.kind, mime: captured.mime, width: captured.width, height: captured.height, durationMs: captured.durationMs }], captured.kind);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const pickDocument = async () => {
    setAttachOpen(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      if (asset.size && asset.size > 100 * 1024 * 1024) throw new AppError('Documents must be smaller than 100 MB.');
      onSendAttachments([{ uri: asset.uri, kind: 'document', mime: asset.mimeType ?? 'application/octet-stream', name: asset.name, size: asset.size }], 'document', asset.name);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const shareLocation = () => {
    setAttachOpen(false);
    confirmAction('Share your location?', 'Your current position will be sent in this chat. Only share with people you trust.', 'Share', async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) throw new AppError('Location permission is needed to share your location.');
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        let name = 'Current location';
        try {
          const places = await Location.reverseGeocodeAsync({ latitude: position.coords.latitude, longitude: position.coords.longitude });
          const place = places[0];
          if (place) name = [place.name ?? place.street, place.city ?? place.region].filter(Boolean).join(', ') || name;
        } catch {
          /* best effort */
        }
        onSendLocation({ lat: Number(position.coords.latitude.toFixed(5)), lng: Number(position.coords.longitude.toFixed(5)), name });
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    });
  };

  const sendVoice = (note: VoiceNoteResult) => {
    setRecording(false);
    onSendAttachments([{ uri: note.uri, kind: 'audio', mime: note.mime, durationMs: note.durationMs, waveform: note.waveform }], 'audio');
  };

  const barBg = lightWallpaper ? 'rgba(255,255,255,0.85)' : 'rgba(9,8,23,0.85)';
  const fieldBg = lightWallpaper ? palette.white : palette.night3;
  const fieldText = lightWallpaper ? palette.ink : palette.white;
  const iconColor = lightWallpaper ? palette.ink3 : 'rgba(255,255,255,0.75)';

  if (disabled) {
    return (
      <View style={[styles.disabled, { backgroundColor: barBg, paddingBottom: bottomSpace }]}>
        <Ionicons name="lock-closed-outline" size={16} color={iconColor} />
        <Text variant="small" style={{ color: iconColor, marginLeft: spacing.sm, textAlign: 'center', flex: 1 }}>
          {disabledReason ?? 'You cannot send messages in this conversation.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: barBg, paddingBottom: bottomSpace }]}>
      {replyTo || editing ? (
        <View style={[styles.context, { backgroundColor: fieldBg, borderLeftColor: palette.purpleSoft }]}>
          <View style={{ flex: 1 }}>
            <Text variant="caption" color={palette.purpleSoft} style={{ fontWeight: '700' }}>
              {editing ? 'Edit message' : `Replying to ${replyTo?.sender?.display_name ?? ''}`}
            </Text>
            <Text variant="caption" style={{ color: fieldText }} numberOfLines={1}>
              {editing ? editing.text : (replyTo?.text ?? replyTo?.kind)}
            </Text>
          </View>
          <Pressable onPress={() => { onCancelContext(); if (editing) setText(''); }} hitSlop={8} accessibilityLabel="Cancel">
            <Ionicons name="close" size={18} color={iconColor} />
          </Pressable>
        </View>
      ) : null}
      {stickersOpen ? <StickerPicker onSticker={(s) => { setStickersOpen(false); onSendSticker(s); }} onGif={(url, preview) => { setStickersOpen(false); onSendGif(url, preview); }} onClose={() => setStickersOpen(false)} /> : null}
      {recording ? (
        <VoiceRecorder onSend={sendVoice} onCancel={() => setRecording(false)} />
      ) : (
        <View style={styles.row}>
          <Pressable onPress={() => setAttachOpen(true)} style={styles.iconBtn} accessibilityLabel="Attach" disabled={Boolean(editing)}>
            <Ionicons name="add-circle-outline" size={26} color={editing ? 'rgba(128,128,128,0.4)' : iconColor} />
          </Pressable>
          <View style={[styles.field, { backgroundColor: fieldBg }]}>
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={handleChange}
              placeholder={editing ? 'Edit your message' : 'Message'}
              placeholderTextColor={lightWallpaper ? palette.ink4 : 'rgba(255,255,255,0.45)'}
              multiline
              maxLength={5000}
              style={[styles.input, { color: fieldText }]}
              onSubmitEditing={Platform.OS === 'web' ? submit : undefined}
              blurOnSubmit={false}
              {...(Platform.OS === 'web' ? ({ onKeyPress: (e: { nativeEvent: { key: string; shiftKey?: boolean }; preventDefault?: () => void }) => { if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) { e.preventDefault?.(); submit(); } } } as object) : null)}
            />
            <Pressable onPress={() => setStickersOpen((v) => !v)} style={styles.inlineBtn} accessibilityLabel="Stickers and GIFs">
              <Ionicons name={stickersOpen ? 'happy' : 'happy-outline'} size={22} color={stickersOpen ? palette.purpleSoft : iconColor} />
            </Pressable>
          </View>
          {text.trim().length > 0 || editing ? (
            <Pressable onPress={submit} style={[styles.send, { backgroundColor: palette.purple }]} accessibilityLabel={editing ? 'Save edit' : 'Send'}>
              <Ionicons name={editing ? 'checkmark' : 'send'} size={18} color={palette.white} />
            </Pressable>
          ) : (
            <Pressable onPress={() => setRecording(true)} style={[styles.send, { backgroundColor: palette.purple }]} accessibilityLabel="Record voice message">
              <Ionicons name="mic" size={20} color={palette.white} />
            </Pressable>
          )}
        </View>
      )}

      <Sheet visible={attachOpen} onClose={() => setAttachOpen(false)} title="Share">
        <ListItem icon="images-outline" title="Photos & videos" onPress={pickFromLibrary} />
        {Platform.OS !== 'web' ? <ListItem icon="camera-outline" title="Take a photo" onPress={() => capture('image')} /> : null}
        {Platform.OS !== 'web' ? <ListItem icon="videocam-outline" title="Record a video" onPress={() => capture('video')} /> : null}
        <ListItem icon="document-attach-outline" title="Document" subtitle="PDF, files up to 100 MB" onPress={pickDocument} />
        <ListItem icon="location-outline" title="Location" subtitle="Share your current location with consent" onPress={shareLocation} />
        <View style={{ height: spacing.lg }} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm, ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(12px)' } as object) : null) },
  context: { flexDirection: 'row', alignItems: 'center', borderLeftWidth: 3, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginBottom: spacing.sm, marginHorizontal: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  field: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', borderRadius: radius.xl, minHeight: 44, paddingLeft: spacing.md },
  input: { flex: 1, fontFamily: fontFamily.body, fontSize: 15, lineHeight: 20, paddingVertical: Platform.OS === 'web' ? 12 : 10, maxHeight: 120, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  inlineBtn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.sm },
  disabled: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md },
});
