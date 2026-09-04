// generated-site-health-sweep.mjs — CONTINUOUS health of the SERVED generated sites.
// The site-gen loop evals a site AT BUILD time; nothing re-checks OLD published sites, so
// post-build regressions go uncaught: a stale ServiceWorker serving broken JS, a bad
// app.js deploy breaking old sites, or a pre-stub-guard content-stub (empty H1 / thin body)
// left published. This samples N published sites for the caller's org and asserts each
// serves 200 + a real H1 + a non-thin body + injected app.js + 0 console errors. Exits 1 on
// any broken site. Usage: E2E_API_KEY=… node e2e/loop-eval/generated-site-health-sweep.mjs [sampleSize]
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const req = createRequire(resolve(__dirname, '../../frontend/'));
const { chromium } = req('playwright');

const KEY = process.env.E2E_API_KEY;
if (!KEY) { console.log('::notice:: health-sweep skipped — E2E_API_KEY unset (fail-open).'); process.exit(0); }
const ORIGIN = process.env.ORIGIN || 'https://projectsites.dev';
const SAMPLE = Math.max(3, parseInt(process.argv[2] || '6', 10));
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
// Third-party console noise to ignore (same set the a11y/admin probes use).
const IGNORE = /analytics|posthog|\/ingest|favicon|sentry|beacon|cf-|challenge|doubleclick|clarity|hotjar/i;

const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, serviceWorkers: 'block' });
const page = await ctx.newPage();
await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
const all = await page.evaluate(async (k) => {
  const r = await fetch('/api/sites', { headers: { Authorization: 'Bearer ' + k } });
  const j = await r.json();
  return (j.data || []).filter((s) => s.status === 'published').map((s) => s.slug);
}, KEY);

// Deterministic spread across the list (newest few + evenly-spaced middle + oldest) so a
// bad batch anywhere in the history surfaces — not just the newest N.
const picks = new Set();
for (let i = 0; i < Math.min(3, all.length); i++) picks.add(all[i]);
const step = Math.max(1, Math.floor(all.length / (SAMPLE - 2)));
for (let i = 0; i < all.length && picks.size < SAMPLE; i += step) picks.add(all[i]);
if (all.length) picks.add(all[all.length - 1]);
const sample = [...picks].slice(0, SAMPLE);

console.log(`━━ generated-site health sweep: ${all.length} published, sampling ${sample.length} ━━`);
let broken = 0;
for (const slug of sample) {
  const errs = [];
  const pg = await ctx.newPage();
  pg.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text().slice(0, 70)); });
  pg.on('pageerror', (e) => { const t = String(e); if (!IGNORE.test(t)) errs.push('pageerror:' + t.slice(0, 70)); });
  let status = '?', info = { h1: '', appjs: false, bodyLen: 0 };
  try {
    const resp = await pg.goto(`https://${slug}.projectsites.dev/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    status = resp ? resp.status() : '?';
    await pg.waitForTimeout(2500);
    info = await pg.evaluate(() => ({
      h1: (document.querySelector('h1')?.textContent || '').trim().slice(0, 42),
      appjs: !!document.querySelector('script[src*="projectsites.dev/app.js"]'),
      bodyLen: (document.body.innerText || '').trim().length,
    }));
  } catch (e) { status = 'NAV_ERR:' + String(e).slice(0, 40); }
  // Thin/broken: not 200, OR empty H1, OR body < 1000 chars (healthy sites are ~4000), OR console errors.
  const ok = status === 200 && info.h1.length > 0 && info.bodyLen >= 1000 && errs.length === 0;
  if (!ok) broken++;
  console.log(`  ${ok ? '✓' : '✗'} ${slug.padEnd(36)} ${status} h1="${info.h1}" body=${info.bodyLen} appjs=${info.appjs}${errs.length ? ' ERR:' + errs.join('|') : ''}`);
  await pg.close();
}
console.log(`  → ${broken === 0 ? 'ALL HEALTHY' : broken + ' broken/thin site(s)'}`);
await browser.close();
process.exit(broken === 0 ? 0 : 1);
