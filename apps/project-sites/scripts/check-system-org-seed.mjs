#!/usr/bin/env node
/**
 * check-system-org-seed.mjs — sentinel-org FK regression detector.
 *
 * Caps the 2026-08-16 CHAOS-pass finding (iter-121 tail → this fix, migration 0613):
 * pre-auth security events are audited with `org_id: 'system'` because the user may
 * not exist yet (`src/routes/api.ts` magic-link/OAuth handlers, e.g.
 * `auth.magic_link_requested`). But `audit_logs.org_id` is
 * `TEXT NOT NULL REFERENCES orgs(id)` — with NO `system` org row seeded, EVERY such
 * write failed `D1_ERROR: FOREIGN KEY constraint failed` and the auth/security audit
 * was silently dropped. The fix seeds a sentinel `system` org (`0613_seed_system_org.sql`)
 * so the FK is satisfied.
 *
 * This gate stops the class from recurring: the invariant is a REPO-LEVEL cross-check —
 * IF code writes a `org_id: 'system'` (or `org_id = 'system'`) sentinel-scoped record,
 * THEN a migration must seed that `system` org into `orgs`. It guards against:
 *   (a) a future migration squash/reset dropping the seed while the code still writes it,
 *   (b) a fresh project copying these migrations/handlers WITHOUT the seed,
 *   (c) a NEW sentinel-scoped call site added before its org is seeded.
 *
 * Heuristic (per validator-precision-discipline — prefers false-negatives):
 *   FLAG iff BOTH:
 *     (1) SOME src/libs file writes the sentinel — `org_id : 'system'` / `org_id = 'system'`
 *         (object-literal writeAuditLog arg OR SQL), AND
 *     (2) NO migration SEEDS it — no `INSERT [OR IGNORE] INTO orgs ( … 'system' … )`.
 *   Either half absent → not flagged (no sentinel use = nothing to seed; seed present = FK safe).
 *
 * Exit 0 by default (report-only, audit-arc "Surface" step). Pass `--ci` to exit 1 on a
 * finding — the seed ships in 0613 so the surface is at zero; a revert re-flags it.
 *
 * Usage: node scripts/check-system-org-seed.mjs [--ci]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIRS = ['src', 'libs'].map((d) => join(APP_DIR, d));
const MIGRATIONS_DIR = join(APP_DIR, 'migrations');

/**
 * Does a source string WRITE a `system`-sentinel-scoped org_id? Matches the
 * object-literal writeAuditLog arg (`org_id: 'system'`) and the SQL form
 * (`org_id = 'system'`). Pure — exported for unit testing.
 *
 * @param {string} src - Full file source.
 * @returns {boolean}
 */
export function codeUsesSystemOrgSentinel(src) {
  return /\borg_id\s*[:=]\s*['"`]system['"`]/.test(src);
}

/**
 * Does a migration SQL string SEED the `system` org — an `INSERT [OR IGNORE] INTO orgs`
 * whose column/value span contains a `'system'` literal (the sentinel id)? Pure —
 * exported for unit testing.
 *
 * @param {string} sql - Full migration source.
 * @returns {boolean}
 */
export function migrationSeedsSystemOrg(sql) {
  return /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+orgs\b[\s\S]{0,400}?['"`]system['"`]/i.test(sql);
}

/**
 * Repo-level classification of the sentinel-org FK invariant. Pure — exported for tests.
 *
 * @param {{ codeUses: boolean, migrationSeeds: boolean }} signals
 * @returns {{ codeUses: boolean, migrationSeeds: boolean, flagged: boolean }}
 */
export function classifySystemOrgSeed({ codeUses, migrationSeeds }) {
  return { codeUses, migrationSeeds, flagged: codeUses && !migrationSeeds };
}

/** Recursively collect files with one of `exts`, skipping node_modules + tests. */
function collectFiles(dir, exts, out = []) {
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
      collectFiles(full, exts, out);
    } else if (
      exts.some((e) => ent.name.endsWith(e)) &&
      !ent.name.endsWith('.d.ts') &&
      !ent.name.endsWith('.test.ts') &&
      !ent.name.endsWith('.spec.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

/** @returns {{ callSites: string[], migrationSeeds: boolean }} */
function scan() {
  const callSites = [];
  for (const root of SRC_DIRS) {
    for (const file of collectFiles(root, ['.ts'])) {
      const src = readFileSync(file, 'utf8');
      if (src.includes('system-org-seed-ignore-file')) continue;
      if (codeUsesSystemOrgSentinel(src)) callSites.push(relative(APP_DIR, file));
    }
  }
  let migrationSeeds = false;
  for (const file of collectFiles(MIGRATIONS_DIR, ['.sql'])) {
    if (migrationSeedsSystemOrg(readFileSync(file, 'utf8'))) {
      migrationSeeds = true;
      break;
    }
  }
  return { callSites, migrationSeeds };
}

function main() {
  const ci = process.argv.includes('--ci');
  const { callSites, migrationSeeds } = scan();
  const { flagged } = classifySystemOrgSeed({ codeUses: callSites.length > 0, migrationSeeds });

  if (!flagged) {
    console.log(
      `✅ check-system-org-seed: clean — ${callSites.length} sentinel call-site(s), ` +
        `system org ${migrationSeeds ? 'IS' : 'not'} seeded (FK satisfied${callSites.length ? '' : '; none needed'}).`,
    );
    process.exit(0);
  }

  console.log(
    `⚠️  check-system-org-seed: ${callSites.length} file(s) write org_id:'system' sentinel audits, ` +
      'but NO migration seeds the `system` org — every such write fails the audit_logs FOREIGN KEY and is DROPPED:',
  );
  for (const f of callSites) console.log(`   USES ${f}`);
  console.log(
    "   Add a seed migration (see migrations/0613_seed_system_org.sql): " +
      "`INSERT OR IGNORE INTO orgs (id, name, slug) VALUES ('system', …, …);`",
  );
  console.log('   Intentional (sentinel org lives elsewhere)? add `system-org-seed-ignore-file` to the call site.');
  process.exit(ci ? 1 : 0);
}

// Run as CLI only when invoked directly (never when imported by the unit test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
