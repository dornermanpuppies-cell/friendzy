import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';
import type { CoinPackage, EarningsSummary, GiftItem, GiftRecord, GiftTarget, PublicSettings, Wallet, WalletTransaction, WithdrawalRequest } from '@/types/economy';
import type { AuthorCard } from '@/types/social';

function rows<T>(data: Json[] | Json | null): T[] {
  return (data ?? []) as unknown as T[];
}

export async function getWallet(): Promise<Wallet> {
  const { data, error } = await supabase.rpc('get_wallet');
  if (error) throw error;
  return data as unknown as Wallet;
}

export async function getWalletTransactions(before: number | null = null, limit = 30): Promise<(WalletTransaction & { gift: GiftRecord | null })[]> {
  const { data, error } = await supabase.rpc('get_wallet_transactions', { p_limit: limit, p_before: before });
  if (error) throw error;
  return rows<WalletTransaction & { gift: GiftRecord | null }>(data);
}

export async function getCoinPackages(): Promise<CoinPackage[]> {
  const { data, error } = await supabase.rpc('get_coin_packages');
  if (error) throw error;
  return rows<CoinPackage>(data);
}

export async function getGiftCatalog(): Promise<GiftItem[]> {
  const { data, error } = await supabase.rpc('get_gift_catalog');
  if (error) throw error;
  return rows<GiftItem>(data);
}

export async function sendGift(giftId: number, targetType: GiftTarget, targetId: string | null, quantity = 1, message: string | null = null): Promise<{ balance: number; gift: GiftRecord }> {
  const { data, error } = await supabase.rpc('send_gift', { p_gift_id: giftId, p_target_type: targetType, p_target_id: targetId, p_quantity: quantity, p_message: message });
  if (error) throw error;
  return data as unknown as { balance: number; gift: GiftRecord };
}

export async function getReceivedGifts(before: string | null = null, limit = 30): Promise<GiftRecord[]> {
  const { data, error } = await supabase.rpc('get_received_gifts', { p_limit: limit, p_before: before });
  if (error) throw error;
  return rows<GiftRecord>(data);
}

export async function getSentGifts(before: string | null = null, limit = 30): Promise<GiftRecord[]> {
  const { data, error } = await supabase.rpc('get_sent_gifts', { p_limit: limit, p_before: before });
  if (error) throw error;
  return rows<GiftRecord>(data);
}

export async function getTopSupporters(creatorId: string, limit = 10): Promise<{ user: AuthorCard; coins: number; gifts: number }[]> {
  const { data, error } = await supabase.rpc('get_top_supporters', { p_creator: creatorId, p_limit: limit });
  if (error) throw error;
  return rows<{ user: AuthorCard; coins: number; gifts: number }>(data);
}

export async function getEarningsSummary(): Promise<EarningsSummary> {
  const { data, error } = await supabase.rpc('get_earnings_summary');
  if (error) throw error;
  return data as unknown as EarningsSummary;
}

export async function requestWithdrawal(coins: number, method: { type: 'bank' | 'paypal' | 'other'; [key: string]: string | number | boolean }): Promise<WithdrawalRequest> {
  const { data, error } = await supabase.rpc('request_withdrawal', { p_coins: coins, p_method: method as unknown as Json });
  if (error) throw error;
  return data as unknown as WithdrawalRequest;
}

export async function cancelWithdrawal(id: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_withdrawal', { p_id: id });
  if (error) throw error;
}

export async function getPublicSettings(): Promise<PublicSettings> {
  const { data, error } = await supabase.rpc('get_public_settings');
  if (error) throw error;
  return (data as unknown as PublicSettings) ?? {};
}

export function subscribeToWallet(userId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`wallet:${userId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wallets', filter: `user_id=eq.${userId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => undefined);
  };
}

export function formatMoney(cents: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
