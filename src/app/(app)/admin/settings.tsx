import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ListItem } from '@/components/ui/ListItem';
import { Sheet } from '@/components/ui/Sheet';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { AdminShell } from '@/features/admin/AdminShell';
import { useAsync } from '@/hooks/useAsync';
import { listSettings, updateSetting, upsertCoinPackage, upsertGift, upsertPremiumPlan } from '@/services/admin';
import { getPremiumPlans } from '@/services/premium';
import { formatMoney, getCoinPackages, getGiftCatalog } from '@/services/wallet';
import { spacing } from '@/theme/tokens';
import type { Json } from '@/types/database';
import type { CoinPackage, GiftItem, PremiumPlan } from '@/types/economy';
import { getErrorMessage } from '@/utils/errors';

const DESCRIPTIONS: Record<string, string> = {
  commission_rate: 'Platform share of every gift (0–0.9). Creators receive the rest.',
  coin_value_cents: 'Payout value of one coin in cents.',
  min_withdrawal_coins: 'Minimum coins per withdrawal request.',
  payouts_enabled: 'Master switch for creator withdrawals (super admin only).',
  gifting_min_age: 'Minimum age to send gifts.',
  max_gift_quantity: 'Maximum quantity per gift send.',
  supported_countries: 'ISO codes shown as supported; empty = worldwide.',
  community_rules: 'Short rules text shown in the app.',
  premium_enabled: 'Hide/show Premium purchases.',
  web_billing_provider: '"none" until an approved card provider is connected.',
  verification_min_followers: 'Followers required to apply for verification.',
  maintenance_mode: 'Show a maintenance notice (apps keep read access).',
  signups_enabled: 'Allow new registrations.',
};

type Editing = { key: string; value: string; is_public: boolean } | null;

