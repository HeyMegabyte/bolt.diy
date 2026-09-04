// public-a11y-probe.mjs — axe-core WCAG audit of the PUBLIC conversion funnel
// (homepage → /search → /create → /pricing → /blog) on prod. Real Chromium (WAF-safe
// UA), resolves playwright + axe from the frontend workspace, hydration-aware. Reports
// critical + serious violations. Exit 1 if any. Usage: node public-a11y-probe.mjs [origin]
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const req = createRequire(resolve(__dirname, '../../frontend/'));
const { chromium } = req('playwright');
const { default: AxeBuilder } = req('@axe-core/playwright');

const ORIGIN = process.argv[2] || 'https://projectsites.dev';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const ROUTES = ['/', '/search', '/create', '/pricing', '/blog'];
// Full WCAG-mandate breakpoint set (375/390/768/1024/1280/1920) — the tablet
// widths (768/1024) surface target-size + reflow + focus-obscured violations the
// phone/desktop pair misses.
const BPS = [
  { name: 'se', width: 375, height: 667 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'wide', width: 1920, height: 1080 },
];

const browser = await chromium.launch();
let total = 0;
const rows = [];

for (const bp of BPS) {
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: bp.width, height: bp.height }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  for (const route of ROUTES) {
    try {
      await page.goto(ORIGIN + route, { waitUntil: 'domcontentloaded', timeout: 45000 });
      // Angular SPA: wait for hydration (a real landmark), then settle.
      await page.waitForSelector('main, nav, h1', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1800);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
      total += serious.length;
      const label = `${route} @${bp.name}`.padEnd(24);
      if (serious.length === 0) {
        rows.push(`  ✓ ${label} clean`);
      } else {
        rows.push(`  ✗ ${label} ${serious.length} violation(s):`);
        for (const v of serious) {
          rows.push(`      [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node/s)`);
          rows.push(`        e.g. ${(v.nodes[0]?.target || []).join(' ')} — ${(v.nodes[0]?.html || '').slice(0, 90)}`);
        }
      }
    } catch (e) {
      rows.push(`  ! ${route} @${bp.name} nav error: ${String(e).slice(0, 70)}`);
    }
  }
  await ctx.close();
}

console.log(`━━ public a11y (axe WCAG 2.2 AA): ${ORIGIN} → ${total === 0 ? 'CLEAN' : total + ' serious/critical'} ━━`);
for (const r of rows) console.log(r);
await browser.close();
process.exit(total === 0 ? 0 : 1);
