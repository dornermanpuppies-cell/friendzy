#!/usr/bin/env node
/**
 * Friendzy — live website verification (Netlify deploy)
 *
 *   node scripts/site-check.mjs https://<site>.netlify.app
 *   npm run site:check -- https://<site>.netlify.app
 *
 * Checks, from the outside only (no credentials needed):
 *   1. the home page is the Friendzy build (title/meta) served by Netlify with the security headers from netlify.toml
 *   2. the public config was baked in at build time (Supabase URL + anon key, LiveKit URL) — read from .env.local or the
 *      EXPO_PUBLIC_* environment — and the site URL inside the bundle matches the deployed origin (share links, auth redirects)
 *   3. dynamic routes (/u/:username, /post/:id, /video/:id, /live/:id, /chat/:id/info, …) resolve through dist/_redirects
 *   4. unknown paths get the custom 404 page with status 404
 *   5. public pages and the auth deep-link targets exist
 *   6. hashed bundles are cached immutably
 * Then it prints the exact Supabase Auth URL configuration for this origin.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const raw = arg || process.env.NETLIFY_SITE_URL || process.env.EXPO_PUBLIC_SITE_URL || '';
if (!raw) {
  console.error('Usage: node scripts/site-check.mjs https://<site>.netlify.app');
  process.exit(2);
}
let origin;
try {
  const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  origin = `${u.protocol}//${u.host}`;
} catch {
  console.error(`✖ "${raw}" is not a valid URL`);
  process.exit(2);
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i), line.slice(i + 1).trim().replace(/^"(.*)"$/, '$1')];
      }),
  );
}
const fileEnv = loadEnvFile(path.join(root, '.env.local'));
const expected = {
  supabaseUrl: (process.env.EXPO_PUBLIC_SUPABASE_URL || fileEnv.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, ''),
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || fileEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
  liveKitUrl: process.env.EXPO_PUBLIC_LIVEKIT_URL || fileEnv.EXPO_PUBLIC_LIVEKIT_URL || '',
};

const results = [];
const pass = (name, detail = '') => results.push({ ok: true, name, detail });
const fail = (name, detail = '') => results.push({ ok: false, name, detail });
const warn = (name, detail = '') => results.push({ ok: null, name, detail });

async function get(pathname, { redirect = 'manual' } = {}) {
  const url = pathname.startsWith('http') ? pathname : `${origin}${pathname}`;
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect, signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'friendzy-site-check' } });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, ms: Date.now() - started };
  } catch (error) {
    return { status: 0, headers: new Headers(), text: '', ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

const isFriendzyHtml = (html) => /<title>[^<]*Friendzy[^<]*<\/title>/i.test(html) || /Friendzy/.test(html.slice(0, 20_000));

console.log(`Checking ${origin}\n`);

// 1. Home page --------------------------------------------------------------
const home = await get('/');
if (home.status !== 200) {
  fail('Home page responds', home.error ? `${home.error}` : `HTTP ${home.status}`);
} else if (!isFriendzyHtml(home.text)) {
  const title = (/<title>([^<]*)<\/title>/i.exec(home.text) ?? [])[1] ?? '(no title)';
  fail('Home page is the Friendzy build', `this origin serves "${title}" — wrong site name? check the Netlify dashboard for the real address`);
} else {
  pass('Home page is the Friendzy build', `HTTP 200 in ${home.ms} ms`);
}
const server = home.headers.get('server') ?? '';
if (/netlify/i.test(server)) pass('Served by Netlify');
else warn('Served by Netlify', `server header: "${server || 'none'}"`);

const headerChecks = [
  ['x-frame-options', /DENY/i],
  ['x-content-type-options', /nosniff/i],
  ['referrer-policy', /strict-origin-when-cross-origin/i],
  ['permissions-policy', /camera=\(self\)/i],
];
const missing = headerChecks.filter(([h, re]) => !re.test(home.headers.get(h) ?? '')).map(([h]) => h);
if (missing.length === 0) pass('Security headers from netlify.toml applied');
else fail('Security headers from netlify.toml applied', `missing: ${missing.join(', ')} — netlify.toml was not picked up (wrong base directory?)`);

// 2. Build-time configuration ----------------------------------------------
const scripts = [...home.text.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).filter((s) => s.includes('/_expo/'));
let bundle = '';
for (const src of scripts) {
  const res = await get(src.startsWith('http') ? src : `${origin}${src.startsWith('/') ? '' : '/'}${src}`);
  if (res.status === 200) bundle += `\n${res.text}`;
}
if (scripts.length === 0) {
  fail('JavaScript bundle found', 'no /_expo/ script tags in the home page');
} else {
  pass('JavaScript bundle found', `${scripts.length} script(s), ${(bundle.length / 1024 / 1024).toFixed(1)} MB`);
  const check = (label, value, hint) => {
    if (!value) warn(label, 'expected value unknown locally (set it in .env.local to verify)');
    else if (bundle.includes(value)) pass(label);
    else fail(label, hint);
  };
  check('EXPO_PUBLIC_SUPABASE_URL baked into the build', expected.supabaseUrl, 'not in the bundle — add it in Netlify → Environment variables and redeploy ("Clear cache and deploy")');
  check('EXPO_PUBLIC_SUPABASE_ANON_KEY baked into the build', expected.anonKey, 'not in the bundle — add it in Netlify → Environment variables and redeploy');
  check('EXPO_PUBLIC_LIVEKIT_URL baked into the build', expected.liveKitUrl, 'not in the bundle — calls and lives cannot connect until it is set');
  const siteUrls = [...new Set([...bundle.matchAll(/https?:\/\/[a-z0-9.-]+\.netlify\.app/gi)].map((m) => m[0].toLowerCase()))];
  if (bundle.includes(`"${origin}"`) || bundle.includes(`'${origin}'`) || siteUrls.includes(origin.toLowerCase())) pass('EXPO_PUBLIC_SITE_URL matches this origin', origin);
  else if (siteUrls.length > 0) fail('EXPO_PUBLIC_SITE_URL matches this origin', `bundle references ${siteUrls.join(', ')} — redeploy production or set EXPO_PUBLIC_SITE_URL=${origin}`);
  else warn('EXPO_PUBLIC_SITE_URL matches this origin', 'no netlify.app origin found in the bundle (custom domain?) — verify share links point to this site');
}

// 3. Dynamic routes via _redirects ------------------------------------------
const dynamicRoutes = ['/u/friendzy-site-check', '/post/00000000-0000-4000-8000-000000000000', '/video/00000000-0000-4000-8000-000000000000', '/live/00000000-0000-4000-8000-000000000000', '/chat/00000000-0000-4000-8000-000000000000/info', '/games/room/00000000-0000-4000-8000-000000000000', '/tag/hello'];
const broken = [];
for (const route of dynamicRoutes) {
  const res = await get(route);
  if (res.status !== 200 || !isFriendzyHtml(res.text)) broken.push(`${route} → ${res.status || res.error}`);
}
if (broken.length === 0) pass('Dynamic routes resolve through dist/_redirects', `${dynamicRoutes.length} routes checked`);
else fail('Dynamic routes resolve through dist/_redirects', `${broken.join('; ')} — scripts/netlify-redirects.mjs did not run or _redirects is missing from dist`);

// 4. Custom 404 --------------------------------------------------------------
const nf = await get('/definitely-not-a-page-' + Date.now());
if (nf.status === 404 && isFriendzyHtml(nf.text)) pass('Unknown paths get the Friendzy 404 page with status 404');
else if (nf.status === 404) warn('Unknown paths get the Friendzy 404 page', 'status 404 but Netlify default page (404.html missing from dist)');
else fail('Unknown paths return 404', `HTTP ${nf.status}`);

// 5. Public pages + auth deep-link targets ---------------------------------
const pages = ['/sign-in', '/sign-up', '/about', '/features', '/privacy', '/terms', '/guidelines', '/help', '/download', '/auth/callback', '/auth/confirm', '/auth/reset-password'];
const bad = [];
for (const p of pages) {
  const res = await get(p);
  if (res.status !== 200 || !isFriendzyHtml(res.text)) bad.push(`${p} → ${res.status || res.error}`);
}
if (bad.length === 0) pass('Public pages and auth deep-link targets exist', `${pages.length} pages`);
else fail('Public pages and auth deep-link targets exist', bad.join('; '));

// 5b. Installable web app (PWA) ---------------------------------------------
if (/rel="manifest"/.test(home.text)) {
  const manifest = await get('/manifest.webmanifest');
  let parsed = null;
  try {
    parsed = manifest.status === 200 ? JSON.parse(manifest.text) : null;
  } catch {
    parsed = null;
  }
  if (!parsed) {
    fail('Installable: web app manifest', `GET /manifest.webmanifest → ${manifest.status || manifest.error}`);
  } else {
    const icons = Array.isArray(parsed.icons) ? parsed.icons : [];
    const missingIcons = [];
    for (const icon of icons) {
      const res = await get(icon.src);
      if (res.status !== 200 || !/image\/png/.test(res.headers.get('content-type') ?? '')) missingIcons.push(`${icon.src} → ${res.status || res.error}`);
    }
    const hasMaskable = icons.some((i) => /maskable/.test(i.purpose ?? ''));
    const has512 = icons.some((i) => /512x512/.test(i.sizes ?? ''));
    if (missingIcons.length) fail('Installable: web app manifest', `icon(s) not served: ${missingIcons.join('; ')}`);
    else if (!has512 || !hasMaskable || !parsed.start_url || !parsed.display) fail('Installable: web app manifest', 'manifest lacks a 512px icon, a maskable icon, start_url or display');
    else pass('Installable: web app manifest', `${icons.length} icons, display=${parsed.display}, served as ${manifest.headers.get('content-type') ?? '?'}`);
  }
  const sw = await get('/sw.js');
  if (sw.status === 200 && /javascript/.test(sw.headers.get('content-type') ?? '') && /addEventListener\('fetch'/.test(sw.text)) pass('Installable: service worker served', `cache-control: ${sw.headers.get('cache-control') ?? 'none'}`);
  else fail('Installable: service worker served', `GET /sw.js → ${sw.status || sw.error} (${sw.headers.get('content-type') ?? 'no content-type'})`);
  const touch = await get('/apple-touch-icon.png');
  if (touch.status === 200) pass('Installable: Apple touch icon');
  else warn('Installable: Apple touch icon', `GET /apple-touch-icon.png → ${touch.status}`);
} else {
  warn('Installable: web app manifest', 'home page has no <link rel="manifest"> — this deploy predates the installable build');
}

// 6. Asset caching -----------------------------------------------------------
if (scripts.length > 0) {
  const asset = await get(scripts[0].startsWith('http') ? scripts[0] : `${origin}${scripts[0].startsWith('/') ? '' : '/'}${scripts[0]}`);
  const cc = asset.headers.get('cache-control') ?? '';
  if (/immutable/.test(cc)) pass('Hashed bundles cached immutably', cc);
  else warn('Hashed bundles cached immutably', `cache-control: "${cc || 'none'}"`);
}

// Report ---------------------------------------------------------------------
console.log('');
for (const r of results) console.log(`${r.ok === true ? '✔' : r.ok === false ? '✖' : '•'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
const failures = results.filter((r) => r.ok === false).length;
const host = new URL(origin).host;
const siteName = host.endsWith('.netlify.app') ? host.replace(/\.netlify\.app$/, '') : null;
console.log('');
if (failures === 0) console.log(`✔ ${origin} is live and correctly configured.`);
else console.log(`✖ ${failures} check(s) failed — see above.`);

const identityOk = results.find((r) => r.name === 'Home page is the Friendzy build')?.ok === true;
if (!identityOk) { console.log('\nThis origin is not the Friendzy build, so no Supabase settings are suggested for it. Find the real address in the Netlify dashboard (Project overview → the https://…netlify.app link) and rerun.'); process.exit(1); }

console.log('\nSupabase → Authentication → URL configuration (https://supabase.com/dashboard/project/gwdpsrjmfrgcloacvdlg/auth/url-configuration)');
console.log(`  Site URL:       ${origin}`);
console.log('  Redirect URLs:');
const redirects = [`${origin}/auth/callback`, `${origin}/auth/confirm`, `${origin}/auth/reset-password`];
if (siteName) redirects.push(`https://*--${siteName}.netlify.app/auth/**`);
redirects.push('friendzy://auth/callback', 'friendzy://auth/confirm', 'http://localhost:8081/auth/callback', 'http://localhost:8081/auth/confirm');
for (const r of redirects) console.log(`    ${r}`);
console.log('\nThen sign up on the site, confirm the email and run in the SQL editor:');
console.log("  select public.bootstrap_first_admin('you@example.com');");

process.exitCode = failures === 0 ? 0 : 1;
