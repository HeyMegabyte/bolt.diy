import { test, type Page } from '@playwright/test';
const KEY = process.env.E2E_API_KEY ?? '';
async function seed(page: Page){ await page.addInitScript((k:string)=>{try{localStorage.setItem('ps_session',JSON.stringify({token:k,identifier:'brian@megabyte.space',createdAt:Date.now()}));localStorage.setItem('ps_feedback_dismissed','true');}catch{}},KEY);}
test('editor pane geometry', async ({ page }) => {
  test.skip(!KEY,'no key');
  await seed(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForTimeout(5000);
  const geo = await page.evaluate(() => {
    const vh = window.innerHeight;
    const iframe = document.querySelector('iframe');
    const topbar = document.querySelector('.admin-topbar, [class*="topbar"], header');
    const tabs = document.querySelector('[class*="editor-tab"], [class*="tabstrip"], .editor-tabs');
    const r = (el: Element | null) => el ? (()=>{const b=el.getBoundingClientRect();return {top:Math.round(b.top),height:Math.round(b.height),bottom:Math.round(b.bottom)};})() : null;
    return { vh, iframe: r(iframe), topbar: r(topbar), tabs: r(tabs),
      iframeSel: iframe?.getAttribute('class') || iframe?.id || '(iframe)' };
  });
  console.log('GEO ' + JSON.stringify(geo, null, 2));
});
