# Friendzy — Feature Checklist

Status legend: ✅ done & tested · 🧪 built, needs live verification · 🔑 blocked on credentials/config · ⏳ not built

"Done & tested" for the database means every table, policy and RPC passed the SQL test-suite (`npm run db:test`, 10 suites, 105 tables with RLS)
against a local PostgreSQL that mimics Supabase. "Needs live verification" means the UI and backend exist and typecheck, but could not be
exercised end-to-end from the build sandbox (no device / camera / store, and the migrations are applied by the project owner).

## Database & server (all phases)

| Item | Status | Notes |
| --- | --- | --- |
| 12 migrations `supabase/migrations/20261125000001…0012` (foundation, social, messaging, calls, videos, economy, live, games, subscriptions, admin, LiveKit webhooks, hardening) | ✅ 0001–0011 applied on the live project · 0012 to run | combined hand-off file: `supabase/FRIENDZY_ALL_MIGRATIONS.sql` |
| SQL tests `supabase/tests/0001…0012` + RLS-on-every-table check | ✅ | `npm run db:test` |
| GitHub Actions (`ci.yml`: typecheck/lint/tests/SQL suite/web export · `supabase-deploy.yml`: migrations + functions) and Netlify build (`netlify.toml` + generated redirects, `404.html`) | 🧪 | first run happens after the repo is pushed; deploy workflow needs three repository secrets |
| Edge Functions: `send-email`, `livekit-token`, `game-engine`, `revenuecat-webhook`, `push-dispatch`, `admin-actions`, `livekit-webhook` | 🧪 | deploy with `npm run functions:deploy`; secrets per `supabase/.env.example` |
| LiveKit webhook: SDK signature verification, idempotent storage (`livekit_webhook_events`), live/call lifecycle sync, recordings (`livekit_egresses`) | ✅ handler + DB tested locally · 🔑 deploy pending approval | Jest covers request handling and real SDK verification; SQL suite covers side effects, retries, RLS |
| LiveKit webhook registration & verification tool (`scripts/livekit-webhook.mjs`: `status` / `register` / `test`) | ✅ tool · 🔑 registration needs a LiveKit user session (`lk cloud auth --user-auth`), not the API key | API key/secret verified against the LiveKit API (ListRooms OK); endpoint currently answers 404 (function not deployed) |
| Shared game engines (Ludo, Chess via chess.js, Trivia/WYR/Guess-the-song rounds, Truth or Dare) | ✅ | `supabase/functions/_shared/games`, reused by the app for legal-move previews |

## Phase 1 — Foundation
| Area | Item | Status |
| --- | --- | --- |
| Project | Expo SDK 58 + Expo Router + TypeScript, design system, light/dark + Premium accents, responsive web (static export, Netlify config) | ✅ |
| Auth | Register (16+), verify email, sign in/out, forgot/reset password, change email/password, sessions, delete account | 🧪 |
| Email | Branded Resend templates via Send-Email hook | 🔑 `RESEND_API_KEY` |
| Onboarding | 7 steps, resumable | 🧪 |
| Profiles | Profile pages, edit, follow/friend/block/report, privacy settings, discover, presence | 🧪 |
| Notifications | In-app centre (realtime) · Push via Expo (device registration + `push-dispatch`) | 🧪 / 🔑 EAS project id + Database Webhooks |

## Phase 2 — Social networking
| Item | Status |
| --- | --- |
| Feeds: For you / Following / Nearby / Trending; posts (text, photo, video, carousel, poll, question, share); comments & replies; reactions; reposts; saves; hide / not interested | 🧪 |
| Stories (24 h, viewers, reactions, highlights, archive, privacy) | 🧪 |
| Search (people, posts, hashtags, videos), trending topics (admin-pinned + organic) | 🧪 |
| Random match, nearby (approximate location), interests-based suggestions | 🧪 |

