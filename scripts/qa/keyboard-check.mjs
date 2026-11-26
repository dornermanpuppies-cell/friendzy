// Friendzy QA — on-screen keyboard check (mobile browsers).
//
// A phone keyboard does not shrink the layout viewport (iOS Safari never does), so an app pinned to
// `height: 100%` keeps its composer underneath the keyboard. src/app/+html.tsx resizes the app box to
// `visualViewport.height` instead. This drives that handler the way a real keyboard does — by shrinking
// the reported visual viewport and firing its resize event — and checks that the text field the user is
// typing into is still on screen.
//
//   QA_BASE_URL=http://127.0.0.1:4173 QA_ALICE_EMAIL=… QA_ALICE_PASSWORD=… node scripts/qa/keyboard-check.mjs <conversationId> <liveId?>
import { chromium } from 'playwright';

const BASE = (process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const REF = SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
const conversationId = process.argv[2];
const KEYBOARD = 336; // typical Android keyboard height at this viewport

const session = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: process.env.QA_ALICE_EMAIL, password: process.env.QA_ALICE_PASSWORD }),
}).then((r) => r.json());
if (!session.access_token) throw new Error(`sign-in failed: ${JSON.stringify(session).slice(0, 200)}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 414, height: 860 }, hasTouch: true, isMobile: false });
await context.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), { key: `sb-${REF}-auth-token`, value: JSON.stringify(session) });
const page = await context.newPage();

/** Shrinks what the page believes the visible viewport to be, then fires the event a keyboard would. */
async function openKeyboard(px) {
  await page.evaluate((inset) => {
    const vv = window.visualViewport;
    if (!window.__fzRealHeight) window.__fzRealHeight = vv.height;
    Object.defineProperty(vv, 'height', { configurable: true, get: () => window.__fzRealHeight - inset });
    vv.dispatchEvent(new Event('resize'));
  }, px);
  await page.waitForTimeout(500);
}
async function closeKeyboard() {
  await page.evaluate(() => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { configurable: true, get: () => window.__fzRealHeight });
    vv.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(400);
}

const results = [];
async function check(name, url, selector) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
  const field = page.locator(selector).first();
  await field.waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(1500);

  const before = await field.boundingBox();
  await openKeyboard(KEYBOARD);
  const visibleHeight = 860 - KEYBOARD;
  const after = await field.boundingBox();
  const root = await page.evaluate(() => Math.round(document.getElementById('root').getBoundingClientRect().height));
  // Control: drop the inline height and the app falls back to Expo's `#root{height:100%}` reset — the
  // state users were in before the fix. Measures how far the field ends up below the keyboard line.
  const withoutFix = await page.evaluate(() => {
    const el = document.getElementById('root');
    const applied = el.style.height;
    el.style.height = '';
    const input = document.querySelector('input:not([type=hidden]), textarea');
    const rect = input ? input.getBoundingClientRect() : null;
    const height = Math.round(el.getBoundingClientRect().height);
    el.style.height = applied;
    return { appHeight: height, fieldBottom: rect ? Math.round(rect.y + rect.height) : null };
  });
  await closeKeyboard();
  const restored = await page.evaluate(() => Math.round(document.getElementById('root').getBoundingClientRect().height));

  const covered = after ? Math.round(after.y + after.height - visibleHeight) : null;
  const ok = after !== null && covered <= 2 && root <= visibleHeight + 2 && restored >= 840;
  results.push({ name, url, withoutFix, fieldBottomBefore: before ? Math.round(before.y + before.height) : null, fieldBottomAfter: after ? Math.round(after.y + after.height) : null, visibleHeight, appHeightWithKeyboard: root, appHeightRestored: restored, ok });
  const hidden = withoutFix.fieldBottom !== null ? withoutFix.fieldBottom - visibleHeight : null;
  console.log(`${ok ? '✔' : '✖'} ${name.padEnd(22)} fixed: field bottom ${after ? Math.round(after.y + after.height) : '—'}px of ${visibleHeight}px visible (app box ${root}px → ${restored}px) · without the fix: app box ${withoutFix.appHeight}px, field ${hidden !== null && hidden > 0 ? `${hidden}px behind the keyboard` : 'visible'}`);
}

await check('chat composer', `/chat/${conversationId}`, 'input[placeholder="Message"], textarea[placeholder="Message"]');
await check('post comment box', '/compose/post', 'textarea, input[placeholder*="happening"]');
await check('search field', '/search', 'input');

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} inputs stay above the keyboard`);
process.exit(bad.length ? 1 : 0);
