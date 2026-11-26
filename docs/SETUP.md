# Friendzy — Setup guide

Everything below is needed once to bring the full platform (Phases 1–8) online on the shared Supabase project.

## 1. Prerequisites
- Node.js 22+, npm 10+
- Supabase CLI (`npm i -g supabase` or `npx supabase`)
- Expo account + EAS CLI for Android/iOS builds (`npx eas-cli@latest`)

## 2. Install & configure the client
```bash
npm install
cp .env.example .env.local      # fill EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY / EXPO_PUBLIC_LIVEKIT_URL
```
`.env.local` is gitignored. Only `EXPO_PUBLIC_*` values go there.

## 3. Database
**Status (2026-11-26): all 16 migrations (0001–0016; 0015 adds end-to-end encrypted messaging, 0016 call/game reliability + pg_cron housekeeping) are applied on project `gwdpsrjmfrgcloacvdlg`** and the
CLI migration history (`supabase_migrations.schema_migrations`) lists them, so `supabase db push --dry-run` reports nothing
pending and the GitHub `supabase-deploy.yml` workflow will only ever apply *new* files. Verified live: 111 public tables, every
one with RLS; `discover_people`, `search_people`, `match_find` and the other discovery RPCs answer; `match_queue` is in the
realtime publication; `pg_net` is enabled; nine storage buckets exist. Nothing left to run for the current code.

New migration files are applied either by the deploy workflow (once its three secrets exist) or by pasting the file into the
SQL editor and then recording it: `insert into supabase_migrations.schema_migrations (version, name) values ('<timestamp>', '<name>');`.

Fresh project (if you ever start over): paste `supabase/FRIENDZY_ALL_MIGRATIONS.sql` into the SQL editor (all migrations in order,
idempotent), or `supabase db push` on a linked project. Verify: Table Editor shows ~111 tables, Storage shows buckets
`avatars`, `covers`, `posts`, `stories`, `chat`, `videos`, `live`, `verification`, `banners`.

Local proof: `npm run db:test` boots an embedded PostgreSQL, applies the migrations and runs the SQL test-suite.

## 4. First admin
Sign up in the app with your own email, then run in the SQL editor:
```sql
select public.bootstrap_first_admin('you@example.com');
```
This works only while no admin exists. Further roles are granted from Administration → Admins (super admin only).

## 5. Edge Functions & secrets
**Status (2026-11-25):** all seven functions are deployed on the live project through the Management API (`livekit-token`,
`game-engine`, `admin-actions` with JWT verification; `send-email`, `revenuecat-webhook`, `push-dispatch`, `livekit-webhook`
without, as in `supabase/config.toml`). `game-engine` and `livekit-webhook` were uploaded as single-file bundles of the
multi-file sources (same code; a later `npm run functions:deploy` simply replaces them). Function secrets set: `LIVEKIT_URL`,
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `SITE_URL`, `PUSH_WEBHOOK_SECRET`. Still unset, so those two functions answer
"not configured" until the owner adds them: `RESEND_API_KEY` + `SEND_EMAIL_HOOK_SECRET` (+ enable the Send Email hook) and
`REVENUECAT_WEBHOOK_AUTH`. Rotate the LiveKit key pair that was pasted into chat and update the two secrets afterwards.

```bash
cp supabase/.env.example supabase/.env.local     # fill the secrets (never commit)
supabase secrets set --env-file supabase/.env.local
npm run functions:deploy
```
Functions: `livekit-token` (calls/live tokens), `game-engine` (authoritative games), `admin-actions` (auth bans / deletes),
`send-email` (Resend hook), `revenuecat-webhook` (Premium + coins), `push-dispatch` (Expo push). The last three are deployed with
`--no-verify-jwt` because external services call them; each authenticates with its own secret header.

## 6. Supabase dashboard settings
**Status (2026-11-25):** Site URL and redirect URLs are configured for `https://friendzychat.netlify.app` (plus the Netlify
deploy-preview wildcard, the `friendzy://` scheme and localhost). Push webhooks no longer need the dashboard: migration 0014
installs `AFTER INSERT` triggers on `notifications` and `messages` that call `push-dispatch` through `pg_net`, reading the
`x-webhook-secret` value from Supabase Vault (secret `push_webhook_secret`, same value as the `PUSH_WEBHOOK_SECRET` function
secret). Still open for the owner: custom SMTP for auth emails — the built-in mailer allows only a couple of emails per hour,
which blocks real sign-ups; add Resend (or any SMTP) under Authentication → SMTP settings, or configure the `send-email` hook.

