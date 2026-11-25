import { supabase } from '@/lib/supabase';
import type { ProfileCard, ReportTargetType } from '@/types/database';

export const REPORT_REASONS: { id: string; label: string; description: string }[] = [
  { id: 'spam', label: 'Spam or scam', description: 'Fake offers, repetitive messages, suspicious links' },
  { id: 'harassment', label: 'Harassment or bullying', description: 'Threats, insults or targeted abuse' },
  { id: 'hate', label: 'Hate speech', description: 'Attacks based on identity or protected characteristics' },
  { id: 'nudity', label: 'Nudity or sexual content', description: 'Sexual content or solicitation' },
  { id: 'violence', label: 'Violence or dangerous acts', description: 'Threats, gore or dangerous challenges' },
  { id: 'minor_safety', label: 'Child safety', description: 'Content or behaviour that endangers minors' },
  { id: 'impersonation', label: 'Impersonation', description: 'Pretending to be someone else or a brand' },
  { id: 'self_harm', label: 'Self-harm', description: 'Content that promotes or depicts self-harm' },
  { id: 'underage', label: 'Underage user', description: 'This person appears to be under the minimum age' },
  { id: 'other', label: 'Something else', description: 'Anything else that breaks the Community Guidelines' },
];

export async function reportTarget(params: {
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  details?: string;
}): Promise<void> {
  const { error } = await supabase.from('reports').insert({
    reporter_id: params.reporterId,
    target_type: params.targetType,
    target_id: params.targetId,
    reason: params.reason,
    details: params.details?.trim() ? params.details.trim().slice(0, 1000) : null,
  });
  if (error) throw error;
}

export async function blockUser(targetId: string): Promise<void> {
  const { error } = await supabase.rpc('block_user', { p_target: targetId });
  if (error) throw error;
}

export async function unblockUser(targetId: string): Promise<void> {
  const { error } = await supabase.rpc('unblock_user', { p_target: targetId });
  if (error) throw error;
}

export async function listBlockedUsers(): Promise<(ProfileCard & { blocked_at: string })[]> {
  // Blocked profiles are hidden by RLS; this security-definer RPC serves the blocker's own list.
  const { data, error } = await supabase.rpc('get_blocked_profiles');
  if (error) throw error;
  return (data ?? []) as (ProfileCard & { blocked_at: string })[];
}
