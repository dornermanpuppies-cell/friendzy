import { supabase } from '@/lib/supabase';
import type { AdminAnalytics, AdminContentItem, AdminDiscoveryAbuse, AdminMember, AdminOverview, AdminReport, AdminSetting, AdminTransaction, AdminUser, AdminWithdrawal, Announcement, AuditLog, Banner, TrendingTopic, VerificationRequest } from '@/types/admin';
import type { AccountStatus, AdminRoleType, Json, ReportStatus } from '@/types/database';
import type { CoinPackage, GiftItem, PremiumPlan } from '@/types/economy';
import type { LiveSession } from '@/types/live';

function rows<T>(data: Json[] | Json | null): T[] {
  return (data ?? []) as unknown as T[];
}

async function call<T>(fn: Parameters<typeof supabase.rpc>[0], args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args as never);
  if (error) throw error;
  return data as unknown as T;
}

// Overview
export const getAdminOverview = () => call<AdminOverview>('admin_overview');
export const getAdminAnalytics = (days = 30) => call<AdminAnalytics>('admin_analytics', { p_days: days });
export const getMyAdminRole = () => call<AdminRoleType | null>('get_my_admin_role');

// Users
export const searchAdminUsers = (params: { query?: string; status?: string | null; filter?: string | null; limit?: number; offset?: number }) =>
  call<Json>('admin_search_users', { p_query: params.query ?? '', p_status: params.status ?? null, p_filter: params.filter ?? null, p_limit: params.limit ?? 30, p_offset: params.offset ?? 0 }).then((d) => rows<AdminUser>(d));
export const getAdminUser = (userId: string) => call<AdminUser>('admin_get_user', { p_user: userId });
export const setAccountStatus = (userId: string, status: AccountStatus, reason: string, days?: number | null) => call<AdminUser>('admin_set_account_status', { p_user: userId, p_status: status, p_reason: reason, p_days: days ?? null });
export const warnUser = (userId: string, reason: string, reportId?: string | null) => call<undefined>('admin_warn_user', { p_user: userId, p_reason: reason, p_report: reportId ?? null });
export const restrictFeature = (userId: string, feature: string, hours: number | null, reason: string, reportId?: string | null) => call<{ id: string; ends_at: string | null }>('admin_restrict_feature', { p_user: userId, p_feature: feature, p_hours: hours, p_reason: reason, p_report: reportId ?? null });
export const liftSanction = (id: string, reason?: string) => call<undefined>('admin_lift_sanction', { p_id: id, p_reason: reason ?? null });
export const setVerified = (userId: string, verified: boolean, note?: string) => call<undefined>('admin_set_verified', { p_user: userId, p_verified: verified, p_note: note ?? null });
export const addAdminNote = (userId: string, note: string) => call<{ id: number; note: string; created_at: string }>('admin_add_note', { p_user: userId, p_note: note });
export const grantPremium = (userId: string, days: number, reason: string) => call<{ expires_at: string }>('grant_premium', { p_user: userId, p_days: days, p_reason: reason });
export const revokePremium = (userId: string, reason: string) => call<undefined>('revoke_premium', { p_user: userId, p_reason: reason });
export const adjustCoins = (userId: string, delta: number, reason: string) => call<{ transaction: number; balance: number }>('admin_adjust_coins', { p_user: userId, p_delta: delta, p_reason: reason });

