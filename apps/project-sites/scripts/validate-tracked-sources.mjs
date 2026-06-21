#!/usr/bin/env node
/**
 * validate-tracked-sources.mjs
 *
 * Fails if any git-TRACKED test file imports a relative source module that EXISTS
 * on disk but is NOT git-tracked — the "stranded untracked source" class:
 *   committed `__tests__/x.test.ts` + uncommitted `../handlers.ts`
 * passes locally (the file is on the shared dev disk) but CI's fresh `git checkout`
 * can't resolve it → "Configuration error: Could not locate module ../handlers.js"
 * → "Test suite failed to run" → Unit red → deploy skipped. This guard turns that
 * cryptic, late failure into a clear, early one: "git add the source file."
 *
 * Bit the projectsites pipeline ~4× (payments_rail/cli_sandbox stranded TESTS, then
 * generative_ui_stream/page_audio_summary/figma_import stranded SOURCE). Runs in the
 * CI `check` job (NOT bypassable, unlike the pre-commit hook that --no-verify skips).
 *
 * Exit 1 on any violation; 0 otherwise.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

const root = execSync('git rev-parse --show-toplevel').toString().trim();
const tracked = new Set(
  execSync('git ls-files', { cwd: root, maxBuffer: 1 << 26 })
    .toString()
    .split('\n')
    .filter(Boolean),
);

// Tracked test files in the worker app (feature modules + colocated __tests__).
const testFiles = [...tracked].filter(
  (f) =>
    f.startsWith('apps/project-sites/') &&
    /\.(test|spec)\.ts$/.test(f) &&
    (f.includes('/libs/features/') || f.includes('/__tests__/')),
);

const importRe = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;
const violations = [];

for (const tf of testFiles) {
  const abs = resolve(root, tf);
  const src = readFileSync(abs, 'utf8');
  for (const m of src.matchAll(importRe)) {
    const spec = m[1].replace(/\.js$/, ''); // bundler/jest map .js → .ts source
    // Candidate source files this relative import could resolve to.
    const candidates = [`${spec}.ts`, `${spec}.tsx`, `${spec}/index.ts`].map((s) =>
      resolve(dirname(abs), s),
    );
    const onDisk = candidates.find((c) => existsSync(c));
    if (!onDisk) continue; // resolves to a non-source / missing path → tsc/jest's job
    const rel = relative(root, onDisk).replaceAll('\\', '/');
    if (!tracked.has(rel)) violations.push(`${tf}\n      → imports UNTRACKED ${rel}`);
  }
}

if (violations.length > 0) {
  console.error(`\n✗ stranded untracked source — ${violations.length} committed test(s) import an uncommitted file:\n`);
  for (const v of violations) console.error(`  • ${v}`);
  console.error(
    '\n  These pass locally (file on disk) but FAIL in CI (fresh checkout can\'t find them).\n' +
      '  Fix: `git add` the source file(s) so they are tracked, then commit.\n',
  );
  process.exit(1);
}

console.log(`✓ tracked-sources: ${testFiles.length} test files scanned — all relative source imports are git-tracked.`);
