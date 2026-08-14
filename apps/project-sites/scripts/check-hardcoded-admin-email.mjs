#!/usr/bin/env node
/**
 * check-hardcoded-admin-email.mjs — hardcoded super-admin-email regression detector.
 *
 * Caps the 2026-08-14 convergence arc (iters 9 + 11): after finding a hardcoded
 * `email === 'brian@megabyte.space'` admin/whitelist check in THREE places that
 * DIVERGED from the canonical super-admin set — token_burn_meter (an admin VIEW
 * gate that wrongly 404'd hey@megabyte.space, FIXED to isSuperAdmin) and
 * build_budget/build_limits (the unlimited-compute whitelist, DRY'd into the one
 * shared isUnlimitedOrgOwner) — this gate stops the class from recurring.
 *
 * Why it matters: a hardcoded admin email in a CHECK silently drifts from the
 * canonical allowlist (`SYS_ADMIN_EMAILS` in src/services/sysadmin.ts, which is
 * {brian@, hey@} + the `is_super_admin` column). Every new check must go through
 * `isSuperAdmin(env, userId)` (per-user) or the shared org-owner whitelist helper,
 * never a fresh literal.
 *
 * Heuristic (per validator-precision-discipline — prefers false-negatives):
 *   FLAG a line iff a sysadmin email literal is an OPERAND of a comparison or
 *   membership check (`=== '…'`, `!== '…'`, `== '…'`, `.includes('…')`), OUTSIDE
 *   the two canonical homes. This deliberately does NOT flag manifest `owner:`
 *   fields, `mailto:` links, flag-description prose, or `TEST_LOGIN_EMAIL = '…'`
 *   assignments — none of those are checks.
 *
 * Exempt: src/services/sysadmin.ts (canonical super-admin) + src/services/
 *   build_limits.ts (canonical isUnlimitedOrgOwner org-owner whitelist), test
 *   files, comment lines, and any line carrying `check-admin-email-ignore`.
 *
 * Exit 0 by default (report-only, audit-arc "Surface" step). Pass `--ci` to exit 1
 * on any finding — the surface is at zero after iters 9 + 11, so it ships gated.
 *
 * Usage: node scripts/check-hardcoded-admin-email.mjs [--ci]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['src', 'libs'].map((d) => join(APP_DIR, d));

/** Canonical homes where a hardcoded admin-email check is the intended single-source. */
const FILE_EXEMPT = new Set(['src/services/sysadmin.ts', 'src/services/build_limits.ts']);

/** The platform-operator emails (kept in sync with SYS_ADMIN_EMAILS in sysadmin.ts). */
const EMAIL = '(?:brian|hey)@megabyte\\.space';

/** Email as the RIGHT operand: `x === 'brian@…'`, `!== "…"`, `.includes('…')`. */
const CHECK_RHS = new RegExp(`(?:===|!==|==|\\.includes\\s*\\(\\s*)\\s*['"\`]${EMAIL}['"\`]`);
/** Email as the LEFT operand: `'brian@…' === x`. */
const CHECK_LHS = new RegExp(`['"\`]${EMAIL}['"\`]\\s*(?:===|!==|==)`);

/**
 * True when a single line uses a hardcoded super-admin-email as a comparison /
 * membership-check operand. Pure regex predicate — comment + ignore-hatch
 * filtering happens in the scanner. Exported for unit testing.
 *
 * @param {string} line - One source line.
 * @returns {boolean} whether the line is a hardcoded admin-email check.
 */
export function isHardcodedAdminCheck(line) {
  return CHECK_RHS.test(line) || CHECK_LHS.test(line);
}

/** True when the line is a comment (whole-line) — a comment may mention the pattern. */
function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/** Recursively collect .ts source files (skips node_modules, .d.ts, tests). */
function collectFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '__tests__') continue;
      collectFiles(full, out);
    } else if (
      ent.name.endsWith('.ts') &&
      !ent.name.endsWith('.d.ts') &&
      !ent.name.endsWith('.test.ts') &&
      !ent.name.endsWith('.spec.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

/** @returns {{file:string, line:number, text:string}[]} flagged check sites. */
function scan() {
  const flagged = [];
  for (const root of SCAN_DIRS) {
    for (const file of collectFiles(root)) {
      const rel = relative(APP_DIR, file);
      if (FILE_EXEMPT.has(rel)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isCommentLine(line) || line.includes('check-admin-email-ignore')) continue;
        if (isHardcodedAdminCheck(line)) {
          flagged.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) });
        }
      }
    }
  }
  return flagged;
}

function main() {
  const ci = process.argv.includes('--ci');
  const flagged = scan();

  if (flagged.length === 0) {
    console.log(
      '✅ check-hardcoded-admin-email: clean — no hardcoded super-admin-email checks outside sysadmin.ts / build_limits.ts.',
    );
    process.exit(0);
  }

  console.log(
    `⚠️  check-hardcoded-admin-email: ${flagged.length} hardcoded super-admin-email check(s) outside the canonical homes:`,
  );
  for (const f of flagged) {
    console.log(`   FAIL ${f.file}:${f.line}  ${f.text}`);
  }
  console.log(
    '   Use isSuperAdmin(env, userId) (per-user) or the shared org-owner whitelist helper —',
  );
  console.log(
    '   never a fresh email literal. Genuinely-intentional? add `check-admin-email-ignore` on the line.',
  );
  process.exit(ci ? 1 : 0);
}

// Run as CLI only when invoked directly (never when imported by the unit test).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