- **Authentication → URL configuration**: Site URL = the Netlify site (`https://<site>.netlify.app`, later the custom domain).
  Redirect URLs: `https://<site>.netlify.app/auth/callback`, `https://<site>.netlify.app/auth/confirm`,
  `https://*--<site>.netlify.app/auth/**` (deploy previews and branch deploys), `friendzy://auth/callback`, `friendzy://auth/confirm`,
  plus the local ones from `supabase/config.toml` (`http://localhost:8081/auth/callback`, `/auth/confirm`).
- **Authentication → Hooks → Send Email** (optional, production email): point to the `send-email` function; copy the hook secret into `SEND_EMAIL_HOOK_SECRET`.
- **Database → Webhooks** (push notifications): two webhooks, table `public.notifications` INSERT and table `public.messages` INSERT, both
  `POST https://<ref>.supabase.co/functions/v1/push-dispatch` with HTTP header `x-webhook-secret: <PUSH_WEBHOOK_SECRET>`.
- **Database → Replication**: realtime is already enabled by the migrations for the tables the app subscribes to.

## 7. RevenueCat (Premium + coins)
1. Create app(s) for iOS and Android; copy the public SDK keys into `EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `..._ANDROID_KEY` (Test Store key for early builds).
2. Entitlement `friendzy_premium`; offering `default` with packages `$rc_monthly` → product `friendzy_premium_monthly` and `$rc_annual` → `friendzy_premium_yearly`.
3. Consumable products whose identifiers equal the coin SKUs (`friendzy_coins_100`, `_550`, `_1200`, `_3300`, `_7000`, `_15000`). Admins can edit SKUs under Administration → Settings.
4. Integrations → Webhooks: URL `https://<ref>.supabase.co/functions/v1/revenuecat-webhook`, Authorization header = `REVENUECAT_WEBHOOK_AUTH`.
The app logs users in to RevenueCat with their Supabase user id, so webhooks map directly to profiles.

## 8. LiveKit
`EXPO_PUBLIC_LIVEKIT_URL` in the client; `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` only as Supabase secrets. Rotate any key that was pasted in chat.

Webhooks (room/participant/egress events → database):
1. `supabase secrets set LIVEKIT_API_KEY=… LIVEKIT_API_SECRET=…` (or `--env-file supabase/.env.local`).
2. `supabase functions deploy livekit-webhook --no-verify-jwt` (also `npm run functions:deploy:livekit-webhook`).
3. Register `https://gwdpsrjmfrgcloacvdlg.supabase.co/functions/v1/livekit-webhook` on the LiveKit project, signed with the key whose
   secret you stored in step 1 (key id stored as `LIVEKIT_API_KEY`). The LiveKit Cloud management API and the `lk project webhook`
   commands authenticate as a signed-in **user** (a 30-day browser session), never with the API key/secret — so this step needs a person:
   - CLI (recommended): `lk cloud auth --user-auth`, then
     ```bash
     lk project webhook create https://gwdpsrjmfrgcloacvdlg.supabase.co/functions/v1/livekit-webhook \
       --name "Friendzy (Supabase livekit-webhook)" --signing-key "$LIVEKIT_API_KEY" \
       --include-event room_started --include-event room_finished \
       --include-event participant_joined --include-event participant_left \
       --include-event egress_started --include-event egress_updated --include-event egress_ended \
       --project <project> --user-auth
     ```
   - or `npm run livekit:webhook:register` — uses the session `lk cloud auth` stored (or `LIVEKIT_SESSION_TOKEN`), resolves the project
     from `LIVEKIT_URL`, creates or updates the webhook by URL (idempotent), then asks LiveKit to deliver a sample `room_started` and prints
     the receiver's status code. Add `--dry-run` to see the plan without changing anything.
   - or the dashboard: Settings → Webhooks → Create new webhook, same URL, **Signing API key** = the key id above.
4. Verify it is active:
   - `npm run livekit:webhook:test` signs a synthetic event with the API secret exactly like LiveKit does and checks: accepted (200),
     duplicate ignored, tampered body rejected (401), unsigned request rejected (401). It prints "not deployed" / "gateway JWT check" /
     "signature rejected" diagnoses when something is off. (Each run stores one `webhook_selfcheck` row.)
   - `lk project webhook test <WEBHOOK_ID> --event room_started --project <project> --user-auth` makes LiveKit itself deliver a sample
     event; `statusCode: 200` means active end to end. `npm run livekit:webhook:status` lists the registered webhooks.
   - SQL editor: `select id, event, room_name, processed_at, applied, error from public.livekit_webhook_events order by received_at desc limit 20;`
     Function logs: Edge Functions → livekit-webhook → Logs.

