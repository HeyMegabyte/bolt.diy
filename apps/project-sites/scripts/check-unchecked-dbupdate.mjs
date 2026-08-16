#!/usr/bin/env node
/**
 * check-unchecked-dbupdate.mjs — lying-success detector for `dbUpdate` callers.
 *
 * `dbUpdate(db, table, updates, where, params)` returns `{ error, changes }` and (via
 * dbExecute) NEVER throws. A caller that invokes it as a BARE `await dbUpdate(...)`
 * statement — without capturing the result — has TWO silent-failure modes:
 *   1. `error != null` — a genuine DB failure (CHECK / FK / missing column) → the edit
 *      was NOT applied but the handler returns a lying 200 ("saved").
 *   2. `changes === 0` — the WHERE matched NO row (wrong id, wrong org, soft-deleted) →
 *      nothing updated, yet a lying 200. This also MASKS an authz gap: editing another
 *      org's row silently no-ops but "succeeds" (IDOR-adjacent, per x-org-id-idor-class).
 *
 * Sibling of check-unchecked-dbinsert.mjs. Same heuristic (prefers false-negatives):
 *   A `dbUpdate(` call is UNCHECKED iff it is NOT the right-hand side of an assignment
 *   (`const { error } = await dbUpdate(…)` / `const res = await dbUpdate(…)`). Only a
 *   truly-bare `await dbUpdate(…)` / `void dbUpdate(…)` / `return dbUpdate(…)` is flagged.
 *   A captured result is assumed checked (softer issue — capturing but ignoring `changes`
 *   is a per-handler judgment the fixer makes, not flagged here).
 *   Callers in a user-facing `routes/` or feature `handlers.ts` file (a PATCH/PUT edit a
 *   user relies on) rank HIGH — a lost edit there is directly user-visible.
 *
 * Exit 0 always (report-only / audit-arc "Surface" step). Pass `--ci` to exit 1 on any
 * HIGH finding once the surface is stable at zero.
 *
 * Usage: node scripts/check-unchecked-dbupdate.mjs [--ci] [--json]
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

/** A user-facing edit endpoint — a bare dbUpdate here loses a user's edit visibly. */
const isUserFacing = (rel) => /(^|\/)routes\//.test(rel) || /\/handlers\.ts$/.test(rel);

/** The ~90 chars before an index that captures an assignment head (`const { error } = await `). */
const ASSIGNED_RE = /(?:const|let|var)\s*(?:\{[^}]*\}|[\w$]+)\s*=\s*(?:await\s+)?$/;

const findings = [];
for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('dbUpdate(')) continue;
    const rel = relative(APP_DIR, file);
    const re = /\bdbUpdate\s*\(/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const before = text.slice(Math.max(0, m.index - 90), m.index);
      if (ASSIGNED_RE.test(before)) continue; // captured → assumed checked
      // Extract the target table — the 2nd arg string literal.
      const after = text.slice(m.index, m.index + 160);
      const litM = after.match(/dbUpdate\s*\(\s*[^,]+,\s*['"]([^'"]+)['"]/);
      const table = litM ? litM[1] : '(dynamic)';
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
  console.log('✅ check-unchecked-dbupdate: clean — every dbUpdate result is captured.');
} else {
  console.log(
    `⚠️  check-unchecked-dbupdate: ${findings.length} bare dbUpdate call(s) (${high.length} HIGH user-facing edit):`,
  );
  for (const f of [...high, ...low]) {
    console.log(
      `   ${f.severity === 'HIGH' ? 'HIGH' : 'low '} ${f.file}:${f.line} → ${f.table}${f.severity === 'HIGH' ? '  (user edit — capture { error, changes }; 404 on changes===0)' : ''}`,
    );
  }
  console.log(
    '   Fix: `const { error, changes } = await dbUpdate(...)` — throw on error; 404 when changes===0 for an edit-by-id.',
  );
}

process.exit(process.argv.includes('--ci') && high.length > 0 ? 1 : 0);
