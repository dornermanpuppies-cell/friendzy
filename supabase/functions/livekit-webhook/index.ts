// Friendzy — LiveKit webhook receiver
//
// LiveKit POSTs server events (room_started, room_finished, participant_joined,
// participant_left, egress_started, egress_updated, egress_ended, …) to this
// function. Every request is authenticated with the LiveKit server SDK:
// the Authorization header carries a JWT signed with the LiveKit API secret
// (issuer = API key) that also commits to the SHA-256 of the body.
//
// Deploy:   supabase functions deploy livekit-webhook --no-verify-jwt
//           (LiveKit does not send a Supabase JWT; verification happens here.)
// Secrets:  LIVEKIT_API_KEY / LIVEKIT_API_SECRET (shared with livekit-token), or
//           LIVEKIT_WEBHOOK_API_KEY / LIVEKIT_WEBHOOK_API_SECRET when the LiveKit
//           dashboard signs webhooks with a dedicated key.
// URL:      https://<project-ref>.supabase.co/functions/v1/livekit-webhook
//
// Storage and side effects live in the database (migration 0011):
// livekit_ingest_event() records each event once per LiveKit event id and
// applies the Friendzy-specific effects (live/call lifecycle, recordings).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { WebhookReceiver } from 'npm:livekit-server-sdk@2.20.1';

import type { EventRecord } from '../_shared/livekit/events.ts';
import { handleLiveKitWebhook, type IngestResult } from '../_shared/livekit/handler.ts';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const apiKey = Deno.env.get('LIVEKIT_WEBHOOK_API_KEY') || Deno.env.get('LIVEKIT_API_KEY');
const apiSecret = Deno.env.get('LIVEKIT_WEBHOOK_API_SECRET') || Deno.env.get('LIVEKIT_API_SECRET');
const receiver = apiKey && apiSecret ? new WebhookReceiver(apiKey, apiSecret) : null;

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function ingest(record: EventRecord): Promise<IngestResult> {
  const { data, error } = await admin.rpc('livekit_ingest_event', {
    p_id: record.id,
    p_event: record.event,
    p_room_name: record.roomName,
    p_room_sid: record.roomSid,
    p_participant_identity: record.participantIdentity,
    p_participant_sid: record.participantSid,
    p_egress_id: record.egressId,
    p_event_at: record.eventAt,
    p_payload: record.payload,
    p_num_dropped: record.numDropped,
  });
  if (error) throw new Error(error.message);
  return data as IngestResult;
}

Deno.serve(async (req) => {
  if (!receiver) {
    // Secret names only — never values.
    console.error('[livekit-webhook] LIVEKIT_API_KEY / LIVEKIT_API_SECRET are not configured');
    return new Response(JSON.stringify({ error: 'Webhook is not configured' }), { status: 500, headers: JSON_HEADERS });
  }
  const result = await handleLiveKitWebhook(req, {
    verify: (body, authHeader) => receiver.receive(body, authHeader),
    ingest,
    logger: console,
  });
  return new Response(JSON.stringify(result.body), { status: result.status, headers: JSON_HEADERS });
});
