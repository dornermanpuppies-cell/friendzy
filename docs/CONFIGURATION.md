# Friendzy — Configuration reference

Where every credential lives, who may see it, and what it unlocks. **Never paste secrets into chat, source files or `EXPO_PUBLIC_*` variables.**

| Variable | Scope | Where to set | Unlocks | Status |
| --- | --- | --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | public (client) | `.env.local`, Netlify env, EAS env | everything | ✅ provided |
| `EXPO_PUBLIC_SITE_URL` | public | same | auth redirects, share links | per environment |
| `EXPO_PUBLIC_WEB_HOST` | public | same | universal / app links | when domain exists |
| `EXPO_PUBLIC_LIVEKIT_URL` | public | same | calls, lives | ✅ provided |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | **secret** | Supabase secrets | `livekit-token` | provided in chat → **rotate**; kept only in `supabase/.env.local` |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SEND_EMAIL_HOOK_SECRET`, `SITE_URL` | **secret** | Supabase secrets | branded auth email | 🔑 |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `..._ANDROID_KEY` / `..._TEST_KEY` | public SDK keys | `.env.local`, EAS env | Premium + coin purchases (native builds) | 🔑 production keys; test key provided |
| `REVENUECAT_WEBHOOK_AUTH` | **secret** | Supabase secrets + RevenueCat webhook header | entitlement & coin sync | 🔑 (any random string) |
| `REVENUECAT_SECRET_API_KEY` | **secret** | Supabase secrets | optional server lookups | optional |
| `PUSH_WEBHOOK_SECRET` | **secret** | Supabase secrets + Database Webhook header | push notifications | 🔑 (any random string) |
| `EXPO_ACCESS_TOKEN` | **secret** | Supabase secrets | authenticated Expo push API | recommended |
| `EAS_PROJECT_ID`, `EXPO_OWNER` | public | `.env.local`, CI | push tokens, EAS builds | 🔑 |
| FCM / APNs credentials | **secret** | EAS credentials | push delivery | 🔑 |
| `EXPO_PUBLIC_TENOR_API_KEY` | public | `.env.local` | GIF picker | optional |
| `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` (or approved provider) | **secret** | Supabase secrets | web card payments | ⏳ subject to approval; nothing assumes it |
| Cloudflare Stream token | **secret** | Supabase secrets | optional video CDN | ⏳ not a launch dependency |

## Supabase
- Project ref `gwdpsrjmfrgcloacvdlg`. The anon key is public by design; Row Level Security protects every table (105 tables, verified by `npm run db:test`).
- The service-role key is never used by the apps; Edge Functions receive it automatically.
- Platform behaviour toggles live in `platform_settings` and are edited from Administration → Settings (audited):
  `commission_rate` (0.30), `coin_value_cents` (0.5), `min_withdrawal_coins`, `payouts_enabled` (false until a payout provider exists),
  `gifting_min_age` (18), `max_gift_quantity`, `supported_countries`, `community_rules`, `premium_enabled`, `web_billing_provider` ("none"),
  `verification_min_followers`, `maintenance_mode`, `signups_enabled`.

## Edge Functions
| Function | Auth | Purpose |
| --- | --- | --- |
| `livekit-token` | user JWT | mints LiveKit room tokens for calls (`call_<id>`) and lives (`live_<id>`) after checking membership/stage status |
| `game-engine` | user JWT | the only writer of `game_rooms.state`; start / move / tick / forfeit; reads content banks with the service role |
| `admin-actions` | admin JWT (role verified server-side) | auth-level bans, forced sign-out, account deletion; writes the audit log |
| `send-email` | Supabase hook secret | Resend templates |
| `revenuecat-webhook` | `REVENUECAT_WEBHOOK_AUTH` header | `sync_subscription`, `record_coin_purchase`, `refund_coin_purchase` (idempotent by event id) |
| `push-dispatch` | `x-webhook-secret` header | Expo push for `notifications` and `messages` inserts; drops dead tokens |
| `livekit-webhook` | LiveKit-signed JWT (verified with the server SDK: signature, issuer = API key, expiry, body SHA-256) | records every LiveKit event once per event id (`livekit_webhook_events`), keeps lives/calls in sync with the media rooms, tracks recordings (`livekit_egresses`) |

## RevenueCat
- Entitlement `friendzy_premium`; offering `default`; `$rc_monthly` → `friendzy_premium_monthly`, `$rc_annual` → `friendzy_premium_yearly`.
- Coins are consumables whose product identifiers equal `coin_packages.sku`; the webhook credits coins through the ledger (`credit_coins`).
- The database is the source of truth: the app waits for the webhook after a purchase (store entitlement is only a fallback signal).

### Webhook (deployed on the live project, 2026-11-25)
| Setting in RevenueCat → Project → Integrations → Webhooks | Value |
| --- | --- |
| Webhook URL | `https://gwdpsrjmfrgcloacvdlg.supabase.co/functions/v1/revenuecat-webhook` |
| Authorization header value | exactly the value of the `REVENUECAT_WEBHOOK_AUTH` function secret (with or without a `Bearer ` prefix) |
| Events | all (the function stores every event; unknown types are recorded without side effects) |

