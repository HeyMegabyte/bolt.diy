#!/usr/bin/env node
/**
 * CI gate: fail if OpenMeter is referenced anywhere in the repo.
 *
 * OpenMeter has been removed from the architecture. This script ensures
 * it's not reintroduced accidentally.
 *
 * Allowed exception: this script itself, and migration notes explicitly
 * marking OpenMeter as removed/rejected.
 *
 * Usage: node scripts/check-no-openmeter.mjs [--ci]
 *   --ci  Exit 1 on any match (for CI pipelines)
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const CI = process.argv.includes('--ci');

// Patterns that match OpenMeter references to block.
const BLOCKED_PATTERNS = [
  'openmeter',
  'OpenMeter',
  'OPENMETER',
  '@openmeter',
  'openmeter.dev',
];

// Files allowed to mention OpenMeter (only in removal/rejection context).
const ALLOWLIST = new Set([
  'scripts/check-no-openmeter.mjs', // this script
  'node_modules/',                   // third-party code (shouldn't exist but belt+suspenders)
  '.git/',
  '_LOOP_LEDGER.md', // the migration LEDGER — a historical record of the OpenMeter→Lago
  // removal; it will always cite OpenMeter as the thing that was removed. The gate guards
  // CODE reintroduction, not the removal record (keyword-matching every ledger phrasing is
  // whack-a-mole: "migration COMPLETE", "replaces OpenMeter", "STALE/SUPERSEDED", "purge"…).
]);

try {
  const result = execSync(
    'grep -rn -i "openmeter\\|@openmeter\\|openmeter\\.dev" . 2>/dev/null || true',
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  );

  const lines = result.trim().split('\n').filter(Boolean);
  const violations = [];

  for (const line of lines) {
    const filePath = line.split(':')[0];
    if ([...ALLOWLIST].some((a) => filePath.includes(a))) continue;

    // Allow lines that are part of a removal/rejection note — or that reference the
    // removed provider as a rejected legacy VALUE (a quoted string literal), not an
    // active import/usage. Active reintroduction would use `@openmeter` / `openmeter.dev`
    // (still blocked); a bare quoted 'openmeter' is only ever a legacy-config rejection here.
    const content = line.slice(filePath.length + 1).trim();
    const lower = content.toLowerCase();
    if (
      lower.includes('removed') ||
      lower.includes('removal') || // "post-OpenMeter removal" history comments
      lower.includes('superseded') || // ledger: "All OpenMeter references are STALE/SUPERSEDED"
      lower.includes('stale') ||
      lower.includes('rejected') ||
      lower.includes('no longer supported') ||
      lower.includes('must not be reintroduced') ||
      lower.includes('not a valid value') ||
      lower.includes('deliberately excluded') ||
      lower.includes('openmeter has been') ||
      lower.includes('no-openmeter') || // refs to THIS gate by file (check-no-openmeter.mjs) or npm script (check:no-openmeter) — never real usage
      content.includes("'openmeter'") || // rejected legacy config VALUE (billing_provider throws on it)
      content.includes('"openmeter"')
    ) {
      continue;
    }

    violations.push(line);
  }

  if (violations.length > 0) {
    console.error(`❌ Found ${violations.length} OpenMeter reference(s):`);
    for (const v of violations) {
      console.error(`  ${v}`);
    }
    console.error('');
    console.error(
      'OpenMeter has been removed from the ProjectSites architecture.',
    );
    console.error(
      'Replace with StripeMetersProvider or MetronomeProvider.',
    );
    if (CI) {
      process.exit(1);
    }
  } else {
    console.log('✅ No OpenMeter references found.');
  }
} catch (err) {
  console.error('Error running OpenMeter check:', err);
  if (CI) process.exit(1);
}
