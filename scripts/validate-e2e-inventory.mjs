#!/usr/bin/env node
/**
 * validate-e2e-inventory.mjs (bolt.diy root app)
 *
 * Enforces the root e2e feature inventory (per the whole-project convergence
 * mandate: "CI fails if any feature lacks an entry or a test").
 *
 * Checks, against `e2e/specs/*.spec.ts`:
 *   1. Every spec on disk is referenced in e2e/COVERAGE.yml (no orphan specs).
 *   2. Every `e2e/specs/*.spec.ts` ref in COVERAGE.yml exists on disk.
 *
 * COVERAGE.yml uses repo-relative `e2e/specs/<name>.spec.ts` paths, so we match
 * the full prefixed path (not bare basenames — those false-match prose/comments).
 *
 * Exit 1 on any violation. Run: node scripts/validate-e2e-inventory.mjs
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const specsDir = join(root, 'e2e', 'specs');
const coveragePath = join(root, 'e2e', 'COVERAGE.yml');
const PATH_RE = /e2e\/specs\/[a-z0-9-]+\.spec\.ts/g;

const onDisk = readdirSync(specsDir)
  .filter((f) => /\.spec\.ts$/.test(f))
  .map((f) => `e2e/specs/${f}`)
  .sort();

const errors = [];

if (!existsSync(coveragePath)) {
  errors.push('e2e/COVERAGE.yml is missing.');
} else {
  const coverage = readFileSync(coveragePath, 'utf8');
  const referenced = new Set(coverage.match(PATH_RE) ?? []);
  for (const spec of onDisk) {
    if (!referenced.has(spec)) errors.push(`Orphan spec (not in COVERAGE.yml): ${spec}`);
  }
  for (const ref of referenced) {
    if (!existsSync(join(root, ref))) errors.push(`Dangling COVERAGE.yml ref (no file): ${ref}`);
  }
}

if (errors.length) {
  console.error(`✗ root e2e inventory validation failed (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.warn(`✓ root e2e inventory valid: ${onDisk.length} specs, all in COVERAGE.yml`);
