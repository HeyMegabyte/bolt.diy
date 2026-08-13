#!/usr/bin/env node
/**
 * audit-schema-migrations-applied.mjs — detect tables DECLARED in migrations/*.sql
 * but MISSING from the live prod D1. Prod migrations here are applied ad-hoc, so a
 * migration can silently never-apply (fire-26: 0514 died on a legacy flag INSERT;
 * fire-27: 0534/0535 just slipped through). A missing table makes its feature
 * lie-success on write + lie-empty on read — invisible to render-integrity gates.
 *
 * Severity:
 *   - HIGH  — missing AND a live src/ route/service INSERTs into it (real broken feature)
 *   - LOW   — missing but no live INSERT (likely dead/superseded/dev-only)
 * Dropped-by-a-later-migration tables + *_new/*_v2 rename intermediates are excluded.
 *
 * Exit 1 when any HIGH finding exists (a live feature is silently broken).
 *
 * Run: CLOUDFLARE_API_KEY=.. CLOUDFLARE_EMAIL=.. CLOUDFLARE_ACCOUNT_ID=.. \
 *   node scripts/audit-schema-migrations-applied.mjs [--json]
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = 'project-sites-db-production';
const wantJson = process.argv.includes('--json');

/** Extract lowercased table names matched by `re` across every migration file. */
function scanMigrations(re) {
  const dir = join(ROOT, 'migrations');
  const out = new Set();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql'))) {
    const sql = readFileSync(join(dir, f), 'utf8');
    for (const m of sql.matchAll(re)) out.add(m[1].toLowerCase());
  }
  return out;
}

const declared = scanMigrations(/CREATE TABLE (?:IF NOT EXISTS )?[`"']?([a-z_][a-z0-9_]*)/gi);
const dropped = scanMigrations(/DROP TABLE (?:IF EXISTS )?[`"']?([a-z_][a-z0-9_]*)/gi);

// Live prod tables via wrangler.
let prod = new Set();
try {
  const raw = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', "SELECT name FROM sqlite_master WHERE type='table'"],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const parsed = JSON.parse(raw);
  const rows = (Array.isArray(parsed) ? parsed[0]?.results : parsed?.result?.[0]?.results) ?? [];
  prod = new Set(rows.map((r) => String(r.name).toLowerCase()));
} catch (e) {
  console.error('FATAL: could not query prod D1 (need CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL + CLOUDFLARE_ACCOUNT_ID):', e.message);
  process.exit(2);
}

// Missing = declared − prod − dropped − rename-intermediates.
const missing = [...declared]
  .filter((t) => !prod.has(t) && !dropped.has(t))
  .filter((t) => !/_(new|v\d+)$/.test(t))
  .sort();

// A missing table is HIGH severity when a live (non-test) src file INSERTs into it
// via the D1 binding. Durable Objects manage their OWN SQLite storage (this.sql /
// ctx.storage.sql, self-schema'd at boot) — those tables are NOT in D1 by design, so
// a DO-storage INSERT is NOT a missing-D1-table bug (validator-precision, fire-27).
function liveInsert(table) {
  // Match BOTH raw `INSERT INTO <table>` AND the `dbInsert(db, '<table>', …)` /
  // `dbUpsert(db, '<table>', …)` helper pattern (many routes write via the helper —
  // a raw-INSERT-only scan under-reports, a false-negative that hides real bugs).
  const pattern = `INSERT INTO \`?${table}\`?( |\\()|db(Insert|Upsert)\\([^,]+,[[:space:]]*['\\"]${table}['\\"]`;
  try {
    const hit = execFileSync(
      'grep',
      ['-rlE', pattern, 'src/'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .split('\n')
      .filter((f) => f && !/\.(test|spec)\./.test(f))
      .filter((f) => !f.includes('/durable_objects/')); // DO SQLite ≠ D1
    return hit[0] ?? null;
  } catch {
    return null; // grep exits 1 on no match
  }
}

const findings = missing.map((table) => {
  const src = liveInsert(table);
  return { table, severity: src ? 'HIGH' : 'LOW', writtenBy: src ? src.replace(/^src\//, '') : null };
});
const high = findings.filter((f) => f.severity === 'HIGH');

if (wantJson) {
  console.log(JSON.stringify({ declared: declared.size, prod: prod.size, missing: missing.length, high: high.length, findings }, null, 2));
} else {
  console.log(`\n  Schema-migration-applied audit — ${declared.size} declared / ${prod.size} in prod`);
  console.log(`  ${missing.length} declared-but-missing (${high.length} HIGH — live write path)\n`);
  for (const f of findings) {
    const tag = f.severity === 'HIGH' ? '❌ HIGH' : '·  low ';
    console.log(`  ${tag}  ${f.table}${f.writtenBy ? `  ← ${f.writtenBy}` : ''}`);
  }
  console.log(
    high.length
      ? `\n  ${high.length} live feature(s) silently broken — apply the migration(s) that declare these tables.\n`
      : '\n  ✅ No live feature is missing its table.\n',
  );
}

process.exit(high.length ? 1 : 0);
