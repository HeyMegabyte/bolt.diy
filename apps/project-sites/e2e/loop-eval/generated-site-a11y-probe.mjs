// generated-site-a11y-probe.mjs — WCAG 2.2 AA (axe) over the SERVED product sites.
//
// The public-a11y-probe covers the MARKETING funnel only; the generated sites the
// business pays for were never a11y-checked in CI — an ADA Title II / EU EAA gap. This
// samples N published sites × {mobile, desktop} and runs axe (wcag2/21/22 a + aa),
// PLUS a separately-reported best-practice pass (heading-order/region/target-size).
//
// TRACKING, not hard-fail (::notice): the template a11y fixes (contrast ≥2bb30da;
// aria-hidden-focus via StickyActionBar `inert` — both VERIFIED axe-clean on the fixed
// template) land only on a site's NEXT rebuild, so already-deployed sites keep failing
// until then — a hard gate would red-CI on history the loop hasn't rebuilt yet. Rule ids
// in TEMPLATE_FIXED_RULES are that known-stale set; any OTHER WCAG rule id is a genuinely-
// NEW regression surfaced distinctly (::warning) so it can't hide among stale-build noise.
// Once the fleet cycles clean, promote to blocking. Fails ONLY if the probe can't run.
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
// axe 'best-practice' rules (heading-order, region/landmark, target-size, duplicate-id
// …) are NOT WCAG-tagged — validate-site + this WCAG pass both MISS them, so a template
// heading-order/region regression would ship undetected. Tracked SEPARATELY below so
// advisory best-practice never gets conflated with the WCAG-AA compliance signal.
const BP_TAGS = ['best-practice'];
const isWcag = (tags) => tags.some((t) => /^wcag/.test(t));
// WCAG rule ids ALREADY fixed in the template (verified axe-clean on the CURRENT
// template — contrast tokens ≥2bb30da; StickyActionBar `inert={!shown}` for
// aria-hidden-focus). Deployed sites keep flagging them until their NEXT rebuild, so
// these are known-stale, not live defects. A violation whose rule id is NOT in this
// set is a genuinely-new template regression — surfaced distinctly below.
const TEMPLATE_FIXED_RULES = new Set(['color-contrast', 'aria-hidden-focus']);
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
const offenders = [];      // WCAG 2.2 AA (compliance — the primary signal)
const novelOffenders = []; // WCAG rule ids NOT in TEMPLATE_FIXED_RULES (genuinely-new regressions)
const bpOffenders = [];    // best-practice (advisory — heading-order/region/target-size…)
let clean = 0;
for (const slug of sample) {
  const byBp = [];
  const bpBy = [];
  const siteWcagRules = new Set();
  for (const bp of BPS) {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: bp.w, height: bp.h } });
    const page = await ctx.newPage();
    try {
      await page.goto(`https://${slug}.projectsites.dev/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2000);
      const res = await new AxeBuilder({ page }).withTags([...TAGS, ...BP_TAGS]).analyze();
      const v = res.violations || [];
      const wcag = v.filter((x) => isWcag(x.tags));
      const advisory = v.filter((x) => !isWcag(x.tags));
      wcag.forEach((x) => siteWcagRules.add(x.id));
      if (wcag.length) byBp.push(`${bp.n}:${wcag.map((x) => `${x.id}(${x.nodes.length})`).join('+')}`);
      if (advisory.length) bpBy.push(`${bp.n}:${advisory.map((x) => `${x.id}(${x.nodes.length})`).join('+')}`);
    } catch (e) {
      byBp.push(`${bp.n}:PROBE_ERR`);
    }
    await ctx.close();
  }
  if (bpBy.length) bpOffenders.push(slug);
  const bpNote = bpBy.length ? `  [bp: ${bpBy.join(' ')}]` : '';
  if (byBp.length === 0) { clean++; console.log(`  ✓ ${slug}${bpNote}`); }
  else { offenders.push(slug); console.log(`  • ${slug} → ${byBp.join('  ')}${bpNote}`); }
  const novel = [...siteWcagRules].filter((id) => !TEMPLATE_FIXED_RULES.has(id));
  if (novel.length) novelOffenders.push(`${slug}(${novel.join('/')})`);
}
console.log(`  → ${clean}/${sample.length} axe-clean`);
if (offenders.length) {
  console.log(`::notice::${offenders.length}/${sample.length} sampled generated sites have WCAG 2.2 AA violations — the known template-fixed rules (${[...TEMPLATE_FIXED_RULES].join(', ')}) clear on each site's NEXT rebuild: ${offenders.join(', ')}`);
}
if (novelOffenders.length) {
  console.log(`::warning::${novelOffenders.length}/${sample.length} sampled sites flag a WCAG rule NOT in the template-fixed set — a genuinely-NEW regression to fix in the template (not stale history): ${novelOffenders.join(', ')}`);
} else if (offenders.length) {
  console.log(`  ↳ all WCAG findings are template-fixed rules (stale builds) — no novel regression.`);
}
if (bpOffenders.length) {
  console.log(`::notice::${bpOffenders.length}/${sample.length} sampled sites have axe BEST-PRACTICE findings (heading-order / region / target-size — advisory, not WCAG-AA compliance): ${bpOffenders.join(', ')}`);
}
await browser.close();
process.exit(0); // tracking probe — never hard-fail on pre-fix deployed history
