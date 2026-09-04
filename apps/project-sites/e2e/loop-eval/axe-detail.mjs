// axe-detail — dump every WCAG color-contrast node on a URL with its real,
// canvas-resolved sRGB ratio (getComputedStyle returns oklch()/oklab() strings;
// parsing those L/C/H as RGB gives a garbage ~1:1 — so resolve via a 1px canvas).
// Scrolls first so reveal-on-view nodes mount. Usage: URL=https://… node axe-detail.mjs
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AxeBuilder = require('@axe-core/playwright').default;

const url = process.env.URL;
if (!url) { console.error('URL env required'); process.exit(2); }
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); });
await page.waitForTimeout(600);

const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
const cc = axe.violations.filter((v) => v.id === 'color-contrast');
console.log(`theme=${await page.evaluate(() => document.documentElement.dataset.style)}  color-contrast nodes: ${cc.reduce((a, v) => a + v.nodes.length, 0)}`);
for (const v of cc) for (const n of v.nodes) {
  console.log('\n── node ──');
  console.log('target :', JSON.stringify(n.target));
  console.log('html   :', (n.html || '').slice(0, 150));
  console.log('summary:', (n.failureSummary || '').replace(/\n/g, ' | '));
  const real = await page.evaluate((sel) => {
    const el = document.querySelector(Array.isArray(sel) ? sel[0] : sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    let bgEl = el, bg = s.backgroundColor;
    while (bgEl && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) { bgEl = bgEl.parentElement; bg = bgEl ? getComputedStyle(bgEl).backgroundColor : 'rgb(255,255,255)'; }
    const cv = document.createElement('canvas'); cv.width = cv.height = 1; const c = cv.getContext('2d');
    const toRGB = (x) => { c.fillStyle = '#000'; c.fillStyle = x; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    const lum = (x) => { const [r, g, b] = toRGB(x).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const L1 = lum(s.color), L2 = lum(bg); const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
    return { color: s.color, bg, ratio: +((hi + 0.05) / (lo + 0.05)).toFixed(2), fontSize: s.fontSize, fontWeight: s.fontWeight, cls: (el.className?.slice?.(0, 100)) };
  }, n.target);
  console.log('REAL   :', JSON.stringify(real));
}
await browser.close();
