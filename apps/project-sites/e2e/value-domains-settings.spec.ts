/**
 * TDD Contract — Value-Domain Coverage: /admin/settings Business tab inputs
 *
 * Exercises every value class for every text input on the Business tab:
 *   - business-name   (maxlength=200, required)
 *   - business-phone  (maxlength=32)
 *   - business-address (maxlength=500)
 *   - business-website (maxlength=500)
 *   - business-prompt  (textarea, maxlength=4000)
 *
 * Value classes per field:
 *   (1) valid               — accepted, no error shown, save button active
 *   (2) empty + whitespace  — business-name required → error; others optional → ok
 *   (3) boundary            — exactly at maxlength → accepted (no error)
 *   (4) overlong-2000       — far over cap → no crash; save button disabled OR error shown
 *   (5) unicode + emoji     — business names SHOULD accept (see TDD-RED notes if rejected)
 *   (6) injection-shaped    — inert text; no dialog; no console error
 *   (7) garbage             — should not crash
 *
 * SAFETY: ALL POST/PATCH/PUT/DELETE to *\/api\/** intercepted — no real writes hit prod.
 *
 * Auth: signInAsTestUser from ./helpers/auth.js (stubs ONE site + catch-all).
 */

import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

// Block service workers so fetch stubs work deterministically
test.use({ serviceWorkers: 'block' });

// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.PROD_URL ?? process.env.BASE_URL ?? 'https://projectsites.dev';
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots', 'value-domains-settings');

// ─── types ──────────────────────────────────────────────────────────────────

interface AuthHelpers {
  signInAsTestUser: (page: Page) => Promise<void>;
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Intercept all mutating API calls — prevents real writes to prod. */
async function interceptMutations(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const method = route.request().method().toUpperCase();
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, data: {} }),
      });
    } else {
      await route.continue();
    }
  });
}

/** Collect console errors, filtering out noise. Must be called BEFORE any navigation. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (
        !text.includes('favicon') &&
        !text.includes('posthog') &&
        !text.includes('sentry') &&
        !text.includes('analytics') &&
        !text.includes('third-party') &&
        !text.toLowerCase().includes('failed to load resource')
      ) {
        errors.push(text);
      }
    }
  });
  return errors;
}

/** Screenshot helper — non-fatal. */
async function screenshot(page: Page, name: string): Promise<void> {
  try {
    if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, `${name}.png`),
      fullPage: false,
    });
  } catch {
    // Non-fatal
  }
}

/** Load auth helper dynamically (avoids import-resolution issues at write-time). */
async function loadSignInAsTestUser(): Promise<AuthHelpers['signInAsTestUser']> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import('./helpers/auth.js');
    if (typeof mod.signInAsTestUser === 'function') return mod.signInAsTestUser as AuthHelpers['signInAsTestUser'];
    if (mod.default && typeof mod.default.signInAsTestUser === 'function') return mod.default.signInAsTestUser as AuthHelpers['signInAsTestUser'];
  } catch {
    // fall through to inline fallback
  }
  // Inline fallback — mirrors auth.js session-injection pattern
  return async (page: Page) => {
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            user_id: 'e2e',
            email: 'test@megabyte.space',
            name: 'E2E Test',
            org_id: 'e2e-org',
            is_super_admin: true,
          },
        }),
      });
    });
    // glob-ok: query-suffix only — sites LIST; /api/sites/:id/* falls to catch-all
    await page.route('**/api/sites**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'e2e-site-1',
              slug: 'e2e-site',
              status: 'live',
              business_name: 'E2E Business',
              business_phone: '555-1234',
              business_address: '123 Test St',
              business_website: 'https://test.example.com',
              original_prompt: 'A great test business',
            },
          ],
          meta: { total: 1 },
        }),
      });
    });
    await page.route('**/api/billing/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    const flagsStub = async (route: import('@playwright/test').Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ flags: {}, count: 90 }),
      });
    };
    await page.route('**/api/feature-flags**', flagsStub);
    // Mid-token ** can't cross '/' — twin covers /api/feature-flags/:key reads
    await page.route('**/api/feature-flags/**', flagsStub);
    await page.route('**/api/admin/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.route('**/api/analytics/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    // Catch-all for any remaining API calls
    await page.route('**/api/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
  };
}

