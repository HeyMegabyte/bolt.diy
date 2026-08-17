#!/usr/bin/env node
/**
 * check-request-key-presence.mjs — write-side FE↔worker contract-drift guard.
 *
 * The WRITE-side mirror of check-response-key-presence.mjs (the read-side lying-empty
 * guard). A frontend `api.post/put/patch(url, { KEY: v })` sends body keys the worker
 * validates with a Zod schema (`zValidator('json', S)` / `S.parse(body)`) OR reads as
 * a plain `body.KEY`. If the worker never consumes `KEY` under ANY name, the submit is
 * a dead-write: a Zod boundary REJECTS the unknown/missing key → 400 on every submit (a
 * fully-broken feature — P0.50 spend-alerts sent `alert_kind`/`notify_email` when the
 * schema wanted `trigger`/`email`; podcast sent `provider`/`segments` vs `voiceProvider`/
 * `script`), and a plain `body.KEY` read silently DROPS the input (no 400 — P0.51). Both
 * are the [[response-key-mismatch-lying-empty]] memory's #1-recurrence flavor.
 *
 * Same lowest-false-positive signal + discipline as the read-side guard: a body key the
 * worker CONSUMES NOWHERE (not in any `z.object` key, not in any `body.KEY` read — both
 * land in the worker identifier token set). Per validator-precision-discipline this errs
 * hard toward false-negatives — any worker mention of the identifier clears the key, so it
 * catches the DISTINCTIVE dead-writes (`alert_kind`) and accepts the common-key mismatches
 * (`provider` vs `voiceProvider` — both appear elsewhere in the worker) as false-negatives
 * (catch those with the chaos-4 save→persist round-trips, which already exercise the
 * important surfaces at runtime). Only INLINE-LITERAL bodies are scanned; a variable or
 * spread body (`api.post(url, payload)` / `{ ...base }`) is the accepted false-negative.
 *
 * Exit 0 by default (report). Pass `--ci` to exit 1 on any finding.
 * Usage: node scripts/check-request-key-presence.mjs [--ci] [--json]
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

/**
 * Structural / client-only body keys that are legitimately never a worker-consumed
 * field, so their absence from the worker token set is not a dead-write. Grow this as
 * genuine client-only keys surface; a key here is NEVER flagged. Keep it SHORT.
 */
const ALLOW = new Set([
  // meta/envelope fields some calls include that the worker ignores by design
  'silent',
  'signal',
  'headers',
  'params',
]);

/**
 * Split an object/argument-list interior on TOP-LEVEL commas, respecting nesting
 * (`(){}[]`) and string/template literals. Pure.
 * @param {string} s - the interior text (no outer brackets).
 * @returns {string[]} the top-level comma-separated segments.
 */
export function splitTopLevel(s) {
  const out = [];
  let depth = 0;
  let start = 0;
  let quote = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/**
 * Extract the property keys declared in an object-literal `{ ... }`. Handles
 * `key: v`, shorthand `key`, quoted `'key':`/`"key":`; skips spreads (`...x`) and
 * computed keys (`[x]:`). Pure — no I/O — so it's unit-testable.
 * @param {string} objText - the full object literal text, INCLUDING the outer braces.
 * @returns {string[]} the declared property keys.
 */
export function extractObjectKeys(objText) {
  const inner = objText.trim().replace(/^\{/, '').replace(/\}$/, '');
  const keys = [];
  for (const seg of splitTopLevel(inner)) {
    const t = seg.trim();
    if (!t || t.startsWith('...') || t.startsWith('[')) continue; // spread / computed
    const m = t.match(/^(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*(:|$)/);
    if (m) keys.push(m[1] ?? m[2] ?? m[3]);
  }
  return keys;
}

/**
 * Scan a file's text for `.post/.put/.patch(url, { ...inline body... })` calls and
 * return the body keys with line numbers. Skips empty bodies and non-literal bodies.
 * @param {string} text - the source file text.
 * @returns {Array<{ key: string, line: number }>}
 */
export function extractRequestBodyKeys(text) {
  const found = [];
  const re = /\.(?:post|put|patch)\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    // Find the CALL '(' — the first '(' after the method (an optional <generic> never
    // contains '(' so "next paren" is always the call paren).
    let i = re.lastIndex;
    while (i < text.length && text[i] !== '(' && text[i] !== ';' && text[i] !== '\n') i++;
    if (text[i] !== '(') continue;
    // Balance-scan the call arguments to the matching ')'.
    let depth = 0;
    let quote = '';
    let end = -1;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (quote) {
        if (c === '\\') j++;
        else if (c === quote) quote = '';
        continue;
      }
      if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) continue;
    const args = splitTopLevel(text.slice(i + 1, end));
    const body = (args[1] ?? '').trim();
    if (!body.startsWith('{')) continue; // variable / spread / no body → false-negative
    const line = text.slice(0, m.index).split('\n').length;
    for (const key of extractObjectKeys(body)) found.push({ key, line });
  }
  return found;
}

/**
 * Decide whether a single FE request body key is a dead-write candidate. Pure.
 * @param {string} key - the body key the FE sends.
 * @param {Set<string>} workerTokens - every identifier the worker `src/` mentions.
 * @returns {{ flagged: boolean }} flagged when the worker consumes the key NOWHERE.
 */
export function scanRequestKey(key, workerTokens) {
  if (ALLOW.has(key)) return { flagged: false }; // meta / client-only
  if (workerTokens.has(key)) return { flagged: false }; // worker consumes it somewhere
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
      for (const t of readFileSync(file, 'utf8').matchAll(/[a-zA-Z_$]\w*/g)) tokens.add(t[0]);
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
    for (const { key, line } of extractRequestBodyKeys(text)) {
      if (seen.has(key)) continue;
      if (scanRequestKey(key, workerTokens).flagged) seen.set(key, { file: rel, line });
    }
  }
  const findings = [...seen.entries()].map(([key, loc]) => ({ key, ...loc }));

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ total: findings.length, findings }, null, 2) + '\n');
  } else if (findings.length === 0) {
    console.log(
      '✅ check-request-key-presence: clean — every FE inline request body key is consumed by the worker.',
    );
  } else {
    console.log(
      `📮 check-request-key-presence: ${findings.length} FE request body key(s) the worker consumes NOWHERE (dead-write — 400 every submit, or silently dropped):`,
    );
    for (const f of findings) console.log(`   { ${f.key} }  (${f.file}:${f.line})`);
    console.log(
      "   Fix: align the FE body key with the worker's Zod schema / body-read key (watch camelCase↔snake_case), OR (if client-only) allowlist it in ALLOW.",
    );
  }
  process.exit(process.argv.includes('--ci') && findings.length > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
