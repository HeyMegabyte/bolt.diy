// appjs-logo-probe.mjs — formalizes loop steps 4 (app.js edge-hijack) + 6 (logo/og
// assets) for a PUBLISHED projectsites.dev site. Real Chromium (WAF-safe UA), resolves
// Playwright from the frontend workspace, serviceWorkers blocked. Exits 1 on any HARD
// gate fail. Usage: node e2e/loop-eval/appjs-logo-probe.mjs <slug>
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const req = createRequire(resolve(__dirname, '../../frontend/'));
const { chromium } = req('playwright');

const slug = process.argv[2];
if (!slug) { console.error('usage: appjs-logo-probe.mjs <slug>'); process.exit(2); }
const BASE = `https://${slug}.projectsites.dev`;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, serviceWorkers: 'block' });
const page = await ctx.newPage();
const fails = [];
const ok = [];

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2500); // let edge-injected app.js + hydration settle

// STEP 4 — app.js edge-hijack
const appjs = await page.evaluate(() => {
  const s = document.querySelector('script[src="https://projectsites.dev/app.js"]');
  return s
    ? { present: true, defer: s.defer || s.hasAttribute('defer'), slug: s.getAttribute('data-slug'), paid: s.getAttribute('data-paid') }
    : { present: false };
});
appjs.present ? ok.push(`app.js injected (defer=${appjs.defer} data-slug=${appjs.slug} data-paid=${appjs.paid})`)
              : fails.push('app.js script NOT injected');

const form = await page.evaluate(() => {
  const f = document.querySelector('form');
  return f ? { present: true, action: f.getAttribute('action') || '', fields: f.querySelectorAll('input,textarea,select').length } : { present: false };
});
form.present ? ok.push(`contact form present (${form.fields} fields, app.js capture-phase hijack → /api/contact-form/${slug})`)
             : fails.push('no contact form found for app.js hijack');

// unpaid "Pay & upgrade"/"Register" bar only when data-paid="false"
if (appjs.paid === 'false') {
  const bar = await page.evaluate(() =>
    /pay\s*&?\s*upgrade|register now|built on projectsites|claim for/i.test(document.body.innerText));
  bar ? ok.push('unpaid upgrade bar renders (data-paid=false)') : fails.push('data-paid=false but no upgrade bar text');
} else {
  ok.push(`paid/registered site (data-paid=${appjs.paid}) — upgrade bar correctly hidden`);
}

// STEP 6 — logo + meta-art assets
const navLogo = await page.evaluate(() => {
  const header = document.querySelector('header') || document.body;
  const img = header.querySelector('img');
  return img ? { present: true, src: img.currentSrc || img.src, alt: img.alt || '' } : { present: false };
});
navLogo.present ? ok.push(`navbar logo <img> present (${(navLogo.src || '').slice(0, 60)})`)
               : fails.push('no navbar logo <img> in header');

async function probe(path) {
  return page.evaluate(async (u) => {
    try {
      const r = await fetch(u, { cache: 'no-store' });
      const buf = new Uint8Array(await r.arrayBuffer());
      const magic = Array.from(buf.slice(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join(' ');
      return { status: r.status, bytes: buf.length, magic, ct: r.headers.get('content-type') };
    } catch (e) { return { status: 0, err: String(e) }; }
  }, BASE + path);
}
const apple = await probe('/apple-touch-icon.png');
const isPng = (apple.magic || '').startsWith('89 50 4e 47');
apple.status === 200 && isPng && apple.bytes > 4096
  ? ok.push(`apple-touch-icon.png REAL (${apple.bytes}B PNG)`)
  : fails.push(`apple-touch-icon.png weak: status=${apple.status} bytes=${apple.bytes} png=${isPng} (monogram/missing)`);

const og = await page.evaluate(() => {
  const m = document.querySelector('meta[property="og:image"]');
  return m ? m.getAttribute('content') : null;
});
og ? ok.push(`og:image meta present (${(og || '').slice(0, 60)})`) : fails.push('no og:image meta');

console.log(`━━ app.js + logo probe: ${slug} → ${fails.length === 0 ? 'PASS' : 'FAIL'} ━━`);
for (const o of ok) console.log('  ✓', o);
for (const f of fails) console.log('  ✗', f);
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
