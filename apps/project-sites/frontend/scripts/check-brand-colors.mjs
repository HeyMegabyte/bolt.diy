#!/usr/bin/env node
/**
 * check-brand-colors.mjs — build-time guard against off-brand color drift.
 *
 * The cockpit is CYAN/BLACK (--ps-accent #00E5FF on #060610). The recurring
 * drift is a stray MINT-GREEN (#00ffc8 / rgb(0,255,200)) that crept into focus
 * rings + CTA gradients across ~14 files over time (purged 2026-06-04 in
 * commits 9aadeee4 + 496d1a1c + 060234e5). Mint is NEVER a legitimate brand
 * color here, so any occurrence — hex OR rgb/rgba form, in any .ts/.scss/.css/
 * .html — fails the production build. This keeps the offender count at zero.
 *
 * Two gotchas this guard exists to catch (a plain hex grep missed both):
 *   1. The `rgba(0, 255, 200, a)` form (not just the `#00ffc8` hex).
 *   2. Tailwind ARBITRARY classes like `outline-[#00ffc8]` in ANY component
 *      (even marketing signin/create) compile into the GLOBAL Tailwind sheet
 *      that loads on every route incl. /admin — so off-brand mint leaks into
 *      the admin's live CSS even with no admin element using it.
 *
 * Legit cinematic SECONDARY purple (#7C3AED / --ps-accent-secondary: chart
 * series, POST-method badges, data-viz) is intentional and NOT flagged.
 *
 * Opt-out: a line containing `brand-allow` or `mint-green` (a drift-marker
 * comment, e.g. _polish.scss's "the stray mint-green #00ffc8") is skipped.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../src', import.meta.url).pathname;
// Mint-green in any form: #00ffc8 hex (case-insensitive) OR rgb/rgba 0,255,200.
const MINT = /#00ffc8\b|rgba?\(\s*0\s*,\s*255\s*,\s*200\b/i;
const EXT = /\.(ts|scss|css|html)$/;

/** @returns {string[]} every source file under dir, excluding specs. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (EXT.test(name) && !name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

const violations = [];
for (const file of walk(ROOT)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!MINT.test(line)) return;
    if (/brand-allow|mint-green/i.test(line)) return; // opt-out / drift-marker comment
    violations.push(`${file.replace(ROOT, 'src')}:${i + 1}  ${line.trim().slice(0, 90)}`);
  });
}

if (violations.length > 0) {
  console.error('\n✘ check-brand-colors: off-brand mint-green (#00ffc8 / rgb(0,255,200)) found — the cockpit is cyan #00E5FF:\n');
  for (const v of violations) console.error('  ' + v);
  console.error(`\n${violations.length} violation(s). Fix: replace mint with cyan #00E5FF (or rgb(0,229,255)).\n`);
  process.exit(1);
}

console.log('✓ check-brand-colors: no off-brand mint-green.');
