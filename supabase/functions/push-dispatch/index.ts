// Friendzy — push notification dispatcher
//
// Triggered by database triggers (public.push_dispatch_webhook, pg_net) on:
//   • public.notifications      INSERT → one push to the recipient
//   • public.messages           INSERT → push to every other member of the conversation
//   • public.call_participants  INSERT (state = invited) → high-priority "Incoming call"
// Header: x-webhook-secret: <PUSH_WEBHOOK_SECRET>. The payload never contains message
// content for end-to-end encrypted messages (the trigger strips the envelope).
//
// Delivery channels
//   • Android / iOS apps: Expo Push Service (tokens from public.user_devices)
//   • Website / installed web app: Web Push (RFC 8291/8292) to public.web_push_subscriptions,
//     signed with the VAPID keys in VAPID_PRIVATE_KEY (JWK) / VAPID_SUBJECT.
//
// Secrets: PUSH_WEBHOOK_SECRET (required), VAPID_PRIVATE_KEY (+ VAPID_PUBLIC_KEY) + VAPID_SUBJECT (web push),
//          EXPO_ACCESS_TOKEN (optional, recommended once Expo push security is enabled).
// Deploy with `supabase functions deploy push-dispatch --no-verify-jwt`.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
// @ts-types="../_shared/webpush.vendored.d.ts"
import { ApplicationServer, importVapidKeys, PushMessageError, Urgency } from '../_shared/webpush.vendored.js';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type NotificationRecord = { id: string; user_id: string; actor_id: string | null; type: string; entity_type: string | null; entity_id: string | null; data: Record<string, unknown> | null };
// `encrypted` is set by the database trigger (public.webhook_record); the sealed envelope itself is never sent here.
type MessageRecord = { id: string; conversation_id: string; sender_id: string | null; kind: string; text: string | null; metadata: Record<string, unknown> | null; encrypted?: boolean };
type CallInviteRecord = { call_id: string; user_id: string; state: string };
type Card = { id: string; username: string; display_name: string; avatar_url: string | null } | null;

interface Outgoing {
  userId: string;
  title: string;
  body: string;
  url: string;
  type: string;
  /** Collapses repeated notifications of the same thing on the device. */
  tag?: string;
  priority: 'default' | 'high';
  ttlSeconds: number;
  channelId: 'default' | 'messages' | 'calls';
  data?: Record<string, unknown>;
}

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
  const d = (n.data ?? {}) as Record<string, string | number | boolean | undefined>;
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
    case 'mention': return { title: name, body: 'mentioned you', url: n.entity_type === 'post' && n.entity_id ? `/post/${n.entity_id}` : d.post_id ? `/post/${d.post_id}` : null };
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
    case 'game_invite': return { title: name, body: `invited you to play ${String(d.game ?? 'a game').replace(/_/g, ' ')}${d.rematch ? ' again' : ''}`, url: n.entity_id ? `/games/room/${n.entity_id}` : '/games' };
    case 'moderation': return { title: 'Account notice', body: String(d.reason ?? 'There is an update about your account'), url: '/settings/account' };
    case 'content_removed': return { title: 'Content removed', body: String(d.reason ?? 'Some of your content was removed'), url: '/settings/account' };
    case 'verification_update': return { title: 'Verification', body: d.verified ? 'Your account is now verified ✓' : 'Your verification request was reviewed', url: '/settings/verification' };
    case 'security_alert': return { title: 'Security alert', body: String(d.message ?? 'Review your account activity'), url: '/settings/security' };
    case 'test_notification': return { title: 'Friendzy test notification', body: 'Push notifications are working on this device 🎉', url: '/settings/notifications' };
    default: return { title: name, body: n.type.replace(/_/g, ' '), url: profile };
  }
}

