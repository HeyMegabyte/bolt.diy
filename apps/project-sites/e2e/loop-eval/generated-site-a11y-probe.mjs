// generated-site-a11y-probe.mjs — WCAG 2.2 AA (axe) over the SERVED product sites.
//
// The public-a11y-probe covers the MARKETING funnel only; the generated sites the
// business pays for were never a11y-checked in CI — an ADA Title II / EU EAA gap. This
// samples N published sites × {mobile, desktop} and runs axe (wcag2/21/22 a + aa).
//
// TRACKING, not hard-fail (::notice): the template contrast fix (commit 2bb30da) lands
// only on a site's NEXT rebuild, so already-deployed sites keep failing until then — a
// hard gate would red-CI on history the loop hasn't rebuilt yet. Once the fleet has
// cycled clean, promote to blocking. Fails ONLY if the probe itself can't run.
// Usage: E2E_API_KEY=… node e2e/loop-eval/generated-site-a11y-probe.mjs [sampleSize]
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const req = createRequire(resolve(__dirname, '../../frontend/'));
const { chromium } = req('playwright');
const AxeBuilder = req('@axe-core/playwright').default;

const KEY = process.env.E2E_API_KEY;
if (!KEY) { console.log('::notice:: generated-site a11y skipped — E2E_API_KEY unset (fail-open).'); process.exit(0); }
const ORIGIN = process.env.ORIGIN || 'https://projectsites.dev';
const SAMPLE = Math.max(2, parseInt(process.argv[2] || '4', 10));
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BPS = [{ n: 'mobile', w: 390, h: 844 }, { n: 'desktop', w: 1280, h: 900 }];

const browser = await chromium.launch();
const ctx0 = await browser.newContext({ userAgent: UA });
const p0 = await ctx0.newPage();
await p0.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
const all = await p0.evaluate(async (k) => {
  const r = await fetch('/api/sites', { headers: { Authorization: 'Bearer ' + k } });
  const j = await r.json();
  return (j.data || []).filter((s) => s.status === 'published').map((s) => s.slug);
}, KEY);
await ctx0.close();

// Spread newest→oldest so the fix's rollout (newest sites clean first) is visible.
const step = Math.max(1, Math.floor(all.length / SAMPLE));
const sample = [];
for (let i = 0; i < all.length && sample.length < SAMPLE; i += step) sample.push(all[i]);

console.log(`━━ generated-site a11y (WCAG 2.2 AA): ${all.length} published, sampling ${sample.length} × ${BPS.length} bp ━━`);
const offenders = [];
let clean = 0;
for (const slug of sample) {
  const byBp = [];
  for (const bp of BPS) {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: bp.w, height: bp.h } });
    const page = await ctx.newPage();
    try {
      await page.goto(`https://${slug}.projectsites.dev/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2000);
      const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      const v = res.violations || [];
      if (v.length) byBp.push(`${bp.n}:${v.map((x) => `${x.id}(${x.nodes.length})`).join('+')}`);
    } catch (e) {
      byBp.push(`${bp.n}:PROBE_ERR`);
    }
    await ctx.close();
  }
  if (byBp.length === 0) { clean++; console.log(`  ✓ ${slug}`); }
  else { offenders.push(slug); console.log(`  • ${slug} → ${byBp.join('  ')}`); }
}
console.log(`  → ${clean}/${sample.length} axe-clean`);
if (offenders.length) {
  console.log(`::notice::${offenders.length}/${sample.length} sampled generated sites have axe violations (WCAG 2.2 AA) — expected to clear as sites rebuild off template ≥2bb30da: ${offenders.join(', ')}`);
}
await browser.close();
process.exit(0); // tracking probe — never hard-fail on pre-fix deployed history
