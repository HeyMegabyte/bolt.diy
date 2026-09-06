#!/usr/bin/env node
/**
 * measure-admin-cwv.mjs — cold-load Core Web Vitals for the authed /admin SPA routes.
 *
 * The ADMIN QUALITY loop's dim-8 (perf) had no probe: every prior fire could VERIFY
 * render/data/mutations but never MEASURED how fast the admin paints. This closes that
 * gap with a real local-Chromium measurement (no fabricated numbers) — LCP / FCP / TTFB
 * / CLS per route, on a COLD direct navigation (a user hitting the deep link fresh), so
 * the number reflects shell-load + Angular bootstrap + lazy-chunk + first data render.
 *
 * Session seeded from E2E_API_KEY (page.evaluate ARG, never inlined) — the same pattern
 * as shoot-section.mjs; the CF bot challenge gates public HTML + analytics ingest, NOT the
 * authed SPA shell, so local Chromium loads /admin fine. Targets (cinematic): LCP≤2000ms,
 * CLS≤0.05. Prints a table + the single worst offender + exits non-zero if any route
 * exceeds a generous 3000ms LCP ceiling (a real regression signal, not the strict target).
 *
 * Usage:
 *   E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/measure-admin-cwv.mjs
 *   E2E_API_KEY=… node e2e/admin-verify/measure-admin-cwv.mjs dashboard billing
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const req = createRequire(resolve(__dirname, '../../frontend/'));
const { chromium } = req('playwright');

const KEY = process.env.E2E_API_KEY;
if (!KEY) {
  console.log('::notice:: measure-admin-cwv skipped — E2E_API_KEY unset');
  process.exit(0);
}
const ORIGIN = process.env.ORIGIN || 'https://projectsites.dev';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const LCP_CEIL = parseInt(process.env.LCP_CEIL_MS || '3000', 10); // regression ceiling (not the 2000ms target)
const slugs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROUTES = slugs.length ? slugs : ['dashboard', 'analytics', 'billing', 'settings', 'audit', 'logs'];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent: UA,
  viewport: { width: 1280, height: 900 },
  serviceWorkers: 'block', // avoid a stale ngsw serving old JS skewing the measure
});
const page = await ctx.newPage();
await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(
  (k) => localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'e2e@megabyte.space', issuedAt: Date.now() })),
  KEY,
);

const rows = [];
for (const slug of ROUTES) {
  await page.goto(`${ORIGIN}/admin/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Wait for the SPA chrome to render, then let LCP settle (never networkidle — the admin
  // polls, so networkidle hangs). A generous settle so the largest paint is captured.
  await page.waitForSelector('nav[aria-label="Primary"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(4200);
  const m = await page.evaluate(
    () =>
      new Promise((res) => {
        let lcp = 0;
        let cls = 0;
        try {
          new PerformanceObserver((l) => {
            for (const e of l.getEntries()) lcp = e.startTime;
          }).observe({ type: 'largest-contentful-paint', buffered: true });
          new PerformanceObserver((l) => {
            for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value;
          }).observe({ type: 'layout-shift', buffered: true });
        } catch {
          /* observer types unsupported — leave zeros */
        }
        const nav = performance.getEntriesByType('navigation')[0];
        const fcp = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint')?.startTime;
        setTimeout(
          () =>
            res({
              lcp: Math.round(lcp),
              cls: Number(cls.toFixed(4)),
              fcp: fcp ? Math.round(fcp) : null,
              ttfb: nav ? Math.round(nav.responseStart) : null,
            }),
          600,
        );
      }),
  );
  rows.push({ slug, ...m });
}
await browser.close();

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n━━ admin cold-load CWV @1280 (${ORIGIN}) — target LCP≤2000ms · CLS≤0.05 ━━`);
console.log(`  ${pad('route', 14)} ${pad('LCP', 8)} ${pad('FCP', 8)} ${pad('TTFB', 8)} CLS`);
for (const r of rows) {
  const flag = r.lcp > LCP_CEIL ? ' 🔴' : r.lcp > 2000 ? ' ⚠️' : ' ✓';
  console.log(`  ${pad(r.slug, 14)} ${pad(r.lcp + 'ms', 8)} ${pad((r.fcp ?? '—') + 'ms', 8)} ${pad((r.ttfb ?? '—') + 'ms', 8)} ${r.cls}${flag}`);
}
const worst = rows.reduce((a, b) => (b.lcp > a.lcp ? b : a), rows[0]);
const over = rows.filter((r) => r.lcp > LCP_CEIL);
console.log(`\n  worst: /admin/${worst.slug} — LCP ${worst.lcp}ms`);
console.log(
  over.length
    ? `\nVERDICT: 🔴 ${over.length} route(s) over the ${LCP_CEIL}ms regression ceiling: ${over.map((r) => r.slug).join(', ')}`
    : `\nVERDICT: ✅ all ${rows.length} routes under the ${LCP_CEIL}ms ceiling (worst /admin/${worst.slug} ${worst.lcp}ms)`,
);
process.exit(over.length ? 1 : 0);