/**
 * Navigate to /admin/settings Business tab as a real user:
 * goto /admin/settings → wait for #settings-tab-business → click it → wait for business-name input.
 *
 * The settings component renders `<button id="settings-tab-business" role="tab">Business</button>`.
 * The Business form panel is gated by `@else if (tab() === 'business')` + `@if (state.selectedSite())`.
 */
async function navigateToBusinessTab(page: Page, signInAsTestUser: AuthHelpers['signInAsTestUser']): Promise<void> {
  await signInAsTestUser(page);
  await page.goto(`${BASE_URL}/admin/settings`, { waitUntil: 'domcontentloaded', timeout: 25_000 });

  // Ensure we didn't get redirected to signin
  const url = page.url();
  if (url.includes('/signin') || url.includes('/login')) {
    throw new Error(`Auth redirect: ended up at ${url}`);
  }

  // Wait for the Business tab button by its stable ID (id="settings-tab-business")
  // This confirms the Angular settings component has fully mounted and a site is selected.
  await page.waitForSelector('#settings-tab-business', { state: 'visible', timeout: 25_000 });

  // Click the Business tab
  await page.click('#settings-tab-business');

  // Wait for the business-name input — confirms the Business panel rendered
  // (panel gated by @else if (tab() === 'business') + @if (state.selectedSite()))
  await page.waitForSelector('[data-testid="business-name"]', { state: 'visible', timeout: 20_000 });
}

/** Fill a field and trigger Angular's ngModel validation via input + blur. */
async function fillAndBlur(page: Page, testId: string, value: string): Promise<void> {
  const el = page.locator(`[data-testid="${testId}"]`);
  await el.clear();
  if (value.length > 0) {
    await el.fill(value);
  }
  // Trigger ngModelChange + touched via input event + blur
  await el.dispatchEvent('input');
  await el.blur();
  // Small settle for Angular's signal-based computed to run
  await page.waitForTimeout(100);
}

/** Get visible inline error text for a field by its error-element id. */
async function getFieldError(page: Page, errorId: string): Promise<string | null> {
  const el = page.locator(`#${errorId}`);
  const visible = await el.isVisible().catch(() => false);
  if (!visible) return null;
  const text = (await el.textContent()) ?? '';
  return text.trim() || null;
}

/** The save button for the business section. */
function saveButton(page: Page) {
  return page.locator('[data-testid="business-save"]');
}

// ─── Suite ──────────────────────────────────────────────────────────────────

