// Friendzy QA — one-off probe: does anything inside the chat message list disable touch scrolling?
//
// `touch-action: none` on a message row stops a finger drag that starts on a bubble from scrolling
// the conversation in a mobile browser. Run against a built site:
//   QA_BASE_URL=http://127.0.0.1:4173 QA_ALICE_EMAIL=… QA_ALICE_PASSWORD=… node scripts/qa/touch-action-probe.mjs <conversationId>
import { chromium } from 'playwright';

const BASE = (process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const conversationId = process.argv[2];
const REF = SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];

const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: process.env.QA_ALICE_EMAIL, password: process.env.QA_ALICE_PASSWORD }),
});
const session = await res.json();
if (!session.access_token) throw new Error(`sign-in failed: ${JSON.stringify(session).slice(0, 200)}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 414, height: 860 } });
await context.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), { key: `sb-${REF}-auth-token`, value: JSON.stringify(session) });
const page = await context.newPage();
await page.goto(`${BASE}/chat/${conversationId}`, { waitUntil: 'domcontentloaded' });
await page.locator('input[placeholder="Message"], textarea[placeholder="Message"]').first().waitFor({ state: 'visible', timeout: 60_000 });
await page.waitForTimeout(4000);

const report = await page.evaluate(() => {
  const scrollers = Array.from(document.querySelectorAll('div'))
    .filter((e) => { const s = getComputedStyle(e); return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.clientHeight > 120; })
    .sort((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight));
  const list = scrollers[0];
  if (!list) return { error: 'no scroll container on the chat screen' };
  const blocking = Array.from(list.querySelectorAll('*')).filter((e) => getComputedStyle(e).touchAction === 'none');
  return {
    scrollHeight: list.scrollHeight,
    clientHeight: list.clientHeight,
    overflow: list.scrollHeight - list.clientHeight,
    elementsBlockingTouchScroll: blocking.length,
    sample: blocking.slice(0, 3).map((e) => (e.textContent ?? '').trim().slice(0, 60)),
  };
});
console.log(JSON.stringify(report, null, 2));
await browser.close();
