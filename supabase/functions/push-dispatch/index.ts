// Friendzy — push notification dispatcher (Expo Push Service)
//
// Triggered by Supabase Database Webhooks (Database → Webhooks):
//   1. table public.notifications, event INSERT → POST this function
//   2. table public.messages,      event INSERT → POST this function
//   Add HTTP header  x-webhook-secret: <PUSH_WEBHOOK_SECRET>
// Deploy with `supabase functions deploy push-dispatch --no-verify-jwt`.
//
// It can also be invoked directly by trusted server code with the same header:
//   POST { user_ids: string[], title, body, url?, data? }
//
// Secrets: PUSH_WEBHOOK_SECRET (required), EXPO_ACCESS_TOKEN (optional, recommended).
// Device tokens come from public.user_devices (registered by the app).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type NotificationRecord = { id: string; user_id: string; actor_id: string | null; type: string; entity_type: string | null; entity_id: string | null; data: Record<string, unknown> | null };
// `encrypted` is set by the database trigger (public.webhook_record); the sealed envelope itself is never sent here.
type MessageRecord = { id: string; conversation_id: string; sender_id: string | null; kind: string; text: string | null; metadata: Record<string, unknown> | null; encrypted?: boolean };
type Card = { id: string; username: string; display_name: string; avatar_url: string | null } | null;

const PREF_BY_TYPE: Record<string, string> = {
  new_follower: 'new_followers', follow_request: 'new_followers', follow_request_accepted: 'new_followers',
  friend_request: 'friend_requests', friend_request_accepted: 'friend_requests',
  match_found: 'matches',
  post_like: 'likes', comment_like: 'likes', video_like: 'likes', story_reaction: 'likes',
  post_comment: 'comments', comment_reply: 'comments', video_comment: 'comments',
  mention: 'mentions', post_repost: 'reposts', video_repost: 'reposts',
  message: 'messages', message_request: 'messages', group_invite: 'messages',
  missed_call: 'calls', incoming_call: 'calls',
  live_started: 'live', live_scheduled: 'live', live_guest_invite: 'live',
  gift_received: 'gifts', subscription_update: 'subscription', security_alert: 'security',
};

