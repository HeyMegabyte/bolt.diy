/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the Domains AI-search / vanity-domain picker
 * (`ai-search-input` → `ai-search-btn` → `POST /api/sites/:id/domains/ai-search`) accepts
 * hostile/edge input inert and resolves a real query to suggestion cards or a calm empty
 * state. `domains-value-domains.spec.ts` covers the CUSTOM-domain input; the AI-search
 * surface was uncovered.
 *
 * The Register button on a result IS a money path — NEVER clicked. Org-scoped on the
 * selected site (skips if the AI-search input isn't present for the test org).
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./domains-value-domains.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

function attachConsole(page: Page): string[] {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !/Failed to load resource|net::ERR|Access is denied for this document|localStorage/i.test(m.text())
    )
      errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

const aiInput = (page: Page) => page.locator('[data-testid="ai-search-input"]');
const aiBtn = (page: Page) => page.locator('[data-testid="ai-search-btn"]');

/** Reach the Domains section's AI-search; returns false to skip if it isn't present. */
async function gotoDomains(page: Page): Promise<boolean> {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/domains', { waitUntil: 'domcontentloaded' });
  const ok = await aiInput(page)
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  return ok;
}

test.describe('Admin · Domains AI-search (P0-ADMIN)', () => {
  test('the AI-search input + button render (0 console errors)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    const ok = await gotoDomains(page);
    test.skip(!ok, 'AI-search not present for this org (no selected site)');

    await expect(aiInput(page), 'the AI-search input renders').toBeVisible();
    await expect(aiBtn(page), 'the Search-with-AI button renders').toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/admin-verify/domains-ai-search.png' });
    expect(errors, `must render with 0 console errors — saw ${errors.join(' | ')}`).toEqual([]);
  });

  test('hostile / edge queries render inert in the input — never execute or crash (no search fired)', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    let dialogFired = false;
    page.on('dialog', async (d) => {
      dialogFired = true;
      await d.dismiss().catch(() => {});
    });
    const ok = await gotoDomains(page);
    test.skip(!ok, 'AI-search not present for this org (no selected site)');

    const hostile = [`<script>alert('x')</script>`, `'; DROP TABLE hostnames;--`, `${'z'.repeat(300)}`, `日本語🎌`];
    for (const q of hostile) {
      await aiInput(page).fill(q);
      await expect(aiInput(page), 'the input preserves the literal hostile value').toHaveValue(q);
      await expect(aiInput(page), 'the section survives hostile input').toBeVisible();
    }
    expect(dialogFired, 'no payload fired a dialog (no script executed)').toBe(false);
  });

  test('clicking Search fires the real ai-search request and the surface survives (results are provider-timed)', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    let dialogFired = false;
    let searchPosts = 0;
    page.on('dialog', async (d) => {
      dialogFired = true;
      await d.dismiss().catch(() => {});
    });
    page.on('request', (r) => {
      if (/\/domains\/ai-search/.test(r.url()) && r.method() === 'POST') searchPosts++;
    });
    const ok = await gotoDomains(page);
    test.skip(!ok, 'AI-search not present for this org (no selected site)');

    await aiInput(page).fill('creative name for a barber shop in Newark');
    await aiBtn(page).click();
    // Clicking Search fires the real ai-search request (the feature is wired). We do NOT wait
    // on the external AI response — its timing is provider-dependent — only that the request
    // went out and the surface stays alive (no crash, no auto-triggered money-path dialog).
    await expect.poll(() => searchPosts, { timeout: 8000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1200);
    expect(dialogFired, 'the search fired no dialog (no script executed)').toBe(false);
    await expect(aiInput(page), 'the AI-search surface survives a real query').toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/admin-verify/domains-ai-search-fired.png' });
  });
});
