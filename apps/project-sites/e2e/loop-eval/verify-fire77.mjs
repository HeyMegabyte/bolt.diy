// FIRE-77 live verification: category correctness (About catService), the 2 new woven
// blocks (HERO_SUBHEADLINE), Ken-Burns hero, app.js injection, gallery tiles, logo, theme.
import { chromium } from 'playwright';
const SLUG = process.env.SLUG || 'kestrel-family-dental-fort-collins';
const BASE = `https://${SLUG}.projectsites.dev`;
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 100)); });

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(1500);

const home = await page.evaluate(() => {
  const bg = getComputedStyle(document.body).backgroundColor;
  const hero = document.querySelector('.hero-kenburns, [class*="kenburns"], img[data-no-zoom]');
  const heroAnim = hero ? getComputedStyle(hero).animationName : '(no hero img)';
  const appjs = document.querySelector('script[src*="/app.js"]');
  const galleryTiles = document.querySelectorAll('[data-gallery] img, [class*="masonry"] img, [class*="columns-"] img').length;
  const allImgs = document.querySelectorAll('img').length;
  // hero subheadline: the text right under the H1
  const h1 = document.querySelector('h1');
  const sub = h1 ? (h1.parentElement?.querySelector('p')?.textContent || '').trim().slice(0, 160) : '';
  return {
    title: document.title,
    bg, heroAnim,
    appjs: appjs ? { slug: appjs.getAttribute('data-slug'), paid: appjs.getAttribute('data-paid'), src: appjs.getAttribute('src') } : null,
    hasPsRuntime: typeof window.__PS_APP_JS__ !== 'undefined',
    galleryTiles, allImgs,
    heroSub: sub,
  };
});
console.log('HOME title:', home.title);
console.log('  bg:', home.bg, '| heroAnim:', home.heroAnim);
console.log('  app.js:', JSON.stringify(home.appjs), '| __PS_APP_JS__:', home.hasPsRuntime);
console.log('  gallery-region imgs:', home.galleryTiles, '| total imgs:', home.allImgs);
console.log('  HERO_SUBHEADLINE (live):', home.heroSub);

// About page → catService correctness (family dentistry vs local service fallback)
await page.goto(BASE + '/about', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(1200);
const about = await page.evaluate(() => {
  const txt = (document.querySelector('main') || document.body).innerText;
  return txt.replace(/\s+/g, ' ').slice(0, 900);
});
const saysDentistry = /family dentistry|dentistry|dental/i.test(about);
const saysLocalService = /\blocal service\b/i.test(about);
console.log('\nABOUT (first 900 chars):', about);
console.log('\nCATEGORY CHECK → mentions dentistry/dental:', saysDentistry, '| says "local service":', saysLocalService);

// Logo (apple-touch-icon) now published
const logo = await page.evaluate(async (base) => {
  const r = await fetch(base + '/apple-touch-icon.png', { cache: 'no-store' });
  const b = new Uint8Array(await r.arrayBuffer());
  const magic = Array.from(b.slice(0, 4)).map((x) => x.toString(16).padStart(2, '0')).join('');
  return { status: r.status, bytes: b.length, isPng: magic === '89504e47' };
}, BASE);
console.log('\nLOGO apple-touch-icon:', logo.status, logo.bytes + 'B', 'png=' + logo.isPng,
  logo.bytes > 4096 && logo.isPng ? '✅ REAL (Ideogram/official)' : '⚠️ small/monogram');

console.log('\nCONSOLE ERRORS:', errs.length, errs.slice(0, 3).join(' | '));
await browser.close();
