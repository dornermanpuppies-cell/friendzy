/**
 * RevenueCat adapter — web stub. Store purchases are not available in the
 * browser; the Premium page shows plans and points to the apps (or to the
 * approved web billing provider once `web_billing_provider` is configured).
 */
export const PREMIUM_ENTITLEMENT = 'friendzy_premium';
export const purchasesAvailable = false;
export const purchasesPlatform: 'native' | 'web' = 'web';
export const usingTestStore = false;

export interface WebPackage {
  identifier: string;
  product: { identifier: string; title: string; priceString: string; description: string };
}
export interface WebOffering {
  identifier: string;
  availablePackages: WebPackage[];
}
export interface WebCustomerInfo {
  entitlements: { active: Record<string, { identifier: string }> };
}
export interface WebStoreProduct {
  identifier: string;
  title: string;
  priceString: string;
}

export async function configurePurchases(_userId: string): Promise<boolean> {
  return false;
}
export async function logOutPurchases(): Promise<void> {}
export async function getPremiumOffering(): Promise<WebOffering | null> {
  return null;
}
export function isEntitled(_info: WebCustomerInfo | null): boolean {
  return false;
}
export async function purchasePremiumPackage(_pkg: WebPackage): Promise<{ cancelled: boolean; entitled: boolean; customerInfo: WebCustomerInfo | null }> {
  throw new Error('Purchases are available in the Friendzy app for iOS and Android.');
}
export async function getCoinProducts(_skus: string[]): Promise<WebStoreProduct[]> {
  return [];
}
export async function purchaseCoinProduct(_product: WebStoreProduct): Promise<{ cancelled: boolean; transactionId: string | null }> {
  throw new Error('Coin purchases are available in the Friendzy app for iOS and Android.');
}
export async function restorePurchases(): Promise<WebCustomerInfo> {
  throw new Error('Restore purchases from the Friendzy app on your phone.');
}
export async function getCustomerInfo(): Promise<WebCustomerInfo | null> {
  return null;
}
export function onCustomerInfoUpdate(_listener: (info: WebCustomerInfo) => void): () => void {
  return () => {};
}
export async function showManageSubscriptions(): Promise<void> {}