export default function AdminSettingsScreen() {
  const toast = useToast();
  const settings = useAsync(() => listSettings(), []);
  const gifts = useAsync(() => getGiftCatalog(), []);
  const packages = useAsync(() => getCoinPackages(), []);
  const plans = useAsync(() => getPremiumPlans(), []);
  const [editing, setEditing] = useState<Editing>(null);
  const [gift, setGift] = useState<Partial<GiftItem> | null>(null);
  const [pkg, setPkg] = useState<Partial<CoinPackage> | null>(null);
  const [plan, setPlan] = useState<PremiumPlan | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (fn: () => Promise<unknown>, success: string, refresh: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      setEditing(null);
      setGift(null);
      setPkg(null);
      setPlan(null);
      await refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const parseValue = (raw: string): Json => {
    try {
      return JSON.parse(raw) as Json;
    } catch {
      return raw;
    }
  };

  return (
    <AdminShell title="Platform settings" refreshing={settings.refreshing} onRefresh={() => Promise.all([settings.refresh(), gifts.refresh(), packages.refresh(), plans.refresh()])}>
      <Text variant="h4" style={{ marginTop: spacing.md, marginBottom: spacing.sm }}>
        Settings
      </Text>
      {settings.loading ? (
        <SkeletonList count={8} />
      ) : settings.error ? (
        <EmptyState compact icon="lock-closed-outline" title="Not available" description={settings.error} />
      ) : (
        <Card padded={false}>
          {(settings.data ?? []).map((s) => (
            <ListItem key={s.key} title={s.key} subtitle={`${JSON.stringify(s.value)} · ${s.is_public ? 'public' : 'private'}${DESCRIPTIONS[s.key] ? ` — ${DESCRIPTIONS[s.key]}` : ''}`} onPress={() => setEditing({ key: s.key, value: JSON.stringify(s.value), is_public: s.is_public })} />
          ))}
          <ListItem icon="add-circle-outline" title="New setting" onPress={() => setEditing({ key: '', value: '""', is_public: false })} />
        </Card>
      )}

      <Text variant="h4" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
        Gift catalogue
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {(gifts.data ?? []).map((g) => (
          <Chip key={g.id} label={`${g.emoji} ${g.name} · ${g.coins}${g.is_premium_only ? ' 💎' : ''}`} size="sm" onPress={() => setGift(g)} />
        ))}
        <Chip label="+ New gift" size="sm" selected onPress={() => setGift({ tier: 'basic', animation: 'float', is_premium_only: false, is_active: true, sort_order: 50 })} />
      </View>
      <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs }}>
        Deactivate instead of deleting so past gifts keep their history.
      </Text>

      <Text variant="h4" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
        Coin packages
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {(packages.data ?? []).map((p) => (
          <Chip key={p.id} label={`${p.sku} · ${p.coins}+${p.bonus_coins} · ${formatMoney(p.price_cents, p.currency)}`} size="sm" onPress={() => setPkg(p)} />
        ))}
        <Chip label="+ New package" size="sm" selected onPress={() => setPkg({ currency: 'USD', bonus_coins: 0, is_active: true, sort_order: 50 })} />
      </View>
      <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs }}>
        The SKU must match the in-app product identifier in App Store Connect / Google Play / RevenueCat.
      </Text>

      <Text variant="h4" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
        Premium plans
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {(plans.data ?? []).map((p) => (
          <Chip key={p.id} label={`${p.title} · ${formatMoney(p.price_cents, p.currency)}/${p.period}`} size="sm" onPress={() => setPlan(p)} />
        ))}
      </View>
      <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs, marginBottom: spacing['2xl'] }}>
        Reference prices for the website; stores show their own localized price. RevenueCat packages: $rc_monthly / $rc_annual.
      </Text>

      <Sheet visible={Boolean(editing)} onClose={() => setEditing(null)} title="Edit setting">
        {editing ? (
          <View style={{ gap: spacing.md }}>
            <Input label="Key" value={editing.key} onChangeText={(key) => setEditing({ ...editing, key: key.toLowerCase().replace(/[^a-z0-9_]/g, '') })} autoCapitalize="none" />
            <Input label="Value (JSON)" value={editing.value} onChangeText={(value) => setEditing({ ...editing, value })} autoCapitalize="none" helper='Examples: true · 0.3 · "none" · ["US","GB"]' />
            <ListItem icon="eye-outline" title="Public (readable by apps)" switchValue={editing.is_public} onSwitchChange={(v) => setEditing({ ...editing, is_public: v })} />
            <Button title="Save" loading={busy} disabled={!editing.key} onPress={() => void save(() => updateSetting(editing.key, parseValue(editing.value), editing.is_public), 'Setting saved', settings.refresh)} />
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={Boolean(gift)} onClose={() => setGift(null)} title={gift?.id ? 'Edit gift' : 'New gift'}>
        {gift ? (
          <View style={{ gap: spacing.sm }}>
            <Input label="Slug" value={gift.slug ?? ''} onChangeText={(slug) => setGift({ ...gift, slug })} autoCapitalize="none" />
            <Input label="Name" value={gift.name ?? ''} onChangeText={(name) => setGift({ ...gift, name })} />
            <Input label="Emoji" value={gift.emoji ?? ''} onChangeText={(emoji) => setGift({ ...gift, emoji })} />
            <Input label="Coins" value={gift.coins?.toString() ?? ''} onChangeText={(v) => setGift({ ...gift, coins: Number(v) || 0 })} keyboardType="number-pad" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {(['basic', 'rare', 'epic', 'legendary'] as const).map((t) => (
                <Chip key={t} label={t} size="sm" selected={gift.tier === t} onPress={() => setGift({ ...gift, tier: t })} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {['float', 'burst', 'rain', 'fullscreen'].map((a) => (
                <Chip key={a} label={a} size="sm" selected={gift.animation === a} onPress={() => setGift({ ...gift, animation: a })} />
              ))}
            </View>
            <ListItem icon="diamond-outline" title="Premium only" switchValue={Boolean(gift.is_premium_only)} onSwitchChange={(v) => setGift({ ...gift, is_premium_only: v })} />
            <ListItem icon="eye-outline" title="Active" switchValue={gift.is_active !== false} onSwitchChange={(v) => setGift({ ...gift, is_active: v })} />
            <Button title="Save gift" loading={busy} disabled={!gift.slug || !gift.name || !gift.emoji || !gift.coins} onPress={() => void save(() => upsertGift(gift), 'Gift saved', gifts.refresh)} />
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={Boolean(pkg)} onClose={() => setPkg(null)} title={pkg?.id ? 'Edit coin package' : 'New coin package'}>
        {pkg ? (
          <View style={{ gap: spacing.sm }}>
            <Input label="SKU (store product id)" value={pkg.sku ?? ''} onChangeText={(sku) => setPkg({ ...pkg, sku })} autoCapitalize="none" />
            <Input label="Title" value={pkg.title ?? ''} onChangeText={(title) => setPkg({ ...pkg, title })} />
            <Input label="Coins" value={pkg.coins?.toString() ?? ''} onChangeText={(v) => setPkg({ ...pkg, coins: Number(v) || 0 })} keyboardType="number-pad" />
            <Input label="Bonus coins" value={pkg.bonus_coins?.toString() ?? '0'} onChangeText={(v) => setPkg({ ...pkg, bonus_coins: Number(v) || 0 })} keyboardType="number-pad" />
            <Input label="Price (cents)" value={pkg.price_cents?.toString() ?? ''} onChangeText={(v) => setPkg({ ...pkg, price_cents: Number(v) || 0 })} keyboardType="number-pad" />
            <Input label="Currency" value={pkg.currency ?? 'USD'} onChangeText={(currency) => setPkg({ ...pkg, currency: currency.toUpperCase() })} autoCapitalize="characters" />
            <ListItem icon="eye-outline" title="Active" switchValue={pkg.is_active !== false} onSwitchChange={(v) => setPkg({ ...pkg, is_active: v })} />
            <Button title="Save package" loading={busy} disabled={!pkg.sku || !pkg.title || !pkg.coins || !pkg.price_cents} onPress={() => void save(() => upsertCoinPackage(pkg), 'Package saved', packages.refresh)} />
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={Boolean(plan)} onClose={() => setPlan(null)} title="Edit plan">
        {plan ? (
          <View style={{ gap: spacing.sm }}>
            <Input label="Title" value={plan.title} onChangeText={(title) => setPlan({ ...plan, title })} />
            <Input label="Reference price (cents)" value={String(plan.price_cents)} onChangeText={(v) => setPlan({ ...plan, price_cents: Number(v) || 0 })} keyboardType="number-pad" />
            <Input label="Trial days" value={String(plan.trial_days)} onChangeText={(v) => setPlan({ ...plan, trial_days: Number(v) || 0 })} keyboardType="number-pad" />
            <Input label="Highlight label" value={plan.highlight ?? ''} onChangeText={(highlight) => setPlan({ ...plan, highlight: highlight || null })} />
            <ListItem icon="eye-outline" title="Active" switchValue={plan.is_active} onSwitchChange={(v) => setPlan({ ...plan, is_active: v })} />
            <Button title="Save plan" loading={busy} onPress={() => void save(() => upsertPremiumPlan(plan), 'Plan saved', plans.refresh)} />
          </View>
        ) : null}
      </Sheet>
    </AdminShell>
  );
}
