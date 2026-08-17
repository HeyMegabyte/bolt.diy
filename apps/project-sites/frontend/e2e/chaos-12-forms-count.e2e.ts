/**
 * CHAOS 12 — "The Lead-Counting Owner": forms count reconciliation.
 *
 * The /admin/forms count pill must show the TRUE number of stored leads (the
 * worker's `meta.total` = a COUNT(*)), NOT just the ≤200-row page the inbox
 * loaded. A site with >200 leads was reading "200 submissions" and hiding real,
 * revenue-bearing leads with no signal they existed.
 *
 * This reconciles DISPLAY vs the AUTHORITATIVE endpoint (verify-against-source-
 * of-truth): read the count pill, read the server's `meta.total`, assert they
 * match — and when the store holds more than the loaded page, the honest
 * "latest N of M" cap-note must appear.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) npx playwright test \
 *   --config=playwright.prod.config.ts chaos-12-forms-count
 */
import { test, expect } from '@playwright/test';
import { trackErrors, assertAlive, seedAuth } from './chaos-helpers';

const KEY = process.env.E2E_API_KEY ?? '';

test.describe('CHAOS 12 — Forms count reconciles with the server total', () => {
  test.beforeEach(() => {
    test.skip(!KEY, 'E2E_API_KEY not set');
  });

  test('count pill == meta.total (no lying-count); honest cap-note when leads are hidden', async ({
    page,
  }) => {
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    await page.goto('/admin/forms', { waitUntil: 'domcontentloaded' });
    // Wait for the inbox to finish its first load (the section header renders).
    await expect(page.getByRole('heading', { name: /^Forms/ })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2500); // reload() completes → submissions + total set

    // Ground truth from the authoritative endpoint (browser-context fetch → not
    // Bot-Fight-challenged, unlike a headless request).
    const truth = await page.evaluate(async () => {
      const s = JSON.parse(localStorage.getItem('ps_session') || '{}');
      const sites = await (
        await fetch('/api/sites', { headers: { Authorization: `Bearer ${s.token}` } })
      )
        .json()
        .catch(() => ({}));
      const site = Array.isArray(sites.data) ? sites.data[0] : undefined;
      if (!site) return null;
      const r = await fetch(`/api/sites/${site.id}/form-submissions`, {
        headers: { Authorization: `Bearer ${s.token}` },
      });
      const j = (await r.json().catch(() => ({}))) as {
        data?: unknown[];
        meta?: { total?: number; has_more?: boolean };
      };
      return {
        status: r.status,
        dataLen: (j.data ?? []).length,
        total: j.meta?.total ?? (j.data ?? []).length,
        hasMore: !!j.meta?.has_more,
      };
    });

    expect(truth, 'the E2E org must expose a site + form-submissions endpoint').not.toBeNull();
    if (!truth) return;
    expect(truth.status, 'form-submissions must be readable').toBeLessThan(400);
    console.log(`CHAOS12/forms: dataLen=${truth.dataLen} total=${truth.total} hasMore=${truth.hasMore}`);

    const pill = page.locator('.header-pill[aria-label*="submission"]').first();

    if (truth.total > 0) {
      await expect(pill, 'count pill renders when leads exist').toBeVisible({ timeout: 8000 });
      const label = (await pill.getAttribute('aria-label')) ?? '';
      const shown = Number(label.match(/(\d+)\s+submission/i)?.[1] ?? -1);
      // The core reconciliation: the pill shows the SERVER total, never just the
      // loaded page — and never fewer than what's actually on screen.
      expect(shown, `pill "${label}" must equal server meta.total ${truth.total}`).toBe(truth.total);
      expect(shown, 'pill never under-reports the loaded rows').toBeGreaterThanOrEqual(
        truth.dataLen,
      );
    } else {
      // Honest empty: 0 total → no count pill (nothing to over-claim).
      await expect(pill, 'no count pill when there are zero leads').toHaveCount(0);
    }

    // When the store holds more than the loaded page, the honest cap-note must show
    // both numbers; otherwise it must be absent (a full page is not a truncation).
    const capNote = page.locator('[data-testid="forms-cap-note"]');
    if (truth.total > truth.dataLen) {
      await expect(capNote, 'cap-note appears when leads are hidden').toBeVisible({ timeout: 6000 });
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
