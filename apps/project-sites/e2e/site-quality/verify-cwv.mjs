// verify-cwv.mjs — COMPLETION § C.2: do DEPLOYED generated sites clear Core Web Vitals?
//
// Audits the LIVE product (`{slug}.projectsites.dev`) with a real headless Chromium, measuring
// the load-time CWV via PerformanceObserver on a COLD load (worst-case, honest):
//   • LCP  ≤ 2000ms   (cinematic target; Google "good" is ≤2500ms)
//   • CLS  ≤ 0.05      (cinematic target; Google "good" is ≤0.1)
// Also reports TTFB (navigation.responseStart) for diagnosis. INP is interaction-driven and
// cannot be produced by a headless page load with no user input — it is NOT gated here (a
// generated business-site hero has negligible interaction cost); measure it in the field.
//
// A generated site is the CORE PRODUCT — a slow LCP there ships to the business's real
// visitors. Fixes are ROOT-CAUSE in the TEMPLATE (github.com/HeyMegabyte/template.projectsites.dev
// — lands next build) or the worker serving path (`src/services/site_serving.ts`, e.g. cache
// headers / render-blocking assets) — NEVER a one-off patch to one deployed site.
//
// Usage:
//   SITES=vanta-strength-austin node e2e/site-quality/verify-cwv.mjs
//   node e2e/site-quality/verify-cwv.mjs            # default SITES
import { chromium } from 'playwright';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const SITES = (process.env.SITES || 'vanta-strength-austin,ironhaus-houston').split(',').map((s) => s.trim()).filter(Boolean);
// Measure at a mobile-representative width (CWV is scored mobile-first) — matches the a11y probe's
// smallest breakpoint so the two audits share a viewport.
const VIEWPORT = { width: Number(process.env.VIEWPORT) || 390, height: 844 };
const LCP_BUDGET_MS = 2000;
const CLS_BUDGET = 0.05;
const SETTLE_MS = 4000; // let LCP finalize + layout shifts accrue before reading

let fails = 0;
const rows = [];

const browser = await chromium.launch({ headless: true });
try {
  for (const slug of SITES) {
    const base = `https://${slug}.projectsites.dev`;
    const ctx = await browser.newContext({ userAgent: UA, viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      // `load` (not `networkidle`) — generated sites keep a beacon/poll open so networkidle
      // never settles (the a11y + admin-verify probes learned this).
      const resp = await page.goto(base, { waitUntil: 'load', timeout: 30000 });
      const title = await page.title().catch(() => '');
      // A CF challenge / non-200 shell is NOT a valid CWV sample — never report a phantom pass.
      if (!resp || resp.status() !== 200 || /just a moment|checking your browser/i.test(title)) {
        rows.push({ slug, note: `NOT MEASURABLE (status=${resp ? resp.status() : 'none'} / challenge shell)` });
        await ctx.close();
        continue;
      }
      const cwv = await page.evaluate(
        (settle) =>
          new Promise((resolve) => {
            let lcp = 0;
            let cls = 0;
            try {
              new PerformanceObserver((l) => {
                for (const e of l.getEntries()) lcp = e.startTime; // last candidate wins
              }).observe({ type: 'largest-contentful-paint', buffered: true });
              new PerformanceObserver((l) => {
                for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value;
              }).observe({ type: 'layout-shift', buffered: true });
            } catch {
              /* observer type unsupported → resolve with what we have */
            }
            setTimeout(() => {
              const nav = performance.getEntriesByType('navigation')[0];
              resolve({
                lcp: Math.round(lcp),
                cls: Number(cls.toFixed(4)),
                ttfb: nav ? Math.round(nav.responseStart) : null,
              });
            }, settle);
          }),
        SETTLE_MS,
      );
      const lcpOk = cwv.lcp > 0 && cwv.lcp <= LCP_BUDGET_MS;
      const clsOk = cwv.cls <= CLS_BUDGET;
      const pass = lcpOk && clsOk;
      if (!pass) fails++;
      rows.push({ slug, ...cwv, lcpOk, clsOk, pass });
    } catch (e) {
      fails++;
      rows.push({ slug, note: `measure error: ${String(e).slice(0, 80)}` });
    } finally {
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

console.log(`\n━━ § C.2 generated-site CWV (cold load @ ${VIEWPORT.width}px) ━━`);
for (const r of rows) {
  if (r.note) {
    console.log(`  ⚠️  ${r.slug} — ${r.note}`);
    continue;
  }
  const mark = r.pass ? '✅' : '❌';
  console.log(
    `  ${mark} ${r.slug} — LCP ${r.lcp}ms ${r.lcpOk ? '✓' : `✗ >${LCP_BUDGET_MS}`} · CLS ${r.cls} ${r.clsOk ? '✓' : `✗ >${CLS_BUDGET}`} · TTFB ${r.ttfb}ms`,
  );
}

const measurable = rows.filter((r) => !r.note);
if (measurable.length === 0) {
  console.log('\n::notice:: skipped — no site was measurable (all non-200 / challenge shells).');
  process.exit(0);
}
if (fails > 0) {
  console.error(`\n✗ § C.2 FAIL — ${fails} site(s) miss the CWV budget (root-fix in TEMPLATE / site_serving).`);
  process.exit(1);
}
console.log(`\nVERDICT: ✅ § C.2 PASS — ${measurable.length} deployed site(s) clear LCP ≤ ${LCP_BUDGET_MS}ms + CLS ≤ ${CLS_BUDGET}.`);
