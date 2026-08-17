#!/usr/bin/env node
/**
 * check-unchecked-dbinsert.mjs — lying-success detector for `dbInsert` callers.
 *
 * `dbInsert(db, table, row)` returns `{ error }` on failure. A caller that invokes it
 * as a BARE `await dbInsert(...)` statement — without capturing the result — silently
 * drops the row on any insert failure (NOT NULL / CHECK / FK / missing-table) and
 * returns a lying-success (200 that persisted nothing). Two real incidents came from
 * this class: form_submissions (every submission dropped) + the contact form (sent an
 * email, stored nothing). This detector surfaces the remaining unchecked callers.
 *
 * Heuristic (per validator-precision-discipline — prefers false-negatives):
 *   A `dbInsert(` call is UNCHECKED iff it is NOT the right-hand side of an assignment
 *   (`const { error } = await dbInsert(…)` or `const res = await dbInsert(…)`). Only a
 *   truly-bare `await dbInsert(…)` / `void dbInsert(…)` / `return dbInsert(…)` statement
 *   is flagged — a captured result is assumed checked (softer issue, not flagged).
 *   INGESTION-table callers (user-generated rows the admin displays) rank HIGH.
 *
 * Exit 0 always (report-only / audit-arc "Surface" step). Pass `--ci` to exit 1 on any
 * HIGH (ingestion) finding once the surface is stable at zero.
 *
 * Usage: node scripts/check-unchecked-dbinsert.mjs [--ci] [--json]
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = [join(APP_DIR, 'src'), join(APP_DIR, 'libs')];

/** Tables holding user-generated rows the admin later displays — a dropped insert is user-visible data loss. */
const INGESTION_TABLES = new Set([
  'contacts',
  'form_submissions',
  'newsletter_subscribers',
  'leads',
  'scanned_leads',
  'donations',
  'pulse_posts',
  'social_publishes',
  'social_posts',
  'social_analytics_snapshots',
  'voice_calls',
  'voice_recordings',
  'voice_numbers',
  'storefront_products',
  'orders',
]);

/** Recursively collect .ts files (skip .d.ts + __tests__). */
function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === '__tests__' || ent.name === 'node_modules') continue;
      out.push(...walk(p));
    } else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** The ~90 chars before an index that captures an assignment head (`const { error } = await `). */
const ASSIGNED_RE = /(?:const|let|var)\s*(?:\{[^}]*\}|[\w$]+)\s*=\s*(?:await\s+)?$/;

const findings = [];
for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('dbInsert')) continue;
    const rel = relative(APP_DIR, file);
    // Resolve aliased imports (`const { dbInsert: dbIns } = …`) so calls via the
    // alias (`await dbIns(...)`) are scanned too. A literal-only `dbInsert(` regex
    // missed them — the site_snapshots create used `dbIns`/`snpInsert` aliases and
    // slipped this CI gate (a real lying-success bug, fire 16).
    const aliases = new Set(['dbInsert']);
    const aliasRe = /\{[^}]*\bdbInsert\s*:\s*([A-Za-z_$][\w$]*)/g;
    let am;
    while ((am = aliasRe.exec(text)) !== null) aliases.add(am[1]);
    const re = new RegExp(`\\b(?:${[...aliases].join('|')})\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      const before = text.slice(Math.max(0, m.index - 90), m.index);
      if (ASSIGNED_RE.test(before)) continue; // captured → assumed checked
      // Extract the target table — a 2nd-arg string literal, OR an identifier
      // resolved from a same-file `const TABLE = 'literal'` (the lead_store.ts:57
      // case the literal-only regex missed → a false-negative on an ingestion table).
      const after = text.slice(m.index, m.index + 160);
      const litM = after.match(/[\w$]+\s*\(\s*[^,]+,\s*['"]([^'"]+)['"]/);
      let table = '(dynamic)';
      if (litM) {
        table = litM[1];
      } else {
        const identM = after.match(/[\w$]+\s*\(\s*[^,]+,\s*([A-Za-z_$][\w$]*)\s*[,)]/);
        if (identM) {
          const constM = text.match(
            new RegExp(`(?:const|let|var)\\s+${identM[1]}\\s*=\\s*['"]([^'"]+)['"]`),
          );
          if (constM) table = constM[1];
        }
      }
      const line = text.slice(0, m.index).split('\n').length;
      findings.push({
        file: rel,
        line,
        table,
        severity: INGESTION_TABLES.has(table) ? 'HIGH' : 'low',
      });
    }
  }
}

const high = findings.filter((f) => f.severity === 'HIGH');
const low = findings.filter((f) => f.severity === 'low');

if (process.argv.includes('--json')) {
  process.stdout.write(
    JSON.stringify({ total: findings.length, high: high.length, findings }, null, 2) + '\n',
  );
} else if (findings.length === 0) {
  console.log('✅ check-unchecked-dbinsert: clean — every dbInsert result is captured.');
} else {
  console.log(
    `⚠️  check-unchecked-dbinsert: ${findings.length} bare dbInsert call(s) (${high.length} HIGH ingestion):`,
  );
  for (const f of [...high, ...low]) {
    console.log(
      `   ${f.severity === 'HIGH' ? 'HIGH' : 'low '} ${f.file}:${f.line} → ${f.table}${f.severity === 'HIGH' ? '  (ingestion — capture { error } and surface it)' : ''}`,
    );
  }
  console.log(
    '   Fix: `const { error } = await dbInsert(...)` then log/throw on error — never a bare await.',
  );
}

process.exit(process.argv.includes('--ci') && high.length > 0 ? 1 : 0);
