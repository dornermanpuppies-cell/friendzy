#!/usr/bin/env node
/**
 * Friendzy — LiveKit webhook registration & verification
 *
 *   node scripts/livekit-webhook.mjs status     list the project's webhooks + probe the endpoint
 *   node scripts/livekit-webhook.mjs register   create/update the Friendzy webhook through the LiveKit Cloud API,
 *                                               then ask LiveKit to deliver a test event and report the receiver's status
 *   node scripts/livekit-webhook.mjs test       send an SDK-signed synthetic event straight to the endpoint
 *                                               (needs only the API key/secret; proves deploy + signature verification)
 *
 * Environment (values are never printed):
 *   LIVEKIT_SESSION_TOKEN   LiveKit Cloud user session token — required for `status` (listing) and `register`.
 *                           The Cloud management API authenticates users, not API keys. Get one with the LiveKit CLI
 *                           (`lk cloud auth --user-auth`) or use `lk project webhook …` directly instead of this script.
 *   LIVEKIT_PROJECT_ID      p_… (optional — resolved by matching LIVEKIT_URL against your projects)
 *   LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET   read from the environment or supabase/.env.local
 *   LIVEKIT_WEBHOOK_URL     receiver URL (default: the project's livekit-webhook Edge Function)
 *   LIVEKIT_CLOUD_API       management API base (default https://beta-api.livekit.cloud)
 *
 * Flags: --all-events (no event filter), --dry-run (register: show the plan, change nothing), --json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AccessToken } from 'livekit-server-sdk';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith('--')) ?? 'status';
const flags = new Set(args.filter((a) => a.startsWith('--')));

const DEFAULT_WEBHOOK_URL = 'https://gwdpsrjmfrgcloacvdlg.supabase.co/functions/v1/livekit-webhook';
const WEBHOOK_NAME = 'Friendzy (Supabase livekit-webhook)';
/** Events the Edge Function acts on. Everything else would only be stored for audit. */
const INCLUDE_EVENTS = ['room_started', 'room_finished', 'participant_joined', 'participant_left', 'egress_started', 'egress_updated', 'egress_ended'];

// ---------------------------------------------------------------------------
// Config (environment first, then the gitignored supabase/.env.local)
// ---------------------------------------------------------------------------
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i), line.slice(i + 1).trim().replace(/^"(.*)"$/, '$1')];
      }),
  );
}
const fileEnv = loadEnvFile(path.join(root, 'supabase', '.env.local'));
const env = (name) => process.env[name] || fileEnv[name] || '';

/** The LiveKit CLI stores the user session from `lk cloud auth --user-auth` in ~/.livekit/cli-config.yaml. */
function sessionFromCliConfig() {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return '';
  const file = path.join(home, '.livekit', 'cli-config.yaml');
  if (!fs.existsSync(file)) return '';
  const match = /^\s*session_token:\s*["']?([^"'\s]+)/m.exec(fs.readFileSync(file, 'utf8'));
  return match ? match[1] : '';
}

const cfg = {
  livekitUrl: env('LIVEKIT_URL'),
  apiKey: env('LIVEKIT_API_KEY'),
  apiSecret: env('LIVEKIT_API_SECRET'),
  sessionToken: env('LIVEKIT_SESSION_TOKEN') || sessionFromCliConfig(),
  projectId: env('LIVEKIT_PROJECT_ID'),
  webhookUrl: env('LIVEKIT_WEBHOOK_URL') || DEFAULT_WEBHOOK_URL,
  cloudApi: (env('LIVEKIT_CLOUD_API') || 'https://beta-api.livekit.cloud').replace(/\/$/, ''),
};

const redact = (text) => String(text).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]').replace(cfg.apiSecret ? new RegExp(cfg.apiSecret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : /$^/, '[secret]');
const log = (...parts) => console.log(...parts.map(redact));
const fail = (message, hint) => {
  log(`✖ ${message}`);
  if (hint) log(`  ${hint}`);
  process.exitCode = 1;
};

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
async function http(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body };
}

