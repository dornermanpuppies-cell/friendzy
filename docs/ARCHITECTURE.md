# Friendzy — Architecture

## Stack
- **Client**: Expo SDK 58 (React Native 0.88, React 19, React Compiler), Expo Router (file-based routes in `src/app`), TypeScript, react-native-web
  for the responsive website (static export). One codebase for web, Android and iOS.
- **Backend**: Supabase — Postgres (RLS on every table), Auth, Storage, Realtime, Edge Functions (Deno).
- **Realtime media**: LiveKit (calls, livestreams). **Email**: Resend via Supabase auth hook. **Push**: Expo Push.
- **Billing**: RevenueCat on mobile (Premium subscription + coin consumables) → webhook → ledger; web card payments behind a provider flag.

## Project layout
```
src/app/                        routes (Expo Router)
  (auth)/, auth/, onboarding/   sign-in/up, deep-link targets, onboarding
  (app)/                        authenticated shell (+ desktop sidebar)
    (tabs)/                     home (posts + short videos), discover, create, live, profile
    videos, video/[id], sound/[id], compose/video, studio, playlist/[id], challenge/[tag], challenges
    live/go, live/[id]          go live, live room (host & viewer)
    games, games/room/[id], games/leaderboard/[game]
    wallet, wallet/earnings, premium, premium/viewers, premium/admirers
    chat/*, call/[id], calls, inbox, notifications, search, people/*, match, u/[username], tag/[tag]
    settings/* (incl. verification), admin/* (dashboard)
  (marketing)/                  public website pages
src/features/*                  feature components (feed, stories, chat, calls, video, live, games, economy, premium, profile, admin, site)
src/services/*                  typed data access (Supabase RPCs, storage uploads, Edge Function calls)
src/store/*                     zustand stores (auth, chat, posts, videos, badges)
src/lib/*                       env, supabase client, secure storage, LiveKit adapters (native/web), RevenueCat adapters (native/web)
src/theme/*                     tokens + ThemeProvider (light/dark, per-screen ThemeScope, Premium accents)
supabase/migrations             13 SQL migrations (schema, RLS, RPCs, triggers, seeds)
supabase/tests                  SQL test-suite (run by scripts/db-test.mjs on embedded PostgreSQL)
supabase/functions              Edge Functions + _shared/games (pure TypeScript engines shared with the app)
```

## Security model
- Clients use the anon key + user JWT; every table has RLS and column-level grants. Sensitive columns (counters, `account_status`,
  `is_verified`, wallet balances, game state) are never client-writable.
- All mutations with business rules run in `security definer` RPCs that validate blocks, privacy, ownership, age (18+ for gifting/hosting),
  slow mode, sanctions, etc. A single `guard_active_account` trigger blocks suspended accounts and feature restrictions on every content table.
- Admin roles live in `admin_roles` (never writable by clients); every admin RPC checks `has_admin_role()` and writes `admin_audit_logs`.
  The first super admin is created with `bootstrap_first_admin()` from the SQL editor / service role only.
- Secrets (LiveKit, Resend, RevenueCat, push) exist only in Edge Function secrets. Tokens for media rooms are minted server-side per request.
- Messages are protected by RLS and signed URLs; they are **not** end-to-end encrypted and the UI never claims so. (A client-side key
  exchange could be layered later: attachments already go through per-conversation private paths.)

## Economy (append-only ledger)
`wallets` are mutated only by `ledger_apply` (row locks, idempotency keys). Coin purchases, gifts (30 % commission, net to creator earnings),
withdrawals (hold → paid / refund) and admin adjustments are all ledger rows in `wallet_transactions`. Premium status is derived from
`subscriptions`, synced from RevenueCat webhooks (idempotent per event id). Withdrawals stay disabled (`payouts_enabled=false`) until a payout
provider and identity verification exist.

## Live & calls
`livekit-token` checks the caller's call participation or live visibility/stage status and issues publish/subscribe grants; the app
re-mints when a viewer is approved on stage. Lives use realtime on `live_sessions`, `live_comments`, `live_participants`,
`live_gift_events`, `live_battles`; viewer counts rely on heartbeats; battles are scored by gift coins.

`livekit-webhook` closes the loop from the media server: LiveKit's signed events (verified with the server SDK) are stored once per
event id in `livekit_webhook_events` and applied by `livekit_ingest_event()` — room SIDs, host/viewer presence, disconnected call
participants, rooms that finish (ending the live or cancelling a ringing call) and egress/recording status in `livekit_egresses`.
Failed processing keeps the row unprocessed and answers 500 so LiveKit retries; duplicates answer 200 immediately.

## Games
`game-engine` is the only writer of `game_rooms.state` (optimistic version lock, timeouts applied by any online client via `tick`).
Engines are pure TypeScript shared with the app (`supabase/functions/_shared/games`); answer keys live under `state.secret`, which
`game_room_json` strips before it reaches clients. Results, ratings and leaderboards are written by `apply_game_results` (service role).

## Video
Uploads go to the `videos` bucket with a replaceable media layer (`videos.provider` = `supabase` today, `cloudflare` later). Editing
decisions (trim, speed, filter, overlays, sound mix, duet/stitch) are stored as metadata and applied at playback time, so publishing needs
no server transcoding.

## Realtime & notifications
In-app notifications are rows in `notifications` (preferences respected by `create_notification`). Push delivery is triggered by Database
Webhooks calling `push-dispatch`, which reads `user_devices` tokens registered by the app.

## Static web
`web.output = "static"` pre-renders every route for SEO; app routes hydrate client-side and dark surfaces (chat, video, live) use `ThemeScope`.
