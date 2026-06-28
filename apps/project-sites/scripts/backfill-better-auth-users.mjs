#!/usr/bin/env node
/**
 * backfill-better-auth-users.mjs — Better Auth cutover Phase 3 (#15 + #49).
 *
 * Maps the legacy `users`/`sessions` (plural) into Better Auth's `user` table
 * (singular), REUSING the same primary-key id so existing references stay valid.
 * Idempotent (`INSERT OR IGNORE`). Passwords are NOT migrated — legacy hashing
 * differs from Better Auth's; migrated users sign in via magic link / Google once,
 * which Better Auth links automatically (account-linking, same verified email).
 *
 * Run ONLY after the Better Auth schema exists (the `user` table is created by the
 * worker's ensureBetterAuthSchema on the flag-gated path, or by `better-auth migrate`).
 *
 * Modes:
 *   node scripts/backfill-better-auth-users.mjs            # dry-run: print the SQL + plan
 *   node scripts/backfill-better-auth-users.mjs --verify   # eval (#49): count legacy users missing a BA user
 *   node scripts/backfill-better-auth-users.mjs --apply    # run the backfill against prod D1 (needs CF creds)
 *
 * CF-native: pure D1 (`project-sites-db-production`); no external store.
 */
import { execFileSync } from 'node:child_process';

const DB = 'project-sites-db-production';

// Core Better Auth `user` columns are stable across 1.6.x: id, name, email,
// emailVerified, createdAt, updatedAt. Legacy users are treated as verified
// (they already authenticated via magic link / Google).
const BACKFILL_SQL = `
INSERT OR IGNORE INTO user (id, name, email, emailVerified, createdAt, updatedAt)
SELECT u.id,
       COALESCE(u.display_name, u.email),
       u.email,
       1,
       COALESCE(u.created_at, CURRENT_TIMESTAMP),
       COALESCE(u.updated_at, CURRENT_TIMESTAMP)
  FROM users u
 WHERE u.deleted_at IS NULL AND u.email IS NOT NULL AND u.email <> '';
`.trim();

// #49 — migration eval: legacy users with no Better Auth counterpart.
const VERIFY_SQL = `
SELECT COUNT(*) AS missing
  FROM users u
 WHERE u.deleted_at IS NULL AND u.email IS NOT NULL AND u.email <> ''
   AND NOT EXISTS (SELECT 1 FROM user b WHERE b.id = u.id);
`.trim();

function d1(sql) {
  const env = { ...process.env };
  return execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB, '--env', 'production', '--remote', '--json', '--command', sql],
    { encoding: 'utf8', env, timeout: 120_000 },
  );
}

const mode = process.argv.includes('--apply')
  ? 'apply'
  : process.argv.includes('--verify')
    ? 'verify'
    : process.argv.includes('--readiness')
      ? 'readiness'
      : 'dry-run';

if (mode === 'dry-run') {
  console.log('— Better Auth user backfill (DRY RUN) —\n');
  console.log('BACKFILL SQL (run with --apply):\n' + BACKFILL_SQL + '\n');
  console.log('VERIFY SQL (run with --verify):\n' + VERIFY_SQL + '\n');
  console.log('Cutover canary: run with --readiness for a full pre-cutover gauge.\n');
  console.log(
    'Note: run AFTER the Better Auth schema exists. Passwords are not migrated — ' +
      'users sign in via magic link / Google once and are auto-linked.',
  );
  process.exit(0);
}

if (mode === 'readiness') {
  // #9 migration canary — pre-cutover readiness gauge. Catches the #1 cutover
  // gotcha: the Better Auth `user` table must exist (ensureBetterAuthSchema /
  // `better-auth migrate`) BEFORE the backfill, else --apply/--verify error.
  const schemaOut = d1(`SELECT name FROM sqlite_master WHERE type='table' AND name='user';`);
  const schemaReady = (JSON.parse(schemaOut)?.[0]?.results ?? []).length > 0;
  if (!schemaReady) {
    console.log('Better Auth migration readiness: SCHEMA NOT CREATED.');
    console.log('  The `user` table does not exist yet — hit the worker once with the');
    console.log('  better_auth flag on (ensureBetterAuthSchema) or run `better-auth migrate`.');
    console.log('  Readiness: 0% — backfill would fail. Do NOT cut over yet.');
    process.exit(1);
  }
  const totalOut = d1(
    `SELECT COUNT(*) AS total FROM users WHERE deleted_at IS NULL AND email IS NOT NULL AND email <> '';`,
  );
  const total = JSON.parse(totalOut)?.[0]?.results?.[0]?.total ?? 0;
  const missing = JSON.parse(d1(VERIFY_SQL))?.[0]?.results?.[0]?.missing ?? 0;
  const migrated = Math.max(0, total - missing);
  const pct = total === 0 ? 100 : Math.floor((migrated / total) * 100);
  console.log('Better Auth migration readiness:');
  console.log('  schema:   ready (`user` table exists)');
  console.log(`  legacy:   ${total} active user(s)`);
  console.log(`  migrated: ${migrated}`);
  console.log(`  pending:  ${missing}`);
  console.log(`  ready:    ${pct}%`);
  console.log(
    missing === 0
      ? '  → Safe to cut over: flip the better_auth flag.'
      : `  → Run --apply to backfill the remaining ${missing} before cutover.`,
  );
  process.exit(missing === 0 ? 0 : 1);
}

if (mode === 'verify') {
  const out = d1(VERIFY_SQL);
  const missing = JSON.parse(out)?.[0]?.results?.[0]?.missing ?? 'unknown';
  console.log(`#49 migration eval: ${missing} legacy user(s) without a Better Auth counterpart.`);
  process.exit(missing === 0 ? 0 : 1);
}

// apply
console.log('Applying Better Auth user backfill to', DB, '…');
d1(BACKFILL_SQL);
const out = d1(VERIFY_SQL);
const missing = JSON.parse(out)?.[0]?.results?.[0]?.missing ?? 'unknown';
console.log(`Backfill done. Remaining unmigrated: ${missing}.`);
process.exit(missing === 0 ? 0 : 1);
