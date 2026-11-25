import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';
import type { AuthorCard } from '@/types/social';

export type CallKind = 'voice' | 'video';
export type CallStatus = 'ringing' | 'active' | 'ended' | 'missed' | 'declined' | 'cancelled';
export type CallParticipantState = 'invited' | 'joined' | 'left' | 'declined' | 'missed';

export interface CallRecord {
  id: string;
  conversation_id: string;
  kind: CallKind;
  status: CallStatus;
  room_name: string;
  started_at: string | null;
  ended_at: string | null;
  ended_reason: string | null;
  created_at: string;
  initiator: AuthorCard | null;
  is_initiator: boolean;
  conversation: { id: string; kind: 'direct' | 'group'; title: string | null; avatar_url: string | null };
  participants: { user: AuthorCard; state: CallParticipantState; joined_at: string | null; left_at: string | null }[];
  my_state: CallParticipantState | null;
  /** History-only fields */
  direction?: 'incoming' | 'outgoing';
  outcome?: 'answered' | 'declined' | 'no_answer' | 'missed';
  duration_seconds?: number;
}

function rows<T>(data: Json[] | Json | null): T[] {
  return (data ?? []) as unknown as T[];
}

export async function startCall(conversationId: string, kind: CallKind): Promise<string> {
  const { data, error } = await supabase.rpc('start_call', { p_conversation: conversationId, p_kind: kind });
  if (error) throw error;
  return (data as unknown as CallRecord).id;
}

export async function answerCall(callId: string): Promise<CallRecord> {
  const { data, error } = await supabase.rpc('answer_call', { p_call: callId });
  if (error) throw error;
  return data as unknown as CallRecord;
}

export async function declineCall(callId: string): Promise<void> {
  const { error } = await supabase.rpc('decline_call', { p_call: callId });
  if (error) throw error;
}

export async function leaveCall(callId: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('leave_call', { p_call: callId, p_reason: reason ?? null });
  if (error) throw error;
}

export async function getCall(callId: string): Promise<CallRecord | null> {
  const { data, error } = await supabase.rpc('get_call', { p_call: callId });
  if (error) throw error;
  return (data as unknown as CallRecord | null) ?? null;
}

export async function getActiveCall(conversationId: string): Promise<CallRecord | null> {
  const { data, error } = await supabase.rpc('get_active_call', { p_conversation: conversationId });
  if (error) throw error;
  return (data as unknown as CallRecord | null) ?? null;
}

export async function getCallHistory(before: string | null = null, limit = 30): Promise<CallRecord[]> {
  const { data, error } = await supabase.rpc('get_call_history', { p_limit: limit, p_before: before });
  if (error) throw error;
  return rows<CallRecord>(data);
}

export interface LiveKitCredentials {
  token: string;
  url: string;
  room: string;
  canPublish: boolean;
}

/** Asks the livekit-token Edge Function for a short-lived room token (secrets stay server-side). */
export async function getLiveKitToken(room: string): Promise<LiveKitCredentials> {
  const { data, error } = await supabase.functions.invoke<LiveKitCredentials & { error?: string }>('livekit-token', { body: { room } });
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
  if (!data || !data.token) throw new Error(data?.error ?? 'Could not get a media token.');
  return data;
}

/** Subscribes to changes of one call (status / participants). */
export function subscribeToCall(callId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`call:${callId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${callId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'call_participants', filter: `call_id=eq.${callId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => undefined);
  };
}

/** Fires when I am invited to a new call (incoming call). */
export function subscribeToIncomingCalls(userId: string, onIncoming: (callId: string) => void): () => void {
  const channel = supabase
    .channel(`incoming-calls:${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_participants', filter: `user_id=eq.${userId}` }, (payload) => {
      const row = payload.new as { call_id: string; state: CallParticipantState };
      if (row.state === 'invited') onIncoming(row.call_id);
    })
    .subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => undefined);
  };
}
