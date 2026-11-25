/**
 * RevenueCat adapter — native implementation (react-native-purchases).
 * Requires an Expo development build. The web build uses purchases.web.ts.
 *
 * Entitlement: friendzy_premium · Offering: default · Packages: $rc_monthly, $rc_annual.
 * Coins are consumable in-app products whose identifiers equal coin_packages.sku.
 */
import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL, PURCHASE_TYPE, type CustomerInfo, type PurchasesOffering, type PurchasesPackage, type PurchasesStoreProduct } from 'react-native-purchases';

import { env } from '@/lib/env';

export const PREMIUM_ENTITLEMENT = 'friendzy_premium';

function apiKey(): string {
  const platformKey = Platform.OS === 'ios' ? env.revenueCatIosKey : env.revenueCatAndroidKey;
  return platformKey || env.revenueCatTestKey || '';
}

export const purchasesAvailable = Boolean(apiKey());
export const purchasesPlatform: 'native' | 'web' = 'native';
export const usingTestStore = !(Platform.OS === 'ios' ? env.revenueCatIosKey : env.revenueCatAndroidKey) && Boolean(env.revenueCatTestKey);

let configuredFor: string | null = null;

/** Configures the SDK once per signed-in user (app user id = Supabase user id). */
export async function configurePurchases(userId: string): Promise<boolean> {
  const key = apiKey();
  if (!key) return false;
  try {
    if (!configuredFor) {
      if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN);
      Purchases.configure({ apiKey: key, appUserID: userId });
      configuredFor = userId;
    } else if (configuredFor !== userId) {
      await Purchases.logIn(userId);
      configuredFor = userId;
    }
    return true;
  } catch (error) {
    console.warn('[purchases] configure failed', error);
    return false;
  }
}

export async function logOutPurchases(): Promise<void> {
  if (!configuredFor) return;
  try {
    const anonymous = await Purchases.isAnonymous();
    if (!anonymous) await Purchases.logOut();
  } catch {
    /* ignore */
  }
  configuredFor = null;
}

export async function getPremiumOffering(): Promise<PurchasesOffering | null> {
  const offerings = await Purchases.getOfferings();
  return offerings.current ?? offerings.all.default ?? null;
}

export interface PurchaseOutcome {
  cancelled: boolean;
  entitled: boolean;
  customerInfo: CustomerInfo | null;
}

export function isEntitled(info: CustomerInfo | null): boolean {
  return Boolean(info?.entitlements.active[PREMIUM_ENTITLEMENT]);
}

export async function purchasePremiumPackage(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { cancelled: false, entitled: isEntitled(customerInfo), customerInfo };
  } catch (error) {
    if ((error as { userCancelled?: boolean }).userCancelled) return { cancelled: true, entitled: false, customerInfo: null };
    throw error;
  }
}

export async function getCoinProducts(skus: string[]): Promise<PurchasesStoreProduct[]> {
  if (skus.length === 0) return [];
  return Purchases.getProducts(skus, PURCHASE_TYPE.INAPP);
}

export async function purchaseCoinProduct(product: PurchasesStoreProduct): Promise<{ cancelled: boolean; transactionId: string | null }> {
  try {
    const result = await Purchases.purchaseStoreProduct(product);
    return { cancelled: false, transactionId: result.transaction?.transactionIdentifier ?? null };
  } catch (error) {
    if ((error as { userCancelled?: boolean }).userCancelled) return { cancelled: true, transactionId: null };
    throw error;
  }
}

export async function restorePurchases(): Promise<CustomerInfo> {
  return Purchases.restorePurchases();
}

export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  try {
    return await Purchases.getCustomerInfo();
  } catch {
    return null;
  }
}

export function onCustomerInfoUpdate(listener: (info: CustomerInfo) => void): () => void {
  Purchases.addCustomerInfoUpdateListener(listener);
  return () => {
    Purchases.removeCustomerInfoUpdateListener(listener);
  };
}

export async function showManageSubscriptions(): Promise<void> {
  try {
    await Purchases.showManageSubscriptions();
  } catch {
    /* unsupported on this platform */
  }
}