// ---------------------------------------------------------------------------
// Expo Push (Android / iOS)
// ---------------------------------------------------------------------------
async function expoTokensFor(admin: SupabaseClient, userIds: string[]): Promise<{ user_id: string; token: string }[]> {
  if (userIds.length === 0) return [];
  const { data } = await admin.from('user_devices').select('user_id, push_token').in('user_id', userIds).not('push_token', 'is', null);
  return (data ?? []).filter((d) => typeof d.push_token === 'string' && /^Expo(nent)?PushToken\[/.test(d.push_token)).map((d) => ({ user_id: d.user_id, token: d.push_token as string }));
}

async function sendExpo(admin: SupabaseClient, items: Outgoing[]): Promise<{ sent: number; errors: Record<string, number> }> {
  const tokens = await expoTokensFor(admin, [...new Set(items.map((i) => i.userId))]);
  if (tokens.length === 0) return 0;
  const messages = items.flatMap((item) =>
    tokens.filter((t) => t.user_id === item.userId).map((t) => ({
      to: t.token,
      title: item.title,
      body: item.body.slice(0, 180),
      data: { url: item.url, type: item.type, ...(item.data ?? {}) },
      sound: 'default',
      priority: item.priority,
      ttl: item.ttlSeconds,
      channelId: item.channelId,
      ...(item.tag ? { collapseId: item.tag } : {}),
    })),
  );
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const token = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (token) headers.Authorization = `Bearer ${token}`;
  let sent = 0;
  const stale: string[] = [];
  const errors: Record<string, number> = {};
  const count = (code: string) => { errors[code] = (errors[code] ?? 0) + 1; };
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const res = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers, body: JSON.stringify(chunk) });
    const result = (await res.json().catch(() => ({}))) as { data?: { status: string; message?: string; details?: { error?: string } }[]; errors?: { code?: string; message?: string }[] };
    (result.errors ?? []).forEach((e) => {
      count(e.code ?? `http_${res.status}`);
      console.error('[push-dispatch] Expo rejected the request', e.code, e.message);
    });
    (result.data ?? []).forEach((ticket, idx) => {
      if (ticket.status === 'ok') { sent += 1; return; }
      const code = ticket.details?.error ?? 'unknown';
      count(code);
      if (code === 'DeviceNotRegistered') stale.push(chunk[idx].to);
    });
  }
  // Tokens Expo no longer recognises are cleared so we stop sending to them. Awaited on purpose:
  // the runtime may freeze the function as soon as the response is sent.
  if (stale.length) await admin.from('user_devices').update({ push_token: null }).in('push_token', [...new Set(stale)]);
  return { sent, errors };
}

// ---------------------------------------------------------------------------
// Web Push (website / installed web app)
// ---------------------------------------------------------------------------
let appServer: ApplicationServer | null | undefined;

const b64url = {
  decode(value: string): Uint8Array {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  },
  encode(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
};

/**
 * VAPID keys from the function secrets. Two accepted shapes:
 *   • VAPID_PRIVATE_KEY = private JWK (JSON), or
 *   • VAPID_PRIVATE_KEY = base64url private scalar (d) + VAPID_PUBLIC_KEY = base64url 65-byte public point
 *     (the same value the website ships as its applicationServerKey).
 */
async function webPushServer(): Promise<ApplicationServer | null> {
  if (appServer !== undefined) return appServer;
  const privateRaw = Deno.env.get('VAPID_PRIVATE_KEY')?.trim();
  const publicRaw = Deno.env.get('VAPID_PUBLIC_KEY')?.trim();
  const subject = Deno.env.get('VAPID_SUBJECT')?.trim() || 'https://friendzychat.netlify.app';
  if (!privateRaw) {
    appServer = null;
    return null;
  }
  try {
    let privateKey: JsonWebKey;
    if (privateRaw.startsWith('{')) {
      privateKey = JSON.parse(privateRaw) as JsonWebKey;
    } else {
      if (!publicRaw) throw new Error('VAPID_PUBLIC_KEY is required when VAPID_PRIVATE_KEY is a raw scalar');
      const point = b64url.decode(publicRaw);
      if (point.length !== 65 || point[0] !== 4) throw new Error('VAPID_PUBLIC_KEY must be an uncompressed P-256 point');
      privateKey = { kty: 'EC', crv: 'P-256', d: privateRaw, x: b64url.encode(point.slice(1, 33)), y: b64url.encode(point.slice(33, 65)), ext: true, key_ops: ['sign'] };
    }
    const publicKey: JsonWebKey = { kty: 'EC', crv: 'P-256', x: privateKey.x, y: privateKey.y, ext: true };
    const vapidKeys = await importVapidKeys({ publicKey, privateKey }, { extractable: false });
    appServer = await ApplicationServer.new({ contactInformation: subject, vapidKeys });
  } catch (error) {
    console.error('[push-dispatch] VAPID keys are invalid', error);
    appServer = null;
  }
  return appServer;
}

async function sendWeb(admin: SupabaseClient, items: Outgoing[]): Promise<number> {
  const server = await webPushServer();
  if (!server) return 0;
  const userIds = [...new Set(items.map((i) => i.userId))];
  const { data: subs } = await admin.from('web_push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', userIds);
  if (!subs || subs.length === 0) return 0;
  let sent = 0;
  const gone: string[] = [];
  const failed: string[] = [];
  await Promise.all(
    items.flatMap((item) =>
      subs.filter((s) => s.user_id === item.userId).map(async (s) => {
        try {
          const subscriber = server.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } });
          const payload = { title: item.title, body: item.body, url: item.url, type: item.type, tag: item.tag ?? item.type, renotify: item.type === 'incoming_call', data: item.data ?? {} };
          await subscriber.pushTextMessage(JSON.stringify(payload), { urgency: item.priority === 'high' ? Urgency.High : Urgency.Normal, ttl: item.ttlSeconds, topic: item.tag?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined });
          sent += 1;
        } catch (error) {
          if (error instanceof PushMessageError && (error.response.status === 404 || error.response.status === 410)) gone.push(s.id);
          else {
            failed.push(s.id);
            console.warn('[push-dispatch] web push failed', s.endpoint.slice(0, 48), error instanceof Error ? error.message : error);
          }
        }
      }),
    ),
  );
  if (gone.length) await admin.from('web_push_subscriptions').delete().in('id', gone);
  if (failed.length) await admin.from('web_push_subscriptions').update({ failed_at: new Date().toISOString() }).in('id', failed);
  return sent;
}

