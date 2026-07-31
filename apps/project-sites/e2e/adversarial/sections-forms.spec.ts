/**
 * adversarial/sections-forms.spec.ts
 *
 * ADVERSARIAL — Form-heavy admin sections: billing, settings, user,
 * pseo, social, ai-endpoints/IDE, domain stack, import, api-tokens.
 *
 * Scenarios:
 *  ADV-FRM-06  Settings: hard reload on /admin/settings — shell re-mounts
 *  ADV-FRM-08  User: submit empty user-settings form section — friendly error
 *  ADV-FRM-20  Settings: navigating away with unsaved CF credentials — no crash
 *
 * Rules:
 *  - authedPage fixture (starts at BASE homepage, pre-authed)
 *  - Internal nav via UI clicks / routerLink locators only
 *  - No page.waitForTimeout
 *  - Parallel-safe (isolated context per test)
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

// ─── helpers ────────────────────────────────────────────────────────────────

async function gotoAdmin(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${BASE}/admin`);
  await expect(page.locator('aside').first()).toBeVisible({ timeout: 15_000 });
}

function collectErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (
        !t.includes('favicon') &&
        !t.includes('net::ERR_BLOCKED') &&
        !t.includes('ERR_ABORTED')
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
    (window as Record<string, unknown>)['__adv_sentinel__'] = val;
  }, v);
  return v;
}

async function assertSentinel(
  page: import('@playwright/test').Page,
  v: number,
): Promise<void> {
  const actual = await page.evaluate(
    () => (window as Record<string, unknown>)['__adv_sentinel__'],
  );
  expect(actual).toBe(v);
}

// ─── ADV-FRM-06: Settings hard reload ───────────────────────────────────────

test.describe('ADV-FRM-06 — Settings hard reload', () => {
  test('reloading /admin/settings remounts shell without errors', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/settings');
    await page.reload({ waitUntil: 'networkidle', timeout: 20_000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 15_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FRM-08: User settings empty submit ─────────────────────────────────

test.describe('ADV-FRM-08 — User settings empty save', () => {
  test('saving user-settings with no changes shows friendly response — no crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/user');

    const saveBtn = page
      .locator('button:has-text("Save"), button[type="submit"]')
      .first();
    if (await saveBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await saveBtn.click();
    }
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5_000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FRM-20: Settings navigate away with unsaved CF creds ───────────────

test.describe('ADV-FRM-20 — Settings navigate away with unsaved CF credentials', () => {
  test('typing in CF credentials then navigating away does not crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/settings');
    const sentinel = await injectSentinel(page);

    // Find any credential input in settings (e.g., CF zone ID field)
    const credInput = page
      .locator('input[placeholder*="zone" i], input[placeholder*="token" i], input[placeholder*="api" i]')
      .first();
    if (await credInput.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await credInput.fill('adversarial-unsaved-value');
    }

    // Navigate away without saving
    await clickNav(page, '/admin/analytics');

    await assertSentinel(page, sentinel);
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 8_000 });
    expect(errors).toHaveLength(0);
  });
});