/** Auth-level actions go through the admin-actions Edge Function (Auth Admin API). */
export async function adminAuthAction(action: 'ban_auth' | 'unban_auth' | 'sign_out_user' | 'delete_user', userId: string, hours?: number): Promise<{ ok: boolean; sessions?: number }> {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; sessions?: number; error?: string }>('admin-actions', { body: { action, user_id: userId, hours } });
  if (error) {
    const context = (error as { context?: Response }).context;
    let message = error.message;
    try {
      const body = context ? ((await context.json()) as { error?: string }) : null;
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (!data?.ok) throw new Error(data?.error ?? 'Action failed');
  return data;
}

// Reports & content
export const listReports = (params: { status?: string | null; targetType?: string | null; limit?: number; offset?: number } = {}) =>
  call<Json>('admin_list_reports', { p_status: params.status ?? 'open', p_target_type: params.targetType ?? null, p_limit: params.limit ?? 30, p_offset: params.offset ?? 0 }).then((d) => rows<AdminReport>(d));
export const getReport = (id: string) => call<AdminReport | null>('admin_get_report', { p_report: id });
export const claimReport = (id: string) => call<AdminReport>('admin_claim_report', { p_report: id });
export const resolveReport = (id: string, status: Extract<ReportStatus, 'resolved' | 'dismissed'>, params: { resolution?: string; action?: string; reason?: string; hours?: number } = {}) =>
  call<AdminReport>('admin_resolve_report', { p_report: id, p_status: status, p_resolution: params.resolution ?? null, p_action: params.action ?? 'none', p_reason: params.reason ?? null, p_hours: params.hours ?? null });
export const removeContent = (type: string, id: string, reason: string) => call<undefined>('admin_remove_content', { p_type: type, p_id: id, p_reason: reason, p_notify: true });
export const restoreContent = (type: string, id: string) => call<undefined>('admin_restore_content', { p_type: type, p_id: id });
export const listContent = (params: { type: 'post' | 'video' | 'story' | 'comment'; query?: string; removedOnly?: boolean; userId?: string | null; limit?: number; offset?: number }) =>
  call<Json>('admin_list_content', { p_type: params.type, p_query: params.query ?? '', p_removed_only: params.removedOnly ?? false, p_user: params.userId ?? null, p_limit: params.limit ?? 30, p_offset: params.offset ?? 0 }).then((d) => rows<AdminContentItem>(d));

// Live
export const listAdminLives = (status: string = 'live', limit = 50) => call<Json>('admin_list_lives', { p_status: status, p_limit: limit }).then((d) => rows<LiveSession & { reports_count: number }>(d));
export const adminEndLive = (id: string, reason: string, restrictHours?: number | null) => call<LiveSession>('admin_end_live', { p_id: id, p_reason: reason, p_restrict_hours: restrictHours ?? null });

// Finance
export const listTransactions = (params: { userId?: string | null; kind?: string | null; limit?: number; before?: number | null } = {}) =>
  call<Json>('admin_list_transactions', { p_user: params.userId ?? null, p_kind: params.kind ?? null, p_limit: params.limit ?? 50, p_before: params.before ?? null }).then((d) => rows<AdminTransaction>(d));
export const listWithdrawals = (status: string = 'pending', limit = 50, offset = 0) => call<Json>('admin_list_withdrawals', { p_status: status, p_limit: limit, p_offset: offset }).then((d) => rows<AdminWithdrawal>(d));
export const reviewWithdrawal = (id: string, decision: 'approved' | 'paid' | 'rejected', note?: string) => call<AdminWithdrawal>('admin_review_withdrawal', { p_id: id, p_decision: decision, p_note: note ?? null });
export const listCoinPurchases = (limit = 50, offset = 0) => call<Json>('admin_list_coin_purchases', { p_limit: limit, p_offset: offset }).then((d) => rows<Record<string, unknown>>(d));
export const listSubscriptions = (status: string | null = null, limit = 50, offset = 0) => call<Json>('admin_list_subscriptions', { p_status: status, p_limit: limit, p_offset: offset }).then((d) => rows<Record<string, unknown>>(d));

// Settings & catalogues
export const listSettings = () => call<Json>('admin_list_settings').then((d) => rows<AdminSetting>(d));
export const updateSetting = (key: string, value: Json, isPublic?: boolean | null) => call<AdminSetting>('admin_update_setting', { p_key: key, p_value: value, p_is_public: isPublic ?? null });
export const upsertGift = (gift: Partial<GiftItem> & { id?: number | null }) =>
  call<GiftItem>('admin_upsert_gift', { p_id: gift.id ?? null, p_slug: gift.slug ?? null, p_name: gift.name ?? null, p_emoji: gift.emoji ?? null, p_coins: gift.coins ?? null, p_tier: gift.tier ?? null, p_animation: gift.animation ?? null, p_is_premium_only: gift.is_premium_only ?? null, p_is_active: gift.is_active ?? null, p_sort_order: gift.sort_order ?? null });
export const upsertCoinPackage = (pkg: Partial<CoinPackage> & { id?: number | null }) =>
  call<CoinPackage>('admin_upsert_coin_package', { p_id: pkg.id ?? null, p_sku: pkg.sku ?? null, p_title: pkg.title ?? null, p_coins: pkg.coins ?? null, p_bonus_coins: pkg.bonus_coins ?? null, p_price_cents: pkg.price_cents ?? null, p_currency: pkg.currency ?? null, p_is_active: pkg.is_active ?? null, p_sort_order: pkg.sort_order ?? null });
export const upsertPremiumPlan = (plan: PremiumPlan) =>
  call<PremiumPlan>('admin_upsert_premium_plan', { p_id: plan.id, p_title: plan.title, p_period: plan.period, p_rc_package: plan.rc_package, p_price_cents: plan.price_cents, p_currency: plan.currency, p_trial_days: plan.trial_days, p_highlight: plan.highlight, p_is_active: plan.is_active, p_sort_order: plan.sort_order });

// Site content
export const listAnnouncements = () => call<Json>('admin_list_announcements').then((d) => rows<Announcement>(d));
export const upsertAnnouncement = (a: Partial<Announcement> & { id?: string | null }) =>
  call<Announcement>('admin_upsert_announcement', { p_id: a.id ?? null, p_title: a.title ?? null, p_body: a.body ?? null, p_kind: a.kind ?? null, p_audience: a.audience ?? null, p_link: a.link ?? null, p_starts_at: a.starts_at ?? null, p_ends_at: a.ends_at ?? null, p_is_active: a.is_active ?? null });
export const deleteAnnouncement = (id: string) => call<undefined>('admin_delete_announcement', { p_id: id });
export const listBanners = () => call<Json>('admin_list_banners').then((d) => rows<Banner>(d));
export const upsertBanner = (b: Partial<Banner> & { id?: string | null }) =>
  call<Banner>('admin_upsert_banner', { p_id: b.id ?? null, p_title: b.title ?? null, p_subtitle: b.subtitle ?? null, p_image_url: b.image_url ?? null, p_link: b.link ?? null, p_placement: b.placement ?? null, p_sort_order: b.sort_order ?? null, p_is_active: b.is_active ?? null, p_starts_at: b.starts_at ?? null, p_ends_at: b.ends_at ?? null });
export const deleteBanner = (id: string) => call<undefined>('admin_delete_banner', { p_id: id });
export const setFeaturedCreator = (userId: string, featured: boolean, note?: string | null, until?: string | null, sortOrder = 0) =>
  call<undefined>('admin_set_featured_creator', { p_user: userId, p_featured: featured, p_note: note ?? null, p_until: until ?? null, p_sort_order: sortOrder });
export const upsertTrendingTopic = (t: Partial<TrendingTopic> & { id?: number | null }) =>
  call<TrendingTopic>('admin_upsert_trending_topic', { p_id: t.id ?? null, p_tag: t.tag ?? null, p_label: t.label ?? null, p_kind: t.kind ?? null, p_sort_order: t.sort_order ?? null, p_is_active: t.is_active ?? null });
export const deleteTrendingTopic = (id: number) => call<undefined>('admin_delete_trending_topic', { p_id: id });

// Discovery & matching abuse signals
export const getDiscoveryAbuse = (hours = 24) => call<AdminDiscoveryAbuse>('admin_discovery_abuse', { p_hours: hours });

// Verification
export const listVerificationRequests = (status: string = 'pending', limit = 50, offset = 0) => call<Json>('admin_list_verification_requests', { p_status: status, p_limit: limit, p_offset: offset }).then((d) => rows<VerificationRequest>(d));
export const reviewVerification = (id: string, approve: boolean, note?: string) => call<VerificationRequest>('admin_review_verification', { p_id: id, p_approve: approve, p_note: note ?? null });

// Audit & roles
export const listAuditLogs = (params: { limit?: number; before?: string | null; adminId?: string | null; action?: string | null } = {}) =>
  call<Json>('admin_list_audit_logs', { p_limit: params.limit ?? 50, p_before: params.before ?? null, p_admin: params.adminId ?? null, p_action: params.action ?? null }).then((d) => rows<AuditLog>(d));
export const listAdmins = () => call<Json>('admin_list_admins').then((d) => rows<AdminMember>(d));
export const grantRole = (userId: string, role: AdminRoleType) => call<undefined>('admin_grant_role', { p_user: userId, p_role: role });
export const revokeRole = (userId: string) => call<undefined>('admin_revoke_role', { p_user: userId });

export async function signedDocumentUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('verification').createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}
