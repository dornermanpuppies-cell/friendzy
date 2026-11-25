import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Text } from '@/components/ui/Text';
import { palette, radius, spacing } from '@/theme/tokens';
import type { LiveComment } from '@/types/live';

export function LiveChatList({ comments, onLongPress, height = 220 }: { comments: LiveComment[]; onLongPress?: (comment: LiveComment) => void; height?: number }) {
  const ref = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    ref.current?.scrollToEnd({ animated: true });
  }, [comments.length]);
  return (
    <ScrollView ref={ref} style={{ maxHeight: height }} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
      {comments.map((c) => (
        <Pressable key={c.id} onLongPress={() => onLongPress?.(c)} delayLongPress={350} style={[styles.row, c.kind !== 'comment' && styles.rowMuted]}>
          {c.user ? <Avatar uri={c.user.avatar_url} name={c.user.display_name} size={22} /> : <Ionicons name="information-circle-outline" size={18} color="rgba(255,255,255,0.7)" />}
          <View style={{ flex: 1, marginLeft: spacing.xs }}>
            <Text variant="small" color={palette.white}>
              {c.user ? (
                <Text variant="smallMedium" color={c.is_moderator ? palette.gold : 'rgba(255,255,255,0.8)'}>
                  {c.is_moderator ? '🛡 ' : ''}
                  {c.fan_badge ? `💜${c.fan_badge.level} ` : ''}
                  {c.user.display_name}{' '}
                </Text>
              ) : null}
              {c.kind === 'gift' ? `sent ${String((c.metadata as { quantity?: number }).quantity ?? 1)}× ${String((c.metadata as { emoji?: string }).emoji ?? '🎁')} ${String((c.metadata as { gift?: string }).gift ?? 'a gift')}` : c.kind === 'join' ? 'joined' : (c.text ?? '')}
            </Text>
          </View>
          {c.pinned ? <Ionicons name="pin" size={12} color={palette.gold} /> : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function LiveChatInput({ onSend, disabledReason, slowModeSeconds, placeholder = 'Say something…' }: { onSend: (text: string) => Promise<void>; disabledReason?: string | null; slowModeSeconds?: number; placeholder?: string }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      await onSend(value);
      setText('');
      if (slowModeSeconds) setCooldown(slowModeSeconds);
    } finally {
      setSending(false);
    }
  };

  if (disabledReason) {
    return (
      <View style={[styles.input, { justifyContent: 'center' }]}>
        <Text variant="small" color="rgba(255,255,255,0.7)">
          {disabledReason}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.inputRow}>
      <TextInput value={text} onChangeText={setText} placeholder={cooldown > 0 ? `Slow mode · ${cooldown}s` : placeholder} placeholderTextColor="rgba(255,255,255,0.6)" style={styles.input} maxLength={300} editable={cooldown <= 0} onSubmitEditing={() => void submit()} returnKeyType="send" blurOnSubmit={false} />
      <Pressable onPress={() => void submit()} disabled={!text.trim() || cooldown > 0} style={[styles.send, (!text.trim() || cooldown > 0) && { opacity: 0.4 }]} accessibilityLabel="Send comment">
        <Ionicons name="send" size={18} color={palette.white} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: spacing.xs, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '92%', backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: radius.lg, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  rowMuted: { backgroundColor: 'rgba(0,0,0,0.2)' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: { flex: 1, height: 42, borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.14)', paddingHorizontal: spacing.lg, color: palette.white, fontSize: 15 },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: palette.pink, alignItems: 'center', justifyContent: 'center' },
});
