#!/usr/bin/env node
/**
 * check-api-paths.mjs — build-time guard against the "double-/api" bug class.
 *
 * `ApiService.get/post/put/patch/delete` already prepend `/api` (see
 * api.service.ts). Passing a path that ALSO starts with `/api/` produces a
 * request to `/api/api/...`, which the worker serves as the SPA index.html
 * (200 text/html) instead of JSON → parse failure → a misleading
 * "Can't reach the server" toast AND total breakage when the feature is on.
 *
 * This bit 3 admin sections (enterprise, trust-center, stripe-app-status,
 * fixed 2026-06-02). This guard keeps the offender count at zero: any
 * `this.api.<method>('/api/...')` call fails the production build.
 *
 * Raw `this.http.<method>('/api/...')` calls are CORRECT (HttpClient needs the
 * full path) and are intentionally NOT flagged — only the ApiService wrapper.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../src/app', import.meta.url).pathname;
// this.api .get<...>( '/api/...   — tolerant of newlines + generics between
// the method and the opening paren (trust-center wraps `.put` onto its own line).
// `[^(;]*` spans the optional `<Generic>` (incl. object literals like
// `<{ data: X }>`) up to the call paren, bounded by `;` so a non-call
// `this.api` reference can't run away across statements.
const OFFENDER = /this\.api\s*\.\s*(get|post|put|patch|delete)\b[^(;]*\(\s*['"`]\/api\//g;

/** @returns {string[]} every *.ts file under dir, excluding specs. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

const violations = [];
for (const file of walk(ROOT)) {
  const content = readFileSync(file, 'utf8');
  let m;
  OFFENDER.lastIndex = 0;
  while ((m = OFFENDER.exec(content)) !== null) {
    const line = content.slice(0, m.index).split('\n').length;
    violations.push(`${file.replace(ROOT, 'src/app')}:${line}  this.api.${m[1]}('/api/…)`);
  }
}

if (violations.length > 0) {
  console.error('\n✘ check-api-paths: double-/api ApiService calls found (drop the redundant /api prefix — ApiService adds it):\n');
  for (const v of violations) console.error('  ' + v);
  console.error(`\n${violations.length} violation(s). Fix: this.api.get('/api/x') → this.api.get('/x').\n`);
  process.exit(1);
}

console.log('✓ check-api-paths: no double-/api ApiService calls.');
