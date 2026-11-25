#!/usr/bin/env node
/**
 * Friendzy — web build preflight (runs before `expo export --platform web`)
 *
 *   node scripts/prepare-web-build.mjs [--strict]
 *
 * 1. Verifies the public configuration that Expo inlines into the bundle:
 *      EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, EXPO_PUBLIC_LIVEKIT_URL
 *    - exact names (misspellings and missing prefixes are pointed out),
 *    - sane shapes (Supabase URL, anon-key role + project match, wss:// LiveKit URL),
 *    - the anon key is accepted by the Supabase project (one live request),
 *    - no server secret is about to ship as EXPO_PUBLIC_*.
 *    In strict mode (--strict, automatic on Netlify) any problem fails the build with a
 *    message naming the variable, instead of publishing a site that only shows the
 *    "configuration required" screen.
 * 2. Clears Metro's transform cache so changed EXPO_PUBLIC_* values are always re-inlined
 *    (Netlify restores node_modules/.cache between builds).
 *
 * Reads the same .env files Expo CLI reads (process.env wins), so local runs match.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict') || process.env.NETLIFY === 'true';
const onNetlify = process.env.NETLIFY === 'true';

// --- .env files, Expo CLI order (later files never override earlier ones or process.env)
const nodeEnv = process.env.NODE_ENV || 'production';
for (const name of [`.env.${nodeEnv}.local`, '.env.local', `.env.${nodeEnv}`, '.env']) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const problems = [];
const warnings = [];
const info = [];
const mask = (v) => (!v ? '(empty)' : v.length <= 14 ? `${v.slice(0, 3)}… (${v.length} chars)` : `${v.slice(0, 8)}…${v.slice(-4)} (${v.length} chars)`);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const REQUIRED = [
  { name: 'EXPO_PUBLIC_SUPABASE_URL', core: ['supabaseurl'] },
  { name: 'EXPO_PUBLIC_SUPABASE_ANON_KEY', core: ['anonkey', 'anon', 'publishable'] },
  { name: 'EXPO_PUBLIC_LIVEKIT_URL', core: ['livekiturl', 'livekit'] },
];

const allKeys = Object.keys(process.env);
for (const { name, core } of REQUIRED) {
  const value = (process.env[name] ?? '').trim();
  if (value) continue;
  const lookalikes = allKeys.filter((k) => k !== name && (norm(k) === norm(name) || core.some((c) => norm(k).includes(c)))).filter((k) => !/SECRET|SERVICE_ROLE|PASSWORD/i.test(k));
  const hint = lookalikes.length ? ` — found ${lookalikes.map((k) => `"${k}"`).join(', ')}: the name must be exactly ${name}` : onNetlify ? ' — add it under Project configuration → Environment variables (scope: all deploy contexts, Builds) and redeploy' : '';
  problems.push(`${name} is missing or empty${hint}`);
}

// --- Supabase URL
const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/$/, '');
let projectRef = null;
if (supabaseUrl) {
  try {
    const u = new URL(supabaseUrl);
    if (u.protocol !== 'https:') problems.push(`EXPO_PUBLIC_SUPABASE_URL must start with https:// (got "${supabaseUrl}")`);
    const m = /^([a-z0-9]{20})\.supabase\.(co|in|red)$/.exec(u.host);
    if (m) projectRef = m[1];
    else warnings.push(`EXPO_PUBLIC_SUPABASE_URL "${u.host}" is not a *.supabase.co host — fine for a custom domain, otherwise check it`);
    if (u.pathname !== '/' && u.pathname !== '') problems.push(`EXPO_PUBLIC_SUPABASE_URL must be the project root (no path), got "${supabaseUrl}"`);
  } catch {
    problems.push(`EXPO_PUBLIC_SUPABASE_URL is not a valid URL: "${supabaseUrl}"`);
  }
}

// --- anon key: shape, role, project, and acceptance by the project
const anonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
if (anonKey) {
  if (/^sb_secret_/.test(anonKey)) {
    problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY holds a SECRET key (sb_secret_…). Never ship it. Use the anon / publishable key from Project Settings → API');
  } else if (/^eyJ/.test(anonKey)) {
    try {
      const b64 = anonKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
      if (payload.role === 'service_role') problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY holds the SERVICE ROLE key. Never ship it. Use the anon key');
      else if (payload.role !== 'anon') warnings.push(`EXPO_PUBLIC_SUPABASE_ANON_KEY has role "${payload.role}" (expected "anon")`);
      if (projectRef && payload.ref && payload.ref !== projectRef) problems.push(`EXPO_PUBLIC_SUPABASE_ANON_KEY belongs to project "${payload.ref}" but EXPO_PUBLIC_SUPABASE_URL points at "${projectRef}"`);
      if (payload.exp && payload.exp * 1000 < Date.now()) problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is expired');
    } catch {
      problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY looks like a JWT but cannot be decoded — probably truncated or has a typo');
    }
  } else if (!/^sb_publishable_/.test(anonKey)) {
    warnings.push(`EXPO_PUBLIC_SUPABASE_ANON_KEY has an unexpected format (${mask(anonKey)}); expected eyJ… or sb_publishable_…`);
  }
  if (supabaseUrl && !problems.some((p) => p.includes('ANON_KEY'))) {
    try {
      const res = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: anonKey }, signal: AbortSignal.timeout(12_000) });
      if (res.status === 200) info.push('Supabase accepted the anon key');
      else if (res.status === 401 || res.status === 403) problems.push(`Supabase rejected EXPO_PUBLIC_SUPABASE_ANON_KEY (HTTP ${res.status}) — copy it again from Project Settings → API`);
      else warnings.push(`Supabase answered HTTP ${res.status} to the key check (not a key problem, continuing)`);
    } catch (error) {
      warnings.push(`Could not reach Supabase to validate the key (${error instanceof Error ? error.message : String(error)}); continuing`);
    }
  }
}

// --- LiveKit URL
const liveKitUrl = (process.env.EXPO_PUBLIC_LIVEKIT_URL ?? '').trim();
if (liveKitUrl && !/^wss?:\/\/[^\s/]+\/?$/.test(liveKitUrl)) problems.push(`EXPO_PUBLIC_LIVEKIT_URL must look like wss://<project>.livekit.cloud (got "${liveKitUrl}")`);

// --- never ship a secret as EXPO_PUBLIC_*
for (const key of allKeys.filter((k) => k.startsWith('EXPO_PUBLIC_'))) {
  if (/SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|ACCESS_TOKEN|WEBHOOK_AUTH/i.test(key)) problems.push(`${key} would be bundled into the public website — EXPO_PUBLIC_* must never carry secrets`);
}

// --- site URL (share links, auth redirects)
const siteUrl = (process.env.EXPO_PUBLIC_SITE_URL ?? '').trim();
if (siteUrl) {
  if (!/^https?:\/\//.test(siteUrl)) problems.push(`EXPO_PUBLIC_SITE_URL must start with http(s):// (got "${siteUrl}")`);
  else if (onNetlify && siteUrl.startsWith('http://')) warnings.push(`EXPO_PUBLIC_SITE_URL is http:// (${siteUrl}) — production links should be https://`);
}

// --- Metro cache: stale transforms would keep old inlined values
const metroCache = path.join(root, 'node_modules', '.cache', 'metro');
if (fs.existsSync(metroCache)) {
  fs.rmSync(metroCache, { recursive: true, force: true });
  info.push('cleared stale Metro cache (node_modules/.cache/metro)');
}

// --- report
console.log(`Web build preflight${strict ? ' (strict)' : ''}${onNetlify ? ` · Netlify ${process.env.CONTEXT ?? ''} · ${process.env.DEPLOY_PRIME_URL ?? process.env.URL ?? ''}` : ''}`);
console.log(`  EXPO_PUBLIC_SUPABASE_URL       ${supabaseUrl || '(empty)'}`);
console.log(`  EXPO_PUBLIC_SUPABASE_ANON_KEY  ${mask(anonKey)}`);
console.log(`  EXPO_PUBLIC_LIVEKIT_URL        ${liveKitUrl || '(empty)'}`);
console.log(`  EXPO_PUBLIC_SITE_URL           ${siteUrl || '(unset → Expo default / Netlify deploy URL)'}`);
for (const line of info) console.log(`  • ${line}`);
for (const line of warnings) console.log(`  ! ${line}`);
for (const line of problems) console.log(`  ✖ ${line}`);

if (problems.length > 0 && strict) {
  console.error(`\n✖ Web build aborted: ${problems.length} configuration problem(s). Fix the variable(s) above${onNetlify ? ' in Netlify → Project configuration → Environment variables, then "Trigger deploy"' : ''}.`);
  process.exit(1);
}
if (problems.length > 0) console.log(`\n! ${problems.length} problem(s) — the export continues because this is not a strict run; the site would show the configuration screen.`);
else console.log('\n✔ Public configuration looks good.');
