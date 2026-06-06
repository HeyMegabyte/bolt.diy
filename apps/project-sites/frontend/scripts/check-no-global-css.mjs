#!/usr/bin/env node
/**
 * check-no-global-css.mjs — fail the build when an Angular component style uses
 * `:global(...)`.
 *
 * `:global()` is a CSS-Modules construct, NOT an Angular pierce selector. Angular
 * does not recognise it (it knows `::ng-deep`, `:host`, `:host-context`), so it
 * leaves `:global(...)` an invalid selector — the browser then DROPS the whole
 * rule. The style is silently DEAD: it ships into the bundle but never applies,
 * and nothing flags it. This bit us 3× (voice/numbers vanity <b>, voice/share QR
 * canvas/svg, agent-message tool chips) where the author meant to style
 * runtime / [innerHTML]-injected content. The correct pierce is `::ng-deep`.
 *
 * Block comments (/* … *​/) are stripped before scanning (line numbers preserved)
 * so explanatory comments that MENTION `:global()` don't trip the gate. Spec
 * files are skipped (they never ship CSS).
 *
 * Run via `npm run check:no-global-css` or as a pre-build gate (`build:prod`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const SRC = join(ROOT, 'src', 'app');
const EXTS = ['.ts', '.scss', '.css'];

/** Recursively yields every source file (skipping specs, which never ship CSS). */
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
      continue;
    }
    if (full.endsWith('.spec.ts')) continue;
    if (EXTS.some((ext) => full.endsWith(ext))) yield full;
  }
}

/**
 * Blank out the CONTENT of every block comment while preserving newlines, so a
 * `:global()` mentioned inside an explanatory comment is ignored but the line
 * numbers of real code stay accurate.
 */
function stripBlockComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function findViolations(source) {
  const scan = stripBlockComments(source);
  const violations = [];
  const rx = /:global\s*\(/g;
  let match;
  while ((match = rx.exec(scan)) !== null) {
    const line = scan.slice(0, match.index).split('\n').length;
    const snippet = source.split('\n')[line - 1]?.trim() ?? ':global(';
    violations.push({ line, snippet: snippet.length > 120 ? snippet.slice(0, 117) + '...' : snippet });
  }
  return violations;
}

function main() {
  let failures = 0;
  for (const file of walk(SRC)) {
    const violations = findViolations(readFileSync(file, 'utf8'));
    if (violations.length === 0) continue;
    failures += violations.length;
    const rel = relative(ROOT, file);
    for (const v of violations) {
      process.stderr.write(`${rel}:${v.line}  :global() is dead in Angular — use ::ng-deep — ${v.snippet}\n`);
    }
  }
  if (failures > 0) {
    process.stderr.write(`\nno-global-css check FAILED — ${failures} :global() rule(s). Angular ignores :global(); the style never applies. Replace with :host ::ng-deep.\n`);
    process.exit(1);
  }
  process.stdout.write('no-global-css check PASSED — no dead :global() rules in component styles.\n');
}

main();
