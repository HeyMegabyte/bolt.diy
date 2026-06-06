import { test, expect, type Page } from '@playwright/test';

/**
 * Audit-log grid — behavioural characterization (compliance flow + perf-wave net).
 *
 * The audit log is a CRITICAL compliance surface, yet the grid's INTERACTIONS
 * were uncovered: admin-functional only asserts the section "loads + renders
 * content". This locks the actual behaviours a reader depends on:
 *   1. Exactly ONE valid state renders (grid XOR empty XOR error) — never a
 *      silent blank, never a redundant ag-grid "No Rows" overlay under the card.
 *   2. "Export CSV" is always present + actionable (it lives in the header, not
 *      gated on row count) and clicking it never crashes the page.
 *   3. The faux master/detail contract: clicking a row's expand kebab opens the
 *      matching full-width detail panel (aria-expanded flips true); clicking
 *      again collapses it. This is the HARDEST thing the gated ag-grid →
 *      TanStack perf-wave migration must preserve
 *      (apps/project-sites/docs/perf-wave-ag-grid-to-tanstack.md) — having it as
 *      an automated RED→GREEN net means the migration can't silently regress the
 *      compliance viewer instead of relying on manual live-QA.
 *
 * Verified GREEN against prod 2026-06-06. Skips gracefully when the test org has
 * no audit rows (then it characterizes the empty-state contract instead).
 */

const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
      );
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

test.describe('admin — audit-log grid behavioural contract', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('audit renders exactly one valid state + CSV export is always actionable', async ({ page }) => {
    test.setTimeout(45000);
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await seed(page);
    await page.goto('/admin/audit', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar, nav').first()).toBeVisible({ timeout: 30000 });

    // Exactly one of the three states is present — never a silent blank.
    const grid = page.locator('[data-testid="audit-grid"]');
    const empty = page.locator('[data-testid="audit-empty"]');
    const errCard = page.locator('[data-testid="audit-error"]');
    await expect
      .poll(async () =>
        (await grid.count()) + (await empty.count()) + (await errCard.count()),
        { timeout: 30000, message: 'audit shows grid OR empty OR error — never a blank' },
      )
      .toBeGreaterThan(0);
    const states =
      (await grid.count()) + (await empty.count()) + (await errCard.count());
    expect(states, 'exactly one audit state renders (no stacked grid+empty)').toBe(1);

    // Export CSV lives in the header (not gated on rows) → always actionable.
    const csv = page.getByRole('button', { name: /export csv/i });
    await expect(csv).toBeVisible();
    await expect(csv).toBeEnabled();
    // Clicking is a guarded no-op when no grid is mounted; must never crash.
    await csv.click();
    await page.waitForTimeout(300);
    expect(pageErrors, `Export CSV click produced no page error:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('row expand kebab opens + collapses the matching detail panel (master/detail contract)', async ({ page }) => {
    test.setTimeout(45000);
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await seed(page);
    await page.goto('/admin/audit', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar, nav').first()).toBeVisible({ timeout: 30000 });

    const grid = page.locator('[data-testid="audit-grid"]');
    // No audit rows for the test org → characterize the empty contract instead.
    if ((await grid.count()) === 0) {
      await expect(page.locator('[data-testid="audit-empty"], [data-testid="audit-error"]').first())
        .toBeVisible({ timeout: 30000 });
      test.info().annotations.push({ type: 'note', description: 'no audit rows — empty-state contract verified, master/detail skipped' });
      return;
    }

    const firstKebab = page.locator('[data-testid^="audit-row-expand-"]').first();
    await expect(firstKebab).toBeVisible({ timeout: 30000 });
    const tid = (await firstKebab.getAttribute('data-testid')) ?? '';
    const id = tid.replace('audit-row-expand-', '');
    expect(id, 'derived a row id from the expand kebab').not.toBe('');
    const detail = page.locator(`[data-testid="audit-detail-${id}"]`);

    // Closed initially.
    await expect(firstKebab).toHaveAttribute('aria-expanded', 'false');
    await expect(detail).toHaveCount(0);

    // Expand → detail panel appears, kebab flips open.
    await firstKebab.click();
    await expect(detail).toBeVisible({ timeout: 5000 });
    await expect(firstKebab).toHaveAttribute('aria-expanded', 'true');
    // The detail panel exposes the copy-correlation affordance (support hand-off).
    await expect(page.locator(`[data-testid="audit-copy-row-${id}"]`)).toBeVisible();

    // Collapse → detail panel detaches, kebab flips closed.
    await firstKebab.click();
    await expect(detail).toHaveCount(0, { timeout: 5000 });
    await expect(firstKebab).toHaveAttribute('aria-expanded', 'false');

    expect(pageErrors, `expand/collapse produced no page error:\n${pageErrors.join('\n')}`).toEqual([]);
  });
});
