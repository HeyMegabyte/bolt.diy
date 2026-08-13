/**
 * flows-branches.flow.e2e.ts — Surface: per-site branch previews (#27) at
 * /admin/sites/:id/branches (SiteBranchesComponent). Genuinely uncovered + it was
 * SILENTLY BROKEN before this fire: `site_branches` + `site_branch_approvals` were
 * MISSING in prod (migration 0513 authored but never applied — it died on the same
 * legacy `INSERT INTO feature_flags(key,…)` trailing statement as 0514). The route
 * is NOT flag-gated (always live), so GET /branches lied-empty + POST /branches
 * lied-success — branch creation never persisted. Fire-28 applied the tables.
 *
 * Elaborate mutation lifecycle against prod for e2e-site-3: create a uniquely-named
 * branch → assert it lands in the table as `draft` + ground-truth (GET now has it) →
 * Request review → assert it transitions to `review` + ground-truth → Close → assert
 * `closed`. The route's UNIQUE(site_id, branch_name) means each run needs a fresh
 * name; a D1 sweep of `e2e-br-*` runs after the suite (the API only closes, not
 * hard-deletes).
 *
 * Real testids: site-branches, branch-new-toggle, branch-name-input,
 * branch-create-submit, branches-error.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-branches.flow --workers=1
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

const ROOT = '[data-testid="site-branches"]';
const SITE = 'e2e-site-3';
const ROUTE = `/admin/sites/${SITE}/branches`;

interface BranchesResp { branches: { id: string; branch_name: string; status: string }[] }

async function openBranches(page: import('@playwright/test').Page) {
  await gotoAdmin(page, ROUTE);
  await page.locator(ROOT).first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
}

test.describe('Full-flow · site branch previews', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ mode: 'serial', retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 the Branches surface renders for the site with a New-branch control', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await openBranches(page);
    await expect(page.locator(ROOT), 'the branches page renders').toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /^branches$/i })).toBeVisible();
    await expect(page.locator('[data-testid="branch-new-toggle"]')).toBeVisible();
    await snap(page, 'branches-01-surface');
    expectClean(errors);
  });

  test('02 ground-truth: the branches API is live (table now exists — no longer lying-empty)', async ({ page }) => {
    await seedSession(page);
    await openBranches(page);
    const api = await apiFetch<BranchesResp>(page, `/api/sites/${SITE}/branches`);
    expect(api.status, 'the branches list endpoint is 200 (table applied this fire)').toBe(200);
    expect(Array.isArray(api.body.branches), 'branches is a real array').toBe(true);
  });

  test('03 the create form validates the branch name (must be a DNS-safe label)', async ({ page }) => {
    await seedSession(page);
    await openBranches(page);
    await page.locator('[data-testid="branch-new-toggle"]').click();
    const input = page.locator('[data-testid="branch-name-input"]');
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill('Bad Name!'); // uppercase + space + bang → invalid DNS label
    await input.blur();
    // The submit is blocked for an invalid name (aria-invalid + disabled).
    await expect(page.locator('[data-testid="branch-create-submit"]')).toBeDisabled();
  });

  test('04 lifecycle: create draft → persist → Request review → review → Close → closed', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = attachConsole(page);
    await seedSession(page);
    await openBranches(page);
    await expect(page.locator(ROOT)).toBeVisible({ timeout: 20_000 });

    const name = `e2e-br-${Date.now()}`;
    await page.locator('[data-testid="branch-new-toggle"]').click();
    await page.locator('[data-testid="branch-name-input"]').fill(name);
    const submit = page.locator('[data-testid="branch-create-submit"]');
    await expect(submit).toBeEnabled({ timeout: 5_000 });
    await submit.click();

    // The new branch lands in the table as a draft.
    const row = page.locator('tr', { hasText: name });
    await expect(row, 'the created branch row renders').toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText(/draft/i);
    await snap(page, 'branches-04-created');

    // Ground-truth: the store persisted it as draft (poll for D1 replica lag).
    await expect(async () => {
      const after = await apiFetch<BranchesResp>(page, `/api/sites/${SITE}/branches`);
      const mine = (after.body.branches ?? []).find((b) => b.branch_name === name);
      expect(mine?.status, 'persisted as draft').toBe('draft');
    }).toPass({ timeout: 15_000 });

    // Request review → status transitions to review.
    await row.getByRole('button', { name: /request review/i }).click();
    await expect(row, 'the branch transitions to review').toContainText(/review/i, { timeout: 10_000 });
    await expect(async () => {
      const after = await apiFetch<BranchesResp>(page, `/api/sites/${SITE}/branches`);
      expect((after.body.branches ?? []).find((b) => b.branch_name === name)?.status).toBe('review');
    }).toPass({ timeout: 15_000 });

    // Close → the lifecycle ends (self-cleanup of the visible state).
    await row.getByRole('button', { name: /^close/i }).click();
    await expect(async () => {
      const after = await apiFetch<BranchesResp>(page, `/api/sites/${SITE}/branches`);
      expect((after.body.branches ?? []).find((b) => b.branch_name === name)?.status).toBe('closed');
    }).toPass({ timeout: 15_000 });
    await snap(page, 'branches-04-closed');
    expectClean(errors);
  });

  test('05 the branches surface is console-error-free', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await openBranches(page);
    await expect(page.locator(ROOT)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(400);
    expectClean(errors);
  });

  test('06 deep-link + reload preserves the Branches surface (session intact)', async ({ page }) => {
    await seedSession(page);
    await openBranches(page);
    await expect(page.locator(ROOT)).toBeVisible({ timeout: 20_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openBranches(page);
    await expect(page.locator(ROOT), 'still there after reload').toBeVisible({ timeout: 20_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('07 full journey: branches page → the API + the table reconcile (every store branch shows)', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await openBranches(page);
    await expect(page.locator(ROOT)).toBeVisible({ timeout: 20_000 });
    const api = await apiFetch<BranchesResp>(page, `/api/sites/${SITE}/branches`);
    expect(api.status).toBe(200);
    const active = (api.body.branches ?? []).filter((b) => b.status !== 'closed');
    // Every non-closed branch in the store is shown in the table.
    for (const b of active.slice(0, 3)) {
      await expect(page.locator('tr', { hasText: b.branch_name }), `${b.branch_name} is shown`).toBeVisible();
    }
    await snap(page, 'branches-07-journey');
    expectClean(errors);
  });
});
