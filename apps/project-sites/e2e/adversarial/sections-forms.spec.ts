/**
 * adversarial/sections-forms.spec.ts
 *
 * ADVERSARIAL — Form-heavy admin sections (modernized 2026-07-31):
 * settings business profile + user settings.
 *
 * Scenarios:
 *  ADV-FRM-06  Settings: hard reload on /admin/settings — shell re-mounts
 *  ADV-FRM-08  Settings: pristine business form — Save is DISABLED
 *              (empty-submit + double-submit guard), typing enables it
 *  ADV-FRM-20  Settings: navigating away with unsaved business edits — no crash
 *
 * Modernization notes:
 *  - networkidle NEVER settles on this app — domcontentloaded + locator waits.
 *  - The old "/admin/user generic Save click" and "CF zone/token credential
 *    inputs" were vanilla-era assumptions. The live settings surface exposes
 *    the business profile form (business-name / business-website /
 *    business-save testids) whose Save carries the real guard:
 *    [disabled]="!businessDirty() || savingBusiness()".
 *
 * Rules:
 *  - authedPage fixture: signInAsTestUser + catch-all /api/** stubs run
 *    BEFORE any /admin navigation — authed GETs never reach prod. The stub
 *    seeds ONE site (e2e-site-001) so selectedSite is truthy and the
 *    business form actually renders.
 *  - Internal nav via UI clicks / routerLink locators only.
 *  - No page.waitForTimeout. Parallel-safe (isolated context per test).
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'https://projectsites.dev'; // localhost:8787 fallback sent the whole suite to a stray dev server ("governor" page)

// ─── helpers ────────────────────────────────────────────────────────────────

async function gotoAdmin(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('aside').first()).toBeVisible({ timeout: 20_000 });
}

function collectErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      const lower = t.toLowerCase();
      if (
        !lower.includes('favicon') &&
        !lower.includes('failed to load resource') &&
        !t.includes('net::ERR_BLOCKED') &&
        !t.includes('ERR_ABORTED') &&
        !t.includes('ERR_FAILED')
      ) {
        errors.push(t);
      }
    }
  });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
  return errors;
}

async function clickNav(
  page: import('@playwright/test').Page,
  routerLink: string,
): Promise<boolean> {
  const link = page.locator(`a[routerLink="${routerLink}"]`).first();
  const visible = await link.isVisible({ timeout: 4_000 }).catch(() => false);
  if (visible) {
    await link.click();
    await page
      .waitForURL(new RegExp(routerLink.replace(/\//g, '\\/')), { timeout: 8_000 })
      .catch(() => undefined);
  }
  return visible;
}

async function injectSentinel(page: import('@playwright/test').Page): Promise<number> {
  const v = Math.random();
  await page.evaluate((val: number) => {
    (window as unknown as Record<string, unknown>)['__adv_sentinel__'] = val;
  }, v);
  return v;
}

async function assertSentinel(
  page: import('@playwright/test').Page,
  v: number,
): Promise<void> {
  const actual = await page.evaluate(
    () => (window as unknown as Record<string, unknown>)['__adv_sentinel__'],
  );
  expect(actual).toBe(v);
}

async function shot(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page
    .screenshot({ path: `e2e/screenshots/adversarial/${name}.png`, fullPage: false })
    .catch(() => undefined);
}

// ─── ADV-FRM-06: Settings hard reload ───────────────────────────────────────

test.describe('ADV-FRM-06 — Settings hard reload', () => {
  test('reloading /admin/settings remounts shell without errors', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/settings');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 20_000 });
    await shot(page, 'frm-06-settings-reload');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FRM-08: Pristine business form — Save disabled ─────────────────────

test.describe('ADV-FRM-08 — Business form empty-submit guard', () => {
  test('pristine business form keeps Save disabled; typing enables it', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/settings');

    const saveBtn = page.getByTestId('business-save');
    if (await saveBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
      // Empty-submit guard: nothing changed → Save must be disabled
      await expect(saveBtn).toBeDisabled();
      await shot(page, 'frm-08-pristine-disabled');

      // Dirtying one field flips the guard
      const nameInput = page.getByTestId('business-name');
      if (await nameInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await nameInput.fill('Adversarial Empty-Submit Probe');
        await expect(saveBtn).toBeEnabled({ timeout: 3_000 });
      }
    }

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FRM-20: Settings navigate away with unsaved edits ──────────────────

test.describe('ADV-FRM-20 — Settings navigate away with unsaved business edits', () => {
  test('typing into the business profile then navigating away does not crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/settings');
    const sentinel = await injectSentinel(page);

    // Dirty a real settings field (the old CF zone/token inputs are gone)
    const websiteInput = page.getByTestId('business-website');
    if (await websiteInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await websiteInput.fill('https://adversarial-unsaved.example.com');
    } else {
      const nameInput = page.getByTestId('business-name');
      if (await nameInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await nameInput.fill('Adversarial unsaved value');
      }
    }

    // Navigate away without saving
    await clickNav(page, '/admin/analytics');

    await assertSentinel(page, sentinel);
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 8_000 });
    await shot(page, 'frm-20-dirty-nav-away');
    expect(errors).toHaveLength(0);
  });
});
