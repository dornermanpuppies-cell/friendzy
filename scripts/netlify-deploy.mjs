#!/usr/bin/env node
/**
 * Deploys the static export straight to Netlify through its API (zip deploy),
 * without waiting for a GitHub push. Useful for hotfixes; the next git push
 * triggers a normal build again.
 *
 *   NETLIFY_AUTH_TOKEN=… node scripts/netlify-deploy.mjs [dist] [--site <site-id>] [--draft]
 *
 * Steps: writes dist/_headers from the [[headers]] blocks in netlify.toml (file
 * deploys do not read netlify.toml), zips dist, uploads it, then polls the deploy
 * until it is ready and prints the URL. The token is read from the environment only.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const dist = path.resolve(args.find((a) => !a.startsWith('--')) ?? 'dist');
const flag = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const siteId = flag('site') ?? process.env.NETLIFY_SITE_ID ?? '29822b29-59d8-408e-a964-5d842ca1bd5b';
const draft = args.includes('--draft');
const token = process.env.NETLIFY_AUTH_TOKEN;

if (!token) {
  console.error('✖ NETLIFY_AUTH_TOKEN is not set.');
  process.exit(2);
}
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error(`✖ ${dist} has no index.html — run "npx expo export --platform web" and "node scripts/netlify-redirects.mjs dist" first.`);
  process.exit(2);
}

// netlify.toml [[headers]] → dist/_headers
const toml = fs.existsSync('netlify.toml') ? fs.readFileSync('netlify.toml', 'utf8') : '';
const headerBlocks = [];
let current = null;
for (const raw of toml.split('\n')) {
  const line = raw.trim();
  if (line === '[[headers]]') {
    current = { for: null, values: [] };
    headerBlocks.push(current);
    continue;
  }
  if (!current) continue;
  if (/^\[\[/.test(line) && line !== '[[headers]]') {
    current = null;
    continue;
  }
  const forMatch = /^for\s*=\s*"(.+)"$/.exec(line);
  if (forMatch) current.for = forMatch[1];
  const valueMatch = /^([A-Za-z0-9-]+)\s*=\s*"(.+)"$/.exec(line);
  if (valueMatch && line.toLowerCase() !== 'for') current.values.push(`${valueMatch[1]}: ${valueMatch[2]}`);
}
const headerLines = headerBlocks.filter((b) => b.for && b.values.length).flatMap((b) => [b.for, ...b.values.map((v) => `  ${v}`)]);
if (headerLines.length) fs.writeFileSync(path.join(dist, '_headers'), `${headerLines.join('\n')}\n`);

const zip = path.join(os.tmpdir(), `friendzy-deploy-${Date.now()}.zip`);
execFileSync('zip', ['-qr', zip, '.'], { cwd: dist, stdio: 'inherit' });
const size = fs.statSync(zip).size;
console.log(`▶ uploading ${(size / 1024 / 1024).toFixed(1)} MB to site ${siteId}${draft ? ' (draft)' : ''}…`);

const upload = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys${draft ? '?draft=true' : ''}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/zip' },
  body: fs.readFileSync(zip),
});
fs.rmSync(zip, { force: true });
if (!upload.ok) {
  console.error(`✖ upload failed: ${upload.status} ${await upload.text()}`);
  process.exit(1);
}
const deploy = await upload.json();
console.log(`  deploy ${deploy.id} created (state: ${deploy.state})`);

for (let i = 0; i < 60; i += 1) {
  await new Promise((r) => setTimeout(r, 5000));
  const res = await fetch(`https://api.netlify.com/api/v1/deploys/${deploy.id}`, { headers: { Authorization: `Bearer ${token}` } });
  const current = await res.json();
  if (current.state === 'ready') {
    console.log(`✔ live: ${draft ? current.deploy_ssl_url : current.ssl_url ?? current.deploy_ssl_url}`);
    process.exit(0);
  }
  if (current.state === 'error') {
    console.error(`✖ deploy failed: ${current.error_message ?? 'unknown error'}`);
    process.exit(1);
  }
  console.log(`  …${current.state}`);
}
console.error('✖ timed out waiting for the deploy to become ready');
process.exit(1);
