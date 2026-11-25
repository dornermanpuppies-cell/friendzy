#!/usr/bin/env node
/**
 * Friendzy — public-config preflight (runs before `expo export --platform web` and the Android build)
 *
 *   node scripts/prepare-web-build.mjs [--strict] [--target web|android]
 *
 * 1. Verifies the public configuration that Expo inlines into the bundle:
 *      EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, EXPO_PUBLIC_LIVEKIT_URL
 *    - exact names (misspellings and missing prefixes are pointed out),
 *    - the usual paste mistakes are repaired instead of failing: wrapping quotes, stray whitespace,
 *      a missing https:// or wss://, a trailing slash. Repaired values are written to .build-env.sh
 *      so the build command can source them (Netlify) or append them to $GITHUB_ENV (GitHub
 *      Actions); each repair is reported,
 *    - sane shapes (Supabase URL, anon-key role + project match, wss:// LiveKit URL),
 *    - the anon key is accepted by the Supabase project (one live request),
 *    - no server secret is about to ship as EXPO_PUBLIC_*.
 *    In strict mode (--strict, automatic on Netlify) any remaining problem fails the build with a
 *    message naming the variable and the exact value to enter, instead of publishing a site that
 *    only shows the "configuration required" screen. Values are also described by their *shape*
 *    (length, scheme, quotes…) because Netlify prints variables marked "secret" as ****.
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
const onGitHub = process.env.GITHUB_ACTIONS === 'true';
const targetArg = process.argv.indexOf('--target');
const target = targetArg > -1 ? process.argv[targetArg + 1] : 'web';
const label = target === 'android' ? 'Android' : 'Web';
const whereToSet = onNetlify
  ? ' — add it under Project configuration → Environment variables (scope: all deploy contexts, Builds) and redeploy'
  : onGitHub
    ? ' — add it under Settings → Secrets and variables → Actions → Variables (repository variable) and re-run the workflow'
    : '';
const howToReenter = onNetlify
  ? 'Netlify → Project configuration → Environment variables → delete the variable → "Add a variable" → paste the value below, leave "Contains secret values" unticked → Deploys → "Trigger deploy" → "Clear cache and deploy site"'
  : onGitHub
    ? 'GitHub → Settings → Secrets and variables → Actions → Variables → edit the variable → paste the value below → re-run the workflow'
    : 'fix the value in .env.local (or the environment) and run again';

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
const repairs = [];
/** Final values that differ from what the environment holds → written to .build-env.sh. */
const repaired = {};
const mask = (v) => (!v ? '(empty)' : v.length <= 14 ? `${v.slice(0, 3)}… (${v.length} chars)` : `${v.slice(0, 8)}…${v.slice(-4)} (${v.length} chars)`);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// --- forgiving reads ---------------------------------------------------------
function stripQuotes(raw) {
  let s = String(raw ?? '').trim();
  for (let i = 0; i < 2; i += 1) {
    const m = /^(['"`])([\s\S]*)\1$/.exec(s);
    if (!m) break;
    s = m[2].trim();
  }
  return s;
}

/** Describes a value without printing it — the shape has to tell the story when the value is masked. */
function shape(v) {
  if (!v) return 'empty';
  const parts = [`${v.length} chars`];
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(v);
  parts.push(scheme ? `${scheme[1].toLowerCase()}://` : 'no scheme');
  if (/^["'`]|["'`]$/.test(v)) parts.push('quotes');
  if (/\s/.test(v)) parts.push('whitespace inside');
  if (/[<>]/.test(v)) parts.push('< > placeholder characters');
  if (/^\*+$/.test(v)) parts.push('asterisks only');
  if (/\.supabase\.(co|in|red)\b/i.test(v)) parts.push('supabase host');
  if (/\.livekit\.cloud\b/i.test(v)) parts.push('livekit host');
  return parts.join(' · ');
}

function readUrl(name, scheme) {
  const raw = process.env[name] ?? '';
  const stripped = stripQuotes(raw);
  const fixes = [];
  if (stripped && stripped !== raw.trim()) fixes.push('removed wrapping quotes');
  else if (raw && raw !== raw.trim()) fixes.push('trimmed whitespace');
  let value = stripped;
  if (value && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(value)) {
    value = `${scheme}://${value}`;
    fixes.push(`added ${scheme}://`);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\/.+\/+$/i.test(value)) {
    value = value.replace(/\/+$/, '');
    fixes.push('removed trailing slash');
  }
  if (fixes.length) repairs.push(`${name}: ${fixes.join(', ')}`);
  if (value && value !== raw) repaired[name] = value;
  return value;
}

const REQUIRED = [
  { name: 'EXPO_PUBLIC_SUPABASE_URL', core: ['supabaseurl'] },
  { name: 'EXPO_PUBLIC_SUPABASE_ANON_KEY', core: ['anonkey', 'anon', 'publishable'] },
  { name: 'EXPO_PUBLIC_LIVEKIT_URL', core: ['livekiturl', 'livekit'] },
];

const allKeys = Object.keys(process.env);
for (const { name, core } of REQUIRED) {
  if (stripQuotes(process.env[name])) continue;
  const lookalikes = allKeys.filter((k) => k !== name && (norm(k) === norm(name) || core.some((c) => norm(k).includes(c)))).filter((k) => !/SECRET|SERVICE_ROLE|PASSWORD/i.test(k));
  const hint = lookalikes.length ? ` — found ${lookalikes.map((k) => `"${k}"`).join(', ')}: the name must be exactly ${name}` : whereToSet;
  problems.push(`${name} is missing or empty${hint}`);
}

// --- anon key: quotes, shape, role, project (decoded first so the URL check can name the expected project)
const anonRaw = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const anonKey = stripQuotes(anonRaw);
if (anonKey && anonKey !== anonRaw) {
  repairs.push('EXPO_PUBLIC_SUPABASE_ANON_KEY: removed wrapping quotes / whitespace');
  repaired.EXPO_PUBLIC_SUPABASE_ANON_KEY = anonKey;
}
let jwt = null;
if (anonKey) {
  if (/^sb_secret_/.test(anonKey)) {
    problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY holds a SECRET key (sb_secret_…). Never ship it. Use the anon / publishable key from Project Settings → API keys');
  } else if (/^eyJ/.test(anonKey)) {
    try {
      const b64 = anonKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      jwt = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
      if (jwt.role === 'service_role') problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY holds the SERVICE ROLE key. Never ship it. Use the anon key');
      else if (jwt.role !== 'anon') warnings.push(`EXPO_PUBLIC_SUPABASE_ANON_KEY has role "${jwt.role}" (expected "anon")`);
      if (jwt.exp && jwt.exp * 1000 < Date.now()) problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is expired');
    } catch {
      problems.push(`EXPO_PUBLIC_SUPABASE_ANON_KEY looks like a JWT but cannot be decoded (${mask(anonKey)}) — probably truncated or has a typo; copy it again`);
    }
  } else if (!/^sb_publishable_/.test(anonKey)) {
    warnings.push(`EXPO_PUBLIC_SUPABASE_ANON_KEY has an unexpected format (${mask(anonKey)}); expected eyJ… or sb_publishable_…`);
  }
}
const expectedSupabaseUrl = jwt?.ref ? `https://${jwt.ref}.supabase.co` : 'https://<project-ref>.supabase.co';

// --- Supabase URL
const supabaseUrl = readUrl('EXPO_PUBLIC_SUPABASE_URL', 'https');
let projectRef = null;
let supabaseUrlOk = false;
if (supabaseUrl) {
  try {
    const u = new URL(supabaseUrl);
    supabaseUrlOk = true;
    if (u.protocol !== 'https:') problems.push(`EXPO_PUBLIC_SUPABASE_URL must start with https:// (got "${supabaseUrl}")`);
    const m = /^([a-z0-9]{20})\.supabase\.(co|in|red)$/.exec(u.host);
    if (m) projectRef = m[1];
    else warnings.push(`EXPO_PUBLIC_SUPABASE_URL "${u.host}" is not a *.supabase.co host — fine for a custom domain, otherwise check it`);
    if (u.pathname !== '/' && u.pathname !== '') problems.push(`EXPO_PUBLIC_SUPABASE_URL must be the project root (no path), got "${supabaseUrl}" — use ${expectedSupabaseUrl}`);
  } catch {
    problems.push(`EXPO_PUBLIC_SUPABASE_URL is not a valid URL: "${supabaseUrl}" [${shape(supabaseUrl)}] — it must be exactly ${expectedSupabaseUrl}${jwt?.ref ? ' (the project your anon key belongs to)' : ''}`);
  }
}
if (jwt?.ref && projectRef && jwt.ref !== projectRef) problems.push(`EXPO_PUBLIC_SUPABASE_ANON_KEY belongs to project "${jwt.ref}" but EXPO_PUBLIC_SUPABASE_URL points at "${projectRef}"`);

// --- the project must accept the key (one request; skipped when the URL or key is already known to be wrong)
if (anonKey && supabaseUrlOk && !problems.some((p) => p.includes('ANON_KEY') || p.includes('SUPABASE_URL'))) {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: anonKey }, signal: AbortSignal.timeout(12_000) });
    if (res.status === 200) info.push('Supabase accepted the anon key');
    else if (res.status === 401 || res.status === 403) problems.push(`Supabase rejected EXPO_PUBLIC_SUPABASE_ANON_KEY (HTTP ${res.status}) — copy it again from Project Settings → API keys`);
    else warnings.push(`Supabase answered HTTP ${res.status} to the key check (not a key problem, continuing)`);
  } catch (error) {
    warnings.push(`Could not reach Supabase to validate the key (${error instanceof Error ? error.message : String(error)}); continuing`);
  }
}

