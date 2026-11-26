# Friendzy — Feature Checklist

Status legend: ✅ done & tested · 🧪 built, needs live verification · 🔑 blocked on credentials/config · ⏳ not built

"Done & tested" for the database means every table, policy and RPC passed the SQL test-suite (`npm run db:test`, 16 suites, 111 tables with RLS)
against a local PostgreSQL that mimics Supabase. "Needs live verification" means the UI and backend exist and typecheck, but could not be
exercised end-to-end from the build sandbox (no device / camera / store, and the migrations are applied by the project owner).

## Database & server (all phases)

| Item | Status | Notes |
| --- | --- | --- |
| 16 migrations `supabase/migrations/20261125000001…0016` (foundation, social, messaging, calls, videos, economy, live, games, subscriptions, admin, LiveKit webhooks, hardening, friend discovery & matching, push webhooks, end-to-end encryption, calls & games reliability) | ✅ all applied on the live project and recorded in the CLI migration history (2026-11-26); pg_cron runs `expire_stale_calls` (1 min), `expire_game_rooms` (5 min), `expire_messages` (10 min) | combined hand-off file: `supabase/FRIENDZY_ALL_MIGRATIONS.sql` |
| SQL tests `supabase/tests/0001…0014` + RLS-on-every-table check | ✅ | `npm run db:test` |
| GitHub Actions (`ci.yml`: typecheck/lint/tests/SQL suite/web export · `supabase-deploy.yml`: migrations + functions · `android-apk.yml`: signed Android APK published as a GitHub release) and Netlify build (`netlify.toml` + generated redirects, `404.html`) | ✅ CI green on `main` · 🔑 `android-apk.yml` needs the `EXPO_PUBLIC_SUPABASE_ANON_KEY` repository variable; download link needs a public repository | deploy workflow needs three repository secrets |
| Website Download page: installable web app (manifest, service worker, install prompt) + Android APK from the latest GitHub release (version, size, update check inside the app) + honest iOS copy | 🧪 | `src/app/(marketing)/download.tsx`, `src/services/androidRelease.ts`, `plugins/withAndroidReleaseSigning.js` |
| Edge Functions: `send-email`, `livekit-token`, `game-engine`, `revenuecat-webhook`, `push-dispatch`, `admin-actions`, `livekit-webhook` | ✅ all seven deployed on the live project (2026-11-25); secrets set for LiveKit, SITE_URL, push and RevenueCat (`REVENUECAT_WEBHOOK_AUTH`, `REVENUECAT_SECRET_API_KEY`) · 🔑 `RESEND_API_KEY`/`SEND_EMAIL_HOOK_SECRET` still to add | HTTPS probes: every function boots and fails closed without its secret |
| LiveKit webhook: SDK signature verification, idempotent storage (`livekit_webhook_events`), live/call lifecycle sync, recordings (`livekit_egresses`) | ✅ deployed with the LiveKit secrets (rejects unsigned deliveries with 401) · 🔑 registration in LiveKit Cloud still needs a signed-in LiveKit user | `npm run livekit:webhook:register` / dashboard, then `npm run livekit:webhook:test` |
| LiveKit webhook registration & verification tool (`scripts/livekit-webhook.mjs`: `status` / `register` / `test`) | ✅ tool · 🔑 registration needs a LiveKit user session (`lk cloud auth --user-auth`), not the API key | API key/secret verified against the LiveKit API (ListRooms OK); endpoint currently answers 404 (function not deployed) |
| Shared game engines (Ludo, Chess via chess.js, Trivia/WYR/Guess-the-song rounds, Truth or Dare) | ✅ | `supabase/functions/_shared/games`, reused by the app for legal-move previews |

> **Deploy status (2026-11-26, later):** pushed to `main` (f9e6ae8); Netlify published the new build within a minute and the
> two-account browser harness passed all 8 scenarios against https://friendzychat.netlify.app (bell, encrypted chat, voice
> call, Trivia, Chess, Ludo, Truth or Dare, Guess-the-Song notice). The Android APK rebuilds from the same push
> (GitHub Actions → Releases); phones must install the new APK to get the fixes.

## Phase 1 — Foundation
| Area | Item | Status |
| --- | --- | --- |
| Project | Expo SDK 58 + Expo Router + TypeScript, design system, light/dark + Premium accents, responsive web (static export, Netlify config) | ✅ |
| Auth | Register (16+), verify email, sign in/out, forgot/reset password, change email/password, sessions, delete account | 🧪 |
| Email | Branded Resend templates via Send-Email hook | 🔑 `RESEND_API_KEY` |
| Onboarding | 7 steps, resumable | 🧪 |
| Profiles | Profile pages, edit, follow/friend/block/report, privacy settings, discover, presence | 🧪 |
| Notifications | In-app centre (realtime) · Push via Expo (device registration + `push-dispatch`, database triggers via pg_net + Vault — migration 0014) | 🧪 / 🔑 EAS project id for native push tokens |

