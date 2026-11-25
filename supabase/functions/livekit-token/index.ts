// Friendzy — LiveKit access token minting (server-side only)
//
// POST { room: string }  with the user's Supabase JWT in the Authorization header.
//
// Room naming:
//   call_<call_id>  → voice/video calls. Caller must be a call participant that is
//                     invited or joined, and the call must be ringing/active.
//   live_<live_id>  → livestreams. Host and approved guests may publish; everyone
//                     else (who can view the session) is subscribe-only.
//
// LIVEKIT_API_KEY / LIVEKIT_API_SECRET never leave this function.
// Deploy: supabase functions deploy livekit-token
// Secrets: supabase secrets set LIVEKIT_URL=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=...

import { createClient } from 'npm:@supabase/supabase-js@2';
import { AccessToken } from 'npm:livekit-server-sdk@2.20.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('LIVEKIT_URL');
  const apiKey = Deno.env.get('LIVEKIT_API_KEY');
  const apiSecret = Deno.env.get('LIVEKIT_API_SECRET');
  if (!url || !apiKey || !apiSecret) return json({ error: 'LiveKit is not configured on the server (LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET).' }, 500);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing authorization' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Invalid session' }, 401);
  const userId = userData.user.id;

  let body: { room?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const room = String(body.room ?? '');
  const match = /^(call|live)_([0-9a-f-]{36})$/.exec(room);
  if (!match) return json({ error: 'Invalid room' }, 400);
  const [, scope, id] = match;

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: profile } = await admin.from('profiles').select('username, display_name, avatar_url, account_status').eq('id', userId).maybeSingle();
  if (!profile || profile.account_status !== 'active') return json({ error: 'Account not active' }, 403);

  let canPublish = false;
  let canSubscribe = true;
  let ttl = '2h';

  if (scope === 'call') {
    const { data: call } = await admin.from('calls').select('id, status').eq('id', id).maybeSingle();
    if (!call || !['ringing', 'active'].includes(call.status)) return json({ error: 'Call is not active' }, 403);
    const { data: participant } = await admin.from('call_participants').select('state').eq('call_id', id).eq('user_id', userId).maybeSingle();
    if (!participant || !['invited', 'joined'].includes(participant.state)) return json({ error: 'Not a participant of this call' }, 403);
    canPublish = true;
  } else {
    const { data: live } = await admin.from('live_sessions').select('id, host_id, status, visibility').eq('id', id).maybeSingle();
    if (!live || !['live', 'preparing'].includes(live.status)) return json({ error: 'Live session is not active' }, 403);
    const { data: banned } = await admin.from('live_bans').select('user_id').eq('live_id', id).eq('user_id', userId).maybeSingle();
    if (banned) return json({ error: 'You cannot join this live' }, 403);
    // Followers-only / friends-only lives: same visibility rule as the app (can_view_live).
    const { data: canView } = await admin.rpc('can_view_live', { p_live: id, p_viewer: userId });
    if (!canView) return json({ error: 'This live is not available to you' }, 403);
    if (live.host_id === userId) {
      canPublish = true;
      ttl = '12h';
    } else {
      const { data: guest } = await admin.from('live_participants').select('role, state').eq('live_id', id).eq('user_id', userId).maybeSingle();
      canPublish = Boolean(guest && ['guest', 'cohost'].includes(guest.role) && guest.state === 'on_stage');
      ttl = '6h';
    }
  }

  const token = new AccessToken(apiKey, apiSecret, {
    identity: userId,
    name: profile.display_name,
    ttl,
    metadata: JSON.stringify({ username: profile.username, avatar_url: profile.avatar_url }),
  });
  token.addGrant({
    room,
    roomJoin: true,
    canPublish,
    canPublishData: true,
    canSubscribe,
    canUpdateOwnMetadata: true,
  });

  return json({ token: await token.toJwt(), url, room, canPublish });
});