Function secrets (Dashboard → Edge Functions → Secrets): `REVENUECAT_WEBHOOK_AUTH` (required — every request is refused
without it, 401 on mismatch, compared in constant time), `REVENUECAT_SECRET_API_KEY` (recommended — after each subscription
event the function re-reads the subscriber from `GET /v1/subscribers/{app_user_id}` and derives the Premium status from the
*current* entitlement; without it, or if the API is unreachable, the authenticated event body is used), optional
`REVENUECAT_IGNORE_SANDBOX=true` (store sandbox events without granting anything) and `REVENUECAT_ENTITLEMENT_ID`
(default `friendzy_premium`).

Behaviour: `INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE`, `UNCANCELLATION`, `SUBSCRIPTION_EXTENDED`,
`TEMPORARY_ENTITLEMENT_GRANT` → active/trialing; `CANCELLATION` → access until expiry, then cancelled (refunds expire at
once); `BILLING_ISSUE` → billing_issue while in the grace period; `SUBSCRIPTION_PAUSED` → paused; `EXPIRATION` → expired;
`TRANSFER` → previous owner expired, new owner re-synced; coin SKUs: `NON_RENEWING_PURCHASE` credits once per store
transaction, `CANCELLATION` refunds; `SUBSCRIBER_ALIAS`, `INVOICE_ISSUANCE`, `VIRTUAL_CURRENCY_TRANSACTION`,
`REFUND_REVERSED` are stored only (a reversed coin refund is flagged for manual review). Every RevenueCat event id is stored
once (`subscription_events.event_id` unique), so retries answer `200 {"ok":true,"duplicate":true}` without a second write;
a database failure answers 500 so RevenueCat retries. Entitlements and coins are only ever written through SECURITY DEFINER
RPCs restricted to the service role (`sync_subscription`, `record_coin_purchase`, `refund_coin_purchase`); clients can never
edit them. Code: `supabase/functions/revenuecat-webhook/index.ts` + `_shared/revenuecat/handler.ts` (Jest-covered).

Verify from RevenueCat: Webhooks → your webhook → **Send test event** → the function answers `200 {"ok":true,"test":true}`
and the delivery shows as successful. Then make a sandbox purchase with a development build and check
`subscription_events` / `subscriptions` / `coin_purchases` in the Table Editor.

- ⚠️ A pasted RevenueCat snippet referenced a different project ("BFF: Make new friends, meet up", entitlement `bff_make_new_friends_meet_up_pro`,
  SwiftUI). Friendzy uses the Friendzy identifiers above unless you decide otherwise; the test key (`test_…`) can be used with development builds.

## Push notifications
**Live project:** the database→function webhooks are installed by migration 0014 (`public.push_dispatch_webhook`, triggers on `notifications` and `messages`, pg_net). The header secret is read from Supabase Vault (`push_webhook_secret`) and must equal the `PUSH_WEBHOOK_SECRET` function secret — rotate both together (`vault.update_secret` + dashboard secret).

`src/services/push.ts` registers Expo push tokens in `user_devices` (needs `EAS_PROJECT_ID` and a physical device). Delivery happens from
`push-dispatch`, triggered by Database Webhooks on `public.notifications` and `public.messages` (INSERT). Preferences in
`notification_preferences` and per-chat mute/notification settings are honoured server-side.

