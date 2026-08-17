#!/usr/bin/env node
/**
 * check-published-without-build.mjs — "lying-published" site-status regression detector.
 *
 * Caps the fire-28→30 arc after the SAME class bit THREE surfaces: a `sites` row
 * can be `status='published'` with `current_build_version = NULL` — the build never
 * finished, so its subdomain serves the branded 503 and it has NO `_manifest.json`
 * in R2. Treating `status==='published'` as "live / viewable / has-content" WITHOUT
 * also checking `current_build_version` is therefore a lie:
 *   1. /api/sites/search surfaced the stubs into public discovery (fire-28)
 *   2. the dashboard Site-status strip counted them as "Live · serving" (fire-30)
 *   3. the editor fired a /chat 404 for them on every admin route (fire-30)
 *
 * The rule this gate enforces: any SITE-status read that implies serving /
 * viewable / has-manifest MUST co-locate a build check (`current_build_version`
 * / `has_build` / `hasBuild`) within ±3 lines. Status is the intent; the build
 * version is the artifact.
 *
 * Heuristic (per validator-precision-discipline — prefers false-negatives):
 *   FLAG a line iff it is a SITE-status published read — `site.status === 'published'`,
 *   the dashboard bucket idiom `cls === 'published'` / `getStatusClass(...) === 'published'`,
 *   or a `sites`-table SQL `... FROM|UPDATE sites ... status = 'published'` — AND no
 *   build token appears in the ±3-line window. Deliberately does NOT flag:
 *   POST status (`existing.status`/`p.status` in social*), marketplace-LISTING SQL
 *   (`FROM worker_marketplace_listings|ai_agent_listings`), status labels/strings,
 *   or `status != 'published'` exclusions.
 *
 * Exempt: test/spec files, comment-only lines, and any line carrying
 *   `published-build-checked` (the reviewed-safe escape hatch).
 *
 * Exit 0 by default (report-only). Pass `--ci` to exit 1 on any finding — the
 * surface is at zero after the waiting.component fix, so it ships gated.
 *
 * Usage: node scripts/check-published-without-build.mjs [--ci]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = [
  join(APP_DIR, 'src'),
  join(APP_DIR, 'libs'),
  join(APP_DIR, 'frontend', 'src', 'app'),
];

/** Site-status "serving / viewable / has-content" published reads. */
const SITE_STATUS_PATTERNS = [
  /\bsite\.status\s*(?:===|==)\s*(['"`])published\1/, // site.status === 'published'
  /\bcls\s*(?:===|==)\s*(['"`])published\1/, // dashboard bucket idiom
  /getStatusClass\([^)]*\)\s*(?:===|==)\s*(['"`])published\1/,
  /(?:FROM|UPDATE)\s+sites\b[\s\S]*?status\s*=\s*(['"`])published\1/i, // sites-table SQL (equality)
];
/** Presence of ANY of these near the read means the build IS being checked → safe. */
const BUILD_TOKENS = /current_build_version|has_build|hasBuild/;
/** Window (lines) around a hit to search for a build token. */
const WINDOW = 3;

/** True when the line is a SITE-status published read. Exported for unit tests. */
export function isSiteStatusPublishedRead(line) {
  return SITE_STATUS_PATTERNS.some((re) => re.test(line));
}

/** True when a build token appears on any line within ±WINDOW of index i. */
export function windowHasBuildToken(lines, i, window = WINDOW) {
  const lo = Math.max(0, i - window);
  const hi = Math.min(lines.length - 1, i + window);
  for (let j = lo; j <= hi; j++) if (BUILD_TOKENS.test(lines[j])) return true;
  return false;
}

/** True when the line is a whole-line comment (may legitimately mention the pattern). */
function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/** Recursively collect .ts source files (skips node_modules, tests, .d.ts). */
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

/** @returns {{file:string, line:number, text:string}[]} flagged site-status reads. */
export function scan() {
  const flagged = [];
  for (const root of SCAN_DIRS) {
    for (const file of collectFiles(root)) {
      const rel = relative(APP_DIR, file);
      const lines = readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isCommentLine(line) || line.includes('published-build-checked')) continue;
        if (isSiteStatusPublishedRead(line) && !windowHasBuildToken(lines, i)) {
          flagged.push({ file: rel, line: i + 1, text: line.trim().slice(0, 130) });
        }
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
      '✅ check-published-without-build: clean — every site-status published read co-locates a current_build_version check.',
    );
    process.exit(0);
  }

  console.log(
    `⚠️  check-published-without-build: ${flagged.length} site-status "published" read(s) with NO build check nearby:`,
  );
  for (const f of flagged) console.log(`   FAIL ${f.file}:${f.line}  ${f.text}`);
  console.log(
    '   A published site with null current_build_version serves a 503 — never treat status==="published"',
  );
  console.log(
    '   alone as live/viewable. Add a current_build_version check, or `published-build-checked` if reviewed-safe.',
  );
  process.exit(ci ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