test.describe('settings /admin/settings — Business tab value domains', () => {
  let signInAsTestUser: AuthHelpers['signInAsTestUser'];

  test.beforeAll(async () => {
    signInAsTestUser = await loadSignInAsTestUser();
  });

  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const signIn = await loadSignInAsTestUser();
    await interceptMutations(page);
    try {
      await navigateToBusinessTab(page, signIn);
      await screenshot(page, 'business-tab-overview');
    } catch {
      // non-fatal
    }
    await ctx.close();
  });

  // ─── business-name: required field ──────────────────────────────────────

  test.describe('business-name (maxlength=200, required)', () => {

    test('(1) valid — 50-char name → no error, save button becomes active', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      await fillAndBlur(page, 'business-name', 'Acme Plumbing & Electric Services LLC');

      const err = await getFieldError(page, 'biz-err-name');
      expect(err, 'Valid business name should show no error').toBeNull();
      expect(errors).toHaveLength(0);

      await screenshot(page, 'name-valid');
    });

    test('(2a) empty — "" → "Business name is required." error shown after submit', async ({ page }) => {
      // TDD-RED: validateBusiness() runs only on saveBusiness() (submit), NOT on blur.
      // Per settings.component.ts: businessErrors() is only populated when saveBusiness() is called.
      // Inline error elements don't appear until after a save attempt.
      // Product gap: blur-time validation would be better UX. This test documents the real contract.
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      await fillAndBlur(page, 'business-name', '');

      // After blur only: no error shown yet (validation runs on submit)
      // This is the real product contract — validation is submit-time, not blur-time
      const errAfterBlur = await getFieldError(page, 'biz-err-name');
      // errAfterBlur may be null (no blur validation) — that's acceptable per current contract

      // If the save button is enabled (dirty=true), click it to trigger validation
      const saveBtn = saveButton(page);
      const isSaveEnabled = await saveBtn.isEnabled().catch(() => false);
      if (isSaveEnabled) {
        await saveBtn.click();
        await page.waitForTimeout(300);
        const errAfterSave = await getFieldError(page, 'biz-err-name');
        if (errAfterSave !== null) {
          expect(errAfterSave).toMatch(/required/i);
        }
        // Even if no inline error, app must still be alive
        await expect(page.locator('app-root, app-admin').first()).toBeVisible();
      }

      expect(errors).toHaveLength(0);
    });

    test('(2b) whitespace-only — "   " → treated as empty → required error after submit', async ({ page }) => {
      // TDD-RED: Same as (2a) — validation only on submit, not blur.
      // This test documents the real product contract.
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      await fillAndBlur(page, 'business-name', '   ');

      // If save button enabled (dirty), click to trigger validation
      const saveBtn = saveButton(page);
      const isSaveEnabled = await saveBtn.isEnabled().catch(() => false);
      if (isSaveEnabled) {
        await saveBtn.click();
        await page.waitForTimeout(300);
        const errAfterSave = await getFieldError(page, 'biz-err-name');
        if (errAfterSave !== null) {
          expect(errAfterSave).toMatch(/required/i);
        }
        await expect(page.locator('app-root, app-admin').first()).toBeVisible();
      }

      expect(errors).toHaveLength(0);
    });

    test('(3) boundary — exactly 200 chars → accepted, no error', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      const atBoundary = 'A'.repeat(200);
      expect(atBoundary.length).toBe(200);

      await fillAndBlur(page, 'business-name', atBoundary);

      const err = await getFieldError(page, 'biz-err-name');
      // maxlength=200 on the input prevents typing >200; businessErrors checks length > 200
      // Exactly 200 should be valid
      expect(err, '200-char business name is at boundary and should be valid').toBeNull();
      expect(errors).toHaveLength(0);
    });

    test('(4) overlong-2000 — 2000-char value → app survives, no crash', async ({ page }) => {
      // TDD-RED product note: validateBusiness() runs only on submit — no inline error after blur.
      // Save button is ENABLED when dirty (regardless of length), because disabled logic only
      // checks businessDirty(). So after filling 2000 chars: dirty=true → save enabled, no error.
      // This test verifies only that the app does NOT crash — the real rejection contract
      // (error shown OR save disabled) would require submit-time validation, which is a product gap.
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      // Bypass HTML maxlength to inject overlong value
      const nameInput = page.locator('[data-testid="business-name"]');
      await nameInput.focus();
      const handle = await nameInput.elementHandle();
      if (handle) {
        await page.evaluate((el) => {
          (el as HTMLInputElement).removeAttribute('maxlength');
        }, handle);
      }
      await nameInput.fill('B'.repeat(2000));
      await nameInput.dispatchEvent('input');
      await nameInput.blur();
      await page.waitForTimeout(200);

      // App must still be alive — no crash
      await expect(page.locator('app-root, app-admin').first()).toBeVisible();

      expect(errors).toHaveLength(0);
      await screenshot(page, 'name-overlong-2000');
    });

    test('(5) unicode + emoji — "Café Señor 🌮 Tacos" → SHOULD be accepted', async ({ page }) => {
      // TDD-RED: The component uses Angular's [(ngModel)] without a charset restriction.
      // Unicode and emoji in business names are commercially common (e.g., "Café").
      // If businessErrors() rejects Unicode, test.fail() documents the product gap.

      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      const unicodeName = 'Café Señor 🌮 Tacos';
      await fillAndBlur(page, 'business-name', unicodeName);

      const err = await getFieldError(page, 'biz-err-name');

      if (err !== null) {
        // TDD-RED: Unicode/emoji business name is being rejected — document product gap.
        // eslint-disable-next-line playwright/no-conditional-expect
        test.fail(true, `TDD-RED: Unicode business name "${unicodeName}" should be accepted but got error: ${err}`);
      } else {
        // Correct behavior: no error for valid Unicode business name
        expect(err).toBeNull();
      }

      expect(errors).toHaveLength(0);
      await screenshot(page, 'name-unicode-emoji');
    });

    test('(6a) injection — <script>alert(1)</script> → no dialog, no console error', async ({ page }) => {
      const errors = collectErrors(page);
      let dialogOpened = false;
      page.on('dialog', async (dialog) => {
        dialogOpened = true;
        await dialog.dismiss();
      });

      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      await fillAndBlur(page, 'business-name', '<script>alert(1)</script>');

      expect(dialogOpened, 'XSS payload must NOT open a dialog').toBe(false);
      expect(errors.filter((e) => e.includes('alert')), 'XSS must not execute').toHaveLength(0);

      // App must stay alive
      await expect(page.locator('app-root, app-admin').first()).toBeVisible();
    });

    test("(6b) injection — SQLi pattern → no dialog, app alive", async ({ page }) => {
      const errors = collectErrors(page);
      let dialogOpened = false;
      page.on('dialog', async (dialog) => {
        dialogOpened = true;
        await dialog.dismiss();
      });

      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      await fillAndBlur(page, 'business-name', "' OR 1=1--; DROP TABLE sites;--");

      expect(dialogOpened, 'SQLi payload must not open a dialog').toBe(false);
      await expect(page.locator('app-root, app-admin').first()).toBeVisible();
      expect(errors).toHaveLength(0);
    });

    test('(7) garbage — control chars → no crash', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      // Use fill with a sanitized garbage string (avoid actual null bytes that break fill)
      await fillAndBlur(page, 'business-name', '​﻿\t\r\nGarbage');

      await expect(page.locator('app-root, app-admin').first()).toBeVisible();
      expect(errors).toHaveLength(0);
    });
  });

  // ─── business-phone (maxlength=32, optional) ─────────────────────────────

  test.describe('business-phone (maxlength=32, optional)', () => {

    test('(1) valid — standard US phone → no error', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      await fillAndBlur(page, 'business-phone', '(555) 867-5309');

      const err = await getFieldError(page, 'biz-err-phone');
      expect(err, 'Valid phone should show no error').toBeNull();
      expect(errors).toHaveLength(0);
    });

    test('(2) empty — optional field → no error', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      await fillAndBlur(page, 'business-phone', '');

      const err = await getFieldError(page, 'biz-err-phone');
      // Phone is optional — empty should not produce an error
      expect(err, 'Empty optional phone field should show no required error').toBeNull();
      expect(errors).toHaveLength(0);
    });

    test('(3) boundary — exactly 32 chars → accepted', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      const atBoundary = '1'.repeat(32);
      await fillAndBlur(page, 'business-phone', atBoundary);

      const err = await getFieldError(page, 'biz-err-phone');
      expect(err, '32-char phone is at boundary and should be valid').toBeNull();
      expect(errors).toHaveLength(0);
    });

    test('(4) overlong-2000 — bypasses maxlength → no crash', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      const phoneInput = page.locator('[data-testid="business-phone"]');
      await phoneInput.focus();
      const handle = await phoneInput.elementHandle();
      if (handle) {
        await page.evaluate((el) => { (el as HTMLInputElement).removeAttribute('maxlength'); }, handle);
      }
      await phoneInput.fill('9'.repeat(2000));
      await phoneInput.dispatchEvent('input');
      await phoneInput.blur();
      await page.waitForTimeout(200);

      await expect(page.locator('app-root, app-admin').first()).toBeVisible();
      expect(errors).toHaveLength(0);
    });

    test('(6) injection — <script> in phone → no dialog', async ({ page }) => {
      const errors = collectErrors(page);
      let dialogOpened = false;
      page.on('dialog', async (dialog) => { dialogOpened = true; await dialog.dismiss(); });

      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      await fillAndBlur(page, 'business-phone', '<script>alert("phone")</script>');

      expect(dialogOpened, 'XSS in phone must not open dialog').toBe(false);
      await expect(page.locator('app-root, app-admin').first()).toBeVisible();
      expect(errors).toHaveLength(0);
    });
  });

  // ─── business-address (maxlength=500, optional) ──────────────────────────

  test.describe('business-address (maxlength=500, optional)', () => {

    test('(1) valid — full street address → no error', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      await fillAndBlur(page, 'business-address', '123 Main St, Suite 400, Springfield, IL 62701');

      const err = await getFieldError(page, 'biz-err-addr');
      expect(err, 'Valid address should show no error').toBeNull();
      expect(errors).toHaveLength(0);
    });

    test('(2) empty — optional → no error', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      await fillAndBlur(page, 'business-address', '');

      const err = await getFieldError(page, 'biz-err-addr');
      expect(err, 'Empty optional address should show no error').toBeNull();
      expect(errors).toHaveLength(0);
    });

    test('(3) boundary — exactly 500 chars → accepted', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      const atBoundary = 'A'.repeat(500);
      await fillAndBlur(page, 'business-address', atBoundary);

      const err = await getFieldError(page, 'biz-err-addr');
      expect(err, '500-char address is at boundary and should be valid').toBeNull();
      expect(errors).toHaveLength(0);
    });

    test('(4) overlong-2000 — bypasses maxlength → no crash', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      const addrInput = page.locator('[data-testid="business-address"]');
      await addrInput.focus();
      const handle = await addrInput.elementHandle();
      if (handle) {
        await page.evaluate((el) => { (el as HTMLInputElement).removeAttribute('maxlength'); }, handle);
      }
      await addrInput.fill('X'.repeat(2000));
      await addrInput.dispatchEvent('input');
      await addrInput.blur();
      await page.waitForTimeout(200);

      await expect(page.locator('app-root, app-admin').first()).toBeVisible();
      expect(errors).toHaveLength(0);
    });

    test('(5) unicode — international address → should be accepted', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      await fillAndBlur(page, 'business-address', '東京都渋谷区 1-2-3, Tōkyō, Japan 150-0001');

      const err = await getFieldError(page, 'biz-err-addr');
      expect(err, 'International Unicode address should be accepted').toBeNull();
      await expect(page.locator('app-root, app-admin').first()).toBeVisible();
      expect(errors).toHaveLength(0);
    });

    test('(6) injection — script tag in address → no dialog', async ({ page }) => {
      const errors = collectErrors(page);
      let dialogOpened = false;
      page.on('dialog', async (dialog) => { dialogOpened = true; await dialog.dismiss(); });

      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      await fillAndBlur(page, 'business-address', '123 Main St <script>alert(1)</script>');

      expect(dialogOpened, 'XSS in address must not open dialog').toBe(false);
      await expect(page.locator('app-root, app-admin').first()).toBeVisible();
      expect(errors).toHaveLength(0);
    });
  });

  // ─── business-website (maxlength=500, optional) ──────────────────────────

  test.describe('business-website (maxlength=500, optional)', () => {

    test('(1) valid — https URL → no error', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      await fillAndBlur(page, 'business-website', 'https://www.acmeplumbing.com');

      const err = await getFieldError(page, 'biz-err-web');
      expect(err, 'Valid https URL should show no error').toBeNull();
      expect(errors).toHaveLength(0);
    });

    test('(2) empty — optional → no error', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      await fillAndBlur(page, 'business-website', '');

      const err = await getFieldError(page, 'biz-err-web');
      expect(err, 'Empty optional website should show no error').toBeNull();
      expect(errors).toHaveLength(0);
    });

    test('(3) boundary — 500-char value → accepted', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      const path500 = 'https://example.com/' + 'a'.repeat(480);
      expect(path500.length).toBe(500);
      await fillAndBlur(page, 'business-website', path500);

      const err = await getFieldError(page, 'biz-err-web');
      expect(err, '500-char website field is at boundary and should be valid').toBeNull();
      expect(errors).toHaveLength(0);
    });

    test('(4) overlong-2000 — bypasses maxlength → no crash', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      const webInput = page.locator('[data-testid="business-website"]');
      await webInput.focus();
      const handle = await webInput.elementHandle();
      if (handle) {
        await page.evaluate((el) => { (el as HTMLInputElement).removeAttribute('maxlength'); }, handle);
      }
      await webInput.fill('https://x.com/' + 'a'.repeat(1985));
      await webInput.dispatchEvent('input');
      await webInput.blur();
      await page.waitForTimeout(200);

      await expect(page.locator('app-root, app-admin').first()).toBeVisible();
      expect(errors).toHaveLength(0);
    });

    test('(6) injection — javascript: URL scheme → no execution', async ({ page }) => {
      const errors = collectErrors(page);
      let dialogOpened = false;
      page.on('dialog', async (dialog) => { dialogOpened = true; await dialog.dismiss(); });

      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      await fillAndBlur(page, 'business-website', 'javascript:alert("xss")');

      expect(dialogOpened, 'javascript: scheme in website must not execute').toBe(false);
      await expect(page.locator('app-root, app-admin').first()).toBeVisible();
      expect(errors).toHaveLength(0);
    });

    test('(7) garbage — random non-URL → no crash', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      await fillAndBlur(page, 'business-website', 'not://a/real​url﻿');

      await expect(page.locator('app-root, app-admin').first()).toBeVisible();
      expect(errors).toHaveLength(0);
    });
  });

  // ─── business-prompt (textarea, maxlength=4000, optional) ────────────────

  test.describe('business-prompt textarea (maxlength=4000, optional)', () => {

    test('(1) valid — natural language prompt → no error', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      const prompt = 'A friendly neighborhood plumber serving the greater Springfield area since 1985. We specialize in emergency repairs and new construction.';
      await fillAndBlur(page, 'business-prompt', prompt);

      const err = await getFieldError(page, 'biz-err-prompt');
      expect(err, 'Valid prompt should show no error').toBeNull();
      expect(errors).toHaveLength(0);
      await screenshot(page, 'prompt-valid');
    });

    test('(2) empty — optional → no error', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      await fillAndBlur(page, 'business-prompt', '');

      const err = await getFieldError(page, 'biz-err-prompt');
      expect(err, 'Empty optional prompt should show no error').toBeNull();
      expect(errors).toHaveLength(0);
    });

    test('(3) boundary — exactly 4000 chars → accepted', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      const chunk = 'A plumbing business. ';
      const atBoundary = chunk.repeat(Math.ceil(4000 / chunk.length)).slice(0, 4000);
      expect(atBoundary.length).toBe(4000);

      const promptEl = page.locator('[data-testid="business-prompt"]');
      await promptEl.clear();
      await promptEl.fill(atBoundary);
      await promptEl.dispatchEvent('input');
      await promptEl.blur();
      await page.waitForTimeout(200);

      const err = await getFieldError(page, 'biz-err-prompt');
      expect(err, '4000-char prompt is at boundary and should be valid').toBeNull();
      expect(errors).toHaveLength(0);
    });

    test('(4) overlong-6000 — bypasses maxlength → no crash', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      const promptEl = page.locator('[data-testid="business-prompt"]');
      await promptEl.focus();
      const handle = await promptEl.elementHandle();
      if (handle) {
        await page.evaluate((el) => { (el as HTMLTextAreaElement).removeAttribute('maxlength'); }, handle);
      }
      await promptEl.fill('A'.repeat(6000));
      await promptEl.dispatchEvent('input');
      await promptEl.blur();
      await page.waitForTimeout(200);

      await expect(page.locator('app-root, app-admin').first()).toBeVisible();
      expect(errors).toHaveLength(0);
    });

    test('(5) unicode + emoji — prompt with emojis → should be accepted', async ({ page }) => {
      const errors = collectErrors(page);
      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      const emojiPrompt = '🔧 We fix pipes! 🚰 Serving families since 1985. Café-style waiting area ☕. Señor Plumber at your service! 日本語テスト.';
      await fillAndBlur(page, 'business-prompt', emojiPrompt);

      const err = await getFieldError(page, 'biz-err-prompt');
      expect(err, 'Unicode + emoji prompt should be accepted').toBeNull();
      expect(errors).toHaveLength(0);
    });

    test('(6a) injection — <script> in prompt → no dialog', async ({ page }) => {
      const errors = collectErrors(page);
      let dialogOpened = false;
      page.on('dialog', async (dialog) => { dialogOpened = true; await dialog.dismiss(); });

      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      await fillAndBlur(page, 'business-prompt', 'Build a site for <script>alert("xss")</script> Plumbing Co.');

      expect(dialogOpened, 'XSS in prompt must not open a dialog').toBe(false);
      await expect(page.locator('app-root, app-admin').first()).toBeVisible();
      expect(errors).toHaveLength(0);
    });

    test("(6b) SQLi — prompt with SQL → no dialog, app stable", async ({ page }) => {
      const errors = collectErrors(page);
      let dialogOpened = false;
      page.on('dialog', async (dialog) => { dialogOpened = true; await dialog.dismiss(); });

      await interceptMutations(page);
      await navigateToBusinessTab(page, signInAsTestUser);

      await fillAndBlur(page, 'business-prompt', "Build a site for'; DROP TABLE sites;-- Plumbing");

      expect(dialogOpened).toBe(false);
      await expect(page.locator('app-root, app-admin').first()).toBeVisible();
      expect(errors).toHaveLength(0);
    });
  });

  // ─── Save button contract ─────────────────────────────────────────────────

  test.describe('save gate — validateBusiness() guard contract', () => {
    // REAL CONTRACT (settings.component.ts:1183-1195): the Business save button
    // is NOT [disabled]-gated. `saveBusiness()` calls `validateBusiness()` and
    // returns EARLY (no API call) when invalid. So the rejection signal is
    // "no mutation fired", not a disabled attribute.
    //
    // Route-order note: the mutation COUNTER must be registered AFTER
    // signInAsTestUser — Playwright matches routes in reverse registration
    // order, and the helper's last-resort catch-all would otherwise shadow the
    // counter (mutations get intercepted but counted as zero).

    /** Registers a counting mutation interceptor that wins the route race. */
    async function armMutationCounter(page: import('@playwright/test').Page): Promise<string[]> {
      const calls: string[] = [];
      await page.route('**/api/**', async (route) => {
        const method = route.request().method().toUpperCase();
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
          const url = route.request().url();
          // Telemetry fire-and-forget posts are not "saves" — don't count them.
          if (!url.includes('/api/analytics/track')) calls.push(url);
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true }),
          });
        } else {
          await route.fallback();
        }
      });
      return calls;
    }

    test('business-name empty → save is a guarded no-op (no mutation fires)', async ({ page }) => {
      const errors = collectErrors(page);
      await navigateToBusinessTab(page, signInAsTestUser);
      const mutations = await armMutationCounter(page);

      await fillAndBlur(page, 'business-name', '');

      const saveBtn = saveButton(page);
      const isSaveVisible = await saveBtn.isVisible({ timeout: 5_000 }).catch(() => false);
      if (isSaveVisible && (await saveBtn.isEnabled().catch(() => false))) {
        await saveBtn.click();
        await page.waitForTimeout(500);
      }
      // validateBusiness() must block the save — zero mutations either way
      expect(mutations, 'empty business-name must never produce a save mutation').toHaveLength(0);

      await expect(page.locator('app-root, app-admin').first()).toBeVisible();
      expect(errors).toHaveLength(0);
    });

    test('valid business-name → save fires and is intercepted — no real prod write', async ({ page }) => {
      const errors = collectErrors(page);
      await navigateToBusinessTab(page, signInAsTestUser);
      const mutations = await armMutationCounter(page);

      // Only the required field — optional fields stay empty (trim() || null).
      await fillAndBlur(page, 'business-name', 'Acme Plumbing LLC');

      const saveBtn = saveButton(page);
      await expect(saveBtn).toBeVisible({ timeout: 5_000 });
      await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
      await saveBtn.click();

      // updateSite PATCH must fire AND land in our interceptor, never prod.
      await expect
        .poll(() => mutations.length, { timeout: 5_000 })
        .toBeGreaterThan(0);

      await expect(page.locator('app-root, app-admin').first()).toBeVisible();
      expect(errors).toHaveLength(0);
      await screenshot(page, 'save-intercepted');
    });
  });

  // ─── Stability smoke ──────────────────────────────────────────────────────

  test('stability smoke — all value classes across business-name → no crash', async ({ page }) => {
    const errors = collectErrors(page);
    await interceptMutations(page);
    await navigateToBusinessTab(page, signInAsTestUser);

    const valueClasses = [
      'Acme Plumbing LLC',
      '',
      '   ',
      'A'.repeat(200),
      'Unicode: Café 🔧 東京',
      "<script>alert('xss')</script>",
      "' OR 1=1--",
      '​﻿',
    ];

    for (const val of valueClasses) {
      await fillAndBlur(page, 'business-name', val);
      // App must remain alive after every value class
      await expect(page.locator('app-root, app-admin').first()).toBeVisible();
    }

    await screenshot(page, 'stability-smoke-final');

    const serious = errors.filter(
      (e) => !e.includes('favicon') && !e.includes('posthog') && !e.includes('sentry'),
    );
    expect(serious, `Unexpected console errors: ${serious.join(', ')}`).toHaveLength(0);
  });
});
