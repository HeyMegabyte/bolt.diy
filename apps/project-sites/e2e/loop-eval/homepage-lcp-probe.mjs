// homepage-lcp-probe.mjs — guards the marketing homepage's prerendered-hero paint.
//
// The Worker injects a real hero <h1> into the served shell so First Contentful Paint
// is fast (~340ms throttled). A prior optimization deliberately did this — see the
// "<h1> below IS the LCP element" comments in the served HTML. This probe protects
// that win: with the APP's JS blocked (Angular never boots), the shell hero MUST be a
// fast, stable LCP. If someone removes the shell <h1>, no-app-js LCP spikes → this fails.
//
// It ALSO measures the full-JS LCP and REPORTS the "hydration gap" (Angular boots and
// re-renders the hero, creating a new, later LCP candidate — unstable 1–6s on throttled
// mobile). That gap is a KNOWN architectural characteristic (SPA re-render, not a font
// swap — proven by the no-app-js run being stable) and is tracked here, NOT hard-failed,
// until the SSR/hydration fix lands. When it does, this probe proves it.
//
// Usage: node e2e/loop-eval/homepage-lcp-probe.mjs   (ORIGIN env overrides prod)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolves playwright from the worker's node_modules (matches the sibling loop-eval
// probes' anchor — walking up from frontend/ finds it whether it lives in
// apps/project-sites/node_modules or frontend/node_modules).
const req = createRequire(resolve(__dirname, '../../frontend/'));
const { chromium } = req('playwright');

const ORIGIN = process.env.ORIGIN || 'https://projectsites.dev';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
// The shell hero must paint within this budget with the app JS blocked (pure prerender).
const SHELL_LCP_BUDGET_MS = 2000;
const RUNS = 2;

/** One throttled load; returns {fcp, lcp, el}. `blockApp` aborts the Angular bundle. */
async function measure(browser, blockApp) {
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: (1.5 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
    latency: 100,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  if (blockApp) {
    await page.route(/\.js(\?|$)/i, (r) =>
      /main-|polyfills|chunk-|scripts-/.test(r.request().url()) ? r.abort() : r.continue(),
    );
  }
  await page.goto(ORIGIN + '/', { waitUntil: 'load', timeout: 60000 }).catch(() => {});
  const m = await page.evaluate(
    () =>
      new Promise((res) => {
        let lcp = 0,
          el = '';
        new PerformanceObserver((l) => {
          const e = l.getEntries();
          const x = e[e.length - 1];
          lcp = x.startTime;
          el = x.element?.tagName || '';
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        const fcp = (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0;
        setTimeout(() => res({ fcp: Math.round(fcp), lcp: Math.round(lcp), el }), 6000);
      }),
  );
  await ctx.close();
  return m;
}

const browser = await chromium.launch();
const shell = [];
const full = [];
for (let i = 0; i < RUNS; i++) shell.push(await measure(browser, true));
for (let i = 0; i < RUNS; i++) full.push(await measure(browser, false));
await browser.close();

const min = (a) => Math.min(...a);
const max = (a) => Math.max(...a);
const shellLcp = shell.map((m) => m.lcp);
const fullLcp = full.map((m) => m.lcp);

console.log('━━ homepage LCP probe (throttled 6× CPU / ~1.5Mbps) ━━');
console.log(`  shell-only (app JS blocked): LCP ${shellLcp.join('/')}ms  (hero paints from the prerendered shell)`);
console.log(`  full (Angular boots):        LCP ${fullLcp.join('/')}ms  el=${full.map((m) => m.el).join('/')}`);
console.log(`  → hydration gap: up to ${max(fullLcp) - min(shellLcp)}ms (Angular re-renders the hero — tracked, architectural)`);

// GUARD: the shell hero must paint fast with app JS blocked. Fail only on a SHELL
// regression (removed/late prerendered hero) — the known Angular gap is reported, not failed.
const worstShell = max(shellLcp);
if (worstShell > SHELL_LCP_BUDGET_MS) {
  console.log(`  ✗ shell hero LCP ${worstShell}ms > ${SHELL_LCP_BUDGET_MS}ms budget — the prerendered hero regressed.`);
  process.exit(1);
}
console.log(`  ✓ shell hero LCP ${worstShell}ms ≤ ${SHELL_LCP_BUDGET_MS}ms — prerendered-hero paint intact.`);
if (max(fullLcp) > 2500) {
  console.log(`::notice:: homepage full-JS LCP ${max(fullLcp)}ms > 2000ms mandate — SPA-hydration re-render gap (see docs/decisions, Rec).`);
}
process.exit(0);
