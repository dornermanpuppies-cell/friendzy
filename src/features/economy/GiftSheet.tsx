import { Ionicons } from '@/components/ui/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { sendLiveGift } from '@/services/live';
import { getGiftCatalog, getWallet, sendGift } from '@/services/wallet';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import type { GiftItem, GiftRecord, GiftTarget } from '@/types/economy';
import type { AuthorCard } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';
import { formatCount } from '@/utils/format';

const QUANTITIES = [1, 5, 10, 50, 99];
const TIER_COLORS: Record<string, string> = { basic: palette.blue, rare: palette.purple, epic: palette.pink, legendary: palette.gold };

export interface GiftSheetProps {
  visible: boolean;
  onClose: () => void;
  targetType: GiftTarget;
  targetId: string | null;
  recipient: AuthorCard | null;
  /** For lives: optional on-stage guest receiving the gift instead of the host. */
  liveRecipientId?: string | null;
  onSent?: (result: { balance: number; gift: GiftRecord }) => void;
}

/** Gift picker. Balances and validation happen server-side (send_gift / send_live_gift). */
export function GiftSheet({ visible, onClose, targetType, targetId, recipient, liveRecipientId, onSent }: GiftSheetProps) {
  const { colors } = useTheme();
  const toast = useToast();
  const catalog = useAsync(() => getGiftCatalog(), [], { enabled: visible });
  const wallet = useAsync(() => getWallet(), [visible], { enabled: visible });
  const [selected, setSelected] = useState<GiftItem | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (!visible) {
      setSelected(null);
      setQuantity(1);
      setMessage('');
    }
  }

  const total = (selected?.coins ?? 0) * quantity;
  const balance = wallet.data?.balance ?? 0;
  const insufficient = total > balance;

  const send = async () => {
    if (!selected || !targetId) return;
    setSending(true);
    try {
      const result = targetType === 'live' ? await sendLiveGift(targetId, selected.id, quantity, liveRecipientId ?? null, message.trim() || null) : await sendGift(selected.id, targetType, targetId, quantity, message.trim() || null);
      toast.success(`Sent ${quantity > 1 ? `${quantity}× ` : ''}${selected.emoji} ${selected.name}`);
      onSent?.(result as { balance: number; gift: GiftRecord });
      onClose();
    } catch (error) {
      const msg = getErrorMessage(error);
      toast.error(msg);
      if (/premium/i.test(msg)) router.navigate('/premium' as never);
    } finally {
      setSending(false);
    }
  };

  const groups = ['basic', 'rare', 'epic', 'legendary'] as const;

  return (
    <Sheet visible={visible} onClose={onClose} title="Send a gift" subtitle={recipient ? `to ${recipient.display_name}` : undefined} maxHeightFraction={0.9}>
      <View style={[styles.balance, { backgroundColor: colors.surfaceMuted }]}>
        <Ionicons name="server-outline" size={18} color={palette.gold} />
        <Text variant="bodySemibold" style={{ marginLeft: spacing.sm, flex: 1 }}>
          {wallet.loading ? '…' : formatCount(balance)} coins
        </Text>
        <Button title="Get coins" size="sm" variant="secondary" onPress={() => { onClose(); router.navigate('/wallet' as never); }} />
      </View>
      {wallet.data && !wallet.data.can_gift ? (
        <Text variant="small" color="warning" style={{ marginTop: spacing.sm }}>
          Gifting is available from age 18.
        </Text>
      ) : null}
      <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
        {catalog.loading ? (
          <View style={styles.grid}>
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} width={76} height={92} rounded={14} style={{ margin: 4 }} />
            ))}
          </View>
        ) : (
          groups.map((tier) => {
            const gifts = (catalog.data ?? []).filter((g) => g.tier === tier);
            if (gifts.length === 0) return null;
            return (
              <View key={tier}>
                <Text variant="label" color={TIER_COLORS[tier]} style={{ marginTop: spacing.lg, marginBottom: spacing.xs }}>
                  {tier}
                </Text>
                <View style={styles.grid}>
                  {gifts.map((g) => {
                    const active = selected?.id === g.id;
                    return (
                      <Pressable key={g.id} onPress={() => setSelected(g)} style={[styles.gift, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primarySoft : colors.surface }]} accessibilityLabel={`${g.name}, ${g.coins} coins`}>
                        <Text style={{ fontSize: 30 }}>{g.emoji}</Text>
                        <Text variant="caption" numberOfLines={1}>
                          {g.name}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Ionicons name="server-outline" size={10} color={palette.gold} />
                          <Text variant="caption" color="textMuted" style={{ marginLeft: 2 }}>
                            {g.coins}
                          </Text>
                        </View>
                        {g.is_premium_only ? <Ionicons name="diamond" size={12} color={palette.purple} style={styles.premium} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
      <View style={styles.quantities}>
        {QUANTITIES.map((q) => (
          <Chip key={q} label={`×${q}`} size="sm" selected={quantity === q} onPress={() => setQuantity(q)} />
        ))}
      </View>
      <TextInput value={message} onChangeText={setMessage} placeholder="Add a message (optional)" placeholderTextColor={colors.placeholder} maxLength={120} style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text }]} />
      <View style={styles.footer}>
        {recipient ? <Avatar uri={recipient.avatar_url} name={recipient.display_name} size={32} /> : null}
        <View style={{ flex: 1, marginLeft: spacing.sm }}>
          <Text variant="smallMedium">{selected ? `${selected.emoji} ${selected.name} ×${quantity}` : 'Pick a gift'}</Text>
          <Text variant="caption" color={insufficient ? 'danger' : 'textMuted'}>
            {selected ? `${total} coins${insufficient ? ' · not enough coins' : ''}` : 'Creators receive 70% of every gift'}
          </Text>
        </View>
        <Button title={insufficient ? 'Get coins' : 'Send'} onPress={() => (insufficient ? (onClose(), router.navigate('/wallet' as never)) : void send())} disabled={!selected || !targetId || sending || (wallet.data ? !wallet.data.can_gift : false)} loading={sending} leftIcon={insufficient ? 'cart-outline' : 'gift-outline'} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  balance: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gift: { width: 76, height: 92, margin: 4, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', padding: 4 },
  premium: { position: 'absolute', top: 4, right: 4 },
  quantities: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
  input: { height: 40, borderRadius: radius.md, paddingHorizontal: spacing.md, marginTop: spacing.md },
  footer: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.sm },
});
