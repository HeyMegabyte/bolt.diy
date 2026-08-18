/**
 * CHAOS 14 — "The Cost-Watching Operator": AI-logs call-count reconciliation.
 *
 * /api/sites/:id/ai-logs caps the page (default 200); it now returns the TRUE
 * call count in `meta.total` (a COUNT, respecting the `kind` filter) so the
 * admin "Calls" stat can't under-report. Reconciles DISPLAY vs the AUTHORITATIVE
 * endpoint: assert meta.total is exposed + the honest "latest N of M calls" note
 * appears iff calls are hidden (total > loaded), absent otherwise.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) npx playwright test \
 *   --config=playwright.prod.config.ts chaos-14-ai-logs-count
 */
import { test, expect } from '@playwright/test';
import { trackErrors, assertAlive, seedAuth } from './chaos-helpers';

const KEY = process.env.E2E_API_KEY ?? '';

test.describe('CHAOS 14 — AI-logs call count reconciles with the server total', () => {
  test.beforeEach(() => {
    test.skip(!KEY, 'E2E_API_KEY not set');
  });

  test('endpoint exposes meta.total; the "latest N of M calls" note shows iff calls are hidden', async ({
    page,
  }) => {
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    await page.goto('/admin/ai-logs', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000); // reload() completes

    // Ground truth from the authoritative endpoint for the selected site (browser-
    // context fetch → real session, not Bot-Fight-challenged).
    const truth = await page.evaluate(async () => {
      const s = JSON.parse(localStorage.getItem('ps_session') || '{}');
      const h = { Authorization: `Bearer ${s.token}` };
      const sites = await (await fetch('/api/sites', { headers: h })).json().catch(() => ({}));
      const site = Array.isArray(sites.data) ? sites.data[0] : undefined;
      if (!site) return null;
      const r = await fetch(`/api/sites/${site.id}/ai-logs`, { headers: h });
      const j = (await r.json().catch(() => ({}))) as {
        data?: unknown[];
        meta?: { total?: number; has_more?: boolean };
      };
      return {
        status: r.status,
        dataLen: (j.data ?? []).length,
        hasMeta: !!j.meta,
        total: j.meta?.total ?? -1,
      };
    });

    expect(truth, 'the E2E org must expose a site').not.toBeNull();
    if (!truth) return;
    expect(truth.status, 'ai-logs must be readable').toBeLessThan(400);
    // The contract fix: the endpoint MUST now expose meta.total (was {data}-only).
    expect(truth.hasMeta, 'ai-logs must return a meta envelope (total/has_more)').toBe(true);
    expect(truth.total, 'meta.total must be ≥ the loaded page').toBeGreaterThanOrEqual(truth.dataLen);
    console.log(`CHAOS14/ai-logs: dataLen=${truth.dataLen} total=${truth.total}`);

    const capNote = page.locator('[data-testid="ai-logs-cap-note"]');
    if (truth.total > truth.dataLen) {
      await expect(capNote, 'cap-note appears when calls are hidden').toBeVisible({ timeout: 6000 });
      await expect(capNote).toContainText(String(truth.total));
    } else {
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
