#!/usr/bin/env node
/**
 * check-admin-coverage.mjs — build-time guard for admin dashboard tool coverage.
 *
 * Turns the recurring manual "are there tools not represented in the admin
 * dashboard?" audit into a deterministic gate (per audit-arc-maturity-ladder:
 * a check done manually 3+ times earns a detector). Diffs three sources:
 *
 *   1. admin child ROUTES        — app.routes.ts (the AdminComponent children block)
 *   2. sidebar NAV links         — admin.component.html (routerLink="/admin/<seg>")
 *   3. document-title LABELS      — admin-section-labels.ts (ADMIN_SECTION_LABELS keys)
 *
 * HARD gate (exit 1) — false-positive-safe, unambiguous failures:
 *   • a nav link to /admin/<seg> where <seg> is NOT a real route  → dead nav link
 *   • a nav-linked <seg> with NO label  → document title falls back to 'Dashboard'
 *     (WCAG 2.4.2 Page Titled) — this is the gap that bit leads + super-admin.
 *
 * ADVISORY (warn, never fails) — routed single-segment sections with no nav link.
 * Many are legit (sub-routes reached contextually, flow pages, the index), so this
 * is informational only, never a gate (validator-precision-discipline: prefer false
 * negatives over false positives).
 *
 * Run via `npm run check:admin-coverage` or the `build:prod` pre-build chain.
 */
import { readFileSync } from 'node:fs';

const APP = new URL('../src/app', import.meta.url).pathname;
const routesSrc = readFileSync(`${APP}/app.routes.ts`, 'utf8');
const navSrc = readFileSync(`${APP}/pages/admin/admin.component.html`, 'utf8');
const labelSrc = readFileSync(`${APP}/pages/admin/admin-section-labels.ts`, 'utf8');

// ── 1. admin child routes — bound the AdminComponent children block ──────────
// From the AdminComponent loadComponent line to its '**' catch-all (which MUST be
// the last admin child), collect single-segment `path: '<seg>'` entries (skip
// param routes `:x`, multi-segment `a/b`, the index '', and '**').
const startIdx = routesSrc.indexOf('m.AdminComponent');
const starIdx = routesSrc.indexOf("path: '**'", startIdx);
const adminBlock = routesSrc.slice(startIdx, starIdx > -1 ? starIdx : undefined);
const routeSegs = new Set();
for (const m of adminBlock.matchAll(/path:\s*'([^']*)'/g)) {
  const p = m[1];
  if (p && !p.includes('/') && !p.includes(':') && p !== '**') routeSegs.add(p);
}

// ── 2. sidebar nav links — first segment after /admin/ ───────────────────────
const navSegs = new Set();
for (const m of navSrc.matchAll(/routerLink="\/admin\/([^"]+)"/g)) {
  const seg = m[1].split('/')[0].split('#')[0];
  if (seg) navSegs.add(seg);
}

// ── 3. label keys — quoted or bare object keys in ADMIN_SECTION_LABELS ───────
const labelKeys = new Set();
for (const m of labelSrc.matchAll(/(?:'([a-z][a-z0-9-]*)'|\b([a-z][a-z0-9-]*))\s*:\s*'/g)) {
  labelKeys.add(m[1] ?? m[2]);
}

// ── HARD checks ──────────────────────────────────────────────────────────────
const deadNav = [...navSegs].filter((s) => !routeSegs.has(s));
const unlabeledNav = [...navSegs].filter((s) => !labelKeys.has(s));

const errors = [];
if (deadNav.length)
  errors.push(
    `Dead nav link(s) — /admin/<seg> with no matching route: ${deadNav.join(', ')}`,
  );
if (unlabeledNav.length)
  errors.push(
    `Nav-linked section(s) with NO title label (→ 'Dashboard' fallback, WCAG 2.4.2): ${unlabeledNav.join(', ')}`,
  );

// ── ADVISORY: routed sections with no nav link (informational) ───────────────
const KNOWN_NON_NAV = new Set([
  'dashboard',
  'welcome',
  'accept-invite',
  'editor-native',
  'instances',
]);
const orphanish = [...routeSegs].filter((s) => !navSegs.has(s) && !KNOWN_NON_NAV.has(s));

if (errors.length) {
  console.error('\n✘ check-admin-coverage: admin dashboard coverage gaps:\n');
  for (const e of errors) console.error('  • ' + e);
  console.error(
    '\nFix: add the missing route/label, or remove the dead nav link. ' +
      'Labels live in admin-section-labels.ts.\n',
  );
  process.exit(1);
}

if (orphanish.length) {
  console.log(
    `✓ check-admin-coverage: nav links all resolve + are labeled. ` +
      `(advisory: ${orphanish.length} routed section(s) without a nav link — ` +
      `verify reachable contextually: ${orphanish.join(', ')})`,
  );
} else {
  console.log('✓ check-admin-coverage: every nav link resolves + is labeled; no orphans.');
}