## LiveKit
Only the WebSocket URL ships to clients. The API key/secret live in Supabase secrets and are used exclusively by two Edge Functions:
`livekit-token` (mints room tokens after checking call membership / live visibility and stage status) and `livekit-webhook`
(verifies LiveKit's signed webhook requests). Rotate any key pair that was shared in chat (LiveKit Cloud → Settings → Keys) and
update the secrets.

### Webhooks
- Endpoint: `https://<project-ref>.supabase.co/functions/v1/livekit-webhook` (for this project: `https://gwdpsrjmfrgcloacvdlg.supabase.co/functions/v1/livekit-webhook`).
  It exists only after `supabase functions deploy livekit-webhook --no-verify-jwt` (LiveKit sends its own JWT, not a Supabase one).
- Registration: LiveKit Cloud → Settings → Webhooks, or `lk project webhook create … --signing-key <key id> --user-auth`, or
  `npm run livekit:webhook:register` (`scripts/livekit-webhook.mjs`, calls `https://beta-api.livekit.cloud/v0/projects/{projectId}/webhooks`).
  The management API authenticates with a **user session token** (`lk cloud auth --user-auth`, stored in `~/.livekit/cli-config.yaml`,
  30-day lifetime) — the API key/secret cannot register webhooks. The signing key you pick must be the pair stored as
  `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` (or `LIVEKIT_WEBHOOK_API_KEY` / `_SECRET` for a dedicated signing key), because
  verification checks the JWT issuer against the key id. Always pass the signing key explicitly: left empty, LiveKit picks the
  project's oldest key, which may not be the one the function knows.
- Verification: `npm run livekit:webhook:test` (direct, SDK-signed synthetic event + duplicate/tamper/unsigned checks) and
  `lk project webhook test <id> --event room_started --user-auth` or the `register` script (LiveKit-initiated sample delivery,
  reports the receiver's status code). `npm run livekit:webhook:status` lists the project's webhooks and probes the endpoint.
- Handled events: `room_started`, `room_finished`, `participant_joined`, `participant_left`, `egress_started`, `egress_updated`,
  `egress_ended`. Other events are stored for audit only. Room names map to `live_<id>` / `call_<id>`.
- Side effects: `room_started` stores the room SID; `participant_joined/left` refresh host presence and viewer counts (calls: a
  disconnected participant is marked left and the call ends when nobody is left); `room_finished` ends a live / cancels a draft or
  ringing call; egress events upsert `livekit_egresses` (recording status, times, file/stream results).
- Idempotency: one row per LiveKit event id; repeated deliveries return 200 without reprocessing; a failed processing attempt keeps
  the row unprocessed and answers 500 so LiveKit retries. Clients cannot read or write these tables (admins can read; live hosts
  and call participants can read their own egress rows).
- Logs contain event id, type and room only — never the Authorization header or secrets.

## Payments on the web
`web_billing_provider` is `"none"`: the Premium and Wallet pages explain that purchases happen in the apps and work everywhere.
When an approved provider is chosen, add its adapter (webhook → `sync_subscription` / `record_coin_purchase`) and set the flag.
Mobile digital purchases go through the App Store / Google Play via RevenueCat as required by store policies.

## Netlify (website)
`netlify.toml` builds with `npx expo export --platform web` followed by `scripts/netlify-redirects.mjs` (rewrites for dynamic
routes + `404.html`), publishes `dist`, Node 22. Environment variables in Site configuration: `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_LIVEKIT_URL`, optional `EXPO_PUBLIC_TENOR_API_KEY` / `EXPO_PUBLIC_WEB_HOST`.
`EXPO_PUBLIC_SITE_URL` defaults to the deploy's own URL (`DEPLOY_PRIME_URL` for previews, `URL` in production); set it only
for a custom domain. Netlify never needs a server secret.

## GitHub (repository + CI)
- `.github/workflows/ci.yml` needs no secrets.
- `.github/workflows/supabase-deploy.yml` needs repository secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`,
  `SUPABASE_DB_PASSWORD`; it skips itself until they exist. Edge Function secrets are set with the Supabase CLI, not stored in GitHub.
- Netlify builds straight from the GitHub repository; no deploy token is needed in GitHub.

### Android APK workflow (`.github/workflows/android-apk.yml`)
| Where | Name | Purpose |
| --- | --- | --- |
| Variables | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | required — public anon key bundled into the APK (same as Netlify) |
| Variables | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_LIVEKIT_URL`, `EXPO_PUBLIC_SITE_URL`, `EXPO_PUBLIC_WEB_HOST` | optional overrides (defaults: the Friendzy project, LiveKit project and Netlify site) |
| Secrets | `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | optional — upload keystore for release signing; without them the debug keystore is used (test signing) |
| Automatic | `GITHUB_TOKEN` (`contents: write`) | creates the `android-v…` release and prunes old ones |

The website reads the latest release through the GitHub API using `EXPO_PUBLIC_GITHUB_REPO` (`owner/repo`; Netlify derives it
from the connected repository). Release downloads are public only when the repository is public; otherwise set
`EXPO_PUBLIC_ANDROID_APK_URL` to a public copy of the file.

## End-to-end encryption (no configuration needed)

Nothing to configure or to keep secret on the server: devices generate their own keys and register only public keys through
`register_e2ee_device`. Operational notes:

- `push-dispatch` must be at least the version deployed with migration 0015 — it receives `record.encrypted` instead of the
  envelope and sends the generic text "New message" for sealed messages.
- `e2ee_devices` is the public-key directory (RLS: users see their own rows; other users' public keys are served by
  `e2ee_user_devices` / `e2ee_recipients`, hidden between blocked users). Revoking a device (`revoke_e2ee_device`) stops new
  messages from being sealed for it; it does not sign the device out — that is Settings → Security → Active sessions.
- There is no server-side way to read, recover or reset message content. Support can only help users re-send from a device
  that still has the keys.
- Admin moderation of sealed messages relies on the reporter's device attaching the decrypted text to the report.

## Edge Functions and browsers (CORS)

The app sends a custom `x-friendzy-platform` header with every Supabase request. Browsers therefore send a CORS
preflight to Edge Functions, and the functions must list that header in `Access-Control-Allow-Headers`
(`livekit-token`, `game-engine`, `admin-actions` do; webhooks are never called from a browser). If a new function is
added, copy the `corsHeaders` block from `supabase/functions/livekit-token/index.ts` — otherwise calls, games and admin
actions silently fail on the website while working in the Android app.

`game-engine` imports shared TypeScript (`supabase/functions/_shared/games`). The Supabase Management API accepts one
source body per function, so deploy it from the bundle: `node scripts/bundle-function.mjs game-engine` (esbuild, `npm:`
imports stay external) and upload the generated file as the function body. `supabase functions deploy` from the CLI
bundles automatically.

## Scheduled housekeeping (pg_cron)

Enabled on the live project. Jobs (see migration 0016): `friendzy_expire_calls` every minute (`expire_stale_calls()` —
unanswered rings → missed + notification, abandoned active calls → ended), `friendzy_expire_game_rooms` every 5 minutes
(idle waiting rooms and running games whose turn clock ran out 30 min ago → cancelled), `friendzy_expire_messages` every
10 minutes (disappearing messages). On a project without pg_cron the same functions run lazily from `start_call`,
`create_game_room` and `join_game_room`.

## Browser QA harness (two real accounts)

`scripts/qa/e2e.mjs` drives two headless Chromium profiles through the notifications bell, an end-to-end encrypted chat,
a voice call (fake camera/microphone, real LiveKit room) and Trivia / Chess / Ludo / Truth-or-Dare rooms against a running
build and the live Supabase project. Credentials come from the environment (`QA_ALICE_*`, `QA_BOB_*`, never from the
repository); `scripts/qa/serve-dist.mjs` serves a static export with Netlify-style rewrites;
`scripts/netlify-deploy.mjs` ships `dist/` to Netlify through its API (`NETLIFY_AUTH_TOKEN`) without waiting for a git push.
Install once with `npm i --no-save playwright && npx playwright install --with-deps chromium`.

## LiveKit server address

`LIVEKIT_URL` (Edge Function secret) must be the full WebSocket address of the LiveKit Cloud project, e.g.
`wss://friendzy-9kc7beej.livekit.cloud`. The `livekit-token` function hands this value to every caller and the app
connects to it, so a wrong value breaks calls and lives on every platform. On 2026-11-26 the secret contained
`http://-9kc7beej.livekit.cloud` (prefix lost, wrong scheme) and no call could ever connect; it was corrected, and the
app now validates the address and falls back to `EXPO_PUBLIC_LIVEKIT_URL` when the server value is unusable
(`resolveLiveKitUrl` in `src/services/calls.ts`, unit-tested). Check with a signed-in user:
`POST /functions/v1/livekit-token {"room":"call_<id>"}` must return `"url":"wss://…livekit.cloud"`.
