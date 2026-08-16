#!/usr/bin/env node
/**
 * check-trialing-drift.mjs — subscription plan-gate "trialing-drift" regression detector.
 *
 * Caps the 2026-08-16 trialing-drift arc (CHAOS pass-16 + the sibling sweep). A
 * subscription plan/entitlement gate written as `<sub>.plan === 'paid' && <sub>.status
 * === 'active'` (or `<sub>.plan !== 'paid' || <sub>.status !== 'active'`) silently
 * EXCLUDES `trialing` paid subscribers — a paying trial user is provisioned paid
 * everywhere else (Stripe `subscriptionEventType` maps `active OR trialing` →
 * `subscription.active`, and the webhook writes `plan='paid'`) but this active-only gate
 * drops them to FREE (lost entitlements / free top-bar / free usage tier / free AI
 * budget), and when a worker gate and a frontend gate disagree it produces a visible
 * lying-UI divergence. SIX sites carried this bug — getOrgEntitlements, billing.component
 * `plan()`, site_serving (x2), usage_metering `getOrgTier`, site-generation budget — all
 * now route through the SSOT `build_limits.resolveActiveOrgPlan`, whose SQL gates
 * `status IN ('active', 'trialing')`.
 *
 * This gate stops the class from recurring: FLAG any hand-rolled compound plan+status
 * gate that checks `status ... 'active'` WITHOUT naming `trialing` on the same line — the
 * exact active-only idiom. A correct gate either routes through `resolveActiveOrgPlan`
 * (no inline `status === 'active'` at all) or names `trialing` explicitly.
 *
 * Heuristic (per validator-precision-discipline — prefers false-negatives):
 *   FLAG a line iff it matches Form A OR Form B AND does NOT contain `trialing`:
 *     Form A: <x>.plan === 'paid' && … status === 'active'   (ternary / positive gate)
 *     Form B: <x>.plan !== 'paid' || … status !== 'active'   (guard / negative gate)
 *   Both require the `plan`+`paid` and `status`+`active` idioms on ONE line (a multi-line
 *   gate is a documented false-negative — acceptable). Object literals (`plan: 'paid'`)
 *   use `:` not `===`, so test mocks / row shapes are not flagged. The `build_limits.ts`
 *   SSOT (SQL `IN ('active','trialing')`, no JS `===` gate) is exempt by path.
 *
 * Exit 0 by default (report-only, audit-arc "Surface" step). Pass `--ci` to exit 1 on a
 * finding — the class ships at zero, so a re-introduced active-only gate re-flags it.
 *
 * Usage: node scripts/check-trialing-drift.mjs [--ci]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIRS = ['src', join('frontend', 'src')].map((d) => join(APP_DIR, d));
// The SSOT resolver lives here (SQL `IN ('active','trialing')`, no JS active-only gate).
const SSOT_FILE = join('services', 'build_limits.ts');

const FORM_A = /\bplan\s*===\s*['"]paid['"]\s*&&.*\bstatus\s*===\s*['"]active['"]/;
const FORM_B = /\bplan\s*!==\s*['"]paid['"]\s*\|\|.*\bstatus\s*!==\s*['"]active['"]/;

/**
 * Find active-only subscription plan gates (trialing-drift) in a source string. A line is
 * a violation iff it matches the positive (Form A) or negative (Form B) compound
 * plan+status idiom AND does not name `trialing`. Pure — exported for unit testing.
 *
 * @param {string} src - Full file source.
 * @returns {{ line: number, form: 'A' | 'B', snippet: string }[]}
 * @example
 * findTrialingDriftGates("x.plan === 'paid' && x.status === 'active'") // → [{ line: 1, form: 'A', ... }]
 * findTrialingDriftGates("x.plan === 'paid' && (x.status === 'active' || x.status === 'trialing')") // → []
 */
export function findTrialingDriftGates(src) {
  const out = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('trialing')) continue; // the fix signature → a correct, trialing-inclusive gate
    if (FORM_A.test(line)) out.push({ line: i + 1, form: 'A', snippet: line.trim().slice(0, 160) });
    else if (FORM_B.test(line))
      out.push({ line: i + 1, form: 'B', snippet: line.trim().slice(0, 160) });
  }
  return out;
}

/** Recursively collect .ts files, skipping node_modules + tests + e2e + declarations. */
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
      if (ent.name === 'node_modules' || ent.name === '__tests__' || ent.name === 'e2e') continue;
      collectFiles(full, out);
    } else if (
      ent.name.endsWith('.ts') &&
      !ent.name.endsWith('.d.ts') &&
      !ent.name.endsWith('.test.ts') &&
      !ent.name.endsWith('.spec.ts') &&
      !ent.name.endsWith('.e2e.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

/** @returns {{ file: string, line: number, form: string, snippet: string }[]} */
function scan() {
  const violations = [];
  for (const root of SRC_DIRS) {
    for (const file of collectFiles(root)) {
      const rel = relative(APP_DIR, file);
      if (rel.endsWith(SSOT_FILE)) continue; // SSOT resolver is exempt
      const src = readFileSync(file, 'utf8');
      if (src.includes('trialing-drift-ignore-file')) continue;
      for (const v of findTrialingDriftGates(src)) violations.push({ file: rel, ...v });
    }
  }
  return violations;
}

function main() {
  const ci = process.argv.includes('--ci');
  const violations = scan();

  if (!violations.length) {
    console.log(
      '✅ check-trialing-drift: clean — no active-only subscription plan gates ' +
        '(all route through resolveActiveOrgPlan / name trialing).',
    );
    process.exit(0);
  }

  console.log(
    `⚠️  check-trialing-drift: ${violations.length} active-only plan gate(s) that EXCLUDE ` +
      'trialing paid subs (a trialing sub loses paid entitlements/serving/tier/budget):',
  );
  for (const v of violations) console.log(`   ${v.file}:${v.line} [Form ${v.form}] ${v.snippet}`);
  console.log(
    '   Fix: route through `build_limits.resolveActiveOrgPlan(db, orgId)` (SQL gates ' +
      "`status IN ('active','trialing')`), or add `|| status === 'trialing'` to the gate.",
  );
  console.log(
    '   Intentional (a status gate that is NOT a subscription plan gate)? add ' +
      '`trialing-drift-ignore-file` to the file.',
  );
  process.exit(ci ? 1 : 0);
}

// Run as CLI only when invoked directly (never when imported by the unit test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
