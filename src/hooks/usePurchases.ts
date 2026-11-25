import { useCallback, useEffect, useState } from 'react';

import { configurePurchases, getCoinProducts, getCustomerInfo, getPremiumOffering, isEntitled, logOutPurchases, onCustomerInfoUpdate, purchaseCoinProduct, purchasePremiumPackage, purchasesAvailable, purchasesPlatform, restorePurchases, usingTestStore } from '@/lib/purchases';
import { getPremiumStatus } from '@/services/premium';
import { getWallet } from '@/services/wallet';
import { useAuth } from '@/store/authStore';

type Offering = NonNullable<Awaited<ReturnType<typeof getPremiumOffering>>>;
type Package = Offering['availablePackages'][number];
type StoreProduct = Awaited<ReturnType<typeof getCoinProducts>>[number];

async function waitFor<T>(check: () => Promise<T | null>, attempts = 10, delayMs = 1500): Promise<T | null> {
  for (let i = 0; i < attempts; i += 1) {
    const result = await check();
    if (result) return result;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

/**
 * RevenueCat glue: configures the SDK for the signed-in user, exposes the
 * Premium offering and coin products, and waits for the webhook to land in
 * Supabase after a purchase (the database is the source of truth).
 */
export function usePurchases() {
  const { user } = useAuth();
  const userId = user?.id;
  const enabled = Boolean(userId && purchasesAvailable);
  const [configuredFor, setConfiguredFor] = useState<string | null>(null);
  const [offering, setOffering] = useState<Offering | null>(null);
  const [storeEntitled, setStoreEntitled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !purchasesAvailable) return;
    let cancelled = false;
    (async () => {
      const ok = await configurePurchases(userId);
      if (cancelled || !ok) return;
      setConfiguredFor(userId);
      try {
        const [off, info] = await Promise.all([getPremiumOffering(), getCustomerInfo()]);
        if (cancelled) return;
        setOffering(off);
        setStoreEntitled(isEntitled(info as never));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    const off = onCustomerInfoUpdate((info) => setStoreEntitled(isEntitled(info as never)));
    return () => {
      cancelled = true;
      off();
    };
  }, [userId]);

  const ready = enabled && configuredFor === userId;

  const buyPremium = useCallback(async (pkg: Package) => {
    const result = await purchasePremiumPackage(pkg as never);
    if (result.cancelled) return { cancelled: true, premium: false };
    // The RevenueCat webhook updates subscriptions; wait for it (or for store entitlement as a fallback).
    const synced = await waitFor(async () => {
      const status = await getPremiumStatus();
      return status.is_premium ? status : null;
    });
    return { cancelled: false, premium: Boolean(synced) || result.entitled };
  }, []);

  const loadCoinProducts = useCallback(async (skus: string[]): Promise<StoreProduct[]> => {
    if (!purchasesAvailable) return [];
    try {
      return await getCoinProducts(skus);
    } catch {
      return [];
    }
  }, []);

  const buyCoins = useCallback(async (product: StoreProduct, previousBalance: number) => {
    const result = await purchaseCoinProduct(product as never);
    if (result.cancelled) return { cancelled: true, credited: false };
    const wallet = await waitFor(async () => {
      const w = await getWallet();
      return w.balance > previousBalance ? w : null;
    });
    return { cancelled: false, credited: Boolean(wallet) };
  }, []);

  const restore = useCallback(async () => {
    const info = await restorePurchases();
    const entitled = isEntitled(info as never);
    if (entitled) await waitFor(async () => ((await getPremiumStatus()).is_premium ? true : null), 6, 1500);
    return entitled;
  }, []);

  return { available: purchasesAvailable, platform: purchasesPlatform, testStore: usingTestStore, ready, offering: ready ? offering : null, storeEntitled: ready && storeEntitled, error, buyPremium, loadCoinProducts, buyCoins, restore, signOut: logOutPurchases };
}
