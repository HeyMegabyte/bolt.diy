import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

/**
 * Audit-log grid — behavioural characterization (compliance flow + perf-wave net).
 *
 * The audit log is a CRITICAL compliance surface, yet the grid's INTERACTIONS
 * were uncovered: admin-functional only asserts the section "loads + renders
 * content". This locks the actual behaviours a reader depends on:
 *   1. Exactly ONE valid state renders (grid XOR empty XOR error) — never a
 *      silent blank.
 *   2. "Export CSV" is always PRESENT in the header; it's ENABLED only when there
 *      are rows to export (`canExport = rows>0`), disabled (never a headers-only
 *      CSV) when empty — and clicking the enabled button never crashes the page.
 *   3. The master/detail contract: clicking a row's expand kebab opens the
 *      matching detail panel (aria-expanded flips true); clicking again
 *      collapses it.
 *   4. (2026-08-20, perf-wave DONE) the TanStack table behaviours — header sort,
 *      page-size + pager, the site filter — PLUS the axe assertion that was the
 *      whole point: the critical `aria-required-children` violation ag-grid's
 *      `.ag-root[role="grid"]` forced is GONE (scanned WITHOUT the .ag-root
 *      exclusion the admin-a11y suite still carries for the traces grid).
 *
 * Verified GREEN against prod 2026-06-06. The test org now HAS audit rows (from
 * loop-verify site builds), so the POPULATED-grid branches are the live path; the
 * empty-state branches stay as a defensive net for a freshly-reset org.
 *
 * Regression note (2026-08-16): the grid rendered EMPTY despite 8 loaded events
 * because the old onGridReady applied the org NAME as a `site`-column equals-filter
 * (matching zero rows). Fixed by starting the grid unfiltered — this master/detail
 * test is the guard (it needs real rendered rows to find the expand kebab).
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
    } catch {
      /* private mode */
    }
  }, KEY);
}