function describe(n: NotificationRecord, actor: Card): { title: string; body: string; url: string | null } {
  const name = actor?.display_name ?? 'Someone';
  const d = (n.data ?? {}) as Record<string, string | number | undefined>;
  const profile = actor ? `/u/${actor.username}` : null;
  switch (n.type) {
    case 'new_follower': return { title: name, body: 'started following you', url: profile };
    case 'follow_request': return { title: name, body: 'requested to follow you', url: '/requests' };
    case 'follow_request_accepted': return { title: name, body: 'accepted your follow request', url: profile };
    case 'friend_request': return { title: name, body: 'sent you a friend request', url: '/requests' };
    case 'friend_request_accepted': return { title: name, body: 'accepted your friend request', url: profile };
    case 'match_found': return { title: 'Meet Someone', body: `${name} was matched with you — say hi!`, url: '/match' };
    case 'post_like': return { title: name, body: 'liked your post', url: n.entity_id ? `/post/${n.entity_id}` : null };
    case 'post_comment': return { title: name, body: `commented: ${String(d.preview ?? '')}`, url: d.post_id ? `/post/${d.post_id}` : null };
    case 'comment_reply': return { title: name, body: `replied: ${String(d.preview ?? '')}`, url: d.post_id ? `/post/${d.post_id}` : null };
    case 'comment_like': return { title: name, body: 'liked your comment', url: null };
    case 'mention': return { title: name, body: 'mentioned you', url: n.entity_type === 'post' && n.entity_id ? `/post/${n.entity_id}` : null };
    case 'post_repost': return { title: name, body: 'reposted your post', url: n.entity_id ? `/post/${n.entity_id}` : null };
    case 'story_reaction': return { title: name, body: `reacted ${String(d.emoji ?? '')} to your story`, url: profile };
    case 'message_request': return { title: name, body: 'sent you a message request', url: n.entity_id ? `/chat/${n.entity_id}` : '/inbox' };
    case 'group_invite': return { title: name, body: `added you to ${String(d.title ?? 'a group')}`, url: n.entity_id ? `/chat/${n.entity_id}` : '/inbox' };
    case 'missed_call': return { title: name, body: `Missed ${String(d.kind ?? 'voice')} call`, url: '/calls' };
    case 'incoming_call': return { title: name, body: `Incoming ${String(d.kind ?? 'voice')} call`, url: n.entity_id ? `/call/${n.entity_id}` : '/calls' };
    case 'video_like': return { title: name, body: 'liked your video', url: n.entity_id ? `/video/${n.entity_id}` : null };
    case 'video_comment': return { title: name, body: `commented on your video: ${String(d.preview ?? '')}`, url: n.entity_id ? `/video/${n.entity_id}` : null };
    case 'video_repost': return { title: name, body: 'reposted your video', url: n.entity_id ? `/video/${n.entity_id}` : null };
    case 'live_started': return { title: `${name} is live`, body: String(d.title ?? 'Tap to watch'), url: n.entity_id ? `/live/${n.entity_id}` : '/live' };
    case 'live_scheduled': return { title: name, body: `scheduled a live: ${String(d.title ?? '')}`, url: '/live' };
    case 'live_guest_invite': return { title: name, body: 'invited you on stage', url: n.entity_id ? `/live/${n.entity_id}` : '/live' };
    case 'gift_received': return { title: name, body: `sent you ${String(d.emoji ?? '🎁')} ${String(d.gift ?? 'a gift')}`, url: '/wallet' };
    case 'subscription_update': return { title: 'Friendzy Premium', body: d.status === 'active' ? 'Your Premium is active. Enjoy the perks!' : d.status === 'billing_issue' ? 'There is a problem with your payment method.' : 'Your Premium subscription has ended.', url: '/premium' };
    case 'coins_credited': return { title: 'Coins added', body: `${String(d.coins ?? '')} coins were added to your wallet`, url: '/wallet' };
    case 'coins_adjusted': return { title: 'Wallet update', body: String(d.reason ?? 'Your balance was adjusted'), url: '/wallet' };
    case 'withdrawal_update': return { title: 'Withdrawal update', body: `Your withdrawal is ${String(d.status ?? 'updated')}`, url: '/wallet/earnings' };
    case 'game_invite': return { title: name, body: `invited you to play ${String(d.game ?? 'a game').replace(/_/g, ' ')}`, url: n.entity_id ? `/games/room/${n.entity_id}` : '/games' };
    case 'moderation': return { title: 'Account notice', body: String(d.reason ?? 'There is an update about your account'), url: '/settings/account' };
    case 'content_removed': return { title: 'Content removed', body: String(d.reason ?? 'Some of your content was removed'), url: '/settings/account' };
    case 'verification_update': return { title: 'Verification', body: d.verified ? 'Your account is now verified ✓' : 'Your verification request was reviewed', url: '/settings/verification' };
    case 'security_alert': return { title: 'Security alert', body: String(d.message ?? 'Review your account activity'), url: '/settings/security' };
    default: return { title: name, body: n.type.replace(/_/g, ' '), url: profile };
  }
}