// --- LiveKit URL
const liveKitUrl = readUrl('EXPO_PUBLIC_LIVEKIT_URL', 'wss');
if (liveKitUrl && !/^wss?:\/\/[^\s/]+\/?$/.test(liveKitUrl)) {
  problems.push(`EXPO_PUBLIC_LIVEKIT_URL must look like wss://<project>.livekit.cloud (got "${liveKitUrl}" [${shape(liveKitUrl)}]) — copy the WebSocket URL from LiveKit Cloud → your project → Settings`);
}

// --- never ship a secret as EXPO_PUBLIC_*
for (const key of allKeys.filter((k) => k.startsWith('EXPO_PUBLIC_'))) {
  if (/SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|ACCESS_TOKEN|WEBHOOK_AUTH/i.test(key)) problems.push(`${key} would be bundled into the public website — EXPO_PUBLIC_* must never carry secrets`);
}

// --- site URL (share links, auth redirects)
const siteUrl = readUrl('EXPO_PUBLIC_SITE_URL', 'https');
if (siteUrl) {
  if (!/^https?:\/\//.test(siteUrl)) problems.push(`EXPO_PUBLIC_SITE_URL must start with http(s):// (got "${siteUrl}")`);
  else if (onNetlify && siteUrl.startsWith('http://')) warnings.push(`EXPO_PUBLIC_SITE_URL is http:// (${siteUrl}) — production links should be https://`);
}

// --- GitHub repository used by the Download page to find the latest Android APK release
const githubRepo = stripQuotes(process.env.EXPO_PUBLIC_GITHUB_REPO);
if (githubRepo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepo)) problems.push(`EXPO_PUBLIC_GITHUB_REPO must be "owner/repository" (got "${githubRepo}")`);

