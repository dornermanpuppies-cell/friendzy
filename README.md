# Friendzy

**Meet. Connect. Play. Earn.** — a worldwide social networking and entertainment platform.
One codebase (Expo + Expo Router + TypeScript) for the responsive website, Android and iOS, backed by a
single Supabase project. Website hosted on Netlify from this GitHub repository.

## What is here
Feeds and posts, stories, messaging (chats, groups, voice notes, calls on LiveKit), short videos with a
creator studio, livestreaming with gifts, stage guests, battles and fan clubs, six multiplayer games with a
server-authoritative engine, wallet / coins / creator earnings on an auditable ledger, Premium (RevenueCat),
and a full administration dashboard. Per-feature status: `docs/CHECKLIST.md`.

## Quick start
```bash
npm install
cp .env.example .env.local        # public values only: Supabase URL + anon key, LiveKit URL
npm run web                       # website at http://localhost:8081
npm run start                     # Expo dev server (use a development build for native modules)
npm run typecheck && npm run lint && npm test && npm run db:test
```

## Scripts
| Command | Purpose |
| --- | --- |
| `npm run db:test` | boots an embedded PostgreSQL, applies all migrations, runs the SQL test-suite |
| `npm run db:combine` | regenerates `supabase/FRIENDZY_ALL_MIGRATIONS.sql` (one file for the SQL editor) |
| `npm run web:export` | static web build into `dist/` (what Netlify runs, plus `scripts/netlify-redirects.mjs`) |
| `npm run functions:deploy` | deploys all Edge Functions with the right JWT settings |
| `npm run livekit:webhook:test` | checks the deployed LiveKit webhook end to end |

## Hosting & delivery
- **GitHub Actions**: `CI` (typecheck, lint, unit tests, SQL suite, web export) on every push and pull request;
  `Supabase deploy` (migrations + Edge Functions) on pushes to `main` once the repository secrets exist.
- **Netlify**: builds from `netlify.toml` (`dist`, Node 22). Environment variables are the `EXPO_PUBLIC_*` values only.
- **Supabase**: schema in `supabase/migrations`, Edge Functions in `supabase/functions`, secrets never in the repo.
- **Mobile**: EAS profiles in `eas.json`.

Step-by-step: `docs/SETUP.md`.

## Documentation
- `docs/SETUP.md` — database, first admin, Edge Functions, auth URLs, RevenueCat, LiveKit, hosting on Netlify + GitHub
- `docs/CONFIGURATION.md` — every credential, where it lives, what it unlocks
- `docs/ARCHITECTURE.md` — stack, layout, security model, economy, live, games, video
- `docs/CHECKLIST.md` — feature checklist with status and open owner actions

## Project layout
```
src/app          Expo Router routes (web + native)
src/components   design system (ui/) and layout shells (layout/)
src/features     feature components (feed, stories, chat, calls, video, live, games, economy, premium, admin, …)
src/services     typed Supabase data access and Edge Function calls
src/store        zustand stores
src/theme        tokens + ThemeProvider
supabase/        migrations, SQL tests, Edge Functions (+ _shared engines), CLI config
scripts/         db test harness, SQL combiner, Netlify redirects, LiveKit webhook tool
```

## Security notes
- Only `EXPO_PUBLIC_*` values are bundled into clients. Secrets live in Supabase Edge Function secrets.
- Every table is protected by Row Level Security; privileged mutations go through server-side functions.
- Admin roles are granted in SQL / by a super admin (`public.admin_roles`), never from the client.
- Messages are protected by RLS and signed URLs; they are not end-to-end encrypted and the app does not claim so.
