#!/usr/bin/env node
/**
 * run-all.mjs — aggregate runner for the GENERATED-SITE QUALITY suite (§ C / § D). One command
 * instead of hand-assembling the batch every loop fire (+ a CI-gateable exit code). Distinct from
 * the admin-verify run-all: these probes audit the CORE PRODUCT — deployed `{slug}.projectsites.dev`
 * sites + the platform's own public face — not the /admin dashboard.
 *
 * Globs every `verify-*.mjs` in this dir so a newly-authored probe auto-joins the suite. Each child
 * inherits this process's env (SITES / PROD_URL) and self-skips (`::notice:: skipped`) when a probe's
 * inputs are unavailable — a SKIP is not a failure.
 *
 * Exit 0 when every probe PASSED or SKIPPED; exit 1 if any probe FAILED (own exit≠0).
 *
 * Usage:
 *   node e2e/site-quality/run-all.mjs                              # full suite (default SITES)
 *   SITES=vanta-strength-austin node e2e/site-quality/run-all.mjs  # override the audited sites
 *   node e2e/site-quality/run-all.mjs invariants                   # only probes matching the filter
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const filter = (process.argv[2] || '').toLowerCase();

const PROBES = readdirSync(DIR)
  .filter((f) => /^verify-.*\.mjs$/.test(f))
  .sort()
  .map((f) => ({ label: f.replace(/^verify-|\.mjs$/g, ''), file: f }))
  .filter((p) => !filter || p.label.toLowerCase().includes(filter) || p.file.toLowerCase().includes(filter));

if (PROBES.length === 0) {
  console.error(`run-all: no site-quality probes match filter "${filter}"`);
  process.exit(2);
}

const results = [];
for (const p of PROBES) {
  process.stdout.write(`\n▶ ${p.label} …\n`);
  const r = spawnSync(process.execPath, [resolve(DIR, p.file)], {
    env: { ...process.env },
    encoding: 'utf8',
    timeout: 300_000,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const skipped = r.status === 0 && /::notice::.*skipp?ed|^\s*skip —/im.test(out);
  const status = r.status === 0 ? (skipped ? 'SKIP' : 'PASS') : 'FAIL';
  const verdict = (out.match(/VERDICT:[^\n]*/) || out.match(/::notice::[^\n]*/) || [''])[0].slice(0, 110);
  results.push({ label: p.label, status, verdict });
  console.log(`${status === 'PASS' ? '✅' : status === 'SKIP' ? '⚠️ ' : '🔴'} ${p.label} — ${verdict || '(no summary line)'}`);
}

const fails = results.filter((r) => r.status === 'FAIL');
const passes = results.filter((r) => r.status === 'PASS').length;
const skips = results.filter((r) => r.status === 'SKIP').length;
console.log(`\n━━ site-quality suite: ${passes} pass · ${skips} skip · ${fails.length} fail (of ${results.length}) ━━`);
for (const f of fails) console.log(`  🔴 ${f.label}: ${f.verdict}`);
process.exit(fails.length === 0 ? 0 : 1);
