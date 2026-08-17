/**
 * CHAOS 13 — "The Compliance Auditor": audit event-count reconciliation.
 *
 * /api/audit-logs caps the page at 500 rows; it now returns the TRUE org-wide
 * count in `meta.total` (a COUNT) so the admin can't under-report audit events.
 * This reconciles DISPLAY vs the AUTHORITATIVE endpoint (verify-against-source-
 * of-truth): read the server's `meta.total` + loaded page, then assert the honest
 * "latest N of M events" note appears iff events are hidden (total > loaded), and
 * is absent otherwise.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) npx playwright test \
 *   --config=playwright.prod.config.ts chaos-13-audit-count
 */
import { test, expect } from '@playwright/test';
import { trackErrors, assertAlive, seedAuth } from './chaos-helpers';

const KEY = process.env.E2E_API_KEY ?? '';

test.describe('CHAOS 13 — Audit count reconciles with the server total', () => {
  test.beforeEach(() => {
    test.skip(!KEY, 'E2E_API_KEY not set');
  });

  test('endpoint exposes meta.total; the "latest N of M" note shows iff events are hidden', async ({
    page,
  }) => {
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    await page.goto('/admin/audit', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000); // load() completes

    // Ground truth from the authoritative endpoint (browser-context fetch → real
    // session, not Bot-Fight-challenged).
    const truth = await page.evaluate(async () => {
      const s = JSON.parse(localStorage.getItem('ps_session') || '{}');
      const r = await fetch('/api/audit-logs?limit=500', {
        headers: { Authorization: `Bearer ${s.token}` },
      });
      const j = (await r.json().catch(() => ({}))) as {
        data?: unknown[];
        meta?: { total?: number; has_more?: boolean };
      };
      return {
        status: r.status,
        dataLen: (j.data ?? []).length,
        hasMeta: !!j.meta,
        total: j.meta?.total ?? -1,
        hasMore: !!j.meta?.has_more,
      };
    });

    expect(truth.status, 'audit-logs must be readable').toBeLessThan(400);
    // The core contract fix: the endpoint MUST now expose meta.total (was {data}-only).
    expect(truth.hasMeta, 'audit-logs must return a meta envelope (total/has_more)').toBe(true);
    expect(truth.total, 'meta.total must be a real count ≥ the loaded page').toBeGreaterThanOrEqual(
      truth.dataLen,
    );
    console.log(
      `CHAOS13/audit: dataLen=${truth.dataLen} total=${truth.total} hasMore=${truth.hasMore}`,
    );

    const capNote = page.locator('[data-testid="audit-cap-note"]');
    if (truth.total > truth.dataLen) {
      // Events are hidden past the 500-row window → the honest note MUST show the total.
      await expect(capNote, 'cap-note appears when events are hidden').toBeVisible({ timeout: 6000 });
      await expect(capNote).toContainText(String(truth.total));
    } else {
      // Whole store fits in the page → no note (a full page is not a truncation).
      await expect(capNote, 'no cap-note when everything is loaded').toHaveCount(0);
    }

    await assertAlive(page);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual(
      [],
    );
  });
});
