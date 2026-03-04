import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const base = process.env.SCREENSHOT_BASE_URL || 'http://localhost:4300';
const dir = '/tmp/screenshots';

// Homepage
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${dir}/01-hero.png` });
await page.screenshot({ path: `${dir}/02-full.png`, fullPage: true });

// Scroll to each section and screenshot viewport
const sections = [
  '.how-it-works', '.pricing-section', '.handled-section',
  '.faq-section', '.contact-section', '.site-footer'
];
let i = 3;
for (const sel of sections) {
  try {
    await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'start' }), sel);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/${String(i).padStart(2, '0')}-${sel.replace('.', '')}.png` });
    i++;
  } catch (e) { console.warn(`Skip ${sel}: ${e.message}`); i++; }
}

// Search dropdown
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const sb = page.locator('ion-searchbar');
await sb.click();
await sb.locator('input').fill('vito');
await page.waitForTimeout(3000);
await page.screenshot({ path: `${dir}/09-search-dropdown.png` });

// Other pages
for (const [name, path] of [
  ['10-signin', '/signin'],
  ['11-details', '/details'],
  ['12-admin', '/admin'],
  ['13-waiting', '/waiting?id=test&slug=test'],
]) {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

// Mobile
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${dir}/14-mobile-hero.png` });
await page.screenshot({ path: `${dir}/15-mobile-full.png`, fullPage: true });

// Mobile signin
await page.goto(`${base}/signin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${dir}/16-mobile-signin.png`, fullPage: true });

await browser.close();
console.log('Done.');
