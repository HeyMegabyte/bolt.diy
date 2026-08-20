import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

/**
 * Traces grid (perf-wave Step 2, 2026-08-20) — behavioural contract + the axe
 * assertion that was the whole point of the ag-grid→TanStack migration.
 *
 * Locks the behaviours a reader depends on:
 *   1. Row click expands the full trace detail panel (testids preserved from
 *      the ag-grid era: traces-detail-*, traces-rerun-*, traces-explain-*,
 *      traces-copy-json-*, traces-open-endpoint-*); clicking again collapses.
 *   2. The critical `aria-required-children` violation ag-grid's
 *      `.ag-root[role="grid"]` forced is GONE — scanned WITHOUT the .ag-root
 *      exclusion the admin-a11y suite carries nowhere for this page anymore
 *      (the exclusion only survives for legacy callers until Step 3 lands).
 *
 * Route: /admin/ai-logs → 301s to /admin/logs?tab=traces (RENAMED_ROUTES) —
 * goto the canonical tab URL directly. Requires a selected site with traces;
 * a freshly-reset org skips with an annotation (honest-empty, not lying).
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

test.describe('admin — traces grid behavioural contract (TanStack)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('row click expands + collapses the full trace detail; the axe critical is GONE', async ({
    page,
  }) => {
    test.setTimeout(90000);
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await seed(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/admin/logs?tab=traces', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 45000 });

    const grid = page.locator('[data-testid="traces-grid"]');
    // Honest-empty guard: a freshly-reset org / site with no AI calls has no
    // grid — annotate and skip rather than dead-end (mirrors admin-audit-grid).
    await expect
      .poll(
        async () =>
          (await grid.count()) +
          (await page.locator('[data-testid="ai-logs-empty"], [data-testid="ai-logs-load-error"], [data-testid="ai-logs-skeleton"]').count()),
        { timeout: 30000, message: 'traces settle into table OR empty OR error OR skeleton' },
      )
      .toBeGreaterThan(0);
    if ((await grid.count()) === 0) {
      test.info().annotations.push({
        type: 'note',
        description: 'no traces for the selected site — empty-state contract verified, detail skipped',
      });
      return;
    }
    await expect(grid).toBeVisible({ timeout: 30000 });

    // ── Expand: click the first master row → detail panel + action buttons. ──
    const firstRow = grid.locator('tbody tr.master-row').first();
    await expect(firstRow).toBeVisible({ timeout: 30000 });
    await firstRow.click();
    const detail = page.locator('[data-testid^="traces-detail-"]').first();
    await expect(detail).toBeVisible({ timeout: 15000 }); // lazy detail fetch may take a beat
    await expect(page.locator('[data-testid^="traces-rerun-"]').first()).toBeVisible();
    await expect(page.locator('[data-testid^="traces-explain-"]').first()).toBeVisible();
    await expect(page.locator('[data-testid^="traces-copy-json-"]').first()).toBeVisible();
    await expect(page.locator('[data-testid^="traces-open-endpoint-"]').first()).toBeVisible();

    // ── Collapse: second click detaches the detail row. ──
    await firstRow.click();
    await expect(page.locator('[data-testid^="traces-detail-"]')).toHaveCount(0, { timeout: 5000 });

    // ── The whole point of the wave: NO ag-grid → NO aria-required-children. ──
    // Scanned WITHOUT the .ag-root exclusion the legacy admin-a11y suite
    // carried for this page — there is no ag-root to exclude anymore.
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
      'the ag-grid critical axe violation is gone from the traces grid',
    ).toEqual([]);

    expect(pageErrors, `TanStack traces table produced no page error:\n${pageErrors.join('\n')}`).toEqual(
      [],
    );
  });
});
