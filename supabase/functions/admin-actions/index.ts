// Friendzy — privileged admin actions that need the Auth Admin API
//
// POST { action: 'ban_auth' | 'unban_auth' | 'sign_out_user' | 'delete_user', user_id, hours? }
// with the ADMIN's Supabase JWT. The caller's role is verified against
// public.admin_roles (never trusted from the client), and every action is
// written to admin_audit_logs through log_admin_action().
//
// - ban_auth:      blocks sign-in (auth.users.banned_until) for `hours` (default: 100 years)
// - unban_auth:    lifts the auth ban
// - sign_out_user: revokes all sessions of the user
// - delete_user:   permanently deletes the account (super_admin only; cascades through profiles)
// Deploy: supabase functions deploy admin-actions

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-friendzy-platform, x-supabase-api-version, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing authorization' }, 401);
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Invalid session' }, 401);
  const adminId = userData.user.id;

  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: roleRow } = await admin.from('admin_roles').select('role').eq('user_id', adminId).maybeSingle();
  if (!roleRow) return json({ error: 'Admin access required' }, 403);
  const role = roleRow.role as string;

  let body: { action?: string; user_id?: string; hours?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const action = String(body.action ?? '');
  const targetId = String(body.user_id ?? '');
  if (!/^[0-9a-f-]{36}$/.test(targetId)) return json({ error: 'Invalid user id' }, 400);
  if (targetId === adminId) return json({ error: 'You cannot target your own account' }, 400);

  const { data: targetRole } = await admin.from('admin_roles').select('role').eq('user_id', targetId).maybeSingle();
  if (targetRole && role !== 'super_admin') return json({ error: 'Only a super admin can act on another admin' }, 403);

  const log = async (name: string, metadata: Record<string, unknown>) => {
    await userClient.rpc('log_admin_action', { p_action: name, p_target_type: 'profile', p_target_id: targetId, p_metadata: metadata });
  };

  try {
    if (action === 'ban_auth' || action === 'unban_auth') {
      if (!['super_admin', 'admin'].includes(role)) return json({ error: 'Admin role required' }, 403);
      const hours = action === 'ban_auth' ? Math.max(1, Math.min(876000, Number(body.hours ?? 876000))) : 0;
      const { error } = await admin.auth.admin.updateUserById(targetId, { ban_duration: action === 'ban_auth' ? `${hours}h` : 'none' });
      if (error) return json({ error: error.message }, 500);
      if (action === 'ban_auth') await admin.from('user_devices').update({ push_token: null }).eq('user_id', targetId);
      await log(action === 'ban_auth' ? 'auth.ban' : 'auth.unban', { hours });
      return json({ ok: true });
    }
    if (action === 'sign_out_user') {
      if (!['super_admin', 'admin'].includes(role)) return json({ error: 'Admin role required' }, 403);
      const { data, error } = await userClient.rpc('admin_revoke_user_sessions', { p_user: targetId });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, sessions: data });
    }
    if (action === 'delete_user') {
      if (role !== 'super_admin') return json({ error: 'Super admin role required' }, 403);
      await log('auth.delete_user', {});
      const { error } = await admin.auth.admin.deleteUser(targetId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    console.error('[admin-actions]', error);
    return json({ error: 'Admin action failed' }, 500);
  }
});