## 9. Run
```bash
npm run web          # http://localhost:8081
npm run start        # Expo dev server (use a development build: LiveKit, RevenueCat, notifications are native modules)
npx expo run:android | npx expo run:ios     # local development builds
npm run typecheck && npm run lint && npm test && npm run db:test
```

## 10. Hosting: GitHub + Netlify
### GitHub
The repository is initialised on `main` (no commits yet). `.gitignore` keeps `.env.local`, `supabase/.env.local`, `dist/`,
`node_modules/` and native folders out of git — run `git status` and check nothing secret is listed before the first commit.
```bash
git add -A
git commit -m "Friendzy: platform phases 1–8, LiveKit webhooks, CI"
gh auth login                                            # once
gh repo create friendzy --private --source=. --remote=origin --push
# or create the repo in the GitHub UI, then: git remote add origin <url> && git push -u origin main
```
Workflows (`.github/workflows`):
- `ci.yml` — typecheck, lint, unit tests, SQL suite on embedded PostgreSQL, static web export + redirect drift check. Runs on
  every push to `main` and every pull request. No secrets needed.
- `supabase-deploy.yml` — `supabase db push` + Edge Function deploys when `supabase/**` changes on `main` (or manually). Skips
  itself until the repository secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID` (`gwdpsrjmfrgcloacvdlg`) and
  `SUPABASE_DB_PASSWORD` exist. Do the one-time `supabase migration repair` from §3 before enabling it. Edge Function secrets
  stay out of GitHub: `supabase secrets set --env-file supabase/.env.local` once from your machine.

### Netlify
1. Netlify → **Add new site → Import an existing project → GitHub** → pick the repository. Build command, publish directory
   (`dist`) and Node 22 come from `netlify.toml`; nothing to type.
2. **Site configuration → Environment variables** (all deploy contexts unless noted; public values only):
   | Variable | Value |
   | --- | --- |
   | `EXPO_PUBLIC_SUPABASE_URL` | `https://gwdpsrjmfrgcloacvdlg.supabase.co` |
   | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | the anon key (Project Settings → API) |
   | `EXPO_PUBLIC_LIVEKIT_URL` | `wss://friendzy-9kc7beej.livekit.cloud` |
   | `EXPO_PUBLIC_SITE_URL` | leave unset — the build uses the deploy's own URL; set it (Production scope only) once you have a custom domain |
   | `EXPO_PUBLIC_WEB_HOST`, `EXPO_PUBLIC_TENOR_API_KEY` | optional (app links host, GIF search) |
   Scope: all deploy contexts, Builds. Do **not** tick "contains secret values" — these are public by design. If one of them is
   marked secret, Netlify's secrets scanning fails the deploy with "Secrets scanning found secrets in build" because the value is
   (correctly) in the published bundle. `netlify.toml` therefore lists the `EXPO_PUBLIC_*` names in `SECRETS_SCAN_OMIT_KEYS`; until
   that file is deployed, adding the same variable in the Netlify UI has the same effect:
   `SECRETS_SCAN_OMIT_KEYS = EXPO_PUBLIC_SUPABASE_URL,EXPO_PUBLIC_SUPABASE_ANON_KEY,EXPO_PUBLIC_LIVEKIT_URL`.
   Everything else stays scanned, so a leaked service-role key would still stop a deploy.
   **Common mistakes the build now catches.** Values must be complete, e.g. `https://gwdpsrjmfrgcloacvdlg.supabase.co` and
   `wss://friendzy-9kc7beej.livekit.cloud` — no quotes around them, nothing else. A pasted pair of quotes, a missing `https://`
   / `wss://` or a trailing slash is repaired automatically (the log says `repaired …`); anything else stops the build with
   the exact value to enter. A variable marked "contains secret values" is printed as `****` in the log *and* hidden in the UI,
   so if the log rejects a `****` value you cannot inspect it: delete that variable and add it again with the box unticked.
3. **Deploy site.** The build runs a preflight (`scripts/prepare-web-build.mjs --strict`) that fails loudly — naming the variable —
   when one of the three values is missing, misspelled, rejected by Supabase or is a secret key, and clears Metro's cache so changed
   values are always inlined. Then it exports the static site and generates the rewrites for dynamic routes
   (`scripts/netlify-redirects.mjs`) and `404.html`. First build takes a few minutes. Variables are read only while building:
   after adding or changing one, trigger a new deploy.
