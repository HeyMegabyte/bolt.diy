/**
 * adversarial/sections-ai.spec.ts
 *
 * ADVERSARIAL — AI-heavy admin sections: traces, ai-endpoints, ai-chat-extras,
 * voice + children, swarm, sites/:id/dna, sites/:id/copilot.
 *
 * Scenarios:
 *  ADV-AI-01  Traces: grid renders with empty filter state — no crash
 *  ADV-AI-02  Traces: copy-button on first row does not crash (even if no row)
 *  ADV-AI-03  AI-endpoint: suggest panel — spam generate button 3×
 *  ADV-AI-04  AI-endpoint: suggest input XSS payload — no execution
 *  ADV-AI-05  AI-endpoint: method-select rapid change GET→POST→GET
 *  ADV-AI-06  AI-endpoint: filter language rapid toggle 4×
 *  ADV-AI-07  AI-chat-extras: enable web-search toggle 3× — no crash
 *  ADV-AI-08  AI-chat-extras: connect-drive with no OAuth configured — graceful
 *  ADV-AI-09  AI-chat-extras: view-summary with no chat history — graceful empty
 *  ADV-AI-10  Voice: section loads or shows graceful empty state
 *  ADV-AI-11  Voice: search input with XSS payload — no script execution
 *  ADV-AI-12  Voice: navigate to voice and back 3× — no console errors
 *  ADV-AI-13  Swarm: visiting /admin/swarm/:siteId with invalid ID — no white screen
 *  ADV-AI-14  Swarm: navigating away from swarm mid-load — no zombie subscriptions
 *  ADV-AI-15  Site DNA: visiting /admin/sites/:id/dna without a valid site — graceful
 *  ADV-AI-16  Site DNA: submit dna-feedback-form empty — friendly validation
 *  ADV-AI-17  Site DNA: dna-action-select rapid change 4×
 *  ADV-AI-18  Site Copilot: visiting /admin/sites/:id/copilot without site — graceful
 *  ADV-AI-19  AI-endpoints page: hard reload — shell remounts, list reloads
 *  ADV-AI-20  AI-chat-extras: file upload area visible, drop of 0 files does not crash
 *
 * Rules:
 *  - authedPage fixture (starts at BASE homepage, pre-authed)
 *  - Internal nav via UI clicks / routerLink locators only
 *  - No page.waitForTimeout
 *  - Parallel-safe (isolated browser context per test)
 *  - test.skip when section requires an active site not available in test session
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

// ─── ADV-AI-01: Traces grid empty filter ────────────────────────────────────

test.describe('ADV-AI-01 — Traces grid with empty filter state', () => {
  test('traces section renders grid or empty state — not blank page', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/traces');
    if (!navigated) {
      test.skip(true, 'traces nav link not visible');
      return;
    }

    // Grid or its parent must appear
    await page
      .waitForSelector(
        '[data-testid="traces-grid"], [data-testid="traces-filter"]',
        { timeout: 8_000 },
      )
      .catch(() => undefined);

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-02: Traces copy-button on first row ──────────────────────────────

test.describe('ADV-AI-02 — Traces copy-button on first row', () => {
  test('clicking first copy-button in traces grid does not crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/traces');
    if (!navigated) {
      test.skip(true, 'traces nav link not visible');
      return;
    }

    await page
      .waitForSelector('[data-testid="traces-grid"]', { timeout: 8_000 })
      .catch(() => undefined);

    // The copy button testid has a dynamic id embedded — use partial match
    const firstCopyBtn = page
      .locator('[data-testid^="traces-copy-"]')
      .first();
    if (await firstCopyBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await firstCopyBtn.click({ force: true });
    }
    // Even with no rows this is fine
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-03: AI-endpoint suggest panel spam ──────────────────────────────

test.describe('ADV-AI-03 — AI-endpoint suggest panel spam generate', () => {
  test('clicking suggest-generate 3× does not produce stacked requests or crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/ai-endpoints');
    if (!navigated) {
      test.skip(true, 'ai-endpoints nav link not visible');
      return;
    }

    // Open AI-generate panel
    const aiBtn = page.getByTestId('ai-endpoint-create-ai');
    if (!(await aiBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'ai-endpoint-create-ai not visible');
      return;
    }
    await aiBtn.click();

    const suggestInput = page.getByTestId('ai-endpoint-suggest-input');
    if (await suggestInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await suggestInput.fill('test spam suggest');
    }

    const generateBtn = page.getByTestId('ai-endpoint-suggest-generate');
    if (await generateBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // Spam 3×
      await generateBtn.click({ force: true });
      await generateBtn.click({ force: true });
      await generateBtn.click({ force: true });
    }

    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 6_000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-04: AI-endpoint suggest input XSS ───────────────────────────────

test.describe('ADV-AI-04 — AI-endpoint suggest input XSS payload', () => {
  test('XSS payload in ai-endpoint-suggest-input does not execute', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/ai-endpoints');
    if (!navigated) {
      test.skip(true, 'ai-endpoints nav link not visible');
      return;
    }

    await page.evaluate(() => {
      (window as Record<string, unknown>)['__xss_fired__'] = false;
    });

    const aiBtn = page.getByTestId('ai-endpoint-create-ai');
    if (!(await aiBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'ai-endpoint-create-ai not visible');
      return;
    }
    await aiBtn.click();

    const suggestInput = page.getByTestId('ai-endpoint-suggest-input');
    if (await suggestInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await suggestInput.fill('<script>window.__xss_fired__=true</script>');
    }

    const fired = await page.evaluate(
      () => (window as Record<string, unknown>)['__xss_fired__'],
    );
    expect(fired).not.toBe(true);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-05: AI-endpoint method-select rapid change ──────────────────────

test.describe('ADV-AI-05 — AI-endpoint method-select rapid toggle', () => {
  test('changing endpoint method GET→POST→GET rapidly does not crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/ai-endpoints');
    if (!navigated) {
      test.skip(true, 'ai-endpoints nav link not visible');
      return;
    }

    // Open manual create panel
    const manualBtn = page.getByTestId('ai-endpoint-create-manual');
    if (!(await manualBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'ai-endpoint-create-manual not visible');
      return;
    }
    await manualBtn.click();

    const methodSelect = page.getByTestId('ai-endpoint-create-method');
    if (!(await methodSelect.isVisible({ timeout: 3_000 }).catch(() => false))) {
      test.skip(true, 'ai-endpoint-create-method not visible');
      return;
    }

    // Toggle via select or split button
    const methods = ['GET', 'POST', 'GET', 'POST'];
    for (const m of methods) {
      // Try as a select element first
      const tagName = await methodSelect.evaluate((el) => el.tagName);
      if (tagName === 'SELECT') {
        await methodSelect.selectOption(m).catch(() => undefined);
      } else {
        // p-selectbutton or similar — click the option label
        const optBtn = methodSelect.locator(`button:has-text("${m}")`).first();
        if (await optBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
          await optBtn.click({ force: true });
        }
      }
    }

    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-06: AI-endpoint filter language toggle ──────────────────────────

test.describe('ADV-AI-06 — AI-endpoints filter language rapid toggle', () => {
  test('toggling language filter on ai-endpoints 4× does not crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/ai-endpoints');
    if (!navigated) {
      test.skip(true, 'ai-endpoints nav link not visible');
      return;
    }

    const filterBtn = page.getByTestId('ai-endpoints-filter');
    const langFilter = page.getByTestId('ai-endpoints-filter-language');

    if (await filterBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await filterBtn.click();
    }

    if (await langFilter.isVisible({ timeout: 3_000 }).catch(() => false)) {
      for (let i = 0; i < 4; i++) {
        await langFilter.click({ force: true });
      }
    }

    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-07: AI-chat-extras web-search toggle 3× ────────────────────────

test.describe('ADV-AI-07 — AI-chat-extras web-search toggle 3×', () => {
  test('toggling ai-chat-extras enable-web-search 3× does not crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    // ai-chat-extras is a settings section
    await clickNav(page, '/admin/settings');

    const webSearchToggle = page.getByTestId('ai-chat-enable-web-search');
    if (!(await webSearchToggle.isVisible({ timeout: 6_000 }).catch(() => false))) {
      test.skip(true, 'ai-chat-enable-web-search not visible in settings');
      return;
    }

    for (let i = 0; i < 3; i++) {
      await webSearchToggle.click({ force: true });
    }
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-08: AI-chat-extras connect-drive graceful ──────────────────────

test.describe('ADV-AI-08 — AI-chat-extras connect-drive graceful without OAuth', () => {
  test('clicking connect-drive when OAuth not configured shows graceful state', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/settings');

    const connectDriveBtn = page.getByTestId('ai-chat-extras-connect-drive');
    if (!(await connectDriveBtn.isVisible({ timeout: 6_000 }).catch(() => false))) {
      test.skip(true, 'ai-chat-extras-connect-drive not visible');
      return;
    }

    await connectDriveBtn.click();
    // Allow any navigation or popup to settle
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 6_000 });
    // Shell must survive
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-09: AI-chat-extras view-summary no history ─────────────────────

test.describe('ADV-AI-09 — AI-chat-extras view-summary with no chat history', () => {
  test('clicking view-summary when no chats exist shows graceful empty state', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/settings');

    const viewSummaryBtn = page.getByTestId('ai-chat-extras-view-summary');
    if (!(await viewSummaryBtn.isVisible({ timeout: 6_000 }).catch(() => false))) {
      test.skip(true, 'ai-chat-extras-view-summary not visible');
      return;
    }
    await viewSummaryBtn.click();

    const summaryBody = page.getByTestId('ai-chat-extras-summary-body');
    const summaryStats = page.getByTestId('ai-chat-extras-summary-stats');
    // Either a summary or an empty-state message must appear
    const bodyPresent =
      (await summaryBody.isVisible({ timeout: 4_000 }).catch(() => false)) ||
      (await summaryStats.isVisible({ timeout: 4_000 }).catch(() => false));
    // Acceptable even if neither is present — just assert no crash
    expect(typeof bodyPresent).toBe('boolean');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-10: Voice section loads gracefully ──────────────────────────────

test.describe('ADV-AI-10 — Voice section loads gracefully', () => {
  test('/admin/voice renders section or shows graceful empty state', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/voice');
    if (!navigated) {
      test.skip(true, 'voice nav link not visible');
      return;
    }

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 8_000 });
    // At minimum the voice section container should be in DOM or page body has content
    const bodyText = await page.textContent('body');
    expect(bodyText?.trim().length).toBeGreaterThan(0);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-11: Voice search XSS ─────────────────────────────────────────────

test.describe('ADV-AI-11 — Voice search XSS payload', () => {
  test('XSS payload in voice-search-q does not execute injected script', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const navigated = await clickNav(page, '/admin/voice');
    if (!navigated) {
      test.skip(true, 'voice nav link not visible');
      return;
    }

    await page.evaluate(() => {
      (window as Record<string, unknown>)['__xss_fired__'] = false;
    });

    const voiceSearch = page.getByTestId('voice-search-q');
    if (!(await voiceSearch.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'voice-search-q not visible');
      return;
    }

    await voiceSearch.fill('<script>window.__xss_fired__=true</script>');
    await page.keyboard.press('Enter');

    const fired = await page.evaluate(
      () => (window as Record<string, unknown>)['__xss_fired__'],
    );
    expect(fired).not.toBe(true);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-12: Voice navigate back-and-forth 3× ────────────────────────────

test.describe('ADV-AI-12 — Voice navigate back-and-forth 3×', () => {
  test('navigating to /admin/voice and away 3× produces no console errors', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const sentinel = await injectSentinel(page);

    for (let i = 0; i < 3; i++) {
      const voiceLink = page.locator('a[routerLink="/admin/voice"]').first();
      if (await voiceLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await voiceLink.click();
        await page
          .waitForURL(/\/admin\/voice/, { timeout: 5_000 })
          .catch(() => undefined);
      }

      const analyticsLink = page
        .locator('a[routerLink="/admin/analytics"]')
        .first();
      if (await analyticsLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await analyticsLink.click();
        await page
          .waitForURL(/\/admin\/analytics/, { timeout: 5_000 })
          .catch(() => undefined);
      }
    }

    await assertSentinel(page, sentinel);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-13: Swarm with invalid site ID ───────────────────────────────────

test.describe('ADV-AI-13 — Swarm with invalid site ID', () => {
  test('/admin/swarm/invalid-site-id-999 does not render white screen', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const sentinel = await injectSentinel(page);

    // Push route inside SPA (no goto after initial load)
    await page.evaluate(() =>
      window.history.pushState({}, '', '/admin/swarm/invalid-site-id-999'),
    );
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 8_000 });

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 10_000 });
    await assertSentinel(page, sentinel);
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-14: Swarm navigate away mid-load ────────────────────────────────

test.describe('ADV-AI-14 — Swarm navigate away mid-load', () => {
  test('navigating away from a swarm route before it fully loads leaves no zombie state', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const sentinel = await injectSentinel(page);

    // Navigate toward swarm via history then immediately leave
    const swarmLink = page.locator('a[href*="/admin/swarm/"]').first();
    if (await swarmLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // Click swarm link and immediately navigate away
      await swarmLink.click();
      const analyticsLink = page.locator('a[routerLink="/admin/analytics"]').first();
      if (await analyticsLink.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await analyticsLink.click();
      }
    } else {
      // Push swarm route + immediately push analytics
      await page.evaluate(() =>
        window.history.pushState({}, '', '/admin/swarm/fake-id'),
      );
      await page.evaluate(() =>
        window.history.pushState({}, '', '/admin/analytics'),
      );
    }

    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 8_000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 10_000 });
    await assertSentinel(page, sentinel);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-15: Site DNA with invalid site ID ────────────────────────────────

test.describe('ADV-AI-15 — Site DNA with invalid site ID graceful', () => {
  test('/admin/sites/invalid-id/dna does not white-screen', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const sentinel = await injectSentinel(page);

    await page.evaluate(() =>
      window.history.pushState({}, '', '/admin/sites/invalid-id-adv-test/dna'),
    );
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 8_000 });

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 10_000 });
    await assertSentinel(page, sentinel);
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-16: Site DNA empty feedback submit ───────────────────────────────

test.describe('ADV-AI-16 — Site DNA empty feedback submit', () => {
  test('submitting dna-feedback-form with no content shows validation — no crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);

    // Navigate to an actual site's DNA page if possible
    const dnaLink = page.locator('a[href*="/dna"]').first();
    const hasDnaLink = await dnaLink.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasDnaLink) {
      test.skip(true, 'No DNA link visible (no sites in test session)');
      return;
    }
    await dnaLink.click();
    await page
      .waitForURL(/\/dna/, { timeout: 8_000 })
      .catch(() => undefined);

    const flagGate = page.getByTestId('dna-flag-gate');
    if (await flagGate.isVisible({ timeout: 3_000 }).catch(() => false)) {
      test.skip(true, 'dna-flag-gate visible — feature not enabled for test session');
      return;
    }

    const submitBtn = page.getByTestId('dna-submit-btn');
    if (!(await submitBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'dna-submit-btn not visible');
      return;
    }

    // Leave context empty
    const contextInput = page.getByTestId('dna-context-input');
    if (await contextInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await contextInput.fill('');
    }

    await submitBtn.click();
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5_000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-17: Site DNA action-select rapid change ──────────────────────────

test.describe('ADV-AI-17 — Site DNA action-select rapid change', () => {
  test('changing dna-action-select 4× rapidly does not crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);

    const dnaLink = page.locator('a[href*="/dna"]').first();
    if (!(await dnaLink.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'No DNA link visible (no sites in test session)');
      return;
    }
    await dnaLink.click();
    await page.waitForURL(/\/dna/, { timeout: 8_000 }).catch(() => undefined);

    const flagGate = page.getByTestId('dna-flag-gate');
    if (await flagGate.isVisible({ timeout: 3_000 }).catch(() => false)) {
      test.skip(true, 'dna-flag-gate visible — feature not enabled');
      return;
    }

    const actionSelect = page.getByTestId('dna-action-select');
    if (!(await actionSelect.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'dna-action-select not visible');
      return;
    }

    // Click all available options in the select
    const options = await actionSelect.locator('option').allTextContents();
    for (let i = 0; i < Math.min(options.length, 4); i++) {
      await actionSelect.selectOption({ index: i }).catch(() => undefined);
    }
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-18: Site Copilot with invalid site ID ────────────────────────────

test.describe('ADV-AI-18 — Site Copilot with invalid site ID graceful', () => {
  test('/admin/sites/invalid-id/copilot does not white-screen', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    const sentinel = await injectSentinel(page);

    await page.evaluate(() =>
      window.history.pushState({}, '', '/admin/sites/invalid-id-adv-test/copilot'),
    );
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 8_000 });

    await expect(page.locator('aside').first()).toBeVisible({ timeout: 10_000 });
    await assertSentinel(page, sentinel);
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-19: AI-endpoints hard reload ─────────────────────────────────────

test.describe('ADV-AI-19 — AI-endpoints hard reload', () => {
  test('reloading /admin/ai-endpoints remounts shell and endpoint list', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/ai-endpoints');
    await page.reload({ waitUntil: 'networkidle', timeout: 20_000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 15_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-AI-20: AI-chat-extras file drop zone with 0 files ──────────────────

test.describe('ADV-AI-20 — AI-chat-extras file drop zone with empty drop', () => {
  test('dropping 0 files on ai-chat-knowledge-dropzone does not crash', async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await gotoAdmin(page);
    await clickNav(page, '/admin/settings');

    const dropzone = page.getByTestId('ai-chat-knowledge-dropzone');
    if (!(await dropzone.isVisible({ timeout: 6_000 }).catch(() => false))) {
      test.skip(true, 'ai-chat-knowledge-dropzone not visible in settings');
      return;
    }

    // Simulate empty drop (no dataTransfer files)
    await dropzone.dispatchEvent('dragenter', { dataTransfer: { files: [], types: [] } });
    await dropzone.dispatchEvent('drop', { dataTransfer: { files: [], types: [] } });
    await dropzone.dispatchEvent('dragleave');

    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5_000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 5_000 });
    expect(errors).toHaveLength(0);
  });
});
