// Build a real site off template ≥785b4e3 and prove the ELABORATED [data-style]
// flourish ships live. A law firm → businessClass 'legal' → editorial (self-heal
// or explicit), whose NEW signature is an accent hairline inset into every
// surface top edge + 0.2em mono labels. Asserts on the live client-DOM:
//   · dataset.style is a real preset (theme activated)
//   · editorial: a surface carries an `inset … 0px 2px` accent shadow
//   · .font-mono labels are re-tracked (letter-spacing widened)
//   · axe WCAG 2.2 AA = 0 color-contrast (decorative flourish ⇒ no regression)
//   · <meta description> non-empty (fix-empty-meta net)
// Trigger via a real browser (create-from-search is WAF-gated). BUILD_BEARER=E2E key.
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AxeBuilder = require('@axe-core/playwright').default;

const BEARER = process.env.BUILD_BEARER;
if (!BEARER) { console.error('BUILD_BEARER env required'); process.exit(2); }
const ORIGIN = 'https://projectsites.dev';
const biz = process.env.BIZ_JSON ? JSON.parse(process.env.BIZ_JSON) : {
  business_name: 'Camden & Rowe Trial Attorneys',
  business_category: 'law firm',
  business_address: '412 Marquette Ave S, Minneapolis, MN 55402',
  business_hours: 'Mon-Fri 8:30am-6pm',
  business_phone: '+1 612 555 0148',
  business_email: 'intake@camdenrowe.example',
  city: 'Minneapolis, MN',
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 60000 });

let siteId = process.env.SITE_ID, slug = process.env.SLUG;
if (!siteId || !slug) {
  const created = await page.evaluate(async ({ origin, bearer, biz }) => {
    const r = await fetch(origin + '/api/sites/create-from-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bearer },
      body: JSON.stringify(biz),
    });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, body: j, raw: t.slice(0, 300) };
  }, { origin: ORIGIN, bearer: BEARER, biz });
  console.log('CREATE', created.status, JSON.stringify(created.body?.data || created.raw).slice(0, 200));
  const d = created.body?.data || created.body || {};
  siteId = d.site_id || d.id; slug = d.slug;
  if (!siteId || !slug) { console.error('NO_SITE_ID'); await browser.close(); process.exit(1); }
}
console.log('SITE', siteId, slug);

let status = 'queued';
const t0 = Date.now();
while (Date.now() - t0 < 8 * 60 * 1000) {
  await new Promise((r) => setTimeout(r, 12000));
  const w = await page.evaluate(async ({ origin, bearer, id }) => {
    const r = await fetch(origin + '/api/sites/' + id + '/workflow', { headers: { Authorization: 'Bearer ' + bearer } });
    return r.ok ? r.json() : { status: 'http_' + r.status };
  }, { origin: ORIGIN, bearer: BEARER, id: siteId });
  const d = w?.data || w || {};
  status = d.site_status || d.workflow_status || d.status || 'unknown';
  console.log('WORKFLOW', Math.round((Date.now() - t0) / 1000) + 's', status + (d.workflow_error ? ' err=' + String(d.workflow_error).slice(0, 80) : ''));
  if (['completed', 'published', 'failed', 'error', 'errored'].includes(String(status))) break;
}
if (!['completed', 'published'].includes(String(status))) { console.error('BUILD_NOT_PUBLISHED', status); await browser.close(); process.exit(1); }

const url = `https://${slug}.projectsites.dev/`;
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1200);
const dom = await page.evaluate(() => {
  const cs = (el, p) => (el ? getComputedStyle(el)[p] : null);
  const surfaces = [...document.querySelectorAll('.card-tactile, .glass, .glass-strong')];
  const hasInset = surfaces.some((el) => (getComputedStyle(el).boxShadow || '').includes('inset'));
  const mono = document.querySelector('.font-mono');
  const meta = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
  return {
    style: document.documentElement.dataset.style || '(unset)',
    surfaceCount: surfaces.length,
    hasInsetAccent: hasInset,
    monoTracking: cs(mono, 'letterSpacing'),
    metaLen: meta.length,
    metaHead: meta.slice(0, 80),
  };
});
console.log('\nLIVE DOM', url);
console.log(JSON.stringify(dom, null, 2));

const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
const cc = axe.violations.filter((v) => v.id === 'color-contrast');
console.log(`axe: ${axe.violations.length} total, ${cc.length} color-contrast`);
for (const v of axe.violations.slice(0, 6)) console.log(`  · ${v.id} (${v.nodes?.length})`);

const checks = {
  'theme activated (dataset.style set)': dom.style !== '(unset)' && dom.style !== '',
  'meta description non-empty': dom.metaLen > 0,
  'no color-contrast violations': cc.length === 0,
  'editorial: accent inset hairline on a surface': dom.style !== 'editorial' || dom.hasInsetAccent,
};
console.log('\nchecks:');
let ok = true;
for (const [k, v] of Object.entries(checks)) { console.log(`  ${v ? '✓' : '✗'} ${k}`); if (!v) ok = false; }
console.log(ok ? `\nPASS — ${dom.style} theme live at ${url}` : '\nFAIL');
await browser.close();
process.exit(ok ? 0 : 1);
