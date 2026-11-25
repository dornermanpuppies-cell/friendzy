#!/usr/bin/env node
/**
 * Friendzy database test runner.
 *
 * Starts a throwaway PostgreSQL (embedded-postgres), bootstraps a Supabase-like
 * environment (auth/storage schemas, roles, realtime publication), applies every
 * migration in supabase/migrations in order, then runs every *.test.sql file in
 * supabase/tests. Each test file runs inside its own transaction and is rolled
 * back afterwards, so tests are isolated.
 *
 *   npm run db:test            # run everything
 *   npm run db:test -- --keep  # keep the server running after tests (prints connection string)
 *   npm run db:test -- --only 0003   # only run test files whose name contains "0003"
 */
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const keep = args.includes('--keep');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

const port = 54300 + Math.floor(Math.random() * 500);
const dataDir = mkdtempSync(path.join(tmpdir(), 'friendzy-pg-'));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => undefined,
  onError: () => undefined,
});

function lineFromPosition(sql, position) {
  if (!position) return null;
  const upto = sql.slice(0, Number(position));
  return upto.split('\n').length;
}

function listSql(dir, suffix) {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(suffix))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

async function runFile(client, file, { transactional }) {
  const sql = readFileSync(file, 'utf8');
  const started = Date.now();
  if (transactional) await client.query('begin');
  try {
    await client.query(sql);
    if (transactional) await client.query('rollback');
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    if (transactional) await client.query('rollback').catch(() => undefined);
    const line = lineFromPosition(sql, error.position);
    return { ok: false, ms: Date.now() - started, error, line };
  }
}

function describeError(file, { error, line }) {
  const where = line ? `${path.relative(root, file)}:${line}` : path.relative(root, file);
  const parts = [`✖ ${where}`, `  ${error.severity ?? 'ERROR'} ${error.code ?? ''}: ${error.message}`];
  if (error.detail) parts.push(`  DETAIL: ${error.detail}`);
  if (error.hint) parts.push(`  HINT: ${error.hint}`);
  if (error.where) parts.push(`  WHERE: ${String(error.where).split('\n').slice(0, 6).join('\n         ')}`);
  return parts.join('\n');
}

let failed = 0;
try {
  console.log(`▶ starting PostgreSQL on port ${port}`);
  await pg.initialise();
  await pg.start();
  const client = pg.getPgClient();
  await client.connect();
  const { rows } = await client.query('select version()');
  console.log(`  ${rows[0].version.split(',')[0]}`);

  console.log('▶ bootstrap (Supabase-like environment)');
  const boot = await runFile(client, path.join(root, 'scripts/db/bootstrap.sql'), { transactional: false });
  if (!boot.ok) {
    console.error(describeError(path.join(root, 'scripts/db/bootstrap.sql'), boot));
    process.exit(1);
  }

  console.log('▶ migrations');
  for (const file of listSql(path.join(root, 'supabase/migrations'), '.sql')) {
    const result = await runFile(client, file, { transactional: false });
    if (result.ok) {
      console.log(`  ✔ ${path.basename(file)} (${result.ms} ms)`);
    } else {
      console.error(describeError(file, result));
      failed += 1;
      break;
    }
  }

  if (failed === 0) {
    console.log('▶ tests');
    const tests = listSql(path.join(root, 'supabase/tests'), '.test.sql').filter((f) => !only || path.basename(f).includes(only));
    if (tests.length === 0) console.log('  (no test files)');
    for (const file of tests) {
      const result = await runFile(client, file, { transactional: true });
      if (result.ok) {
        console.log(`  ✔ ${path.basename(file)} (${result.ms} ms)`);
      } else {
        console.error(describeError(file, result));
        failed += 1;
      }
    }
  }

  // Sanity: every public table must have RLS enabled.
  if (failed === 0) {
    const noRls = await client.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`,
    );
    if (noRls.rows.length) {
      console.error(`✖ tables without Row Level Security: ${noRls.rows.map((r) => r.relname).join(', ')}`);
      failed += 1;
    } else {
      const count = await client.query(`select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`);
      console.log(`  ✔ RLS enabled on all ${count.rows[0].n} public tables`);
    }
  }

  if (keep) {
    console.log(`\nServer kept running: postgres://postgres:postgres@127.0.0.1:${port}/postgres  (Ctrl+C to stop)`);
    await new Promise(() => undefined);
  }
  await client.end();
} catch (error) {
  console.error('✖ runner error', error);
  failed += 1;
} finally {
  if (!keep) {
    await pg.stop().catch(() => undefined);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

if (failed > 0) {
  console.error(`\n${failed} failure(s)`);
  process.exitCode = 1;
} else {
  console.log('\nAll database checks passed.');
}