// --- repaired values for the build command (always written so sourcing never fails)
const envFile = path.join(root, '.build-env.sh');
const envLines = ['# generated by scripts/prepare-web-build.mjs — repaired public values for this build; not committed'];
for (const [key, value] of Object.entries(repaired)) envLines.push(`export ${key}='${value.replace(/'/g, `'\\''`)}'`);
fs.writeFileSync(envFile, `${envLines.join('\n')}\n`);
if (Object.keys(repaired).length) info.push(`wrote ${Object.keys(repaired).length} repaired value(s) to .build-env.sh (applied by the build command)`);

// --- Metro cache: stale transforms would keep old inlined values
const metroCache = path.join(root, 'node_modules', '.cache', 'metro');
if (fs.existsSync(metroCache)) {
  fs.rmSync(metroCache, { recursive: true, force: true });
  info.push('cleared stale Metro cache (node_modules/.cache/metro)');
}

// --- report
console.log(`${label} build preflight${strict ? ' (strict)' : ''}${onNetlify ? ` · Netlify ${process.env.CONTEXT ?? ''} · ${process.env.DEPLOY_PRIME_URL ?? process.env.URL ?? ''}` : onGitHub ? ` · GitHub Actions · ${process.env.GITHUB_REPOSITORY ?? ''}` : ''}`);
console.log(`  EXPO_PUBLIC_SUPABASE_URL       ${supabaseUrl || '(empty)'}   [${shape(supabaseUrl)}]`);
console.log(`  EXPO_PUBLIC_SUPABASE_ANON_KEY  ${mask(anonKey)}${jwt?.ref ? `   [project ${jwt.ref}]` : ''}`);
console.log(`  EXPO_PUBLIC_LIVEKIT_URL        ${liveKitUrl || '(empty)'}   [${shape(liveKitUrl)}]`);
console.log(`  EXPO_PUBLIC_SITE_URL           ${siteUrl || '(unset → Expo default / Netlify deploy URL)'}`);
console.log(`  EXPO_PUBLIC_GITHUB_REPO        ${githubRepo || '(unset → Download page cannot look up Android releases)'}`);
for (const line of repairs) console.log(`  • repaired ${line}`);
for (const line of info) console.log(`  • ${line}`);
for (const line of warnings) console.log(`  ! ${line}`);
for (const line of problems) console.log(`  ✖ ${line}`);

if (problems.length > 0 && strict) {
  console.error(`\n✖ ${label} build aborted: ${problems.length} configuration problem(s).`);
  const bad = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_LIVEKIT_URL'].filter((n) => problems.some((p) => p.includes(n)));
  if (bad.length > 0) {
    console.error(`\n  To fix — ${howToReenter}:`);
    for (const n of bad) {
      const value = n === 'EXPO_PUBLIC_SUPABASE_URL' ? expectedSupabaseUrl : n === 'EXPO_PUBLIC_LIVEKIT_URL' ? 'wss://<project>.livekit.cloud   (LiveKit Cloud → project → Settings → WebSocket URL)' : 'the anon key from Supabase → Project Settings → API keys';
      console.error(`    ${n} = ${value}`);
    }
    if (onNetlify) console.error('\n  A value printed as **** above means the variable is marked "Contains secret values": Netlify hides it in this log and in the UI, so the mistake cannot be seen. Delete it and add it again with that box unticked — these values are public by design.');
  } else {
    console.error(`  Fix the variable(s) above${onNetlify ? ' in Netlify → Project configuration → Environment variables, then "Trigger deploy"' : onGitHub ? ' in GitHub → Settings → Secrets and variables → Actions, then re-run the workflow' : ''}.`);
  }
  process.exit(1);
}
if (problems.length > 0) console.log(`\n! ${problems.length} problem(s) — the export continues because this is not a strict run; the site would show the configuration screen.`);
else console.log('\n✔ Public configuration looks good.');