4. Verify the deploy from the outside: `npm run site:check -- https://<site>.netlify.app` checks the build identity, security headers,
   baked-in public config, dynamic-route rewrites, the 404 page and the auth deep-link pages, and prints the exact Supabase Auth
   URL configuration for that origin.
5. Put the Netlify URL into Supabase Auth (§6) — sign-up confirmation links will not work until the redirect URLs are allowed.
5. Sign up on the site, then create your admin (§4). Deploy previews work automatically for pull requests.
6. Custom domain later: Netlify → Domain management; then set `EXPO_PUBLIC_SITE_URL` (Production) and `EXPO_PUBLIC_WEB_HOST`
   (apex host without protocol, for universal links), update Supabase Site URL / redirect URLs, and redeploy.

### Installing from the website (available now)
The site is an installable web app: `public/manifest.webmanifest` + `public/sw.js` (no caching) + the meta tags in
`src/app/+html.tsx`. `/download` shows a one-tap **Install app** button where the browser offers it (Chrome, Edge, Samsung
Internet) and exact "Add to Home Screen" steps elsewhere (Safari on iPhone/iPad, Firefox, desktop). `npm run site:check` verifies
the manifest, icons and service worker on the live site.

### Android app, downloadable from the website (automatic)
`.github/workflows/android-apk.yml` builds a release APK on GitHub's servers — no Expo account, no Android Studio — on every
push to `main` that touches app code (or by hand: **Actions → Android APK → Run workflow**). It publishes a GitHub release
`android-v<version>-<build>` with `friendzy-android-arm64.apk` (recommended, 64-bit phones), `friendzy-android.apk` (universal,
also 32-bit) and `sha256sums.txt`. The website's `/download` page reads the latest release through the public GitHub API and shows
**Download for Android** with the real version, size and date — nothing to redeploy. Inside the app, the same page shows
"Update available" when a newer build exists. The build takes 20–35 minutes.

One-time setup:
1. **GitHub → Settings → Secrets and variables → Actions → Variables → New repository variable:**
   `EXPO_PUBLIC_SUPABASE_ANON_KEY` = the same anon key as in Netlify. (The Supabase URL, LiveKit URL and site URL default to the
   Friendzy values; override them with variables of the same names if they change. `EXPO_PUBLIC_WEB_HOST` enables Android App
   Links once a custom domain exists.) Until the variable exists the workflow ends green with a "setup needed" notice and builds
   nothing; once it exists, the same preflight as the website build rejects a wrong or truncated key with a clear message.
2. **Make the download public.** Release files inherit the repository's visibility, so visitors can only download from a
   **public** repository: Settings → General → Danger Zone → Change visibility → Public. The repository contains no secrets (the
   preflight refuses to bundle any, and server secrets live in Supabase). If you prefer to keep it private, download the APK from
   the release page yourself, upload it to any public host and set `EXPO_PUBLIC_ANDROID_APK_URL` in Netlify instead.
3. **Signing key** — ✅ done for the live repository on 2026-11-26 (the four secrets exist; keep `.env.android-signing` safe, it is the
   only copy of the keystore). For a fresh fork, create your own once (needs Java):
   ```bash
   keytool -genkeypair -v -keystore friendzy-upload.keystore -alias friendzy -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 friendzy-upload.keystore > friendzy-upload.keystore.b64    # macOS: base64 -i friendzy-upload.keystore
   ```
   Add four **secrets** (Settings → Secrets and variables → Actions → Secrets): `ANDROID_KEYSTORE_BASE64` (contents of the .b64
   file), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`friendzy`), `ANDROID_KEY_PASSWORD`. Keep the keystore file safe
   (losing it means future updates cannot install over existing ones); never commit it. People who installed a debug-signed build
   must uninstall once before installing the first properly signed one.
4. Verify: `npm run site:check -- https://<site>.netlify.app` prints an "Android download" line with the release and file size,
   or tells you why there is none (private repository, no release yet).

