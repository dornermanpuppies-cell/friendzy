#!/usr/bin/env node
/**
 * Serves an `expo export --platform web` folder the way Netlify serves it:
 * clean URLs (`/inbox` → `inbox.html`), the rewrite rules from `dist/_redirects`
 * for dynamic routes (`/chat/<id>` → `chat/_id_.html`) and `404.html` for the rest.
 *
 *   node scripts/qa/serve-dist.mjs [dist] [--port 4173] [--host 127.0.0.1]
 *
 * Run `node scripts/netlify-redirects.mjs dist` after the export so the rules exist.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const dist = path.resolve(args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) ?? 'dist');
const port = Number(flag('port', process.env.PORT ?? 4173));
const host = flag('host', '127.0.0.1');

if (!fs.existsSync(dist)) {
  console.error(`✖ ${dist} does not exist — run "npx expo export --platform web" first.`);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.wasm': 'application/wasm',
};

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const redirectsFile = path.join(dist, '_redirects');
const rules = fs.existsSync(redirectsFile)
  ? fs
      .readFileSync(redirectsFile, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const [from, to, status] = line.split(/\s+/);
        const pattern = from
          .split('/')
          .map((segment) => (segment === '*' ? '.*' : segment.startsWith(':') ? '[^/]+' : escapeRegExp(segment)))
          .join('/');
        return { from, to, status: Number(status || 200), re: new RegExp(`^${pattern}/?$`) };
      })
  : [];

function resolve(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  const candidates = p === '' || p === '/' ? ['/index.html'] : [p, `${p}.html`, `${p}/index.html`];
  for (const candidate of candidates) {
    const file = path.join(dist, candidate);
    if (file.startsWith(dist) && fs.existsSync(file) && fs.statSync(file).isFile()) return { file, status: 200 };
  }
  for (const rule of rules) {
    if (rule.re.test(p)) {
      const file = path.join(dist, rule.to);
      if (fs.existsSync(file)) return { file, status: rule.status };
    }
  }
  const notFound = path.join(dist, '404.html');
  return fs.existsSync(notFound) ? { file: notFound, status: 404 } : null;
}

const server = http.createServer((req, res) => {
  const hit = resolve(req.url ?? '/');
  if (!hit) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  const ext = path.extname(hit.file).toLowerCase();
  res.writeHead(hit.status, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(hit.file).pipe(res);
});

server.listen(port, host, () => {
  console.log(`▶ serving ${path.relative(process.cwd(), dist) || '.'} at http://${host}:${port} (${rules.length} rewrite rule(s))`);
});