## Phase 2 — Social networking
| Item | Status |
| --- | --- |
| Feeds: For you / Following / Nearby / Trending; posts (text, photo, video, carousel, poll, question, share); comments & replies; reactions; reposts; saves; hide / not interested | 🧪 |
| Stories (24 h, viewers, reactions, highlights, archive, privacy) | 🧪 |
| Search (people, posts, hashtags, videos), trending topics (admin-pinned + organic) | 🧪 |
| Random match, nearby (approximate location), interests-based suggestions | 🧪 superseded by Phase 13 below |

## Phase 13 — Friend discovery & social matching (worldwide)
| Item | Status |
| --- | --- |
| Discover tab: 8 live sections (Recommended for you · Online now · Near you · New members · Popular · Share your interests · Other countries · Recently active) as rails + `/people/[section]` lists with infinite scroll; every card shows photo, name/@username, age (adults who opt in), country/city (per privacy), bio, interests (shared first), languages, online status / "Chatting now" (opt-in) / last seen, mutual friends, Add friend · Follow · Message | ✅ DB (`discover_people`, `discover_card_json`, SQL suite with 7 users incl. two minors) · 🧪 UI |
| Advanced people search `/people/search`: username, full name, country, city, gender (voluntary), interests, languages, online now; sorting (best match / recently active / newest / popular / name); age range stays a Premium perk; minors and adults never see each other | ✅ DB (`search_people`) · 🧪 UI |
| Friend system: send / accept / decline / cancel / remove / block, duplicate & blocked-pair prevention, auto-accept of crossing requests, incoming + sent pages with full cards, Friends page (`/friends`, search, online first, message, remove, block), mutual friends on profiles, friend request button in chat info, notifications on send/accept | ✅ DB · 🧪 UI |
| MEET SOMEONE (`/match`): live two-sided matching queue (`match_find` / `match_queue` / `matches`, realtime + polling), preferences (countries, languages, gender, 18+ age range, shared interests) enforced symmetrically, suggestion fallback after ~10 s, searching animation, result with Start chatting / Send friend request / Find someone else, report & block; never starts a call; excludes blocked, recently skipped (7 d), recently matched (30 d), reported, restricted and heavily-reported accounts; adults only; leaving the screen leaves the queue | ✅ DB (SQL suite covers two accounts matching live, preferences, exclusions, notifications) · 🧪 UI (needs two live accounts) |
| Presence: online / offline / last seen / activity ("Chatting now") with per-user toggles (show online status, last seen, "show what I'm doing" default off) | ✅ DB · 🧪 UI |
| Profile details: languages (edit profile, max 6), join date, age toggle, city/languages/gender/country toggles, mutual friends strip | ✅ DB · 🧪 UI |
| Notifications: `match_found` type + "Meet Someone matches" preference (in-app + `push-dispatch`) | ✅ DB · 🧪 push needs Database Webhook |
| Admin → Discovery: searching-now / live matches / match actions / friend requests / blocks, heavy requesters, most blocked, reported via matching, heavy skippers (links to user management) | ✅ DB (`admin_discovery_abuse`) · 🧪 UI |

## Phase 3 — Messaging
| Item | Status |
| --- | --- |
| 1:1 & group chats, attachments, voice notes, GIFs (🔑 Tenor key), stickers, replies, edit/delete, reactions, forward, star, pin, search, read receipts, typing, archive/mute/pin/unread, disappearing messages, wallpapers, message requests, invite links | 🧪 |
| Notifications bell: fixed 2026-11-26 — opening the screen while the badge counter listened on the same realtime channel threw `cannot add postgres_changes callbacks … after subscribe()` (blank screen on web, app closed on Android). Every database listener now gets its own channel (`src/lib/realtime.ts`); covered by `scripts/qa/e2e.mjs --only notifications` | ✅ |
| End-to-end encryption: per-device X25519/Ed25519 keys (10 per user, revocable), sealed envelopes with per-message keys, server-side recipient check (no plaintext fallback, plaintext RPCs revoked), encrypted attachments (chunked, streamed on phones), inbox previews / replies / edits / forwards / story replies / search / media gallery all handled on-device, security codes + trust-on-first-use notices, Settings → End-to-end encryption (devices, limits), generic push text, reports carry reporter-decrypted text | ✅ DB (`0015_e2ee`, 70+ assertions) · ✅ crypto (12 Jest cases) · 🧪 two-account UI test |

