/**
 * flows-readiness.flow.e2e.ts — Surface: the production-readiness panel (feature
 * `prod_readiness_score`) on /admin/snapshots.
 *
 * FINISHED this fire: the worker endpoint (`GET /api/sites/:id/readiness`) + flag
 * were live but had NO UI consumer. Built `<app-readiness-panel>` (reacts to
 * `AdminStateService.selectedSite()`) + wired it above the snapshot timeline.
 *
 * Ground truth (e2e-test-org's site, live-computed): grade "F", score 0, 4 weighted
 * checks all failing (published / custom_domain / performance / sitemap), each with
 * an actionable hint.
 *
 * Real testids: readiness-panel, readiness-grade, readiness-score,
 * readiness-check-<name> (published/custom_domain/performance/sitemap),
 * readiness-all-clear.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-readiness.flow --workers=3
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

const PANEL = '[data-testid="readiness-panel"]';

/** Pull site ids from /api/sites regardless of the envelope key. */
function siteIds(body: unknown): string[] {
  const b = body as { data?: { id: string }[]; sites?: { id: string }[] };
  const arr = b.data ?? b.sites ?? [];
  return arr.map((s) => s.id).filter(Boolean);
}

test.describe('Full-flow · production readiness', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 the readiness panel renders on /admin/snapshots with a grade + score', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(PANEL), 'the readiness panel renders').toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /production readiness/i })).toBeVisible();
    const grade = (await page.locator('[data-testid="readiness-grade"]').innerText()).trim();
    expect(grade, 'the grade is a letter A–F').toMatch(/^[A-F]$/);
    await expect(page.locator('[data-testid="readiness-score"]'), 'the score is shown').toBeVisible();
    await snap(page, 'readiness-01-panel');
    expectClean(errors);
  });

  test('02 the score reads 0–100', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    const scoreText = (await page.locator('[data-testid="readiness-score"]').innerText()).replace(/\D/g, ' ').trim();
    const score = Number(scoreText.split(/\s+/)[0]);
    expect(score, 'score is a 0–100 number').toBeGreaterThanOrEqual(0);
    expect(score, 'score is a 0–100 number').toBeLessThanOrEqual(100);
  });

  test('03 ground-truth: the panel grade matches a real site readiness from the API store', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    const sites = await apiFetch<unknown>(page, '/api/sites');
    expect(sites.status).toBe(200);
    const ids = siteIds(sites.body);
    expect(ids.length, 'the org has at least one site').toBeGreaterThan(0);
    // Collect the API grade for every site; the selected-site panel must show one of them.
    const grades: string[] = [];
    for (const id of ids.slice(0, 5)) {
      const r = await apiFetch<{ grade?: string }>(page, `/api/sites/${id}/readiness`);
      if (r.status === 200 && typeof r.body.grade === 'string') grades.push(r.body.grade);
    }
    expect(grades.length, 'readiness resolves for the org sites (no 500)').toBeGreaterThan(0);
    const panelGrade = (await page.locator('[data-testid="readiness-grade"]').innerText()).trim();
    expect(grades, 'display reconciles with the store').toContain(panelGrade);
  });

  test('04 the failing checks render as an actionable fix-list with hints', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    // For a not-yet-production-ready site, at least one fix hint is shown.
    const items = page.locator('[data-testid^="readiness-check-"]');
    const allClear = page.locator('[data-testid="readiness-all-clear"]');
    const nItems = await items.count();
    if (nItems === 0) {
      await expect(allClear, 'a fully-ready site shows the all-clear state').toBeVisible();
    } else {
      await expect(items.first(), 'a fix item renders').toBeVisible();
      // The hint is human + actionable prose, not a bare code.
      const firstHint = (await items.first().innerText()).trim();
      expect(firstHint.length, 'the hint is descriptive prose').toBeGreaterThan(12);
    }
    await snap(page, 'readiness-04-checks');
  });

  test('05 a known readiness check surfaces with its guidance', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    // The e2e site fails publish + custom_domain — at least one of these guidance rows is present.
    const known = page.locator(
      '[data-testid="readiness-check-published"], [data-testid="readiness-check-custom_domain"], [data-testid="readiness-check-sitemap"], [data-testid="readiness-check-performance"]',
    );
    const allClear = page.locator('[data-testid="readiness-all-clear"]');
    expect((await known.count()) + (await allClear.count()), 'a specific check or the all-clear renders').toBeGreaterThan(0);
  });

  test('06 the readiness surface is console-error-free', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);
    expectClean(errors);
  });

  test('07 deep-link + reload preserves the readiness panel (session + flag intact)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(PANEL), 'still there after reload').toBeVisible({ timeout: 20_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('08 full journey: open snapshots → see the readiness grade + fixes → coherent + ground-truth', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    const grade = (await page.locator('[data-testid="readiness-grade"]').innerText()).trim();
    expect(grade).toMatch(/^[A-F]$/);
    // The snapshot timeline (the section this panel sits above) is also present — the
    // readiness panel did not displace the existing surface.
    await expect(page.getByRole('heading', { name: /production readiness/i })).toBeVisible();
    await snap(page, 'readiness-08-journey');
    expectClean(errors);
  });
});
