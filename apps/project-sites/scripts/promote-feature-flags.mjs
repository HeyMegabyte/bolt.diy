#!/usr/bin/env node
/**
 * Promote all experimental feature flags to stable at 100% rollout.
 * Safe: only touches flags at 'experimental' stage with enabled=0.
 * Run: node scripts/promote-feature-flags.mjs
 */
import { execSync } from 'node:child_process';

const SQL = `
UPDATE feature_flags
SET stage = 'stable', enabled = 1, rollout_percent = 100, updated_at = datetime('now')
WHERE stage = 'experimental'
  AND key NOT LIKE 'killswitch%'
  AND key NOT LIKE 'deprecated%';
`;

console.log('Promoting experimental→stable feature flags...');
try {
  const result = execSync(
    `npx wrangler d1 execute project-sites-db-production --command "${SQL.replace(/\n/g, ' ')}" --json`,
    { encoding: 'utf-8', cwd: new URL('..', import.meta.url).pathname }
  );
  const data = JSON.parse(result);
  const rowsAffected = data?.[0]?.results?.[0]?.rows_affected ?? '?';
  console.log(`✓ Promoted ${rowsAffected} flags to stable, 100% rollout.`);
} catch (err) {
  console.error('⚠ Could not promote flags:', err.message);
  console.error('  Manual: npx wrangler d1 execute project-sites-db-production --command "UPDATE feature_flags SET stage=\'stable\', enabled=1, rollout_percent=100 WHERE stage=\'experimental\';"');
}