## Phase 4 — Communication
| Item | Status |
| --- | --- |
| Voice/video calls verified end to end in two real browser sessions (ring → banner → accept → both connected through LiveKit → hang-up → history): `node scripts/qa/e2e.mjs --only call`. Fixed on 2026-11-26: Edge Function CORS blocked every browser call to `livekit-token`/`game-engine`/`admin-actions` (custom `x-friendzy-platform` header); duplicate realtime channel names threw inside screens; stale ringing/active calls now expire (`expire_stale_calls`, cron + lazily in `start_call`), re-calling from a dead call rings again, `get_ringing_call` shows the banner when the app opens mid-ring | ✅ |
| LiveKit token endpoint (server-side secret), voice/video calls 1:1 & group, incoming overlay, history | 🧪 (needs a development build; web works in browser) |

## Phase 5 — Video & creators
| Item | Status |
| --- | --- |
| Vertical short-video feed (For you / Following / Trending) with autoplay, like, comment, save, repost, share, gift, not-interested, report | 🧪 |
| Composer: record/upload, trim, speed, filters, text & sticker overlays, sounds (library + upload), volumes, cover frame, caption/hashtags/mentions, audience & permissions, drafts, duet & stitch | 🧪 (edits are applied at playback time — no server transcoding) |
| Sounds pages, hashtag/challenge pages, playlists, Creator Studio (analytics, drafts, playlists, challenges, edit video) | 🧪 |
| Profile Reels & Live tabs | 🧪 |
| Cloudflare Stream adapter | ⏳ optional — `videos.provider` column + media layer ready |

## Phase 6 — Livestreaming
| Item | Status |
| --- | --- |
| Go live (title, category, cover, visibility, guests, comments, schedule), host preview, LIVE discovery (live now, following, upcoming, trending hosts) | 🧪 |
| Viewer: realtime comments, likes (floating hearts), gifts with animations, stage requests, fan club, share, report, reminders | 🧪 |
| Host/moderators: requests, invite, remove, co-host, mic/cam, moderators, mute, ban, pin/delete comments, slow mode, comment audience, battles (gift-scored), end summary | 🧪 |
| Admin force-end + hosting restriction | 🧪 |

## Phase 7 — Games & monetisation
| Item | Status |
| --- | --- |
| Games verified in two real browser sessions through the live game engine (`node scripts/qa/e2e.mjs --only games`): Trivia (answer, reveal, auto-advance, results), Chess (legal moves, resign, winner), Ludo (rolls, token moves, finish), Truth or Dare (choose, perform, vote, score). Fixed on 2026-11-26: Edge Function CORS blocked every browser call to the engine; the host's first taps after "Start" were silently dropped while the start request was still in flight (host always scored 0 in trivia); Guess the Song is shown as "coming soon" with the reason until the sound library has 4 sounds (`game_content_status`); abandoned rooms are cancelled automatically (`expire_game_rooms`, cron + lazily) so nobody is stuck behind ALREADY_IN_GAME; realtime channels per listener; engine unit tests (18 cases) + SQL reliability suite; board polish: animated dice, pulsing legal tokens, last-move ring, captured pieces & check highlight in chess, answered/points badges, haptics on your turn | ✅ |
| Games lobby (public/private rooms, codes, invites, ready, chat), server-authoritative engine, Ludo, Chess, Trivia, Would You Rather, Truth or Dare, Guess the Song, leaderboards, rematch | 🧪 (Guess the Song needs ≥4 sounds in the library) |
| Wallet: coin balance, packages, transactions, gifts sent/received, realtime | 🧪 |
| Coin purchases via RevenueCat (native) → webhook → ledger | 🔑 RevenueCat SDK keys, products, webhook auth |
| Gifts (14 + admin-managed catalogue), 30 % commission, adult-only, premium-only gifts, creator earnings, top supporters | ✅ DB / 🧪 UI |
| Withdrawals (requests, cancel, admin approve/pay/reject through the ledger) | 🔑 `payouts_enabled` is off until a payout provider + identity checks exist |
| Premium (`friendzy_premium`, `$rc_monthly`/`$rc_annual`), perks: premium gifts, profile viewers, who liked you, advanced search, accent themes · RevenueCat webhook (`revenuecat-webhook`: shared-secret auth, API-verified entitlements, idempotent coins/subscriptions, Jest + SQL covered) | ✅ webhook deployed with `REVENUECAT_WEBHOOK_AUTH` + `REVENUECAT_SECRET_API_KEY` · 🔑 register the URL in RevenueCat, public SDK keys in the apps |
| Card payments on the web | ⏳ `web_billing_provider = "none"`; UI points to the apps until an approved provider is connected |

