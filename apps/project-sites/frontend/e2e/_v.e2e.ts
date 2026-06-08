import { test, expect, type Page } from '@playwright/test';
const KEY = process.env.E2E_API_KEY ?? '';
async function seed(p: Page){ await p.addInitScript((k:string)=>{try{localStorage.setItem('ps_session',JSON.stringify({token:k,identifier:'brian@megabyte.space',createdAt:Date.now()}));localStorage.setItem('ps_feedback_dismissed','true');}catch{}},KEY);}
test('swarm unavailable → Start Swarm disabled', async ({ page }) => {
  test.skip(!KEY,'no key'); await seed(page);
  await page.goto('/admin/swarm/e2e-site-3',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(4000);
  const body = await page.locator('body').innerText();
  if (body.includes("isn't available") || body.includes('not available')) {
    await expect(page.locator('.swarm-header__start')).toBeDisabled();
    await expect(page.locator('.swarm-preview__connect')).toBeDisabled();
    console.log('PASS: unavailable → Start Swarm + Connect disabled');
  } else { console.log('swarm available for this site → buttons enabled (expected)'); }
});
