// Friendzy QA — scroll audit.
//
// Walks the main screens in a phone-sized browser and reports, for each one, whether its content
// lives in a scroll container, whether anything inside it disables touch panning
// (`touch-action: none` stops a finger drag from scrolling in mobile browsers), and whether the
// page itself overflows behind the fixed chrome instead of scrolling inside the list.
//
//   QA_BASE_URL=http://127.0.0.1:4173 QA_ALICE_EMAIL=… QA_ALICE_PASSWORD=… node scripts/qa/scroll-audit.mjs
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = (process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const REF = SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
const ROUTES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['/home', '/discover', '/videos', '/inbox', '/notifications', '/friends', '/requests', '/calls', '/games', '/search', '/profile', '/wallet', '/premium', '/settings', '/settings/notifications', '/chat/starred'];

const session = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: process.env.QA_ALICE_EMAIL, password: process.env.QA_ALICE_PASSWORD }),
}).then((r) => r.json());
if (!session.access_token) throw new Error(`sign-in failed: ${JSON.stringify(session).slice(0, 200)}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 414, height: 740 }, hasTouch: true });
await context.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), { key: `sb-${REF}-auth-token`, value: JSON.stringify(session) });
const page = await context.newPage();

const PROBE = `(() => {
  const scrollers = Array.from(document.querySelectorAll('div'))
    .filter((e) => { const s = getComputedStyle(e); return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.clientHeight > 120; })
    .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
  const list = scrollers[0];
  const blocked = list ? Array.from(list.querySelectorAll('*')).filter((e) => getComputedStyle(e).touchAction === 'none') : [];
  return {
    scrollContainers: scrollers.length,
    overflow: list ? list.scrollHeight - list.clientHeight : 0,
    listHeight: list ? list.clientHeight : 0,
    blockTouchScroll: blocked.length,
    pageOverflows: document.documentElement.scrollHeight > window.innerHeight + 4,
  };
})()`;

const rows = [];
for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const probe = await page.evaluate(PROBE);
  let scrolled = null;
  if (probe.overflow > 20) {
    scrolled = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('div'))
        .filter((e) => { const s = getComputedStyle(e); return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.clientHeight > 120; })
        .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
      const start = el.scrollTop;
      // A paged feed snaps to whole pages, so a small nudge springs straight back. Move by a page.
      const step = getComputedStyle(el).scrollSnapType.startsWith('none') ? 200 : el.clientHeight;
      el.scrollTop = start + step;
      const moved = el.scrollTop !== start;
      el.scrollTop = start;
      return moved;
    });
  }
  const problems = [];
  if (probe.scrollContainers === 0) problems.push('no scroll container');
  if (probe.blockTouchScroll > 0) problems.push(`${probe.blockTouchScroll} elements block touch scrolling`);
  if (probe.pageOverflows) problems.push('page scrolls behind the fixed chrome');
  if (scrolled === false) problems.push('content overflows but the container does not scroll');
  rows.push({ route, ...probe, scrolled, problems });
  console.log(`${problems.length ? '✖' : '✔'} ${route.padEnd(24)} containers=${probe.scrollContainers} overflow=${probe.overflow}px blockers=${probe.blockTouchScroll}${problems.length ? ' — ' + problems.join('; ') : ''}`);
}

fs.mkdirSync('qa-artifacts', { recursive: true });
fs.writeFileSync(path.join('qa-artifacts', 'scroll-audit.json'), JSON.stringify({ base: BASE, finishedAt: new Date().toISOString(), rows }, null, 2));
await browser.close();
const bad = rows.filter((r) => r.problems.length);
console.log(`\n${rows.length - bad.length}/${rows.length} screens scroll cleanly (qa-artifacts/scroll-audit.json)`);
process.exit(bad.length ? 1 : 0);
