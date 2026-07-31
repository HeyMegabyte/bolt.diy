#!/usr/bin/env node
/**
 * backfill-ba-collisions.mjs — ONE-SHOT convergence of Better Auth ↔ legacy
 * id collisions. OPERATOR-INVOKED ONLY (autonomous-engineering tier:
 * approval-required). Nothing in the platform calls this automatically.
 *
 * ── WHAT ─────────────────────────────────────────────────────────────────────
 * `ensureLegacyMirror` (src/auth/better-auth.ts) SKIPS+WARNS when a BA `user`
 * row shares an EMAIL with a legacy `users` row under a DIFFERENT id
 * (pre-cutover accounts). `authMiddleware` resolves those at READ time by
 * email → legacy id. This script converges the DATA: for each collision pair
 * it remaps the BA `user.id` + all 8 BA child columns (session.userId,
 * session.impersonatedBy, account.userId, twoFactor.userId, passkey.userId,
 * ssoProvider.userId, member.userId, invitation.inviterId) from ba_id →
 * legacy_id. Excluded by design: `verification` (email-keyed), `apikey`
 * (referenceId is org-scoped), `organization` (no user column).
 *
 * ── WHY THIS DIRECTION (BA → legacy) ─────────────────────────────────────────
 * The legacy id owns orgs/memberships/sites/billing/audit history across
 * dozens of legacy tables with no FK cascade — unbounded blast radius. The BA
 * side is 8 enumerable columns in 7 tables, and the shipped read layer already
 * treats the legacy id as canonical. Remapping BA children is cheap, bounded,
 * and makes the data match the read path (whose email fallback then becomes a
 * harmless no-op). Full rationale: src/services/ba_backfill.ts module JSDoc.
 *
 * ── SAFETY RAILS (all mandatory) ─────────────────────────────────────────────
 * 1. REPORT FIRST — `--report` is read-only; review every pair + child counts
 *    before anything mutates.
 * 2. D1 TIME TRAVEL BOOKMARK — capture BEFORE applying:
 *      npx wrangler d1 time-travel info project-sites-db-production --env production
 *    `--apply` REFUSES to run without `--confirm-bookmark <bookmark>`.
 *    Rollback: npx wrangler d1 time-travel restore project-sites-db-production \
 *      --env production --bookmark <bookmark>
 * 3. PER-PAIR TRANSACTIONS — each pair executes as ONE multi-statement
 *    wrangler `--command` (a single D1 batch = implicit transaction), starting
 *    with `PRAGMA defer_foreign_keys = true` (the child FKs have no ON UPDATE
 *    cascade). A failed pair rolls back alone; prior pairs stay converged.
 * 4. IDEMPOTENT — converged pairs vanish from the report; child updates are
 *    guarded by `EXISTS(user.id = ba)` and the parent by
 *    `NOT EXISTS(user.id = legacy)`. Re-running is always safe.
 * 5. NEVER AUTOMATIC — no cron, no CI hook, no import from worker code. A
 *    human runs each mode and reads the output.
 *
 * ── RUNBOOK ──────────────────────────────────────────────────────────────────
 *   cd apps/project-sites
 *   node scripts/backfill-ba-collisions.mjs --report        # 1. read-only pairs
 *   node scripts/backfill-ba-collisions.mjs --plan          # 2. print SQL, no exec
 *   npx wrangler d1 time-travel info project-sites-db-production --env production
 *   node scripts/backfill-ba-collisions.mjs --apply --confirm-bookmark <bm>  # 3.
 *   node scripts/backfill-ba-collisions.mjs --verify        # 4. expect 0 pairs
 *
 * Edge case surfaced by the report: `legacy_ba_user_exists = 1` (two BA rows
 * differing only by email case) → the pair MERGES children onto the existing
 * legacy-id row; the orphaned ba-id `user` row is left (parent guard no-ops)
 * and stays visible in `--report` for manual review.
 *
 * Requires Node >= 22.18 (native TS type-stripping) to import the typed SQL
 * builders from src/services/ba_backfill.ts. Older 22.x: prefix with
 * `node --experimental-strip-types`.
 *
 * CF-native: pure D1 (`project-sites-db-production`); wrangler auth via
 * CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL (or CLOUDFLARE_API_TOKEN).
 */
import { execFileSync } from 'node:child_process';

const DB = 'project-sites-db-production';

let svc;
try {
  svc = await import('../src/services/ba_backfill.ts');
} catch (err) {
  console.error(
    '[backfill-ba-collisions] Failed to import src/services/ba_backfill.ts.\n' +
      'This script needs Node >= 22.18 (native TS type-stripping). Retry with:\n' +
      '  node --experimental-strip-types scripts/backfill-ba-collisions.mjs\n',
  );
  throw err;
}

const {
  buildCollisionReportSql,
  buildRemapStatements,
  buildPairVerifySql,
  reportRowToPair,
} = svc;

/** Run one SQL command against prod D1 via wrangler; returns parsed --json. */
function d1(sql) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB, '--env', 'production', '--remote', '--json', '--command', sql],
    { encoding: 'utf8', env: { ...process.env }, timeout: 120_000 },
  );
  return JSON.parse(out);
}

