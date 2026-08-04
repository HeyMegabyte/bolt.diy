#!/usr/bin/env node
/**
 * check-admin-route-orphans.mjs — build-time gate against ADVERTISED admin routes
 * that resolve to the admin not-found page (a 404).
 *
 * The recurring bug (6 instances, 2026-08-04, P0.78+P0.79): a route definition in
 * app.routes.ts gets lost in an edit, so an advertised link to `/admin/<seg>` —
 * a nav href, routerLink, g-chord, command-palette action, onboarding step, or a
 * not-found "Did you mean" hint — renders "This admin page doesn't exist". The
 * generic `sections-visual` E2E gate can't see it (its BROKEN-copy list excludes
 * the not-found phrase), and `check-admin-coverage.mjs` only scans the SIDEBAR
 * (admin.component.html) + palette navHref — so all 6 slipped through.
 *
 * This gate diffs the FULL advertised surface vs the DEFINED admin routes/redirects:
 *   DEFINED   = first-segment of every `path: '<x>'` in the AdminComponent children
 *               block of app.routes.ts (redirects have a `path:` too, so they count).
 *   ADVERTISED = every `/admin/<seg>` reached via routerLink / [routerLink] /
 *               `href:` / `navHref('…')` / `go('…')` / `navigateTo:` / onboarding
 *               `route:` / `router.navigate(['/admin/…'])` across src/app, PLUS the
 *               G_CHORD_ROUTES map and the not-found ADMIN_ROUTE_HINTS.
 *
 * HARD gate (exit 1): any advertised <seg> with no defined route/redirect.
 * API calls (`this.api.get('/admin/security')` …) are NOT matched by any nav
 * pattern, so they never false-positive (validator-precision-discipline: the
 * patterns are context-anchored, never a bare `/admin/x` string match).
 *
 * Run via `npm run check:admin-route-orphans` or the `build:prod` pre-build chain.
 */
import { readFileSync, readdirSync } from 'node:fs';

const APP = new URL('../src/app', import.meta.url).pathname;
const rel = (p) => p.replace(`${APP}/`, '');

// ── DEFINED: admin route first-segments (AdminComponent children block) ───────
const routesSrc = readFileSync(`${APP}/app.routes.ts`, 'utf8');
const startIdx = routesSrc.indexOf('m.AdminComponent');
const starIdx = routesSrc.indexOf("path: '**'", startIdx);
const adminBlock = routesSrc.slice(startIdx, starIdx > -1 ? starIdx : undefined);
const defined = new Set();
for (const m of adminBlock.matchAll(/path:\s*'([^']*)'/g)) {
  const p = m[1];
  if (!p || p === '**') continue;
  const first = p.split('/')[0]; // first segment ('sites/:id' → 'sites')
  if (first && !first.startsWith(':')) defined.add(first);
}

// ── ADVERTISED: context-anchored /admin/<seg> nav targets across src/app ──────
const NAV_PATTERNS = [
  /routerLink="\/admin\/([a-z0-9-]+)/g,
  /\[routerLink\]="\[\s*'\/admin\/([a-z0-9-]+)/g,
  /\bhref:\s*'\/admin\/([a-z0-9-]+)/g,
  /navHref\('\/admin\/([a-z0-9-]+)/g,
  /\bgo\('\/admin\/([a-z0-9-]+)/g,
  /navigateTo:\s*'\/admin\/([a-z0-9-]+)/g,
  /\broute:\s*'\/admin\/([a-z0-9-]+)/g,
  /navigate\(\[\s*'\/admin\/([a-z0-9-]+)'/g,
];

/** seg → first file that advertises it (for the error report). */
const advertised = new Map();
const add = (seg, file) => {
  if (seg && !advertised.has(seg)) advertised.set(seg, rel(file));
};

const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walk(full);
      continue;
    }
    if (!/\.(ts|html)$/.test(e.name) || /\.spec\.ts$/.test(e.name)) continue;
    const src = readFileSync(full, 'utf8');
    for (const re of NAV_PATTERNS) for (const m of src.matchAll(re)) add(m[1], full);
  }
};
walk(APP);

// G_CHORD_ROUTES map values (admin.component.ts) — `x: '/admin/<seg>'`.
const adminComp = readFileSync(`${APP}/pages/admin/admin.component.ts`, 'utf8');
const gChordBlock = adminComp.slice(adminComp.indexOf('G_CHORD_ROUTES'));
const gChordEnd = gChordBlock.indexOf('};');
for (const m of gChordBlock.slice(0, gChordEnd > -1 ? gChordEnd : 400).matchAll(/'\/admin\/([a-z0-9-]+)'/g)) {
  add(m[1], `${APP}/pages/admin/admin.component.ts`);
}

// not-found ADMIN_ROUTE_HINTS — `{ path: '<seg>', label: … }` (advertised as valid).
const notFound = readFileSync(`${APP}/pages/admin/sections/not-found.component.ts`, 'utf8');
const hintsBlock = notFound.slice(notFound.indexOf('ADMIN_ROUTE_HINTS'), notFound.indexOf('RENAMED_ROUTES'));
for (const m of hintsBlock.matchAll(/path:\s*'([a-z0-9-]+)'/g)) {
  add(m[1], `${APP}/pages/admin/sections/not-found.component.ts`);
}

// ── Suppressions (validator-precision-discipline escape hatch) ────────────────
// Non-route synthetic segments used only by tests/demos, never real nav.
const SUPPRESS = new Set(['totally-unknown-xyz']);

// ── HARD gate ─────────────────────────────────────────────────────────────────
const orphans = [...advertised.keys()].filter((s) => !defined.has(s) && !SUPPRESS.has(s)).sort();

if (orphans.length) {
  console.error('\n✘ check-admin-route-orphans: advertised /admin routes with NO route/redirect (they 404):\n');
  for (const s of orphans) console.error(`  • /admin/${s}  — advertised in ${advertised.get(s)}`);
  console.error(
    '\nFix in app.routes.ts (AdminComponent children): add a `loadComponent` route for a\n' +
      'standalone section, OR a functional redirect `{ path, redirectTo: () =>\n' +
      "inject(Router).parseUrl('/admin/<target>#<fragment>'), pathMatch: 'full' }` if it\n" +
      'moved into a tab. See memory admin-advertised-route-orphans + P0.78/P0.79.\n',
  );
  process.exit(1);
}

console.log(
  `✓ check-admin-route-orphans: all ${advertised.size} advertised /admin routes resolve ` +
    `(${defined.size} defined route segments).`,
);
