#!/usr/bin/env node
/**
 * Bundles an Edge Function that imports shared TypeScript (e.g. game-engine →
 * ../_shared/games) into a single file, so it can be deployed through the
 * Supabase Management API, which accepts one source body per function.
 * `npm:` / `jsr:` / URL imports stay external (Deno resolves them at runtime).
 *
 *   node scripts/bundle-function.mjs game-engine [out-file]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const slug = process.argv[2];
if (!slug) {
  console.error('usage: node scripts/bundle-function.mjs <function-slug> [out-file]');
  process.exit(2);
}
const entry = path.join('supabase', 'functions', slug, 'index.ts');
if (!fs.existsSync(entry)) {
  console.error(`✖ ${entry} not found`);
  process.exit(2);
}
const out = process.argv[3] ?? path.join('.expo', 'function-bundles', `${slug}.ts`);
fs.mkdirSync(path.dirname(out), { recursive: true });

execFileSync(
  'npx',
  ['-y', 'esbuild@0.24.2', entry, '--bundle', '--format=esm', '--platform=neutral', '--target=esnext', '--external:npm:*', '--external:jsr:*', '--external:https://*', '--external:node:*', '--legal-comments=none', `--outfile=${out}`],
  { stdio: 'inherit' },
);

const sharedDirs = new Set();
for (const line of fs.readFileSync(out, 'utf8').split('\n')) {
  const m = /^\/\/ (supabase\/functions\/_shared\/[^/]+)\//.exec(line);
  if (m) sharedDirs.add(m[1].replace('supabase/functions/', ''));
}
const header = `// Friendzy — ${slug} (bundled from supabase/functions/${slug}${sharedDirs.size ? ` + ${[...sharedDirs].join(', ')}` : ''}; edit the sources, not this file)\n`;
fs.writeFileSync(out, header + fs.readFileSync(out, 'utf8'));
console.log(`✔ ${out} (${(fs.statSync(out).size / 1024).toFixed(1)} KB)`);
