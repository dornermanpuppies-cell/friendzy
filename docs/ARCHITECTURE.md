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
- **Chat messages are end-to-end encrypted** (migration `0015_e2ee`, client code in `src/lib/e2ee/`). Each app installation
  generates an X25519 identity key and an Ed25519 signing key; only the public halves are registered in `e2ee_devices`
  (max 10 active devices per user, revocable in Settings). A message is encrypted on the sender's device with a fresh random key
  (XChaCha20-Poly1305 with AAD = conversation id + kind + sender device), that key is wrapped for every device of every member
  (X25519 with an ephemeral key + HKDF-SHA256, AEAD with the device id as AAD) and the whole envelope is signed by the sending
  device over a transcript that includes the conversation and kind, so the server cannot move, re-key or replay it elsewhere.
  The server stores the envelope in `messages.envelope`, checks only its shape and that the wrapped keys match *exactly* the
  current devices of the current members (`e2ee_validate_envelope`: STALE_RECIPIENTS / RECIPIENT_WITHOUT_KEYS), and the plaintext
  RPCs (`send_message`, `edit_message`, `forward_messages`) are no longer executable by clients — there is no plaintext fallback.
  Attachments are encrypted on the device in 1 MiB chunks (format `FZE1`, truncation-safe) and uploaded as opaque
  `application/octet-stream` objects; names, MIME types, dimensions, waveforms and the per-file keys travel inside the envelope.
  Edits re-seal; forwards decrypt locally and send a new sealed message; story replies are sealed too. Push notifications for
  sealed messages only say "New message" (`webhook_record` strips the envelope before pg_net). Reports of sealed messages carry
  the text decrypted by the reporter so moderators can act.
  **Limits (also shown in-app under Settings → Chats → End-to-end encryption):** metadata (who/when/kind/sizes/reactions/receipts)
  is visible to the service; no forward secrecy or ratchet (a stolen device key opens the messages sealed for that device);
  trust on first use with 60-digit security codes and "security code changed / new device" notices; a new device cannot read
  messages sent before it was added; server-generated system notices and call logs are plaintext; calls, lives, games, posts and
  stories are TLS-only; decrypted media is cached in app-private storage; keys live in the keychain (native) or IndexedDB wrapped
  with a non-extractable WebCrypto key (web). Messages from before 0015 remain readable as they were and are marked without a lock.

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
The version lock protects turn-based games (chess, ludo, truth or dare). Simultaneous-answer games (trivia, would you
rather, guess the song) mark their `answer` move as *concurrent* (`GameEngine.concurrent`): the function skips the
version check for it, lets the engine validate phase/duplicates, and retries the write on the fresh row if two answers
collide — so the second player to answer within the same second never loses the tap (that bug cost guests their points
until 2026-11-26). The app treats a `STALE` reply as "refresh the board", never as an error toast.

**Web static export and hydration.** Public pages are pre-rendered. Anything that renders differently on the server and
in the browser must go through `useHydrated()` (`src/hooks/useHydrated.ts`); the app-wide `Ionicons` wrapper
(`src/components/ui/Ionicons.tsx`) does this because the icon font is not available during pre-rendering.
`npm run qa:hydration -- /about /download` diffs the server HTML against the browser DOM when a React #418 shows up.

**Chat background and the archive.** `conversation_members.wallpaper` holds either a preset id or
`img:<path>` into the private `wallpapers` bucket, where each person can only read their own folder;
`user_settings.chat_wallpaper` is the account-wide default a chat falls back to. A wallpaper is personal,
never shared with the other side. Archiving follows the behaviour people know from WhatsApp: since 0019
`touch_conversation` leaves an archived chat archived unless that member turned `keep_chats_archived` off,
`get_archived_summary()` feeds the single Archived row at the top of the inbox, and push-dispatch skips
message pushes for chats the recipient keeps archived.

**LIVE.** `game-engine`-style separation also applies to broadcasts: `live_sessions` and everything around
it (stage, battles, gifts, fan clubs, moderation in migration 0007; goals, Q&A, supporter ranking and host
word filters in 0018) are written only through SECURITY DEFINER functions, with clients holding SELECT behind
`can_view_live()`. Goal progress is driven server-side from `on_live_gift_apply` and `like_live`, so a client
cannot move the bar on its own. Hosting a broadcast, joining the stage and sending gifts all require
`is_adult()` — the platform treats 18 as the floor for those, which is what the European rules expect.

**Scrolling inside gesture rows.** A `GestureDetector` sets `touch-action: none` on its view by default,
which stops a finger drag that starts on that view from scrolling the list around it in a mobile browser.
Any gesture placed inside a scrollable list must pass the axis it does not own — message rows use
`touchAction="pan-y"` so the browser keeps vertical scrolling and the gesture keeps the horizontal
swipe-to-reply. `npm run qa:scroll-audit` walks the main screens and fails when a list has no scroll
container, when something inside it blocks touch panning, or when the page scrolls behind the fixed chrome.
Engines are pure TypeScript shared with the app (`supabase/functions/_shared/games`); answer keys live under `state.secret`, which
`game_room_json` strips before it reaches clients. Results, ratings and leaderboards are written by `apply_game_results` (service role).

## Video
Uploads go to the `videos` bucket with a replaceable media layer (`videos.provider` = `supabase` today, `cloudflare` later). Editing
decisions (trim, speed, filter, overlays, sound mix, duet/stitch) are stored as metadata and applied at playback time, so publishing needs
no server transcoding.

## Realtime & notifications
- One realtime channel per listener: `privateChannel()` in `src/lib/realtime.ts` gives every `postgres_changes` subscription a
  unique topic (supabase-js reuses channel instances by topic and throws when a second screen adds listeners to a channel that is
  already subscribed). Only typing indicators share a topic (`acquireBroadcastChannel`, reference counted).
In-app notifications are rows in `notifications` (preferences respected by `create_notification`). Push delivery is triggered by Database
Webhooks calling `push-dispatch`, which reads `user_devices` tokens registered by the app.

## Static web
`web.output = "static"` pre-renders every route for SEO; app routes hydrate client-side and dark surfaces (chat, video, live) use `ThemeScope`.