## Phase 8 — Administration & launch
| Item | Status |
| --- | --- |
| Admin dashboard: overview, analytics, users (status, warnings, feature restrictions, notes, coins, Premium, verification, sessions, auth ban), reports queue & resolution, content removal/restore, live moderation, finance (withdrawals, ledger, purchases, subscriptions), settings & catalogues, site content (announcements, banners, featured creators, trending topics), verification queue, audit log, roles | 🧪 |
| Role model (super_admin, admin, moderator, support, finance) enforced server-side; first admin via `bootstrap_first_admin` | ✅ DB |
| Website installable as a web app (manifest, maskable icons, no-cache service worker, one-tap install prompt + per-browser "Add to Home Screen" steps on `/download`) | 🧪 | verified by `npm run site:check` once deployed |
| Download page store buttons (`EXPO_PUBLIC_PLAY_STORE_URL`, `EXPO_PUBLIC_APP_STORE_URL`, `EXPO_PUBLIC_ANDROID_APK_URL`) | 🔑 | render only when the URLs exist; APK via `eas build --profile preview` |
| EAS config (`eas.json`), Netlify config | 🧪 / 🔑 EAS project, store accounts |
| Store submission, production security review on live project | ⏳ owner action |

## Verification run (this build)
- `npm run db:test` — all 10 suites pass, RLS enabled on 105 public tables.
- `npm run typecheck` — passes.
- `npm run lint` — passes (React Compiler advisories are reported as warnings; see eslint.config.js).
- `npm test` — 48 unit tests pass.
- `npm run web:export` — static site builds.

## Open configuration items (owner action required)
1. ~~Run the migrations~~ ✅ 0001–0016 applied and recorded in the CLI history (2026-11-26). Nothing to run.
1b. ~~Push the repository to GitHub and connect it to Netlify~~ ✅ · ~~Netlify public variables~~ ✅ corrected through the Netlify API (the two URLs had been pasted into the wrong fields); the live site passes `npm run site:check` and Supabase accepts the baked anon key · ~~Supabase Auth URLs~~ ✅ set. ~~First administrator~~ ✅ created through the Auth Admin API and promoted with `bootstrap_first_admin` (2026-11-26); the one-time bootstrap function and its secret were deleted afterwards.
1c. ~~Android download~~ ✅ repository variable set, first release published (`android-v0.1.0-4`, test-signed), repository made public (2026-11-26) so the website's Download page shows the APK, and the four `ANDROID_KEYSTORE_*` secrets installed (4096-bit RSA upload key, valid to 2054; the values live only in the owner's copy of `.env.android-signing`). Builds from now on are signed with the Friendzy upload key — phones with the test-signed build must uninstall once.
2. ~~Deploy Edge Functions~~ ✅ all seven deployed with LiveKit, SITE_URL, push and RevenueCat secrets. Still to add (owner, dashboard → Edge Functions → Secrets): `RESEND_API_KEY` + `SEND_EMAIL_HOOK_SECRET` (then enable the Send Email hook). ~~RevenueCat webhook registration~~ ✅ URL entered in RevenueCat with the `REVENUECAT_WEBHOOK_AUTH` header; the owner reports the test delivery as successful (2026-11-26). Rotate the LiveKit API key pair that was shared in chat and update `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`.
2b. Register `https://gwdpsrjmfrgcloacvdlg.supabase.co/functions/v1/livekit-webhook` on the LiveKit project (after `supabase functions deploy livekit-webhook --no-verify-jwt`): `lk cloud auth --user-auth` then `lk project webhook create … --signing-key <LIVEKIT_API_KEY id> --user-auth`, or `npm run livekit:webhook:register`, or the dashboard. Then `npm run livekit:webhook:test` to confirm it is active. Registration needs a signed-in LiveKit user; the API key cannot do it.
3. ~~Supabase Auth redirect URLs~~ ✅ · ~~Database Webhooks for push~~ ✅ replaced by migration 0014 (pg_net + Vault). Open: custom SMTP for auth emails (the built-in mailer allows only a few emails per hour).
4. RevenueCat: entitlement `friendzy_premium`, offering `default` with `$rc_monthly` → `friendzy_premium_monthly`, `$rc_annual` → `friendzy_premium_yearly`, consumables with the coin SKUs, webhook → `revenuecat-webhook` with `REVENUECAT_WEBHOOK_AUTH`; public SDK keys in `.env.local` / EAS.
5. EAS project id (push notifications + builds); FCM / APNs credentials via `eas credentials`.
6. Resend API key + verified domain for production email.
7. Decide the web card-payment provider (Paddle is a candidate, not assumed) — then set `web_billing_provider` and add the adapter.
8. Enable payouts only when a payout provider and identity verification process exist (`payouts_enabled`, super admin only).
