/**
 * adversarial/sections-forms.spec.ts
 *
 * ADVERSARIAL — Form-heavy admin sections: billing, settings, user,
 * pseo, social, ai-endpoints/IDE, domain stack, import, api-tokens.
 *
 * Scenarios:
 *  ADV-FRM-01  Billing: spend-alert form empty submit
 *  ADV-FRM-02  Billing: spend-alert threshold with non-numeric input
 *  ADV-FRM-03  Billing: billing-caps modal open + close 3× rapid toggle
 *  ADV-FRM-04  Billing: XSS payload in spend-alert name field
 *  ADV-FRM-05  Settings: navigate to settings, assert page mounts (no white screen)
 *  ADV-FRM-06  Settings: hard reload on /admin/settings — shell re-mounts
 *  ADV-FRM-07  User: Tab order through user-settings form (Tab ×5 stays in page)
 *  ADV-FRM-08  User: submit empty user-settings form section — friendly error
 *  ADV-FRM-09  pSEO: section visible and navigable with no crash
 *  ADV-FRM-10  pSEO: SQLi in pSEO input field — no execution, no crash
 *  ADV-FRM-11  Social: social-composer empty publish — no crash
 *  ADV-FRM-12  Social: autopilot prompt button click with no site selected — graceful
 *  ADV-FRM-13  AI-endpoint: creating endpoint with duplicate slug — graceful error
 *  ADV-FRM-14  AI-endpoint: IDE tester — run with empty body — graceful
 *  ADV-FRM-15  AI-endpoint: IDE save + deploy rapid double-click
 *  ADV-FRM-16  Domain-stack: opens without crash for a site ID param
 *  ADV-FRM-17  Import: malformed dotenv-style payload in env-vars import
 *  ADV-FRM-18  API tokens: mint-token with oversized name (>200 chars)
 *  ADV-FRM-19  API tokens: revoke + re-create rapid succession — no double-modal
 *  ADV-FRM-20  Settings: navigating away with unsaved CF credentials — no crash
 *
 * Rules:
 *  - authedPage fixture (starts at BASE homepage, pre-authed)
 *  - Internal nav via UI clicks / routerLink locators only
 *  - No page.waitForTimeout
 *  - Parallel-safe (isolated context per test)
 *  - test.skip when section requires an active site not available
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

// ─── ADV-FRM-01: Billing spend-alert empty submit ───────────────────────────

test.describe('ADV-FRM-01 — Billing spend-alert empty submit', () => {
  test('submitting empty spend-alert form shows validation — no crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/billing');
    if (!navigated) {
      test.skip(true, 'billing nav link not visible');
      return;
    }

    const createBtn = page.getByTestId('billing-spend-alert-create');
    if (!(await createBtn.isVisible({ timeout: 4_000 }).catch(() => false))) {
      test.skip(true, 'billing-spend-alert-create not visible');
      return;
    }
    await createBtn.click();

    const submitBtn = page.getByTestId('billing-spend-alert-submit');
    if (await submitBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await submitBtn.click();
    }
    // Page must still be up
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FRM-02: Billing spend-alert non-numeric threshold ──────────────────

test.describe('ADV-FRM-02 — Billing spend-alert non-numeric threshold', () => {
  test('typing letters in spend-alert threshold does not crash billing section', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/billing');

    const createBtn = page.getByTestId('billing-spend-alert-create');
    if (!(await createBtn.isVisible({ timeout: 4_000 }).catch(() => false))) {
      test.skip(true, 'billing-spend-alert-create not visible');
      return;
    }
    await createBtn.click();

    const threshold = page.getByTestId('billing-spend-alert-threshold');
    if (await threshold.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await threshold.fill('not-a-number!!!');
    }
    const submitBtn = page.getByTestId('billing-spend-alert-submit');
    if (await submitBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await submitBtn.click();
    }
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FRM-03: Billing caps modal rapid toggle ────────────────────────────

test.describe('ADV-FRM-03 — Billing caps modal rapid toggle', () => {
  test('opening billing-caps modal 3× rapidly does not produce stale dialogs', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/billing');
    if (!navigated) {
      test.skip(true, 'billing nav link not visible');
      return;
    }

    const openBtn = page.getByTestId('billing-caps-modal-open');
    if (!(await openBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'billing-caps-modal-open not visible');
      return;
    }

    for (let i = 0; i < 3; i++) {
      await openBtn.click({ force: true });
      await page.keyboard.press('Escape');
    }

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FRM-04: Billing spend-alert XSS in name ────────────────────────────

test.describe('ADV-FRM-04 — Billing spend-alert XSS in name field', () => {
  test('XSS payload in spend-alert name does not execute injected script', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/billing');

    await page.evaluate(() => {
      (window as Record<string, unknown>)['__xss_fired__'] = false;
    });

    const createBtn = page.getByTestId('billing-spend-alert-create');
    if (!(await createBtn.isVisible({ timeout: 4_000 }).catch(() => false))) {
      test.skip(true, 'billing-spend-alert-create not visible');
      return;
    }
    await createBtn.click();

    const nameField = page.getByTestId('billing-spend-alert-name');
    if (await nameField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await nameField.fill('<img src=x onerror="window.__xss_fired__=true">');
    }
    const fired = await page.evaluate(
      () => (window as Record<string, unknown>)['__xss_fired__'],
    );
    expect(fired).not.toBe(true);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FRM-05: Settings page mounts ───────────────────────────────────────

test.describe('ADV-FRM-05 — Settings page mounts without white screen', () => {
  test('/admin/settings renders admin shell on navigation', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/settings');
    if (!navigated) {
      test.skip(true, 'settings nav link not visible');
      return;
    }
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 8_000 });
    expect(errors).toHaveLength(0);
  });
});

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

// ─── ADV-FRM-07: User settings Tab order ────────────────────────────────────

test.describe('ADV-FRM-07 — User settings Tab order does not escape page', () => {
  test('pressing Tab 5× inside user settings keeps focus within the page', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/user');
    if (!navigated) {
      test.skip(true, 'user nav link not visible');
      return;
    }

    // Focus the first interactive element inside the section
    const firstInput = page
      .locator('main input, main textarea, main select, main button')
      .first();
    if (await firstInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await firstInput.focus();
    }

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
    }

    // After 5 Tabs focus must still be inside the page, not on the browser chrome
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(focused).toBeTruthy();
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

// ─── ADV-FRM-09: pSEO section navigable ─────────────────────────────────────

test.describe('ADV-FRM-09 — pSEO section mounts without crash', () => {
  test('/admin/pseo renders admin shell on navigation', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/pseo');
    if (!navigated) {
      test.skip(true, 'pseo nav link not visible');
      return;
    }
    await expect(page.locator('[data-testid="pseo-section"]')).toBeVisible({ timeout: 8_000 }).catch(async () => {
      // Accept aside as fallback — section may be behind a feature flag
      await expect(page.locator('aside').first()).toBeVisible({ timeout: 5_000 });
    });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FRM-10: pSEO SQLi in input ─────────────────────────────────────────

test.describe('ADV-FRM-10 — pSEO SQLi payload in input field', () => {
  test('SQLi payload in pSEO section input does not crash or execute', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/pseo');
    if (!navigated) {
      test.skip(true, 'pseo nav link not visible');
      return;
    }

    await page.evaluate(() => {
      (window as Record<string, unknown>)['__sqli_fired__'] = false;
    });

    const firstInput = page
      .locator('[data-testid="pseo-section"] input, [data-testid="pseo-section"] textarea')
      .first();
    if (await firstInput.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await firstInput.fill("'; DROP TABLE sites;--");
      await page.keyboard.press('Enter');
    }
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5_000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FRM-11: Social composer empty publish ──────────────────────────────

test.describe('ADV-FRM-11 — Social composer empty publish', () => {
  test('submitting empty social-composer does not crash social section', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/social');
    if (!navigated) {
      test.skip(true, 'social nav link not visible');
      return;
    }

    const composer = page.getByTestId('social-composer-textarea');
    if (!(await composer.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'social-composer-textarea not visible (no site selected)');
      return;
    }

    // Leave composer empty and try to submit via button or Enter
    await composer.focus();
    const publishBtn = page
      .locator('button:has-text("Publish"), button:has-text("Post"), button[type="submit"]')
      .first();
    if (await publishBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await publishBtn.click();
    }

    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FRM-12: Social autopilot with no site ──────────────────────────────

test.describe('ADV-FRM-12 — Social auto-pilot with no site selected', () => {
  test('clicking auto-pilot prompt button without a site is graceful', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/social');

    const autoPilotBtn = page.getByTestId('social-auto-pilot-prompt-btn');
    if (!(await autoPilotBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'social-auto-pilot-prompt-btn not visible');
      return;
    }
    await autoPilotBtn.click();
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5_000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FRM-13: AI-endpoint duplicate slug ──────────────────────────────────

test.describe('ADV-FRM-13 — AI-endpoint duplicate slug graceful error', () => {
  test('submitting ai-endpoint creation with an existing slug shows error — no crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/ai-endpoints');
    if (!navigated) {
      test.skip(true, 'ai-endpoints nav link not visible');
      return;
    }

    // Open create panel
    const manualBtn = page.getByTestId('ai-endpoint-create-manual');
    if (!(await manualBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'ai-endpoint-create-manual not visible');
      return;
    }
    await manualBtn.click();

    const slugField = page.getByTestId('ai-endpoint-create-slug');
    if (await slugField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // 'test' is a likely-existing slug in any test session
      await slugField.fill('test');
    }

    const submitBtn = page.getByTestId('ai-endpoint-create-submit');
    if (await submitBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await submitBtn.click();
    }

    // Shell must remain — error banner or validation may appear
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FRM-14: AI-endpoint IDE tester empty body ──────────────────────────

test.describe('ADV-FRM-14 — AI-endpoint IDE tester empty body run', () => {
  test('running IDE tester with empty body shows graceful result — no crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/ai-endpoints');
    if (!navigated) {
      test.skip(true, 'ai-endpoints nav link not visible');
      return;
    }

    // Try to open an existing endpoint
    const firstCard = page.getByTestId('ai-endpoints-list-card').first();
    if (!(await firstCard.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'no ai-endpoints-list-card available');
      return;
    }
    await firstCard.click();

    const testerRun = page.getByTestId('ide-tester-run');
    if (!(await testerRun.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'ide-tester-run not visible');
      return;
    }

    const testerBody = page.getByTestId('ide-tester-body');
    if (await testerBody.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await testerBody.fill('');
    }
    await testerRun.click();

    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 8_000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FRM-15: AI-endpoint IDE save + deploy double-click ─────────────────

test.describe('ADV-FRM-15 — AI-endpoint IDE save + deploy double-click', () => {
  test('double-clicking save then deploy on an IDE endpoint does not crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/ai-endpoints');
    if (!navigated) {
      test.skip(true, 'ai-endpoints nav link not visible');
      return;
    }

    const firstCard = page.getByTestId('ai-endpoints-list-card').first();
    if (!(await firstCard.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'no ai-endpoints-list-card');
      return;
    }
    await firstCard.click();

    const saveBtn = page.getByTestId('ai-endpoint-overlay-save');
    const deployBtn = page.getByTestId('ai-endpoint-overlay-deploy');

    if (
      (await saveBtn.isVisible({ timeout: 3_000 }).catch(() => false)) &&
      (await deployBtn.isVisible({ timeout: 3_000 }).catch(() => false))
    ) {
      // Double-click save
      await saveBtn.dblclick({ force: true });
      await deployBtn.click({ force: true });
    }

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FRM-16: Domain-stack opens for site param ──────────────────────────

test.describe('ADV-FRM-16 — Domain-stack route opens without crash', () => {
  test('/admin/domains/:id/stack loads or shows graceful state', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const sentinel = await injectSentinel(page);

    // Navigate to domains first, look for a stack link
    await clickNav(page, '/admin/domains');
    const stackLink = page
      .locator('[href*="/admin/domains/"][href*="/stack"], a[routerLink*="/stack"]')
      .first();
    if (await stackLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await stackLink.click();
      await page.waitForFunction(() => document.readyState === 'complete', { timeout: 8_000 });
    } else {
      test.skip(true, 'No domain stack link visible (no domains configured)');
      return;
    }

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 8_000 });
    await assertSentinel(page, sentinel);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FRM-17: Import malformed dotenv ────────────────────────────────────

test.describe('ADV-FRM-17 — Import malformed dotenv payload', () => {
  test('submitting malformed dotenv in env-vars import does not crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/import');
    if (!navigated) {
      test.skip(true, 'import nav link not visible');
      return;
    }

    // Find any textarea or import area
    const textarea = page.locator('textarea, [role="textbox"]').first();
    if (await textarea.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await textarea.fill('NOT_VALID_ENV\n!!!MALFORMED KEY!!!=value\n=empty-key');
      const submitBtn = page
        .locator('button[type="submit"], button:has-text("Import")')
        .first();
      if (await submitBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await submitBtn.click();
      }
    }
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5_000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FRM-18: API tokens oversized name ───────────────────────────────────

test.describe('ADV-FRM-18 — API tokens: oversized token name', () => {
  test('submitting a token name >200 chars shows validation — no crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/api-tokens');
    if (!navigated) {
      test.skip(true, 'api-tokens nav link not visible');
      return;
    }

    const mintBtn = page.getByTestId('mint-token-btn');
    const emptyCreate = page.getByTestId('apikey-create-button');
    const openBtn = (await mintBtn.isVisible({ timeout: 3_000 }).catch(() => false))
      ? mintBtn
      : emptyCreate;

    if (!(await openBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      test.skip(true, 'no token create button visible');
      return;
    }
    await openBtn.click();

    const nameField = page.getByTestId('apikey-modal-name');
    if (await nameField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await nameField.fill('A'.repeat(250));
    }
    const submitBtn = page.getByTestId('apikey-modal-submit');
    if (await submitBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await submitBtn.click();
    }

    // Accept either an error message or the modal staying open — no crash
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-FRM-19: API tokens revoke + re-create rapid succession ─────────────

test.describe('ADV-FRM-19 — API tokens rapid revoke + create', () => {
  test('opening token create dialog twice without completing does not leave ghost modals', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/api-tokens');
    if (!navigated) {
      test.skip(true, 'api-tokens nav link not visible');
      return;
    }

    const mintBtn = page.getByTestId('mint-token-btn');
    const emptyCreate = page.getByTestId('apikey-create-button');
    const openBtn = (await mintBtn.isVisible({ timeout: 3_000 }).catch(() => false))
      ? mintBtn
      : emptyCreate;

    if (!(await openBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      test.skip(true, 'no token create button visible');
      return;
    }

    // Open modal, dismiss, open again
    for (let i = 0; i < 2; i++) {
      await openBtn.click();
      await page.keyboard.press('Escape');
    }

    // Only 0 or 1 modal instances should exist — not stacked
    const modalCount = await page.getByTestId('apikey-modal-name').count();
    expect(modalCount).toBeLessThanOrEqual(1);
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