async function tokensFor(admin: SupabaseClient, userIds: string[]): Promise<{ user_id: string; token: string }[]> {
  if (userIds.length === 0) return [];
  const { data } = await admin.from('user_devices').select('user_id, push_token').in('user_id', userIds).not('push_token', 'is', null);
  return (data ?? []).filter((d) => typeof d.push_token === 'string' && /^Expo(nent)?PushToken\[/.test(d.push_token)).map((d) => ({ user_id: d.user_id, token: d.push_token as string }));
}

async function sendExpo(admin: SupabaseClient, messages: { to: string; title: string; body: string; data: Record<string, unknown>; sound?: string; channelId?: string }[]) {
  if (messages.length === 0) return { sent: 0 };
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const token = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (token) headers.Authorization = `Bearer ${token}`;
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const res = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers, body: JSON.stringify(chunk) });
    const result = (await res.json().catch(() => ({}))) as { data?: { status: string; details?: { error?: string } }[] };
    (result.data ?? []).forEach((ticket, idx) => {
      if (ticket.status === 'ok') sent += 1;
      else if (ticket.details?.error === 'DeviceNotRegistered') {
        void admin.from('user_devices').update({ push_token: null }).eq('push_token', chunk[idx].to);
      }
    });
  }
  return { sent };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (!secret) return json({ error: 'PUSH_WEBHOOK_SECRET is not configured' }, 500);
  if (req.headers.get('x-webhook-secret') !== secret) return json({ error: 'Unauthorized' }, 401);

  let body: { type?: string; table?: string; record?: unknown; user_ids?: string[]; title?: string; body?: string; url?: string; data?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Direct broadcast (server-to-server)
  if (Array.isArray(body.user_ids) && body.title) {
    const tokens = await tokensFor(admin, body.user_ids);
    const result = await sendExpo(admin, tokens.map((t) => ({ to: t.token, title: body.title!, body: body.body ?? '', data: { url: body.url ?? null, ...(body.data ?? {}) }, sound: 'default', channelId: 'default' })));
    return json({ ok: true, ...result });
  }

  if (body.type !== 'INSERT' || !body.record) return json({ ok: true, ignored: true });

  if (body.table === 'notifications') {
    const n = body.record as NotificationRecord;
    const { data: prefs } = await admin.from('notification_preferences').select('*').eq('user_id', n.user_id).maybeSingle();
    if (prefs && (prefs.push_enabled === false || (PREF_BY_TYPE[n.type] && prefs[PREF_BY_TYPE[n.type]] === false))) return json({ ok: true, skipped: 'preferences' });
    const { data: actor } = n.actor_id ? await admin.from('profiles').select('id, username, display_name, avatar_url').eq('id', n.actor_id).maybeSingle() : { data: null };
    const { title, body: text, url } = describe(n, actor as Card);
    const tokens = await tokensFor(admin, [n.user_id]);
    const result = await sendExpo(admin, tokens.map((t) => ({ to: t.token, title, body: text, data: { url, notification_id: n.id, type: n.type }, sound: 'default', channelId: 'default' })));
    return json({ ok: true, ...result });
  }

  if (body.table === 'messages') {
    const m = body.record as MessageRecord;
    if (!m.sender_id || m.kind === 'system') return json({ ok: true, ignored: true });
    const { data: members } = await admin.from('conversation_members').select('user_id, notifications, muted_until, state').eq('conversation_id', m.conversation_id).neq('user_id', m.sender_id).eq('state', 'active');
    const now = Date.now();
    const recipients = (members ?? []).filter((x) => x.notifications !== false && (!x.muted_until || Date.parse(x.muted_until) < now)).map((x) => x.user_id);
    if (recipients.length === 0) return json({ ok: true, skipped: 'no recipients' });
    const { data: prefRows } = await admin.from('notification_preferences').select('user_id, push_enabled, messages').in('user_id', recipients);
    const allowed = recipients.filter((id) => { const p = (prefRows ?? []).find((r) => r.user_id === id); return !p || (p.push_enabled !== false && p.messages !== false); });
    const [{ data: sender }, { data: conversation }] = await Promise.all([
      admin.from('profiles').select('id, username, display_name, avatar_url').eq('id', m.sender_id).maybeSingle(),
      admin.from('conversations').select('kind, title').eq('id', m.conversation_id).maybeSingle(),
    ]);
    const senderName = sender?.display_name ?? 'New message';
    // End-to-end encrypted messages: the server cannot read them, so the notification stays generic.
    const preview = m.encrypted
      ? 'New message'
      : m.kind === 'text' ? (m.text ?? '') : m.kind === 'image' ? '📷 Photo' : m.kind === 'video' ? '🎥 Video' : m.kind === 'audio' || m.kind === 'voice' ? '🎤 Voice note' : m.kind === 'gif' ? 'GIF' : m.kind === 'sticker' ? 'Sticker' : m.kind === 'file' || m.kind === 'document' ? '📎 File' : m.kind === 'call' ? '📞 Call' : 'Sent you a message';
    const title = conversation?.kind === 'group' && conversation.title ? `${senderName} · ${conversation.title}` : senderName;
    const tokens = await tokensFor(admin, allowed);
    const result = await sendExpo(admin, tokens.map((t) => ({ to: t.token, title, body: preview.slice(0, 140), data: { url: `/chat/${m.conversation_id}`, conversation_id: m.conversation_id, type: 'message' }, sound: 'default', channelId: 'default' })));
    return json({ ok: true, ...result });
  }

  return json({ ok: true, ignored: true });
});