async function cloud(method, route, payload) {
  if (!cfg.sessionToken) throw new Error('LIVEKIT_SESSION_TOKEN is not set');
  const { status, body } = await http(`${cfg.cloudApi}${route}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.sessionToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (status === 401 || status === 403) throw new Error(`LiveKit Cloud API answered ${status} — the session token is invalid, expired, or lacks the Write role on the project`);
  if (status >= 400) throw new Error(`LiveKit Cloud API ${method} ${route} answered ${status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

/** Interprets the receiver's answer to a webhook-style POST. */
function diagnose(status, body) {
  if (status === 200 && body?.ok) return { ok: true, verdict: body.duplicate ? 'active (duplicate acknowledged)' : 'active — event verified and stored' };
  if (status === 404 && body?.code === 'NOT_FOUND') return { ok: false, verdict: 'not deployed', hint: 'Run: supabase functions deploy livekit-webhook --no-verify-jwt' };
  if (status === 401 && typeof body?.code === 'number') return { ok: false, verdict: 'blocked by the Supabase gateway JWT check', hint: 'Redeploy with --no-verify-jwt (LiveKit sends its own JWT, not a Supabase one).' };
  if (status === 401) return { ok: false, verdict: 'signature rejected by the function', hint: 'The signing key in LiveKit must be the pair stored as LIVEKIT_API_KEY / LIVEKIT_API_SECRET in Supabase secrets.' };
  if (status === 500 && /not configured/i.test(body?.error ?? '')) return { ok: false, verdict: 'deployed but LIVEKIT_API_KEY / LIVEKIT_API_SECRET secrets are missing', hint: 'supabase secrets set --env-file supabase/.env.local, then redeploy.' };
  if (status === 500) return { ok: false, verdict: 'processing failed inside the function', hint: 'Check Edge Function logs and public.livekit_webhook_events.error.' };
  return { ok: false, verdict: `unexpected answer ${status}: ${JSON.stringify(body).slice(0, 200)}` };
}

// ---------------------------------------------------------------------------
// Direct test: sign a synthetic event exactly like LiveKit does and POST it
// ---------------------------------------------------------------------------
async function signedPost(bodyText, { tamper = false } = {}) {
  const token = new AccessToken(cfg.apiKey, cfg.apiSecret, { ttl: '10m' });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bodyText));
  token.sha256 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  const jwt = await token.toJwt();
  return http(cfg.webhookUrl, {
    method: 'POST',
    headers: { Authorization: jwt, 'Content-Type': 'application/webhook+json' },
    body: tamper ? bodyText.replace('"webhook_selfcheck"', '"tampered"') : bodyText,
  });
}

async function directTest() {
  if (!cfg.apiKey || !cfg.apiSecret) return fail('LIVEKIT_API_KEY / LIVEKIT_API_SECRET are not available', 'Set them in the environment or supabase/.env.local.');
  log(`Endpoint: ${cfg.webhookUrl}`);
  log(`Signing with API key ${cfg.apiKey} (secret from env, ${cfg.apiSecret.length} chars)`);

  const probe = await http(cfg.webhookUrl, { method: 'GET' });
  if (probe.status === 404) return fail('Endpoint is not deployed (404 from Supabase).', 'Run: supabase functions deploy livekit-webhook --no-verify-jwt — then rerun this check.');
  log(`GET → ${probe.status} ${probe.status === 405 ? '(method not allowed — the function is live)' : JSON.stringify(probe.body).slice(0, 120)}`);

  const id = `EV_selfcheck_${Date.now()}`;
  const event = JSON.stringify({ event: 'webhook_selfcheck', id, createdAt: Math.floor(Date.now() / 1000), room: { sid: 'RM_selfcheck', name: 'friendzy-webhook-selfcheck' } });

  const first = await signedPost(event);
  const d1 = diagnose(first.status, first.body);
  log(`Signed event → ${first.status} ${JSON.stringify(first.body).slice(0, 160)} ⇒ ${d1.verdict}`);
  if (!d1.ok) return fail('Receiver did not accept a correctly signed event.', d1.hint);

  const second = await signedPost(event);
  const dupOk = second.status === 200 && second.body?.duplicate === true;
  log(`Same event again → ${second.status} ${JSON.stringify(second.body).slice(0, 120)} ⇒ ${dupOk ? 'duplicate ignored ✓' : 'unexpected (expected duplicate:true)'}`);

  const tampered = await signedPost(event, { tamper: true });
  const tamperOk = tampered.status === 401;
  log(`Tampered body, valid token → ${tampered.status} ⇒ ${tamperOk ? 'rejected ✓' : 'NOT rejected — investigate'}`);

  const unsigned = await http(cfg.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/webhook+json' }, body: event });
  const unsignedOk = unsigned.status === 401;
  log(`No Authorization header → ${unsigned.status} ⇒ ${unsignedOk ? 'rejected ✓' : 'NOT rejected — investigate'}`);

  if (dupOk && tamperOk && unsignedOk) {
    log(`\n✔ Webhook endpoint is ACTIVE and verifying LiveKit signatures. Stored as event id ${id} (event=webhook_selfcheck) in public.livekit_webhook_events.`);
  } else {
    fail('Endpoint is reachable but one of the safety checks failed (see above).');
  }
}

// ---------------------------------------------------------------------------
// LiveKit Cloud management API: list / register / LiveKit-initiated test
// ---------------------------------------------------------------------------
async function resolveProject() {
  if (cfg.projectId) return { id: cfg.projectId, name: '(from LIVEKIT_PROJECT_ID)', url: cfg.livekitUrl };
  const list = await cloud('GET', '/v0/projects?page.pageSize=100');
  const wanted = cfg.livekitUrl.replace(/\/$/, '').toLowerCase();
  const host = wanted.replace(/^wss?:\/\//, '');
  const match = (list.items ?? []).find((p) => (p.url ?? '').replace(/\/$/, '').toLowerCase() === wanted || (p.subdomain && host.startsWith(`${p.subdomain.toLowerCase()}.`)));
  if (!match) throw new Error(`No LiveKit Cloud project matches LIVEKIT_URL (${cfg.livekitUrl}). Projects visible to this session: ${(list.items ?? []).map((p) => `${p.name} ${p.id} ${p.url}`).join('; ') || 'none'}. Set LIVEKIT_PROJECT_ID explicitly.`);
  return match;
}

function desiredWebhook() {
  const desired = { name: WEBHOOK_NAME, url: cfg.webhookUrl, signingKey: cfg.apiKey };
  if (!flags.has('--all-events')) desired.filterParams = { includeEvents: INCLUDE_EVENTS, excludeEvents: [] };
  return desired;
}

function differs(existing, desired) {
  const eventsOf = (w) => [...(w.filterParams?.includeEvents ?? [])].sort().join(',');
  return existing.name !== desired.name || existing.signingKey !== desired.signingKey || eventsOf(existing) !== (desired.filterParams ? [...desired.filterParams.includeEvents].sort().join(',') : '');
}

async function status() {
  log(`Endpoint: ${cfg.webhookUrl}`);
  const probe = await http(cfg.webhookUrl, { method: 'GET' });
  log(`Endpoint probe (GET) → ${probe.status}: ${probe.status === 405 ? 'deployed' : probe.status === 404 ? 'NOT deployed' : JSON.stringify(probe.body).slice(0, 120)}`);
  if (!cfg.sessionToken) {
    log('\nLiveKit Cloud side: LIVEKIT_SESSION_TOKEN not set — cannot list the project\'s webhooks from here.');
    log('  Alternative: lk cloud auth --user-auth && lk project webhook list --project <project> --user-auth');
    return;
  }
  const project = await resolveProject();
  log(`Project: ${project.name} (${project.id}) ${project.url ?? ''}`);
  const list = await cloud('GET', `/v0/projects/${project.id}/webhooks`);
  const items = list.items ?? [];
  if (items.length === 0) log('No webhooks registered on this project yet.');
  for (const w of items) {
    const mine = w.url === cfg.webhookUrl;
    log(`${mine ? '→' : ' '} ${w.id}  ${w.name}  ${w.url}  signingKey=${w.signingKey}  events=${(w.filterParams?.includeEvents ?? []).join(',') || 'all'}`);
  }
  if (flags.has('--json')) console.log(JSON.stringify({ project: { id: project.id, name: project.name }, webhooks: items }, null, 2));
}

async function register() {
  if (!cfg.apiKey) return fail('LIVEKIT_API_KEY is not available (needed as the signing key).');
  if (!cfg.sessionToken) {
    return fail(
      'LIVEKIT_SESSION_TOKEN is not set. The LiveKit Cloud management API accepts a signed-in user session, not the API key/secret.',
      `Either run the LiveKit CLI yourself:\n    lk cloud auth --user-auth\n    lk project webhook create ${cfg.webhookUrl} --name "${WEBHOOK_NAME}" --signing-key ${cfg.apiKey} ${INCLUDE_EVENTS.map((e) => `--include-event ${e}`).join(' ')} --project <project> --user-auth\n  or export LIVEKIT_SESSION_TOKEN and rerun this command.`,
    );
  }
  const project = await resolveProject();
  log(`Project: ${project.name} (${project.id})`);
  const desired = desiredWebhook();
  const list = await cloud('GET', `/v0/projects/${project.id}/webhooks`);
  const existing = (list.items ?? []).find((w) => w.url === cfg.webhookUrl);
  let webhook = existing;
  if (!existing) {
    log(`Plan: CREATE webhook "${desired.name}" → ${desired.url} signed with ${desired.signingKey}, events: ${desired.filterParams ? INCLUDE_EVENTS.join(', ') : 'all'}`);
    if (!flags.has('--dry-run')) webhook = (await cloud('POST', `/v0/projects/${project.id}/webhooks`, desired)).webhook;
  } else if (differs(existing, desired)) {
    log(`Plan: UPDATE webhook ${existing.id} (name/signing key/events differ)`);
    if (!flags.has('--dry-run')) webhook = (await cloud('PATCH', `/v0/projects/${project.id}/webhooks/${existing.id}`, desired)).webhook;
  } else {
    log(`Webhook ${existing.id} already registered with the desired settings.`);
  }
  if (flags.has('--dry-run')) return log('Dry run — nothing changed.');
  log(`Registered: ${webhook.id}  ${webhook.name}  ${webhook.url}  signingKey=${webhook.signingKey}`);

  const probe = await http(cfg.webhookUrl, { method: 'GET' });
  if (probe.status === 404) log('⚠ The endpoint is not deployed yet (404). LiveKit\'s test delivery will fail until `supabase functions deploy livekit-webhook --no-verify-jwt` has run.');

  const test = await cloud('POST', `/v0/projects/${project.id}/webhooks/${webhook.id}:test`, { event: 'room_started' });
  const receiverStatus = Number(test.statusCode ?? 0);
  if (receiverStatus === 200) log('✔ LiveKit delivered a test room_started event and the receiver answered 200 — the webhook is ACTIVE.');
  else if (receiverStatus === 0) fail(`LiveKit could not reach the receiver: ${test.error || 'no response'}`);
  else fail(`LiveKit delivered a test event but the receiver answered ${receiverStatus}.`, diagnose(receiverStatus, receiverStatus === 404 ? { code: 'NOT_FOUND' } : {}).hint);
  if (flags.has('--json')) console.log(JSON.stringify({ webhook, test }, null, 2));
}

try {
  if (command === 'status') await status();
  else if (command === 'register') await register();
  else if (command === 'test') await directTest();
  else fail(`Unknown command "${command}". Use: status | register | test`);
} catch (error) {
  fail(redact(error instanceof Error ? error.message : String(error)));
}
