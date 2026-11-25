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
**Status (2026-11-25): migrations 0001–0011 are applied on project `gwdpsrjmfrgcloacvdlg`** (verified through the public API:
RPCs answer, tables exist with RLS, all nine storage buckets are present). Three follow-ups:

1. Run `supabase/migrations/20261125000012_hardening.sql` once in the SQL editor (unique keys for the seeded content banks +
   a grant that lets signed-out visitors read the Premium plans table).
1b. Run `supabase/migrations/20261125000013_discovery.sql` once in the SQL editor (friend discovery & Meet Someone: languages,
   privacy flags, discovery/search RPCs, live matching queue, presence activity, `match_found` notifications, admin signals).
   Both files are idempotent; the app's Discover, Friends, Search and Meet Someone screens need 0013 to work.
2. Tell the Supabase CLI that these migrations are already in place, so `supabase db push` (locally or from the GitHub
   workflow) only applies *future* files instead of replaying everything:
   ```bash
   supabase login
   supabase link --project-ref gwdpsrjmfrgcloacvdlg
   supabase migration repair --status applied 20261125000001 20261125000002 20261125000003 20261125000004 \
     20261125000005 20261125000006 20261125000007 20261125000008 20261125000009 20261125000010 20261125000011 20261125000012 \
     20261125000013
   supabase db push --dry-run     # should report nothing pending
   ```

Fresh project (if you ever start over): paste `supabase/FRIENDZY_ALL_MIGRATIONS.sql` into the SQL editor (all migrations in order,
idempotent), or `supabase db push` on a linked project. Verify: Table Editor shows ~110 tables, Storage shows buckets
`avatars`, `covers`, `posts`, `stories`, `chat`, `videos`, `live`, `verification`, `banners`.

Local proof: `npm run db:test` boots an embedded PostgreSQL, applies the migrations and runs the SQL test-suite.

## 4. First admin
Sign up in the app with your own email, then run in the SQL editor:
```sql
select public.bootstrap_first_admin('you@example.com');
```
This works only while no admin exists. Further roles are granted from Administration → Admins (super admin only).

## 5. Edge Functions & secrets
```bash
cp supabase/.env.example supabase/.env.local     # fill the secrets (never commit)
supabase secrets set --env-file supabase/.env.local
npm run functions:deploy
```
Functions: `livekit-token` (calls/live tokens), `game-engine` (authoritative games), `admin-actions` (auth bans / deletes),
`send-email` (Resend hook), `revenuecat-webhook` (Premium + coins), `push-dispatch` (Expo push). The last three are deployed with
`--no-verify-jwt` because external services call them; each authenticates with its own secret header.

## 6. Supabase dashboard settings
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
3. **Signing key (recommended before handing the app to many people).** Without it the APK is signed with the public debug
   keystore: it installs and updates fine, but anyone could sign an APK with that key. Create your own once (needs Java):
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
