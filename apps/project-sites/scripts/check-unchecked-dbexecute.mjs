#!/usr/bin/env node
/**
 * check-unchecked-dbexecute.mjs — lying-success detector for raw `dbExecute` UPDATE/DELETE.
 *
 * `dbExecute(db, sql, params)` returns `{ error, changes }` and NEVER throws (it catches
 * internally). A BARE `await dbExecute(...)` whose SQL is an `UPDATE`/`DELETE` — without
 * capturing the result — has the SAME two silent-failure modes as an unchecked `dbUpdate`,
 * but the sibling `check-unchecked-dbupdate.mjs` MISSES it (that scanner only matches the
 * `dbUpdate(` helper, not raw `dbExecute(` with hand-written SQL):
 *   1. `error != null` — a genuine DB failure → the mutation was NOT applied but the handler
 *      returns a lying 200 ("saved"/"cancelled"/"removed").
 *   2. `changes === 0` — the WHERE matched NO row (wrong id, wrong org, already soft-deleted)
 *      → nothing mutated, yet a lying 200. When the WHERE is the SOLE ownership guard this
 *      also MASKS an authz gap (mutating another org's row silently no-ops but "succeeds").
 *
 * Scope: only `UPDATE`/`DELETE` SQL is flagged (the two-axis class). Raw `dbExecute(INSERT…)`
 * is the dbInsert discipline (error-only, no changes===0/404) and `SELECT`/DDL don't mutate.
 *
 * Heuristic (prefers false-negatives, per validator-precision-discipline): a call is UNCHECKED
 * iff it is NOT the right-hand side of an assignment (`const { error, changes } = await …` /
 * `const r = await …`). Callers in a user-facing `routes/` or feature `handlers.ts` file rank
 * HIGH — a lost mutation there is directly user-visible.
 *
 * Exit 0 always (report-only / audit-arc "Surface" step). Pass `--ci` to exit 1 on any HIGH
 * finding once the surface is stable at zero (then promote into the `check` aggregator).
 *
 * Usage: node scripts/check-unchecked-dbexecute.mjs [--ci] [--json]
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = [join(APP_DIR, 'src'), join(APP_DIR, 'libs')];

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

/** A user-facing mutation endpoint — a bare dbExecute here loses a user's action visibly. */
const isUserFacing = (rel) => /(^|\/)routes\//.test(rel) || /\/handlers\.ts$/.test(rel);

/** ~90 chars before the call that capture an assignment head (`const { error, changes } = await `). */
const ASSIGNED_RE = /(?:const|let|var)\s*(?:\{[^}]*\}|[\w$]+)\s*=\s*(?:await\s+)?$/;

/** 2nd arg (the SQL) starts with UPDATE or DELETE — quote or backtick, whitespace/newline tolerant. */
const UPDATE_DELETE_RE = /dbExecute\s*\(\s*[^,]+,\s*[`'"]\s*(UPDATE|DELETE)\b/i;
/** Grab the mutated table name for the report. */
const TABLE_RE = /(?:UPDATE|DELETE\s+FROM)\s+([A-Za-z_][A-Za-z0-9_]*)/i;

const findings = [];
for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('dbExecute(')) continue;
    const rel = relative(APP_DIR, file);
    const re = /\bdbExecute\s*\(/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const before = text.slice(Math.max(0, m.index - 90), m.index);
      if (ASSIGNED_RE.test(before)) continue; // captured → assumed checked
      const after = text.slice(m.index, m.index + 320);
      if (!UPDATE_DELETE_RE.test(after)) continue; // only UPDATE/DELETE are the two-axis class
      const tableM = after.match(TABLE_RE);
      const table = tableM ? tableM[1] : '(dynamic)';
      const line = text.slice(0, m.index).split('\n').length;
      findings.push({ file: rel, line, table, severity: isUserFacing(rel) ? 'HIGH' : 'low' });
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
  console.log('✅ check-unchecked-dbexecute: clean — every dbExecute UPDATE/DELETE result is captured.');
} else {
  console.log(
    `⚠️  check-unchecked-dbexecute: ${findings.length} bare dbExecute UPDATE/DELETE call(s) (${high.length} HIGH user-facing mutation):`,
  );
  for (const f of [...high, ...low]) {
    console.log(
      `   ${f.severity === 'HIGH' ? 'HIGH' : 'low '} ${f.file}:${f.line} → ${f.table}${f.severity === 'HIGH' ? '  (capture { error, changes }; throw on error; 404 on changes===0 for a sole-guard edit)' : ''}`,
    );
  }
  console.log(
    '   Fix: `const { error, changes } = await dbExecute(...)` — throw on error; 404 when changes===0 for a sole-guard mutation-by-id.',
  );
}

process.exit(process.argv.includes('--ci') && high.length > 0 ? 1 : 0);
