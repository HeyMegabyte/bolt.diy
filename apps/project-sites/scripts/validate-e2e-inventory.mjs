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
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'e2e');
const SPEC_RE = /[a-z0-9-]+\.spec\.ts/g;

const onDisk = readdirSync(e2eDir)
  .filter((f) => /\.spec\.ts$/.test(f))
  .sort();

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
