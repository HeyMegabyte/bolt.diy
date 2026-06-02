#!/usr/bin/env node
/**
 * validate-e2e-inventory.mjs
 *
 * Enforces the frontend e2e feature inventory (per the whole-project
 * convergence mandate: "CI fails if any feature lacks an entry or a test").
 *
 * Checks, against `e2e/*.{e2e,spec}.ts`:
 *   1. Every spec on disk is referenced in e2e/COVERAGE.yml (no orphan specs).
 *   2. Every spec referenced in COVERAGE.yml exists on disk (no dangling refs).
 *   3. FEATURES.md exists and references the same spec set as COVERAGE.yml.
 *
 * Exit 1 on any violation. Run: node scripts/validate-e2e-inventory.mjs
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'e2e');
const SPEC_RE = /[a-z0-9-]+\.(?:e2e|spec)\.ts/g;

const onDisk = readdirSync(e2eDir)
  .filter((f) => /\.(e2e|spec)\.ts$/.test(f))
  .sort();

const read = (name) => {
  const p = join(e2eDir, name);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};

const coverage = read('COVERAGE.yml');
const features = read('FEATURES.md');
const errors = [];

if (!coverage) errors.push('e2e/COVERAGE.yml is missing.');
if (!features) errors.push('e2e/FEATURES.md is missing.');

if (coverage) {
  const referenced = new Set(coverage.match(SPEC_RE) ?? []);
  for (const spec of onDisk) {
    if (!referenced.has(spec)) errors.push(`Orphan spec (not in COVERAGE.yml): ${spec}`);
  }
  for (const ref of referenced) {
    if (!onDisk.includes(ref)) errors.push(`Dangling COVERAGE.yml ref (no file): ${ref}`);
  }
}

if (features) {
  const featRefs = new Set(features.match(SPEC_RE) ?? []);
  for (const spec of onDisk) {
    if (!featRefs.has(spec)) errors.push(`Spec missing from FEATURES.md: ${spec}`);
  }
}

if (errors.length) {
  console.error(`✗ e2e inventory validation failed (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.warn(`✓ e2e inventory valid: ${onDisk.length} specs, all in FEATURES.md + COVERAGE.yml`);
