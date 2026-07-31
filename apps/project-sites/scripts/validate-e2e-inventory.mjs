#!/usr/bin/env node
/**
 * validate-e2e-inventory.mjs (worker e2e)
 *
 * Enforces the worker e2e feature inventory (per the whole-project convergence
 * mandate: "CI fails if any feature lacks an entry or a test").
 *
 * Checks, against `e2e/*.spec.ts`:
 *   1. Every spec on disk is referenced in e2e/COVERAGE.yml (no orphan specs).
 *   2. Every spec referenced in COVERAGE.yml exists on disk (no dangling refs).
 *
 * (FEATURES.md here is a human-facing feature matrix, not 1:1 with spec files,
 * so it is intentionally not cross-checked — COVERAGE.yml is the spec-of-record.)
 *
 * Exit 1 on any violation. Run: node scripts/validate-e2e-inventory.mjs
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'e2e');
// Full relative paths (e.g. `admin/social.spec.ts`) — the old basename-only
// regex plus root-only readdir was the SAME bug class as the testMatch
// basename collisions: subdir refs false-dangled and subdir orphans were
// invisible. Underscore dirs (_fortress) are legit spec homes; skip only
// helper/output dirs.
const SPEC_RE = /[A-Za-z0-9_./-]*[a-z0-9_-]+\.spec\.ts/g;

const SKIP_DIRS = new Set(['helpers', 'screenshots', 'node_modules', '__snapshots__']);
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('test-results')) continue;
      out.push(...walk(join(dir, entry.name)));
    } else if (/\.spec\.ts$/.test(entry.name)) {
      out.push(relative(e2eDir, join(dir, entry.name)));
    }
  }
  return out;
}
const onDisk = walk(e2eDir).sort();

const coveragePath = join(e2eDir, 'COVERAGE.yml');
const errors = [];

if (!existsSync(coveragePath)) {
  errors.push('e2e/COVERAGE.yml is missing.');
} else {
  const coverage = readFileSync(coveragePath, 'utf8');
  const referenced = new Set(coverage.match(SPEC_RE) ?? []);
  for (const spec of onDisk) {
    if (!referenced.has(spec)) errors.push(`Orphan spec (not in COVERAGE.yml): ${spec}`);
  }
  for (const ref of referenced) {
    if (!onDisk.includes(ref)) errors.push(`Dangling COVERAGE.yml ref (no file): ${ref}`);
  }
}

if (errors.length) {
  console.error(`✗ worker e2e inventory validation failed (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.warn(`✓ worker e2e inventory valid: ${onDisk.length} specs, all in COVERAGE.yml`);
