#!/usr/bin/env node
/**
 * check-local-error-helpers.mjs — feature-module error-helper duplication gate.
 *
 * Caps the 2026-08-14 convergence arc (iter 15): after finding 12 feature modules
 * that each RE-DEFINED a local `const unauthorized`/`const notFound` error helper
 * identical to the canonical ones in `src/lib/feature_guard.ts` — and consolidating
 * all of them to import from feature_guard (single-source error envelopes + a
 * `request_id` field on every error body for observability) — this gate stops the
 * class from recurring on NEW feature modules.
 *
 * Why it matters: a locally re-defined `unauthorized`/`notFound` drifts from the
 * canonical envelope (misses `request_id`, can diverge in message — referral_loop
 * had 'Authentication required' vs the canonical 'Auth required'). Every feature
 * handler must `import { unauthorized, notFound } from '…/feature_guard.js'`.
 *
 * Heuristic (per validator-precision-discipline — prefers false-negatives):
 *   FLAG a `libs/features/<x>/handlers.ts` line that DEFINES a local
 *   `const unauthorized =` or `const notFound =`. Scoped to feature-module
 *   handlers only (feature_guard.ts itself lives in src/lib and is never scanned).
 *   `badRequest` is intentionally NOT gated — its message varies legitimately
 *   per feature ('Invalid event', 'BAD_REQUEST', …), so it is not single-source.
 *
 * Exempt: any line carrying `check-local-error-helpers-ignore`.
 *
 * Exit 0 by default (report-only). Pass `--ci` to exit 1 on any finding — the
 * surface is at zero after iter 15, so it ships as a blocking gate.
 *
 * Usage: node scripts/check-local-error-helpers.mjs [--ci]
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const FEATURES_DIR = join(APP_DIR, 'libs', 'features');

/** A line that locally re-defines a canonical error helper. */
const LOCAL_DEF = /^\s*const\s+(unauthorized|notFound)\s*=/;

/**
 * True when a single line locally re-defines `unauthorized` or `notFound`
 * (which should instead be imported from `src/lib/feature_guard.ts`). Pure
 * predicate — the scanner filters the ignore hatch. Exported for unit testing.
 *
 * @param {string} line - One source line.
 * @returns {boolean}
 */
export function isLocalErrorHelperDef(line) {
  return LOCAL_DEF.test(line);
}

/** @returns {{module:string, file:string, line:number, name:string}[]} findings. */
function scan() {
  const flagged = [];
  if (!existsSync(FEATURES_DIR)) return flagged;
  for (const mod of readdirSync(FEATURES_DIR, { withFileTypes: true })) {
    if (!mod.isDirectory()) continue;
    const handlers = join(FEATURES_DIR, mod.name, 'handlers.ts');
    if (!existsSync(handlers)) continue;
    const lines = readFileSync(handlers, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('check-local-error-helpers-ignore')) continue;
      const m = LOCAL_DEF.exec(line);
      if (m) {
        flagged.push({
          module: mod.name,
          file: `libs/features/${mod.name}/handlers.ts`,
          line: i + 1,
          name: m[1],
        });
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
      '✅ check-local-error-helpers: clean — every feature handler imports unauthorized/notFound from feature_guard.',
    );
    process.exit(0);
  }

  console.log(
    `⚠️  check-local-error-helpers: ${flagged.length} feature handler(s) re-define a canonical error helper locally:`,
  );
  for (const f of flagged) {
    console.log(`   FAIL ${f.file}:${f.line}  const ${f.name} = …`);
  }
  console.log(
    "   Replace with: import { unauthorized, notFound } from '../../../src/lib/feature_guard.js';",
  );
  console.log('   (single-source error envelopes carry request_id). Escape hatch: check-local-error-helpers-ignore.');
  process.exit(ci ? 1 : 0);
}

// Run as CLI only when invoked directly (never when imported by the unit test).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
