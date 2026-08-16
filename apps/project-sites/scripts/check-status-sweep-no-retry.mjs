#!/usr/bin/env node
/**
 * check-status-sweep-no-retry.mjs — premature-terminal / no-retry regression detector.
 *
 * Caps the 2026-08-16 convergence arc (iters 115 + 116): a background sweep that
 * SELECTs rows `WHERE status = 'pending'` (or another non-terminal status) and, in a
 * failure branch, writes a TERMINAL status (`'failed'` / `'verification_failed'`)
 * WITHOUT a grace/retry guard STRANDS the row forever — the terminal status is
 * excluded from the next sweep, so a single TRANSIENT error permanently kills a
 * pending CF custom hostname (domains.ts) or a transactional outbox event
 * (event_bus.ts). Both were LIVE bugs; both were fixed by adding a guard:
 *   - a grace period on `created_at` before failing (young rows stay pending), OR
 *   - re-reading retryable-terminal rows (`… OR (status = 'failed' AND attempts < N)`).
 *
 * This gate stops the class from recurring: if someone removes a guard, the file
 * (sweep-reader + terminal-write + no guard) is flagged again.
 *
 * Heuristic (per validator-precision-discipline — prefers false-negatives, file-level):
 *   FLAG a file iff ALL of:
 *     (1) it has a SWEEP READER — a `status = '<non-terminal>'` row FILTER (not a
 *         `CASE WHEN`/`SUM`/`COUNT` aggregate projection), AND
 *     (2) it has a TERMINAL WRITE — a `status = '<terminal>'` / `status: '<terminal>'`
 *         ASSIGNMENT (not a `WHERE/AND/OR status = '…'` read filter), AND
 *     (3) it has NO GUARD token anywhere — none of: `attempts <`, `created_at`,
 *         `grace`, `retries`, `requeue`, `expire`, or `OR (status = 'failed'` (the
 *         retryable-terminal re-read). A guarded sweep is correct → not flagged.
 *
 * Because it keys on the GUARD TOKENS (not an exempt-list), the two fixed sites
 * (domains.ts, event_bus.ts) are correctly NOT flagged today, and a revert that
 * removes their guard re-flags them.
 *
 * Exit 0 by default (report-only, audit-arc "Surface" step). Pass `--ci` to exit 1
 * on any finding — the surface is at zero after iters 115 + 116, so it ships gated.
 *
 * Usage: node scripts/check-status-sweep-no-retry.mjs [--ci]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['src', 'libs'].map((d) => join(APP_DIR, d));

/** Non-terminal statuses a sweep reads to process. */
const NON_TERMINAL = "(?:pending|processing|scheduled|queued|verifying|in_progress)";
/** Terminal statuses a failure branch writes (strands the row when re-read is missing). */
const TERMINAL = "(?:failed|verification_failed|errored|dead_letter|error)";

/**
 * A sweep READER: a SQL `WHERE … status = '<non-terminal>'` row FILTER (the `WHERE`
 * anchor is REQUIRED — it excludes object-literal `status: 'pending'` result/state
 * objects, which are the dominant false-positive class). Non-greedy 180-char span so
 * the WHERE and the status filter can sit on different lines of a multi-line SQL string.
 */
const READER_RE = new RegExp(`\\bWHERE\\b[\\s\\S]{0,180}?\\bstatus\\s*=\\s*['"\`]${NON_TERMINAL}['"\`]`, 'gi');
/** Aggregate projection (`SUM(CASE WHEN status='pending' …)`) — a count, NOT a row sweep. */
const AGGREGATE_RE = /\bCASE\s+WHEN\b|\bSUM\s*\(|\bCOUNT\s*\(/i;
/** A TERMINAL status literal, in any write form (`SET status = 'failed'`, `{ status: 'failed' }`, or a `? ` param). */
const TERMINAL_LITERAL_RE = new RegExp(`status\\s*[=:]\\s*['"\`]${TERMINAL}['"\`]|['"\`]${TERMINAL}['"\`]\\s*:`, '');
/** A DB-write helper — the terminal literal is a real sweep-write only when the file writes to D1. */
const DB_WRITE_RE = /\bdbUpdate\s*\(|\bdbExecute\s*\(|\bSET\s+status\b|UPDATE\s+\w+\s+SET/i;
/** GUARD tokens — any one makes the sweep safe (grace / bounded-retry / expiry / retryable-terminal re-read). */
const GUARD_RE = /attempts\s*<|created_at|\bgrace\b|\bretries?\b|\brequeue\b|\bexpire|OR\s*\(?\s*status\s*=\s*['"`](?:failed|verification_failed)/i;

/**
 * Classify a file's source for the premature-terminal-no-retry shape. Pure —
 * exported for unit testing.
 *
 * @param {string} src - Full file source.
 * @returns {{ reader: boolean, terminalWrite: boolean, guard: boolean, flagged: boolean }}
 */
export function classifyStatusSweep(src) {
  // READER: a real SQL `WHERE … status = '<non-terminal>'` filter whose span is NOT an
  // aggregate projection. (Multi-line SQL strings → match on the whole source.)
  let reader = false;
  for (const m of src.matchAll(READER_RE)) {
    if (!AGGREGATE_RE.test(m[0])) {
      reader = true;
      break;
    }
  }
  // TERMINAL WRITE: a terminal-status literal AND the file actually writes to D1 (a
  // dbUpdate/dbExecute/`SET status`) — excludes in-memory result/state objects that
  // merely carry a `status: 'failed'` field.
  const terminalWrite = TERMINAL_LITERAL_RE.test(src) && DB_WRITE_RE.test(src);
  const guard = GUARD_RE.test(src);
  return { reader, terminalWrite, guard, flagged: reader && terminalWrite && !guard };
}

/** Recursively collect .ts source files (skips node_modules, tests). */
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

/** @returns {{file:string}[]} flagged files. */
function scan() {
  const flagged = [];
  for (const root of SCAN_DIRS) {
    for (const file of collectFiles(root)) {
      const rel = relative(APP_DIR, file);
      const src = readFileSync(file, 'utf8');
      if (src.includes('status-sweep-ignore-file')) continue;
      if (classifyStatusSweep(src).flagged) flagged.push({ file: rel });
    }
  }
  return flagged;
}

function main() {
  const ci = process.argv.includes('--ci');
  const flagged = scan();

  if (flagged.length === 0) {
    console.log(
      '✅ check-status-sweep-no-retry: clean — every status-sweep with a terminal write has a grace/retry guard.',
    );
    process.exit(0);
  }

  console.log(
    `⚠️  check-status-sweep-no-retry: ${flagged.length} status-sweep(s) that write a terminal status with NO grace/retry guard (premature-terminal strand risk):`,
  );
  for (const f of flagged) {
    console.log(`   FAIL ${f.file}`);
  }
  console.log(
    "   A sweep reading `WHERE status = 'pending'` that writes `status = 'failed'` on the FIRST error,",
  );
  console.log(
    '   with no age/attempt guard, strands the row forever. Add a grace period on `created_at` before',
  );
  console.log(
    "   failing, OR re-read retryable rows (`… OR (status = 'failed' AND attempts < N)`). Intentional?",
  );
  console.log('   add `status-sweep-ignore-file` to the file.');
  process.exit(ci ? 1 : 0);
}

// Run as CLI only when invoked directly (never when imported by the unit test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
