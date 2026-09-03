// FIRE-74 logo verification — real-browser build via WAF, then assert apple-touch-icon.png
// is a real Ideogram/official logo (>4KB PNG) not the ~1KB blank monogram square.
import { chromium } from 'playwright';

const BEARER = process.env.BUILD_BEARER;
if (!BEARER) { console.error('BUILD_BEARER env required'); process.exit(2); }
const ORIGIN = 'https://projectsites.dev';
const stamp = process.env.STAMP || 'x';
const biz = {
  business_name: 'Stillwater Wellness Studio',
  business_category: 'wellness studio',
  business_address: '128 Higgins Ave, Missoula, MT 59802',
  business_hours: 'Mon-Fri 7am-8pm, Sat 8am-4pm',
  business_phone: '+1 406 555 0173',
  business_email: 'hello@stillwaterwellness.example',
  city: 'Missoula, MT',
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 60000 });

// Poll-only mode: pass SITE_ID + SLUG to verify an already-building site (no new build).
let siteId = process.env.SITE_ID;
let slug = process.env.SLUG;
if (!siteId || !slug) {
  // 1) create-from-search (from the real browser context → passes WAF)
  const created = await page.evaluate(async ({ origin, bearer, biz }) => {
    const r = await fetch(origin + '/api/sites/create-from-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bearer },
      body: JSON.stringify(biz),
    });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, body: j, raw: t.slice(0, 400) };
  }, { origin: ORIGIN, bearer: BEARER, biz });
  console.log('CREATE', created.status, JSON.stringify(created.body || created.raw).slice(0, 300));
  // Worker envelopes the record under `data`: {data:{site_id, slug, status, workflow_instance_id}}
  const d = created.body?.data || created.body || {};
  siteId = d.site_id || d.id || d.site?.id;
  slug = d.slug || d.site?.slug;
  if (!siteId || !slug) { console.error('NO_SITE_ID_OR_SLUG'); await browser.close(); process.exit(1); }
}
console.log('SITE', siteId, slug);

// 2) poll workflow to completion
let status = 'queued';
const t0 = Date.now();
while (Date.now() - t0 < 8 * 60 * 1000) {
  await new Promise((res) => setTimeout(res, 12000));
  const w = await page.evaluate(async ({ origin, bearer, id }) => {
    const r = await fetch(origin + '/api/sites/' + id + '/workflow', {
      headers: { Authorization: 'Bearer ' + bearer },
    });
    return r.ok ? r.json() : { status: 'http_' + r.status };
  }, { origin: ORIGIN, bearer: BEARER, id: siteId });
  status = w?.status || w?.workflow?.status || JSON.stringify(w).slice(0, 60);
  console.log('WORKFLOW', Math.round((Date.now() - t0) / 1000) + 's', status);
  if (['completed', 'published', 'failed', 'error'].includes(String(status))) break;
}

// 3) fetch apple-touch-icon.png from the published subdomain, assert real logo
const iconUrl = `https://${slug}.projectsites.dev/apple-touch-icon.png`;
const probe = await page.evaluate(async (u) => {
  const r = await fetch(u, { cache: 'no-store' });
  const buf = new Uint8Array(await r.arrayBuffer());
  const magic = Array.from(buf.slice(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join(' ');
  return { status: r.status, bytes: buf.length, magic, ct: r.headers.get('content-type') };
}, iconUrl);
console.log('APPLE_TOUCH_ICON', iconUrl);
console.log('  status=%s bytes=%s ct=%s magic=%s', probe.status, probe.bytes, probe.ct, probe.magic);
const isPng = probe.magic.startsWith('89 50 4e 47');
const isRealLogo = probe.bytes > 4096 && isPng;
console.log('  VERDICT:', isRealLogo ? '✅ REAL LOGO (>4KB PNG — Ideogram/official)' : (probe.bytes > 0 && probe.bytes < 4096 ? '⚠️ MONOGRAM FALLBACK (~1KB blank square — new image not live yet / no key at build)' : '❌ MISSING/BROKEN'));

await browser.close();
process.exit(isRealLogo ? 0 : 3);