async function deliver(admin: SupabaseClient, items: Outgoing[]): Promise<{ expo: number; web: number; expo_errors?: Record<string, number> }> {
  if (items.length === 0) return { expo: 0, web: 0 };
  const [expo, web] = await Promise.all([sendExpo(admin, items), sendWeb(admin, items)]);
  return { expo: expo.sent, web, ...(Object.keys(expo.errors).length ? { expo_errors: expo.errors } : {}) };
}

/** Users among `userIds` who still want pushes of this category. */
async function allowedRecipients(admin: SupabaseClient, userIds: string[], prefKey: string | undefined): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { data } = await admin.from('notification_preferences').select('*').in('user_id', userIds);
  return userIds.filter((id) => {
    const p = (data ?? []).find((r) => r.user_id === id) as Record<string, unknown> | undefined;
    if (!p) return true;
    if (p.push_enabled === false) return false;
    return !prefKey || p[prefKey] !== false;
  });
}

// ---------------------------------------------------------------------------
// HTTP entry point
// ---------------------------------------------------------------------------
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
    const result = await deliver(admin, body.user_ids.map((userId) => ({ userId, title: body.title!, body: body.body ?? '', url: body.url ?? '/notifications', type: 'broadcast', priority: 'default', ttlSeconds: 86400, channelId: 'default', data: body.data })));
    return json({ ok: true, ...result });
  }

  if (body.type !== 'INSERT' || !body.record) return json({ ok: true, ignored: true });

  if (body.table === 'notifications') {
    const n = body.record as NotificationRecord;
    const allowed = await allowedRecipients(admin, [n.user_id], PREF_BY_TYPE[n.type]);
    if (allowed.length === 0) return json({ ok: true, skipped: 'preferences' });
    const { data: actor } = n.actor_id ? await admin.from('profiles').select('id, username, display_name, avatar_url').eq('id', n.actor_id).maybeSingle() : { data: null };
    const { title, body: text, url } = describe(n, actor as Card);
    const urgent = ['incoming_call', 'match_found', 'live_guest_invite', 'test_notification'].includes(n.type);
    const result = await deliver(admin, [{ userId: n.user_id, title, body: text, url: url ?? '/notifications', type: n.type, tag: `${n.type}:${n.entity_id ?? n.id}`, priority: urgent ? 'high' : 'default', ttlSeconds: n.type === 'live_started' ? 3600 : 7 * 86400, channelId: 'default', data: { notification_id: n.id } }]);
    return json({ ok: true, ...result });
  }

  if (body.table === 'messages') {
    const m = body.record as MessageRecord;
    if (!m.sender_id || m.kind === 'system') return json({ ok: true, ignored: true });
    // Active members get "new message"; a pending member is being asked to accept a message request.
    const { data: members } = await admin.from('conversation_members').select('user_id, notifications, muted_until, state').eq('conversation_id', m.conversation_id).neq('user_id', m.sender_id).in('state', ['active', 'pending']);
    const now = Date.now();
    const candidates = (members ?? []).filter((x) => x.notifications !== false && (!x.muted_until || Date.parse(x.muted_until) < now));
    const allowed = await allowedRecipients(admin, candidates.map((x) => x.user_id), 'messages');
    if (allowed.length === 0) return json({ ok: true, skipped: 'no recipients' });
    const [{ data: sender }, { data: conversation }] = await Promise.all([
      admin.from('profiles').select('id, username, display_name, avatar_url').eq('id', m.sender_id).maybeSingle(),
      admin.from('conversations').select('kind, title').eq('id', m.conversation_id).maybeSingle(),
    ]);
    const senderName = sender?.display_name ?? 'New message';
    // End-to-end encrypted messages: the server cannot read them, so the text stays generic.
    const preview = m.encrypted
      ? 'New message'
      : m.kind === 'text' ? (m.text ?? '') : m.kind === 'image' ? '📷 Photo' : m.kind === 'video' ? '🎥 Video' : m.kind === 'audio' ? '🎤 Voice note' : m.kind === 'gif' ? 'GIF' : m.kind === 'sticker' ? 'Sticker' : m.kind === 'document' ? '📎 File' : m.kind === 'call' ? '📞 Call' : 'Sent you a message';
    const title = conversation?.kind === 'group' && conversation.title ? `${senderName} · ${conversation.title}` : senderName;
    const items: Outgoing[] = allowed.map((userId) => {
      const pending = candidates.find((c) => c.user_id === userId)?.state === 'pending';
      return {
        userId,
        title,
        body: pending ? 'sent you a message request' : preview.slice(0, 140),
        url: `/chat/${m.conversation_id}`,
        type: pending ? 'message_request' : 'message',
        tag: `chat:${m.conversation_id}`,
        priority: 'high',
        ttlSeconds: 86400,
        channelId: 'messages',
        data: { conversation_id: m.conversation_id },
      };
    });
    const result = await deliver(admin, items);
    return json({ ok: true, ...result });
  }

  if (body.table === 'call_participants') {
    const invite = body.record as CallInviteRecord;
    if (invite.state !== 'invited') return json({ ok: true, ignored: true });
    const { data: call } = await admin.from('calls').select('id, kind, status, initiator_id, conversation_id, created_at').eq('id', invite.call_id).maybeSingle();
    if (!call || call.status !== 'ringing') return json({ ok: true, ignored: 'call not ringing' });
    const allowed = await allowedRecipients(admin, [invite.user_id], 'calls');
    if (allowed.length === 0) return json({ ok: true, skipped: 'preferences' });
    const [{ data: caller }, { data: conversation }] = await Promise.all([
      call.initiator_id ? admin.from('profiles').select('id, username, display_name, avatar_url').eq('id', call.initiator_id).maybeSingle() : Promise.resolve({ data: null }),
      admin.from('conversations').select('kind, title').eq('id', call.conversation_id).maybeSingle(),
    ]);
    const name = (caller as Card)?.display_name ?? 'Someone';
    const result = await deliver(admin, [{
      userId: invite.user_id,
      title: conversation?.kind === 'group' && conversation.title ? `${name} · ${conversation.title}` : name,
      body: `Incoming ${call.kind === 'video' ? 'video' : 'voice'} call — tap to answer`,
      url: `/call/${call.id}`,
      type: 'incoming_call',
      tag: `call:${call.id}`,
      priority: 'high',
      ttlSeconds: 60,
      channelId: 'calls',
      data: { call_id: call.id, conversation_id: call.conversation_id, kind: call.kind },
    }]);
    return json({ ok: true, ...result });
  }

  return json({ ok: true, ignored: true });
});
