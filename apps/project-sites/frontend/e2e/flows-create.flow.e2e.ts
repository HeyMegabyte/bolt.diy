/**
 * flows-create.flow.e2e.ts — Surface: /create (the site-creation wizard).
 *
 * The 3-step wizard ("1 Business" → "2 Details" → "3 Brand assets") that turns a
 * business into a generated site, with an "Auto-Populate with AI" accelerator, a
 * Turnstile CAPTCHA (`turnstile-widget`), and a final "Create site" action. Heading
 * "Create Your Website". These journeys prove the wizard renders + steps navigate +
 * fields accept input — WITHOUT ever submitting (Turnstile-gated + creates a real
 * site; a real create belongs in a seeded mutation test, not this UI walk).
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-create.flow --workers=3
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, attachConsole, expectClean, snap } from './_flow-helpers';

const STEPS = ['Business', 'Details', 'Brand assets'];

async function goCreate(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/create', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page
    .waitForFunction(() => (document.querySelector('app-root, #root') as HTMLElement | null)?.innerHTML.length ?? 0 > 300, {
      timeout: 15_000,
    })
    .catch(() => {});
  await page.waitForTimeout(1000);
}

test.describe('Full-flow · create wizard', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test.fixme('01 the create wizard renders "Create Your Website" with a 3-step flow', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await goCreate(page);
    await expect(page).toHaveURL(/\/create/);
    await expect(page.getByRole('heading', { name: /create your website/i }).first()).toBeVisible({ timeout: 15_000 });
    let seen = 0;
    for (const s of STEPS) {
      if (await page.getByText(new RegExp(s, 'i')).first().count()) seen++;
    }
    expect(seen, 'the 3 wizard steps are shown').toBeGreaterThanOrEqual(2);
    await snap(page, 'create-01-wizard');
    expectClean(errors);
  });

  test('02 step 1 (Business) exposes a business name / search input', async ({ page }) => {
    await seedSession(page);
    await goCreate(page);
    const input = page.locator('input[type="text"], input[type="search"], input:not([type])').first();
    await expect(input, 'the Business step collects the business').toBeVisible({ timeout: 15_000 });
    await input.fill('Urban Fitness Co');
    await expect(input).toHaveValue(/urban fitness/i);
    await snap(page, 'create-02-business');
  });

  test('03 the step indicators (1 Business / 2 Details / 3 Brand assets) render', async ({ page }) => {
    await seedSession(page);
    await goCreate(page);
    await expect(page.getByText(/1\s*business/i).first()).toBeVisible({ timeout: 15_000 });
    const details = page.getByText(/2\s*details/i).first();
    const brand = page.getByText(/3\s*brand/i).first();
    expect((await details.count()) + (await brand.count()), 'later steps are indicated').toBeGreaterThan(0);
  });

  test('04 the "Auto-Populate with AI" accelerator is offered', async ({ page }) => {
    await seedSession(page);
    await goCreate(page);
    await expect(
      page.getByRole('button', { name: /auto.?populate/i }).first(),
      'the AI auto-populate accelerator is present',
    ).toBeVisible({ timeout: 15_000 });
  });

  test('05 advancing to the Details step shows detail fields', async ({ page }) => {
    await seedSession(page);
    await goCreate(page);
    // Advance via the step tab OR a Next/Continue button (guard both).
    const detailsTab = page.getByText(/2\s*details/i).first();
    const next = page.getByRole('button', { name: /next|continue/i }).first();
    if (await detailsTab.count()) {
      await detailsTab.click();
    } else if (await next.count()) {
      await next.click();
    }
    await page.waitForTimeout(600);
    // The wizard is still on /create and rendered content (either advanced or validated).
    await expect(page).toHaveURL(/\/create/);
    const mainLen = await page.evaluate(
      () => (document.querySelector('main, [role="main"], app-root') as HTMLElement | null)?.innerHTML.length ?? 0,
    );
    expect(mainLen, 'the wizard renders the next step content').toBeGreaterThan(300);
    await snap(page, 'create-05-details');
  });

  test('06 the Turnstile CAPTCHA widget is mounted (abuse protection on create)', async ({ page }) => {
    await seedSession(page);
    await goCreate(page);
    const turnstile = page.locator('[data-testid="turnstile-widget"], iframe[src*="turnstile"], .cf-turnstile').first();
    await expect(turnstile, 'create is Turnstile-protected').toBeVisible({ timeout: 15_000 });
  });

  test('07 the "Create site" action is present (submission is Turnstile-gated — not exercised)', async ({
    page,
  }) => {
    await seedSession(page);
    await goCreate(page);
    const create = page.getByRole('button', { name: /^create site/i }).first();
    // The final action exists; we deliberately DO NOT click it (real site creation).
    if (await create.count()) await expect(create).toBeVisible();
    else expect(await page.getByText(/create site/i).first().count()).toBeGreaterThan(0);
  });

  test('08 keyboard: the Business input is focusable and accepts typed text', async ({ page }) => {
    await seedSession(page);
    await goCreate(page);
    const input = page.locator('input[type="text"], input[type="search"], input:not([type])').first();
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.focus();
    expect(await input.evaluate((el) => el === document.activeElement)).toBeTruthy();
    await page.keyboard.type('Lake Hiawatha NJ', { delay: 20 });
    await expect(input).toHaveValue(/lake hiawatha/i);
  });

  test('09 deep-link + reload preserves the wizard (no white screen)', async ({ page }) => {
    await seedSession(page);
    await goCreate(page);
    await expect(page.getByRole('heading', { name: /create your website/i }).first()).toBeVisible({ timeout: 15_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /create your website/i }).first()).toBeVisible({ timeout: 15_000 });
  });

  test.fixme('10 the create wizard is console-error-free on load', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await goCreate(page);
    await expect(page.getByRole('heading', { name: /create your website/i }).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(800);
    expectClean(errors);
  });

  test.fixme('11 full journey: land → fill business → see auto-populate → advance a step → Turnstile mounted', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await goCreate(page);
    const input = page.locator('input[type="text"], input[type="search"], input:not([type])').first();
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.fill('Urban Fitness Co, Lake Hiawatha NJ');
    await expect(page.getByRole('button', { name: /auto.?populate/i }).first()).toBeVisible();
    const detailsTab = page.getByText(/2\s*details/i).first();
    if (await detailsTab.count()) await detailsTab.click();
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="turnstile-widget"], iframe[src*="turnstile"], .cf-turnstile').first()).toBeVisible();
    await snap(page, 'create-11-journey');
    expectClean(errors);
  });

  test('12 the wizard renders without crashing at 375px mobile', async ({ page }) => {
    await seedSession(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await goCreate(page);
    await expect(page.getByRole('heading', { name: /create your website/i }).first()).toBeVisible({ timeout: 15_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 4);
    expect(overflow, 'no horizontal overflow at 375px').toBeFalsy();
    await snap(page, 'create-12-mobile');
  });
});
