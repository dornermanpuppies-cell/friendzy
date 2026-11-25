import type { AuthorCard } from '@/types/social';

export type GiftTier = 'basic' | 'rare' | 'epic' | 'legendary';
export type GiftTarget = 'live' | 'video' | 'post' | 'profile' | 'message';
export type WalletTxKind = 'purchase' | 'gift_sent' | 'gift_received' | 'withdrawal_hold' | 'withdrawal_paid' | 'withdrawal_refund' | 'adjustment' | 'bonus' | 'refund';
export type WithdrawalStatus = 'pending' | 'approved' | 'rejected' | 'paid' | 'cancelled';

export interface Wallet {
  balance: number;
  earnings_balance: number;
  pending_earnings: number;
  lifetime_purchased: number;
  lifetime_spent: number;
  lifetime_received: number;
  lifetime_withdrawn: number;
  coin_value_cents: number;
  min_withdrawal_coins: number;
  payouts_enabled: boolean;
  commission_rate: number;
  can_gift: boolean;
}

export interface CoinPackage {
  id: number;
  sku: string;
  title: string;
  coins: number;
  bonus_coins: number;
  price_cents: number;
  currency: string;
  is_active: boolean;
  sort_order: number;
}

export interface GiftItem {
  id: number;
  slug: string;
  name: string;
  emoji: string;
  coins: number;
  tier: GiftTier;
  animation: string;
  is_premium_only: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface GiftRecord {
  id: string;
  sender: AuthorCard;
  receiver: AuthorCard;
  gift: Pick<GiftItem, 'id' | 'slug' | 'name' | 'emoji' | 'coins' | 'tier' | 'animation'>;
  quantity: number;
  coins_total: number;
  net_coins: number;
  target_type: GiftTarget;
  target_id: string | null;
  message: string | null;
  created_at: string;
}

export interface WalletTransaction {
  id: number;
  kind: WalletTxKind;
  coins: number;
  balance_after: number;
  earnings_after: number;
  reference_type: string | null;
  reference_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface WithdrawalRequest {
  id: string;
  coins: number;
  amount_cents: number;
  currency: string;
  status: WithdrawalStatus;
  note: string | null;
  created_at: string;
  paid_at: string | null;
}

export interface EarningsSummary {
  wallet: Wallet;
  gifts_30d: number;
  coins_30d: number;
  gross_30d: number;
  daily: { day: string; coins: number }[];
  top_gifts: { name: string; emoji: string; count: number; coins: number }[];
  top_supporters: { user: AuthorCard; coins: number; gifts: number }[];
  withdrawals: WithdrawalRequest[];
}

export interface PremiumPlan {
  id: string;
  title: string;
  period: 'monthly' | 'yearly' | 'lifetime';
  rc_package: string;
  price_cents: number;
  currency: string;
  trial_days: number;
  highlight: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface PremiumFeature {
  id: string;
  icon: string;
  title: string;
  description: string;
}

export interface PremiumStatus {
  is_premium: boolean;
  enabled: boolean;
  status: 'active' | 'trialing' | 'grace_period' | 'billing_issue' | 'paused' | 'expired' | 'cancelled' | null;
  expires_at: string | null;
  will_renew: boolean | null;
  store: string | null;
  product_id: string | null;
  period_type: string | null;
  purchased_at: string | null;
  management_url: string | null;
  billing_issue: boolean;
  plan: PremiumPlan | null;
  plans: PremiumPlan[];
  features: PremiumFeature[];
  web_billing_provider: 'none' | 'paddle' | string;
}

export interface PublicSettings {
  commission_rate?: number;
  coin_value_cents?: number;
  min_withdrawal_coins?: number;
  payouts_enabled?: boolean;
  gifting_min_age?: number;
  max_gift_quantity?: number;
  supported_countries?: string[];
  community_rules?: string;
  premium_enabled?: boolean;
  web_billing_provider?: string;
  verification_min_followers?: number;
  maintenance_mode?: boolean;
  signups_enabled?: boolean;
  [key: string]: unknown;
}

export const ACCENTS: { id: 'default' | 'aurora' | 'sunset' | 'ocean' | 'gold' | 'midnight'; label: string; colors: [string, string]; primary: string }[] = [
  { id: 'default', label: 'Friendzy', colors: ['#7000FF', '#FF28B9'], primary: '#7000FF' },
  { id: 'aurora', label: 'Aurora', colors: ['#22C55E', '#276BFF'], primary: '#16A34A' },
  { id: 'sunset', label: 'Sunset', colors: ['#F59E0B', '#FF4D6D'], primary: '#F97316' },
  { id: 'ocean', label: 'Ocean', colors: ['#06B6D4', '#276BFF'], primary: '#0EA5E9' },
  { id: 'gold', label: 'Gold', colors: ['#FFC857', '#B45309'], primary: '#CA8A04' },
  { id: 'midnight', label: 'Midnight', colors: ['#312E81', '#7000FF'], primary: '#4F46E5' },
];