How it works: `plugins/withAndroidReleaseSigning.js` adds a release signing config to the generated `android/app/build.gradle`
(`npx expo prebuild`, Continuous Native Generation — `android/` is never committed), `app.config.ts` takes the Android
`versionCode` from `ANDROID_VERSION_CODE` (the workflow's run number, so every build is a valid update), and the workflow keeps the
five most recent Android releases.

### iPhone / iPad and the stores (owner action: Expo + store accounts)
Apple does not allow iPhone apps outside the App Store / TestFlight, so there is no iOS file to download; the Download page says
so and offers Add to Home Screen. For the stores:
1. `npx eas-cli@latest login` → `npx eas-cli@latest init` (creates the project; put the id in `EAS_PROJECT_ID` locally and in EAS).
2. `npx eas-cli@latest build --platform all --profile production`, then `eas submit`; once the listings are live, set
   `EXPO_PUBLIC_PLAY_STORE_URL` / `EXPO_PUBLIC_APP_STORE_URL` in Netlify and redeploy → store buttons appear.
   Push notifications need the EAS project id and FCM/APNs credentials (`eas credentials`). `eas.json` holds the profiles; fill the
   submit section with your App Store Connect app id and Google Play service account when submitting. For Google Play, upload
   the keystore from step 3 above as the upload key (`eas credentials`) so Play builds and website builds share one signature.

## 11. Test accounts
Create accounts through the app (each needs a real inbox for verification). Never insert fake users into `auth.users`.

## 12. Push notifications (phones and browsers, app closed)

Delivery is done by the `push-dispatch` Edge Function, fed by database triggers on `notifications`, `messages` and
`call_participants` (incoming calls). Three channels:

| Channel | Works when | What the owner must provide |
| --- | --- | --- |
| **Website / installed web app** (Chrome, Edge, Firefox, Samsung Internet; Safari on iPhone only after Add to Home Screen) | ✅ now — VAPID keys are in the function secrets (`VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`), the public key ships in `src/constants/push.ts`, the service worker shows notifications and opens the right screen | nothing; users tap **Turn on notifications** in Settings → Notifications (or the banner on the Notifications screen) |
| **Android APK** | after the owner adds Firebase | 1. Firebase console → create project → Add Android app with package `com.friendzy.app` → download `google-services.json`. 2. GitHub → repository Settings → Secrets → Actions → `GOOGLE_SERVICES_JSON` = the file's content. 3. Firebase → Project settings → Cloud Messaging → "Manage service accounts" → create a key (JSON) and upload it at https://expo.dev/accounts/[account]/projects/friendzy/credentials → Android → FCM V1 service account key. 4. Re-run the Android APK workflow; install the new APK; Settings → Notifications → **Allow notifications** → **Send me a test notification**. |
| **iPhone app** | after the owner has an Apple Developer account | `eas credentials` (APNs key) on the EAS project `026ee88e-cff5-49eb-905a-5e8212fa71d9`; EAS/TestFlight build. |

The Expo project id (`026ee88e-cff5-49eb-905a-5e8212fa71d9`) is in `app.config.ts`; the Android workflow passes it as
`EAS_PROJECT_ID`. Without `google-services.json` the APK installs and works but Settings → Notifications says
"Notifications not available here … made without the Firebase configuration" instead of pretending.

Verify the pipeline from SQL (pg_net keeps the function's answers): `select status_code, content::text from net._http_response
order by id desc limit 5;` after `select public.request_test_notification();` — expect `{"ok":true,"expo":N,"web":M}`.
Rotate the VAPID pair with `node -e` (see scripts/qa/webpush-selftest.ts) → update the three secrets →
`EXPO_PUBLIC_VAPID_PUBLIC_KEY` on Netlify → redeploy; browsers re-subscribe on their next visit.

**Web Push library.** `push-dispatch` uses a vendored copy of `@negrel/webpush` (MIT) at
`supabase/functions/_shared/webpush.vendored.js` (types in `webpush.vendored.d.ts`). It is vendored on purpose: a
deploy made through the Supabase Management API cannot resolve `jsr:` imports at boot (v15 of the function failed with
`BOOT_ERROR` until the library was inlined). Regenerate it with `npm run functions:vendor-webpush` (needs Deno) and
re-run `VAPID_KEYS_FILE=… deno run -A scripts/qa/webpush-selftest.ts`, which verifies the VAPID signature and decrypts
the aes128gcm body with an independent RFC 8291 implementation.

**Deploying `push-dispatch` and `game-engine`.** Both import shared files, so deploy either with the CLI
(`supabase functions deploy …`, which bundles the folder) or, when deploying through the Management API / dashboard,
paste the single-file bundle produced by `npm run functions:bundle` (`.expo/function-bundles/<slug>.ts`). The bundle is
what runs in production; the sources stay the place to edit.

**Checking that pushes go out.** Every trigger call and its response is recorded by `pg_net`:
`select status_code, content::text, created from net._http_response order by id desc limit 5;` — `200 {"ok":true,"expo":n,"web":m}`
means the dispatcher ran (`n`/`m` = pushes accepted by Expo / the browser push services). A `503 BOOT_ERROR` means the
function does not start; a `401` means `PUSH_WEBHOOK_SECRET` differs between the Vault and the function secrets.