## Phase 3 — Messaging
| Item | Status |
| --- | --- |
| 1:1 & group chats, attachments, voice notes, GIFs (🔑 Tenor key), stickers, replies, edit/delete, reactions, forward, star, pin, search, read receipts, typing, archive/mute/pin/unread, disappearing messages, wallpapers, message requests, invite links | 🧪 |
| End-to-end encryption | ⏳ not claimed — architecture note in ARCHITECTURE.md |

## Phase 4 — Communication
| Item | Status |
| --- | --- |
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
| Games lobby (public/private rooms, codes, invites, ready, chat), server-authoritative engine, Ludo, Chess, Trivia, Would You Rather, Truth or Dare, Guess the Song, leaderboards, rematch | 🧪 (Guess the Song needs ≥4 sounds in the library) |
| Wallet: coin balance, packages, transactions, gifts sent/received, realtime | 🧪 |
| Coin purchases via RevenueCat (native) → webhook → ledger | 🔑 RevenueCat SDK keys, products, webhook auth |
| Gifts (14 + admin-managed catalogue), 30 % commission, adult-only, premium-only gifts, creator earnings, top supporters | ✅ DB / 🧪 UI |
| Withdrawals (requests, cancel, admin approve/pay/reject through the ledger) | 🔑 `payouts_enabled` is off until a payout provider + identity checks exist |
| Premium (`friendzy_premium`, `$rc_monthly`/`$rc_annual`), perks: premium gifts, profile viewers, who liked you, advanced search, accent themes | 🧪 / 🔑 RevenueCat |
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
- `npm test` — 33 unit tests pass.
- `npm run web:export` — static site builds.

## Open configuration items (owner action required)
1. ~~Run the migrations~~ ✅ applied 2026-11-25 (0001–0011, verified via the public API). Still to do: run `supabase/migrations/20261125000012_hardening.sql` once, then the one-time `supabase migration repair --status applied …` from docs/SETUP.md §3 so `db push` never replays the files.
1b. Push the repository to GitHub and connect it to Netlify (docs/SETUP.md §10); set the `EXPO_PUBLIC_*` variables in Netlify; put the Netlify URL into Supabase Auth; sign up; `select public.bootstrap_first_admin('you@example.com');`.
2. Deploy Edge Functions and set secrets (`supabase/.env.example`) — locally with `npm run functions:deploy`, or add `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_ID` / `SUPABASE_DB_PASSWORD` to GitHub so `.github/workflows/supabase-deploy.yml` does it. Rotate the LiveKit API key pair that was shared in chat once the webhook is confirmed.
2b. Register `https://gwdpsrjmfrgcloacvdlg.supabase.co/functions/v1/livekit-webhook` on the LiveKit project (after `supabase functions deploy livekit-webhook --no-verify-jwt`): `lk cloud auth --user-auth` then `lk project webhook create … --signing-key <LIVEKIT_API_KEY id> --user-auth`, or `npm run livekit:webhook:register`, or the dashboard. Then `npm run livekit:webhook:test` to confirm it is active. Registration needs a signed-in LiveKit user; the API key cannot do it.
3. Supabase Auth: redirect URLs; Database Webhooks for `notifications` and `messages` → `push-dispatch` (header `x-webhook-secret`).
4. RevenueCat: entitlement `friendzy_premium`, offering `default` with `$rc_monthly` → `friendzy_premium_monthly`, `$rc_annual` → `friendzy_premium_yearly`, consumables with the coin SKUs, webhook → `revenuecat-webhook` with `REVENUECAT_WEBHOOK_AUTH`; public SDK keys in `.env.local` / EAS.
5. EAS project id (push notifications + builds); FCM / APNs credentials via `eas credentials`.
6. Resend API key + verified domain for production email.
7. Decide the web card-payment provider (Paddle is a candidate, not assumed) — then set `web_billing_provider` and add the adapter.
8. Enable payouts only when a payout provider and identity verification process exist (`payouts_enabled`, super admin only).
