import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { usePurchases } from '@/hooks/usePurchases';
import { formatMoney, getCoinPackages, getReceivedGifts, getSentGifts, getWallet, getWalletTransactions, subscribeToWallet } from '@/services/wallet';
import { useAuth } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { gradients, palette, radius, shadows, spacing } from '@/theme/tokens';
import type { CoinPackage } from '@/types/economy';
import { getErrorMessage } from '@/utils/errors';
import { formatCount, timeAgo } from '@/utils/format';

type Tab = 'transactions' | 'received' | 'sent';

const KIND_LABEL: Record<string, string> = { purchase: 'Coins purchased', gift_sent: 'Gift sent', gift_received: 'Gift received', withdrawal_hold: 'Withdrawal requested', withdrawal_paid: 'Withdrawal paid', withdrawal_refund: 'Withdrawal refunded', adjustment: 'Balance adjustment', bonus: 'Bonus', refund: 'Refund' };

export default function WalletScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const purchases = usePurchases();
  const [tab, setTab] = useState<Tab>('transactions');
  const [buying, setBuying] = useState<string | null>(null);
  const wallet = useAsync(() => getWallet(), []);
  const packages = useAsync(() => getCoinPackages(), []);
  const storeProducts = useAsync(() => (purchases.ready && packages.data ? purchases.loadCoinProducts(packages.data.map((p) => p.sku)) : Promise.resolve([])), [purchases.ready, packages.data?.length]);
  const transactions = useAsync(() => getWalletTransactions(null, 40), [tab, wallet.data?.balance], { enabled: tab === 'transactions' });
  const received = useAsync(() => getReceivedGifts(null, 40), [tab], { enabled: tab === 'received' });
  const sent = useAsync(() => getSentGifts(null, 40), [tab], { enabled: tab === 'sent' });

  useEffect(() => {
    if (!user) return;
    return subscribeToWallet(user.id, () => void wallet.refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const buy = async (pkg: CoinPackage) => {
    const product = storeProducts.data?.find((p) => p.identifier === pkg.sku || p.identifier.endsWith(pkg.sku));
    if (!product) {
      toast.info(Platform.OS === 'web' ? 'Buy coins in the app' : 'Store not ready', Platform.OS === 'web' ? 'Coin purchases are available in the Friendzy app for iOS and Android.' : 'This coin pack is not available in the store yet. Make sure RevenueCat products are configured.');
      return;
    }
    setBuying(pkg.sku);
    try {
      const result = await purchases.buyCoins(product, wallet.data?.balance ?? 0);
      if (result.cancelled) return;
      await wallet.refresh();
      if (result.credited) toast.success('Coins added to your wallet');
      else toast.info('Purchase received', 'Your coins will appear as soon as the store confirms the payment.');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBuying(null);
    }
  };

  const w = wallet.data;

  return (
    <Screen header={<ScreenHeader title="Wallet" fallbackHref="/profile" right={<Button title="Earnings" size="sm" variant="ghost" leftIcon="trending-up-outline" onPress={() => router.navigate('/wallet/earnings' as never)} />} />} scroll padded refreshing={wallet.refreshing} onRefresh={() => Promise.all([wallet.refresh(), transactions.refresh()])}>
      <View style={[styles.balanceCard, shadows.glow]}>
        <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Text variant="caption" color="rgba(255,255,255,0.8)">
          COIN BALANCE
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
          <Ionicons name="server" size={28} color={palette.gold} />
          <Text variant="hero" color={palette.white} style={{ marginLeft: spacing.sm }}>
            {w ? formatCount(w.balance) : '—'}
          </Text>
        </View>
        <View style={styles.balanceRow}>
          <View>
            <Text variant="caption" color="rgba(255,255,255,0.8)">
              Creator earnings
            </Text>
            <Text variant="bodySemibold" color={palette.white}>
              {w ? formatCount(w.earnings_balance) : '—'} coins{w && w.pending_earnings > 0 ? ` · ${formatCount(w.pending_earnings)} pending` : ''}
            </Text>
          </View>
          <Button title="Withdraw" size="sm" variant="secondary" onPress={() => router.navigate('/wallet/earnings' as never)} />
        </View>
      </View>

      <Text variant="h4" style={{ marginTop: spacing['2xl'], marginBottom: spacing.sm }}>
        Buy coins
      </Text>
      {packages.loading ? (
        <SkeletonList count={3} />
      ) : (
        <View style={styles.packages}>
          {(packages.data ?? []).map((pkg) => {
            const product = storeProducts.data?.find((p) => p.identifier === pkg.sku || p.identifier.endsWith(pkg.sku));
            return (
              <Pressable key={pkg.sku} onPress={() => void buy(pkg)} disabled={buying !== null} style={[styles.pkg, { backgroundColor: colors.surface, borderColor: colors.border }]} accessibilityLabel={`${pkg.title}: ${pkg.coins} coins`}>
                <Text style={{ fontSize: 26 }}>{pkg.coins >= 6000 ? '💎' : pkg.coins >= 1000 ? '💰' : '🪙'}</Text>
                <Text variant="h4">{formatCount(pkg.coins)}</Text>
                {pkg.bonus_coins > 0 ? (
                  <Text variant="caption" color="success">
                    +{pkg.bonus_coins} bonus
                  </Text>
                ) : (
                  <Text variant="caption" color="textMuted">
                    {pkg.title}
                  </Text>
                )}
                <View style={[styles.price, { backgroundColor: colors.primarySoft }]}>
                  <Text variant="smallMedium" color="primary">
                    {buying === pkg.sku ? '…' : (product?.priceString ?? formatMoney(pkg.price_cents, pkg.currency))}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
      <Text variant="caption" color="textMuted" style={{ marginTop: spacing.sm }}>
        {Platform.OS === 'web'
          ? 'Coins are purchased in the Friendzy app (App Store / Google Play). Your balance is shared across all your devices.'
          : purchases.available
            ? purchases.testStore
              ? 'Test Store active — purchases are simulated until real store products are connected.'
              : 'Payments are processed by the App Store / Google Play. Coins never expire.'
            : 'In-app purchases need the RevenueCat SDK key in this build (see docs/CONFIGURATION.md).'}
      </Text>

      <View style={[styles.tabs, { marginTop: spacing['2xl'] }]}>
        <Chip label="Activity" size="sm" selected={tab === 'transactions'} onPress={() => setTab('transactions')} />
        <Chip label="Gifts received" size="sm" selected={tab === 'received'} onPress={() => setTab('received')} />
        <Chip label="Gifts sent" size="sm" selected={tab === 'sent'} onPress={() => setTab('sent')} />
      </View>

      {tab === 'transactions' ? (
        transactions.loading ? (
          <SkeletonList count={5} />
        ) : !transactions.data || transactions.data.length === 0 ? (
          <EmptyState compact emoji="🧾" title="No activity yet" description="Purchases, gifts and payouts show up here." />
        ) : (
          transactions.data.map((t) => (
            <View key={t.id} style={[styles.row, { borderBottomColor: colors.border }]}>
              <View style={[styles.icon, { backgroundColor: colors.surfaceMuted }]}>
                <Ionicons name={t.kind === 'purchase' || t.kind === 'bonus' ? 'cart-outline' : t.kind.startsWith('gift') ? 'gift-outline' : t.kind.startsWith('withdrawal') ? 'cash-outline' : 'swap-horizontal-outline'} size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text variant="smallMedium">
                  {KIND_LABEL[t.kind] ?? t.kind}
                  {t.gift ? ` · ${t.gift.gift.emoji} ${t.gift.gift.name}${t.gift.quantity > 1 ? ` ×${t.gift.quantity}` : ''}` : ''}
                </Text>
                <Text variant="caption" color="textMuted">
                  {timeAgo(t.created_at)}
                  {t.gift ? ` · ${t.kind === 'gift_sent' ? `to ${t.gift.receiver.display_name}` : `from ${t.gift.sender.display_name}`}` : ''}
                </Text>
              </View>
              <Text variant="bodySemibold" color={t.coins >= 0 ? 'success' : 'text'}>
                {t.coins >= 0 ? '+' : ''}
                {formatCount(t.coins)}
              </Text>
            </View>
          ))
        )
      ) : (
        (() => {
          const list = tab === 'received' ? received : sent;
          if (list.loading) return <SkeletonList count={5} />;
          if (!list.data || list.data.length === 0) return <EmptyState compact emoji="🎁" title={tab === 'received' ? 'No gifts received yet' : 'No gifts sent yet'} description={tab === 'received' ? 'Gifts from your fans appear here. Go live or post videos to earn.' : 'Support creators with gifts on their videos, posts and lives.'} />;
          return list.data.map((g) => {
            const other = tab === 'received' ? g.sender : g.receiver;
            return (
              <Pressable key={g.id} onPress={() => router.navigate(`/u/${other.username}` as never)} style={[styles.row, { borderBottomColor: colors.border }]}>
                <Avatar uri={other.avatar_url} name={other.display_name} size={40} />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text variant="smallMedium">
                    {other.display_name} · {g.gift.emoji} {g.gift.name}
                    {g.quantity > 1 ? ` ×${g.quantity}` : ''}
                  </Text>
                  <Text variant="caption" color="textMuted">
                    {timeAgo(g.created_at)} · {g.target_type}
                    {g.message ? ` · “${g.message}”` : ''}
                  </Text>
                </View>
                <Text variant="bodySemibold" color={tab === 'received' ? 'success' : 'text'}>
                  {tab === 'received' ? `+${formatCount(g.net_coins)}` : `-${formatCount(g.coins_total)}`}
                </Text>
              </Pressable>
            );
          });
        })()
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  balanceCard: { borderRadius: radius.xl, padding: spacing.xl, marginTop: spacing.lg, overflow: 'hidden' },
  balanceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg },
  packages: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pkg: { width: '31%', minWidth: 104, flexGrow: 1, alignItems: 'center', padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  price: { marginTop: spacing.sm, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 4 },
  tabs: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
