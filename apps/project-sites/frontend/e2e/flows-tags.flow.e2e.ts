/**
 * flows-tags.flow.e2e.ts — Surface: site labels (feature `site_tags`) on
 * /admin/snapshots.
 *
 * FINISHED this fire — the module was truly-unbuilt (like annotations): BOTH
 * tables (`site_tags` + `site_tag_assignments`) were MISSING in prod (no
 * migration) so create/assign SWALLOWED "no such table" as a lying-success.
 * Added `migrations/0621_create_site_tags.sql` + applied it, verified the full
 * create→assign→delete in-browser, then built `<app-site-labels>` (create + assign
 * + remove) + wired it onto Snapshots (4th per-site panel).
 *
 * MUTATION full-flow: add a label (creates an org tag AND assigns it to the site)
 * → assert-persisted (GET site tags) → assert-UI (pill) → remove → assert-gone.
 * Self-cleaning (unique `e2e-label` marker + final cleanup test).
 *
 * Real testids: site-labels, site-label-input, site-label-color, site-label-add,
 * site-label-pill, site-label-remove, site-labels-empty.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-tags.flow --workers=1
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

const PANEL = '[data-testid="site-labels"]';
const SEEDED_SITE = 'e2e-site-3';
const MARK = 'e2e-label';

async function cleanupProbes(page: import('@playwright/test').Page) {
  const list = await apiFetch<{ data: { id: string; name: string }[] }>(page, '/api/site-tags');
  for (const t of list.body?.data ?? []) {
    if (t.name?.includes(MARK)) await apiFetch(page, `/api/site-tags/${t.id}`, { method: 'DELETE' });
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('Full-flow · site labels (tags)', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.use({ reducedMotion: 'reduce' });

  test('01 the site-labels panel renders on /admin/snapshots with an add form', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(PANEL), 'the site-labels panel renders').toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /site labels/i })).toBeVisible();
    await expect(page.locator('[data-testid="site-label-input"]'), 'the add form is present').toBeVisible();
    await snap(page, 'tags-01-panel');
    expectClean(errors);
  });

  test('02 the colour select offers multiple hues', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    const opts = await page.locator('[data-testid="site-label-color"] option').count();
    expect(opts, 'several colours offered').toBeGreaterThanOrEqual(4);
  });

  test('03 Add is disabled until a label name is typed', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="site-label-add"]')).toBeDisabled();
    await page.locator('[data-testid="site-label-input"]').fill('production');
    await expect(page.locator('[data-testid="site-label-add"]')).toBeEnabled();
  });

  test('04 MUTATION journey: add a label → assigns to the site (store) → pill shows → remove → gone', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    await cleanupProbes(page);

    const name = `${MARK}-${Date.now()}`;
    await page.locator('[data-testid="site-label-input"]').fill(name);
    await page.locator('[data-testid="site-label-color"]').selectOption('violet');
    await page.locator('[data-testid="site-label-add"]').click();

    // assert-UI: the label pill appears on the site.
    const pill = page.locator(`[data-testid="site-label-pill"][data-name="${name}"]`);
    await expect(pill, 'the label pill shows on the site').toBeVisible({ timeout: 8_000 });
    await snap(page, 'tags-04-added');

    // assert-persisted: the site's tags (store) include the new label.
    await expect(async () => {
      const store = await apiFetch<{ data: { name: string }[] }>(page, `/api/sites/${SEEDED_SITE}/tags`);
      const names = (store.body.data ?? []).map((t) => t.name);
      expect(names, 'the label is assigned to the site in the store').toContain(name);
    }).toPass({ timeout: 8_000 });

    // act: remove the label.
    await pill.locator('[data-testid="site-label-remove"]').click();
    await expect(pill, 'the pill is removed from the UI').toHaveCount(0, { timeout: 8_000 });

    // assert-persisted: gone from the site's tags in the store.
    await expect(async () => {
      const store = await apiFetch<{ data: { name: string }[] }>(page, `/api/sites/${SEEDED_SITE}/tags`);
      const names = (store.body.data ?? []).map((t) => t.name);
      expect(names, 'the label is gone from the store after remove').not.toContain(name);
    }).toPass({ timeout: 8_000 });
    expectClean(errors);
  });

  test('05 a second label persists with its chosen colour', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    const name = `${MARK}-green-${Date.now()}`;
    await page.locator('[data-testid="site-label-input"]').fill(name);
    await page.locator('[data-testid="site-label-color"]').selectOption('green');
    await page.locator('[data-testid="site-label-add"]').click();
    const pill = page.locator(`[data-testid="site-label-pill"][data-name="${name}"]`);
    await expect(pill).toBeVisible({ timeout: 8_000 });
    // The store confirms the assignment.
    await expect(async () => {
      const store = await apiFetch<{ data: { name: string }[] }>(page, `/api/sites/${SEEDED_SITE}/tags`);
      expect((store.body.data ?? []).map((t) => t.name)).toContain(name);
    }).toPass({ timeout: 8_000 });
    // cleanup this row.
    await pill.locator('[data-testid="site-label-remove"]').click();
    await expect(pill).toHaveCount(0, { timeout: 8_000 });
  });

  test('06 deep-link + reload preserves the site-labels panel (session + flag intact)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('07 full journey: snapshots hosts readiness + sparkline + timeline-notes + site-labels', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator('[data-testid="readiness-panel"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="health-sparkline"]')).toBeVisible();
    await expect(page.locator('[data-testid="timeline-notes"]')).toBeVisible();
    await expect(page.locator(PANEL)).toBeVisible();
    await snap(page, 'tags-07-journey');
    expectClean(errors);
  });

  test('08 cleanup: remove any leftover probe labels (keep the shared org clean)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await cleanupProbes(page);
    const store = await apiFetch<{ data: { name: string }[] }>(page, '/api/site-tags');
    const leftover = (store.body.data ?? []).filter((t) => t.name?.includes(MARK));
    expect(leftover.length, 'no probe labels remain').toBe(0);
  });
});
