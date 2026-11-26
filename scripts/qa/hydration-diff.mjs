// Friendzy QA — explains React hydration errors (#418/#425) on statically exported pages.
//
// Loads a route twice from the static server: once with JavaScript disabled (the exact server HTML)
// and once normally (what the client renders), then prints the structural differences so the
// component that renders differently on the server and in the browser can be found quickly.
//
//   QA_BASE_URL=http://127.0.0.1:4173 node scripts/qa/hydration-diff.mjs /about /download
import { chromium } from 'playwright';

const BASE = (process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const routes = process.argv.slice(2);
if (routes.length === 0) {
  console.error('usage: node scripts/qa/hydration-diff.mjs /route [/route ...]');
  process.exit(2);
}

// Tag + role per element, trimmed text per text node, indented by depth. Attributes are ignored
// because production React only reports structural and text mismatches.
const serialize = `(() => {
  const out = [];
  const walk = (node, depth) => {
    if (node.nodeType === 3) { const t = node.textContent.replace(/\\s+/g, ' ').trim(); if (t) out.push('  '.repeat(depth) + '#' + t.slice(0, 90)); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'link') return;
    out.push('  '.repeat(depth) + tag + (node.getAttribute('role') ? '[' + node.getAttribute('role') + ']' : ''));
    for (const c of node.childNodes) walk(c, depth + 1);
  };
  walk(document.body, 0);
  return out;
})()`;

function diff(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = new Uint16Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * (m + 1) + j] = a[i] === b[j] ? dp[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: ' ', line: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) {
      out.push({ kind: '-', line: a[i++] });
    } else {
      out.push({ kind: '+', line: b[j++] });
    }
  }
  while (i < n) out.push({ kind: '-', line: a[i++] });
  while (j < m) out.push({ kind: '+', line: b[j++] });
  return out;
}

const browser = await chromium.launch();
let exitCode = 0;
for (const route of routes) {
  const ssr = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 414, height: 860 } });
  const p1 = await ssr.newPage();
  await p1.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  const server = await p1.evaluate(serialize);
  await ssr.close();

  const csr = await browser.newContext({ viewport: { width: 414, height: 860 } });
  const p2 = await csr.newPage();
  const errors = [];
  p2.on('pageerror', (e) => errors.push(e.message.split('\n')[0].slice(0, 140)));
  await p2.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(2500);
  const client = await p2.evaluate(serialize);
  await csr.close();

  const changes = diff(server, client);
  const changed = changes.filter((c) => c.kind !== ' ').length;
  console.log(`\n=== ${route}: server ${server.length} nodes, client ${client.length} nodes, ${changed} differing lines, page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  if (errors.length) exitCode = 1;
  let printed = 0;
  for (let k = 0; k < changes.length && printed < 70; k++) {
    if (changes[k].kind === ' ') continue;
    // one line of context before a change block
    if (k > 0 && changes[k - 1].kind === ' ' && (k < 2 || changes[k - 2].kind !== ' ' || true)) console.log(`  ${changes[k - 1].line}`);
    console.log(`${changes[k].kind} ${changes[k].line}`);
    printed++;
  }
}
await browser.close();
process.exit(exitCode);
