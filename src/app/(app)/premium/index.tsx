import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ListItem } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { usePurchases } from '@/hooks/usePurchases';
import { showManageSubscriptions } from '@/lib/purchases';
import { getPremiumStatus } from '@/services/premium';
import { formatMoney } from '@/services/wallet';
import { useTheme } from '@/theme/ThemeProvider';
import { gradients, palette, radius, shadows, spacing } from '@/theme/tokens';
import type { PremiumPlan } from '@/types/economy';
import { getErrorMessage } from '@/utils/errors';
import { formatDate } from '@/utils/format';

export default function PremiumScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const purchases = usePurchases();
  const status = useAsync(() => getPremiumStatus(), []);
  const [buying, setBuying] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const s = status.data;

  const packageFor = (plan: PremiumPlan) => purchases.offering?.availablePackages.find((p) => p.identifier === plan.rc_package || p.product.identifier === plan.id);

  const buy = async (plan: PremiumPlan) => {
    const pkg = packageFor(plan);
    if (!pkg) {
      if (Platform.OS === 'web') toast.info('Subscribe in the app', s?.web_billing_provider && s.web_billing_provider !== 'none' ? 'Web checkout is being connected. Until then, subscribe from the Friendzy app.' : 'Premium is purchased in the Friendzy app for iOS and Android. Your subscription works everywhere, including here on the web.');
      else toast.info('Store not ready', purchases.available ? 'This plan is not available in the store yet. Make sure the RevenueCat offering "default" contains it.' : 'In-app purchases need the RevenueCat SDK key in this build.');
      return;
    }
    setBuying(plan.id);
    try {
      const result = await purchases.buyPremium(pkg);
      if (result.cancelled) return;
      await status.refresh();
      if (result.premium) toast.success('Welcome to Premium 💎');
      else toast.info('Purchase received', 'Your Premium will activate as soon as the store confirms the payment.');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBuying(null);
    }
  };

  const restore = async () => {
    setRestoring(true);
    try {
      const entitled = await purchases.restore();
      await status.refresh();
      toast.success(entitled ? 'Premium restored' : 'No previous purchases found');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setRestoring(false);
    }
  };

  const manage = async () => {
    if (s?.management_url) {
      await Linking.openURL(s.management_url).catch(() => undefined);
      return;
    }
    await showManageSubscriptions();
    if (Platform.OS === 'web') toast.info('Manage in the app store', 'Open your App Store or Google Play subscriptions to change or cancel Premium.');
  };

  return (
    <Screen header={<ScreenHeader title="Friendzy Premium" fallbackHref="/settings" />} scroll padded refreshing={status.refreshing} onRefresh={() => void status.refresh()}>
      <View style={[styles.hero, shadows.glowPink]}>
        <LinearGradient colors={[...gradients.premium]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Ionicons name="diamond" size={40} color={palette.white} />
        <Text variant="h1" color={palette.white} style={{ marginTop: spacing.sm }}>
          {s?.is_premium ? 'You are Premium' : 'Go Premium'}
        </Text>
        <Text variant="body" color="rgba(255,255,255,0.9)" align="center">
          {s?.is_premium
            ? s.expires_at
              ? `${s.will_renew ? 'Renews' : 'Active until'} ${formatDate(s.expires_at, 'd MMM yyyy')}${s.store ? ` · ${s.store.replace('_', ' ')}` : ''}`
              : 'Active'
            : 'Unlock exclusive gifts, see who viewed you, advanced search and more.'}
        </Text>
        {s?.billing_issue ? (
          <Text variant="small" color={palette.white} style={{ marginTop: spacing.sm }}>
            ⚠️ There is a problem with your payment method. Update it to keep Premium.
          </Text>
        ) : null}
      </View>

      {status.loading || !s ? (
        <SkeletonList count={5} />
      ) : (
        <>
          {!s.enabled ? (
            <Card style={{ marginTop: spacing.lg }}>
              <Text variant="smallMedium">Premium is temporarily unavailable.</Text>
            </Card>
          ) : null}

          <Text variant="h4" style={styles.section}>
            Everything in Premium
          </Text>
          <Card padded={false}>
            {s.features.map((f) => (
              <ListItem key={f.id} icon={f.icon as never} iconColor={palette.purple} title={f.title} subtitle={f.description} showChevron={false} />
            ))}
          </Card>

          {!s.is_premium && s.enabled ? (
            <>
              <Text variant="h4" style={styles.section}>
                Choose a plan
              </Text>
              <View style={styles.plans}>
                {s.plans.map((plan) => {
                  const pkg = packageFor(plan);
                  const price = pkg?.product.priceString ?? formatMoney(plan.price_cents, plan.currency);
                  return (
                    <Pressable key={plan.id} onPress={() => void buy(plan)} disabled={buying !== null} style={[styles.plan, { backgroundColor: colors.surface, borderColor: plan.highlight ? colors.primary : colors.border }]}>
                      {plan.highlight ? (
                        <View style={[styles.highlight, { backgroundColor: colors.primary }]}>
                          <Text variant="caption" color={palette.white}>
                            {plan.highlight}
                          </Text>
                        </View>
                      ) : null}
                      <Text variant="h4">{plan.title}</Text>
                      <Text variant="h2" color="primary">
                        {price}
                      </Text>
                      <Text variant="caption" color="textMuted">
                        per {plan.period === 'yearly' ? 'year' : plan.period === 'monthly' ? 'month' : 'lifetime'}
                        {plan.trial_days > 0 ? ` · ${plan.trial_days}-day free trial` : ''}
                      </Text>
                      <Button title={buying === plan.id ? 'Processing…' : pkg ? 'Subscribe' : Platform.OS === 'web' ? 'Get the app' : 'Subscribe'} size="sm" style={{ marginTop: spacing.md }} onPress={() => void buy(plan)} loading={buying === plan.id} glow={Boolean(plan.highlight)} />
                    </Pressable>
                  );
                })}
              </View>
              <Text variant="caption" color="textMuted" style={{ marginTop: spacing.sm }}>
                {Platform.OS === 'web'
                  ? s.web_billing_provider && s.web_billing_provider !== 'none'
                    ? 'Web checkout is being connected. Subscriptions purchased in the app work on the web too.'
                    : 'Subscriptions are purchased in the Friendzy app (App Store / Google Play) and work on every device, including the web. Prices shown are reference prices; the store shows your local price.'
                  : purchases.available
                    ? purchases.testStore
                      ? 'Test Store active — this build simulates purchases. Prices come from the store once real products are connected.'
                      : 'Billed through the App Store / Google Play. Cancel anytime in your store subscriptions.'
                    : 'In-app purchases need the RevenueCat SDK key in this build (see docs/CONFIGURATION.md).'}
              </Text>
            </>
          ) : null}

          <Text variant="h4" style={styles.section}>
            Your perks
          </Text>
          <Card padded={false}>
            <ListItem icon="eye-outline" title="Who viewed your profile" subtitle={s.is_premium ? 'See your recent visitors' : 'Premium shows the full list'} onPress={() => router.navigate('/premium/viewers' as never)} />
            <ListItem icon="heart-outline" title="Who liked you in Match" subtitle={s.is_premium ? 'People who chose you' : 'Premium reveals who it is'} onPress={() => router.navigate('/premium/admirers' as never)} />
            <ListItem icon="options-outline" title="Advanced search filters" subtitle="Age, gender, online now and more" onPress={() => router.navigate('/discover?filters=1' as never)} />
            <ListItem icon="color-palette-outline" title="Exclusive themes" subtitle="Aurora, Sunset, Ocean, Gold, Midnight" onPress={() => router.navigate('/settings/appearance')} />
            <ListItem icon="gift-outline" title="Premium gifts" subtitle="Fireworks, Dragon, Castle and more" onPress={() => router.navigate('/wallet' as never)} />
          </Card>

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl, flexWrap: 'wrap' }}>
            {s.is_premium ? <Button title="Manage subscription" variant="secondary" leftIcon="settings-outline" onPress={() => void manage()} /> : null}
            {Platform.OS !== 'web' ? <Button title="Restore purchases" variant="ghost" onPress={() => void restore()} loading={restoring} /> : null}
          </View>
          <Text variant="caption" color="textMuted" style={{ marginTop: spacing.lg, marginBottom: spacing['2xl'] }}>
            Payment is charged to your store account. Subscriptions renew automatically unless cancelled at least 24 hours before the end of the period. See Terms of Service and Privacy Policy.
          </Text>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', padding: spacing['2xl'], borderRadius: radius.xl, overflow: 'hidden', marginTop: spacing.lg },
  section: { marginTop: spacing.xl, marginBottom: spacing.sm },
  plans: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  plan: { flex: 1, minWidth: 180, padding: spacing.lg, borderRadius: radius.xl, borderWidth: 1.5, overflow: 'hidden' },
  highlight: { position: 'absolute', top: 0, right: 0, borderBottomLeftRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 3 },
});