/** Fetch + validate the current collision pairs (read-only). */
function fetchReportRows() {
  const json = d1(buildCollisionReportSql());
  const results = Array.isArray(json) ? (json[0]?.results ?? []) : [];
  return results;
}

function printReport(rows) {
  if (rows.length === 0) {
    console.log('No BA↔legacy id collisions. Nothing to do.');
    return;
  }
  console.log(`${rows.length} collision pair(s):\n`);
  for (const row of rows) {
    const pair = reportRowToPair(row); // throws on drifted/malformed rows
    const merge = row.legacy_ba_user_exists ? '  [MERGE: BA row already exists under legacy id]' : '';
    console.log(`- ${pair.email}${merge}`);
    console.log(`    ba_id     ${pair.baId}`);
    console.log(`    legacy_id ${pair.legacyId}`);
    console.log(
      `    children  session=${row.session_count} account=${row.account_count} ` +
        `twoFactor=${row.twofactor_count} passkey=${row.passkey_count} ` +
        `sso=${row.sso_count} member=${row.member_count} invitation=${row.invitation_count}`,
    );
  }
}

function printPlan(rows) {
  printReport(rows);
  if (rows.length === 0) return;
  console.log('\n--- Per-pair remap commands (NOT executed; one wrangler call = one transaction) ---\n');
  for (const row of rows) {
    const pair = reportRowToPair(row);
    // Space-join for the copy-pasteable one-liner: statements are ;-terminated,
    // and JSON.stringify yields a valid bash double-quoted arg (no $ or backticks
    // can appear — ids are schema-validated to [A-Za-z0-9_-]).
    const sql = buildRemapStatements(pair).join(' ');
    console.log(`# ${pair.email}`);
    console.log(
      `npx wrangler d1 execute ${DB} --env production --remote --command ${JSON.stringify(sql)}\n`,
    );
  }
}

function apply(rows, bookmark) {
  if (rows.length === 0) {
    console.log('No collision pairs — already converged.');
    return;
  }
  console.log(`Applying ${rows.length} pair(s). Time Travel bookmark on file: ${bookmark}\n`);
  let done = 0;
  for (const row of rows) {
    const pair = reportRowToPair(row);
    process.stdout.write(`- ${pair.email} (${pair.baId} -> ${pair.legacyId}) ... `);
    d1(buildRemapStatements(pair).join('\n')); // ONE call = ONE batch/transaction
    const verify = d1(buildPairVerifySql(pair));
    const v = Array.isArray(verify) ? (verify[0]?.results?.[0] ?? {}) : {};
    const merged = Number(row.legacy_ba_user_exists) > 0;
    const ok = Number(v.legacy_rows_present) === 1 && (merged || Number(v.ba_rows_left) === 0);
    if (!ok) {
      console.log('FAIL');
      console.error(
        `  Verify mismatch: ${JSON.stringify(v)} (expected legacy_rows_present=1` +
          `${merged ? '' : ', ba_rows_left=0'}). Stopping. ` +
          `Rollback: npx wrangler d1 time-travel restore ${DB} --env production --bookmark ${bookmark}`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(merged ? 'MERGED (orphan BA row left for review)' : 'OK');
    done += 1;
  }
  console.log(`\n${done}/${rows.length} pair(s) converged. Run --verify to confirm 0 remaining.`);
}

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const mode = has('--apply')
  ? 'apply'
  : has('--verify')
    ? 'verify'
    : has('--plan')
      ? 'plan'
      : has('--report')
        ? 'report'
        : 'help';

if (mode === 'help') {
  console.log(
    [
      'backfill-ba-collisions.mjs — BA↔legacy id-collision convergence (operator-only)',
      '',
      'Modes:',
      '  --report                       read-only: list collision pairs + child counts',
      '  --plan                         print per-pair remap SQL/commands, execute nothing',
      '  --apply --confirm-bookmark <b> remap each pair (per-pair transaction + verify)',
      '  --verify                       re-run report; success = 0 pairs remaining',
      '',
      'Before --apply, capture a D1 Time Travel bookmark:',
      `  npx wrangler d1 time-travel info ${DB} --env production`,
      '',
      'Full runbook + safety rails: header of this file.',
    ].join('\n'),
  );
  process.exit(0);
}

if (mode === 'report') {
  printReport(fetchReportRows());
} else if (mode === 'plan') {
  printPlan(fetchReportRows());
} else if (mode === 'verify') {
  const rows = fetchReportRows();
  if (rows.length === 0) {
    console.log('VERIFY PASS — 0 collision pairs remaining.');
  } else {
    console.log(`VERIFY FAIL — ${rows.length} pair(s) still present:`);
    printReport(rows);
    process.exitCode = 1;
  }
} else if (mode === 'apply') {
  const i = args.indexOf('--confirm-bookmark');
  const bookmark = i >= 0 ? args[i + 1] : undefined;
  if (!bookmark || bookmark.startsWith('--')) {
    console.error(
      'REFUSING to apply without a D1 Time Travel bookmark.\n' +
        `  1. npx wrangler d1 time-travel info ${DB} --env production\n` +
        '  2. re-run with:  --apply --confirm-bookmark <bookmark>',
    );
    process.exit(1);
  }
  apply(fetchReportRows(), bookmark);
}
