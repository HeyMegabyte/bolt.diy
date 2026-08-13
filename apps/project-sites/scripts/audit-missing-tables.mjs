#!/usr/bin/env node
/**
 * audit-missing-tables.mjs — find `libs/features/*` modules whose write path
 * INSERTs into a D1 table that DOES NOT EXIST in production.
 *
 * WHY: several dark-launch modules ship handlers/service + a live flag but were
 * never actually deployed — their table was never migrated. Because `dbExecute`
 * swallows the "no such table" error, `POST` returns a LYING 201 and the row never
 * persists (the list stays empty). This detector maps each module's INSERT target
 * table and checks it against `sqlite_master` on the prod DB, so the resurrection
 * backlog is objective, not guessed.
 *
 * Discovered incidents: analytics_annotations (fire-21) + site_tags (fire-22) were
 * both missing their tables; this audit then found credit_wallet_ledger,
 * site_personalization_variants, booking_appointments, payments_rail_events too.
 *
 * Usage (needs CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL + CLOUDFLARE_ACCOUNT_ID):
 *   node scripts/audit-missing-tables.mjs
 *   node scripts/audit-missing-tables.mjs --json
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FEATURES = join(ROOT, 'libs', 'features');
const DB = 'project-sites-db-production';
const JSON_OUT = process.argv.includes('--json');

/** Map each feature module → the set of tables it INSERTs into. */
function moduleTables() {
  const out = {};
  for (const m of readdirSync(FEATURES, { withFileTypes: true })) {
    if (!m.isDirectory()) continue;
    const tables = new Set();
    for (const f of ['service.ts', 'handlers.ts']) {
      const p = join(FEATURES, m.name, f);
      if (!existsSync(p)) continue;
      const src = readFileSync(p, 'utf8');
      for (const match of src.matchAll(/INSERT\s+(?:OR\s+(?:IGNORE|REPLACE)\s+)?INTO\s+([a-z_]+)/gi)) {
        tables.add(match[1]);
      }
    }
    if (tables.size) out[m.name] = [...tables];
  }
  return out;
}

/** Query prod D1 for the set of existing table names. */
function existingTables(want) {
  const inList = want.map((t) => `'${t}'`).join(',');
  const sql = `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${inList})`;
  const raw = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', sql],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const parsed = JSON.parse(raw);
  return new Set((parsed?.[0]?.results ?? []).map((r) => r.name));
}

const map = moduleTables();
const allTables = [...new Set(Object.values(map).flat())];
const exists = existingTables(allTables);

const findings = [];
for (const [mod, tables] of Object.entries(map)) {
  const missing = tables.filter((t) => !exists.has(t));
  if (missing.length) findings.push({ module: mod, missing });
}

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ checkedModules: Object.keys(map).length, findings }, null, 2) + '\n');
} else {
  console.log(`Checked ${Object.keys(map).length} mutation modules against ${DB}.`);
  if (!findings.length) {
    console.log('✅ Every module INSERTs into an existing table — no lying-success risk.');
  } else {
    console.log(`❌ ${findings.length} module(s) INSERT into a MISSING table (writes lie-success):`);
    for (const f of findings) console.log(`   - ${f.module} → ${f.missing.join(', ')}`);
    console.log('\nEach needs a CREATE TABLE migration before its write endpoints persist.');
  }
}
process.exit(findings.length ? 1 : 0);
