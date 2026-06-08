import { test, type Page } from '@playwright/test';
const KEY = process.env.E2E_API_KEY ?? '';
async function seed(page: Page){ await page.addInitScript((k:string)=>{try{localStorage.setItem('ps_session',JSON.stringify({token:k,identifier:'brian@megabyte.space',createdAt:Date.now()}));localStorage.setItem('ps_feedback_dismissed','true');}catch{}},KEY);}
test('feature-flags top', async ({ page }) => {
  test.skip(!KEY,'no key');
  await seed(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/admin/feature-flags',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForTimeout(4500);
  await page.screenshot({ path: 'e2e/_ff_top.png' });
  // capture the mode switcher + first flag card region
  const modes = await page.evaluate(() => {
    const txt = (s: string) => Array.from(document.querySelectorAll(s)).map(e=>(e.textContent||'').trim().slice(0,40)).filter(Boolean).slice(0,12);
    return { modeBtns: txt('[role="tab"], .mode-btn, [class*="mode"]'), h2: txt('h1,h2') };
  });
  console.log('MODES ' + JSON.stringify(modes));
});
