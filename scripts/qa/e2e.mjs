#!/usr/bin/env node
/**
 * Friendzy end-to-end checks with two real accounts in two browser profiles.
 *
 * What it exercises against a running build (static export or dev server) and the
 * live Supabase project:
 *   1. the Notifications bell (navigation must stay inside the app)
 *   2. end-to-end encrypted chat between the two accounts (send, receive, inbox preview)
 *   3. a voice call: ring → accept → both connected to LiveKit → hang up → history
 *   4. games: Trivia, Chess, Ludo and Truth or Dare rooms through the real game engine
 *
 * Usage (credentials come from the environment, never from this file):
 *   QA_BASE_URL=http://127.0.0.1:4173 QA_ALICE_EMAIL=… QA_ALICE_PASSWORD=… QA_BOB_EMAIL=… QA_BOB_PASSWORD=… \
 *   node scripts/qa/e2e.mjs [--only notifications,chat,call,games] [--headed]
 *
 * EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are read from the environment
 * or .env.local. Screenshots and a JSON report land in qa-artifacts/.
 */
import fs from 'node:fs';
import path from 'node:path';

import { chromium } from 'playwright';

const root = process.cwd();
const artifacts = path.join(root, 'qa-artifacts');
fs.mkdirSync(artifacts, { recursive: true });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
function loadEnvLocal() {
  const file = path.join(root, '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
loadEnvLocal();

const args = process.argv.slice(2);
const only = (args.includes('--only') ? args[args.indexOf('--only') + 1] : 'notifications,social,story,search,push,chat,call,games,smoke').split(',');
const headed = args.includes('--headed');
const BASE = (process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const ACCOUNTS = {
  alice: { email: process.env.QA_ALICE_EMAIL, password: process.env.QA_ALICE_PASSWORD },
  bob: { email: process.env.QA_BOB_EMAIL, password: process.env.QA_BOB_PASSWORD },
};
for (const [name, a] of Object.entries(ACCOUNTS)) {
  if (!a.email || !a.password) {
    console.error(`✖ Missing QA_${name.toUpperCase()}_EMAIL / QA_${name.toUpperCase()}_PASSWORD`);
    process.exit(2);
  }
}
if (!SUPABASE_URL || !ANON) {
  console.error('✖ Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(2);
}
const REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const STORAGE_KEY = `sb-${REF}-auth-token`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const results = [];
const logs = [];
const startedAt = Date.now();
function log(...parts) {
  const line = `[${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${parts.join(' ')}`;
  logs.push(line);
  console.log(line);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function rpc(session, fn, params = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`rpc ${fn} failed: ${res.status} ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
}

class Actor {
  constructor(name, browser, session) {
    this.name = name;
    this.browser = browser;
    this.session = session;
    this.userId = session.user.id;
    this.errors = [];
    this.network = [];
  }
  async open() {
    // One persistent profile per account: IndexedDB keeps the encryption device between runs,
    // exactly like a real phone or browser (a fresh profile would be a brand-new device every time).
    const profileDir = path.join(artifacts, 'profiles', this.name);
    fs.mkdirSync(profileDir, { recursive: true });
    this.context = await chromium.launchPersistentContext(profileDir, {
      headless: !headed,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'],
      viewport: { width: 414, height: 860 },
      permissions: ['microphone', 'camera', 'notifications'],
      ignoreHTTPSErrors: true,
    });
    await this.context.addInitScript(({ key, value }) => {
      try {
        if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
      } catch {
        /* ignore */
      }
    }, { key: STORAGE_KEY, value: JSON.stringify(this.session) });
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    this.page.on('dialog', (d) => d.accept().catch(() => undefined));
    this.page.on('pageerror', (e) => {
      this.errors.push(`pageerror: ${e.message}`);
      log(this.name, 'PAGE ERROR', e.message);
    });
    this.page.on('console', (m) => {
      if (m.type() === 'error') {
        const text = m.text();
        if (/favicon|manifest|ERR_BLOCKED|net::ERR_ABORTED/.test(text)) return;
        this.errors.push(`console.error: ${text.slice(0, 300)}`);
      }
    });
    // Failed network requests (4xx/5xx) with their bodies: the quickest way to explain a console 409/500.
    this.page.on('response', (r) => {
      const status = r.status();
      if (status < 400 || status === 401) return;
      const url = r.url();
      if (/favicon|manifest|\.png|\.ico/.test(url)) return;
      const entry = { at: new Date().toISOString(), status, method: r.request().method(), url: url.slice(0, 220), body: '' };
      this.network.push(entry);
      r.text().then((t) => { entry.body = t.slice(0, 300); }).catch(() => undefined);
    });
    return this;
  }
  async goto(route) {
    await this.page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  }
  path() {
    return new URL(this.page.url()).pathname;
  }
  async shot(label) {
    const file = path.join(artifacts, `${this.name}-${label}.png`);
    await this.page.screenshot({ path: file, fullPage: false }).catch(() => undefined);
    return path.relative(root, file);
  }
  visibleText(text, exact = false) {
    return this.page.getByText(text, { exact }).locator('visible=true').first();
  }
  async waitForText(text, timeout = 30_000) {
    await this.visibleText(text).waitFor({ state: 'visible', timeout });
  }
  async clickText(text, options = {}) {
    const locator = this.visibleText(text, options.exact ?? true);
    await locator.waitFor({ state: 'visible', timeout: options.timeout ?? 30_000 });
    await locator.click();
  }
  async clickLabel(label, timeout = 30_000) {
    const locator = this.page.locator(`[aria-label="${label}"]`).first();
    await locator.waitFor({ state: 'visible', timeout });
    await locator.click();
  }
  async hasText(text, timeout = 5_000) {
    return this.visibleText(text)
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
  }
}

let actorsForShots = [];
async function scenario(name, fn) {
  const started = Date.now();
  log(`▶ ${name}`);
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - started, detail: detail ?? null });
    log(`✔ ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  } catch (error) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const shots = [];
    for (const actor of actorsForShots) shots.push(await actor.shot(`fail-${slug}`));
    results.push({ name, ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error), screenshots: shots });
    log(`✖ ${name} — ${error instanceof Error ? error.message.split('\n')[0] : String(error)} (${shots.join(', ')})`);
  }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
async function notificationsScenario(alice, bob) {
  // Make sure Alice has at least one notification: Bob follows her.
  await rpc(bob.session, 'follow_user', { p_target: alice.userId }).catch((e) => log('follow_user:', e.message));
  await alice.goto('/home');
  await alice.page.locator('[aria-label="Notifications"]').first().waitFor({ state: 'visible', timeout: 45_000 });
  await sleep(1500);
  const before = alice.path();
  await alice.clickLabel('Notifications');
  await sleep(3000);
  const after = alice.path();
  const headerVisible = await alice.hasText('Notifications', 8_000);
  const listed = await alice.hasText('started following you', 15_000);
  const shot = await alice.shot('notifications');
  if (after !== '/notifications') throw new Error(`bell navigated to ${after} (from ${before}); screenshot ${shot}`);
  if (!headerVisible) throw new Error(`notifications header not visible; screenshot ${shot}`);
  // Open the first notification and make sure we land on a profile inside the app.
  if (listed) {
    await alice.clickText('started following you', { exact: false });
    await sleep(2500);
    const where = alice.path();
    if (!where.startsWith('/u/')) throw new Error(`opening a notification navigated to ${where}`);
  }
  // Back arrow returns to the previous screen, never out of the app.
  await alice.goto('/home');
  await alice.clickLabel('Notifications', 45_000);
  await sleep(1500);
  await alice.clickLabel('Go back');
  await sleep(2000);
  const back = alice.path();
  if (!['/home', '/'].includes(back) && back.startsWith('/sign')) throw new Error(`back from notifications went to ${back}`);
  return { after, listed, back, pageErrors: alice.errors.length };
}

async function chatScenario(alice, bob, conversationId) {
  // The receiver opens first: his device registers its keys, then the sender loads the
  // recipient list (a message sealed before a device existed is unreadable there by design).
  await bob.goto(`/chat/${conversationId}`);
  await bob.page.locator('input[placeholder="Message"], textarea[placeholder="Message"]').first().waitFor({ state: 'visible', timeout: 60_000 });
  await alice.goto(`/chat/${conversationId}`);
  await alice.page.locator('input[placeholder="Message"], textarea[placeholder="Message"]').first().waitFor({ state: 'visible', timeout: 60_000 });
  await sleep(1500);
  const stamp = Date.now().toString(36);
  const text = `Hello Bob, sealed ${stamp}`;
  await alice.page.locator('input[placeholder="Message"], textarea[placeholder="Message"]').first().fill(text);
  await alice.clickLabel('Send');
  await bob.waitForText(text, 30_000);
  const reply = `Hi Alice, got it ${stamp}`;
  await bob.page.locator('input[placeholder="Message"], textarea[placeholder="Message"]').first().fill(reply);
  await bob.clickLabel('Send');
  await alice.waitForText(reply, 30_000);
  // The inbox preview is decrypted on the device.
  await alice.goto('/inbox');
  await alice.waitForText(reply, 30_000);
  await alice.shot('inbox');
  return { sent: text, reply };
}

async function callScenario(alice, bob, conversationId) {
  await bob.goto('/home');
  await bob.page.locator('[aria-label="Notifications"]').first().waitFor({ state: 'visible', timeout: 45_000 });
  await alice.goto(`/chat/${conversationId}`);
  await alice.page.getByText('Arena QA Bob', { exact: true }).first().waitFor({ state: 'visible', timeout: 45_000 });
  await alice.clickLabel('Voice call', 45_000);
  await alice.page.waitForURL(/\/call\//, { timeout: 30_000 });
  const callId = alice.path().split('/call/')[1];
  log('call id', callId);
  // Bob sees the incoming banner and accepts.
  await bob.clickLabel('Accept call', 30_000);
  await bob.page.waitForURL(/\/call\//, { timeout: 30_000 });
  // Both sides show a running timer once media is connected.
  const timer = /Voice call · \d+:\d\d/;
  const timerBoxes = async (actor) => actor.page.getByText(timer).evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { text: e.textContent, w: Math.round(r.width), h: Math.round(r.height), visibility: getComputedStyle(e).visibility }; }));
  await alice.page.getByText(timer).locator('visible=true').first().waitFor({ state: 'visible', timeout: 45_000 }).catch(async (e) => { log('alice timer nodes', JSON.stringify(await timerBoxes(alice))); throw e; });
  await bob.page.getByText(timer).locator('visible=true').first().waitFor({ state: 'visible', timeout: 45_000 }).catch(async (e) => { log('bob timer nodes', JSON.stringify(await timerBoxes(bob))); throw e; });
  // Each side lists the other participant (remote track joined the room).
  await alice.page.getByText('Arena QA Bob', { exact: true }).locator('visible=true').first().waitFor({ state: 'visible', timeout: 45_000 });
  await bob.page.getByText('Arena QA Alice', { exact: true }).locator('visible=true').first().waitFor({ state: 'visible', timeout: 45_000 });
  for (const actor of [alice, bob]) {
    const ids = await actor.page.locator('[data-testid^="call-tile:"], [data-testid^="call-hidden:"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    log(actor.name, 'room participants', JSON.stringify(ids));
  }
  await sleep(4000);
  await alice.shot('call-alice');
  await bob.shot('call-bob');
  const callRow = await rpc(alice.session, 'get_call', { p_call: callId });
  if (callRow?.status !== 'active') throw new Error(`call status is ${callRow?.status}, expected active`);
  await alice.clickLabel('End');
  await bob.waitForText('Call ended', 30_000);
  await sleep(1500);
  const finished = await rpc(alice.session, 'get_call', { p_call: callId });
  if (finished?.status !== 'ended') throw new Error(`call status after hang-up is ${finished?.status}`);
  const history = await rpc(alice.session, 'get_call_history', { p_limit: 5 });
  const entry = Array.isArray(history) ? history.find((h) => h.id === callId) : null;
  return { callId, duration: finished.started_at && finished.ended_at ? Math.round((Date.parse(finished.ended_at) - Date.parse(finished.started_at)) / 1000) : null, inHistory: Boolean(entry) };
}

async function leaveAllRooms(...actors) {
  for (const actor of actors) {
    const lobby = await rpc(actor.session, 'list_game_rooms', {}).catch(() => null);
    for (const room of lobby?.mine ?? []) {
      if (room.status === 'playing') await rpc(actor.session, 'leave_game_room', { p_room: room.id }).catch(() => undefined);
      else await rpc(actor.session, 'leave_game_room', { p_room: room.id }).catch(() => undefined);
    }
  }
}

const SLUGS = { Trivia: 'trivia', Chess: 'chess', Ludo: 'ludo', 'Truth or Dare': 'truth_or_dare' };

/**
 * QA_ROOM_MODE: ui (default — lobby → game card → Create room), rest (room created through
 * the API, host opens the room URL directly) or lobbylink (room created through the API,
 * host opens it from "Your games" in the lobby). Used to isolate navigation-related bugs.
 */
async function createRoomViaUi(actor, gameName) {
  await leaveAllRooms(alice, bob);
  const mode = process.env.QA_ROOM_MODE ?? 'ui';
  if (mode === 'rest' || mode === 'lobbylink') {
    const room = await rpc(actor.session, 'create_game_room', { p_game: SLUGS[gameName], p_is_private: false, p_max_players: null });
    if (mode === 'rest') await actor.goto(`/games/room/${room.id}`);
    else {
      await actor.goto('/games');
      await actor.clickText('Open');
      await actor.page.waitForURL(/\/games\/room\//, { timeout: 30_000 });
    }
    return room.id;
  }
  await actor.goto('/games');
  await actor.clickLabel(`Play ${gameName}`, 45_000);
  await actor.clickText('Create room');
  await actor.page.waitForURL(/\/games\/room\//, { timeout: 30_000 });
  return actor.path().split('/games/room/')[1];
}

async function startRoom(host, guest, roomId) {
  await rpc(guest.session, 'join_game_room', { p_room: roomId });
  await guest.goto(`/games/room/${roomId}`);
  await guest.clickText("I'm ready");
  const start = host.page.getByText('Start game', { exact: true }).first();
  await start.waitFor({ state: 'visible', timeout: 30_000 });
  await host.page.waitForFunction(() => {
    const el = Array.from(document.querySelectorAll('[role="button"]')).find((b) => (b.textContent ?? '').includes('Start game'));
    return el && el.getAttribute('aria-disabled') !== 'true';
  }, null, { timeout: 30_000 });
  await start.click();
}

async function leaveRoom(actor) {
  const wasInRoom = actor.path().includes('/games/room/');
  // A finished game shows "Back to games" instead of the Leave room control.
  const back = actor.page.getByText('Back to games', { exact: true }).locator('visible=true').first();
  if (await back.isVisible().catch(() => false)) await back.click();
  else await actor.clickLabel('Leave room', 15_000).catch(() => undefined);
  if (wasInRoom) {
    await actor.page.waitForFunction(() => !window.location.pathname.includes('/games/room/'), null, { timeout: 15_000 }).catch(() => log(actor.name, 'still in the room after Leave room:', actor.path()));
  }
  await sleep(1000);
}

/** Polls get_game_room until the predicate accepts the public state (or the timeout passes). */
async function waitForRoomState(session, roomId, predicate, timeout = 8_000) {
  const until = Date.now() + timeout;
  let state = null;
  while (Date.now() < until) {
    const room = await rpc(session, 'get_game_room', { p_room: roomId }).catch(() => null);
    state = room?.state ?? null;
    if (predicate(state)) return state;
    await sleep(500);
  }
  return state;
}

/** Fails loudly when a rounds-game answer never reached the engine (screenshot + failed requests). */
async function expectAnswerRecorded(actor, roomId, label) {
  const state = await waitForRoomState(actor.session, roomId, (s) => s?.answers?.[actor.userId] || s?.history?.[0]?.perUser?.[actor.userId], 8_000);
  if (state?.answers?.[actor.userId] || state?.history?.[0]?.perUser?.[actor.userId]) return state;
  const shot = await actor.shot(`${label}-${actor.name}-answer-missing`);
  throw new Error(`${actor.name}'s answer was not recorded (${shot}); state=${JSON.stringify({ phase: state?.phase, round: state?.round, answers: state?.answers, left: state?.left })}; failedRequests=${JSON.stringify(actor.network.slice(-3))}`);
}

async function triviaScenario(alice, bob) {
  const roomId = await createRoomViaUi(alice, 'Trivia');
  await startRoom(alice, bob, roomId);
  await alice.waitForText('Round 1 of', 30_000);
  await bob.waitForText('Round 1 of', 30_000);
  await alice.page.locator('[aria-label^="Option A"]').first().click();
  await expectAnswerRecorded(alice, roomId, 'trivia');
  await bob.page.locator('[aria-label^="Option B"]').first().click();
  await expectAnswerRecorded(bob, roomId, 'trivia');
  // Both answered → immediate reveal (otherwise the 15 s answer clock reveals it).
  await alice.page.getByText(/Round 1 results|Round 2 of/).first().waitFor({ state: 'visible', timeout: 25_000 });
  await alice.shot('trivia-reveal');
  const earned = await alice.hasText(/points|Outvoted|Not this time/, 3_000);
  // The reveal lasts 5 s, then any client's tick starts the next round.
  await bob.page.getByText(/Round [2-9] of/).first().waitFor({ state: 'visible', timeout: 20_000 });
  const room = await rpc(alice.session, 'get_game_room', { p_room: roomId });
  if ((room?.round ?? 0) < 2 || Object.keys(room?.state?.scores ?? {}).length !== 2) throw new Error(`trivia did not advance: round ${room?.round}`);
  // Bob forfeits → with one player left the game finishes and results are written.
  await leaveRoom(bob);
  await alice.waitForText('won', 30_000).catch(() => undefined);
  const finished = await rpc(alice.session, 'get_game_room', { p_room: roomId });
  if (finished?.status !== 'finished') throw new Error(`trivia room status ${finished?.status}`);
  return { roomId, round: room?.round, earnedShown: earned, results: finished.results?.length ?? 0 };
}

async function chessScenario(alice, bob) {
  const roomId = await createRoomViaUi(alice, 'Chess');
  await startRoom(alice, bob, roomId);
  await alice.page.locator('[aria-label="e2"]').first().waitFor({ state: 'visible', timeout: 30_000 });
  await bob.page.locator('[aria-label="e2"]').first().waitFor({ state: 'visible', timeout: 30_000 });
  const aliceWhite = await alice.hasText('Your turn', 8_000);
  const white = aliceWhite ? alice : bob;
  const black = aliceWhite ? bob : alice;
  const square = async (actor, sq) => actor.page.locator(`[aria-label="${sq}"]`).locator('visible=true').first().evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, w: Math.round(e.getBoundingClientRect().width), kids: e.children.length, role: e.getAttribute('role') }));
  const under = async (actor, sq) => actor.page.locator(`[aria-label="${sq}"]`).locator('visible=true').first().evaluate((e) => {
    const r = e.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const chain = [];
    let n = top;
    while (n && chain.length < 6) { chain.push(`${n.tagName.toLowerCase()}${n.getAttribute('aria-label') ? `[${n.getAttribute('aria-label')}]` : ''}${n.getAttribute('data-testid') ? `#${n.getAttribute('data-testid')}` : ''}`); n = n.parentElement; }
    return { containsTarget: e === top || e.contains(top), chain };
  });
  const modals = async (actor) => actor.page.evaluate(() => Array.from(document.querySelectorAll('[aria-modal="true"], [role="dialog"]')).map((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), display: cs.display, opacity: cs.opacity, transform: cs.transform, pe: cs.pointerEvents }; }));
  log('white is', white.name, 'e2 before', JSON.stringify(await square(white, 'e2')), 'under pointer', JSON.stringify(await under(white, 'e2')), 'host modals', JSON.stringify(await modals(alice)), 'guest modals', JSON.stringify(await modals(bob)));
  await white.page.locator('[aria-label="e2"]').locator('visible=true').first().click();
  await sleep(600);
  log('e2 after click', JSON.stringify(await square(white, 'e2')), 'e4', JSON.stringify(await square(white, 'e4')));
  await white.shot('chess-selected');
  await white.page.locator('[aria-label="e4"]').locator('visible=true').first().click();
  await sleep(1500);
  const afterMove = await rpc(alice.session, 'get_game_room', { p_room: roomId });
  log('after e4 click: version', afterMove?.version, 'moves', JSON.stringify(afterMove?.state?.moves));
  await black.waitForText('Your turn', 30_000);
  await black.clickLabel('e7');
  await black.clickLabel('e5');
  await white.waitForText('Your turn', 30_000);
  const room = await rpc(alice.session, 'get_game_room', { p_room: roomId });
  const moves = room?.state?.moves ?? [];
  if (moves.join(' ') !== 'e4 e5') throw new Error(`unexpected move list: ${moves.join(' ')}`);
  await white.shot('chess');
  await black.clickText('Resign');
  let finished = null;
  for (let i = 0; i < 20; i += 1) {
    finished = await rpc(alice.session, 'get_game_room', { p_room: roomId });
    if (finished?.status === 'finished') break;
    await sleep(1000);
  }
  if (finished?.status !== 'finished' || finished.winner_id !== white.userId) throw new Error(`chess finished=${finished?.status} winner=${finished?.winner_id}`);
  await white.waitForText(/you won/i, 20_000);
  await white.goto('/games/leaderboard/chess');
  await white.waitForText('Arena QA', 30_000);
  const board = await rpc(alice.session, 'get_leaderboard', { p_game: 'chess', p_limit: 20 });
  const ranked = (board?.top ?? []).filter((e) => [alice.userId, bob.userId].includes(e.user.id)).length;
  if (ranked < 2) throw new Error(`leaderboard lists ${ranked} of the two players`);
  return { roomId, moves, whiteIs: white.name, leaderboardEntries: ranked };
}

async function ludoScenario(alice, bob) {
  const roomId = await createRoomViaUi(alice, 'Ludo');
  await startRoom(alice, bob, roomId);
  await alice.waitForText(/roll the dice|is rolling|Pick a highlighted token|is choosing a token/, 30_000);
  let turns = 0;
  for (let i = 0; i < 10 && turns < 6; i += 1) {
    for (const actor of [alice, bob]) {
      const roll = actor.page.getByText('Roll', { exact: true }).locator('visible=true').first();
      if (await roll.isVisible().catch(() => false)) {
        await roll.click();
        turns += 1;
        await sleep(1200);
        const token = actor.page.locator('[aria-label^="Token"]:not([aria-disabled="true"])').locator('visible=true').first();
        if (await actor.hasText('Pick a highlighted token', 1500)) {
          await token.click().catch(() => undefined);
          await sleep(800);
        }
      }
    }
    await sleep(500);
  }
  const room = await rpc(alice.session, 'get_game_room', { p_room: roomId });
  if ((room?.moves_count ?? 0) < 2) throw new Error(`only ${room?.moves_count} ludo moves recorded`);
  await alice.shot('ludo');
  await leaveRoom(bob);
  await sleep(2000);
  const finished = await rpc(alice.session, 'get_game_room', { p_room: roomId });
  return { roomId, turns, moves: room.moves_count, status: finished?.status };
}

async function truthOrDareScenario(alice, bob) {
  const roomId = await createRoomViaUi(alice, 'Truth or Dare');
  await startRoom(alice, bob, roomId);
  await alice.waitForText('truth or dare?', 30_000);
  await alice.clickText('Truth');
  await alice.waitForText('I did it!', 30_000);
  await alice.clickText('I did it!');
  await bob.waitForText('Done ✓', 30_000);
  await bob.clickText('Done ✓');
  await bob.waitForText('truth or dare?', 30_000);
  const room = await rpc(alice.session, 'get_game_room', { p_room: roomId });
  const score = room?.state?.scores?.[alice.userId];
  if (score !== 10) throw new Error(`alice score ${score}, expected 10`);
  await bob.shot('tod');
  await leaveRoom(alice);
  await sleep(1500);
  await leaveRoom(bob);
  return { roomId, aliceScore: score, turn: room.state.turn };
}

async function guessTheSongScenario(alice) {
  await alice.goto('/games');
  await alice.page.locator('[aria-label^="Play Trivia"]').first().waitFor({ state: 'visible', timeout: 45_000 });
  const card = alice.page.locator('[aria-label^="Play Guess the Song"], [aria-label^="Guess the Song"]').first();
  const label = (await card.getAttribute('aria-label').catch(() => null)) ?? null;
  const needsMore = await alice.hasText('Needs at least 4 sounds', 5_000);
  if (!needsMore || !/not available/.test(label ?? '')) throw new Error(`lobby does not explain why Guess the Song cannot start (label: ${label})`);
  return { cardLabel: label, availabilityShown: needsMore };
}


// ---------------------------------------------------------------------------
// Social loop: post → like → comment → notifications; follow + friend request; story; search
// ---------------------------------------------------------------------------
async function rest(session, pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: { apikey: ANON, Authorization: `Bearer ${session.access_token}` } });
  if (!res.ok) throw new Error(`GET ${pathAndQuery} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function postsScenario(alice, bob) {
  const stamp = Date.now().toString(36);
  const text = `Friendzy QA post ${stamp} — hello from the browser harness 👋`;
  await alice.goto('/compose/post');
  const input = alice.page.locator('textarea[placeholder="What\'s happening?"], input[placeholder="What\'s happening?"]').first();
  await input.waitFor({ state: 'visible', timeout: 45_000 });
  await input.fill(text);
  await alice.clickText('Post');
  // The post exists server-side (and the composer went away).
  let post = null;
  for (let i = 0; i < 20 && !post; i += 1) {
    const rows = await rest(alice.session, `posts?author_id=eq.${alice.userId}&order=created_at.desc&limit=1&select=id,text`).catch(() => []);
    if (rows[0] && String(rows[0].text ?? '').includes(stamp)) post = rows[0];
    else await sleep(1000);
  }
  if (!post) throw new Error('post was not created');
  // Bob reacts and comments on it.
  await bob.goto(`/post/${post.id}`);
  await bob.waitForText(stamp, 45_000);
  await bob.clickLabel('React');
  await bob.page.locator('[aria-label="Like"]').first().waitFor({ state: 'visible', timeout: 15_000 });
  const comment = `Nice one ${stamp}`;
  const commentInput = bob.page.locator('textarea[placeholder="Add a comment…"], input[placeholder="Add a comment…"]').first();
  await commentInput.waitFor({ state: 'visible', timeout: 15_000 });
  await commentInput.fill(comment);
  await bob.clickLabel('Send comment');
  await bob.waitForText(comment, 20_000);
  // Alice sees both notifications (realtime + list).
  await alice.goto('/notifications');
  await alice.waitForText('liked your post', 30_000);
  await alice.waitForText('commented', 30_000);
  // Opening the like notification lands on the post.
  await alice.clickText('liked your post', { exact: false });
  await alice.page.waitForURL(/\/post\//, { timeout: 20_000 });
  await alice.waitForText(stamp, 20_000);
  return { postId: post.id, comment };
}

async function followAndFriendsScenario(alice, bob) {
  await bob.goto('/u/arena_qa_alice');
  await bob.page.getByText('Arena QA Alice', { exact: true }).first().waitFor({ state: 'visible', timeout: 45_000 });
  // Follow (idempotent across runs: unfollow first if already following)
  const following = bob.page.locator('[aria-label="Following"]').first();
  if (await following.isVisible().catch(() => false)) {
    await following.click();
    await bob.page.locator('[aria-label="Follow"]').first().waitFor({ state: 'visible', timeout: 15_000 });
  }
  await bob.clickLabel('Follow');
  await bob.page.locator('[aria-label="Following"]').first().waitFor({ state: 'visible', timeout: 15_000 });
  // Friend request (reset first through the API if the pair is already friends / pending)
  const current = await rpc(bob.session, 'get_relationship', { p_target: alice.userId }).catch(() => null);
  if (current?.is_friend) await rpc(bob.session, 'unfriend', { p_other: alice.userId }).catch(() => undefined);
  if (current?.friend_request?.id) {
    if (current.friend_request.direction === 'outgoing') await rpc(bob.session, 'cancel_friend_request', { p_request: current.friend_request.id }).catch(() => undefined);
    else await rpc(bob.session, 'respond_friend_request', { p_request: current.friend_request.id, p_accept: false }).catch(() => undefined);
  }
  await bob.goto('/u/arena_qa_alice');
  await bob.clickText('Add friend');
  await bob.waitForText('Request sent', 15_000);
  // Alice accepts from Bob's profile (the request also appears under /requests and in her notifications)
  await alice.goto('/u/arena_qa_bob');
  await alice.clickText('Accept request');
  await sleep(2000);
  const rel = await rpc(alice.session, 'get_relationship', { p_target: bob.userId }).catch(() => null);
  if (!rel?.is_friend) throw new Error(`friend request was not accepted: ${JSON.stringify(rel)}`);
  // Bob's notifications: accepted
  await bob.goto('/notifications');
  await bob.waitForText('accepted your friend request', 30_000);
  await alice.goto('/notifications');
  await alice.waitForText('started following you', 20_000);
  return { isFriend: rel?.is_friend ?? 'unknown' };
}

async function storyScenario(alice, bob) {
  const stamp = Date.now().toString(36);
  await alice.goto('/compose/story');
  const input = alice.page.locator('textarea[placeholder="Type something…"], input[placeholder="Type something…"]').first();
  await input.waitFor({ state: 'visible', timeout: 45_000 });
  await input.fill(`Story ${stamp}`);
  await alice.clickText('Share story');
  await sleep(2500);
  await bob.goto(`/story/${alice.userId}`);
  await bob.waitForText(`Story ${stamp}`, 45_000);
  await bob.clickLabel('React ❤️');
  await alice.goto('/notifications');
  await alice.waitForText('reacted ❤️ to your story', 30_000);
  return { stamp };
}

async function searchScenario(alice) {
  await alice.goto('/search');
  const input = alice.page.locator('input[placeholder="Search people, posts, #hashtags"]').first();
  await input.waitFor({ state: 'visible', timeout: 45_000 });
  await input.fill('Arena QA Bob');
  await input.press('Enter');
  await alice.waitForText('Arena QA Bob', 30_000);
  await alice.clickText('Arena QA Bob', { exact: false });
  await alice.page.waitForURL(/\/u\/arena_qa_bob/, { timeout: 20_000 });
  return { found: true };
}

async function wouldYouRatherScenario(alice, bob) {
  const roomId = await createRoomViaUi(alice, 'Would You Rather');
  await startRoom(alice, bob, roomId);
  await alice.waitForText('Round 1 of', 30_000);
  await bob.waitForText('Round 1 of', 30_000);
  await alice.page.locator('[aria-label^="Option A"]').first().click();
  await expectAnswerRecorded(alice, roomId, 'wyr');
  await bob.page.locator('[aria-label^="Option A"]').first().click();
  await expectAnswerRecorded(bob, roomId, 'wyr');
  await alice.page.getByText(/Round 1 results|Round 2 of/).first().waitFor({ state: 'visible', timeout: 30_000 });
  const pct = await alice.hasText('100%', 5_000);
  const room = await rpc(alice.session, 'get_game_room', { p_room: roomId });
  const scores = room?.state?.scores ?? {};
  await leaveRoom(bob);
  await sleep(1500);
  if (scores[alice.userId] !== 10 || scores[bob.userId] !== 10) throw new Error(`unexpected WYR scores ${JSON.stringify(scores)}`);
  return { roomId, majorityShown: pct, scores };
}

async function pushSettingsScenario(alice) {
  await alice.goto('/settings/notifications');
  const card = alice.page.locator('[data-testid^="push-status:"]').first();
  await card.waitFor({ state: 'attached', timeout: 45_000 });
  await alice.page.waitForFunction(() => { const el = document.querySelector('[data-testid^="push-status:"]'); return el && el.getAttribute('data-testid') !== 'push-status:loading'; }, null, { timeout: 20_000 });
  const before = await card.getAttribute('data-testid');
  let after = before;
  if (before === 'push-status:off') {
    await alice.clickText('Turn on notifications');
    await sleep(6000);
    after = await alice.page.locator('[data-testid^="push-status:"]').first().getAttribute('data-testid');
  }
  if (after === 'push-status:on') {
    await alice.clickText('Send me a test notification');
    await sleep(2000);
  }
  const subs = await rest(alice.session, `web_push_subscriptions?user_id=eq.${alice.userId}&select=endpoint,created_at`).catch(() => []);
  return { before, after, browserSubscriptions: subs.length };
}

async function smokeScenario(alice) {
  const routes = ['/home', '/discover', '/videos', '/live', '/create', '/profile', '/inbox', '/calls', '/friends', '/requests', '/notifications', '/search', '/people/search', '/match', '/games', '/games/leaderboard/chess', '/challenges', '/studio', '/wallet', '/wallet/earnings', '/premium', '/settings', '/settings/account', '/settings/appearance', '/settings/blocked', '/settings/chats', '/settings/encryption', '/settings/notifications', '/settings/privacy', '/settings/security', '/settings/sessions', '/settings/verification', '/profile/edit', '/profile/highlights', '/chat/starred', '/chat/new', '/chat/new-group', '/live/go', '/compose/post', '/compose/story', '/compose/video', '/download', '/features', '/help', '/about'];
  const problems = [];
  for (const route of routes) {
    const errorsBefore = alice.errors.length;
    await alice.goto(route);
    await sleep(1800);
    // Playwright's Chromium ships without an H.264 decoder: a feed with real videos rejects play() with
    // "no supported source was found". Real browsers decode it; do not count it as an app error.
    alice.errors = alice.errors.filter((e, i) => i < errorsBefore || !/no supported source was found/i.test(e));
    // Screens that fetch before rendering may show only a spinner at first: allow up to 8 s for text to appear.
    let text = '';
    for (let waited = 0; waited < 8_000; waited += 500) {
      text = await alice.page.evaluate(() => document.body.innerText || '');
      if (text.trim()) break;
      await sleep(500);
    }
    const path = alice.path();
    const notFound = /This page doesn't exist/.test(text);
    const blank = text.trim().length < 20;
    const newErrors = alice.errors.slice(errorsBefore).filter((e) => e.startsWith('pageerror'));
    if (notFound || blank || newErrors.length) problems.push({ route, path, notFound, blank, newErrors });
  }
  if (problems.length) throw new Error(`routes with problems: ${JSON.stringify(problems).slice(0, 900)}`);
  return { routes: routes.length };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const browser = null;
let alice;
let bob;
try {
  const [aliceSession, bobSession] = await Promise.all([signIn(ACCOUNTS.alice.email, ACCOUNTS.alice.password), signIn(ACCOUNTS.bob.email, ACCOUNTS.bob.password)]);
  alice = await new Actor('alice', browser, aliceSession).open();
  bob = await new Actor('bob', browser, bobSession).open();
  actorsForShots = [alice, bob];
  log('signed in as', aliceSession.user.email, 'and', bobSession.user.email);

  // Hygiene: leave rooms and calls left over from an interrupted run.
  for (const actor of [alice, bob]) {
    const lobby = await rpc(actor.session, 'list_game_rooms', {}).catch(() => null);
    for (const room of lobby?.mine ?? []) await rpc(actor.session, 'leave_game_room', { p_room: room.id }).catch(() => undefined);
  }
  let conversationId = null;
  if (only.includes('chat') || only.includes('call')) {
    conversationId = await rpc(alice.session, 'start_direct_conversation', { p_user: bob.userId });
    log('conversation', conversationId);
    const active = await rpc(alice.session, 'get_active_call', { p_conversation: conversationId }).catch(() => null);
    if (active?.id) await rpc(alice.session, 'leave_call', { p_call: active.id, p_reason: 'qa-reset' }).catch(() => undefined);
  }
  if (only.includes('notifications')) await scenario('Notifications bell stays inside the app', () => notificationsScenario(alice, bob));
  if (only.includes('social')) await scenario('Post → like → comment → notifications → deep link', () => postsScenario(alice, bob));
  if (only.includes('social')) await scenario('Follow + friend request + accept + notifications', () => followAndFriendsScenario(alice, bob));
  if (only.includes('story')) await scenario('Story: compose, view, react, notification', () => storyScenario(alice, bob));
  if (only.includes('search')) await scenario('Search finds people and opens the profile', () => searchScenario(alice));
  if (only.includes('push')) await scenario('Push status card: shows state, enables, sends a test', () => pushSettingsScenario(alice));
  if (only.includes('chat')) await scenario('End-to-end encrypted chat between two accounts', () => chatScenario(alice, bob, conversationId));
  if (only.includes('call')) await scenario('Voice call rings, connects on both sides and ends cleanly', () => callScenario(alice, bob, conversationId));
  const wants = (key) => only.includes(key) || only.includes('games');
  if (wants('trivia')) await scenario('Trivia room: start, answer, reveal, next round, results', () => triviaScenario(alice, bob));
  if (wants('chess')) await scenario('Chess room: legal moves, resign, winner recorded', () => chessScenario(alice, bob));
  if (wants('ludo')) await scenario('Ludo room: rolls and token moves through the engine', () => ludoScenario(alice, bob));
  if (wants('tod')) await scenario('Truth or Dare room: choose, perform, vote, score', () => truthOrDareScenario(alice, bob));
  if (wants('wyr')) await scenario('Would You Rather room: everyone answers, majority scores', () => wouldYouRatherScenario(alice, bob));
  if (wants('song')) await scenario('Guess the Song availability is stated honestly in the lobby', () => guessTheSongScenario(alice));
  if (only.includes('smoke')) await scenario('Every signed-in screen renders without errors', () => smokeScenario(alice));
} catch (error) {
  results.push({ name: 'setup', ok: false, error: error instanceof Error ? error.message : String(error) });
  log('✖ setup —', error instanceof Error ? error.message : String(error));
} finally {
  const report = { base: BASE, finishedAt: new Date().toISOString(), results, pageErrors: { alice: alice?.errors ?? [], bob: bob?.errors ?? [] }, network: { alice: alice?.network ?? [], bob: bob?.network ?? [] }, logs };
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  for (const actor of [alice, bob]) await actor?.context?.close().catch(() => undefined);
}

const failed = results.filter((r) => !r.ok);
console.log('\n' + results.map((r) => `${r.ok ? '✔' : '✖'} ${r.name}${r.ok ? '' : ` — ${r.error}`}`).join('\n'));
if (alice?.errors.length || bob?.errors.length) {
  console.log(`\nBrowser errors: alice=${alice?.errors.length ?? 0} bob=${bob?.errors.length ?? 0} (see qa-artifacts/report.json)`);
}
for (const actor of [alice, bob]) {
  if (actor?.network?.length) console.log(`\n${actor.name} failed requests:\n` + actor.network.map((n) => `  ${n.status} ${n.method} ${n.url} ${n.body}`).join('\n'));
}
process.exit(failed.length ? 1 : 0);
