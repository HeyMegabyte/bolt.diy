#!/usr/bin/env node
/**
 * check-response-key-presence.mjs — lying-empty (response-envelope-key-mismatch) guard.
 *
 * The 3 IDOR detectors guard cross-tenant LEAKS; this guards the inverse — a
 * surface that silently shows EMPTY when data exists. A frontend reader of the
 * shape `res.KEY ?? []` (or `?? {}` / `?? 0`) silently swallows a key MISMATCH
 * into a false-empty: if the worker's response never carries `KEY`, the `??`
 * fallback fires on EVERY call and the panel renders "no data" forever — a
 * lying-empty that passes every render-integrity gate (200, 0 console errors,
 * a clean screenshot) because the request DID succeed; the FE just read the
 * wrong key. This is the exact class in the [[response-key-mismatch-lying-empty]]
 * memory (FE read `r.data`, worker returned `{ assets }` → grid always empty).
 *
 * The strongest, lowest-false-positive signal for the class: a fallback key the
 * worker produces NOWHERE. Per validator-precision-discipline this errs hard
 * toward false-negatives — a key mentioned ANY way in the worker `src/` (a
 * `c.json({ KEY })` literal, a `SELECT … KEY` / `KEY AS` column, a bound field)
 * CLEARS it. Only a key the worker never mentions at all is flagged (HIGH
 * confidence: definitionally a dead read). Endpoint-level mismatches (key exists
 * but on a DIFFERENT route's return) are the accepted false-negative — catch
 * those with the reconcile-surfaces causal probe, not a static token check.
 *
 * Exit 0 by default (report). Pass `--ci` to exit 1 on any finding.
 * Usage: node scripts/check-response-key-presence.mjs [--ci] [--json]
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

/**
 * Structural / envelope keys that are legitimately generic OR known client-only
 * (never sourced from a server response), so their absence from a given worker
 * token set is not a lying-empty. Grow this as genuine client-only keys surface;
 * a key here is NEVER flagged. Keep it SHORT — every entry is a hole in the net.
 */
const ALLOW = new Set([
  'data',
  'error',
  'ok',
  'message',
  'results',
  // Better-Auth-delegated (2FA enrollment): the `/api/auth/*` TOTP surface is
  // owned by the better-auth npm package, so `totpURI`/`backupCodes` are produced
  // by the library, never in the worker `src/` this guard scans. Not a lying-empty.
  'totpURI',
  'backupCodes',
]);

/**
 * Frontend silent-fallback read: a response object (`r`/`res`/`resp`/`body`/`v`/
 * `raw`) dot-accessing a key that falls back to empty (`[]`/`{}`/`0`/`''`). The
 * captured group is the KEY the FE expects the server to carry.
 *
 * `data` is deliberately EXCLUDED from the object set: `data.KEY` is too ambiguous
 * — it matches Angular `DIALOG_DATA` injection, AG-Grid `params.data` synthetic
 * master/detail fields (`_parentId`/`masterId`), and nested `res.data.KEY`
 * envelopes where the outer payload already succeeded. A 5/5 false-positive rate
 * on `data.` (measured on this tree) is exactly the trust-destroying miscalibration
 * validator-precision-discipline forbids; the nested-envelope true-positives it
 * would catch are the accepted false-negative (use the causal reconcile probe).
 */
const FE_FALLBACK =
  /\b(?:r|res|resp|body|v|raw)\.([a-zA-Z_]\w*)\s*\?\?\s*(?:\[\]|\{\}|0\b|''|"")/g;

/**
 * Decide whether a single FE fallback key is a lying-empty candidate.
 * Pure — no I/O — so it's unit-testable.
 * @param {string} key - the response key the FE reads with a `?? empty` fallback.
 * @param {Set<string>} workerTokens - every identifier the worker `src/` mentions.
 * @returns {{ flagged: boolean }} flagged when the worker produces the key NOWHERE.
 */
export function scanResponseKey(key, workerTokens) {
  if (ALLOW.has(key)) return { flagged: false }; // structural / client-only
  if (workerTokens.has(key)) return { flagged: false }; // worker mentions it → not a dead read
  return { flagged: true };
}

function walk(dir, exts) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === '__tests__' || ent.name === 'node_modules' || ent.name === '.angular') continue;
      out.push(...walk(p, exts));
    } else if (
      exts.some((e) => ent.name.endsWith(e)) &&
      !ent.name.endsWith('.d.ts') &&
      !ent.name.endsWith('.test.ts') &&
      !ent.name.endsWith('.spec.ts')
    ) {
      out.push(p);
    }
  }
  return out;
}

/** Build the set of every identifier token the worker source mentions. */
function buildWorkerTokens(appDir) {
  const tokens = new Set();
  for (const dir of [join(appDir, 'src'), join(appDir, 'libs')]) {
    for (const file of walk(dir, ['.ts'])) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/[a-zA-Z_]\w*/g)) tokens.add(m[0]);
    }
  }
  return tokens;
}

function run() {
  const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
  const FE_DIR = join(APP_DIR, 'frontend', 'src', 'app');
  const workerTokens = buildWorkerTokens(APP_DIR);
  const seen = new Map(); // key -> first {file,line}
  for (const file of walk(FE_DIR, ['.ts'])) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(APP_DIR, file);
    let m;
    while ((m = FE_FALLBACK.exec(text)) !== null) {
      const key = m[1];
      if (seen.has(key)) continue;
      if (scanResponseKey(key, workerTokens).flagged) {
        const line = text.slice(0, m.index).split('\n').length;
        seen.set(key, { file: rel, line });
      }
    }
  }
  const findings = [...seen.entries()].map(([key, loc]) => ({ key, ...loc }));

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ total: findings.length, findings }, null, 2) + '\n');
  } else if (findings.length === 0) {
    console.log(
      '✅ check-response-key-presence: clean — every FE silent-fallback response key is produced by the worker.',
    );
  } else {
    console.log(
      `🫥 check-response-key-presence: ${findings.length} FE response key(s) read with an empty fallback that the worker produces NOWHERE (lying-empty — panel shows empty forever):`,
    );
    for (const f of findings) console.log(`   res.${f.key}  (${f.file}:${f.line})`);
    console.log(
      "   Fix: align the FE key with the worker's actual response shape, OR (if genuinely client-only) allowlist it in ALLOW.",
    );
  }
  process.exit(process.argv.includes('--ci') && findings.length > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