test.describe('admin — audit-log grid behavioural contract', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('audit renders exactly one valid state + CSV export reflects row availability', async ({
    page,
  }) => {
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
      .poll(async () => (await grid.count()) + (await empty.count()) + (await errCard.count()), {
        timeout: 30000,
        message: 'audit shows grid OR empty OR error — never a blank',
      })
      .toBeGreaterThan(0);
    const states = (await grid.count()) + (await empty.count()) + (await errCard.count());
    expect(states, 'exactly one audit state renders (no stacked grid+empty)').toBe(1);

    // Export CSV lives in the header always, but is ENABLED only when there are
    // rows to export (`[disabled]="!canExport()"`, canExport = rows>0) — it never
    // emits a headers-only CSV. The test org now HAS audit rows, so the enabled
    // branch is the live path; the disabled branch stays as a defensive net for a
    // freshly-reset org. Assert the button reflects row availability: enabled +
    // clickable when a grid is mounted, disabled when the empty-state shows.
    const csv = page.getByRole('button', { name: /export csv/i });
    await expect(csv).toBeVisible();
    if ((await grid.count()) > 0) {
      await expect(csv).toBeEnabled();
      await csv.click(); // real export — must never crash
      await page.waitForTimeout(300);
    } else {
      await expect(
        csv,
        'CSV is disabled with no rows — never a headers-only export',
      ).toBeDisabled();
    }
    expect(
      pageErrors,
      `audit / CSV must not throw a page error:\n${pageErrors.join('\n')}`,
    ).toEqual([]);
  });

  test('row expand kebab opens + collapses the matching detail panel (master/detail contract)', async ({
    page,
  }) => {
    test.setTimeout(45000);
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await seed(page);
    await page.goto('/admin/audit', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar, nav').first()).toBeVisible({ timeout: 30000 });

    const grid = page.locator('[data-testid="audit-grid"]');
    // Wait for one of the three states FIRST — a single instantaneous
    // `grid.count()` races the lazy section mount + the audit fetch (the grid
    // @if-gates on rows>0), which took the "empty org" branch while rows were
    // still loading and dead-ended waiting for an empty-state that never came.
    await expect
      .poll(async () => (await grid.count()) + (await page.locator('[data-testid="audit-empty"], [data-testid="audit-error"]').count()), {
        timeout: 30000,
        message: 'audit settles into grid OR empty OR error',
      })
      .toBeGreaterThan(0);
    // Defensive net: if a freshly-reset org has no rows, characterize the empty
    // contract instead. The live test org HAS rows, so this branch is rarely hit.
    if ((await grid.count()) === 0) {
      await expect(
        page.locator('[data-testid="audit-empty"], [data-testid="audit-error"]').first(),
      ).toBeVisible({ timeout: 5000 });
      test.info().annotations.push({
        type: 'note',
        description: 'no audit rows — empty-state contract verified, master/detail skipped',
      });
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

    expect(pageErrors, `expand/collapse produced no page error:\n${pageErrors.join('\n')}`).toEqual(
      [],
    );
  });

  test('TanStack table: sort, pagination, site filter — and the axe critical is GONE', async ({
    page,
  }) => {
    test.setTimeout(90000);
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await seed(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/admin/audit', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 45000 });

    const grid = page.locator('[data-testid="audit-grid"]');
    if ((await grid.count()) === 0) {
      test.info().annotations.push({
        type: 'note',
        description: 'no audit rows — TanStack contract skipped (empty org)',
      });
      return;
    }
    await expect(grid).toBeVisible({ timeout: 30000 });

    // ── Sort: click the When header → aria-sort flips; page stays alive. ──
    const whenHeader = page.locator('th', { hasText: 'When' }).first();
    await expect(whenHeader).toHaveAttribute('aria-sort', /ascending|descending|none/);
    const before = await whenHeader.getAttribute('aria-sort');
    await whenHeader.click();
    await expect(whenHeader).not.toHaveAttribute('aria-sort', before ?? '', { timeout: 5000 });

    // ── Pagination: page-size select + pager reflect the row model. ──
    const sizeSelect = page.locator('#audit-page-size');
    await expect(sizeSelect).toBeVisible();
    const showing = page.locator('[data-testid="audit-page-count"]');
    await expect(showing).toContainText('of');
    await sizeSelect.selectOption('25');
    await expect(sizeSelect).toHaveValue('25');
    await expect(page.locator('.page-indicator')).toContainText('of');

    // ── Site filter: pick the first real site option → count rescopes; clear → restores. ──
    const siteSelect = page.locator('#audit-site-filter');
    await expect(siteSelect).toBeVisible();
    const options = await siteSelect.locator('option[value]:not([value=""])').allTextContents();
    if (options.length > 0) {
      const first = options[0].trim();
      const beforeCount = await showing.textContent();
      await siteSelect.selectOption(first);
      await expect(siteSelect).toHaveValue(first);
      await expect(showing).not.toHaveText(beforeCount ?? '', { timeout: 5000 });
      await siteSelect.selectOption('');
      await expect(siteSelect).toHaveValue('');
    }

    // ── The whole point of the wave: NO ag-grid → NO aria-required-children. ──
    // Scanned WITHOUT the .ag-root exclusion the admin-a11y suite carries for the
    // still-ag-grid traces grid — the audit page has no ag-root to exclude.
    await page.waitForTimeout(500);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .exclude('iframe')
      .analyze();
    const critical = results.violations.filter(
      (v) => v.id === 'aria-required-children' || v.impact === 'critical',
    );
    expect(
      critical.map((v) => `${v.id} · ${v.nodes.length}×`),
      'the ag-grid critical axe violation is gone from /admin/audit',
    ).toEqual([]);

    expect(
      pageErrors,
      `TanStack audit table produced no page error:\n${pageErrors.join('\n')}`,
    ).toEqual([]);
  });
});
